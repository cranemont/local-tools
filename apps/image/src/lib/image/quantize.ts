// PNG 색 수 축소 — median cut 팔레트 산출과 최근접 매핑.
// 캔버스도 DOM도 만지지 않는 순수 함수다(그래서 node에서 잴 수 있고,
// tests/image-quantize.test.ts가 이 파일의 명세다). 캔버스에 되쓰는 것은 pipeline.ts의 몫이다.
//
// 직접 짠 이유: apps/gif는 gifenc가 색을 줄여 주지만 apps/image에는 그 의존성이 없고,
// 이것 하나 때문에 런타임 의존성을 늘리지 않기로 했다.
//
// ⚠️ 알파 규약: **완전 투명과 불투명 둘로만 남긴다**(경계 ALPHA_CUT). 팔레트는 색 하나가
// 한 칸이라 반투명을 살리려면 같은 RGB를 알파마다 따로 담아야 하는데, 그러면 몇 안 되는
// 칸이 경계선 픽셀로 다 나간다. 그래서 완전 투명만 예약 칸으로 보존하고 나머지는 불투명으로
// 떨어뜨린다 — 안티에일리어싱된 가장자리가 계단이 되는 것이 이 선택의 대가이고,
// 그래서 색 수 축소는 기본이 꺼짐이다.
//
// 히스토그램은 채널당 5비트(칸 32768개)로 접는다. 자르는 자리만 5비트 눈금이고,
// 대표색은 원래 8비트 값의 합에서 뽑으므로 팔레트에 실린 색은 실제 평균이다.

/** 색 수의 하한·상한 — 화면 컨트롤도 이 범위를 쓴다. */
export const MIN_COLORS = 2;
export const MAX_COLORS = 256;

/** 이 값 미만의 알파는 완전 투명으로, 이상은 완전 불투명으로 떨어진다. */
export const ALPHA_CUT = 128;

const BITS = 5;
const SIDE = 1 << BITS; // 32
const DROP = 8 - BITS; // 8비트 → 5비트로 접을 때 버리는 자리
const CELLS = SIDE * SIDE * SIDE; // 32768

function cellOf(r: number, g: number, b: number): number {
  return ((r >> DROP) << (BITS * 2)) | ((g >> DROP) << BITS) | (b >> DROP);
}

export interface QuantizeOptions {
  /** 팔레트 최대 색 수. 1..256으로 붙잡힌다. */
  colors: number;
  /** Floyd–Steinberg 오차 확산. 색이 적을수록 띠(banding)를 크게 줄인다. */
  dither?: boolean;
}

export interface QuantizeResult {
  /** 팔레트 — RGBA 4바이트씩. 길이는 요청한 색 수 이하다(원본에 색이 적으면 더 짧다). */
  palette: Uint8Array;
  /** 픽셀마다 팔레트 인덱스. 길이 = width * height. */
  indices: Uint8Array;
  /** 완전 투명 전용 칸의 인덱스. 그런 칸이 없으면 -1. */
  transparentIndex: number;
}

/** 5비트로 접은 격자 위의 상자. 만들 때 실제로 색이 있는 범위까지 조여 둔다. */
interface Cube {
  r1: number;
  r2: number;
  g1: number;
  g2: number;
  b1: number;
  b2: number;
  /** 이 상자에 든 픽셀 수. */
  count: number;
  /** 더 나눌 수 없다고 판명된 상자 — 고르기에서 뺀다. */
  frozen: boolean;
}

function volumeOf(c: Cube): number {
  return (c.r2 - c.r1 + 1) * (c.g2 - c.g1 + 1) * (c.b2 - c.b1 + 1);
}

/** 범위 안에서 색이 있는 칸만 감싸는 상자. 하나도 없으면 null. */
function cubeOf(
  count: Uint32Array,
  r1: number,
  r2: number,
  g1: number,
  g2: number,
  b1: number,
  b2: number,
): Cube | null {
  let total = 0;
  let rn = SIDE;
  let rx = -1;
  let gn = SIDE;
  let gx = -1;
  let bn = SIDE;
  let bx = -1;
  for (let r = r1; r <= r2; r++) {
    for (let g = g1; g <= g2; g++) {
      const base = (r << (BITS * 2)) | (g << BITS);
      for (let b = b1; b <= b2; b++) {
        const n = count[base | b];
        if (!n) continue;
        total += n;
        if (r < rn) rn = r;
        if (r > rx) rx = r;
        if (g < gn) gn = g;
        if (g > gx) gx = g;
        if (b < bn) bn = b;
        if (b > bx) bx = b;
      }
    }
  }
  if (!total) return null;
  return { r1: rn, r2: rx, g1: gn, g2: gx, b1: bn, b2: bx, count: total, frozen: false };
}

/** 가장 긴 축을 픽셀 수의 절반이 넘는 자리에서 자른다 — median cut의 본체. */
function splitCube(count: Uint32Array, cube: Cube): [Cube, Cube] | null {
  const dr = cube.r2 - cube.r1;
  const dg = cube.g2 - cube.g1;
  const db = cube.b2 - cube.b1;
  const axis = dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2;
  const lo = axis === 0 ? cube.r1 : axis === 1 ? cube.g1 : cube.b1;
  const hi = axis === 0 ? cube.r2 : axis === 1 ? cube.g2 : cube.b2;
  if (hi <= lo) return null;

  const along = new Float64Array(hi - lo + 1);
  for (let r = cube.r1; r <= cube.r2; r++) {
    for (let g = cube.g1; g <= cube.g2; g++) {
      const base = (r << (BITS * 2)) | (g << BITS);
      for (let b = cube.b1; b <= cube.b2; b++) {
        const n = count[base | b];
        if (!n) continue;
        along[(axis === 0 ? r : axis === 1 ? g : b) - lo] += n;
      }
    }
  }

  let acc = 0;
  let cut = lo;
  for (let i = 0; i < along.length; i++) {
    acc += along[i];
    if (acc * 2 >= cube.count) {
      cut = lo + i;
      break;
    }
  }
  // 상자는 조여져 있으므로 양 끝 면에는 반드시 색이 있다.
  // 자르는 자리를 hi 앞으로 붙잡으면 두 쪽 다 비지 않는다.
  if (cut >= hi) cut = hi - 1;

  const left =
    axis === 0
      ? cubeOf(count, cube.r1, cut, cube.g1, cube.g2, cube.b1, cube.b2)
      : axis === 1
        ? cubeOf(count, cube.r1, cube.r2, cube.g1, cut, cube.b1, cube.b2)
        : cubeOf(count, cube.r1, cube.r2, cube.g1, cube.g2, cube.b1, cut);
  const right =
    axis === 0
      ? cubeOf(count, cut + 1, cube.r2, cube.g1, cube.g2, cube.b1, cube.b2)
      : axis === 1
        ? cubeOf(count, cube.r1, cube.r2, cut + 1, cube.g2, cube.b1, cube.b2)
        : cubeOf(count, cube.r1, cube.r2, cube.g1, cube.g2, cut + 1, cube.b2);
  if (!left || !right) return null;
  return [left, right];
}

/** 상자를 budget개가 될 때까지 쪼갠다. 원본 색이 적으면 그보다 적게 나온다. */
function medianCut(count: Uint32Array, budget: number): Cube[] {
  const root = cubeOf(count, 0, SIDE - 1, 0, SIDE - 1, 0, SIDE - 1);
  if (!root) return [];
  const cubes: Cube[] = [root];
  // 앞의 3/4는 픽셀 수로, 나머지는 픽셀 수 × 부피로 고른다 — 넓은 면적을 먼저 나누고
  // 그 다음에 넓게 퍼진 색을 나눈다. 픽셀 수만 보면 하늘 같은 평면이 칸을 다 먹고,
  // 부피만 보면 몇 픽셀 안 되는 튀는 색이 칸을 다 먹는다.
  const byCountUntil = Math.max(1, Math.round(budget * 0.75));

  while (cubes.length < budget) {
    const byCount = cubes.length < byCountUntil;
    let pick = -1;
    let best = 0;
    for (let i = 0; i < cubes.length; i++) {
      const c = cubes[i];
      if (c.frozen || c.count <= 1 || volumeOf(c) <= 1) continue;
      const score = byCount ? c.count : c.count * volumeOf(c);
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    const pair = splitCube(count, cubes[pick]);
    if (!pair) {
      cubes[pick].frozen = true;
      continue;
    }
    cubes.splice(pick, 1, pair[0], pair[1]);
  }
  return cubes;
}

/** 상자의 대표색 — 원래 8비트 값의 픽셀 수 가중 평균이다. */
function represent(
  cube: Cube,
  count: Uint32Array,
  rs: Float64Array,
  gs: Float64Array,
  bs: Float64Array,
): { r: number; g: number; b: number } {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let ri = cube.r1; ri <= cube.r2; ri++) {
    for (let gi = cube.g1; gi <= cube.g2; gi++) {
      const base = (ri << (BITS * 2)) | (gi << BITS);
      for (let bi = cube.b1; bi <= cube.b2; bi++) {
        const idx = base | bi;
        const c = count[idx];
        if (!c) continue;
        n += c;
        r += rs[idx];
        g += gs[idx];
        b += bs[idx];
      }
    }
  }
  if (!n) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.min(255, Math.max(0, Math.round(r / n))),
    g: Math.min(255, Math.max(0, Math.round(g / n))),
    b: Math.min(255, Math.max(0, Math.round(b / n))),
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * RGBA 픽셀 배열을 팔레트 + 인덱스로 줄인다.
 *
 * - 완전 투명(알파 < ALPHA_CUT) 픽셀이 있고 색 칸이 둘 이상이면 0번 칸을 (0,0,0,0)으로 예약한다.
 * - 나머지 픽셀의 알파는 255로 떨어진다.
 * - 색 수가 1이면 예약할 여유가 없어 투명도 색 하나로 눌린다(그림이 통째로 사라지지 않게).
 */
export function quantize(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: QuantizeOptions,
): QuantizeResult {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const pixels = Math.min(w * h, Math.floor(rgba.length / 4));
  const budget = Math.min(
    MAX_COLORS,
    Math.max(1, Number.isFinite(options.colors) ? Math.round(options.colors) : MAX_COLORS),
  );
  const indices = new Uint8Array(pixels);
  if (!pixels) {
    return { palette: new Uint8Array(0), indices, transparentIndex: -1 };
  }

  // 1) 히스토그램 — 불투명 픽셀만 담는다.
  const count = new Uint32Array(CELLS);
  const rs = new Float64Array(CELLS);
  const gs = new Float64Array(CELLS);
  const bs = new Float64Array(CELLS);
  let opaque = 0;
  let clear = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    if (rgba[i + 3] < ALPHA_CUT) {
      clear++;
      continue;
    }
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const c = cellOf(r, g, b);
    count[c]++;
    rs[c] += r;
    gs[c] += g;
    bs[c] += b;
    opaque++;
  }

  // 전부 투명하면 팔레트는 투명 한 칸뿐이다(인덱스는 이미 0).
  if (!opaque) {
    return { palette: Uint8Array.of(0, 0, 0, 0), indices, transparentIndex: 0 };
  }

  const reserve = clear > 0 && budget >= 2;
  const transparentIndex = reserve ? 0 : -1;
  const first = reserve ? 1 : 0;

  // 2) 팔레트
  const cubes = medianCut(count, budget - first);
  const palette = new Uint8Array((cubes.length + first) * 4);
  for (let i = 0; i < cubes.length; i++) {
    const rep = represent(cubes[i], count, rs, gs, bs);
    const q = (i + first) * 4;
    palette[q] = rep.r;
    palette[q + 1] = rep.g;
    palette[q + 2] = rep.b;
    palette[q + 3] = 255;
  }

  // 3) 최근접 매핑. 5비트 칸마다 답을 적어 두고 재사용한다 —
  //    이 캐시가 없으면 픽셀 수 × 색 수만큼 거리를 재게 된다.
  const entries = cubes.length;
  const cache = new Int16Array(CELLS).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const cell = cellOf(r, g, b);
    const hit = cache[cell];
    if (hit >= 0) return hit;
    let pick = first;
    let bestD = Infinity;
    for (let i = 0; i < entries; i++) {
      const q = (i + first) * 4;
      const dr = r - palette[q];
      const dg = g - palette[q + 1];
      const db = b - palette[q + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        pick = i + first;
      }
    }
    cache[cell] = pick;
    return pick;
  };
  // 투명 칸을 예약하지 못한 경우(색 수 1) 투명 픽셀도 색 칸으로 간다.
  const clearIndex = transparentIndex >= 0 ? transparentIndex : 0;

  if (options.dither) {
    // Floyd–Steinberg. 오차는 두 줄만 들고 간다(전체 버퍼는 큰 그림에서 수백 MB가 된다).
    let cur = new Float32Array(w * 3);
    let next = new Float32Array(w * 3);
    for (let y = 0; y < h; y++) {
      next.fill(0);
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (p >= pixels) break;
        const i = p * 4;
        const e = x * 3;
        if (rgba[i + 3] < ALPHA_CUT) {
          indices[p] = clearIndex;
          continue; // 투명 픽셀은 오차를 만들지도 받지도 않는다.
        }
        const r = clampByte(rgba[i] + cur[e]);
        const g = clampByte(rgba[i + 1] + cur[e + 1]);
        const b = clampByte(rgba[i + 2] + cur[e + 2]);
        const idx = nearest(r, g, b);
        indices[p] = idx;
        const q = idx * 4;
        const er = r - palette[q];
        const eg = g - palette[q + 1];
        const eb = b - palette[q + 2];
        if (x + 1 < w) {
          cur[e + 3] += (er * 7) / 16;
          cur[e + 4] += (eg * 7) / 16;
          cur[e + 5] += (eb * 7) / 16;
        }
        if (y + 1 < h) {
          if (x > 0) {
            next[e - 3] += (er * 3) / 16;
            next[e - 2] += (eg * 3) / 16;
            next[e - 1] += (eb * 3) / 16;
          }
          next[e] += (er * 5) / 16;
          next[e + 1] += (eg * 5) / 16;
          next[e + 2] += (eb * 5) / 16;
          if (x + 1 < w) {
            next[e + 3] += er / 16;
            next[e + 4] += eg / 16;
            next[e + 5] += eb / 16;
          }
        }
      }
      const swap = cur;
      cur = next;
      next = swap;
    }
  } else {
    for (let p = 0, i = 0; p < pixels; p++, i += 4) {
      indices[p] =
        rgba[i + 3] < ALPHA_CUT ? clearIndex : nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  }

  return { palette, indices, transparentIndex };
}

/** 인덱스 + 팔레트를 다시 RGBA로 편다. out을 주면 그 자리에 쓴다(ImageData 재활용). */
export function applyPalette(
  result: QuantizeResult,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const pixels = result.indices.length;
  const dst = out ?? new Uint8ClampedArray(pixels * 4);
  const entries = result.palette.length / 4;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const idx = result.indices[p];
    const q = (idx < entries ? idx : 0) * 4;
    dst[i] = result.palette[q];
    dst[i + 1] = result.palette[q + 1];
    dst[i + 2] = result.palette[q + 2];
    dst[i + 3] = result.palette[q + 3];
  }
  return dst;
}
