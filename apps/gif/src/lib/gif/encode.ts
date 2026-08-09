import { GIFEncoder, quantize, applyPalette, type WriteFrameOptions } from "gifenc";
import { t } from "../i18n";
import { getFrameBitmap } from "./decode";
import { outputSize, renderFrame } from "./transform";
import type { Frame, FrameSource, Transform } from "./types";

/** 인코딩·추출이 공유하는 렌더 입력. */
export interface RenderPlan {
  frames: Frame[];
  sources: Map<string, FrameSource>;
  transform: Transform;
  baseW: number;
  baseH: number;
}

export interface EncodeOptions extends RenderPlan {
  /** 배속 — 프레임 딜레이를 나눈다. */
  speed: number;
  /** gifenc repeat: -1=1회 재생, 0=무한, n>0=추가 반복 횟수. */
  repeat: number;
  onProgress?: (done: number, total: number) => void;
}

const ALPHA_THRESHOLD = 128;
/** 브라우저가 20ms 미만 딜레이를 100ms로 되돌리므로 최솟값 20ms 강제. */
const MIN_DELAY_MS = 20;

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 프레임 목록을 GIF로 인코딩한다. 팔레트는 프레임별 256색(투명 시 255+1). */
export async function encodeGif(opts: EncodeOptions): Promise<Blob> {
  const { frames, sources, transform, baseW, baseH, speed, repeat, onProgress } = opts;
  const { w, h } = outputSize(baseW, baseH, transform);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(t.errors.canvasFail);

  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const source = sources.get(frame.sourceId);
    if (!source) continue;

    renderFrame(ctx, await getFrameBitmap(source, frame.frameIndex), transform, baseW, baseH);
    const { data } = ctx.getImageData(0, 0, w, h);

    let hasAlpha = false;
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] < ALPHA_THRESHOLD) {
        hasAlpha = true;
        break;
      }
    }

    const palette = quantize(data, hasAlpha ? 255 : 256);
    const index = applyPalette(data, palette);
    const frameOpts: WriteFrameOptions = {
      palette,
      delay: Math.max(MIN_DELAY_MS, Math.round(frame.delayMs / speed)),
    };
    if (i === 0) frameOpts.repeat = repeat;
    if (hasAlpha) {
      // 투명 전용 팔레트 엔트리를 추가하고, 투명 픽셀의 인덱스를 거기로 강제.
      const transparentIndex = palette.length;
      palette.push([0, 0, 0]);
      for (let p = 3, px = 0; p < data.length; p += 4, px++) {
        if (data[p] < ALPHA_THRESHOLD) index[px] = transparentIndex;
      }
      frameOpts.transparent = true;
      frameOpts.transparentIndex = transparentIndex;
      frameOpts.dispose = 2;
    }

    gif.writeFrame(index, w, h, frameOpts);
    onProgress?.(i + 1, frames.length);
    await nextTick(); // 진행률 표시를 위해 UI에 양보
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}
