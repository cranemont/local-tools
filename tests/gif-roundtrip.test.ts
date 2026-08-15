/** GIF 왕복 — 지은 파일을 되읽고 되그려 구조와 그림을 잰다.
 *
 * `tests/gif-diff.test.ts`가 `gif/diff.ts`의 함수 하나하나를 못 박고 그 머리말에
 * "실제 GIF 바이트가 맞는지는 브라우저에서 확인할 몫"이라고 적어 두었다.
 * 이 파일이 그 절반을 node로 가져온다 — 차분이 만든 인덱스 배열이 gifenc를 지나
 * 파일이 되고, 되읽어 화면에 얹었을 때 앞 프레임 그림이 그대로 남는가까지 잰다.
 *
 * ## 여기서 못 재는 것
 *
 * `encodeGif()`는 못 부른다. 첫 줄이 `new OffscreenCanvas(w, h)`이고 프레임 픽셀은
 * `getFrameBitmap()`(`ImageDecoder`·`createImageBitmap`)에서 온다 — node 24에 셋 다 없다.
 * 그래서 아래 `writeFrames()`가 `encode.ts`의 프레임 루프를 **같은 순서로 옮겨** 놓았고,
 * 캔버스에서 오던 RGBA만 표본 픽셀로 바꿨다. 판정·팔레트·인덱스 구성은 `diff.ts`에서,
 * 딜레이는 `timing.ts`에서 온다.
 *
 * 이 옮겨 놓기가 재지 못하는 것은 **encode.ts가 gifenc에 넘기는 값 자체가 바뀌는 경우**다
 * (예: 차분 프레임의 dispose를 2로 고치는 변경). 그 자리는 브라우저가 있는 층의 몫이고,
 * 여기서는 규약이 지켜졌을 때 파일이 어떤 모양인지를 못 박는다.
 * 옮기지 않은 것: ordered 디더링, 자막·가리기 렌더(캔버스), 진행률·중단.
 */

import { describe, expect, it } from "vitest";

import {
  ALPHA_THRESHOLD,
  MAX_CHANGED_RATIO,
  changedRegion,
  composeDiffIndex,
  cropRgba,
  diffPaletteBudget,
  hasTransparency,
  shouldDiff,
} from "../apps/gif/src/lib/gif/diff";
import { effectiveDelayMs } from "../apps/gif/src/lib/gif/timing";
import {
  GIFEncoder,
  applyPalette,
  decodeGifFrames,
  makeGif,
  quantize,
  readGif,
  type GifEncoderInstance,
} from "./fixtures/gif";
import { makeRgba, mulberry32, type Rgba } from "./fixtures/image";

type FrameOptions = Parameters<GifEncoderInstance["writeFrame"]>[3];

interface WriteOptions {
  /** 프레임별 원본 딜레이(ms). 배속·하한·눈금은 timing.ts가 맡는다. */
  delaysMs: number[];
  speed?: number;
  /** gifenc repeat: -1=1회, 0=무한, n>0=추가 반복. 편집기의 `repeat` 파생값이 이 자리다. */
  repeat?: number;
  maxColors?: number;
  diff?: boolean;
}

/**
 * `apps/gif/src/lib/gif/encode.ts`의 `encodeGif()` 프레임 루프를 옮긴 것.
 * 캔버스에서 `getImageData`로 받던 RGBA가 여기서는 인자로 들어온다.
 */
function writeFrames(pictures: Rgba[], o: WriteOptions): Uint8Array {
  const { speed = 1, repeat = 0, maxColors = 256, diff = true } = o;
  const w = pictures[0].width;
  const h = pictures[0].height;
  const total = w * h;
  const gif = GIFEncoder();
  // 지금 화면에 남아 있는 프레임의 RGBA — 차분의 기준이다.
  let base: Uint8ClampedArray | null = null;

  for (let i = 0; i < pictures.length; i++) {
    const data = pictures[i].data;
    const delay = effectiveDelayMs(o.delaysMs[i], speed, "gif");
    const frameAlpha = hasTransparency(data, ALPHA_THRESHOLD);

    let wrote = false;
    if (diff && base && !frameAlpha) {
      const region = changedRegion(base, data, w, h);
      if (shouldDiff({ maxColors, changed: region?.changed ?? 0, total, hasAlpha: false })) {
        if (region) {
          const crop = cropRgba(data, w, region);
          const palette = quantize(crop, diffPaletteBudget(maxColors));
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
        } else {
          // 한 픽셀도 안 바뀐 프레임 — 1×1 투명 픽셀 하나로 딜레이만 싣는다.
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
        wrote = true;
      }
    }

    if (!wrote) {
      const palette = quantize(data, Math.min(frameAlpha ? 255 : 256, maxColors));
      const index = applyPalette(data, palette);
      const frameOpts: FrameOptions = { palette, delay };
      if (i === 0) frameOpts.repeat = repeat;
      if (frameAlpha) {
        const transparentIndex = palette.length;
        palette.push([0, 0, 0]);
        for (let p = 3, px = 0; p < data.length; p += 4, px++) {
          if (data[p] < ALPHA_THRESHOLD) index[px] = transparentIndex;
        }
        frameOpts.transparent = true;
        frameOpts.transparentIndex = transparentIndex;
        frameOpts.dispose = 2;
      } else if (diff) {
        frameOpts.dispose = 1;
      }
      gif.writeFrame(index, w, h, frameOpts);
    }

    base = diff && !frameAlpha ? data : null;
  }

  gif.finish();
  return gif.bytes();
}

// ── 표본 픽셀 ────────────────────────────────────────────────────

/** 바뀌는 자리. 프레임 크기(64×48)의 15.6%라 MAX_CHANGED_RATIO에 안 걸린다. */
const RECT = { x: 8, y: 6, w: 24, h: 20 };

function copy(image: Rgba): Rgba {
  return {
    width: image.width,
    height: image.height,
    data: Uint8ClampedArray.from(image.data),
  };
}

/** 사각형 안을 난수 색으로 다시 칠한다 — 색이 여럿이라 팔레트 예산이 걸린다. */
function repaint(image: Rgba, rect: typeof RECT, seed: number): void {
  const rand = mulberry32(seed);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = Math.floor(rand() * 256);
      image.data[i + 1] = Math.floor(rand() * 256);
      image.data[i + 2] = Math.floor(rand() * 256);
    }
  }
}

/** 사각형 하나만 다른 두 장. */
function pair(): Rgba[] {
  const first = makeRgba({ seed: 5 });
  const second = copy(first);
  repaint(second, RECT, 99);
  return [first, second];
}

/**
 * 위에서부터 `rows`줄을 다시 칠한 두 장 — 바뀐 넓이를 자릿수까지 정해 놓는다.
 * 64×48이라 한 줄이 정확히 1/48(2.083%)이고, 난수 색이라 그 줄은 남김없이 달라진다.
 */
function bandPair(rows: number): Rgba[] {
  const first = makeRgba({ seed: 5 });
  const second = copy(first);
  repaint(second, { x: 0, y: 0, w: first.width, h: rows }, 99);
  return [first, second];
}

/** 두 장 사이에서 바뀐 픽셀의 비율. */
function changedRatio(pics: Rgba[]): number {
  const region = changedRegion(pics[0].data, pics[1].data, pics[0].width, pics[0].height);
  return (region?.changed ?? 0) / (pics[0].width * pics[0].height);
}

/** 픽셀이 뜻을 갖지 않는 단언(딜레이·반복)용 작은 두 장 — quantize 비용을 16배 줄인다. */
function tinyPair(): Rgba[] {
  const first = makeRgba({ width: 16, height: 12, seed: 5 });
  const second = copy(first);
  repaint(second, { x: 2, y: 2, w: 6, h: 4 }, 99);
  return [first, second];
}

function inRect(index: number, width: number): boolean {
  const pixel = Math.floor(index / 4);
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  return (
    x >= RECT.x && x < RECT.x + RECT.w && y >= RECT.y && y < RECT.y + RECT.h
  );
}

/** 두 그림의 최대 채널 차이. 0이면 바이트가 같다. */
function worstDiff(a: Rgba, b: Rgba, only?: (i: number) => boolean): number {
  let worst = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (only && !only(i)) continue;
    worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]));
  }
  return worst;
}

/** 두 가지 색만 쓴 그림 — 양자화가 손대지 않으므로 왕복이 바이트 단위로 같다. */
function twoTone(seed: number): Rgba {
  const width = 8;
  const height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lit = (x + y + seed) % 3 === 0;
      data[i] = lit ? 240 : 10;
      data[i + 1] = lit ? 200 : 20;
      data[i + 2] = lit ? 100 : 30;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const DELAY = (n: number, ms = 100): number[] => Array.from({ length: n }, () => ms);

describe("복원기부터 못 박는다 — 아래 단언이 이것을 딛고 선다", () => {
  it("두 가지 색만 쓴 그림은 픽셀이 바이트 그대로 돌아온다", () => {
    const image = twoTone(0);
    const [back] = decodeGifFrames(makeGif([{ image }]));
    expect(Array.from(back.data)).toEqual(Array.from(image.data));
  });

  it("프레임마다 화면 전체를 돌려준다 — 얹은 뒤의 그림이다", () => {
    const a = twoTone(0);
    const b = twoTone(1);
    const back = decodeGifFrames(makeGif([{ image: a }, { image: b }]));
    expect(back).toHaveLength(2);
    expect(Array.from(back[0].data)).toEqual(Array.from(a.data));
    expect(Array.from(back[1].data)).toEqual(Array.from(b.data));
  });
});

describe("딜레이는 timing.ts가 셈한 값 그대로 파일에 실린다", () => {
  function delaysIn(bytes: Uint8Array): number[] {
    return readGif(bytes).frames.map((f) => f.delayMs);
  }

  it("눈금 위의 값은 그대로 실린다", () => {
    expect(delaysIn(writeFrames(tinyPair(), { delaysMs: [40, 40] }))).toEqual([40, 40]);
  });

  it("25ms는 10ms 눈금에서 30ms로 올라간다", () => {
    expect(delaysIn(writeFrames(tinyPair(), { delaysMs: [25, 25] }))).toEqual([30, 30]);
  });

  it("하한 아래 5ms는 20ms로 실린다 — 파일의 눈금이 1/100초라 그 밑은 담을 칸이 없다", () => {
    expect(delaysIn(writeFrames(tinyPair(), { delaysMs: [5, 5] }))).toEqual([20, 20]);
    // timing.ts를 안 거치면 5ms는 1칸, 4ms는 0칸으로 적힌다 — 둘 다 브라우저가 100ms로 되돌린다.
    expect(delaysIn(makeGif([{ delayMs: 5 }, { delayMs: 4 }]))).toEqual([10, 0]);
  });

  it("배속은 파일에 실리는 값을 바꾼다 — 파일에는 배속이라는 칸이 없다", () => {
    expect(delaysIn(writeFrames(tinyPair(), { delaysMs: [100, 100], speed: 2 }))).toEqual([50, 50]);
    expect(delaysIn(writeFrames(tinyPair(), { delaysMs: [100, 100], speed: 0.5 }))).toEqual([200, 200]);
  });

  it("배속 때문에 하한 아래로 내려간 프레임도 20ms로 실린다", () => {
    expect(delaysIn(writeFrames(tinyPair(), { delaysMs: [40, 40], speed: 4 }))).toEqual([20, 20]);
  });

  it("프레임마다 다른 딜레이가 제 자리에 실린다", () => {
    const pics = [...tinyPair(), copy(tinyPair()[0])];
    expect(delaysIn(writeFrames(pics, { delaysMs: [30, 120, 1000] }))).toEqual([30, 120, 1000]);
  });

  it("어떤 입력이든 파일에서 되읽은 값이 effectiveDelayMs와 같다", () => {
    const inputs = [0, 1, 5, 19, 20, 24, 25, 33, 100, 104, 105, 9999];
    for (const ms of inputs) {
      const [first] = delaysIn(writeFrames(tinyPair(), { delaysMs: [ms, ms] }));
      expect(first).toBe(effectiveDelayMs(ms, 1, "gif"));
    }
  });
});

describe("반복 횟수는 첫 프레임의 NETSCAPE 확장이 된다", () => {
  // 여기 들어오는 값은 편집기의 `repeat` 파생값이다(tests/gif-editor.test.ts에서 못 박는다).
  it("무한 재생(0)은 loop 0으로 적힌다", () => {
    expect(readGif(writeFrames(tinyPair(), { delaysMs: DELAY(2), repeat: 0 })).loop).toBe(0);
  });

  it("3회 재생은 추가 반복 2로 적힌다", () => {
    expect(readGif(writeFrames(tinyPair(), { delaysMs: DELAY(2), repeat: 2 })).loop).toBe(2);
  });

  it("1회 재생(-1)이면 확장 자체가 없다 — 0을 적으면 무한이 된다", () => {
    expect(readGif(writeFrames(tinyPair(), { delaysMs: DELAY(2), repeat: -1 })).loop).toBeNull();
  });
});

describe("프레임 차분 (CLAUDE.md 34번)", () => {
  it("차분을 켜면 파일이 작아진다", () => {
    const pics = pair();
    const on = writeFrames(pics, { delaysMs: DELAY(2), diff: true });
    const off = writeFrames(pics, { delaysMs: DELAY(2), diff: false });
    expect(on.length).toBeLessThan(off.length);
  });

  it("첫 프레임은 차분이 아니다 — 기준이 될 화면이 없다", () => {
    const frame = readGif(writeFrames(pair(), { delaysMs: DELAY(2) })).frames[0];
    expect(frame.transparent).toBe(false);
    expect(frame.localPalette).toBe(false); // 전역 색표를 쓴다
    expect([frame.width, frame.height]).toEqual([64, 48]);
  });

  it("차분 프레임의 disposal은 '이전 화면 유지'(1)다 — 2면 비워 둔 자리가 지워져 깜빡인다", () => {
    const frames = readGif(writeFrames(pair(), { delaysMs: DELAY(2) })).frames;
    expect(frames.map((f) => f.dispose)).toEqual([1, 1]);
  });

  it("차분 프레임에 투명 플래그가 서고 투명 인덱스는 팔레트 마지막 칸이다", () => {
    const frame = readGif(writeFrames(pair(), { delaysMs: DELAY(2) })).frames[1];
    expect(frame.transparent).toBe(true);
    // 예산 255색 + 투명 한 칸 → 마지막 칸이 255다.
    expect(frame.transparentIndex).toBe(diffPaletteBudget(256));
  });

  it("안 바뀐 자리는 앞 프레임 픽셀이 바이트 그대로 남는다", () => {
    const pics = decodeGifFrames(writeFrames(pair(), { delaysMs: DELAY(2) }));
    expect(worstDiff(pics[0], pics[1], (i) => !inRect(i, 64))).toBe(0);
  });

  it("바뀐 사각형 안은 새 프레임 그림으로 덮인다", () => {
    const source = pair();
    const on = decodeGifFrames(writeFrames(source, { delaysMs: DELAY(2), diff: true }));
    const off = decodeGifFrames(writeFrames(source, { delaysMs: DELAY(2), diff: false }));
    const onError = worstDiff(on[1], source[1], (i) => inRect(i, 64));
    const offError = worstDiff(off[1], source[1], (i) => inRect(i, 64));
    // 차분을 켠 쪽이 원본에서 더 멀어지지 않는다 — 사각형만 따로 양자화하므로 오히려 가깝다.
    expect(onError).toBeLessThanOrEqual(offError);
    expect(onError).toBeLessThan(64); // 256색 양자화 오차 안
  });

  it("차분을 켠 파일과 끈 파일이 같은 그림을 낸다", () => {
    const source = pair();
    const on = decodeGifFrames(writeFrames(source, { delaysMs: DELAY(2), diff: true }));
    const off = decodeGifFrames(writeFrames(source, { delaysMs: DELAY(2), diff: false }));
    expect(on).toHaveLength(off.length);
    // 팔레트를 따로 뽑으므로 바이트까지 같지는 않다. 두 파일이 원본에서 벌어진 만큼을 잰다.
    expect(worstDiff(on[1], off[1])).toBeLessThan(64);
  });

  it("앞 프레임과 한 픽셀도 안 다르면 1×1 프레임 하나로 딜레이만 싣는다", () => {
    const first = makeRgba({ seed: 7 });
    const bytes = writeFrames([first, copy(first)], { delaysMs: [100, 250] });
    const info = readGif(bytes);
    expect([info.frames[1].width, info.frames[1].height]).toEqual([1, 1]);
    expect(info.frames[1].delayMs).toBe(250);
    expect(info.frames[1].transparent).toBe(true);
    expect(info.frames[1].dispose).toBe(1);
    // 화면은 그대로다 — 1×1 투명 픽셀은 아무것도 안 덮는다.
    const pics = decodeGifFrames(bytes);
    expect(worstDiff(pics[0], pics[1])).toBe(0);
  });

  it("원본에 알파가 있으면 차분을 건너뛴다 — disposal이 부딪힌다", () => {
    const [first] = pair();
    const second = copy(first);
    for (let i = 3; i < 4 * 200; i += 4) second.data[i] = 0; // 앞 200픽셀을 투명으로
    const info = readGif(writeFrames([first, second], { delaysMs: DELAY(2) }));
    // 전체 프레임이고, 투명을 담느라 disposal은 2(배경으로 되돌리기)다.
    expect([info.frames[1].width, info.frames[1].height]).toEqual([64, 48]);
    expect(info.frames[1].dispose).toBe(2);
    expect(info.frames[1].transparent).toBe(true);
  });

  it("알파 프레임의 투명한 자리는 앞 프레임이 비쳐 보인다 — disposal 1로 남긴 화면이다", () => {
    const [first] = pair();
    const second = copy(first);
    for (let i = 3; i < 4 * 200; i += 4) second.data[i] = 0;
    const pics = decodeGifFrames(writeFrames([first, second], { delaysMs: DELAY(2) }));
    // 앞 200픽셀(투명)은 첫 프레임 그림이 그대로 남는다.
    expect(worstDiff(pics[0], pics[1], (i) => i < 4 * 200)).toBe(0);
  });

  it("색 수가 하한(16) 아래면 차분을 안 쓴다 — 투명 한 칸의 비중이 커진다", () => {
    const info = readGif(writeFrames(pair(), { delaysMs: DELAY(2), maxColors: 8 }));
    expect(info.frames[1].transparent).toBe(false);
    expect([info.frames[1].width, info.frames[1].height]).toEqual([64, 48]);
    expect(info.globalPaletteSize).toBe(8);
  });

  it("바뀐 넓이가 90%를 넘으면 차분을 안 쓴다", () => {
    const first = makeRgba({ seed: 5 });
    const second = makeRgba({ seed: 6 });
    const region = changedRegion(first.data, second.data, first.width, first.height);
    expect(region?.changed ?? 0).toBeGreaterThan(first.width * first.height * MAX_CHANGED_RATIO);

    const info = readGif(writeFrames([first, second], { delaysMs: DELAY(2) }));
    expect(info.frames[1].transparent).toBe(false);
  });

  it("문턱은 90%다 — 85.4%는 차분을 쓰고 93.8%는 안 쓴다", () => {
    // 위 단언은 두 장이 온통 다른 경우라 MAX_CHANGED_RATIO가 0.99여도 통과한다.
    // 여기서는 문턱 양옆을 밟아 그 값 자체를 가둔다. 상수를 단언에 쓰지 않는다 —
    // 쓰면 상수를 고칠 때 테스트도 같이 따라가 아무것도 안 지킨다.
    const under = bandPair(41);
    expect(changedRatio(under)).toBeCloseTo(0.8542, 4);
    expect(readGif(writeFrames(under, { delaysMs: DELAY(2) })).frames[1].transparent).toBe(true);

    const over = bandPair(45);
    expect(changedRatio(over)).toBeCloseTo(0.9375, 4);
    expect(readGif(writeFrames(over, { delaysMs: DELAY(2) })).frames[1].transparent).toBe(false);
  });

  it("팔레트가 고른 색 수를 안 넘는다 — 색표가 다음 2의 거듭제곱으로 커지지 않는다", () => {
    for (const maxColors of [256, 128, 32]) {
      const info = readGif(writeFrames(pair(), { delaysMs: DELAY(2), maxColors }));
      expect(info.globalPaletteSize).toBeLessThanOrEqual(maxColors);
      // 차분 프레임은 지역 색표를 쓴다: 예산 + 투명 한 칸이 딱 들어가야 한다.
      expect(info.frames[1].localPalette).toBe(true);
      expect(info.frames[1].localPaletteSize).toBeLessThanOrEqual(maxColors);
      expect(info.frames[1].transparentIndex).toBe(diffPaletteBudget(maxColors));
    }
  });

  it("차분 판정이 떨어진 프레임에도 disposal 1을 적는다 — 다음 프레임이 차분일 수 있다", () => {
    // 색 수 8이라 차분 판정은 떨어지지만, 옵션이 켜져 있으면 화면을 남긴다.
    const info = readGif(writeFrames(pair(), { delaysMs: DELAY(2), maxColors: 8 }));
    expect(info.frames.map((f) => f.dispose)).toEqual([1, 1]);
    // 옵션 자체를 끄면 disposal을 안 적는다(0 = 지정 안 함).
    const off = readGif(writeFrames(pair(), { delaysMs: DELAY(2), diff: false }));
    expect(off.frames.map((f) => f.dispose)).toEqual([0, 0]);
  });
});
