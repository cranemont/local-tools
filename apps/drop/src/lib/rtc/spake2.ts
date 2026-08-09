// SPAKE2 (RFC 9382) — P256-SHA256-HKDF-HMAC 스위트.
// 6자리 코드처럼 약한 비밀로도 오프라인 대입이 불가능한 공유 키를 만든다:
// 대화 기록만으로는 코드 추측을 검증할 수 없고, 공격자는 세션당 한 번만 온라인 시도 가능.
// 프리미티브는 전부 검증된 것(@noble/curves 곡선 연산, WebCrypto 해시·HMAC·HKDF)만 쓰고,
// 이 파일은 RFC의 조립 순서를 그대로 옮긴다. RFC Appendix B 테스트 벡터로 검증됨.

import { p256 } from "@noble/curves/nist.js";

const Point = p256.Point;
const ORDER = Point.Fn.ORDER;

// RFC 9382 §6 — P-256용 고정 생성점 M·N ("nothing up my sleeve" 시드에서 유도된 값)
const M = Point.fromHex("02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f");
const N = Point.fromHex("03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49");

const te = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** RFC의 len() — 8바이트 리틀엔디언 길이 접두사 */
function len(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return out;
}

const withLen = (b: Uint8Array) => concat(len(b.length), b);

function bytesToBig(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

/** w를 곡선 위수 길이(32바이트) 빅엔디언으로 — TT 인코딩 규칙 */
function bigTo32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** 코드 → 스칼라 w. 48바이트를 뽑아 mod n — 편향이 2^-128 수준으로 사라진다. */
export async function deriveW(code: string, namespace: string): Promise<bigint> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(`${namespace}:${code}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: te.encode(`${namespace}:spake2-w`), iterations: 210_000, hash: "SHA-256" },
    key,
    48 * 8,
  );
  return bytesToBig(new Uint8Array(bits)) % ORDER;
}

function randomScalar(): bigint {
  return bytesToBig(p256.utils.randomSecretKey());
}

async function hmac(keyBytes: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

export interface Schedule {
  /** 프로토콜 산출 공유 비밀 (16B) — 이걸로 전송 키를 파생한다 */
  ke: Uint8Array<ArrayBuffer>;
  confA: Uint8Array;
  confB: Uint8Array;
}

/** RFC §3.3 TT 조립 + §4 키 스케줄. 테스트 벡터가 이 함수를 직접 검증한다. */
export async function schedule(
  idA: string,
  idB: string,
  pA: Uint8Array,
  pB: Uint8Array,
  K: Uint8Array,
  w: bigint,
): Promise<Schedule> {
  const TT = concat(
    withLen(te.encode(idA)),
    withLen(te.encode(idB)),
    withLen(pA),
    withLen(pB),
    withLen(K),
    withLen(bigTo32(w)),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", TT));
  const ke = digest.slice(0, 16);
  const ka = digest.slice(16);
  const hkdfKey = await crypto.subtle.importKey("raw", ka, "HKDF", false, ["deriveBits"]);
  const kc = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("ConfirmationKeys") },
      hkdfKey,
      256,
    ),
  );
  return {
    ke,
    confA: await hmac(kc.slice(0, 16), TT),
    confB: await hmac(kc.slice(16), TT),
  };
}

/** pA = w*M + x*G */
export function pointA(w: bigint, x: bigint): Uint8Array<ArrayBuffer> {
  return M.multiply(w).add(Point.BASE.multiply(x)).toBytes(false);
}

/** pB = w*N + y*G */
export function pointB(w: bigint, y: bigint): Uint8Array<ArrayBuffer> {
  return N.multiply(w).add(Point.BASE.multiply(y)).toBytes(false);
}

/** A 쪽 K = x*(pB − w*N). 잘못된 점이면 throw. */
export function sharedA(w: bigint, x: bigint, pBBytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const pB = Point.fromBytes(pBBytes);
  return pB.subtract(N.multiply(w)).multiply(x).toBytes(false);
}

/** B 쪽 K = y*(pA − w*M). */
export function sharedB(w: bigint, y: bigint, pABytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const pA = Point.fromBytes(pABytes);
  return pA.subtract(M.multiply(w)).multiply(y).toBytes(false);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── 드롭용 고수준 API — 신원은 역할 문자열로 고정 ──

const ID_A = "drop-host";
const ID_B = "drop-guest";

export interface HostSpake {
  msgA: Uint8Array;
  /** msgB(65B pA 형식) || confB(32B)를 받아 검증. 코드 불일치면 null. */
  finish(msgB: Uint8Array): Promise<{ ke: Uint8Array<ArrayBuffer>; confirmA: Uint8Array } | null>;
}

export async function startHostSpake(code: string, namespace: string): Promise<HostSpake> {
  const w = await deriveW(code, namespace);
  const x = randomScalar();
  const pA = pointA(w, x);
  return {
    msgA: pA,
    async finish(msg: Uint8Array) {
      if (msg.length !== 65 + 32) return null;
      const pB = msg.slice(0, 65);
      const confB = msg.slice(65);
      let K: Uint8Array<ArrayBuffer>;
      try {
        K = sharedA(w, x, pB);
      } catch {
        return null; // 곡선 밖의 점 — 무시
      }
      const sched = await schedule(ID_A, ID_B, pA, pB, K, w);
      if (!equal(sched.confB, confB)) return null; // 코드 불일치
      return { ke: sched.ke, confirmA: sched.confA };
    },
  };
}

export interface GuestSpake {
  /** pB || confB — 호스트에게 보낼 것 */
  msgB: Uint8Array<ArrayBuffer>;
  ke: Uint8Array<ArrayBuffer>;
  /** 호스트의 confirmA가 이 값과 일치해야 상대가 같은 코드를 안다는 증명 */
  verifyHost(confA: Uint8Array): boolean;
}

export async function runGuestSpake(
  code: string,
  namespace: string,
  msgA: Uint8Array,
): Promise<GuestSpake> {
  const w = await deriveW(code, namespace);
  const y = randomScalar();
  const pB = pointB(w, y);
  const K = sharedB(w, y, msgA); // 잘못된 msgA면 throw — 호출부가 무시 처리
  const sched = await schedule(ID_A, ID_B, msgA, pB, K, w);
  return {
    msgB: concat(pB, sched.confB),
    ke: sched.ke,
    verifyHost: (confA) => equal(sched.confA, confA),
  };
}
