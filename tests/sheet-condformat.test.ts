/** 시트 조건부 서식 — 규칙 판정·집계·보간·합성.
 *
 * 이 엔진이 답하는 것은 둘이다: **이 칸이 규칙에 걸리는가**, 그리고 **여러 규칙이
 * 겹칠 때 무엇이 남는가.**
 *
 * 조심하는 자리 넷:
 *   ① 0·"0"·빈 칸·오류는 서로 다르다. 0을 빈 칸으로 세면 금액 열의 0원이 칠해진다.
 *   ② 값 비교와 같음 판정은 필터(filter.ts)의 것을 그대로 쓴다 — 필터에서 100에
 *      걸리던 칸이 조건부 서식에서 안 걸리면 같은 표를 두 번 배우게 된다.
 *   ③ 최소 = 최대(값이 하나뿐이거나 전부 같을 때)는 위치를 잴 수 없다. 그 자리는 0.5다.
 *   ④ 우선순위는 목록 순서이고, 앞 규칙이 정한 속성을 뒤 규칙이 덮지 못한다.
 *      "참이면 중지"가 켜진 규칙이 걸리면 뒤는 보지도 않는다(엑셀과 같다).
 *
 * 마지막 describe는 xlsx 왕복이다 — ExcelJS가 조건부 서식을 읽고 쓰므로 규칙이
 * 저장에서 사라지지 않는다는 것을 여기서 못 박는다.
 */

import { describe, it, expect } from "vitest";

import { parseArea, type Area } from "../apps/sheet/src/lib/sheet/a1";
import {
  barRatio,
  collectStats,
  compileRules,
  matchesRule,
  mixColor,
  paintRules,
  pointValue,
  rankCut,
  scaleFill,
  scalePosition,
  scaleStops,
  shiftRules,
  type BarRule,
  type CompareOp,
  type CondCell,
  type CondRule,
  type CondStats,
  type CondStyle,
  type DupOp,
  type RankRule,
  type ScaleRule,
  type TextOp,
} from "../apps/sheet/src/lib/sheet/condformat";
import { parseInput } from "../apps/sheet/src/lib/sheet/model";
import { formatValue } from "../apps/sheet/src/lib/sheet/numfmt";
import { emptySheet, ERR, type Scalar, type WorkbookDoc } from "../apps/sheet/src/lib/sheet/types";
import { cellKey } from "../apps/sheet/src/lib/sheet/a1";
import {
  condRulesFromXlsx,
  readXlsx,
  toXlsxCondRule,
  writeXlsx,
  xlsxLosses,
} from "../apps/sheet/src/lib/sheet/xlsx";

/** 값 하나를 조건부 서식이 보는 모습으로. 표시 형식을 주면 화면 글자도 그 형식을 따른다. */
function cell(v: Scalar, fmt?: string): CondCell {
  return { v, text: formatValue(v, fmt) };
}

/** 파일에서 온 원문이 남은 칸 — 값과 화면 글자가 다르다(CLAUDE.md 23번). */
function preserved(v: Scalar, raw: string): CondCell {
  return { v, text: raw };
}

/** 사람이 친 글자를 시트에 넣은 것과 같은 칸으로. 날짜·수·백분율 해석이 함께 온다. */
function typed(text: string): CondCell {
  const parsed = parseInput(text);
  return { v: parsed.value, text: formatValue(parsed.value, parsed.numFmt) };
}

const BLANK: CondCell = { v: null, text: "" };
const RED: CondStyle = { fill: "#fee2e2", color: "#991b1b" };
const AREA: Area = { top: 0, left: 0, bottom: 9, right: 0 };

let seq = 0;
function id(): string {
  seq += 1;
  return `r${seq}`;
}

function compare(op: CompareOp, value: string, value2 = "", style: CondStyle = RED): CondRule {
  return { id: id(), range: AREA, kind: "compare", op, value, value2, style };
}

function text(op: TextOp, value: string, style: CondStyle = RED): CondRule {
  return { id: id(), range: AREA, kind: "text", op, value, style };
}

function dup(op: DupOp, style: CondStyle = RED): CondRule {
  return { id: id(), range: AREA, kind: "dup", op, style };
}

function rank(op: "top" | "bottom", n: number, percent = false): RankRule {
  return { id: id(), range: AREA, kind: "rank", op, n, percent, style: RED };
}

function scale(colors: [string, string, string], three: boolean): ScaleRule {
  return { id: id(), range: AREA, kind: "scale", stops: scaleStops(colors, three) };
}

function bar(zeroBase: boolean, color = "#638ec6"): BarRule {
  return {
    id: id(),
    range: AREA,
    kind: "bar",
    color,
    min: zeroBase ? { type: "num", value: 0 } : { type: "min" },
    max: { type: "max" },
  };
}

/** 집계를 한 벌 만들어 모든 규칙에 같은 것을 물려준다(한 범위짜리 시험이라서). */
function statsOf(cells: CondCell[]): (rule: CondRule) => CondStats {
  const stats = collectStats(cells);
  return () => stats;
}

const NO_STATS = (): CondStats => ({ numbers: [], counts: new Map() });

const GRAY: [string, string, string] = ["#000000", "#808080", "#ffffff"];

describe("값 비교", () => {
  it("0은 빈 칸이 아니다 — 0보다 큼에 안 걸리고, 빈 칸 규칙에도 안 걸린다", () => {
    const rule = compare("gt", "0");
    expect(matchesRule(rule, cell(0))).toBe(false);
    expect(matchesRule(rule, cell(1))).toBe(true);
    expect(matchesRule({ id: id(), range: AREA, kind: "blank", op: "blank", style: RED }, cell(0))).toBe(
      false,
    );
  });

  it("음수도 크기 비교에 그대로 든다", () => {
    expect(matchesRule(compare("lt", "0"), cell(-5))).toBe(true);
    expect(matchesRule(compare("gt", "-10"), cell(-5))).toBe(true);
    expect(matchesRule(compare("lt", "-10"), cell(-5))).toBe(false);
  });

  it("빈 칸은 크기 비교에 걸리지 않는다 — 0으로 세면 금액 열이 통째로 칠해진다", () => {
    expect(matchesRule(compare("lt", "100"), BLANK)).toBe(false);
    expect(matchesRule(compare("gt", "-1"), BLANK)).toBe(false);
  });

  it("오류 셀은 크기 비교에서 빠지고, 같음은 보이는 글자로 걸린다", () => {
    const err = cell(ERR.div0);
    expect(matchesRule(compare("gt", "0"), err)).toBe(false);
    expect(matchesRule(compare("lt", "0"), err)).toBe(false);
    expect(matchesRule(compare("eq", "#DIV/0!"), err)).toBe(true);
  });

  it("수 100과 글자 \"100\"은 둘 다 같음에 걸린다(필터와 같은 규칙)", () => {
    expect(matchesRule(compare("eq", "100"), cell(100))).toBe(true);
    expect(matchesRule(compare("eq", "100"), cell("100"))).toBe(true);
  });

  it("글자 \"0\"은 크기 비교에 안 걸린다 — 수와 글자는 섞어 재지 않는다", () => {
    expect(matchesRule(compare("gt", "-1"), cell("0"))).toBe(false);
  });

  it("비교값이 비어 있으면 빈 칸을 가리킨다", () => {
    expect(matchesRule(compare("eq", ""), BLANK)).toBe(true);
    expect(matchesRule(compare("eq", ""), cell(0))).toBe(false);
    expect(matchesRule(compare("ne", ""), cell(0))).toBe(true);
  });

  it("사이는 양 끝을 포함하고, 두 값을 거꾸로 적어도 같은 뜻이다", () => {
    expect(matchesRule(compare("between", "10", "20"), cell(10))).toBe(true);
    expect(matchesRule(compare("between", "10", "20"), cell(20))).toBe(true);
    expect(matchesRule(compare("between", "20", "10"), cell(15))).toBe(true);
    expect(matchesRule(compare("between", "10", "20"), cell(21))).toBe(false);
    expect(matchesRule(compare("notBetween", "10", "20"), cell(21))).toBe(true);
    // 잴 수 없는 칸은 "사이 아님"에도 안 걸린다 — 빈 칸이 칠해지면 그게 더 놀랍다.
    expect(matchesRule(compare("notBetween", "10", "20"), BLANK)).toBe(false);
  });

  it("날짜는 일련번호로 비교한다 — 친 글자를 셀과 같은 규칙으로 읽는다", () => {
    const day = typed("2024-01-05");
    expect(typeof day.v).toBe("number");
    expect(matchesRule(compare("gte", "2024-01-01"), day)).toBe(true);
    expect(matchesRule(compare("lt", "2024-01-01"), day)).toBe(false);
    expect(matchesRule(compare("between", "2024-01-01", "2024-01-31"), day)).toBe(true);
  });

  it("이상·이하는 경계값을 포함한다", () => {
    expect(matchesRule(compare("gte", "10"), cell(10))).toBe(true);
    expect(matchesRule(compare("lte", "10"), cell(10))).toBe(true);
    expect(matchesRule(compare("gt", "10"), cell(10))).toBe(false);
  });
});

describe("글자 조건", () => {
  it("대소문자를 가리지 않는다", () => {
    expect(matchesRule(text("contains", "ABC"), cell("xxabcxx"))).toBe(true);
    expect(matchesRule(text("startsWith", "ab"), cell("ABCD"))).toBe(true);
    expect(matchesRule(text("endsWith", "CD"), cell("abcd"))).toBe(true);
  });

  it("보이는 글자를 본다 — 원문이 남은 칸은 그 원문이 정체다", () => {
    expect(matchesRule(text("contains", "1.50"), preserved(1.5, "1.50"))).toBe(true);
    expect(matchesRule(text("contains", "1.5"), cell(1.5))).toBe(true);
  });

  it("포함 안 함은 빈 칸에도 걸린다", () => {
    expect(matchesRule(text("notContains", "가"), BLANK)).toBe(true);
    expect(matchesRule(text("contains", ""), BLANK)).toBe(true);
  });
});

describe("빈 칸", () => {
  it('값이 없거나 빈 글자만 빈 칸이다 — 0·"0"·공백 한 칸은 아니다', () => {
    const blank: CondRule = { id: id(), range: AREA, kind: "blank", op: "blank", style: RED };
    expect(matchesRule(blank, BLANK)).toBe(true);
    expect(matchesRule(blank, cell(""))).toBe(true);
    expect(matchesRule(blank, cell(0))).toBe(false);
    expect(matchesRule(blank, cell("0"))).toBe(false);
    expect(matchesRule(blank, cell(" "))).toBe(false);
  });

  it("빈 칸 아님은 오류 셀도 센다", () => {
    const notBlank: CondRule = { id: id(), range: AREA, kind: "blank", op: "notBlank", style: RED };
    expect(matchesRule(notBlank, cell(ERR.na))).toBe(true);
    expect(matchesRule(notBlank, BLANK)).toBe(false);
  });
});

describe("중복·고유", () => {
  const cells = [cell("가"), cell("가"), cell("나"), BLANK, cell(0), cell(0)];
  const stats = collectStats(cells);

  it("같은 글자가 둘 이상이면 중복이다", () => {
    expect(matchesRule(dup("duplicate"), cell("가"), stats)).toBe(true);
    expect(matchesRule(dup("duplicate"), cell("나"), stats)).toBe(false);
    expect(matchesRule(dup("unique"), cell("나"), stats)).toBe(true);
  });

  it("0도 값이라 중복으로 센다 — 빈 칸만 세지 않는다", () => {
    expect(matchesRule(dup("duplicate"), cell(0), stats)).toBe(true);
    expect(matchesRule(dup("duplicate"), BLANK, stats)).toBe(false);
    expect(matchesRule(dup("unique"), BLANK, stats)).toBe(false);
  });

  it("대소문자가 다른 글자도 같은 값으로 센다", () => {
    const mixed = collectStats([cell("abc"), cell("ABC"), cell("x")]);
    expect(matchesRule(dup("duplicate"), cell("abc"), mixed)).toBe(true);
    expect(matchesRule(dup("unique"), cell("x"), mixed)).toBe(true);
  });

  it("화면에 다르게 보이는 두 칸은 중복이 아니다 — 판정은 표시 문자열 기준이다", () => {
    const shown = collectStats([preserved(1.5, "1.50"), cell(1.5)]);
    expect(matchesRule(dup("duplicate"), preserved(1.5, "1.50"), shown)).toBe(false);
    expect(matchesRule(dup("unique"), cell(1.5), shown)).toBe(true);
  });

  it("집계가 없으면 걸리지 않는다(범위 전체를 봐야 답이 나온다)", () => {
    expect(matchesRule(dup("duplicate"), cell("가"))).toBe(false);
  });
});

describe("상위·하위 N", () => {
  it("동점이면 N보다 많이 걸린다 — 경계값과 같은 칸은 전부 든다(엑셀과 같다)", () => {
    const stats = collectStats([cell(4), cell(5), cell(5), cell(5), cell(5)]);
    const top3 = rank("top", 3);
    expect(rankCut(top3, stats.numbers)).toBe(5);
    expect(matchesRule(top3, cell(5), stats)).toBe(true);
    expect(matchesRule(top3, cell(4), stats)).toBe(false);
  });

  it("하위 N은 작은 쪽부터 센다", () => {
    const stats = collectStats([cell(1), cell(1), cell(2), cell(3)]);
    expect(rankCut(rank("bottom", 2), stats.numbers)).toBe(1);
    expect(matchesRule(rank("bottom", 2), cell(1), stats)).toBe(true);
    expect(matchesRule(rank("bottom", 2), cell(2), stats)).toBe(false);
  });

  it("퍼센트는 올림해서 칸 수로 바꾼다 — 10칸의 25%는 3칸이다", () => {
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(rankCut(rank("top", 25, true), numbers)).toBe(8);
    expect(rankCut(rank("top", 100, true), numbers)).toBe(1);
  });

  it("N이 범위보다 크면 전부 걸리고, 0이면 하나도 안 걸린다", () => {
    const numbers = [1, 2, 3];
    expect(rankCut(rank("top", 99), numbers)).toBe(1);
    expect(rankCut(rank("top", 0), numbers)).toBeNull();
    expect(rankCut(rank("top", 3), [])).toBeNull();
  });

  it("수가 아닌 칸은 순위에 들지 않는다 — 글자·오류·빈 칸", () => {
    const stats = collectStats([cell(10), cell("20"), cell(ERR.value), BLANK]);
    expect(stats.numbers).toEqual([10]);
    expect(matchesRule(rank("top", 1), cell("20"), stats)).toBe(false);
    expect(matchesRule(rank("top", 1), cell(ERR.value), stats)).toBe(false);
    expect(matchesRule(rank("top", 1), cell(10), stats)).toBe(true);
  });
});

describe("색조", () => {
  it("2색은 최소에서 첫 색, 최대에서 끝 색, 가운데에서 섞인 색이다", () => {
    const rule = scale(GRAY, false);
    const numbers = [0, 100];
    expect(scaleFill(rule, 0, numbers)).toBe("#000000");
    expect(scaleFill(rule, 100, numbers)).toBe("#ffffff");
    expect(scaleFill(rule, 50, numbers)).toBe("#808080");
  });

  it("3색은 가운데 기준점이 중앙값이다", () => {
    const rule = scale(GRAY, true);
    const numbers = [0, 10, 100];
    expect(rule.stops).toHaveLength(3);
    expect(scaleFill(rule, 10, numbers)).toBe("#808080");
    expect(scaleFill(rule, 0, numbers)).toBe("#000000");
    expect(scaleFill(rule, 100, numbers)).toBe("#ffffff");
  });

  it("최소 = 최대면 눈금 가운데 색이다 — 값이 하나뿐이면 크고 작음을 말할 수 없다", () => {
    const numbers = [7, 7, 7];
    expect(scaleFill(scale(GRAY, true), 7, numbers)).toBe("#808080");
    expect(scaleFill(scale(GRAY, false), 7, numbers)).toBe("#808080");
    expect(scaleFill(scale(GRAY, false), 7, [7])).toBe("#808080");
  });

  it("범위에 수가 하나도 없으면 색이 없다", () => {
    expect(scaleFill(scale(GRAY, false), 5, [])).toBeNull();
  });

  it("가운데 기준점이 최솟값에 붙어도 최솟값 칸은 첫 색이다 — 0이 절반인 열이 그렇다", () => {
    // 중앙값(백분위 50)이 0이라 앞 두 기준점이 같은 수에 겹친다.
    const numbers = [0, 0, 0, 0, 100];
    expect(scaleFill(scale(GRAY, true), 0, numbers)).toBe("#000000");
    expect(scaleFill(scale(GRAY, true), 100, numbers)).toBe("#ffffff");
  });

  it("가운데 기준점이 최댓값에 붙어도 최댓값 칸은 끝 색이다", () => {
    const numbers = [0, 100, 100, 100, 100];
    expect(scaleFill(scale(GRAY, true), 100, numbers)).toBe("#ffffff");
    expect(scaleFill(scale(GRAY, true), 0, numbers)).toBe("#000000");
  });

  it("기준점 사이에 놓인 값은 그 구간에서만 섞는다", () => {
    // 앞 구간이 폭 0이면 남은 구간(가운데~최대)에서만 섞는다.
    expect(scaleFill(scale(GRAY, true), 50, [0, 0, 0, 0, 100])).toBe("#c0c0c0");
    expect(scaleFill(scale(GRAY, true), 50, [0, 100, 100, 100, 100])).toBe("#404040");
  });

  it("범위 밖의 값은 끝 색에서 멈춘다", () => {
    const rule = scale(GRAY, false);
    expect(scaleFill(rule, -50, [0, 100])).toBe("#000000");
    expect(scaleFill(rule, 500, [0, 100])).toBe("#ffffff");
  });

  it("자리 계산은 0..1로 갇히고, 범위가 한 점이면 0.5다", () => {
    expect(scalePosition(5, 0, 10)).toBe(0.5);
    expect(scalePosition(-5, 0, 10)).toBe(0);
    expect(scalePosition(50, 0, 10)).toBe(1);
    expect(scalePosition(7, 7, 7)).toBe(0.5);
  });

  it("기준점은 최소·최대·수·퍼센트·백분위를 안다", () => {
    const numbers = [0, 10, 20, 30, 40];
    expect(pointValue({ type: "min" }, numbers)).toBe(0);
    expect(pointValue({ type: "max" }, numbers)).toBe(40);
    expect(pointValue({ type: "num", value: 12 }, numbers)).toBe(12);
    expect(pointValue({ type: "percent", value: 50 }, numbers)).toBe(20);
    expect(pointValue({ type: "percentile", value: 50 }, numbers)).toBe(20);
    expect(pointValue({ type: "min" }, [])).toBeNull();
    expect(pointValue({ type: "num", value: 3 }, [])).toBe(3);
  });

  it("색 섞기는 양 끝에서 원래 색을 그대로 준다", () => {
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixColor("#ff0000", "#00ff00", 0.5)).toBe("#808000");
  });
});

describe("데이터 막대", () => {
  it("최소에서 0, 최대에서 1이다", () => {
    const numbers = [10, 20, 30];
    expect(barRatio(bar(false), 10, numbers)).toBe(0);
    expect(barRatio(bar(false), 30, numbers)).toBe(1);
    expect(barRatio(bar(false), 20, numbers)).toBe(0.5);
  });

  it("0 기준으로 재면 최솟값에도 막대가 남는다", () => {
    const numbers = [10, 20];
    expect(barRatio(bar(true), 10, numbers)).toBe(0.5);
    expect(barRatio(bar(true), 20, numbers)).toBe(1);
  });

  it("음수는 0 기준에서 빈 막대가 된다", () => {
    expect(barRatio(bar(true), -5, [-5, 10])).toBe(0);
    expect(barRatio(bar(false), -5, [-5, 10])).toBe(0);
  });

  it("전부 같은 값이면 절반이다 — 길이로 순위를 말할 수 없다", () => {
    expect(barRatio(bar(false), 7, [7, 7, 7])).toBe(0.5);
  });

  it("수가 아닌 칸에는 막대가 없다", () => {
    const rule = bar(false);
    const stats = collectStats([cell(10), cell("가"), BLANK]);
    expect(matchesRule(rule, cell("가"), stats)).toBe(false);
    expect(matchesRule(rule, BLANK, stats)).toBe(false);
    expect(matchesRule(rule, cell(10), stats)).toBe(true);
  });
});

describe("규칙 겹침", () => {
  it("규칙이 하나도 없으면 서식도 없다", () => {
    expect(paintRules([], cell(1), NO_STATS)).toBeNull();
  });

  it("아무 규칙에도 안 걸리면 null이다", () => {
    expect(paintRules([compare("gt", "100")], cell(1), NO_STATS)).toBeNull();
  });

  it("앞 규칙이 정한 속성을 뒤 규칙이 덮지 못한다 — 목록 순서가 순위다", () => {
    const first = compare("gt", "0", "", { fill: "#111111" });
    const second = compare("gt", "0", "", { fill: "#222222", bold: true });
    const paint = paintRules([first, second], cell(5), NO_STATS);
    expect(paint?.style.fill).toBe("#111111");
    // 앞 규칙이 정하지 않은 속성은 뒤 규칙이 채운다.
    expect(paint?.style.bold).toBe(true);
  });

  it("순서를 뒤집으면 이기는 색도 뒤집힌다", () => {
    const a = compare("gt", "0", "", { fill: "#111111" });
    const b = compare("gt", "0", "", { fill: "#222222" });
    expect(paintRules([b, a], cell(5), NO_STATS)?.style.fill).toBe("#222222");
  });

  it("참이면 중지가 걸린 규칙이 걸리면 아래 규칙은 보지도 않는다", () => {
    const stop = { ...compare("gt", "0", "", { fill: "#111111" }), stopIfTrue: true };
    const below = compare("gt", "0", "", { bold: true });
    const paint = paintRules([stop, below], cell(5), NO_STATS);
    expect(paint?.style.fill).toBe("#111111");
    expect(paint?.style.bold).toBeUndefined();
  });

  it("중지가 걸려 있어도 그 규칙이 안 걸리면 아래로 넘어간다", () => {
    const stop = { ...compare("gt", "100", "", { fill: "#111111" }), stopIfTrue: true };
    const below = compare("gt", "0", "", { bold: true });
    expect(paintRules([stop, below], cell(5), NO_STATS)?.style.bold).toBe(true);
  });

  it("색조가 앞에 있으면 채우기색을 가져가고, 막대는 따로 남는다", () => {
    const cells = [cell(0), cell(50), cell(100)];
    const rules = [scale(GRAY, false), bar(false), compare("gt", "0", "", { fill: "#111111" })];
    const paint = paintRules(rules, cell(100), statsOf(cells));
    expect(paint?.style.fill).toBe("#ffffff");
    expect(paint?.bar).toEqual({ ratio: 1, color: "#638ec6" });
  });

  it("막대만 걸린 칸도 서식이 있는 것으로 센다", () => {
    const paint = paintRules([bar(false)], cell(5), statsOf([cell(0), cell(10)]));
    expect(paint?.bar?.ratio).toBe(0.5);
    expect(paint?.style).toEqual({});
  });

  it("굳힌 판정은 규칙 목록과 같은 차례로 나온다", () => {
    const rules = [compare("gt", "0"), text("contains", "가")];
    const judges = compileRules(rules);
    expect(judges.map((judge) => judge.rule.id)).toEqual(rules.map((rule) => rule.id));
    expect(judges[1].hits(cell("가나"))).toBe(true);
  });
});

describe("행·열이 밀릴 때", () => {
  const rule = (area: Area): CondRule => ({
    id: "one",
    range: area,
    kind: "blank",
    op: "blank",
    style: RED,
  });
  const rows = (top: number, bottom: number): Area => ({ top, left: 1, bottom, right: 3 });

  it("위쪽에 행을 끼우면 범위가 통째로 내려온다", () => {
    const [out] = shiftRules([rule(rows(4, 8))], "row", 0, 2);
    expect(out.range).toEqual(rows(6, 10));
  });

  it("범위 안에 끼우면 아래쪽만 늘어난다", () => {
    const [out] = shiftRules([rule(rows(4, 8))], "row", 6, 2);
    expect(out.range).toEqual(rows(4, 10));
  });

  it("범위 아래에 끼우면 그대로다", () => {
    const [out] = shiftRules([rule(rows(4, 8))], "row", 9, 3);
    expect(out.range).toEqual(rows(4, 8));
  });

  it("범위와 겹치는 줄을 지우면 그만큼 줄어든다", () => {
    const [out] = shiftRules([rule(rows(4, 8))], "row", 2, -3);
    expect(out.range).toEqual(rows(2, 5));
  });

  it("범위를 통째로 지우면 규칙도 사라진다 — 남겨 두면 엉뚱한 줄을 칠한다", () => {
    expect(shiftRules([rule(rows(4, 8))], "row", 4, -5)).toEqual([]);
  });

  it("열도 같은 규칙으로 민다", () => {
    const [out] = shiftRules([rule(rows(4, 8))], "col", 0, 1);
    expect(out.range).toEqual({ top: 4, left: 2, bottom: 8, right: 4 });
    expect(shiftRules([rule(rows(4, 8))], "col", 1, -3)).toEqual([]);
  });
});

describe("xlsx 왕복", () => {
  /** 규칙만 든 통합문서 한 장. */
  function book(rules: CondRule[]): WorkbookDoc {
    const sheet = emptySheet("Sheet1");
    sheet.cells.set(cellKey(0, 0), { v: 1 });
    sheet.cells.set(cellKey(1, 0), { v: 2 });
    sheet.condFormats = rules;
    return { sheets: [sheet], active: 0, filename: "cf.xlsx", origin: "xlsx" };
  }

  async function roundTrip(rules: CondRule[]): Promise<CondRule[]> {
    const bytes = await writeXlsx(book(rules));
    const read = await readXlsx(bytes.buffer as ArrayBuffer, "cf.xlsx");
    expect(read.condSkipped).toBe(0);
    return read.book.sheets[0].condFormats ?? [];
  }

  it("값 비교·글자·빈 칸이 그대로 돌아온다", async () => {
    const area = parseArea("A1:A9") as Area;
    const rules: CondRule[] = [
      { id: "a", range: area, kind: "compare", op: "gt", value: "10", value2: "", style: RED },
      { id: "b", range: area, kind: "compare", op: "between", value: "1", value2: "5", style: RED },
      { id: "c", range: area, kind: "text", op: "contains", value: "가", style: RED },
      { id: "d", range: area, kind: "text", op: "startsWith", value: "나", style: RED },
      { id: "e", range: area, kind: "blank", op: "blank", style: RED },
    ];
    const back = await roundTrip(rules);
    expect(back.map((rule) => `${rule.kind}:${"op" in rule ? rule.op : ""}`)).toEqual([
      "compare:gt",
      "compare:between",
      "text:contains",
      "text:startsWith",
      "blank:blank",
    ]);
    expect(back[0].range).toEqual(area);
    expect((back[1] as { value: string; value2?: string }).value2).toBe("5");
    expect((back[2] as { value: string }).value).toBe("가");
    expect(back[0].kind === "compare" && back[0].style.fill).toBe(RED.fill);
  });

  it("중복·상위 N·색조·막대도 돌아온다", async () => {
    const area = parseArea("A1:A9") as Area;
    const rules: CondRule[] = [
      { id: "a", range: area, kind: "dup", op: "duplicate", style: RED },
      { id: "b", range: area, kind: "rank", op: "bottom", n: 3, percent: true, style: RED },
      { id: "c", range: area, kind: "scale", stops: scaleStops(GRAY, true) },
      {
        id: "d",
        range: area,
        kind: "bar",
        color: "#638ec6",
        min: { type: "num", value: 0 },
        max: { type: "max" },
      },
    ];
    const back = await roundTrip(rules);
    expect(back.map((rule) => rule.kind)).toEqual(["dup", "rank", "scale", "bar"]);
    expect(back[1]).toMatchObject({ op: "bottom", n: 3, percent: true });
    expect(back[2].kind === "scale" && back[2].stops.map((stop) => stop.color)).toEqual(GRAY);
    expect(back[3]).toMatchObject({ color: "#638ec6", min: { type: "num", value: 0 } });
  });

  it("나머지 연산자도 그대로 돌아온다 — 포함 안 함·끝·같지 않음·사이 아님·고유·빈 칸 아님", async () => {
    const area = parseArea("A1:A9") as Area;
    const rules: CondRule[] = [
      { id: "a", range: area, kind: "text", op: "notContains", value: "가", style: RED },
      { id: "b", range: area, kind: "text", op: "endsWith", value: "나", style: RED },
      { id: "c", range: area, kind: "compare", op: "ne", value: "7", value2: "", style: RED },
      { id: "d", range: area, kind: "compare", op: "notBetween", value: "1", value2: "5", style: RED },
      { id: "e", range: area, kind: "dup", op: "unique", style: RED },
      { id: "f", range: area, kind: "blank", op: "notBlank", style: RED },
    ];
    const back = await roundTrip(rules);
    expect(back.map((rule) => `${rule.kind}:${"op" in rule ? rule.op : ""}`)).toEqual([
      "text:notContains",
      "text:endsWith",
      "compare:ne",
      "compare:notBetween",
      "dup:unique",
      "blank:notBlank",
    ]);
    expect((back[1] as { value: string }).value).toBe("나");
    expect((back[3] as { value2?: string }).value2).toBe("5");
  });

  it("따옴표·쉼표가 든 글자도 왕복한다 — 수식 규칙으로 나가는 자리라 잘리기 쉽다", async () => {
    const area = parseArea("A1:A9") as Area;
    const back = await roundTrip([
      { id: "a", range: area, kind: "text", op: "contains", value: 'a"b', style: RED },
      { id: "b", range: area, kind: "text", op: "startsWith", value: "x,y", style: RED },
    ]);
    expect(back.map((rule) => ("value" in rule ? rule.value : ""))).toEqual(['a"b', "x,y"]);
  });

  it("범위를 못 읽은 규칙도 못 읽은 수로 센다 — 조용히 넘기면 저장할 때 사라진다", () => {
    const read = condRulesFromXlsx([
      // 엑셀은 온열 범위를 "A:A"로도 쓴다 — 우리 파서가 못 읽는 모양이다.
      { ref: "A:A", rules: [{ type: "cellIs", operator: "greaterThan", formulae: ["1"] }] },
    ]);
    expect(read.rules).toHaveLength(0);
    expect(read.skipped).toBe(1);
  });

  it("목록 순서가 저장을 건너도 유지된다 — 순서가 곧 우선순위다", async () => {
    const area = parseArea("B2:C4") as Area;
    const rules: CondRule[] = [
      { id: "a", range: area, kind: "compare", op: "lt", value: "1", value2: "", style: { fill: "#111111" } },
      { id: "b", range: area, kind: "compare", op: "lt", value: "2", value2: "", style: { fill: "#222222" } },
      { id: "c", range: area, kind: "compare", op: "lt", value: "3", value2: "", style: { fill: "#333333" } },
    ];
    const back = await roundTrip(rules);
    expect(back.map((rule) => (rule.kind === "compare" ? rule.value : ""))).toEqual(["1", "2", "3"]);
    expect(back[0].range).toEqual(area);
  });

  it("우리가 모르는 종류(아이콘 집합·기간)는 못 읽은 수로 센다 — 조용히 잃지 않는다", () => {
    const read = condRulesFromXlsx([
      {
        ref: "A1:A9",
        rules: [
          { type: "iconSet", priority: 1, iconSet: "3TrafficLights1" },
          { type: "timePeriod", priority: 2, timePeriod: "today" },
          { type: "cellIs", priority: 3, operator: "greaterThan", formulae: ["10"] },
        ],
      },
    ]);
    expect(read.skipped).toBe(2);
    expect(read.rules).toHaveLength(1);
    expect(read.rules[0]).toMatchObject({ kind: "compare", op: "gt", value: "10" });
  });

  it("엑셀이 쓴 중복 값 규칙도 읽는다 — 우리는 같은 뜻의 수식 규칙으로 내보낸다", () => {
    const read = condRulesFromXlsx([
      { ref: "B2:B9", rules: [{ type: "duplicateValues", priority: 1 }] },
      { ref: "C2:C9", rules: [{ type: "uniqueValues", priority: 2 }] },
    ]);
    expect(read.skipped).toBe(0);
    expect(read.rules.map((rule) => (rule.kind === "dup" ? rule.op : ""))).toEqual([
      "duplicate",
      "unique",
    ]);
  });

  it("한 규칙이 여러 범위에 걸려 있으면 범위마다 하나씩 만든다", () => {
    const read = condRulesFromXlsx([
      {
        ref: "A1:A3 C1:C3",
        rules: [{ type: "containsText", operator: "containsBlanks", priority: 1 }],
      },
    ]);
    expect(read.rules.map((rule) => rule.range)).toEqual([
      parseArea("A1:A3"),
      parseArea("C1:C3"),
    ]);
  });

  /**
   * dxf(규칙이 칠하는 서식)는 셀 채우기와 읽고 쓰는 자리가 다르다.
   * 엑셀은 `<patternFill><bgColor …/></patternFill>`로 쓰고 ExcelJS README의
   * 조건부 서식 예제도 bgColor를 쓴다. 우리가 예전에 쓴 파일은 fgColor에 있다.
   */
  it("채우기색이 bgColor로도 나간다 — 엑셀이 읽는 자리다", () => {
    const out = toXlsxCondRule(compare("gt", "1")) as {
      style: { fill: Record<string, unknown>; font: Record<string, unknown> };
    };
    expect(out.style.fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFEE2E2" },
      bgColor: { argb: "FFFEE2E2" },
    });
    expect(out.style.font).toEqual({ color: { argb: "FF991B1B" } });
  });

  it("엑셀이 bgColor로만 쓴 dxf도 읽는다", () => {
    const read = condRulesFromXlsx([
      {
        ref: "A1:A9",
        rules: [
          {
            type: "cellIs",
            priority: 1,
            operator: "greaterThan",
            formulae: ["10"],
            // 엑셀이 쓰는 모양 — patternType이 없고 색은 bgColor 하나뿐이다.
            style: { fill: { type: "pattern", bgColor: { argb: "FFFFC7CE" } } },
          },
        ],
      },
    ]);
    expect(read.rules[0].kind === "compare" && read.rules[0].style.fill).toBe("#ffc7ce");
  });

  it("우리가 예전에 쓴 fgColor 파일도 그대로 읽는다", () => {
    const read = condRulesFromXlsx([
      {
        ref: "A1:A9",
        rules: [
          {
            type: "cellIs",
            priority: 1,
            operator: "greaterThan",
            formulae: ["10"],
            style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } } },
          },
        ],
      },
    ]);
    expect(read.rules[0].kind === "compare" && read.rules[0].style.fill).toBe("#fee2e2");
  });

  /**
   * 셀 서식을 읽을 때는 흰 채우기·검은 글자색을 "지정 안 함"으로 보고 버린다(기본값이라서).
   * 규칙이 정한 색은 사용자가 고른 값이라 버리면 규칙이 열 때마다 색을 잃는다.
   */
  it("흰 채우기·검은 글자색도 규칙에서는 살아 온다", () => {
    const read = condRulesFromXlsx([
      {
        ref: "A1:A9",
        rules: [
          {
            type: "cellIs",
            priority: 1,
            operator: "equal",
            formulae: ["0"],
            style: {
              font: { color: { argb: "FF000000" } },
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFFF" } },
            },
          },
        ],
      },
    ]);
    const rule = read.rules[0];
    expect(rule.kind === "compare" && rule.style).toEqual({ color: "#000000", fill: "#ffffff" });
  });

  it("흰 채우기·검은 글자색이 저장을 건너도 남는다", async () => {
    const white: CondStyle = { fill: "#ffffff", color: "#000000" };
    const back = await roundTrip([
      { id: "a", range: parseArea("A1:A9") as Area, kind: "blank", op: "blank", style: white },
    ]);
    expect(back[0].kind === "blank" && back[0].style).toEqual(white);
  });
});

/**
 * 저장해도 파일에 안 담기는 것 — 고칠 수 없는 한계라 세어서 화면에 알린다.
 * 조용히 넘기면 왕복 한 번에 규칙이 사라진다(읽을 때의 `condSkipped`와 짝이다).
 */
describe("xlsx로 못 내보내는 것 세기", () => {
  function bookOf(patch: (sheet: ReturnType<typeof emptySheet>) => void): WorkbookDoc {
    const sheet = emptySheet("Sheet1");
    patch(sheet);
    return { sheets: [sheet], active: 0, filename: "x.xlsx", origin: "xlsx" };
  }

  const plain = (stopIfTrue?: boolean): CondRule => ({
    id: id(),
    range: parseArea("A1:A9") as Area,
    kind: "blank",
    op: "blank",
    style: RED,
    ...(stopIfTrue ? { stopIfTrue: true } : {}),
  });

  it("담기는 것만 있으면 0이다", () => {
    expect(xlsxLosses(bookOf((s) => (s.condFormats = [plain()])))).toEqual({
      stopIfTrue: 0,
      validation: 0,
    });
  });

  it('"참이면 중지"가 걸린 규칙을 센다 — ExcelJS가 그 속성을 다루지 않는다', () => {
    const book = bookOf((s) => (s.condFormats = [plain(true), plain(), plain(true)]));
    expect(xlsxLosses(book).stopIfTrue).toBe(2);
  });

  it("엑셀 모양으로 못 옮기는 입력 규칙도 센다", () => {
    const book = bookOf((s) => {
      s.validations = [
        // 비교값이 수로 안 읽히는 규칙 — 엑셀에서 온 `=$A$1` 같은 경계가 이 꼴이다.
        { area: parseArea("B1:B9") as Area, rule: { kind: "whole", op: "gt", value: "$A$1", allowBlank: true, action: "reject" } },
        { area: parseArea("C1:C9") as Area, rule: { kind: "whole", op: "gt", value: "10", allowBlank: true, action: "reject" } },
      ];
    });
    expect(xlsxLosses(book)).toEqual({ stopIfTrue: 0, validation: 1 });
  });

  it("여러 장이면 다 더한다", () => {
    const one = emptySheet("Sheet1");
    one.condFormats = [plain(true)];
    const two = emptySheet("Sheet2");
    two.condFormats = [plain(true), plain(true)];
    expect(
      xlsxLosses({ sheets: [one, two], active: 0, filename: "x.xlsx", origin: "xlsx" }).stopIfTrue,
    ).toBe(3);
  });
});
