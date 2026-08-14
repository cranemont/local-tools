// 시그널링 페이로드 코덱 — SDP를 deflate-raw로 압축해 base64url 한 줄로.
// QR(마일스톤 ②)과 복사·붙여넣기가 같은 코드를 쓴다.
//
// 머리 4바이트는 무결성 헤더다: [버전 1바이트][SHA-256 앞 3바이트].
// deflate-raw에는 체크섬이 없어서(gzip·zlib과 다르다) 한 글자만 어긋난 코드가
// 예외 없이 "다른 SDP"로 풀렸다 — 실측으로 한 글자 오타의 61%가 그랬다. 그러면
// 사용자는 원인을 볼 수 없는 연결 실패만 보게 된다. 검사값이 24비트라 손상된 코드가
// 통과할 확률은 1600만 분의 1이고, 늘어나는 길이는 base64로 여섯 글자다.
//
// 호환은 신경 쓰지 않는다(양쪽이 같은 빌드를 쓴다). 헤더가 없는 옛 코드는 버전
// 바이트에서 걸려 곧바로 예외가 되고, 호출부가 "코드를 해석할 수 없어요"로 받는다.

const VERSION = 1;
const CHECK_BYTES = 3;
const HEADER = 1 + CHECK_BYTES;

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** 압축 전 바이트의 SHA-256 앞 3바이트. */
async function check(plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest("SHA-256", plain);
  return new Uint8Array(digest).slice(0, CHECK_BYTES);
}

export async function encodeSignal(sdp: string): Promise<string> {
  const plain = new TextEncoder().encode(sdp);
  const deflated = await pipe(plain, new CompressionStream("deflate-raw"));
  const framed = new Uint8Array(HEADER + deflated.length);
  framed[0] = VERSION;
  framed.set(await check(plain), 1);
  framed.set(deflated, HEADER);
  let bin = "";
  for (const b of framed) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function decodeSignal(code: string): Promise<string> {
  const b64 = code.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? b64 + "=".repeat(4 - (b64.length % 4)) : b64;
  const framed = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  if (framed.length < HEADER || framed[0] !== VERSION) throw new Error("bad signal");
  const plain = await pipe(framed.slice(HEADER), new DecompressionStream("deflate-raw"));
  const want = framed.slice(1, HEADER);
  const got = await check(plain);
  // 길이가 짧고 비밀이 아니라 상수시간 비교는 필요 없다 — 여기서 막는 것은 오타·잘린 코드다.
  for (let i = 0; i < CHECK_BYTES; i++) if (want[i] !== got[i]) throw new Error("bad signal");
  return new TextDecoder().decode(plain);
}
