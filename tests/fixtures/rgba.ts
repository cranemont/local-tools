/** 픽셀 표본의 순수 부분 — 인코더 없이 도는 것만 여기 둔다.
 *
 * 공통 규약(의존성·바이너리 금지·결정성)은 `tests/fixtures/pdf.ts` 머리말에 있다.
 *
 * `image.ts`에서 갈라 나온 이유는 층이 둘이라서다. 그 파일은 `@napi-rs/canvas`로
 * PNG·JPEG를 굽는데 그것은 node 전용이고, 브라우저 층은 네이티브 캔버스로 같은 일을 한다.
 * 두 층이 함께 쓰는 것은 무늬를 짓는 계산과 결과를 재는 계산뿐이라 그 둘만 여기 남긴다.
 * `image.ts`가 이 파일의 것을 다시 내보내므로 node 쪽 부르는 자리는 그대로다.
 *
 * **균일한 사각형을 만들지 않는다.** 가리기(모자이크·블러)는 한 가지 색으로 칠해진 면
 * 위에서는 결과가 원본과 같다. 그 표본으로 "영역 안이 바뀌었나"를 재면 정상 동작에서도
 * 단언이 실패한다. 그래서 기본 무늬는 3px 격자에 픽셀마다 흔들림을 얹은 잔 무늬다 —
 * 블록 하나 안에서도 색이 갈리므로 평균으로 뭉개면 값이 움직인다.
 *
 * 난수는 mulberry32다. `Math.random()`을 쓰면 같은 명세에서 매번 다른 바이트가 나온다.
 */

/** 원시 픽셀 한 장. `ImageData`와 같은 모양이라 그대로 넘길 수 있다. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageSpec {
  width?: number;
  height?: number;
  /** 격자 한 칸의 변(px). 1이면 격자 없이 흔들림만 남는다. */
  cell?: number;
  /** 픽셀마다 더하는 흔들림의 폭(0~127). 0이면 격자만 남아 블록이 균일해진다. */
  jitter?: number;
  /** 같은 값이면 같은 픽셀이 나온다. */
  seed?: number;
}

const DEFAULTS = { width: 64, height: 48, cell: 3, jitter: 40, seed: 1 };

/** mulberry32 — 32비트 상태 하나짜리 결정적 난수. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * 잔 무늬 한 장. 격자 칸마다 밑색이 갈리고 픽셀마다 흔들림이 얹힌다.
 * 알파는 언제나 255다 — 투명이 필요한 표본은 부르는 쪽에서 알파를 덮어쓴다.
 */
export function makeRgba(spec: ImageSpec = {}): Rgba {
  const { width, height, cell, jitter, seed } = { ...DEFAULTS, ...spec };
  const rand = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      const dark = (gx + gy) % 2 === 0;
      const base = dark ? 70 : 185;
      const i = (y * width + x) * 4;
      data[i] = clamp255(base + (rand() * 2 - 1) * jitter);
      data[i + 1] = clamp255(base + (rand() * 2 - 1) * jitter + (dark ? 20 : -20));
      data[i + 2] = clamp255(base + (rand() * 2 - 1) * jitter + (gx % 3) * 12);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** 사각형 하나. 오른쪽·아래는 포함하지 않는다. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 사각형 안 픽셀의 채널별 분산 평균. 모자이크·블러를 걸면 이 값이 내려간다. */
export function variance(image: Rgba, rect?: Rect): number {
  const area = rect ?? { x: 0, y: 0, width: image.width, height: image.height };
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let n = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const i = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = image.data[i + c];
        sums[c] += v;
        squares[c] += v * v;
      }
      n++;
    }
  }
  if (n === 0) return 0;
  let total = 0;
  for (let c = 0; c < 3; c++) total += squares[c] / n - (sums[c] / n) ** 2;
  return total / 3;
}

/** 두 장에서 값이 다른 픽셀 수. 알파는 안 센다. */
export function differingPixels(a: Rgba, b: Rgba, rect?: Rect): number {
  const area = rect ?? { x: 0, y: 0, width: a.width, height: a.height };
  let n = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      if (a.data[i] !== b.data[j] || a.data[i + 1] !== b.data[j + 1] || a.data[i + 2] !== b.data[j + 2]) n++;
    }
  }
  return n;
}
