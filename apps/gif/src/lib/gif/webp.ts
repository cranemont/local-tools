// 애니메이션 WebP 인코더 — wasm 없이 완전 오프라인.
// 크로미엄 네이티브 캔버스 WebP 인코딩(convertToBlob)으로 프레임별 정지 WebP를 만들고,
// 순수 TS로 RIFF 컨테이너(VP8X + ANIM + ANMF)를 조립한다.
import { t } from "../i18n";
import { getFrameBitmap } from "./decode";
import { effectiveDelayMs } from "./timing";
import { outputSize, renderFrame } from "./transform";
import type { RenderPlan } from "./plan";

export interface WebpEncodeOptions extends RenderPlan {
  /** 배속 — 프레임 딜레이를 나눈다. */
  speed: number;
  /** ANIM loop: 0=무한, n>0=재생 횟수. */
  loop: number;
  /** 손실 압축 품질 1~100. */
  quality: number;
  onProgress?: (done: number, total: number) => void;
}

export async function encodeWebp(opts: WebpEncodeOptions): Promise<Blob> {
  const {
    frames,
    sources,
    transform,
    overlays,
    baseW,
    baseH,
    speed,
    loop,
    quality,
    signal,
    onProgress,
  } = opts;
  const { w, h } = outputSize(baseW, baseH, transform);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t.errors.canvasFail);

  const encoded: { data: Uint8Array; durationMs: number; hasAlpha: boolean }[] = [];
  for (let i = 0; i < frames.length; i++) {
    signal?.throwIfAborted();
    const frame = frames[i];
    const source = sources.get(frame.sourceId);
    if (!source) continue;

    renderFrame(ctx, await getFrameBitmap(source, frame.frameIndex), transform, baseW, baseH, {
      overlays,
      index: i,
      selected: frame.selected,
    });
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: quality / 100 });
    const still = extractFrameData(new Uint8Array(await blob.arrayBuffer()));
    encoded.push({
      ...still,
      durationMs: effectiveDelayMs(frame.delayMs, speed, "webp"),
    });
    onProgress?.(i + 1, frames.length);
  }
  if (!encoded.length) throw new Error(t.errors.canvasFail);

  // ── 컨테이너 조립: RIFF(WEBP) → VP8X → ANIM → ANMF* ──
  const anyAlpha = encoded.some((f) => f.hasAlpha);

  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | (anyAlpha ? 0x10 : 0); // Animation (+ Alpha)
  u24le(vp8x, 4, w - 1);
  u24le(vp8x, 7, h - 1);

  const anim = new Uint8Array(6); // 배경색 BGRA(투명) + loop u16
  anim[4] = loop & 0xff;
  anim[5] = (loop >> 8) & 0xff;

  const parts: Uint8Array[] = [chunk("VP8X", vp8x), chunk("ANIM", anim)];
  for (const f of encoded) {
    const header = new Uint8Array(16);
    // frame x/2, y/2 = 0
    u24le(header, 6, w - 1);
    u24le(header, 9, h - 1);
    u24le(header, 12, f.durationMs);
    header[15] = 0x02; // 블렌딩 안 함 + 이전 프레임 유지(전체 프레임을 매번 씀)
    parts.push(chunk("ANMF", concat([header, f.data])));
  }

  const body = concat(parts);
  const file = new Uint8Array(12 + body.length);
  file.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  u32le(file, 4, 4 + body.length);
  file.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  file.set(body, 12);
  return new Blob([file], { type: "image/webp" });
}

/**
 * 정지 WebP 파일에서 ANMF에 넣을 프레임 데이터(청크 헤더 포함)를 뽑는다.
 * 단순 형식이면 VP8/VP8L 청크 하나, VP8X 확장 형식이면 ALPH + 비트스트림 청크.
 */
function extractFrameData(webp: Uint8Array): { data: Uint8Array; hasAlpha: boolean } {
  if (webp.length < 20 || readFourCC(webp, 0) !== "RIFF" || readFourCC(webp, 8) !== "WEBP") {
    throw new Error(t.errors.canvasFail);
  }

  const picks: Uint8Array[] = [];
  let hasAlpha = false;
  let pos = 12;
  while (pos + 8 <= webp.length) {
    const fourcc = readFourCC(webp, pos);
    const size = u32leAt(webp, pos + 4);
    const total = 8 + size + (size & 1);
    if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "ALPH") {
      picks.push(webp.subarray(pos, pos + total));
      if (fourcc === "ALPH" || fourcc === "VP8L") hasAlpha = true;
    }
    // VP8X 자체는 건너뛴다(플래그는 새로 만든다). ICCP/EXIF 등도 무시.
    pos += total;
  }
  if (!picks.length) throw new Error(t.errors.canvasFail);
  return { data: concat(picks), hasAlpha };
}

// ── RIFF 헬퍼 ────────────────────────────────────────
function chunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1));
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  u32le(out, 4, payload.length);
  out.set(payload, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function readFourCC(buf: Uint8Array, pos: number): string {
  return String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
}

function u32leAt(buf: Uint8Array, pos: number): number {
  return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
}

function u32le(buf: Uint8Array, pos: number, v: number): void {
  buf[pos] = v & 0xff;
  buf[pos + 1] = (v >> 8) & 0xff;
  buf[pos + 2] = (v >> 16) & 0xff;
  buf[pos + 3] = (v >> 24) & 0xff;
}

function u24le(buf: Uint8Array, pos: number, v: number): void {
  buf[pos] = v & 0xff;
  buf[pos + 1] = (v >> 8) & 0xff;
  buf[pos + 2] = (v >> 16) & 0xff;
}
