// 숫자 6자리 코드 랑데부 — 공개 Nostr 릴레이를 만남 장소로 쓴다.
// 키 합의는 SPAKE2(RFC 9382): 릴레이에 오가는 대화 기록만으로는 코드를 오프라인
// 대입으로 검증할 수 없고, 공격자는 세션당 한 번의 온라인 추측만 가능하다.
// 메시지 4개: ①호스트 pA → ②게스트 pB+확인 → ③호스트 확인+봉인된 청약 → ④게스트 봉인된 응답.
// 파일은 여기를 지나지 않는다 — 릴레이가 보는 건 공개 설계값(pA·pB)과 암호문뿐.

import { RelayPool, createEvent } from "./nostr";
import { startHostSpake, runGuestSpake } from "./spake2";

const KIND = 30078; // NIP-78 앱 데이터(파라미터 치환형) — 릴레이가 저장해 주는 종류
const NAMESPACE = "local-tools-drop-v2"; // v1(PBKDF2 방식)과 방을 격리
const TTL_S = 300; // NIP-40 만료 — 방은 5분짜리 일회용

export function generateCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

const te = new TextEncoder();

/** 방 태그 — 릴레이에서 글을 찾는 공개 식별자. 코드에서만 유도된다. */
async function deriveTag(code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(`${NAMESPACE}:${code}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: te.encode(`${NAMESPACE}:room-tag`), iterations: 120_000, hash: "SHA-256" },
    key,
    128,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SPAKE2 산출 비밀(Ke)에서 전송용 AES-256-GCM 키 파생 */
async function aeadKey(ke: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const hkdf = await crypto.subtle.importKey("raw", ke, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode(`${NAMESPACE}:aead`) },
    hkdf,
    256,
  );
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(key: CryptoKey, plain: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

async function open(key: CryptoKey, sealed: Uint8Array): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.slice(0, 12) },
    key,
    sealed.slice(12),
  );
  return new TextDecoder().decode(plain);
}

function expiration(): string[] {
  return ["expiration", String(Math.floor(Date.now() / 1000) + TTL_S)];
}

async function publish(pool: RelayPool, dTag: string, bytes: Uint8Array): Promise<void> {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  const ev = await createEvent(KIND, [["d", dTag], expiration()], b64(bytes), priv);
  await pool.publish(ev);
}

async function openPool(): Promise<RelayPool> {
  const pool = new RelayPool();
  if (!(await pool.anyOpen())) {
    pool.close();
    throw new Error("no relay");
  }
  return pool;
}

/**
 * 호스트: pA를 올려 두고, 유효한 게스트(같은 코드 증명)가 나타나면
 * 봉인한 청약을 건네고 봉인된 응답을 기다린다. cancel()로 정리.
 */
export async function hostRendezvous(
  code: string,
  offerSdp: string,
  onAnswer: (sdp: string) => void,
): Promise<() => void> {
  const tag = await deriveTag(code);
  const pool = await openPool();
  const spake = await startHostSpake(code, NAMESPACE);
  await publish(pool, `${tag}a`, spake.msgA);

  let settled = false;
  const now = Math.floor(Date.now() / 1000);
  pool.subscribe({ kinds: [KIND], "#d": [`${tag}b`], since: now - 60 }, (ev) => {
    void (async () => {
      if (settled) return;
      let msgB: Uint8Array;
      try {
        msgB = unb64(ev.content);
      } catch {
        return;
      }
      const result = await spake.finish(msgB);
      if (!result || settled) return; // 코드 불일치·잘못된 점 — 무시
      settled = true;
      const key = await aeadKey(result.ke);
      const sealedOffer = await seal(key, offerSdp);
      const msg = new Uint8Array(32 + sealedOffer.length);
      msg.set(result.confirmA);
      msg.set(sealedOffer, 32);
      await publish(pool, `${tag}o`, msg);
      pool.subscribe({ kinds: [KIND], "#d": [`${tag}r`], since: now - 60 }, (answerEv) => {
        void (async () => {
          try {
            onAnswer(await open(key, unb64(answerEv.content)));
          } catch {
            /* 키 불일치 — 무시 */
          }
        })();
      });
    })();
  });

  return () => pool.close();
}

/**
 * 게스트: 코드로 pA를 찾아 SPAKE2를 마치고, 호스트가 같은 코드를 안다는
 * 증명(confirmA)을 확인한 뒤 청약을 열어 응답을 봉인해 올린다.
 */
export async function joinRendezvous(
  code: string,
  createAnswer: (offerSdp: string) => Promise<string>,
  timeoutMs = 12_000,
): Promise<void> {
  const tag = await deriveTag(code);
  const pool = await openPool();
  try {
    // ① pA 수신 → pB+확인 발행
    const guest = await new Promise<Awaited<ReturnType<typeof runGuestSpake>>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("not found")), timeoutMs);
        pool.subscribe({ kinds: [KIND], "#d": [`${tag}a`] }, (ev) => {
          void (async () => {
            try {
              const g = await runGuestSpake(code, NAMESPACE, unb64(ev.content));
              clearTimeout(timer);
              resolve(g);
            } catch {
              /* 잘못된 점 — 다음 이벤트 대기 */
            }
          })();
        });
      },
    );
    await publish(pool, `${tag}b`, guest.msgB);

    // ② 호스트 확인 + 봉인된 청약 수신
    const key = await aeadKey(guest.ke);
    const offerSdp = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("not found")), timeoutMs);
      pool.subscribe({ kinds: [KIND], "#d": [`${tag}o`] }, (ev) => {
        void (async () => {
          try {
            const msg = unb64(ev.content);
            if (!guest.verifyHost(msg.slice(0, 32))) return; // 코드 증명 실패 — 무시
            const sdp = await open(key, msg.slice(32));
            clearTimeout(timer);
            resolve(sdp);
          } catch {
            /* 복호화 실패 — 무시 */
          }
        })();
      });
    });

    // ③ 응답 생성 → 봉인해 발행
    const answerSdp = await createAnswer(offerSdp);
    await publish(pool, `${tag}r`, await seal(key, answerSdp));
  } finally {
    // 발행 직후 닫으면 일부 릴레이에 안 닿을 수 있어 잠깐 유예
    setTimeout(() => pool.close(), 1500);
  }
}
