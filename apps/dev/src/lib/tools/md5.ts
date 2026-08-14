// RFC 1321 MD5 — Web Crypto가 지원하지 않아 직접 구현 (체크섬 용도).

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);

/**
 * 패딩까지 포함한 전체 길이 — 메시지 뒤에 0x80 한 바이트와 길이 8바이트가 들어가는
 * 가장 작은 64의 배수(RFC 1321 §3.1–3.2).
 *
 * 예전엔 `(((len + 8) >> 6) + 1) << 6`이었다. 시프트는 32비트 연산이라 결과가 2^31에
 * 닿는 순간 부호가 뒤집힌다 — len ≥ 2147483576(2GiB - 72)에서 음수가 나오고
 * `new Uint8Array(음수)`가 RangeError를 던졌다. 해시 도구는 파일을 통째로
 * `arrayBuffer()`로 읽으므로 2GiB짜리 파일에서 실제로 닿는 자리다.
 */
export function md5PaddedLength(len: number): number {
  return Math.ceil((len + 9) / 64) * 64;
}

/**
 * 메시지 길이(바이트)를 64비트 리틀엔디언 비트 길이의 두 워드로 나눈다.
 * 2^29바이트(512MiB)부터는 비트 수가 2^32를 넘어 상위 워드가 필요하다.
 * `len % 2**29`로 먼저 줄여 두 워드 모두 정확한 정수로 나오게 한다.
 */
export function md5LengthWords(len: number): [lo: number, hi: number] {
  return [(len % 2 ** 29) * 8, Math.floor(len / 2 ** 29)];
}

export function md5Hex(bytes: Uint8Array): string {
  const len = bytes.length;
  const padded = new Uint8Array(md5PaddedLength(len));
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const [bitLo, bitHi] = md5LengthWords(len);
  dv.setUint32(padded.length - 8, bitLo, true);
  dv.setUint32(padded.length - 4, bitHi, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < padded.length; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0 >>> 0, true);
  ov.setUint32(4, b0 >>> 0, true);
  ov.setUint32(8, c0 >>> 0, true);
  ov.setUint32(12, d0 >>> 0, true);
  return bytesToHex(out);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
