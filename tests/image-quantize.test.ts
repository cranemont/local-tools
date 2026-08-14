import { describe, expect, it } from "vitest";

import {
  ALPHA_CUT,
  MAX_COLORS,
  MIN_COLORS,
  applyPalette,
  quantize,
} from "../apps/image/src/lib/image/quantize";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 명세다. apps/image의 PNG 색 수 축소는 캔버스를 만지지 않는 순수 함수로
// 갈라져 있고(quantize.ts), 캔버스에 되쓰는 것만 pipeline.ts에 있다.
//
// 규약 셋:
//   ① 팔레트 길이는 요청한 색 수를 넘지 않는다(원본 색이 적으면 더 짧다).
//   ② 인덱스는 언제나 팔레트 안을 가리킨다.
//   ③ 알파는 완전 투명 / 완전 불투명 둘로만 남는다 — 완전 투명은 예약 칸으로 보존된다.
// ─────────────────────────────────────────────────────────────────────────────

/** 픽셀 목록을 RGBA 배열로 편다. */
function pixels(list: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(list.length * 4);
  list.forEach(([r, g, b, a], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
}

/** 같은 색 n개. */
function solid(n: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  return pixels(Array.from({ length: n }, () => rgba));
}

/** 검정 → 흰색 회색 계단(가로 한 줄). */
function grayRamp(steps: number): Uint8ClampedArray {
  return pixels(
    Array.from({ length: steps }, (_, i) => {
      const v = Math.round((i * 255) / (steps - 1));
      return [v, v, v, 255] as [number, number, number, number];
    }),
  );
}

/** 팔레트를 [r,g,b,a] 배열 목록으로 읽는다. */
function entries(palette: Uint8Array): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i < palette.length; i += 4) {
    out.push([palette[i], palette[i + 1], palette[i + 2], palette[i + 3]]);
  }
  return out;
}

/** 모든 인덱스가 팔레트 안을 가리키는가. */
function expectSaneIndices(result: { palette: Uint8Array; indices: Uint8Array }) {
  const count = result.palette.length / 4;
  expect(count).toBeGreaterThan(0);
  for (const idx of result.indices) {
    expect(idx).toBeLessThan(count);
    expect(idx).toBeGreaterThanOrEqual(0);
  }
}

describe("단색 — 나눌 것이 없으면 팔레트도 하나다", () => {
  it("한 색만 든 그림은 색 수를 아무리 크게 줘도 팔레트가 하나다", () => {
    const r = quantize(solid(64, [10, 20, 30, 255]), 8, 8, { colors: 256 });
    expect(entries(r.palette)).toEqual([[10, 20, 30, 255]]);
    expect([...r.indices]).toEqual(Array(64).fill(0));
    expectSaneIndices(r);
  });

  it("단색은 원래 값 그대로 남는다 — 5비트로 접힌 값이 아니다", () => {
    // 5비트 눈금은 자르는 자리에만 쓴다. 대표색은 실제 픽셀의 평균이어야 한다.
    const r = quantize(solid(4, [7, 129, 251, 255]), 2, 2, { colors: 16 });
    expect(entries(r.palette)).toEqual([[7, 129, 251, 255]]);
  });

  it("되편 결과가 원본과 완전히 같다", () => {
    const src = solid(9, [200, 100, 50, 255]);
    const back = applyPalette(quantize(src, 3, 3, { colors: 8 }));
    expect([...back]).toEqual([...src]);
  });
});

describe("2색 — 두 색은 두 색으로 남는다", () => {
  const two = pixels([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 0, 255, 255],
  ]);

  it("색 수 2를 주면 두 색이 그대로 나온다", () => {
    const r = quantize(two, 2, 2, { colors: 2 });
    expect(entries(r.palette).sort()).toEqual(
      [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ].sort(),
    );
    expectSaneIndices(r);
  });

  it("두 색은 서로 다른 인덱스를 받고, 같은 색끼리는 같은 인덱스를 받는다", () => {
    const r = quantize(two, 2, 2, { colors: 2 });
    expect(r.indices[0]).toBe(r.indices[1]);
    expect(r.indices[2]).toBe(r.indices[3]);
    expect(r.indices[0]).not.toBe(r.indices[2]);
  });

  it("색 수를 넉넉히 줘도 있지도 않은 색을 지어내지 않는다", () => {
    const r = quantize(two, 2, 2, { colors: 256 });
    expect(r.palette.length / 4).toBe(2);
  });

  it("색 수 1이면 두 색이 하나로 눌린다 (평균)", () => {
    const r = quantize(two, 2, 2, { colors: 1 });
    expect(r.palette.length / 4).toBe(1);
    // 빨강 둘·파랑 둘의 평균 → (127.5, 0, 127.5) 반올림
    const [e] = entries(r.palette);
    expect(e[0]).toBeGreaterThan(120);
    expect(e[0]).toBeLessThan(135);
    expect(e[1]).toBe(0);
    expect(e[3]).toBe(255);
  });
});

describe("그라디언트 — 색을 고르게 나눈다", () => {
  it("회색 계단을 4색으로 줄이면 회색 넷이 고르게 남는다", () => {
    const r = quantize(grayRamp(256), 256, 1, { colors: 4 });
    const got = entries(r.palette)
      .map((e) => e[0])
      .sort((a, b) => a - b);
    expect(got).toHaveLength(4);
    for (const e of entries(r.palette)) {
      expect(e[0]).toBe(e[1]); // 회색이 회색으로 남는다
      expect(e[1]).toBe(e[2]);
      expect(e[3]).toBe(255);
    }
    // 사분면마다 하나씩 — 손으로 계산한 기대는 32 / 96 / 160 / 224 근처다.
    expect(got[0]).toBeLessThan(64);
    expect(got[1]).toBeGreaterThan(64);
    expect(got[1]).toBeLessThan(128);
    expect(got[2]).toBeGreaterThan(128);
    expect(got[2]).toBeLessThan(192);
    expect(got[3]).toBeGreaterThan(192);
  });

  it("색 수를 늘릴수록 팔레트가 촘촘해진다", () => {
    const src = grayRamp(256);
    const gaps = [4, 8, 16].map((colors) => {
      const got = entries(quantize(src, 256, 1, { colors }).palette)
        .map((e) => e[0])
        .sort((a, b) => a - b);
      return got[got.length - 1] - got[0];
    });
    // 바깥 범위는 비슷하게 유지되고 칸 수만 는다 — 칸이 늘면 평균 간격이 줄어든다.
    const counts = [4, 8, 16].map(
      (colors) => quantize(src, 256, 1, { colors }).palette.length / 4,
    );
    expect(counts).toEqual([4, 8, 16]);
    expect(gaps[2] / 15).toBeLessThan(gaps[0] / 3);
  });

  it("줄인 색으로 되편 그림이 원본에서 크게 벗어나지 않는다", () => {
    const src = grayRamp(256);
    const back = applyPalette(quantize(src, 256, 1, { colors: 16 }));
    let worst = 0;
    for (let i = 0; i < src.length; i += 4) {
      worst = Math.max(worst, Math.abs(src[i] - back[i]));
    }
    // 256단계를 16칸으로 나누면 칸 반쪽인 8 남짓이 최악이다(5비트 눈금 여유 포함).
    expect(worst).toBeLessThanOrEqual(16);
  });
});

describe("색 수 경계 — 1과 256", () => {
  const src = grayRamp(256);

  it("색 수 1은 그림 전체를 한 색으로 누른다", () => {
    const r = quantize(src, 256, 1, { colors: 1 });
    expect(r.palette.length / 4).toBe(1);
    expect(new Set(r.indices).size).toBe(1);
    expectSaneIndices(r);
  });

  it("색 수 256은 팔레트가 256을 넘지 않는다", () => {
    const r = quantize(src, 256, 1, { colors: MAX_COLORS });
    expect(r.palette.length / 4).toBeLessThanOrEqual(MAX_COLORS);
    expectSaneIndices(r);
  });

  it("색 수를 256보다 크게 줘도 256에서 잘린다", () => {
    // 5비트 격자에 실제로 32칸(회색 대각선)뿐이라 팔레트는 그보다 짧다.
    const r = quantize(src, 256, 1, { colors: 9999 });
    expect(r.palette.length / 4).toBeLessThanOrEqual(MAX_COLORS);
  });

  it("색 수가 0이나 음수여도 최소 한 칸은 나온다", () => {
    for (const colors of [0, -3, Number.NaN]) {
      const r = quantize(src, 256, 1, { colors });
      expect(r.palette.length / 4).toBeGreaterThanOrEqual(1);
      expectSaneIndices(r);
    }
  });

  it("색 수 상수는 화면 컨트롤과 같은 범위다", () => {
    expect(MIN_COLORS).toBe(2);
    expect(MAX_COLORS).toBe(256);
  });

  it("빈 그림은 팔레트도 인덱스도 비어 있다", () => {
    const r = quantize(new Uint8ClampedArray(0), 0, 0, { colors: 16 });
    expect(r.palette.length).toBe(0);
    expect(r.indices.length).toBe(0);
    expect(r.transparentIndex).toBe(-1);
  });
});

describe("알파 — 완전 투명과 불투명만 남는다", () => {
  it("불투명만 든 그림에는 투명 칸을 만들지 않는다", () => {
    const r = quantize(solid(4, [10, 20, 30, 255]), 2, 2, { colors: 16 });
    expect(r.transparentIndex).toBe(-1);
    for (const e of entries(r.palette)) expect(e[3]).toBe(255);
  });

  it("완전 투명 픽셀이 있으면 0번 칸이 (0,0,0,0)으로 예약된다", () => {
    const src = pixels([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ]);
    const r = quantize(src, 2, 2, { colors: 16 });
    expect(r.transparentIndex).toBe(0);
    expect(entries(r.palette)[0]).toEqual([0, 0, 0, 0]);
    expect(r.indices[1]).toBe(0);
    expect(r.indices[3]).toBe(0);
    expect(r.indices[0]).not.toBe(0);
  });

  it("투명 픽셀은 되편 뒤에도 완전 투명이다", () => {
    const src = pixels([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [40, 40, 40, 0],
    ]);
    const back = applyPalette(quantize(src, 2, 2, { colors: 8 }));
    expect(back[7]).toBe(0);
    expect(back[15]).toBe(0);
    expect(back[3]).toBe(255);
    expect(back[11]).toBe(255);
  });

  it("불투명 픽셀은 되편 뒤에도 완전 불투명이다", () => {
    const src = pixels([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [12, 200, 7, 255],
      [90, 90, 90, 255],
    ]);
    const back = applyPalette(quantize(src, 2, 2, { colors: 8 }));
    for (const p of [0, 2, 3]) expect(back[p * 4 + 3]).toBe(255);
  });

  it("반투명은 경계(ALPHA_CUT)에서 투명이나 불투명 한쪽으로 떨어진다", () => {
    const src = pixels([
      [10, 20, 30, ALPHA_CUT - 1],
      [10, 20, 30, ALPHA_CUT],
      [10, 20, 30, 254],
      [10, 20, 30, 1],
    ]);
    const r = quantize(src, 2, 2, { colors: 8 });
    const back = applyPalette(r);
    expect(back[3]).toBe(0); // 127 → 투명
    expect(back[7]).toBe(255); // 128 → 불투명
    expect(back[11]).toBe(255);
    expect(back[15]).toBe(0);
  });

  it("전부 투명한 그림은 투명 한 칸만 남는다", () => {
    const r = quantize(solid(6, [9, 9, 9, 0]), 3, 2, { colors: 16 });
    expect(entries(r.palette)).toEqual([[0, 0, 0, 0]]);
    expect([...r.indices]).toEqual(Array(6).fill(0));
    expect(r.transparentIndex).toBe(0);
  });

  it("색 수가 1이면 예약할 여유가 없어 그림이 살아남는 쪽을 고른다", () => {
    // 칸이 하나뿐이면 투명 전용 칸을 두는 순간 그림이 통째로 사라진다.
    const src = pixels([
      [200, 10, 10, 255],
      [0, 0, 0, 0],
    ]);
    const r = quantize(src, 2, 1, { colors: 1 });
    expect(r.transparentIndex).toBe(-1);
    expect(r.palette.length / 4).toBe(1);
    expectSaneIndices(r);
  });

  it("투명 칸도 색 수 예산 안에서 나온다 — 색 2면 팔레트는 투명 하나 + 색 하나다", () => {
    const src = pixels([
      [200, 10, 10, 255],
      [10, 10, 200, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const r = quantize(src, 2, 2, { colors: 2 });
    expect(r.palette.length / 4).toBe(2);
    expect(entries(r.palette)[0]).toEqual([0, 0, 0, 0]);
    expect(entries(r.palette)[1][3]).toBe(255);
  });
});

describe("디더링 — 켜도 규약은 그대로다", () => {
  const ramp = grayRamp(256);

  it("디더링을 켜도 팔레트 크기는 같다", () => {
    const off = quantize(ramp, 256, 1, { colors: 4 });
    const on = quantize(ramp, 256, 1, { colors: 4, dither: true });
    expect(on.palette.length).toBe(off.palette.length);
    expectSaneIndices(on);
  });

  it("계단을 흩어 놓는다 — 같은 칸이 이어지는 길이가 짧아진다", () => {
    const off = quantize(ramp, 256, 1, { colors: 4 });
    const on = quantize(ramp, 256, 1, { colors: 4, dither: true });
    const runs = (idx: Uint8Array) => {
      let n = 1;
      for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1]) n++;
      return n;
    };
    expect(runs(on.indices)).toBeGreaterThan(runs(off.indices));
  });

  it("디더링이 평균을 크게 어긋내지 않는다", () => {
    const back = applyPalette(quantize(ramp, 256, 1, { colors: 4, dither: true }));
    let sumSrc = 0;
    let sumOut = 0;
    for (let i = 0; i < ramp.length; i += 4) {
      sumSrc += ramp[i];
      sumOut += back[i];
    }
    expect(Math.abs(sumSrc - sumOut) / (ramp.length / 4)).toBeLessThan(8);
  });

  it("디더링을 켜도 투명 픽셀은 그대로 투명이다", () => {
    const src = pixels([
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
    const back = applyPalette(quantize(src, 2, 2, { colors: 2, dither: true }));
    expect(back[7]).toBe(0);
    expect(back[15]).toBe(0);
  });
});

describe("applyPalette — 인덱스와 팔레트를 되편다", () => {
  it("주어진 배열 자리에 되쓴다 (ImageData 재활용)", () => {
    const src = solid(4, [1, 2, 3, 255]);
    const r = quantize(src, 2, 2, { colors: 4 });
    const out = new Uint8ClampedArray(16);
    const same = applyPalette(r, out);
    expect(same).toBe(out);
    expect([...out]).toEqual([...src]);
  });

  it("out을 안 주면 새 배열을 만든다", () => {
    const r = quantize(solid(1, [4, 5, 6, 255]), 1, 1, { colors: 2 });
    expect([...applyPalette(r)]).toEqual([4, 5, 6, 255]);
  });
});

describe("팔레트 알파는 0 아니면 255뿐이다", () => {
  it("반투명이 잔뜩 섞인 그림에서도 팔레트에 중간 알파가 새지 않는다", () => {
    // 팔레트 칸에 128 같은 알파가 실리면 캔버스로 되쓸 때 경계선이 유령처럼 남는다.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 256;
    };
    const n = 24 * 24;
    const src = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      src[i * 4] = rand();
      src[i * 4 + 1] = rand();
      src[i * 4 + 2] = rand();
      src[i * 4 + 3] = rand(); // 0..255 전 구간
    }
    for (const colors of [1, 2, 5, 16, 256]) {
      for (const dither of [false, true]) {
        const r = quantize(src, 24, 24, { colors, dither });
        for (let i = 3; i < r.palette.length; i += 4) {
          expect([0, 255]).toContain(r.palette[i]);
        }
        expect(r.palette.length / 4).toBeLessThanOrEqual(Math.max(1, colors));
        expectSaneIndices(r);
      }
    }
  });
});

describe("여러 색이 섞인 그림 — 규약이 전부 지켜지는가", () => {
  it("색 수를 바꿔 가며 돌려도 인덱스가 팔레트를 벗어나지 않는다", () => {
    // 결정적인 의사난수 — 시드를 고정해 매번 같은 그림을 만든다.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 256;
    };
    const n = 40 * 30;
    const src = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      src[i * 4] = rand();
      src[i * 4 + 1] = rand();
      src[i * 4 + 2] = rand();
      src[i * 4 + 3] = i % 7 === 0 ? 0 : 255;
    }
    for (const colors of [2, 3, 5, 16, 64, 256]) {
      for (const dither of [false, true]) {
        const r = quantize(src, 40, 30, { colors, dither });
        expect(r.palette.length / 4).toBeLessThanOrEqual(colors);
        expectSaneIndices(r);
        // 투명 칸은 예약돼 있고 실제로 투명 픽셀만 그리로 간다.
        expect(r.transparentIndex).toBe(0);
        for (let i = 0; i < n; i++) {
          if (src[i * 4 + 3] === 0) expect(r.indices[i]).toBe(0);
          else expect(r.indices[i]).not.toBe(0);
        }
      }
    }
  });
});
