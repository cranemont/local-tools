import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  effectiveFit,
  effectiveSize,
  fitPlan,
  rotatedSize,
  targetSize,
} from "../apps/image/src/lib/image/size";
import type {
  CropRect,
  FitMode,
  ImageItem,
  ResizeSpec,
  Rotation,
} from "../apps/image/src/lib/image/types";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 명세다. apps/image의 리사이즈는 두 함수로 갈라져 있고
// (targetSize = 결과 캔버스가 얼마인가, fitPlan = 그 캔버스 위에 원본을 어떻게 앉히는가),
// 화면 안내문(Panel)과 실제 파이프라인이 **같은 두 함수**를 부른다.
// 기대값은 구현을 베끼지 않고 손으로 계산한 값이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 리사이즈 설정 기본값 — 각 테스트는 자기가 쓰는 칸만 덮어쓴다. */
function spec(over: Partial<ResizeSpec> = {}): ResizeSpec {
  return {
    mode: "none",
    scale: 100,
    width: 1000,
    height: 1000,
    longest: 1000,
    fit: "stretch",
    padColor: null,
    noEnlarge: false,
    ...over,
  };
}

function item(
  w: number,
  h: number,
  over: { rotation?: Rotation; crop?: CropRect | null } = {},
): ImageItem {
  return {
    id: "x",
    name: "x.jpg",
    mime: "image/jpeg",
    bytes: new Uint8Array(0) as Uint8Array<ArrayBuffer>,
    width: w,
    height: h,
    thumb: "",
    transform: {
      rotation: over.rotation ?? 0,
      flipX: false,
      flipY: false,
      crop: over.crop ?? null,
    },
  };
}

/** 정수이고 1 이상인지 — 캔버스 크기가 0이나 음수면 인코딩이 통째로 죽는다. */
function expectSane(size: { w: number; h: number }) {
  expect(Number.isInteger(size.w)).toBe(true);
  expect(Number.isInteger(size.h)).toBe(true);
  expect(size.w).toBeGreaterThanOrEqual(1);
  expect(size.h).toBeGreaterThanOrEqual(1);
}

describe("rotatedSize·effectiveSize — 크롭 좌표계의 기준", () => {
  it("90도·270도 회전은 가로세로를 맞바꾼다", () => {
    expect(rotatedSize(item(800, 600, { rotation: 90 }))).toEqual({ w: 600, h: 800 });
    expect(rotatedSize(item(800, 600, { rotation: 270 }))).toEqual({ w: 600, h: 800 });
  });

  it("0도·180도 회전은 가로세로를 그대로 둔다", () => {
    expect(rotatedSize(item(800, 600, { rotation: 0 }))).toEqual({ w: 800, h: 600 });
    expect(rotatedSize(item(800, 600, { rotation: 180 }))).toEqual({ w: 800, h: 600 });
  });

  it("크롭이 있으면 회전 결과가 아니라 크롭 상자가 리사이즈 입력이 된다", () => {
    const it0 = item(800, 600, { rotation: 90, crop: { x: 10, y: 20, w: 300, h: 400 } });
    expect(rotatedSize(it0)).toEqual({ w: 600, h: 800 });
    expect(effectiveSize(it0)).toEqual({ w: 300, h: 400 });
  });

  it("크롭이 없으면 effectiveSize는 회전 결과와 같다", () => {
    expect(effectiveSize(item(800, 600, { rotation: 270 }))).toEqual({ w: 600, h: 800 });
  });
});

describe("targetSize — none 모드", () => {
  it("none은 원본 크기를 그대로 돌려준다", () => {
    expect(targetSize(1234, 567, spec({ mode: "none" }))).toEqual({ w: 1234, h: 567 });
  });

  it("none은 확대 안 함 체크와 무관하다", () => {
    expect(targetSize(1234, 567, spec({ mode: "none", noEnlarge: true }))).toEqual({
      w: 1234,
      h: 567,
    });
  });
});

describe("targetSize — scale(배율) 모드", () => {
  it("배율 200%는 가로세로를 두 배로 만든다", () => {
    expect(targetSize(800, 600, spec({ mode: "scale", scale: 200 }))).toEqual({
      w: 1600,
      h: 1200,
    });
  });

  // CLAUDE.md 22번 — 한 번 걸었다가 "배율 200%"가 통째로 죽었다(원본을 그대로 돌려줬다).
  it("배율 모드는 확대 안 함(noEnlarge)을 타지 않는다 — 200%는 확대를 명시한 것이다", () => {
    expect(
      targetSize(800, 600, spec({ mode: "scale", scale: 200, noEnlarge: true })),
    ).toEqual({ w: 1600, h: 1200 });
  });

  it("확대 안 함이 켜져도 배율 1000%는 열 배가 된다", () => {
    expect(
      targetSize(100, 100, spec({ mode: "scale", scale: 1000, noEnlarge: true })),
    ).toEqual({ w: 1000, h: 1000 });
  });

  it("배율 100%는 원본과 같다", () => {
    expect(targetSize(801, 601, spec({ mode: "scale", scale: 100 }))).toEqual({
      w: 801,
      h: 601,
    });
  });

  it("배율 50%는 절반으로 줄인다", () => {
    expect(targetSize(800, 600, spec({ mode: "scale", scale: 50 }))).toEqual({
      w: 400,
      h: 300,
    });
  });

  it("배율이 0이어도 결과는 0이 아니라 1px로 붙잡힌다", () => {
    const out = targetSize(800, 600, spec({ mode: "scale", scale: 0 }));
    expect(out).toEqual({ w: 1, h: 1 });
    expectSane(out);
  });

  it("배율이 음수여도 음수 캔버스가 나오지 않는다", () => {
    const out = targetSize(800, 600, spec({ mode: "scale", scale: -50 }));
    expect(out).toEqual({ w: 1, h: 1 });
    expectSane(out);
  });

  it("배율 1%에서 짧은 변이 0.4px가 되어도 1px로 남는다", () => {
    // 100×40 → 1 × 0.4 → 반올림하면 0, 붙잡아 1
    expect(targetSize(100, 40, spec({ mode: "scale", scale: 1 }))).toEqual({ w: 1, h: 1 });
  });
});

describe("targetSize — width(가로 맞춤) 모드", () => {
  it("가로를 목표에 맞추고 세로는 비율을 따라간다", () => {
    // 1920×1080 → 800 : 1080 × 800/1920 = 450
    expect(targetSize(1920, 1080, spec({ mode: "width", width: 800 }))).toEqual({
      w: 800,
      h: 450,
    });
  });

  it("나누어떨어지지 않는 세로는 반올림한다", () => {
    // 667 × 500/1000 = 333.5 → 334
    expect(targetSize(1000, 667, spec({ mode: "width", width: 500 }))).toEqual({
      w: 500,
      h: 334,
    });
  });

  it("확대 안 함이 켜져 있고 목표가 원본보다 크면 원본 크기로 둔다", () => {
    expect(
      targetSize(1000, 500, spec({ mode: "width", width: 2000, noEnlarge: true })),
    ).toEqual({ w: 1000, h: 500 });
  });

  it("확대 안 함이 꺼져 있으면 가로 모드도 확대한다", () => {
    expect(
      targetSize(1000, 500, spec({ mode: "width", width: 2000, noEnlarge: false })),
    ).toEqual({ w: 2000, h: 1000 });
  });

  it("목표가 원본 가로와 같으면 확대 안 함이 켜져도 그대로 통과한다", () => {
    expect(
      targetSize(1000, 500, spec({ mode: "width", width: 1000, noEnlarge: true })),
    ).toEqual({ w: 1000, h: 500 });
  });

  it("목표 가로가 0이어도 1px로 붙잡힌다", () => {
    expectSane(targetSize(800, 600, spec({ mode: "width", width: 0 })));
    expect(targetSize(800, 600, spec({ mode: "width", width: 0 }))).toEqual({
      w: 1,
      h: 1,
    });
  });
});

describe("targetSize — height(세로 맞춤) 모드", () => {
  it("세로를 목표에 맞추고 가로는 비율을 따라간다", () => {
    // 1920×1080 → 540 : 1920 × 540/1080 = 960
    expect(targetSize(1920, 1080, spec({ mode: "height", height: 540 }))).toEqual({
      w: 960,
      h: 540,
    });
  });

  it("확대 안 함이 켜져 있고 목표가 원본보다 크면 원본 크기로 둔다", () => {
    expect(
      targetSize(500, 1000, spec({ mode: "height", height: 2000, noEnlarge: true })),
    ).toEqual({ w: 500, h: 1000 });
  });

  it("세로 모드와 가로 모드는 서로 거울이다 — 같은 그림을 눕혀도 같은 답이 나온다", () => {
    const byWidth = targetSize(1600, 900, spec({ mode: "width", width: 400 }));
    const byHeight = targetSize(900, 1600, spec({ mode: "height", height: 400 }));
    expect(byWidth).toEqual({ w: 400, h: 225 });
    expect(byHeight).toEqual({ w: 225, h: 400 });
  });
});

describe("targetSize — longest(긴 변) 모드", () => {
  it("가로 사진과 세로 사진이 같은 긴 변 값으로 균일해진다", () => {
    const landscape = targetSize(4000, 3000, spec({ mode: "longest", longest: 1000 }));
    const portrait = targetSize(3000, 4000, spec({ mode: "longest", longest: 1000 }));
    expect(landscape).toEqual({ w: 1000, h: 750 });
    expect(portrait).toEqual({ w: 750, h: 1000 });
    expect(Math.max(landscape.w, landscape.h)).toBe(1000);
    expect(Math.max(portrait.w, portrait.h)).toBe(1000);
  });

  it("정사각형은 긴 변 목표가 곧 양변이 된다", () => {
    expect(targetSize(500, 500, spec({ mode: "longest", longest: 200 }))).toEqual({
      w: 200,
      h: 200,
    });
  });

  it("확대 안 함이 켜져 있고 긴 변 목표가 원본보다 크면 원본 크기로 둔다", () => {
    expect(
      targetSize(800, 600, spec({ mode: "longest", longest: 1000, noEnlarge: true })),
    ).toEqual({ w: 800, h: 600 });
  });

  it("긴 변 목표가 원본 긴 변과 같으면 확대 안 함이 켜져도 그대로 통과한다", () => {
    expect(
      targetSize(800, 600, spec({ mode: "longest", longest: 800, noEnlarge: true })),
    ).toEqual({ w: 800, h: 600 });
  });

  it("확대 안 함이 꺼져 있으면 긴 변 모드도 확대한다", () => {
    expect(targetSize(800, 600, spec({ mode: "longest", longest: 1600 }))).toEqual({
      w: 1600,
      h: 1200,
    });
  });

  it("극단 비율 1×10000도 짧은 변이 0이 되지 않는다", () => {
    const out = targetSize(1, 10000, spec({ mode: "longest", longest: 100 }));
    expect(out).toEqual({ w: 1, h: 100 });
    expectSane(out);
  });

  it("극단 비율 10000×1도 짧은 변이 0이 되지 않는다", () => {
    const out = targetSize(10000, 1, spec({ mode: "longest", longest: 100 }));
    expect(out).toEqual({ w: 100, h: 1 });
    expectSane(out);
  });
});

describe("targetSize — exact(정확한 크기) 모드", () => {
  it("exact는 지정한 캔버스를 그대로 돌려준다 — 비율을 지키지 않는다", () => {
    expect(targetSize(800, 600, spec({ mode: "exact", width: 300, height: 900 }))).toEqual(
      { w: 300, h: 900 },
    );
  });

  it("exact는 확대 안 함을 타지 않는다 — 캔버스가 고정이라 해당 없음", () => {
    expect(
      targetSize(
        800,
        600,
        spec({ mode: "exact", width: 5000, height: 5000, noEnlarge: true }),
      ),
    ).toEqual({ w: 5000, h: 5000 });
  });

  it("exact는 원본이 작아도 줄이지 않는다 — 그림 배치는 fitPlan이 정한다", () => {
    expect(targetSize(10, 10, spec({ mode: "exact", width: 4000, height: 4000 }))).toEqual(
      { w: 4000, h: 4000 },
    );
  });

  it("exact에 0이나 음수를 넣어도 캔버스는 최소 1px이다", () => {
    expect(targetSize(800, 600, spec({ mode: "exact", width: 0, height: -100 }))).toEqual({
      w: 1,
      h: 1,
    });
  });
});

describe("fitPlan — contain(여백 남기기)", () => {
  it("contain은 원본을 통째로 쓰고 목표 안에 다 들어가게 줄인다", () => {
    // 4000×3000 → 1000×1000: 축소율 min(0.25, 0.3333) = 0.25 → 1000×750
    const plan = fitPlan(4000, 3000, 1000, 1000, "contain");
    expect(plan.draw).toEqual({ w: 1000, h: 750 });
    expect(plan.src).toEqual({ w: 4000, h: 3000 });
  });

  it("contain이 남기는 여백은 목표에서 그림을 뺀 만큼이다 — 위아래 125px씩", () => {
    const plan = fitPlan(4000, 3000, 1000, 1000, "contain");
    expect(1000 - plan.draw.h).toBe(250);
    expect((1000 - plan.draw.h) / 2).toBe(125);
    expect(1000 - plan.draw.w).toBe(0);
  });

  it("세로 사진의 contain 여백은 좌우로 간다 — 양옆 125px씩", () => {
    // 3000×4000 → 1000×1000: 축소율 min(0.3333, 0.25) = 0.25 → 750×1000
    const plan = fitPlan(3000, 4000, 1000, 1000, "contain");
    expect(plan.draw).toEqual({ w: 750, h: 1000 });
    expect((1000 - plan.draw.w) / 2).toBe(125);
  });

  it("목표가 원본보다 크면 contain은 확대해 채운다", () => {
    // 400×300 → 1600×1600: 배율 min(4, 5.333) = 4 → 1600×1200
    const plan = fitPlan(400, 300, 1600, 1600, "contain");
    expect(plan.draw).toEqual({ w: 1600, h: 1200 });
    expect(plan.src).toEqual({ w: 400, h: 300 });
  });

  it("비율이 같으면 contain에 여백이 남지 않는다", () => {
    const plan = fitPlan(800, 600, 400, 300, "contain");
    expect(plan.draw).toEqual({ w: 400, h: 300 });
  });

  it("극단 비율 1×10000도 contain 결과가 0px이 되지 않는다", () => {
    // 축소율 min(100, 0.01) = 0.01 → 0.01×1 → 붙잡아 1, 100
    const plan = fitPlan(1, 10000, 100, 100, "contain");
    expect(plan.draw).toEqual({ w: 1, h: 100 });
    expectSane(plan.draw);
    expectSane(plan.src);
  });
});

describe("fitPlan — cover(채우고 자르기)", () => {
  it("cover는 캔버스를 가득 채우고 넘치는 쪽을 원본에서 깎는다", () => {
    // 4000×3000(1.333) → 1000×1000(1.0): 가로가 넘친다 → 원본에서 3000×3000만 쓴다
    const plan = fitPlan(4000, 3000, 1000, 1000, "cover");
    expect(plan.draw).toEqual({ w: 1000, h: 1000 });
    expect(plan.src).toEqual({ w: 3000, h: 3000 });
  });

  it("cover가 깎아 내는 양은 원본에서 쓰는 영역을 뺀 만큼이다 — 좌우 500px씩", () => {
    const plan = fitPlan(4000, 3000, 1000, 1000, "cover");
    expect(4000 - plan.src.w).toBe(1000);
    expect((4000 - plan.src.w) / 2).toBe(500);
    expect(3000 - plan.src.h).toBe(0);
  });

  it("세로 사진의 cover는 위아래를 깎는다", () => {
    // 3000×4000(0.75) → 1000×1000: 세로가 넘친다 → 3000×3000
    const plan = fitPlan(3000, 4000, 1000, 1000, "cover");
    expect(plan.src).toEqual({ w: 3000, h: 3000 });
    expect((4000 - plan.src.h) / 2).toBe(500);
  });

  it("목표가 원본보다 커도 cover는 비율을 맞추려 원본을 깎는다", () => {
    // 400×300(1.333) → 1600×800(2.0): 세로가 남는다 → 400 × (400/2) = 400×200
    const plan = fitPlan(400, 300, 1600, 800, "cover");
    expect(plan.draw).toEqual({ w: 1600, h: 800 });
    expect(plan.src).toEqual({ w: 400, h: 200 });
  });

  it("비율이 같으면 cover는 원본을 하나도 깎지 않는다", () => {
    const plan = fitPlan(800, 600, 400, 300, "cover");
    expect(plan.draw).toEqual({ w: 400, h: 300 });
    expect(plan.src).toEqual({ w: 800, h: 600 });
  });

  it("정사각 원본을 정사각 목표에 cover하면 그대로다", () => {
    const plan = fitPlan(500, 500, 200, 200, "cover");
    expect(plan.draw).toEqual({ w: 200, h: 200 });
    expect(plan.src).toEqual({ w: 500, h: 500 });
  });

  it("극단 비율 1×10000을 정사각에 cover하면 1×1 조각만 남는다", () => {
    const plan = fitPlan(1, 10000, 100, 100, "cover");
    expect(plan.draw).toEqual({ w: 100, h: 100 });
    expect(plan.src).toEqual({ w: 1, h: 1 });
    expectSane(plan.src);
  });

  it("cover가 쓰는 영역은 어떤 경우에도 원본을 넘지 않는다", () => {
    const sizes: Array<[number, number]> = [
      [1, 1],
      [1, 10000],
      [10000, 1],
      [3, 4],
      [4000, 3000],
      [1920, 1080],
      [101, 100],
      [999, 1000],
    ];
    for (const [bw, bh] of sizes) {
      for (const [tw, th] of sizes) {
        const plan = fitPlan(bw, bh, tw, th, "cover");
        expect(plan.src.w).toBeLessThanOrEqual(bw);
        expect(plan.src.h).toBeLessThanOrEqual(bh);
        expectSane(plan.src);
        expect(plan.draw).toEqual({ w: tw, h: th });
      }
    }
  });
});

describe("fitPlan — stretch(늘리기)", () => {
  it("stretch는 원본을 통째로 목표 캔버스에 늘린다 — 여백도 잘림도 없다", () => {
    const plan = fitPlan(800, 600, 300, 900, "stretch");
    expect(plan.draw).toEqual({ w: 300, h: 900 });
    expect(plan.src).toEqual({ w: 800, h: 600 });
  });

  it("stretch는 비율이 아무리 어긋나도 원본을 깎지 않는다", () => {
    const plan = fitPlan(1, 10000, 500, 500, "stretch");
    expect(plan.draw).toEqual({ w: 500, h: 500 });
    expect(plan.src).toEqual({ w: 1, h: 10000 });
  });
});

describe("fitPlan — 세 맞춤의 관계", () => {
  it("contain은 원본을 다 쓰고, cover는 캔버스를 다 채운다", () => {
    const contain = fitPlan(4000, 3000, 1000, 1000, "contain");
    const cover = fitPlan(4000, 3000, 1000, 1000, "cover");
    // contain: 원본 전부(=src 그대로), 캔버스는 남는다
    expect(contain.src).toEqual({ w: 4000, h: 3000 });
    expect(contain.draw.h).toBeLessThan(1000);
    // cover: 캔버스 전부, 원본은 깎인다
    expect(cover.draw).toEqual({ w: 1000, h: 1000 });
    expect(cover.src.w).toBeLessThan(4000);
  });

  it("어떤 맞춤이든 그린 그림이 캔버스를 넘지 않는다", () => {
    const fits: FitMode[] = ["contain", "cover", "stretch"];
    for (const fit of fits) {
      const plan = fitPlan(4000, 3000, 1000, 700, fit);
      expect(plan.draw.w).toBeLessThanOrEqual(1000);
      expect(plan.draw.h).toBeLessThanOrEqual(700);
      expectSane(plan.draw);
    }
  });
});

describe("effectiveFit — 맞춤이 실제로 갈리는 곳", () => {
  it("exact 모드에서만 사용자가 고른 맞춤이 그대로 쓰인다", () => {
    expect(effectiveFit(spec({ mode: "exact", fit: "contain" }))).toBe("contain");
    expect(effectiveFit(spec({ mode: "exact", fit: "cover" }))).toBe("cover");
    expect(effectiveFit(spec({ mode: "exact", fit: "stretch" }))).toBe("stretch");
  });

  it("exact가 아니면 맞춤을 무엇으로 골라 뒀든 stretch로 떨어진다 — 목표가 이미 비율을 지킨다", () => {
    for (const mode of ["none", "scale", "width", "height", "longest"] as const) {
      expect(effectiveFit(spec({ mode, fit: "cover" }))).toBe("stretch");
      expect(effectiveFit(spec({ mode, fit: "contain" }))).toBe("stretch");
    }
  });

  it("비율 유지 모드에서 stretch는 사실 아무것도 늘리지 않는다", () => {
    // longest로 계산한 목표에 stretch를 걸면 draw == 목표이고 원본 비율과 같다
    const t = targetSize(4000, 3000, spec({ mode: "longest", longest: 1000 }));
    const plan = fitPlan(4000, 3000, t.w, t.h, effectiveFit(spec({ mode: "longest" })));
    expect(plan.draw).toEqual({ w: 1000, h: 750 });
    expect(plan.src).toEqual({ w: 4000, h: 3000 });
    expect(plan.draw.w / plan.draw.h).toBeCloseTo(4000 / 3000, 5);
  });
});

describe("두 함수를 이어 붙인 결과 — 화면 안내문이 읽는 값", () => {
  it("exact + contain: 4000×3000을 1000×1000에 넣으면 1000×750이 그려지고 위아래 125px씩 비운다", () => {
    const t = targetSize(4000, 3000, spec({ mode: "exact", width: 1000, height: 1000 }));
    const fit = effectiveFit(spec({ mode: "exact", fit: "contain" }));
    const plan = fitPlan(4000, 3000, t.w, t.h, fit);
    expect(t).toEqual({ w: 1000, h: 1000 });
    expect(plan.draw).toEqual({ w: 1000, h: 750 });
    expect((t.h - plan.draw.h) / 2).toBe(125);
  });

  it("exact + cover: 같은 그림을 1000×1000에 채우면 원본 좌우 500px씩이 잘려 나간다", () => {
    const t = targetSize(4000, 3000, spec({ mode: "exact", width: 1000, height: 1000 }));
    const fit = effectiveFit(spec({ mode: "exact", fit: "cover" }));
    const plan = fitPlan(4000, 3000, t.w, t.h, fit);
    expect(plan.draw).toEqual({ w: 1000, h: 1000 });
    expect(plan.src).toEqual({ w: 3000, h: 3000 });
    expect((4000 - plan.src.w) / 2).toBe(500);
  });

  it("어떤 모드·맞춤 조합에서도 캔버스와 그림이 0이나 음수가 되지 않는다", () => {
    const modes = ["none", "scale", "width", "height", "longest", "exact"] as const;
    const fits: FitMode[] = ["stretch", "contain", "cover"];
    const sources: Array<[number, number]> = [
      [1, 1],
      [1, 10000],
      [10000, 1],
      [500, 500],
      [4000, 3000],
    ];
    for (const mode of modes) {
      for (const fit of fits) {
        for (const noEnlarge of [false, true]) {
          for (const [bw, bh] of sources) {
            const s = spec({
              mode,
              fit,
              noEnlarge,
              scale: 1,
              width: 1,
              height: 1,
              longest: 1,
            });
            const t = targetSize(bw, bh, s);
            expectSane(t);
            const plan = fitPlan(bw, bh, t.w, t.h, effectiveFit(s));
            expectSane(plan.draw);
            expectSane(plan.src);
          }
        }
      }
    }
  });
});

describe("원본 변이 0이거나 숫자가 아니어도 캔버스가 NaN이 되지 않는다", () => {
  // 비율을 잇는 세 모드는 원본 변으로 나눈다. 원본이 0이면 0/0 = NaN이고
  // Math.max(1, NaN)은 NaN이라 붙잡히지 않는다 — 그 NaN이 canvas.width로 간다.
  it("가로 맞춤에서 원본 가로가 0이면 세로는 원본 값을 그대로 둔다", () => {
    // 비율을 알 수 없으니 지정한 변만 쓴다.
    expect(targetSize(0, 600, spec({ mode: "width", width: 800 }))).toEqual({
      w: 800,
      h: 600,
    });
  });

  it("세로 맞춤에서 원본 세로가 0이면 가로는 원본 값을 그대로 둔다", () => {
    expect(targetSize(800, 0, spec({ mode: "height", height: 400 }))).toEqual({
      w: 800,
      h: 400,
    });
  });

  it("긴 변 모드에서 원본이 0×0이어도 1px 아래로 내려가지 않는다", () => {
    expectSane(targetSize(0, 0, spec({ mode: "longest", longest: 100 })));
  });

  it("원본 변이 0인 모든 모드·맞춤 조합에서 결과가 정수 1px 이상이다", () => {
    const modes = ["none", "scale", "width", "height", "longest", "exact"] as const;
    const fits: FitMode[] = ["stretch", "contain", "cover"];
    const broken: Array<[number, number]> = [
      [0, 0],
      [0, 600],
      [800, 0],
    ];
    for (const mode of modes) {
      for (const fit of fits) {
        for (const noEnlarge of [false, true]) {
          for (const [bw, bh] of broken) {
            const s = spec({ mode, fit, noEnlarge });
            const target = targetSize(bw, bh, s);
            expectSane(target);
            const plan = fitPlan(bw, bh, target.w, target.h, effectiveFit(s));
            expectSane(plan.draw);
            expectSane(plan.src);
          }
        }
      }
    }
  });

  it("목표 치수가 NaN이어도 캔버스는 1px로 남는다 (입력란을 비웠을 때)", () => {
    for (const mode of ["scale", "width", "height", "longest", "exact"] as const) {
      const s = spec({
        mode,
        scale: Number.NaN,
        width: Number.NaN,
        height: Number.NaN,
        longest: Number.NaN,
      });
      expectSane(targetSize(800, 600, s));
    }
  });

  it("fitPlan도 원본 변이 0이면 1px로 붙잡는다", () => {
    for (const fit of ["stretch", "contain", "cover"] as FitMode[]) {
      const plan = fitPlan(0, 600, 100, 100, fit);
      expectSane(plan.draw);
      expectSane(plan.src);
    }
  });
});

describe("안내용 계산을 따로 만들지 않는다 (CLAUDE.md 22)", () => {
  const read = (rel: string) =>
    readFileSync(new URL(`../apps/image/src/lib/${rel}`, import.meta.url), "utf8");

  it("패널(안내문)과 파이프라인(실제 산출물)이 같은 size 모듈을 부른다", () => {
    for (const file of ["editor/Panel.svelte", "image/pipeline.ts"]) {
      const src = read(file);
      const line = src
        .split("\n")
        .find((l) => l.includes("import") && /["']\.{1,2}\/(\.\.\/)?image\/size|\.\/size["']/.test(l));
      expect(line, `${file}이 size 모듈을 import하지 않는다`).toBeTruthy();
      expect(line).toContain("targetSize");
      expect(line).toContain("fitPlan");
      expect(line).toContain("effectiveFit");
    }
  });

  it("확대 안 함 체크박스는 width·height·longest 세 모드에서만 뜬다", () => {
    // 배율은 사용자가 확대를 명시한 것이고 exact는 캔버스가 고정이라 해당 없음.
    const panel = read("editor/Panel.svelte");
    const decl = panel.match(/NO_ENLARGE_MODES[^=]*=\s*\[([^\]]*)\]/);
    expect(decl, "Panel.svelte에 NO_ENLARGE_MODES 선언이 없다").toBeTruthy();
    const modes = [...decl![1].matchAll(/["']([a-z]+)["']/g)].map((m) => m[1]);
    expect(modes).toEqual(["width", "height", "longest"]);
  });

  it("체크박스가 뜨는 모드에서만 확대 안 함이 결과를 바꾼다", () => {
    // 원본 800×600, 목표는 전부 원본보다 크게 잡는다.
    const bigger: Record<string, ResizeSpec> = {
      width: spec({ mode: "width", width: 1600 }),
      height: spec({ mode: "height", height: 1200 }),
      longest: spec({ mode: "longest", longest: 1600 }),
      scale: spec({ mode: "scale", scale: 200 }),
      exact: spec({ mode: "exact", width: 1600, height: 1200 }),
      none: spec({ mode: "none" }),
    };
    const changes = (s: ResizeSpec) => {
      const off = targetSize(800, 600, { ...s, noEnlarge: false });
      const on = targetSize(800, 600, { ...s, noEnlarge: true });
      return off.w !== on.w || off.h !== on.h;
    };
    expect(changes(bigger.width)).toBe(true);
    expect(changes(bigger.height)).toBe(true);
    expect(changes(bigger.longest)).toBe(true);
    expect(changes(bigger.scale)).toBe(false);
    expect(changes(bigger.exact)).toBe(false);
    expect(changes(bigger.none)).toBe(false);
  });
});
