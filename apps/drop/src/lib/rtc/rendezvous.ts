// 숫자 6자리 코드 랑데부 — 공개 Nostr 릴레이를 만남 장소로 쓴다.
// 코드에서 방 태그(공개)와 AES-GCM 키(비공개)를 따로 파생하고,
// SDP는 종단간 암호화해 올리므로 릴레이는 암호문만 본다. 파일은 여기를 지나지 않는다.

import { RelayPool, createEvent, type NostrEvent } from "./nostr";

const KIND = 30078; // NIP-78 앱 데이터(파라미터 치환형) — 릴레이가 저장해 주는 종류
const NAMESPACE = "local-tools-drop-v1";
const TTL_S = 300; // NIP-40 만료 — 방은 5분짜리 일회용

export function generateCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

async function pbkdf2(code: string, salt: string, bits: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${NAMESPACE}:${code}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120_000, hash: "SHA-256" },
    key,
    bits,
  );
  return new Uint8Array(derived);
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Room {
  tag: string; // 릴레이에 노출되는 방 식별자
  aes: CryptoKey; // SDP 암호화 키 — 코드 없이는 못 만든다
}

async function deriveRoom(code: string): Promise<Room> {
  const [tagBytes, keyBytes] = await Promise.all([
    pbkdf2(code, "room-tag", 128),
    pbkdf2(code, "cipher-key", 256),
  ]);
  const aes = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return { tag: hex(tagBytes), aes };
}

async function seal(room: Room, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      room.aes,
      new TextEncoder().encode(plain),
    ),
  );
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv);
  joined.set(ct, iv.length);
  let bin = "";
  for (const b of joined) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function unseal(room: Room, sealed: string): Promise<string> {
  const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    room.aes,
    bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

function expiration(): string[] {
  return ["expiration", String(Math.floor(Date.now() / 1000) + TTL_S)];
}

/** 호스트: 청약을 올려 두고 응답을 기다린다. cancel()로 정리. */
export async function hostRendezvous(
  code: string,
  offerSdp: string,
  onAnswer: (sdp: string) => void,
): Promise<() => void> {
  const room = await deriveRoom(code);
  const pool = new RelayPool();
  if (!(await pool.anyOpen())) {
    pool.close();
    throw new Error("no relay");
  }
  const priv = crypto.getRandomValues(new Uint8Array(32));
  const ev = await createEvent(
    KIND,
    [["d", `${room.tag}o`], expiration()],
    await seal(room, offerSdp),
    priv,
  );
  await pool.publish(ev);
  let done = false;
  const unsub = pool.subscribe(
    { kinds: [KIND], "#d": [`${room.tag}a`], since: Math.floor(Date.now() / 1000) - 60 },
    (answerEv: NostrEvent) => {
      if (done) return;
      done = true;
      unseal(room, answerEv.content)
        .then((sdp) => onAnswer(sdp))
        .catch(() => {
          /* 코드가 다른 방의 이벤트 — 무시 */
        });
    },
  );
  return () => {
    unsub();
    pool.close();
  };
}

/** 게스트: 코드로 청약을 찾아온다. 없으면 timeout까지 대기 후 실패. */
export async function fetchOffer(code: string, timeoutMs = 12_000): Promise<string> {
  const room = await deriveRoom(code);
  const pool = new RelayPool();
  if (!(await pool.anyOpen())) {
    pool.close();
    throw new Error("no relay");
  }
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("not found")), timeoutMs);
      pool.subscribe({ kinds: [KIND], "#d": [`${room.tag}o`] }, (ev) => {
        unseal(room, ev.content)
          .then((sdp) => {
            clearTimeout(timer);
            resolve(sdp);
          })
          .catch(() => {
            /* 복호화 실패 — 계속 대기 */
          });
      });
    });
  } finally {
    pool.close();
  }
}

/** 게스트: 응답을 올린다. */
export async function publishAnswer(code: string, answerSdp: string): Promise<void> {
  const room = await deriveRoom(code);
  const pool = new RelayPool();
  if (!(await pool.anyOpen())) {
    pool.close();
    throw new Error("no relay");
  }
  try {
    const priv = crypto.getRandomValues(new Uint8Array(32));
    const ev = await createEvent(
      KIND,
      [["d", `${room.tag}a`], expiration()],
      await seal(room, answerSdp),
      priv,
    );
    await pool.publish(ev);
  } finally {
    // 발행 직후 닫으면 일부 릴레이에 안 닿을 수 있어 잠깐 유예
    setTimeout(() => pool.close(), 1500);
  }
}
