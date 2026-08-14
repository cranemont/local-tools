import { GIFEncoder, quantize, applyPalette, type WriteFrameOptions } from "gifenc";
import { t } from "../i18n";
import { getFrameBitmap } from "./decode";
import { effectiveDelayMs } from "./timing";
import { outputSize, renderFrame } from "./transform";
import type { TextOverlay } from "./overlay";
import type { Frame, FrameSource, Transform } from "./types";

/** 인코딩·추출이 공유하는 렌더 입력. */
export interface RenderPlan {
  frames: Frame[];
  sources: Map<string, FrameSource>;
  transform: Transform;
  /** 프레임 위에 얹을 텍스트 — 어느 프레임에 붙는지는 renderFrame이 고른다. */
  overlays: readonly TextOverlay[];
  baseW: number;
  baseH: number;
  /** 중단 신호 — 네 인코더가 프레임 루프 머리에서 함께 확인한다. */
  signal?: AbortSignal;
}

/** 사용자가 취소한 경우인가 (에러 배너 대신 조용히 넘길 것). */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export interface EncodeOptions extends RenderPlan {
  /** 배속 — 프레임 딜레이를 나눈다. */
  speed: number;
  /** gifenc repeat: -1=1회 재생, 0=무한, n>0=추가 반복 횟수. */
  repeat: number;
  /** 팔레트 최대 색상 수 (2~256). */
  maxColors: number;
  /** ordered 디더링(Bayer 4×4) — 그라데이션 밴딩 완화, 용량은 커짐. */
  dither: boolean;
  onProgress?: (done: number, total: number) => void;
}

const ALPHA_THRESHOLD = 128;

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** 팔레트 매핑 전에 Bayer 4×4 임곗값 노이즈를 더하는 ordered 디더링. */
function orderedDither(data: Uint8ClampedArray, width: number, amount: number): void {
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const x = px % width;
    const y = (px / width) | 0;
    const noise = ((BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5) * amount;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
}

/** 프레임 목록을 GIF로 인코딩한다. 팔레트는 프레임별 최대 maxColors색(투명 시 한 칸 예약). */
export async function encodeGif(opts: EncodeOptions): Promise<Blob> {
  const {
    frames,
    sources,
    transform,
    overlays,
    baseW,
    baseH,
    speed,
    repeat,
    maxColors,
    dither,
    signal,
    onProgress,
  } = opts;
  const { w, h } = outputSize(baseW, baseH, transform);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(t.errors.canvasFail);

  const gif = GIFEncoder();
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
    const { data } = ctx.getImageData(0, 0, w, h);

    let hasAlpha = false;
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] < ALPHA_THRESHOLD) {
        hasAlpha = true;
        break;
      }
    }

    // 팔레트는 원본에서 뽑고, 매핑은 디더링된 사본으로 한다.
    const palette = quantize(data, Math.min(hasAlpha ? 255 : 256, maxColors));
    let mapSource: Uint8ClampedArray = data;
    if (dither) {
      mapSource = new Uint8ClampedArray(data);
      orderedDither(mapSource, w, maxColors <= 64 ? 32 : 20);
    }
    const index = applyPalette(mapSource, palette);
    const frameOpts: WriteFrameOptions = {
      palette,
      delay: effectiveDelayMs(frame.delayMs, speed, "gif"),
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
