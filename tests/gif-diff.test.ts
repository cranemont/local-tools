import { describe, expect, it } from "vitest";

import {
  ALPHA_THRESHOLD,
  MAX_CHANGED_RATIO,
  MIN_DIFF_COLORS,
  changedRegion,
  composeDiffIndex,
  cropRgba,
  diffPaletteBudget,
  hasTransparency,
  shouldDiff,
} from "../apps/gif/src/lib/gif/diff";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 apps/gif 프레임 차분의 명세다.
// GIF는 프레임마다 화면 전체를 다시 넣을 필요가 없다 — 앞 프레임과 같은 픽셀을 투명
// 인덱스로 두면 LZW가 그 자리를 짧게 만든다. 여기 있는 함수는 캔버스도 gifenc도
// 부르지 않으므로 node에서 잰다. 인코더가 이것들을 어떻게 엮는지는 encode.ts에 있고,
// 실제 GIF 바이트가 맞는지는 브라우저에서 확인할 몫이다.
//
// gifenc 1.0.3은 프레임 위치(x·y)를 못 받는다(encodeImageDescriptor가 0으로 박아 쓴다).
// 그래서 사각형은 잘라 앉히는 좌표가 아니라 ① quantize·applyPalette가 볼 범위와
// ② 판정에 쓰는 바뀐 넓이를 정하는 값이다.
// 기대값은 구현을 베끼지 않고 손으로 센 것이다.
// ─────────────────────────────────────────────────────────────────────────────

/** width×height 크기의 불투명 회색 프레임. */
function frame(width: number, height: number, gray = 10): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = gray;
    px[i + 1] = gray;
    px[i + 2] = gray;
    px[i + 3] = 255;
  }
  return px;
}

/** (x, y) 픽셀을 지정한 RGBA로 칠한다. */
function put(
  px: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const p = (y * width + x) * 4;
  px[p] = rgba[0];
  px[p + 1] = rgba[1];
  px[p + 2] = rgba[2];
  px[p + 3] = rgba[3];
}

describe("changedRegion — 바뀐 영역의 최소 사각형", () => {
  it("두 프레임이 같으면 null을 준다", () => {
    const a = frame(4, 3);
    const b = frame(4, 3);
    expect(changedRegion(a, b, 4, 3)).toBeNull();
  });

  it("한 픽셀만 다르면 그 픽셀 하나짜리 사각형이 나온다", () => {
    const a = frame(4, 3);
    const b = frame(4, 3);
    put(b, 4, 2, 1, [200, 0, 0, 255]);
    expect(changedRegion(a, b, 4, 3)).toEqual({ x: 2, y: 1, w: 1, h: 1, changed: 1 });
  });

  it("네 귀퉁이만 달라도 사각형은 프레임 전체가 된다", () => {
    const a = frame(5, 4);
    const b = frame(5, 4);
    put(b, 5, 0, 0, [1, 1, 1, 255]);
    put(b, 5, 4, 0, [1, 1, 1, 255]);
    put(b, 5, 0, 3, [1, 1, 1, 255]);
    put(b, 5, 4, 3, [1, 1, 1, 255]);
    // 사각형은 5×4로 벌어지지만 바뀐 픽셀은 넷뿐이다 — 판정은 changed를 본다.
    expect(changedRegion(a, b, 5, 4)).toEqual({ x: 0, y: 0, w: 5, h: 4, changed: 4 });
  });

  it("전체가 다르면 사각형이 프레임과 같고 changed가 픽셀 수다", () => {
    const a = frame(4, 3, 10);
    const b = frame(4, 3, 200);
    expect(changedRegion(a, b, 4, 3)).toEqual({ x: 0, y: 0, w: 4, h: 3, changed: 12 });
  });

  it("1×1 프레임도 같으면 null, 다르면 1×1 사각형이다", () => {
    const a = frame(1, 1, 10);
    const same = frame(1, 1, 10);
    const other = frame(1, 1, 11);
    expect(changedRegion(a, same, 1, 1)).toBeNull();
    expect(changedRegion(a, other, 1, 1)).toEqual({ x: 0, y: 0, w: 1, h: 1, changed: 1 });
  });

  it("알파만 달라도 바뀐 것으로 센다", () => {
    const a = frame(2, 2);
    const b = frame(2, 2);
    put(b, 2, 1, 0, [10, 10, 10, 0]);
    expect(changedRegion(a, b, 2, 2)).toEqual({ x: 1, y: 0, w: 1, h: 1, changed: 1 });
  });

  it("입력 두 배열을 고치지 않는다", () => {
    const a = frame(3, 2);
    const b = frame(3, 2);
    put(b, 3, 1, 1, [9, 8, 7, 255]);
    const beforeA = Uint8ClampedArray.from(a);
    const beforeB = Uint8ClampedArray.from(b);
    changedRegion(a, b, 3, 2);
    expect(a).toEqual(beforeA);
    expect(b).toEqual(beforeB);
  });

  it("크기가 0이면 null이다", () => {
    expect(changedRegion(new Uint8ClampedArray(0), new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });

  it("폭·높이가 음수면 null이다", () => {
    const a = frame(2, 2);
    const b = frame(2, 2);
    put(b, 2, 0, 0, [1, 2, 3, 255]);
    expect(changedRegion(a, b, -2, 2)).toBeNull();
    expect(changedRegion(a, b, 2, -2)).toBeNull();
  });

  it("오른쪽·아래 끝 픽셀이 바뀌어도 사각형이 프레임 밖으로 나가지 않는다", () => {
    const a = frame(4, 3);
    const b = frame(4, 3);
    put(b, 4, 3, 2, [7, 7, 7, 255]);
    expect(changedRegion(a, b, 4, 3)).toEqual({ x: 3, y: 2, w: 1, h: 1, changed: 1 });
  });

  it("Uint8Array로 넘겨도 같은 결과다 — getImageData 밖에서도 잰다", () => {
    const a = new Uint8Array(frame(2, 2));
    const b = new Uint8Array(frame(2, 2));
    b[4] = 99; // (1,0)의 R
    expect(changedRegion(a, b, 2, 2)).toEqual({ x: 1, y: 0, w: 1, h: 1, changed: 1 });
  });
});

describe("hasTransparency — 알파 유무", () => {
  it("불투명 프레임은 거짓이다", () => {
    expect(hasTransparency(frame(3, 3))).toBe(false);
  });

  it("알파가 임곗값 아래인 픽셀이 하나만 있어도 참이다", () => {
    const px = frame(3, 3);
    put(px, 3, 2, 2, [0, 0, 0, ALPHA_THRESHOLD - 1]);
    expect(hasTransparency(px)).toBe(true);
  });

  it("임곗값과 같은 알파는 불투명으로 본다", () => {
    const px = frame(3, 3);
    put(px, 3, 0, 0, [0, 0, 0, ALPHA_THRESHOLD]);
    expect(hasTransparency(px)).toBe(false);
  });

  it("빈 배열은 거짓이다", () => {
    expect(hasTransparency(new Uint8ClampedArray(0))).toBe(false);
  });
});

describe("shouldDiff — 차분을 쓸지 판정", () => {
  const base = { maxColors: 256, changed: 10, total: 1000, hasAlpha: false };

  it("알파가 있으면 쓰지 않는다 — disposal이 부딪힌다", () => {
    expect(shouldDiff({ ...base, hasAlpha: true })).toBe(false);
  });

  it("색이 256으로 꽉 차 있어도 쓴다 — 투명 한 칸은 255색을 남긴다", () => {
    expect(shouldDiff({ ...base, maxColors: 256 })).toBe(true);
    expect(diffPaletteBudget(256)).toBe(255);
  });

  it("색 예산이 하한보다 적으면 쓰지 않는다", () => {
    expect(shouldDiff({ ...base, maxColors: MIN_DIFF_COLORS })).toBe(true);
    expect(shouldDiff({ ...base, maxColors: MIN_DIFF_COLORS - 1 })).toBe(false);
    expect(shouldDiff({ ...base, maxColors: 8 })).toBe(false);
  });

  it("바뀐 넓이가 한계 비율을 넘으면 쓰지 않는다", () => {
    const total = 1000;
    expect(shouldDiff({ ...base, total, changed: total * MAX_CHANGED_RATIO })).toBe(true);
    expect(shouldDiff({ ...base, total, changed: total * MAX_CHANGED_RATIO + 1 })).toBe(false);
    expect(shouldDiff({ ...base, total, changed: total })).toBe(false);
  });

  it("한 픽셀도 안 바뀐 프레임은 색 예산만 통과하면 쓴다", () => {
    expect(shouldDiff({ ...base, changed: 0 })).toBe(true);
    expect(shouldDiff({ ...base, changed: 0, maxColors: 8 })).toBe(false);
  });

  it("픽셀이 없으면 쓰지 않는다", () => {
    expect(shouldDiff({ ...base, total: 0, changed: 0 })).toBe(false);
  });

  it("색 수가 NaN이면 쓰지 않는다", () => {
    // `NaN < 16`은 거짓이라 크기 비교만으로는 이 값이 통과한다. 통과하면
    // quantize가 NaN을 받고 던지지 않은 채 32색을 돌려줘 고른 색 수와 어긋난다.
    expect(shouldDiff({ ...base, maxColors: NaN })).toBe(false);
  });

  it("색 수가 음수나 무한대면 쓰지 않는다", () => {
    expect(shouldDiff({ ...base, maxColors: -8 })).toBe(false);
    expect(shouldDiff({ ...base, maxColors: Infinity })).toBe(false);
  });
});

describe("diffPaletteBudget — 투명 한 칸을 뺀 색 수", () => {
  it("사용자가 고른 색 수보다 하나 적다", () => {
    expect(diffPaletteBudget(256)).toBe(255);
    expect(diffPaletteBudget(128)).toBe(127);
    expect(diffPaletteBudget(32)).toBe(31);
  });

  it("2색 아래로는 내려가지 않는다 — quantize가 1 이하를 못 받는다", () => {
    // 하한에 걸리면 투명 한 칸을 더한 팔레트가 3칸이 돼 고른 색 수를 넘는다.
    // shouldDiff가 16 아래를 막으므로 인코더는 여기까지 오지 않는다.
    expect(diffPaletteBudget(2)).toBe(2);
    expect(diffPaletteBudget(1)).toBe(2);
    expect(diffPaletteBudget(0)).toBe(2);
    expect(diffPaletteBudget(-10)).toBe(2);
  });

  it("소수는 내림하고 NaN·무한대는 하한으로 떨어진다", () => {
    expect(diffPaletteBudget(32.9)).toBe(31);
    expect(diffPaletteBudget(NaN)).toBe(2);
    expect(diffPaletteBudget(Infinity)).toBe(2);
  });
});

describe("cropRgba — 사각형만 잘라 낸 사본", () => {
  it("사각형 안의 픽셀을 행 순서대로 옮긴다", () => {
    const px = frame(4, 3, 0);
    put(px, 4, 1, 1, [11, 12, 13, 255]);
    put(px, 4, 2, 1, [21, 22, 23, 255]);
    put(px, 4, 1, 2, [31, 32, 33, 255]);
    put(px, 4, 2, 2, [41, 42, 43, 255]);
    const crop = cropRgba(px, 4, { x: 1, y: 1, w: 2, h: 2 });
    expect(Array.from(crop)).toEqual([
      11, 12, 13, 255, 21, 22, 23, 255, 31, 32, 33, 255, 41, 42, 43, 255,
    ]);
  });

  it("자기 버퍼를 가진 사본이라 quantize·applyPalette에 그대로 넘길 수 있다", () => {
    // gifenc는 new Uint32Array(rgba.buffer)로 버퍼 전체를 본다 — 뷰를 넘기면 범위 밖까지 읽는다.
    const px = frame(4, 3);
    const crop = cropRgba(px, 4, { x: 1, y: 0, w: 2, h: 2 });
    expect(crop.byteOffset).toBe(0);
    expect(crop.buffer.byteLength).toBe(crop.byteLength);
  });

  it("원본을 고치지 않는다", () => {
    const px = frame(4, 3);
    const before = Uint8ClampedArray.from(px);
    cropRgba(px, 4, { x: 0, y: 0, w: 2, h: 2 });
    expect(px).toEqual(before);
  });

  it("오른쪽·아래 끝에 붙은 사각형도 마지막 행이 온전하다", () => {
    const px = frame(3, 3, 0);
    put(px, 3, 2, 1, [1, 2, 3, 255]);
    put(px, 3, 2, 2, [4, 5, 6, 255]);
    const crop = cropRgba(px, 3, { x: 2, y: 1, w: 1, h: 2 });
    expect(Array.from(crop)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it("사각형이 프레임 전체면 바이트가 원본과 같다", () => {
    const px = frame(3, 2, 77);
    put(px, 3, 1, 1, [9, 9, 9, 255]);
    const crop = cropRgba(px, 3, { x: 0, y: 0, w: 3, h: 2 });
    expect(Array.from(crop)).toEqual(Array.from(px));
  });
});

describe("composeDiffIndex — 안 바뀐 자리를 투명 인덱스로 채운 인덱스 배열", () => {
  const width = 4;
  const height = 3;
  const rect = { x: 1, y: 1, w: 2, h: 2 };
  const transparentIndex = 7;

  function fixture() {
    const prev = frame(width, height);
    const curr = frame(width, height);
    // 사각형 안의 네 픽셀 중 둘만 바꾼다.
    put(curr, width, 1, 1, [200, 0, 0, 255]);
    put(curr, width, 2, 2, [0, 200, 0, 255]);
    // 사각형을 팔레트에 매핑한 결과라고 치고, 자리마다 다른 값을 넣는다.
    const cropIndex = new Uint8Array([1, 2, 3, 4]);
    return { prev, curr, cropIndex };
  }

  it("사각형 밖은 모두 투명 인덱스다", () => {
    const { prev, curr, cropIndex } = fixture();
    const out = composeDiffIndex({
      prev,
      curr,
      width,
      height,
      rect,
      cropIndex,
      transparentIndex,
    });
    // 사각형은 (1,1)-(2,2). 그 밖의 자리를 센다.
    const outside = [0, 1, 2, 3, 4, 7, 8, 11];
    for (const px of outside) expect(out[px]).toBe(transparentIndex);
  });

  it("사각형 안에서도 앞 프레임과 같은 픽셀은 투명 인덱스다", () => {
    const { prev, curr, cropIndex } = fixture();
    const out = composeDiffIndex({
      prev,
      curr,
      width,
      height,
      rect,
      cropIndex,
      transparentIndex,
    });
    expect(out[1 * width + 1]).toBe(1); // 바뀜 → cropIndex[0]
    expect(out[1 * width + 2]).toBe(transparentIndex); // 안 바뀜
    expect(out[2 * width + 1]).toBe(transparentIndex); // 안 바뀜
    expect(out[2 * width + 2]).toBe(4); // 바뀜 → cropIndex[3]
  });

  it("길이가 출력 픽셀 수와 같다", () => {
    const { prev, curr, cropIndex } = fixture();
    const out = composeDiffIndex({
      prev,
      curr,
      width,
      height,
      rect,
      cropIndex,
      transparentIndex,
    });
    expect(out.length).toBe(width * height);
  });

  it("투명 표시가 받은 배열을 고치지 않는다 — 원본 색이 남는다", () => {
    const { prev, curr, cropIndex } = fixture();
    const beforePrev = Uint8ClampedArray.from(prev);
    const beforeCurr = Uint8ClampedArray.from(curr);
    const beforeCrop = Uint8Array.from(cropIndex);
    composeDiffIndex({ prev, curr, width, height, rect, cropIndex, transparentIndex });
    expect(prev).toEqual(beforePrev);
    expect(curr).toEqual(beforeCurr);
    expect(cropIndex).toEqual(beforeCrop);
  });

  it("1×1 프레임에서도 바뀐 픽셀이 인덱스를 받는다", () => {
    const prev = frame(1, 1, 10);
    const curr = frame(1, 1, 200);
    const out = composeDiffIndex({
      prev,
      curr,
      width: 1,
      height: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      cropIndex: new Uint8Array([5]),
      transparentIndex: 3,
    });
    expect(Array.from(out)).toEqual([5]);
  });

  it("사각형이 프레임 전체여도 안 바뀐 자리는 투명 인덱스로 남는다", () => {
    const prev = frame(2, 2, 10);
    const curr = frame(2, 2, 10);
    put(curr, 2, 0, 1, [50, 50, 50, 255]);
    const out = composeDiffIndex({
      prev,
      curr,
      width: 2,
      height: 2,
      rect: { x: 0, y: 0, w: 2, h: 2 },
      cropIndex: new Uint8Array([1, 2, 3, 4]),
      transparentIndex: 6,
    });
    expect(Array.from(out)).toEqual([6, 6, 3, 6]);
  });

  it("사각형 안이 하나도 안 바뀌었으면 전부 투명 인덱스다", () => {
    // changedRegion이 null을 주는 경우라 인코더는 여기로 오지 않지만,
    // 이 함수 단독으로는 앞 프레임을 지우지 않는다는 뜻이다.
    const prev = frame(2, 2, 10);
    const curr = frame(2, 2, 10);
    const out = composeDiffIndex({
      prev,
      curr,
      width: 2,
      height: 2,
      rect: { x: 0, y: 0, w: 2, h: 2 },
      cropIndex: new Uint8Array([1, 2, 3, 4]),
      transparentIndex: 6,
    });
    expect(Array.from(out)).toEqual([6, 6, 6, 6]);
  });
});

describe("changedRegion → cropRgba → composeDiffIndex 왕복", () => {
  it("사각형 안에서 바뀐 픽셀 수와 인덱스가 붙은 자리 수가 같다", () => {
    const width = 6;
    const height = 5;
    const prev = frame(width, height, 30);
    const curr = frame(width, height, 30);
    put(curr, width, 2, 1, [255, 0, 0, 255]);
    put(curr, width, 4, 3, [0, 0, 255, 255]);

    const region = changedRegion(prev, curr, width, height);
    expect(region).toEqual({ x: 2, y: 1, w: 3, h: 3, changed: 2 });
    if (!region) return;

    const crop = cropRgba(curr, width, region);
    expect(crop.length).toBe(region.w * region.h * 4);

    const transparentIndex = 9;
    const cropIndex = new Uint8Array(region.w * region.h).fill(1);
    const out = composeDiffIndex({
      prev,
      curr,
      width,
      height,
      rect: region,
      cropIndex,
      transparentIndex,
    });
    const painted = Array.from(out).filter((v) => v !== transparentIndex).length;
    expect(painted).toBe(region.changed);
  });
});
