// MP4 내보내기 — WebCodecs 인코딩 + mediabunny(순수 TS) muxing. wasm 없음.
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
} from "mediabunny";
import { t } from "../i18n";
import { getFrameBitmap } from "./decode";
import { outputSize, renderFrame } from "./transform";
import type { RenderPlan } from "./encode";

/** 화질 프리셋 id와 같은 값 공간 (에디터 상태에 의존하지 않도록 별도 선언). */
export type Mp4Quality = "small" | "balanced" | "high";

export interface Mp4EncodeOptions extends RenderPlan {
  /** 배속 — 프레임 딜레이를 나눈다. */
  speed: number;
  quality: Mp4Quality;
  onProgress?: (done: number, total: number) => void;
}

const QUALITY_MAP = {
  small: QUALITY_LOW,
  balanced: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
} as const;

export async function encodeMp4(opts: Mp4EncodeOptions): Promise<Blob> {
  const { frames, sources, transform, baseW, baseH, speed, quality, onProgress } = opts;
  const { w, h } = outputSize(baseW, baseH, transform);
  // H.264는 짝수 치수만 안전하다 — 렌더 캔버스를 짝수 캔버스로 한 번 더 그린다.
  const evenW = Math.max(2, w - (w % 2));
  const evenH = Math.max(2, h - (h % 2));

  const renderCanvas = new OffscreenCanvas(w, h);
  const renderCtx = renderCanvas.getContext("2d");
  const exportCanvas = new OffscreenCanvas(evenW, evenH);
  const exportCtx = exportCanvas.getContext("2d");
  if (!renderCtx || !exportCtx) throw new Error(t.errors.canvasFail);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(exportCanvas, { codec: "avc", quality: QUALITY_MAP[quality] });
  output.addVideoTrack(source);
  await output.start();

  try {
    let timestampS = 0;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const frameSource = sources.get(frame.sourceId);
      if (!frameSource) continue;

      renderFrame(
        renderCtx,
        await getFrameBitmap(frameSource, frame.frameIndex),
        transform,
        baseW,
        baseH,
      );
      // MP4는 투명을 지원하지 않으므로 흰 배경 위에 얹는다.
      exportCtx.fillStyle = "#fff";
      exportCtx.fillRect(0, 0, evenW, evenH);
      exportCtx.drawImage(renderCanvas, 0, 0, evenW, evenH);

      const durationS = Math.max(0.01, frame.delayMs / speed / 1000);
      await source.add(timestampS, durationS);
      timestampS += durationS;
      onProgress?.(i + 1, frames.length);
    }
    source.close();
    await output.finalize();
  } catch (err) {
    await output.cancel();
    throw err;
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error(t.errors.canvasFail);
  return new Blob([buffer], { type: "video/mp4" });
}
