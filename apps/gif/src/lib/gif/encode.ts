import {
  GIFEncoder,
  quantize,
  applyPalette,
  type GIFEncoderInstance,
  type WriteFrameOptions,
} from "gifenc";
import { t } from "../i18n";
import { getFrameBitmap } from "./decode";
import {
  ALPHA_THRESHOLD,
  changedRegion,
  composeDiffIndex,
  cropRgba,
  diffPaletteBudget,
  hasTransparency,
  shouldDiff,
  type ChangedRegion,
} from "./diff";
import { effectiveDelayMs } from "./timing";
import { outputSize, renderFrame } from "./transform";
import type { RenderPlan } from "./plan";

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
  /** 프레임 차분 — 앞 프레임과 같은 픽셀을 투명 인덱스로 둔다(diff.ts). */
  diff: boolean;
  onProgress?: (done: number, total: number) => void;
}

const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** 팔레트 매핑 전에 Bayer 4×4 임곗값 노이즈를 더하는 ordered 디더링.
 *  x0·y0은 이 배열이 출력 캔버스의 어디에서 잘려 나왔는지 — 차분에서 사각형만 넘길 때
 *  무늬가 출력 좌표에 붙어 있게 한다. 0,0으로 두면 사각형이 움직일 때마다 무늬가 어긋난다. */
function orderedDither(
  data: Uint8ClampedArray,
  width: number,
  amount: number,
  x0 = 0,
  y0 = 0,
): void {
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const x = x0 + (px % width);
    const y = y0 + ((px / width) | 0);
    const noise = ((BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5) * amount;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
}

function ditherAmount(maxColors: number): number {
  return maxColors <= 64 ? 32 : 20;
}

/** 앞 프레임과 한 픽셀도 다르지 않은 프레임 — 1×1 투명 픽셀 하나로 딜레이만 싣는다.
 *  전체 크기를 투명으로 채워도 되지만 그쪽은 LZW를 출력 픽셀 수만큼 돌린다. */
function writeSkipFrame(gif: GIFEncoderInstance, delay: number): void {
  gif.writeFrame(new Uint8Array(1), 1, 1, {
    palette: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    delay,
    transparent: true,
    transparentIndex: 0,
    dispose: 1,
  });
}

/** 바뀐 사각형만 팔레트에 매핑하고, 나머지는 투명 인덱스로 채워 한 프레임을 쓴다. */
function writeDiffFrame(
  gif: GIFEncoderInstance,
  o: {
    base: Uint8ClampedArray;
    data: Uint8ClampedArray;
    w: number;
    h: number;
    region: ChangedRegion;
    maxColors: number;
    dither: boolean;
    delay: number;
  },
): void {
  const { base, data, w, h, region, maxColors, dither, delay } = o;
  const crop = cropRgba(data, w, region);
  // 팔레트는 원본에서 뽑고, 매핑은 디더링한 사본으로 한다(전체 프레임 경로와 같은 순서).
  const palette = quantize(crop, diffPaletteBudget(maxColors));
  if (dither) orderedDither(crop, region.w, ditherAmount(maxColors), region.x, region.y);
  const cropIndex = applyPalette(crop, palette);

  const transparentIndex = palette.length;
  palette.push([0, 0, 0]);
  const index = composeDiffIndex({
    prev: base,
    curr: data,
    width: w,
    height: h,
    rect: region,
    cropIndex,
    transparentIndex,
  });
  gif.writeFrame(index, w, h, {
    palette,
    delay,
    transparent: true,
    transparentIndex,
    dispose: 1,
  });
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
    diff,
    signal,
    onProgress,
  } = opts;
  const { w, h } = outputSize(baseW, baseH, transform);
  const total = w * h;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(t.errors.canvasFail);

  const gif = GIFEncoder();
  // 지금 화면에 남아 있는 프레임의 RGBA — 차분의 기준이다.
  // 알파가 있는 프레임은 disposal 2로 화면을 지우므로 그 뒤엔 기준이 없다(null).
  let base: Uint8ClampedArray | null = null;

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
    const delay = effectiveDelayMs(frame.delayMs, speed, "gif");
    const frameAlpha = hasTransparency(data, ALPHA_THRESHOLD);

    let wrote = false;
    if (diff && base && !frameAlpha) {
      const region = changedRegion(base, data, w, h);
      if (shouldDiff({ maxColors, changed: region?.changed ?? 0, total, hasAlpha: false })) {
        if (region) {
          writeDiffFrame(gif, { base, data, w, h, region, maxColors, dither, delay });
        } else {
          writeSkipFrame(gif, delay);
        }
        wrote = true;
      }
    }

    if (!wrote) {
      // 팔레트는 원본에서 뽑고, 매핑은 디더링된 사본으로 한다.
      const palette = quantize(data, Math.min(frameAlpha ? 255 : 256, maxColors));
      let mapSource: Uint8ClampedArray = data;
      if (dither) {
        mapSource = new Uint8ClampedArray(data);
        orderedDither(mapSource, w, ditherAmount(maxColors));
      }
      const index = applyPalette(mapSource, palette);
      const frameOpts: WriteFrameOptions = { palette, delay };
      if (i === 0) frameOpts.repeat = repeat;
      if (frameAlpha) {
        // 투명 전용 팔레트 엔트리를 추가하고, 투명 픽셀의 인덱스를 거기로 강제.
        const transparentIndex = palette.length;
        palette.push([0, 0, 0]);
        for (let p = 3, px = 0; p < data.length; p += 4, px++) {
          if (data[p] < ALPHA_THRESHOLD) index[px] = transparentIndex;
        }
        frameOpts.transparent = true;
        frameOpts.transparentIndex = transparentIndex;
        frameOpts.dispose = 2;
      } else if (diff) {
        // 다음 프레임이 이 화면 위에 차분을 얹을 수 있게 유지를 명시한다.
        frameOpts.dispose = 1;
      }
      gif.writeFrame(index, w, h, frameOpts);
    }

    base = diff && !frameAlpha ? data : null;
    onProgress?.(i + 1, frames.length);
    await nextTick(); // 진행률 표시를 위해 UI에 양보
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}
