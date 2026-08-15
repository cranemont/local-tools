// 프레임 차분 — 앞 프레임과 같은 픽셀을 투명 인덱스로 두어 GIF를 줄인다.
// 캔버스도 gifenc도 부르지 않는다. RGBA 바이트만 받고 인덱스 배열·판정만 돌려준다.
//
// gifenc 1.0.3에서 확인한 것(apps/gif/node_modules/gifenc/src/index.js):
//   · writeFrame의 transparent·transparentIndex·dispose는 그대로 나간다(50~59행).
//     encodeGraphicControlExt(135~179행)는 transparent=true면 disposal을 2로 세우지만
//     `if (dispose >= 0) disp = dispose & 7`로 덮어쓸 수 있다 → 차분 프레임은 1(화면 유지)을 넘긴다.
//   · encodeImageDescriptor(227~251행)는 **x·y를 0으로 박아 쓴다.** 프레임 위치를 넘기는
//     인자가 없다. 그래서 바뀐 사각형을 잘라 그 자리에 앉히지 못하고, 출력 크기 그대로의
//     인덱스 배열을 만들되 사각형 밖을 투명 인덱스로 채운다. 줄어드는 이유는 둘이다.
//     ① 같은 인덱스가 길게 이어져 LZW가 짧게 만든다.
//     ② 팔레트 계산(quantize)과 매핑(applyPalette)은 사각형 크기만큼만 돈다 —
//        1920×1080에서 200×100만 바뀌면 두 함수가 보는 픽셀이 1/104로 준다.
//   · quantize(pnnquant2.js 161행)·applyPalette(palettize.js 48행)는
//     `new Uint32Array(rgba.buffer)`로 **버퍼 전체**를 본다. subarray 뷰를 넘기면 잘라 낸
//     범위 밖까지 읽으므로, cropRgba가 자기 버퍼를 가진 사본을 만든다.
//
// disposal: 차분 프레임이 투명으로 비워 둔 자리는 앞 프레임이 그대로 보여야 한다.
// GIF disposal 1(화면 유지)이 그 뜻이고, 2(배경으로 되돌리기)면 비워 둔 자리가 지워져
// 깜빡인다. 그래서 차분을 쓰는 동안은 모든 프레임에 1을 명시한다.

/** getImageData가 주는 Uint8ClampedArray와 직접 만든 Uint8Array를 함께 받는다. */
export type Rgba = Uint8Array | Uint8ClampedArray;

/** 이 값보다 알파가 낮은 픽셀을 투명으로 본다(GIF는 알파를 1비트로만 담는다). */
export const ALPHA_THRESHOLD = 128;

/**
 * 차분을 켜는 최소 색상 수. 투명 인덱스가 팔레트 한 칸을 가져가므로,
 * 색이 적을수록 그 한 칸의 비중이 커진다 — 16색에서 6.25%, 8색이면 12.5%다.
 * 화면의 색상 수 선택지는 256·128·64·32라 실제로 걸리는 것은 setGifColors의 하한 8뿐이다.
 */
export const MIN_DIFF_COLORS = 16;

/**
 * 바뀐 픽셀이 이 비율을 넘으면 차분을 쓰지 않는다.
 * 남는 10%로는 LZW가 아낄 것이 거의 없는데 팔레트 한 칸은 그대로 잃고,
 * 안 바뀐 픽셀이 여기저기 흩어져 있으면 투명 인덱스가 같은 색의 연속을 끊어
 * 오히려 커진다. 영상에서 온 프레임처럼 노이즈로 온 화면이 조금씩 달라지는 경우가 여기다.
 */
export const MAX_CHANGED_RATIO = 0.9;

/** 바뀐 영역의 최소 사각형. */
export interface DiffRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 사각형 + 그 안팎을 통틀어 몇 픽셀이 바뀌었는지. 판정이 이 수를 쓴다. */
export interface ChangedRegion extends DiffRect {
  changed: number;
}

/** 알파가 임곗값 아래인 픽셀이 하나라도 있는가. */
export function hasTransparency(rgba: Rgba, threshold = ALPHA_THRESHOLD): boolean {
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] < threshold) return true;
  }
  return false;
}

/** 픽셀 하나가 두 배열에서 같은가(네 바이트 모두 비교 — 알파만 달라도 바뀐 것으로 센다). */
function samePixel(a: Rgba, b: Rgba, p: number): boolean {
  return a[p] === b[p] && a[p + 1] === b[p + 1] && a[p + 2] === b[p + 2] && a[p + 3] === b[p + 3];
}

/**
 * 두 프레임을 비교해 바뀐 영역의 최소 사각형을 구한다. 한 픽셀도 다르지 않으면 null.
 * prev·curr는 같은 크기(width×height×4)여야 하고 어느 쪽도 고치지 않는다.
 */
export function changedRegion(
  prev: Rgba,
  curr: Rgba,
  width: number,
  height: number,
): ChangedRegion | null {
  if (width <= 0 || height <= 0) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (samePixel(prev, curr, (row + x) * 4)) continue;
      changed++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, changed };
}

/**
 * 이 프레임에 차분을 쓸지. 세 가지를 본다.
 *   · 알파 — 원본에 투명이 있으면 disposal 2(배경으로 되돌리기)가 필요한데
 *     차분은 1(화면 유지)을 요구한다. 한 프레임에 둘을 같이 넣을 수 없어 차분을 접는다.
 *   · 색 예산 — 투명 인덱스가 한 칸을 가져간다(MIN_DIFF_COLORS).
 *   · 바뀐 넓이 비율 — MAX_CHANGED_RATIO.
 * changed가 0이면(앞 프레임과 같으면) 색 예산만 통과하면 참이다.
 */
export function shouldDiff(o: {
  maxColors: number;
  changed: number;
  total: number;
  hasAlpha: boolean;
}): boolean {
  if (o.hasAlpha) return false;
  if (o.total <= 0) return false;
  // NaN은 `< MIN_DIFF_COLORS` 비교를 통과한다. 그대로 두면 quantize가 NaN을 받고
  // 던지지 않은 채 32색 팔레트를 돌려주므로(gifenc pnnquant2), 사용자가 고른 색 수와 어긋난다.
  if (!Number.isFinite(o.maxColors) || o.maxColors < MIN_DIFF_COLORS) return false;
  return o.changed <= o.total * MAX_CHANGED_RATIO;
}

/**
 * 차분 프레임의 팔레트에 뽑을 색 수 — 투명 인덱스 한 칸을 빼고 남는 만큼.
 * 이렇게 빼 두면 팔레트 길이가 사용자가 고른 색 수를 넘지 않아
 * gifenc가 색표를 다음 2의 거듭제곱으로 키우는 일도 없다(index.js의 colorTableSize).
 * 하한 2는 quantize가 1 이하를 못 받아서 둔 것이라, maxColors가 2면 결과 팔레트가
 * 3칸이 된다. shouldDiff가 MIN_DIFF_COLORS(16) 아래를 막으므로 인코더는 그 값을 안 넘긴다.
 */
export function diffPaletteBudget(maxColors: number): number {
  if (!Number.isFinite(maxColors)) return 2;
  return Math.max(2, Math.min(255, Math.floor(maxColors) - 1));
}

/**
 * 사각형만큼 잘라 낸 RGBA 사본. 자기 ArrayBuffer를 가진 새 배열이라
 * quantize·applyPalette에 그대로 넘길 수 있다(위 주석의 버퍼 전체 문제).
 */
export function cropRgba(rgba: Rgba, width: number, rect: DiffRect): Uint8ClampedArray {
  const rowBytes = rect.w * 4;
  const out = new Uint8ClampedArray(rowBytes * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const src = ((rect.y + y) * width + rect.x) * 4;
    out.set(rgba.subarray(src, src + rowBytes), y * rowBytes);
  }
  return out;
}

/**
 * 출력 크기 그대로의 인덱스 배열을 만든다.
 * 사각형 밖은 투명 인덱스, 사각형 안에서도 앞 프레임과 같은 픽셀은 투명 인덱스,
 * 달라진 픽셀만 cropIndex(사각형을 팔레트에 매핑한 결과)에서 가져온다.
 * 받은 배열은 어느 것도 고치지 않는다 — 새 배열로 돌려준다.
 */
export function composeDiffIndex(o: {
  prev: Rgba;
  curr: Rgba;
  width: number;
  height: number;
  rect: DiffRect;
  cropIndex: Uint8Array;
  transparentIndex: number;
}): Uint8Array {
  const { prev, curr, width, height, rect, cropIndex, transparentIndex } = o;
  const out = new Uint8Array(width * height);
  out.fill(transparentIndex);
  for (let y = 0; y < rect.h; y++) {
    const row = (rect.y + y) * width + rect.x;
    const cropRow = y * rect.w;
    for (let x = 0; x < rect.w; x++) {
      const px = row + x;
      if (samePixel(prev, curr, px * 4)) continue;
      out[px] = cropIndex[cropRow + x];
    }
  }
  return out;
}
