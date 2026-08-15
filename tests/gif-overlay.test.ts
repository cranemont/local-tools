import { describe, expect, it } from "vitest";

import {
  OVERLAY_ASCENT,
  OVERLAY_FONT_STACK,
  OVERLAY_FONT_WEIGHT,
  OVERLAY_LINE_HEIGHT,
  OVERLAY_MAX_FONT_SIZE,
  OVERLAY_MAX_STROKE,
  OVERLAY_MIN_FONT_SIZE,
  applyOverlayPatch,
  clampFontSize,
  clampFrameNo,
  clampStrokeWidth,
  isOverlayDrawable,
  isOverlayOnFrame,
  isOverlayUnseen,
  layoutOverlay,
  newOverlay,
  overlayFont,
  overlayMargin,
  overlayMetrics,
  overlaysForFrame,
  selectionAffectsOverlays,
  unseenOverlayCount,
  wrapLines,
  type OverlayAlign,
  type OverlayVAlign,
  type TextOverlay,
} from "../apps/gif/src/lib/gif/overlay";
import { snapshotPlan } from "../apps/gif/src/lib/gif/plan";
import type { Frame, FrameSource, Transform } from "../apps/gif/src/lib/gif/types";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 apps/gif 텍스트 오버레이의 명세다.
// 미리보기(Preview)와 네 인코더(gif·webp·mp4·png)는 전부 renderFrame 하나를 지나고,
// renderFrame은 좌표·줄바꿈을 여기 있는 순수 함수에서만 받는다 —
// "미리보기와 결과가 다르다"가 생길 수 있는 자리를 한 곳으로 모은 것이다.
// (회전·뒤집기가 글자를 돌리지 않는다는 규약은 renderFrame 쪽이라 여기서 못 잰다:
//  텍스트는 변형을 되돌린 뒤 출력 캔버스 좌표로 얹힌다.)
// 기대값은 구현을 베끼지 않고 손으로 계산한 값이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 기본 오버레이 — 각 테스트는 자기가 쓰는 칸만 덮어쓴다. */
function ov(over: Partial<TextOverlay> = {}): TextOverlay {
  return {
    id: "o1",
    text: "자막",
    vAlign: "top",
    align: "left",
    dx: 0,
    dy: 0,
    fontSize: 20,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: 0,
    scope: "all",
    from: 1,
    to: 1,
    ...over,
  };
}

/** 글자 한 칸을 10px로 세는 가짜 측정기 — 실제로는 ctx.measureText가 들어온다. */
const measure10 = (s: string) => s.length * 10;
/** 코드포인트 한 개를 10px로 세는 측정기(서로게이트 쌍 확인용). */
const measureCp = (s: string) => Array.from(s).length * 10;

describe("어느 프레임에 얹을지 — 전체 / 선택 / 구간", () => {
  it("'전체'는 선택 여부와 상관없이 모든 프레임에 얹는다", () => {
    const o = ov({ scope: "all" });
    for (const i of [0, 1, 7, 999]) {
      expect(isOverlayOnFrame(o, i, false)).toBe(true);
      expect(isOverlayOnFrame(o, i, true)).toBe(true);
    }
  });

  it("'전체'는 from·to가 무엇이든 무시한다 — 구간으로 바꾸기 전 값이 남아 있어도 된다", () => {
    const o = ov({ scope: "all", from: 5, to: 6 });
    expect(isOverlayOnFrame(o, 0, false)).toBe(true);
    expect(isOverlayOnFrame(o, 100, false)).toBe(true);
  });

  it("'선택'은 그 프레임이 지금 선택돼 있는지를 그대로 따른다", () => {
    const o = ov({ scope: "selected" });
    expect(isOverlayOnFrame(o, 0, true)).toBe(true);
    expect(isOverlayOnFrame(o, 0, false)).toBe(false);
    expect(isOverlayOnFrame(o, 42, true)).toBe(true);
  });

  it("'구간'은 1-based 번호이고 양 끝을 포함한다 (2~4 → 인덱스 1·2·3)", () => {
    const o = ov({ scope: "range", from: 2, to: 4 });
    expect(isOverlayOnFrame(o, 0, false)).toBe(false); // 1번 프레임
    expect(isOverlayOnFrame(o, 1, false)).toBe(true); // 2번 — 시작 경계
    expect(isOverlayOnFrame(o, 2, false)).toBe(true);
    expect(isOverlayOnFrame(o, 3, false)).toBe(true); // 4번 — 끝 경계
    expect(isOverlayOnFrame(o, 4, false)).toBe(false); // 5번
  });

  it("'구간'은 선택 여부를 보지 않는다 — 두 범위는 서로 독립이다", () => {
    const o = ov({ scope: "range", from: 2, to: 2 });
    expect(isOverlayOnFrame(o, 1, false)).toBe(true);
    expect(isOverlayOnFrame(o, 0, true)).toBe(false);
  });

  it("한 장짜리 구간(3~3)은 그 한 장에만 얹힌다", () => {
    const o = ov({ scope: "range", from: 3, to: 3 });
    expect(isOverlayOnFrame(o, 1, false)).toBe(false);
    expect(isOverlayOnFrame(o, 2, false)).toBe(true);
    expect(isOverlayOnFrame(o, 3, false)).toBe(false);
  });

  it("거꾸로 적은 구간(4~2)은 2~4와 같게 읽는다 — 빈 결과를 내지 않는다", () => {
    const forward = ov({ scope: "range", from: 2, to: 4 });
    const backward = ov({ scope: "range", from: 4, to: 2 });
    for (let i = 0; i < 6; i++) {
      expect(isOverlayOnFrame(backward, i, false)).toBe(isOverlayOnFrame(forward, i, false));
    }
  });

  it("소수 번호는 반올림해서 읽는다 (2.4~3.6 → 2~4)", () => {
    const o = ov({ scope: "range", from: 2.4, to: 3.6 });
    expect(isOverlayOnFrame(o, 0, false)).toBe(false);
    expect(isOverlayOnFrame(o, 1, false)).toBe(true);
    expect(isOverlayOnFrame(o, 3, false)).toBe(true);
    expect(isOverlayOnFrame(o, 4, false)).toBe(false);
  });

  it("번호 칸이 비어 NaN이 와도 1번 한 장으로 떨어진다 — 전체가 되지 않는다", () => {
    const o = ov({ scope: "range", from: Number.NaN, to: Number.NaN });
    expect(isOverlayOnFrame(o, 0, false)).toBe(true);
    expect(isOverlayOnFrame(o, 1, false)).toBe(false);
  });
});

describe("이 프레임에 실제로 그려질 것만 추린다 (overlaysForFrame)", () => {
  it("빈 글자·공백뿐인 글자는 그릴 것이 없으므로 빠진다", () => {
    const list = [
      ov({ id: "a", text: "" }),
      ov({ id: "b", text: "   " }),
      ov({ id: "c", text: "\n\n" }),
      ov({ id: "d", text: "보임" }),
    ];
    expect(overlaysForFrame(list, 0, false).map((o) => o.id)).toEqual(["d"]);
  });

  it("여러 개가 겹칠 수 있고 적은 순서 그대로 나온다 (위 자막 + 아래 자막)", () => {
    const list = [
      ov({ id: "top", text: "위", vAlign: "top" }),
      ov({ id: "bottom", text: "아래", vAlign: "bottom" }),
    ];
    expect(overlaysForFrame(list, 0, false).map((o) => o.id)).toEqual(["top", "bottom"]);
  });

  it("범위가 다른 오버레이들은 프레임마다 다른 조합으로 나온다", () => {
    const list = [
      ov({ id: "all", text: "전체" }),
      ov({ id: "sel", text: "선택", scope: "selected" }),
      ov({ id: "rng", text: "구간", scope: "range", from: 3, to: 4 }),
    ];
    expect(overlaysForFrame(list, 0, false).map((o) => o.id)).toEqual(["all"]);
    expect(overlaysForFrame(list, 0, true).map((o) => o.id)).toEqual(["all", "sel"]);
    expect(overlaysForFrame(list, 2, false).map((o) => o.id)).toEqual(["all", "rng"]);
    expect(overlaysForFrame(list, 2, true).map((o) => o.id)).toEqual(["all", "sel", "rng"]);
  });

  it("아무것도 안 걸리면 빈 배열이다 — 그리기 루프가 그냥 돌지 않는다", () => {
    const list = [ov({ text: "선택만", scope: "selected" })];
    expect(overlaysForFrame(list, 0, false)).toEqual([]);
  });

  it("오버레이가 하나도 없으면 빈 배열이다", () => {
    expect(overlaysForFrame([], 0, true)).toEqual([]);
  });
});

describe("선택을 바꾸면 그림이 바뀌는가 (selectionAffectsOverlays)", () => {
  // 필름스트립 선택은 '선택한 프레임만' 글자가 붙는 자리를 바꾼다.
  // 에디터는 이 판정이 참일 때만 리비전을 올린다 — 미리보기 다시 그리기와
  // 결과의 '낡음' 표시가 둘 다 리비전 하나를 보기 때문이다.
  it("'선택' 범위의 글자가 있으면 참이다 — 프레임을 고르는 것만으로 결과가 달라진다", () => {
    expect(selectionAffectsOverlays([ov({ text: "자막", scope: "selected" })])).toBe(true);
  });

  it("'전체'·'구간'만 있으면 거짓이다 — 선택은 그림을 바꾸지 않는다", () => {
    expect(
      selectionAffectsOverlays([
        ov({ text: "가", scope: "all" }),
        ov({ text: "나", scope: "range", from: 1, to: 3 }),
      ]),
    ).toBe(false);
  });

  it("글자가 비어 있으면 '선택'이어도 거짓이다 — 그려질 것이 없다", () => {
    expect(selectionAffectsOverlays([ov({ text: "", scope: "selected" })])).toBe(false);
    expect(selectionAffectsOverlays([ov({ text: "  \n ", scope: "selected" })])).toBe(false);
  });

  it("오버레이가 없으면 거짓이다 — 글자를 안 쓰는 사람에게는 선택이 결과를 낡게 만들지 않는다", () => {
    expect(selectionAffectsOverlays([])).toBe(false);
  });

  it("여럿 중 하나만 '선택'이어도 참이다", () => {
    expect(
      selectionAffectsOverlays([
        ov({ text: "위", scope: "all" }),
        ov({ text: "아래", scope: "selected" }),
      ]),
    ).toBe(true);
  });

  it("그릴 수 있는지 판정은 overlaysForFrame과 같은 함수를 쓴다 — 두 곳이 갈라지지 않는다", () => {
    const blank = ov({ text: " " });
    expect(isOverlayDrawable(blank)).toBe(false);
    expect(overlaysForFrame([blank], 0, true)).toEqual([]);
    expect(isOverlayDrawable(ov({ text: "가" }))).toBe(true);
  });
});

describe("9방향 프리셋 좌표 (세로 3 × 정렬 3)", () => {
  // 400×300 캔버스, 글자 20px, 배율 1, 한 줄.
  //   여백 = max(6, round(20 × 0.4)) = 8
  //   줄 높이 = 20 × 1.25 = 25,  첫 줄 baseline = 블록 top + 20 × 0.8 = top + 16
  const W = 400;
  const H = 300;
  const layout = (vAlign: OverlayVAlign, align: OverlayAlign, lines = 1) =>
    layoutOverlay(ov({ vAlign, align }), W, H, 1, lines);

  it("가로 기준점은 정렬이 정한다 — 왼쪽은 여백, 가운데는 절반, 오른쪽은 폭-여백", () => {
    expect(layout("top", "left").x).toBe(8);
    expect(layout("top", "center").x).toBe(200);
    expect(layout("top", "right").x).toBe(392);
  });

  it("정렬 값이 그대로 ctx.textAlign으로 나간다 — x는 상자가 아니라 기준점이다", () => {
    expect(layout("top", "left").align).toBe("left");
    expect(layout("top", "center").align).toBe("center");
    expect(layout("top", "right").align).toBe("right");
  });

  it("세로 위치는 baseline을 정한다 — 위는 여백+어센트, 아래는 바닥에서 한 줄 위", () => {
    expect(layout("top", "left").firstBaselineY).toBe(24); // 8 + 16
    expect(layout("middle", "left").firstBaselineY).toBe(153.5); // (300-25)/2 + 16
    expect(layout("bottom", "left").firstBaselineY).toBe(283); // 300-8-25 + 16
  });

  it("아홉 조합이 전부 다른 자리다 — 같은 자리로 뭉개지지 않는다", () => {
    const seen = new Set<string>();
    for (const v of ["top", "middle", "bottom"] as OverlayVAlign[]) {
      for (const a of ["left", "center", "right"] as OverlayAlign[]) {
        const box = layout(v, a);
        seen.add(`${box.x},${box.firstBaselineY}`);
      }
    }
    expect(seen.size).toBe(9);
  });

  it("여백은 글자 크기를 따라 커진다 — 40px 글자는 16px 여백을 쓴다", () => {
    expect(overlayMargin(20)).toBe(8);
    expect(overlayMargin(40)).toBe(16);
    expect(layoutOverlay(ov({ fontSize: 40 }), W, H, 1, 1).x).toBe(16);
  });

  it("아주 작은 글자에서도 여백은 6px 아래로 내려가지 않는다 — 글자가 테두리에 붙는다", () => {
    expect(overlayMargin(6)).toBe(6);
    expect(overlayMargin(1)).toBe(6);
    expect(layoutOverlay(ov({ fontSize: 6 }), W, H, 1, 1).x).toBe(6);
  });

  it("줄이 늘면 위는 그대로, 아래는 위로 자란다 — 아래 자막의 마지막 줄이 바닥에 붙어 있다", () => {
    expect(layout("top", "left", 3).firstBaselineY).toBe(24); // 위는 첫 줄이 고정
    const one = layout("bottom", "left", 1);
    const two = layout("bottom", "left", 2);
    expect(two.firstBaselineY).toBe(258); // 300-8-50 + 16
    // 두 줄짜리의 마지막 줄 baseline = 한 줄짜리의 baseline
    expect(two.firstBaselineY + two.lineHeight).toBe(one.firstBaselineY);
  });

  it("가운데는 줄 수가 늘면 위로도 아래로도 같이 벌어진다", () => {
    expect(layout("middle", "left", 3).firstBaselineY).toBe(128.5); // (300-75)/2 + 16
  });

  it("이동값(dx·dy)은 프리셋 좌표에 그대로 더해진다", () => {
    const box = layoutOverlay(ov({ vAlign: "bottom", align: "center", dx: -30, dy: -12 }), W, H, 1, 1);
    expect(box.x).toBe(170); // 200 - 30
    expect(box.firstBaselineY).toBe(271); // 283 - 12
  });

  it("줄 수가 0이나 NaN으로 들어와도 한 줄로 본다 — 좌표가 NaN으로 새 나가지 않는다", () => {
    for (const n of [0, -3, Number.NaN]) {
      const box = layout("bottom", "center", n);
      expect(box.firstBaselineY).toBe(283);
    }
  });
});

describe("출력 배율이 걸리면 글자도 같이 줄고 는다", () => {
  // 크기 조절은 캔버스만 줄이는 게 아니다. 글자 크기가 그대로면 50%로 줄인 결과에서
  // 자막만 두 배로 커 보인다 — 미리보기와 결과가 갈리는 게 아니라 둘 다 틀리는 자리다.
  it("글자·외곽선·여백·줄 높이가 전부 같은 배율을 탄다", () => {
    const o = ov({ fontSize: 20, strokeWidth: 4 });
    const full = overlayMetrics(o, 400, 1);
    const half = overlayMetrics(o, 200, 0.5);
    expect(full.fontPx).toBe(20);
    expect(half.fontPx).toBe(10);
    expect(full.strokePx).toBe(4);
    expect(half.strokePx).toBe(2);
    expect(full.marginPx).toBe(8);
    expect(half.marginPx).toBe(4);
    expect(full.lineHeight).toBe(25);
    expect(half.lineHeight).toBe(12.5);
  });

  it("50%로 줄인 캔버스의 좌표는 100% 좌표의 정확히 절반이다 (아홉 방향 전부)", () => {
    for (const v of ["top", "middle", "bottom"] as OverlayVAlign[]) {
      for (const a of ["left", "center", "right"] as OverlayAlign[]) {
        const o = ov({ vAlign: v, align: a, dx: 10, dy: -6 });
        const full = layoutOverlay(o, 400, 300, 1, 2);
        const half = layoutOverlay(o, 200, 150, 0.5, 2);
        expect(half.x).toBeCloseTo(full.x / 2, 10);
        expect(half.firstBaselineY).toBeCloseTo(full.firstBaselineY / 2, 10);
      }
    }
  });

  it("200%로 키우면 두 배가 된다 — 확대에도 같은 규칙이다", () => {
    const o = ov({ vAlign: "bottom", align: "center", fontSize: 20 });
    const full = layoutOverlay(o, 400, 300, 1, 1);
    const twice = layoutOverlay(o, 800, 600, 2, 1);
    expect(twice.x).toBe(full.x * 2);
    expect(twice.firstBaselineY).toBe(full.firstBaselineY * 2);
    expect(twice.fontPx).toBe(40);
  });

  it("줄바꿈 폭도 같이 줄어 줄이 나뉘는 자리가 배율과 무관하게 같다", () => {
    const o = ov({ fontSize: 20 });
    expect(overlayMetrics(o, 400, 1).maxWidth).toBe(384); // 400 - 8×2
    expect(overlayMetrics(o, 200, 0.5).maxWidth).toBe(192); // 200 - 4×2
  });

  it("배율 0·음수·NaN은 1배로 본다 — 글자가 사라지거나 뒤집히지 않는다", () => {
    const o = ov({ fontSize: 20 });
    for (const s of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(overlayMetrics(o, 400, s).fontPx).toBe(20);
      expect(layoutOverlay(o, 400, 300, s, 1).firstBaselineY).toBe(24);
    }
  });

  it("배율이 아무리 작아도 글줄 폭은 1px 아래로 내려가지 않는다 (0으로 나눔·무한 루프 방지)", () => {
    expect(overlayMetrics(ov({ fontSize: 400 }), 10, 1).maxWidth).toBe(1);
  });
});

describe("캔버스보다 긴 글은 줄로 접힌다", () => {
  it("낱말 경계에서 접는다 — 들어갈 만큼 채우고 다음 줄로 넘긴다", () => {
    expect(wrapLines("abc def ghi", 50, measure10)).toEqual(["abc", "def", "ghi"]);
    expect(wrapLines("abc def ghi", 70, measure10)).toEqual(["abc def", "ghi"]);
  });

  it("다 들어가면 접지 않는다", () => {
    expect(wrapLines("abc def", 1000, measure10)).toEqual(["abc def"]);
  });

  it("낱말 하나가 한 줄보다 길면 글자 단위로 끊는다 (띄어쓰기 없는 한 덩어리)", () => {
    expect(wrapLines("abcdefghij", 35, measure10)).toEqual(["abc", "def", "ghi", "j"]);
    expect(wrapLines("가나다라마바사", 35, measure10)).toEqual(["가나다", "라마바", "사"]);
  });

  it("한 글자가 한 줄보다 넓어도 그 글자는 자기 줄에 남는다 — 빈 줄이 무한히 생기지 않는다", () => {
    expect(wrapLines("가나다", 3, measure10)).toEqual(["가", "나", "다"]);
  });

  it("직접 넣은 줄바꿈(Enter)은 그대로 지켜지고, 그 줄이 길면 다시 접힌다", () => {
    expect(wrapLines("가\n나", 100, measure10)).toEqual(["가", "나"]);
    expect(wrapLines("abc def\nghi", 30, measure10)).toEqual(["abc", "def", "ghi"]);
  });

  it("빈 줄은 빈 줄로 남는다 — 줄 수가 줄면 세로 위치가 어긋난다", () => {
    expect(wrapLines("가\n\n나", 100, measure10)).toEqual(["가", "", "나"]);
    expect(wrapLines("", 100, measure10)).toEqual([""]);
  });

  it("결과는 언제나 한 줄 이상이다 — layoutOverlay가 0줄을 받지 않는다", () => {
    for (const text of ["", " ", "\n", "가나다"]) {
      expect(wrapLines(text, 25, measure10).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("폭이 0·음수·NaN이면 접지 않고 문단만 갈라 준다 (측정이 불가능한 순간의 안전값)", () => {
    expect(wrapLines("abc def", 0, measure10)).toEqual(["abc def"]);
    expect(wrapLines("abc def", -10, measure10)).toEqual(["abc def"]);
    expect(wrapLines("abc\ndef", Number.NaN, measure10)).toEqual(["abc", "def"]);
  });

  it("접힌 줄은 하나도 폭을 넘지 않는다 (한 글자가 이미 넘는 경우만 예외)", () => {
    const text = "짧은 낱말 여럿과 아주기다란한덩어리가섞여있는문장";
    for (const line of wrapLines(text, 55, measure10)) {
      if (Array.from(line).length > 1) expect(measure10(line)).toBeLessThanOrEqual(55);
    }
  });

  it("서로게이트 쌍을 반으로 쪼개지 않는다 — 깨진 글자가 나오면 안 된다", () => {
    const lines = wrapLines("👍👍👍", 25, measureCp);
    expect(lines).toEqual(["👍👍", "👍"]);
    for (const line of lines) expect(line).toBe(Array.from(line).join(""));
  });
});

describe("화면에서 들어온 수를 캔버스로 내보내기 전에 가둔다", () => {
  it("글자 크기는 6~400px 사이로 갇힌다", () => {
    expect(clampFontSize(0)).toBe(OVERLAY_MIN_FONT_SIZE);
    expect(clampFontSize(-40)).toBe(OVERLAY_MIN_FONT_SIZE);
    expect(clampFontSize(1e6)).toBe(OVERLAY_MAX_FONT_SIZE);
    expect(clampFontSize(24.4)).toBe(24);
    expect(clampFontSize(Number.NaN)).toBe(OVERLAY_MIN_FONT_SIZE);
  });

  it("외곽선 두께는 0~40px이고 0은 '안 그림'이다", () => {
    expect(clampStrokeWidth(0)).toBe(0);
    expect(clampStrokeWidth(-5)).toBe(0);
    expect(clampStrokeWidth(999)).toBe(OVERLAY_MAX_STROKE);
    expect(clampStrokeWidth(Number.NaN)).toBe(0);
  });

  it("갇힌 값이 좌표 계산에도 그대로 쓰인다 — 칸이 비어도 글자가 사라지지 않는다", () => {
    const box = layoutOverlay(ov({ fontSize: Number.NaN }), 400, 300, 1, 1);
    expect(box.fontPx).toBe(OVERLAY_MIN_FONT_SIZE);
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.firstBaselineY)).toBe(true);
  });

  it("이동값이 NaN이면 0으로 본다", () => {
    const box = layoutOverlay(ov({ dx: Number.NaN, dy: Number.NaN }), 400, 300, 1, 1);
    expect(box.x).toBe(8);
    expect(box.firstBaselineY).toBe(24);
  });
});

describe("새 오버레이의 기본값은 캔버스에서 나온다", () => {
  it("글자 크기는 캔버스 높이의 9%다 — 원본이 얼마든 처음부터 읽히는 크기로 뜬다", () => {
    expect(newOverlay("x", 400, 10).fontSize).toBe(36);
    expect(newOverlay("x", 100, 10).fontSize).toBe(9);
    expect(newOverlay("x", 1080, 10).fontSize).toBe(97);
  });

  it("아주 작은 캔버스에서도 최소 글자 크기 아래로 내려가지 않는다", () => {
    expect(newOverlay("x", 1, 1).fontSize).toBe(OVERLAY_MIN_FONT_SIZE);
    expect(newOverlay("x", Number.NaN, 1).fontSize).toBe(OVERLAY_MIN_FONT_SIZE);
  });

  it("외곽선은 글자 크기에서 나오고 최소 1px이다 — 흰 자막이 흰 배경에서 사라지지 않게", () => {
    expect(newOverlay("x", 400, 1).strokeWidth).toBe(5); // round(36/8)
    expect(newOverlay("x", 100, 1).strokeWidth).toBe(1);
  });

  it("기본은 아래·가운데·전체다 — 가장 흔한 자막 모양", () => {
    const o = newOverlay("x", 400, 12);
    expect(o.vAlign).toBe("bottom");
    expect(o.align).toBe("center");
    expect(o.scope).toBe("all");
    expect(o.text).toBe("");
  });

  it("구간 기본값은 전체 프레임이다 — 범위를 '구간'으로 바꾼 순간 한 장만 남지 않는다", () => {
    expect(newOverlay("x", 400, 12).to).toBe(12);
    expect(newOverlay("x", 400, 0).to).toBe(1);
    expect(newOverlay("x", 400, Number.NaN).to).toBe(1);
  });
});

describe("글꼴은 내려받지 않는다 (단일 HTML 오프라인 원칙)", () => {
  it("시스템 글꼴 스택만 쓰고 URL이 없다", () => {
    expect(OVERLAY_FONT_STACK).not.toMatch(/url\(|https?:/);
    expect(OVERLAY_FONT_STACK).toContain("system-ui");
    expect(OVERLAY_FONT_STACK).toMatch(/sans-serif$/);
  });

  it("한글 글꼴은 라틴 뒤에 온다 — 앞에 두면 영문까지 그 글꼴로 그려진다", () => {
    expect(OVERLAY_FONT_STACK.indexOf("system-ui")).toBeLessThan(
      OVERLAY_FONT_STACK.indexOf("Malgun Gothic"),
    );
    expect(OVERLAY_FONT_STACK).toContain("Apple SD Gothic Neo");
    expect(OVERLAY_FONT_STACK).toContain("Noto Sans KR");
  });

  it("canvas의 font 문자열은 굵기·크기·스택 순서로 조립된다", () => {
    expect(overlayFont(24)).toBe(`${OVERLAY_FONT_WEIGHT} 24px ${OVERLAY_FONT_STACK}`);
  });

  it("0px·음수 글자 크기는 font 문자열에 실리지 않는다 (canvas가 통째로 무시한다)", () => {
    expect(overlayFont(0)).toContain("1px");
    expect(overlayFont(-5)).toContain("1px");
  });
});

describe("칸 하나 편집 (applyOverlayPatch)", () => {
  // 패널은 칸 하나씩 보낸다. 값을 가두는 규칙이 여기 한 곳에만 있어야
  // "화면에 보이는 수"와 "캔버스로 나가는 수"가 갈리지 않는다.
  it("적어 둔 구간은 손대지 않은 편집에서 그대로 남는다 — 프레임이 줄어도 줄지 않는다", () => {
    // 20프레임짜리에 1~20 구간을 걸어 두고, 프레임을 5장으로 줄인 뒤 글자만 고친 상황.
    const o = ov({ scope: "range", from: 1, to: 20 });
    const edited = applyOverlayPatch(o, { text: "고친 글자" }, 5);
    expect(edited.to).toBe(20);
    expect(edited.from).toBe(1);
  });

  it("프레임을 다시 늘리면 구간이 그대로 살아 있다 — 조용히 줄어든 값은 안 돌아온다", () => {
    let o = ov({ scope: "range", from: 2, to: 8 });
    o = applyOverlayPatch(o, { text: "가" }, 3); // 프레임 3장으로 줄었을 때 글자만 고침
    o = applyOverlayPatch(o, { color: "#ff0000" }, 3);
    // 프레임이 10장으로 돌아오면 2~8이 다시 그대로 걸린다.
    expect(isOverlayOnFrame(o, 1, false)).toBe(true); // 2번
    expect(isOverlayOnFrame(o, 7, false)).toBe(true); // 8번
    expect(isOverlayOnFrame(o, 8, false)).toBe(false); // 9번
  });

  it("구간 칸을 직접 적으면 그 칸만 1..프레임 수로 갇힌다", () => {
    const o = ov({ scope: "range", from: 1, to: 20 });
    expect(applyOverlayPatch(o, { to: 99 }, 5).to).toBe(5);
    expect(applyOverlayPatch(o, { from: 0 }, 5).from).toBe(1);
    // 적지 않은 쪽은 그대로 — 한 칸을 고쳤다고 다른 칸이 따라 움직이지 않는다.
    expect(applyOverlayPatch(o, { from: 3 }, 5).to).toBe(20);
  });

  it("빈 칸(NaN)을 적으면 1번으로 떨어진다", () => {
    const o = ov({ scope: "range", from: 2, to: 4 });
    expect(applyOverlayPatch(o, { from: Number.NaN }, 5).from).toBe(1);
  });

  it("프레임이 없을 때 적은 번호는 1이다 (0으로 내려가지 않는다)", () => {
    expect(clampFrameNo(7, 0)).toBe(1);
    expect(clampFrameNo(7, Number.NaN)).toBe(1);
    expect(clampFrameNo(2.6, 10)).toBe(3);
  });

  it("글자 크기·외곽선·이동값은 편집할 때마다 갇힌다 (범위와 달리 바깥 상태를 안 본다)", () => {
    const o = ov({ fontSize: 20, strokeWidth: 2, dx: 0, dy: 0 });
    const edited = applyOverlayPatch(
      o,
      { fontSize: 1e6, strokeWidth: -3, dx: 4.6, dy: Number.NaN },
      10,
    );
    expect(edited.fontSize).toBe(OVERLAY_MAX_FONT_SIZE);
    expect(edited.strokeWidth).toBe(0);
    expect(edited.dx).toBe(5);
    expect(edited.dy).toBe(0);
  });

  it("id는 바뀌지 않고 원본 객체도 그대로다 — 새 객체로 갈아 끼운다", () => {
    const o = ov({ id: "keep", text: "원본" });
    const edited = applyOverlayPatch(o, { text: "새 글자" }, 10);
    expect(edited.id).toBe("keep");
    expect(edited).not.toBe(o);
    expect(o.text).toBe("원본");
  });
});

describe("어디에도 안 그려지는 글자를 센다 (unseenOverlayCount)", () => {
  // 배지는 편집 중인 것만 보면 안 된다 — 다른 오버레이가 같은 상태여도 조용하면
  // 사용자는 글자가 왜 안 나오는지 알 길이 없다.
  it("'선택' 범위인데 선택한 프레임이 없으면 안 나온다", () => {
    expect(isOverlayUnseen(ov({ scope: "selected" }), 10, 0)).toBe(true);
    expect(isOverlayUnseen(ov({ scope: "selected" }), 10, 1)).toBe(false);
  });

  it("목록 전체를 센다 — 편집 중이 아닌 것도 함께 잡힌다", () => {
    const list = [
      ov({ id: "a", scope: "selected" }),
      ov({ id: "b", scope: "selected" }),
      ov({ id: "c", scope: "all" }),
    ];
    expect(unseenOverlayCount(list, 10, 0)).toBe(2);
    expect(unseenOverlayCount(list, 10, 3)).toBe(0);
  });

  it("구간이 통째로 프레임 밖이면 안 나온다 (5프레임에 8~10 구간)", () => {
    expect(isOverlayUnseen(ov({ scope: "range", from: 8, to: 10 }), 5, 0)).toBe(true);
    // 한 장이라도 걸치면 나온다.
    expect(isOverlayUnseen(ov({ scope: "range", from: 5, to: 10 }), 5, 0)).toBe(false);
    // 거꾸로 적은 구간도 같은 규칙으로 읽는다.
    expect(isOverlayUnseen(ov({ scope: "range", from: 10, to: 8 }), 5, 0)).toBe(true);
  });

  it("빈 글자는 세지 않는다 — 그릴 것이 없는 것은 '안 보임'이 아니라 '없음'이다", () => {
    expect(unseenOverlayCount([ov({ text: "", scope: "selected" })], 10, 0)).toBe(0);
    expect(unseenOverlayCount([ov({ text: "  ", scope: "range", from: 9, to: 9 })], 5, 0)).toBe(0);
  });

  it("'전체'는 프레임이 하나라도 있으면 보인다", () => {
    expect(isOverlayUnseen(ov({ scope: "all" }), 1, 0)).toBe(false);
    expect(isOverlayUnseen(ov({ scope: "all" }), 0, 0)).toBe(true);
  });

  it("판정은 isOverlayOnFrame과 같은 답을 낸다 — 두 곳이 갈라지지 않는다", () => {
    const frames = 5;
    for (const scope of ["all", "selected", "range"] as const) {
      for (const [from, to] of [
        [1, 5],
        [3, 9],
        [6, 8],
      ]) {
        for (const selectedCount of [0, 2]) {
          const o = ov({ scope, from, to });
          // 선택은 앞쪽 selectedCount장에 걸린 것으로 본다.
          let drawnSomewhere = false;
          for (let i = 0; i < frames; i++) {
            if (isOverlayOnFrame(o, i, i < selectedCount)) drawnSomewhere = true;
          }
          expect(isOverlayUnseen(o, frames, selectedCount)).toBe(!drawnSomewhere);
        }
      }
    }
  });
});

describe("줄 높이와 어센트는 좌표 계산과 같은 상수를 쓴다", () => {
  it("줄 높이 = 글자 크기 × 1.25", () => {
    expect(OVERLAY_LINE_HEIGHT).toBe(1.25);
    expect(overlayMetrics(ov({ fontSize: 32 }), 400, 1).lineHeight).toBe(32 * OVERLAY_LINE_HEIGHT);
  });

  it("첫 줄 baseline은 블록 위에서 글자 크기 × 0.8 내려간 자리다", () => {
    expect(OVERLAY_ASCENT).toBe(0.8);
    const box = layoutOverlay(ov({ vAlign: "top", fontSize: 50 }), 400, 300, 1, 1);
    expect(box.firstBaselineY).toBe(overlayMargin(50) + 50 * OVERLAY_ASCENT);
  });

  it("아래 자막의 마지막 줄은 캔버스 밖으로 나가지 않는다", () => {
    for (const lines of [1, 2, 5]) {
      for (const fontSize of [10, 20, 48]) {
        const box = layoutOverlay(ov({ vAlign: "bottom", fontSize }), 400, 300, 1, lines);
        const lastBaseline = box.firstBaselineY + (lines - 1) * box.lineHeight;
        expect(lastBaseline).toBeLessThanOrEqual(300);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 인코딩이 시작되는 순간의 상태를 굳히는 것(plan.ts)의 명세.
// 인코더는 프레임마다 await로 멈춘다(디코딩·convertToBlob·muxer). 그 틈에 사용자가
// 선택을 토글하거나 딜레이를 고치면, 살아 있는 배열을 넘긴 인코딩은 앞쪽 프레임과 뒤쪽
// 프레임이 서로 다른 상태를 보고 그려진다 — 결과 파일 하나가 자기 안에서 앞뒤가 다르다.
// 아래 테스트는 전부 "계획을 뜬 뒤 살아 있는 상태를 마구 고쳐도 계획은 그대로"를 잰다.
// ─────────────────────────────────────────────────────────────────────────────

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

function fr(over: Partial<Frame> & Pick<Frame, "id">): Frame {
  return {
    sourceId: "s1",
    frameIndex: 0,
    delayMs: 100,
    selected: false,
    thumb: "data:,",
    ...over,
  };
}

function tf(over: Partial<Transform> = {}): Transform {
  // redact(가릴 영역)는 이 파일의 관심사가 아니다 — 명세는 tests/gif-redact.test.ts에 있다.
  return {
    crop: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    scale: 1,
    redact: [],
    ...over,
  };
}

/** 이 계획이 실제로 만들 파일 — 프레임마다 얹히는 글자와 딜레이.
 *  인코더 네 개가 프레임 루프에서 읽는 것이 정확히 이 두 가지다. */
function script(plan: ReturnType<typeof snapshotPlan>) {
  return plan.frames.map((f, i) => ({
    delayMs: f.delayMs,
    text: overlaysForFrame(plan.overlays, i, f.selected).map((o) => o.text),
  }));
}

describe("인코딩 시작 시점의 상태를 굳힌다 (snapshotPlan)", () => {
  /** 3프레임 + '선택한 프레임만' 자막 하나 — 편집이 결과를 가르는 가장 얇은 무대. */
  function stage() {
    const frames = [
      fr({ id: "f1", delayMs: 100, selected: true }),
      fr({ id: "f2", delayMs: 100, selected: false }),
      fr({ id: "f3", delayMs: 100, selected: false }),
    ];
    const overlays = [ov({ id: "sel", text: "선택 자막", scope: "selected" })];
    const sources = new Map([["s1", source("s1")]]);
    return { frames, overlays, sources };
  }

  it("인코딩 도중 선택을 토글해도 그 인코딩은 시작 시점 선택을 본다", () => {
    const live = stage();
    const plan = snapshotPlan({
      frames: live.frames,
      sources: live.sources,
      transform: tf(),
      overlays: live.overlays,
      baseW: 40,
      baseH: 30,
    });
    const before = script(plan);

    // 인코딩이 1번 프레임을 그린 뒤 사용자가 필름스트립 체크를 누른 상황.
    live.frames[0].selected = false;
    live.frames[2].selected = true;

    expect(script(plan)).toEqual(before);
    expect(before.map((s) => s.text.length)).toEqual([1, 0, 0]);
  });

  it("인코딩 도중 딜레이를 고쳐도 계획의 딜레이는 그대로다 (자막 이전부터 있던 결함)", () => {
    const live = stage();
    const plan = snapshotPlan({
      frames: live.frames,
      sources: live.sources,
      transform: tf(),
      overlays: live.overlays,
      baseW: 40,
      baseH: 30,
    });
    for (const f of live.frames) f.delayMs = 20;
    expect(plan.frames.map((f) => f.delayMs)).toEqual([100, 100, 100]);
  });

  it("인코딩 도중 프레임을 지우거나 더해도 길이·순서가 그대로다", () => {
    const live = stage();
    const plan = snapshotPlan({
      frames: live.frames,
      sources: live.sources,
      transform: tf(),
      overlays: live.overlays,
      baseW: 40,
      baseH: 30,
    });
    live.frames.splice(1, 1);
    live.frames.push(fr({ id: "f4" }));
    live.frames.reverse();
    expect(plan.frames).toHaveLength(3);
    expect(plan.frames.map((f) => f.frameIndex)).toEqual([0, 0, 0]);
  });

  it("인코딩 도중 글자·범위를 고쳐도 계획의 글자는 그대로다", () => {
    const live = stage();
    const plan = snapshotPlan({
      frames: live.frames,
      sources: live.sources,
      transform: tf(),
      overlays: live.overlays,
      baseW: 40,
      baseH: 30,
    });
    const before = script(plan);
    live.overlays[0].text = "고친 자막";
    live.overlays[0].scope = "all";
    live.overlays.push(ov({ id: "new", text: "새 자막" }));
    expect(script(plan)).toEqual(before);
  });

  it("변형은 크롭까지 끊어 뜬다 — 중첩 객체가 살아 있는 상태를 물고 있지 않다", () => {
    const live = { transform: tf({ crop: { x: 1, y: 2, w: 3, h: 4 }, scale: 0.5 }) };
    const plan = snapshotPlan({
      frames: [],
      sources: new Map(),
      transform: live.transform,
      overlays: [],
      baseW: 40,
      baseH: 30,
    });
    live.transform.crop!.w = 999;
    live.transform.scale = 2;
    expect(plan.transform.crop).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(plan.transform.scale).toBe(0.5);
  });

  it("소스 표에서 항목이 빠져도 계획은 자기 소스를 계속 본다 (인코딩 중 소스 정리)", () => {
    const live = stage();
    const plan = snapshotPlan({
      frames: live.frames,
      sources: live.sources,
      transform: tf(),
      overlays: live.overlays,
      baseW: 40,
      baseH: 30,
    });
    live.sources.delete("s1");
    expect(plan.sources.get("s1")?.id).toBe("s1");
  });

  it("계획이 지나는 소스만 들고 간다 — 안 쓰는 소스는 안 잡는다", () => {
    const sources = new Map([
      ["s1", source("s1")],
      ["unused", source("unused")],
    ]);
    const plan = snapshotPlan({
      frames: [fr({ id: "f1" })],
      sources,
      transform: tf(),
      overlays: [],
      baseW: 40,
      baseH: 30,
    });
    expect([...plan.sources.keys()]).toEqual(["s1"]);
  });

  it("소스 바이트는 복사하지 않는다 — 임포트 뒤 아무도 안 고치는 읽기 전용이고 프레임당 MB다", () => {
    const s = source("s1");
    const plan = snapshotPlan({
      frames: [fr({ id: "f1" })],
      sources: new Map([["s1", s]]),
      transform: tf(),
      overlays: [],
      baseW: 40,
      baseH: 30,
    });
    expect(plan.sources.get("s1")).toBe(s);
    expect(plan.sources.get("s1")?.bytes).toBe(s.bytes);
  });

  it("중단 신호와 베이스 크기는 그대로 실린다 — 취소는 계획을 뜬 뒤에도 닿아야 한다", () => {
    const ac = new AbortController();
    const plan = snapshotPlan({
      frames: [],
      sources: new Map(),
      transform: tf(),
      overlays: [],
      baseW: 640,
      baseH: 480,
      signal: ac.signal,
    });
    expect(plan.baseW).toBe(640);
    expect(plan.baseH).toBe(480);
    expect(plan.signal).toBe(ac.signal);
    ac.abort();
    expect(plan.signal?.aborted).toBe(true);
  });

  it("계획끼리도 안 섞인다 — 두 번째 계획은 그 사이의 편집을 담는다", () => {
    const live = stage();
    const input = {
      frames: live.frames,
      sources: live.sources,
      transform: tf(),
      overlays: live.overlays,
      baseW: 40,
      baseH: 30,
    };
    const first = snapshotPlan(input);
    live.frames[1].selected = true;
    live.frames[1].delayMs = 33;
    const second = snapshotPlan(input);
    expect(script(first)[1]).toEqual({ delayMs: 100, text: [] });
    expect(script(second)[1]).toEqual({ delayMs: 33, text: ["선택 자막"] });
  });
});
