import { t } from "../i18n";
import { getFrameBitmap } from "./decode";
import { outputSize, renderFrame } from "./transform";
import type { RenderPlan } from "./encode";

export interface PngFrame {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** 모든 프레임을 변형 적용된 PNG 바이트로 추출한다. */
export async function extractPngFrames(
  plan: RenderPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<PngFrame[]> {
  const { frames, sources, transform, baseW, baseH, signal } = plan;
  const { w, h } = outputSize(baseW, baseH, transform);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t.errors.canvasFail);

  const pad = Math.max(2, String(frames.length).length);
  const out: PngFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    signal?.throwIfAborted();
    const frame = frames[i];
    const source = sources.get(frame.sourceId);
    if (!source) continue;

    renderFrame(ctx, await getFrameBitmap(source, frame.frameIndex), transform, baseW, baseH);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    out.push({
      name: `frame-${String(i + 1).padStart(pad, "0")}.png`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
    onProgress?.(i + 1, frames.length);
  }
  return out;
}
