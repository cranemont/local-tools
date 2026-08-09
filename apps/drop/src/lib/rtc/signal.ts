// 시그널링 페이로드 코덱 — SDP를 deflate-raw로 압축해 base64url 한 줄로.
// QR(마일스톤 ②)과 복사·붙여넣기가 같은 코드를 쓴다.

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSignal(sdp: string): Promise<string> {
  const deflated = await pipe(
    new TextEncoder().encode(sdp),
    new CompressionStream("deflate-raw"),
  );
  let bin = "";
  for (const b of deflated) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function decodeSignal(code: string): Promise<string> {
  const b64 = code.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? b64 + "=".repeat(4 - (b64.length % 4)) : b64;
  const bytes = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw")));
}
