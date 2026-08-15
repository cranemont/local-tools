import { describe, expect, it } from "vitest";

import {
  BLUR_MAX_RADIUS,
  BLUR_MIN_RADIUS,
  MOSAIC_MAX_BLOCK,
  MOSAIC_MIN_BLOCK,
  REDACT_MIN_SIZE,
  applyRedactPatch,
  blurRadiusPx,
  blurSampleRect,
  clampStrength,
  defaultStrength,
  isRegionOnFrame,
  isRegionUnseen,
  mosaicBlockPx,
  mosaicGrid,
  newRegion,
  normalizeRegionRect,
  outputToRegion,
  regionToOutput,
  regionsForFrame,
  selectionAffectsRegions,
  unseenRegionCount,
  type RedactGeometry,
  type RedactRegion,
} from "../apps/gif/src/lib/gif/redact";
import { isOverlayOnFrame, type TextOverlay } from "../apps/gif/src/lib/gif/overlay";
import { snapshotPlan } from "../apps/gif/src/lib/gif/plan";
import { outputSize } from "../apps/gif/src/lib/gif/transform";
import type { Frame, FrameSource, Transform } from "../apps/gif/src/lib/gif/types";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 apps/gif 가리기 영역(모자이크·블러)의 명세다.
//
// 영역은 **베이스 캔버스 좌표**에 적힌다(크롭과 같은 자리). 그래서 나중에 크롭·회전·배율을
// 바꿔도 같은 곳을 덮고, 그리는 순간 regionToOutput이 그때의 변형으로 옮겨 놓는다.
// 미리보기와 네 인코더(gif·webp·mp4·png)가 전부 renderFrame 하나를 지나므로,
// 여기 있는 순수 함수가 맞으면 "화면과 결과가 다르다"가 생길 자리가 없다.
//
// 캔버스가 필요한 것(축소했다 늘리기·ctx.filter)은 여기서 재지 않는다 — 그건 실기 확인의 몫이다.
// 기대값은 구현을 베끼지 않고 손으로 계산한 값이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 기본 영역 — 각 테스트는 자기가 쓰는 칸만 덮어쓴다. */
function rg(over: Partial<RedactRegion> = {}): RedactRegion {
  return {
    id: "r1",
    mode: "mosaic",
    x: 10,
    y: 10,
    w: 20,
    h: 20,
    strength: 8,
    scope: "all",
    from: 1,
    to: 1,
    ...over,
  };
}

/** 기본 변형 — 크롭 없음, 회전 없음, 배율 1. */
function geo(over: Partial<RedactGeometry> = {}): RedactGeometry {
  return { crop: null, rotation: 0, flipH: false, flipV: false, scale: 1, ...over };
}

/** 베이스 크기와 변형에서 출력 캔버스 크기를 얻는다 — 화면·인코더가 쓰는 함수 그대로다. */
function out(baseW: number, baseH: number, g: RedactGeometry) {
  return outputSize(baseW, baseH, g as Transform);
}

describe("영역 좌표 정규화 (normalizeRegionRect)", () => {
  it("소수 좌표를 정수로 여민다 — 캔버스는 픽셀 단위로만 그린다", () => {
    expect(normalizeRegionRect({ x: 10.2, y: 20.7, w: 30.1, h: 10.4 }, 100, 100)).toEqual({
      x: 10,
      y: 21,
      w: 30,
      h: 10,
    });
  });

  it("음수 폭·높이는 반대쪽 모서리에서 끈 것으로 읽는다", () => {
    expect(normalizeRegionRect({ x: 50, y: 50, w: -20, h: -30 }, 100, 100)).toEqual({
      x: 30,
      y: 20,
      w: 20,
      h: 30,
    });
  });

  it("0 크기는 영역이 아니다 — null", () => {
    expect(normalizeRegionRect({ x: 10, y: 10, w: 0, h: 20 }, 100, 100)).toBeNull();
    expect(normalizeRegionRect({ x: 10, y: 10, w: 20, h: 0 }, 100, 100)).toBeNull();
    expect(normalizeRegionRect({ x: 10, y: 10, w: 0, h: 0 }, 100, 100)).toBeNull();
  });

  it("최소 크기(4px) 밑은 잘못 찍은 클릭으로 보고 버린다", () => {
    expect(REDACT_MIN_SIZE).toBe(4);
    expect(normalizeRegionRect({ x: 10, y: 10, w: 3, h: 20 }, 100, 100)).toBeNull();
    expect(normalizeRegionRect({ x: 10, y: 10, w: 20, h: 3 }, 100, 100)).toBeNull();
    expect(normalizeRegionRect({ x: 10, y: 10, w: 4, h: 4 }, 100, 100)).toEqual({
      x: 10,
      y: 10,
      w: 4,
      h: 4,
    });
  });

  it("캔버스 왼쪽·위로 넘어간 부분은 잘라 낸다", () => {
    expect(normalizeRegionRect({ x: -30, y: -30, w: 60, h: 60 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 30,
    });
  });

  it("캔버스 오른쪽·아래로 넘어간 부분도 잘라 낸다", () => {
    expect(normalizeRegionRect({ x: 80, y: 80, w: 50, h: 50 }, 100, 100)).toEqual({
      x: 80,
      y: 80,
      w: 20,
      h: 20,
    });
  });

  it("캔버스 밖에서만 끈 사각형은 남는 것이 없다 — null", () => {
    expect(normalizeRegionRect({ x: 120, y: 120, w: 30, h: 30 }, 100, 100)).toBeNull();
    expect(normalizeRegionRect({ x: -50, y: -50, w: 30, h: 30 }, 100, 100)).toBeNull();
  });

  it("잘라 낸 나머지가 최소 크기 밑이면 버린다", () => {
    // 98..128 → 98..100, 폭 2px만 남는다
    expect(normalizeRegionRect({ x: 98, y: 10, w: 30, h: 30 }, 100, 100)).toBeNull();
  });

  it("빈 칸·NaN은 0으로 읽는다 — 화면에서 그런 값이 온다", () => {
    expect(normalizeRegionRect({ x: Number.NaN, y: 10, w: 20, h: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 10,
      w: 20,
      h: 20,
    });
    expect(normalizeRegionRect({ w: 20, h: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      w: 20,
      h: 20,
    });
  });
});

describe("세기 — 모드마다 범위가 다르다", () => {
  it("격자는 2..200px로 가둔다 — 1px 격자는 원본 픽셀이라 아무것도 못 가린다", () => {
    expect(MOSAIC_MIN_BLOCK).toBe(2);
    expect(clampStrength("mosaic", 1)).toBe(MOSAIC_MIN_BLOCK);
    expect(clampStrength("mosaic", 0)).toBe(MOSAIC_MIN_BLOCK);
    expect(clampStrength("mosaic", -40)).toBe(MOSAIC_MIN_BLOCK);
    expect(clampStrength("mosaic", 500)).toBe(MOSAIC_MAX_BLOCK);
    expect(clampStrength("mosaic", 12)).toBe(12);
  });

  it("블러 반경은 1..100px로 가둔다 — 0이면 흐리지 않는다", () => {
    expect(clampStrength("blur", 0)).toBe(BLUR_MIN_RADIUS);
    expect(clampStrength("blur", 500)).toBe(BLUR_MAX_RADIUS);
    expect(clampStrength("blur", 12)).toBe(12);
  });

  it("빈 칸·NaN은 하한으로 떨어진다", () => {
    expect(clampStrength("mosaic", Number.NaN)).toBe(MOSAIC_MIN_BLOCK);
    expect(clampStrength("blur", Number.NaN)).toBe(BLUR_MIN_RADIUS);
  });

  it("기본 세기는 영역의 짧은 변에서 나온다 — 큰 얼굴엔 큰 격자", () => {
    expect(defaultStrength("mosaic", 80, 40)).toBe(5); // 40 / 8
    expect(defaultStrength("mosaic", 400, 400)).toBe(50);
    expect(defaultStrength("blur", 80, 40)).toBe(7); // 40 / 6, 반올림
  });

  it("작은 영역에서도 하한 밑으로는 안 내려간다", () => {
    expect(defaultStrength("mosaic", 8, 8)).toBe(MOSAIC_MIN_BLOCK);
    expect(defaultStrength("blur", 4, 4)).toBe(BLUR_MIN_RADIUS);
  });
});

describe("새 영역 (newRegion)", () => {
  it("범위 기본값은 '전체'다 — 얼굴은 보통 모든 프레임에서 가린다", () => {
    const r = newRegion("a", { x: 10, y: 10, w: 40, h: 40 }, 100, 100, 7);
    expect(r).not.toBeNull();
    expect(r?.scope).toBe("all");
    expect(r?.from).toBe(1);
    expect(r?.to).toBe(7);
    expect(r?.mode).toBe("mosaic");
  });

  it("좌표는 정규화를 지나 온다 — 캔버스 밖은 잘리고 너무 작으면 만들지 않는다", () => {
    expect(newRegion("a", { x: 90, y: 90, w: 40, h: 40 }, 100, 100, 3)).toMatchObject({
      x: 90,
      y: 90,
      w: 10,
      h: 10,
    });
    expect(newRegion("a", { x: 10, y: 10, w: 2, h: 2 }, 100, 100, 3)).toBeNull();
  });

  it("블러로 만들면 세기도 블러 범위에서 나온다", () => {
    const r = newRegion("a", { x: 0, y: 0, w: 600, h: 600 }, 1000, 1000, 1, "blur");
    expect(r?.mode).toBe("blur");
    expect(r?.strength).toBe(BLUR_MAX_RADIUS); // 600 / 6 = 100
  });

  it("프레임이 없으면 구간 끝은 1이다", () => {
    expect(newRegion("a", { x: 0, y: 0, w: 40, h: 40 }, 100, 100, 0)?.to).toBe(1);
  });
});

describe("칸 하나 편집 (applyRedactPatch)", () => {
  it("원본을 고치지 않고 새 객체로 돌려준다", () => {
    const r = rg({ strength: 8 });
    const next = applyRedactPatch(r, { strength: 20 }, 5);
    expect(r.strength).toBe(8);
    expect(next.strength).toBe(20);
    expect(next).not.toBe(r);
  });

  it("세기는 **바뀐 뒤의 모드**로 가둔다 — 격자 200에서 블러로 옮기면 100이다", () => {
    const r = rg({ mode: "mosaic", strength: MOSAIC_MAX_BLOCK });
    expect(applyRedactPatch(r, { mode: "blur" }, 5).strength).toBe(BLUR_MAX_RADIUS);
  });

  it("id는 못 바꾼다", () => {
    const r = rg({ id: "keep" });
    const next = applyRedactPatch(r, { id: "other" } as never, 5);
    expect(next.id).toBe("keep");
  });

  it("구간 번호는 이번에 적은 칸만 가둔다 — 세기만 고쳐도 구간이 줄면 안 된다", () => {
    const r = rg({ scope: "range", from: 3, to: 40 });
    // 프레임이 5장으로 줄어든 뒤 세기만 고친다
    const next = applyRedactPatch(r, { strength: 12 }, 5);
    expect(next.from).toBe(3);
    expect(next.to).toBe(40);
    // 구간 칸을 직접 적으면 그때 가둬진다
    expect(applyRedactPatch(r, { to: 40 }, 5).to).toBe(5);
    expect(applyRedactPatch(r, { from: 0 }, 5).from).toBe(1);
  });
});

describe("프레임 범위 판정 — 텍스트와 같은 규약", () => {
  it("'전체'는 선택 여부와 상관없이 모든 프레임에 걸린다", () => {
    const r = rg({ scope: "all", from: 5, to: 6 });
    for (const i of [0, 1, 7, 999]) {
      expect(isRegionOnFrame(r, i, false)).toBe(true);
      expect(isRegionOnFrame(r, i, true)).toBe(true);
    }
  });

  it("'선택'은 살아 있는 선택을 읽는다", () => {
    const r = rg({ scope: "selected" });
    expect(isRegionOnFrame(r, 0, true)).toBe(true);
    expect(isRegionOnFrame(r, 0, false)).toBe(false);
  });

  it("구간은 1-based 포함이고 경계가 정확하다 — 3~5는 인덱스 2·3·4", () => {
    const r = rg({ scope: "range", from: 3, to: 5 });
    expect(isRegionOnFrame(r, 0, false)).toBe(false);
    expect(isRegionOnFrame(r, 1, false)).toBe(false);
    expect(isRegionOnFrame(r, 2, false)).toBe(true); // 3번 프레임
    expect(isRegionOnFrame(r, 3, false)).toBe(true);
    expect(isRegionOnFrame(r, 4, false)).toBe(true); // 5번 프레임
    expect(isRegionOnFrame(r, 5, false)).toBe(false);
  });

  it("한 장짜리 구간도 그 한 장에 걸린다", () => {
    const r = rg({ scope: "range", from: 4, to: 4 });
    expect(isRegionOnFrame(r, 2, false)).toBe(false);
    expect(isRegionOnFrame(r, 3, false)).toBe(true);
    expect(isRegionOnFrame(r, 4, false)).toBe(false);
  });

  it("거꾸로 적은 구간(10~3)도 같은 구간으로 읽는다", () => {
    const r = rg({ scope: "range", from: 10, to: 3 });
    expect(isRegionOnFrame(r, 1, false)).toBe(false);
    expect(isRegionOnFrame(r, 2, false)).toBe(true);
    expect(isRegionOnFrame(r, 9, false)).toBe(true);
    expect(isRegionOnFrame(r, 10, false)).toBe(false);
  });

  it("같은 범위를 적은 자막과 영역은 언제나 같은 프레임에 걸린다", () => {
    // 판정 함수가 두 벌이 되면 여기서 갈린다 — 자막은 붙는데 모자이크는 안 붙는 프레임이 생긴다.
    const cases: { scope: "all" | "selected" | "range"; from: number; to: number }[] = [
      { scope: "all", from: 1, to: 1 },
      { scope: "selected", from: 1, to: 1 },
      { scope: "range", from: 2, to: 4 },
      { scope: "range", from: 9, to: 2 },
      { scope: "range", from: 0, to: 0 },
    ];
    for (const c of cases) {
      const region = rg(c);
      const overlay = { text: "자막", ...c } as TextOverlay;
      for (let i = 0; i < 12; i++) {
        for (const selected of [false, true]) {
          expect(isRegionOnFrame(region, i, selected)).toBe(
            isOverlayOnFrame(overlay, i, selected),
          );
        }
      }
    }
  });

  it("이 프레임에 걸리는 영역만 목록 순서 그대로 추린다", () => {
    const regions = [
      rg({ id: "a", scope: "all" }),
      rg({ id: "b", scope: "range", from: 1, to: 1 }),
      rg({ id: "c", scope: "selected" }),
    ];
    expect(regionsForFrame(regions, 0, false).map((r) => r.id)).toEqual(["a", "b"]);
    expect(regionsForFrame(regions, 0, true).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(regionsForFrame(regions, 3, false).map((r) => r.id)).toEqual(["a"]);
  });

  it("'선택' 영역이 하나라도 있으면 선택을 바꿀 때 그림이 바뀐다", () => {
    expect(selectionAffectsRegions([rg({ scope: "all" })])).toBe(false);
    expect(selectionAffectsRegions([rg({ scope: "range" })])).toBe(false);
    expect(selectionAffectsRegions([rg({ scope: "all" }), rg({ scope: "selected" })])).toBe(
      true,
    );
    expect(selectionAffectsRegions([])).toBe(false);
  });
});

describe("좌표계 변환 — 베이스에서 출력으로 (regionToOutput)", () => {
  it("변형이 없으면 좌표가 그대로다", () => {
    const g = geo();
    expect(regionToOutput(rg(), 100, 100, out(100, 100, g), g)).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 20,
    });
  });

  it("크롭은 원점을 옮긴다 — 영역이 크롭 좌상단 기준으로 다시 그려진다", () => {
    const g = geo({ crop: { x: 20, y: 10, w: 60, h: 40 } });
    const o = out(100, 100, g);
    expect(o).toEqual({ w: 60, h: 40 });
    expect(regionToOutput(rg({ x: 30, y: 20, w: 20, h: 10 }), 100, 100, o, g)).toEqual({
      x: 10, // 30 - 20
      y: 10, // 20 - 10
      w: 20,
      h: 10,
    });
  });

  it("크롭이 영역을 반만 자르면 남은 절반만 가린다", () => {
    const g = geo({ crop: { x: 0, y: 0, w: 50, h: 50 } });
    const o = out(100, 100, g);
    // 영역 30..70 중 크롭 안쪽 30..50만 남는다
    expect(regionToOutput(rg({ x: 30, y: 30, w: 40, h: 40 }), 100, 100, o, g)).toEqual({
      x: 30,
      y: 30,
      w: 20,
      h: 20,
    });
  });

  it("영역이 크롭 밖으로 벗어나면 null — 그 프레임에는 그리지 않는다", () => {
    const g = geo({ crop: { x: 0, y: 0, w: 50, h: 50 } });
    const o = out(100, 100, g);
    expect(regionToOutput(rg({ x: 60, y: 60, w: 20, h: 20 }), 100, 100, o, g)).toBeNull();
  });

  it("크롭 경계에 딱 붙은 영역은 살아남는다", () => {
    const g = geo({ crop: { x: 0, y: 0, w: 50, h: 50 } });
    const o = out(100, 100, g);
    expect(regionToOutput(rg({ x: 46, y: 46, w: 8, h: 8 }), 100, 100, o, g)).toEqual({
      x: 46,
      y: 46,
      w: 4,
      h: 4,
    });
  });

  it("90° 회전에서는 가로·세로가 바뀌고 왼쪽 위가 오른쪽 위로 간다", () => {
    const g = geo({ rotation: 90 });
    const o = out(100, 60, g);
    expect(o).toEqual({ w: 60, h: 100 });
    expect(regionToOutput(rg({ x: 10, y: 5, w: 20, h: 10 }), 100, 60, o, g)).toEqual({
      x: 45,
      y: 10,
      w: 10,
      h: 20,
    });
  });

  it("180° 회전은 두 축을 함께 뒤집는다", () => {
    const g = geo({ rotation: 180 });
    const o = out(100, 60, g);
    expect(o).toEqual({ w: 100, h: 60 });
    expect(regionToOutput(rg({ x: 10, y: 5, w: 20, h: 10 }), 100, 60, o, g)).toEqual({
      x: 70, // 100 - 30
      y: 45, // 60 - 15
      w: 20,
      h: 10,
    });
  });

  it("270° 회전에서는 왼쪽 위가 왼쪽 아래로 간다", () => {
    const g = geo({ rotation: 270 });
    const o = out(100, 60, g);
    expect(regionToOutput(rg({ x: 10, y: 5, w: 20, h: 10 }), 100, 60, o, g)).toEqual({
      x: 5,
      y: 70,
      w: 10,
      h: 20,
    });
  });

  it("좌우 뒤집기는 x를 거울에 비춘다", () => {
    const g = geo({ flipH: true });
    const o = out(100, 60, g);
    expect(regionToOutput(rg({ x: 10, y: 5, w: 20, h: 10 }), 100, 60, o, g)).toEqual({
      x: 70, // 100 - 30
      y: 5,
      w: 20,
      h: 10,
    });
  });

  it("상하 뒤집기는 y를 거울에 비춘다", () => {
    const g = geo({ flipV: true });
    const o = out(100, 60, g);
    expect(regionToOutput(rg({ x: 10, y: 5, w: 20, h: 10 }), 100, 60, o, g)).toEqual({
      x: 10,
      y: 45, // 60 - 15
      w: 20,
      h: 10,
    });
  });

  it("배율 25%에서는 영역도 25%로 줄고 반 픽셀은 바깥으로 여민다", () => {
    const g = geo({ scale: 0.25 });
    const o = out(100, 100, g);
    expect(o).toEqual({ w: 25, h: 25 });
    // 10..30 → 2.5..7.5 → 바깥으로 여며 2..8
    expect(regionToOutput(rg({ x: 10, y: 10, w: 20, h: 20 }), 100, 100, o, g)).toEqual({
      x: 2,
      y: 2,
      w: 6,
      h: 6,
    });
  });

  it("배율 200%에서는 영역도 두 배가 된다", () => {
    const g = geo({ scale: 2 });
    const o = out(100, 100, g);
    expect(regionToOutput(rg({ x: 10, y: 10, w: 20, h: 20 }), 100, 100, o, g)).toEqual({
      x: 20,
      y: 20,
      w: 40,
      h: 40,
    });
  });

  it("크롭·회전·배율이 함께 걸려도 한 번에 옮긴다", () => {
    const g = geo({ crop: { x: 20, y: 10, w: 60, h: 40 }, rotation: 90, scale: 0.5 });
    const o = out(100, 100, g);
    expect(o).toEqual({ w: 20, h: 30 }); // 40×60의 절반
    // 크롭 기준 (10,10)-(30,20) → 회전으로 (h - y) 축이 x가 된다
    expect(regionToOutput(rg({ x: 30, y: 20, w: 20, h: 10 }), 100, 100, o, g)).toEqual({
      x: 10, // (40 - 20) * 0.5
      y: 5, // 10 * 0.5
      w: 5,
      h: 10,
    });
  });

  it("배율이 0·음수·NaN이면 1로 본다 — 영역이 사라지지 않는다", () => {
    for (const scale of [0, -1, Number.NaN]) {
      const g = geo({ scale });
      expect(regionToOutput(rg(), 100, 100, { w: 100, h: 100 }, g)).toEqual({
        x: 10,
        y: 10,
        w: 20,
        h: 20,
      });
    }
  });
});

describe("좌표계 변환 — 출력에서 베이스로 (outputToRegion)", () => {
  it("변형이 없으면 그대로 돌아온다", () => {
    const g = geo();
    expect(outputToRegion({ x: 10, y: 10, w: 20, h: 20 }, 100, 100, out(100, 100, g), g)).toEqual(
      { x: 10, y: 10, w: 20, h: 20 },
    );
  });

  it("크롭이 걸린 화면에서 끌면 크롭 원점을 더해 저장한다", () => {
    const g = geo({ crop: { x: 20, y: 10, w: 60, h: 40 } });
    expect(outputToRegion({ x: 10, y: 10, w: 20, h: 10 }, 100, 100, out(100, 100, g), g)).toEqual(
      { x: 30, y: 20, w: 20, h: 10 },
    );
  });

  it("회전·뒤집기·배율을 되돌린 자리에 저장한다 — 왕복하면 제자리다", () => {
    const cases: Partial<RedactGeometry>[] = [
      {},
      { rotation: 90 },
      { rotation: 180 },
      { rotation: 270 },
      { flipH: true },
      { flipV: true },
      { scale: 0.5 },
      { scale: 2 },
      { crop: { x: 20, y: 10, w: 60, h: 40 }, rotation: 90, scale: 0.5 },
    ];
    const region = { x: 30, y: 20, w: 20, h: 10 };
    for (const over of cases) {
      const g = geo(over);
      const o = out(100, 100, g);
      const box = regionToOutput(region, 100, 100, o, g);
      expect(box).not.toBeNull();
      expect(outputToRegion(box!, 100, 100, o, g)).toEqual(region);
    }
  });

  it("확대해서 보는 중에 끈 사각형은 원본 크기로 줄여 저장한다", () => {
    const g = geo({ scale: 2 });
    expect(outputToRegion({ x: 20, y: 20, w: 40, h: 40 }, 100, 100, out(100, 100, g), g)).toEqual(
      { x: 10, y: 10, w: 20, h: 20 },
    );
  });

  it("확대 배율에서 아주 작게 끈 것은 원본에서 최소 크기 밑이라 버린다", () => {
    const g = geo({ scale: 4 });
    // 출력 12px = 원본 3px
    expect(outputToRegion({ x: 40, y: 40, w: 12, h: 12 }, 100, 100, out(100, 100, g), g)).toBeNull();
  });

  it("캔버스 밖까지 끌어도 베이스 안으로 여며진다", () => {
    const g = geo();
    expect(
      outputToRegion({ x: -20, y: -20, w: 200, h: 200 }, 100, 100, out(100, 100, g), g),
    ).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe("세기를 배율에 맞춘다", () => {
  it("격자는 배율을 따라간다 — 화면과 결과가 같은 그림이어야 한다", () => {
    expect(mosaicBlockPx(8, 1)).toBe(8);
    expect(mosaicBlockPx(16, 0.25)).toBe(4);
    expect(mosaicBlockPx(8, 2)).toBe(16);
  });

  it("배율 25%에서 격자가 1px 밑으로 내려가도 2px에서 멈춘다", () => {
    // 1px 격자는 원본 픽셀이라 가리기를 그만두는 것이다.
    expect(mosaicBlockPx(2, 0.25)).toBe(MOSAIC_MIN_BLOCK);
    expect(mosaicBlockPx(4, 0.25)).toBe(MOSAIC_MIN_BLOCK);
    expect(mosaicBlockPx(5, 0.1)).toBe(MOSAIC_MIN_BLOCK);
    expect(mosaicBlockPx(MOSAIC_MAX_BLOCK, 0.005)).toBe(MOSAIC_MIN_BLOCK);
  });

  it("격자 값 자체도 먼저 범위 안으로 가둔다", () => {
    expect(mosaicBlockPx(0, 1)).toBe(MOSAIC_MIN_BLOCK);
    expect(mosaicBlockPx(10_000, 1)).toBe(MOSAIC_MAX_BLOCK);
  });

  it("블러 반경도 배율을 따라가고 1px에서 멈춘다", () => {
    expect(blurRadiusPx(8, 1)).toBe(8);
    expect(blurRadiusPx(8, 0.25)).toBe(2);
    expect(blurRadiusPx(2, 0.25)).toBe(BLUR_MIN_RADIUS);
    expect(blurRadiusPx(8, 2)).toBe(16);
  });

  it("배율이 0·음수·NaN이면 1로 본다", () => {
    for (const scale of [0, -2, Number.NaN]) {
      expect(mosaicBlockPx(8, scale)).toBe(8);
      expect(blurRadiusPx(8, scale)).toBe(8);
    }
  });

  it("모자이크 칸 수는 영역을 격자로 나눈 값이고 최소 한 칸이다", () => {
    expect(mosaicGrid({ x: 0, y: 0, w: 100, h: 50 }, 10)).toEqual({ w: 10, h: 5 });
    expect(mosaicGrid({ x: 0, y: 0, w: 6, h: 6 }, 100)).toEqual({ w: 1, h: 1 });
    expect(mosaicGrid({ x: 0, y: 0, w: 25, h: 25 }, 10)).toEqual({ w: 3, h: 3 });
  });
});

describe("블러 표본 상자 (blurSampleRect)", () => {
  it("반경의 세 배만큼 넓게 뜬다 — 좁게 뜨면 테두리가 밖을 빨아들인다", () => {
    expect(blurSampleRect({ x: 50, y: 50, w: 20, h: 20 }, 4, { w: 200, h: 200 })).toEqual({
      x: 38,
      y: 38,
      w: 44,
      h: 44,
    });
  });

  it("출력 캔버스 밖으로는 안 나간다", () => {
    expect(blurSampleRect({ x: 0, y: 0, w: 20, h: 20 }, 4, { w: 30, h: 30 })).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 30,
    });
  });

  it("반경이 0이면 영역 그대로다", () => {
    expect(blurSampleRect({ x: 10, y: 10, w: 20, h: 20 }, 0, { w: 100, h: 100 })).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 20,
    });
  });
});

describe("결과에 안 나오는 영역 세기 (isRegionUnseen)", () => {
  function vis(over: Partial<Parameters<typeof isRegionUnseen>[1]> = {}) {
    return {
      frameCount: 5,
      selectedCount: 2,
      baseW: 100,
      baseH: 100,
      out: { w: 100, h: 100 },
      tf: geo(),
      ...over,
    };
  }

  it("보통은 안 나오지 않는다", () => {
    expect(isRegionUnseen(rg(), vis())).toBe(false);
  });

  it("프레임이 없으면 그릴 자리가 없다", () => {
    expect(isRegionUnseen(rg(), vis({ frameCount: 0 }))).toBe(true);
  });

  it("'선택' 영역인데 선택이 비었으면 안 나온다", () => {
    expect(isRegionUnseen(rg({ scope: "selected" }), vis({ selectedCount: 0 }))).toBe(true);
    expect(isRegionUnseen(rg({ scope: "selected" }), vis({ selectedCount: 1 }))).toBe(false);
  });

  it("구간이 프레임 수 밖이면 안 나온다", () => {
    expect(isRegionUnseen(rg({ scope: "range", from: 9, to: 12 }), vis())).toBe(true);
    expect(isRegionUnseen(rg({ scope: "range", from: 4, to: 12 }), vis())).toBe(false);
  });

  it("크롭이 영역을 잘라내도 안 나온다 — 범위와 이유가 달라도 사용자에겐 같은 사실이다", () => {
    const tf = geo({ crop: { x: 0, y: 0, w: 50, h: 50 } });
    const v = vis({ tf, out: { w: 50, h: 50 } });
    expect(isRegionUnseen(rg({ x: 60, y: 60, w: 20, h: 20 }), v)).toBe(true);
    expect(isRegionUnseen(rg({ x: 10, y: 10, w: 20, h: 20 }), v)).toBe(false);
  });

  it("목록 전체를 센다 — 편집 중인 것만 보면 화면이 조용해진다", () => {
    const regions = [
      rg({ id: "a" }),
      rg({ id: "b", scope: "range", from: 40, to: 50 }),
      rg({ id: "c", scope: "selected" }),
    ];
    expect(unseenRegionCount(regions, vis({ selectedCount: 0 }))).toBe(2);
    expect(unseenRegionCount(regions, vis())).toBe(1);
    expect(unseenRegionCount([], vis())).toBe(0);
  });
});

describe("인코딩 시작 시점에 영역도 함께 굳는다 (snapshotPlan)", () => {
  function source(id: string): FrameSource {
    return {
      id,
      kind: "still",
      name: `${id}.png`,
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>,
      width: 40,
      height: 30,
      frameCount: 1,
    };
  }

  function frame(id: string): Frame {
    return {
      id,
      sourceId: "s1",
      frameIndex: 0,
      delayMs: 100,
      selected: false,
      thumb: "data:,",
    };
  }

  function input(regions: RedactRegion[]) {
    return {
      frames: [frame("f1"), frame("f2")],
      sources: new Map([["s1", source("s1")]]),
      transform: { ...geo(), redact: regions } as Transform,
      overlays: [],
      baseW: 40,
      baseH: 30,
    };
  }

  it("계획은 자기 영역 목록을 들고 간다", () => {
    const plan = snapshotPlan(input([rg({ id: "a" })]));
    expect(plan.transform.redact.map((r) => r.id)).toEqual(["a"]);
  });

  it("인코딩 도중 영역을 지워도 그 인코딩은 계속 가린다", () => {
    const live = input([rg({ id: "a" }), rg({ id: "b" })]);
    const plan = snapshotPlan(live);
    live.transform.redact = [];
    expect(plan.transform.redact.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("영역의 칸을 제자리에서 고쳐도 그 인코딩은 시작할 때의 값을 본다", () => {
    const region = rg({ id: "a", strength: 8, mode: "mosaic" });
    const plan = snapshotPlan(input([region]));
    region.strength = 40;
    region.mode = "blur";
    expect(plan.transform.redact[0].strength).toBe(8);
    expect(plan.transform.redact[0].mode).toBe("mosaic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 아래는 검증 단계에서 더한 경계다. 화면에서 오는 수(빈 칸·NaN)와 크롭 모드 미리보기가
// 기대는 성질을 못 박아 둔다.
// ─────────────────────────────────────────────────────────────────────────────

describe("화면에서 오는 이상한 수", () => {
  it("세기 칸을 비우면 하한으로 떨어지고 구간 칸을 비우면 1이 된다", () => {
    const r = rg({ scope: "range", from: 3, to: 5, strength: 20 });
    // 빈 칸은 Number("") === 0으로 온다
    expect(applyRedactPatch(r, { strength: 0 }, 9).strength).toBe(MOSAIC_MIN_BLOCK);
    expect(applyRedactPatch(r, { from: 0 }, 9).from).toBe(1);
    // 지우면 NaN으로 온다
    expect(applyRedactPatch(r, { strength: Number.NaN }, 9).strength).toBe(MOSAIC_MIN_BLOCK);
    expect(applyRedactPatch(r, { to: Number.NaN }, 9).to).toBe(1);
  });

  it("구간 칸이 NaN이면 1번 프레임 하나로 읽는다 — 빈 결과를 내지 않는다", () => {
    const r = rg({ scope: "range", from: Number.NaN, to: Number.NaN });
    expect(isRegionOnFrame(r, 0, false)).toBe(true);
    expect(isRegionOnFrame(r, 1, false)).toBe(false);
  });

  it("아주 큰 구간 번호도 프레임 수 안으로 가둬진다", () => {
    expect(applyRedactPatch(rg(), { to: 1e9 }, 5).to).toBe(5);
    expect(applyRedactPatch(rg(), { from: -1e9 }, 5).from).toBe(1);
  });

  it("기본 세기 계산에 NaN이 들어와도 하한 밑으로 안 내려간다", () => {
    expect(defaultStrength("mosaic", Number.NaN, Number.NaN)).toBe(MOSAIC_MIN_BLOCK);
    expect(defaultStrength("blur", Number.NaN, 60)).toBe(BLUR_MIN_RADIUS);
  });

  it("프레임 수가 NaN이면 새 영역의 구간 끝은 1이다", () => {
    expect(newRegion("a", { x: 0, y: 0, w: 40, h: 40 }, 100, 100, Number.NaN)?.to).toBe(1);
  });

  it("출력 캔버스 크기가 0·NaN이어도 계산이 무너지지 않는다", () => {
    const g = geo();
    expect(regionToOutput(rg(), 100, 100, { w: 0, h: 0 }, g)).toBeNull();
    expect(regionToOutput(rg(), 100, 100, { w: Number.NaN, h: Number.NaN }, g)).toBeNull();
  });

  it("모자이크 칸 수와 블러 표본 상자도 NaN을 견딘다", () => {
    expect(mosaicGrid({ x: 0, y: 0, w: 40, h: 40 }, Number.NaN)).toEqual({ w: 40, h: 40 });
    expect(mosaicGrid({ x: 0, y: 0, w: 40, h: 40 }, 0)).toEqual({ w: 40, h: 40 });
    expect(blurSampleRect({ x: 10, y: 10, w: 20, h: 20 }, Number.NaN, { w: 100, h: 100 })).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 20,
    });
  });
});

describe("드래그가 만드는 영역 — 미리보기가 기대는 성질", () => {
  it("출력 캔버스 밖에서만 끈 사각형은 영역이 되지 않는다", () => {
    const g = geo();
    const o = out(100, 100, g);
    expect(outputToRegion({ x: -80, y: -80, w: 40, h: 40 }, 100, 100, o, g)).toBeNull();
    expect(outputToRegion({ x: 140, y: 140, w: 40, h: 40 }, 100, 100, o, g)).toBeNull();
  });

  it("크롭 모드 미리보기(크롭 없음·회전 없음·배율 1)에서는 베이스 좌표가 그대로 나온다", () => {
    // Preview.svelte가 크롭 모드에서 이 변형으로 그린다 — 여기가 어긋나면
    // 남길 영역을 고르는 화면에서 가리기가 딴 자리에 그려진다.
    const g = geo();
    const region = rg({ x: 12, y: 34, w: 56, h: 20 });
    expect(regionToOutput(region, 100, 100, { w: 100, h: 100 }, g)).toEqual({
      x: 12,
      y: 34,
      w: 56,
      h: 20,
    });
  });

  it("추리기는 원본 목록을 고치지 않는다", () => {
    const regions = [rg({ id: "a" }), rg({ id: "b", scope: "selected" })];
    const picked = regionsForFrame(regions, 0, false);
    expect(picked).not.toBe(regions);
    expect(regions.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
