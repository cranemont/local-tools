/** 조건부 서식 — 규칙·판정·집계·보간·합성. **문서 객체를 모른다.**
 *
 * 들어오는 것은 필터와 같은 모양의 칸 하나(`CondCell` = 값 + 화면에 보이는 글자)와
 * 규칙뿐이다. 값 비교·같음 판정·대소문자 접기는 `filter.ts`의 것을 그대로 쓴다 —
 * "100"과 100이 필터에서는 같은데 조건부 서식에서는 다르면 같은 표를 두 번 배우게 된다.
 *
 * 세 가지가 여기서 갈린다.
 *   ① 칸 하나로 답할 수 있는 규칙(비교·글자·빈 칸)과 범위 전체를 봐야 하는 규칙
 *      (중복·상위/하위·색조·막대). 뒤엣것은 `CondStats`를 받는다.
 *   ② 규칙이 겹칠 때의 우선순위 — 목록 순서가 곧 순위이고, 앞 규칙이 정한 속성을
 *      뒤 규칙이 덮지 못한다. `stopIfTrue`가 참이면 뒤는 보지도 않는다(엑셀과 같다).
 *   ③ 값 하나로는 위치를 잴 수 없는 경우(최소 = 최대). 그때 자리는 0.5다 —
 *      색조는 가운데 색, 막대는 절반이 된다. 0으로 두면 "제일 작다"는 거짓이 된다.
 */

import type { Area } from "./a1";
import {
  cellEquals,
  cellOrder,
  foldText,
  isBlank,
  operandOf,
  type FilterCell,
} from "./filter";

/** 조건부 서식이 보는 칸 하나. 필터와 같은 모양이다. */
export type CondCell = FilterCell;

/**
 * 규칙이 칠하는 서식. 셀 서식(`CellStyle`)의 부분집합이라 그리드가 같은 방식으로 그린다.
 * **켜는 것만 있다** — 직접 지정한 굵게를 조건부가 끄지는 못한다.
 */
export interface CondStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** #rrggbb */
  color?: string;
  /** #rrggbb */
  fill?: string;
}

export const COMPARE_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "between", "notBetween"] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

export const TEXT_OPS = ["contains", "notContains", "startsWith", "endsWith"] as const;
export type TextOp = (typeof TEXT_OPS)[number];

export const BLANK_OPS = ["blank", "notBlank"] as const;
export type BlankOp = (typeof BLANK_OPS)[number];

export const DUP_OPS = ["duplicate", "unique"] as const;
export type DupOp = (typeof DUP_OPS)[number];

export const RANK_OPS = ["top", "bottom"] as const;
export type RankOp = (typeof RANK_OPS)[number];

/** 비교값을 몇 개 받는가 — 화면이 입력란 수를 정하는 데 쓴다. */
export function compareArity(op: CompareOp): 1 | 2 {
  return op === "between" || op === "notBetween" ? 2 : 1;
}

/** 색조·막대의 기준점 하나. */
export interface CondPoint {
  type: "min" | "max" | "num" | "percent" | "percentile";
  /** num·percent·percentile일 때의 수. */
  value?: number;
}

export interface ScaleStop {
  at: CondPoint;
  /** #rrggbb */
  color: string;
}

interface RuleBase {
  /** 목록·집계 캐시가 쓰는 키. 문서 안에서만 유일하면 된다. */
  id: string;
  range: Area;
  /** 참이면 아래 규칙을 보지 않는다. 색조·막대에는 없다(엑셀도 그렇다). */
  stopIfTrue?: boolean;
}

export interface CompareRule extends RuleBase {
  kind: "compare";
  op: CompareOp;
  /** 사람이 친 글자 그대로. 수·날짜 해석은 술어를 만들 때 한 번만 한다. */
  value: string;
  value2?: string;
  style: CondStyle;
}

export interface TextRule extends RuleBase {
  kind: "text";
  op: TextOp;
  value: string;
  style: CondStyle;
}

export interface BlankRule extends RuleBase {
  kind: "blank";
  op: BlankOp;
  style: CondStyle;
}

export interface DupRule extends RuleBase {
  kind: "dup";
  op: DupOp;
  style: CondStyle;
}

export interface RankRule extends RuleBase {
  kind: "rank";
  op: RankOp;
  /** 몇 칸(또는 몇 %). */
  n: number;
  percent: boolean;
  style: CondStyle;
}

export interface ScaleRule extends RuleBase {
  kind: "scale";
  /** 두 개(2색) 또는 세 개(3색). 앞이 최소 쪽이다. */
  stops: ScaleStop[];
}

export interface BarRule extends RuleBase {
  kind: "bar";
  /** #rrggbb */
  color: string;
  min: CondPoint;
  max: CondPoint;
}

export type CondRule =
  | CompareRule
  | TextRule
  | BlankRule
  | DupRule
  | RankRule
  | ScaleRule
  | BarRule;

/** 서식을 사용자가 고르는 규칙 — 색조·막대는 색이 값에서 나오므로 빠진다. */
export type StyledRule = CompareRule | TextRule | BlankRule | DupRule | RankRule;

export function isStyled(rule: CondRule): rule is StyledRule {
  return rule.kind !== "scale" && rule.kind !== "bar";
}

/** 범위 전체를 봐야 답할 수 있는 규칙인가 — 집계를 계산할지 정한다. */
export function needsStats(rule: CondRule): boolean {
  return rule.kind === "dup" || rule.kind === "rank" || rule.kind === "scale" || rule.kind === "bar";
}

let idSeq = 0;

export function newRuleId(): string {
  idSeq += 1;
  return `cf${idSeq}`;
}

// ── 집계 ────────────────────────────────────────────────────────

/** 범위 하나의 집계. 값 배열만 받는다 — 어느 셀에서 왔는지는 알 필요가 없다. */
export interface CondStats {
  /** 오름차순으로 정렬한 수 값들. 빈 칸·글자·오류는 없다. */
  numbers: number[];
  /** 대소문자를 접은 표시 문자열 → 그 글자로 보이는 칸 수. 빈 칸은 세지 않는다. */
  counts: Map<string, number>;
}

/**
 * 값 배열 → 집계.
 *
 * 중복 판정이 **표시 문자열** 기준인 것은 필터의 고유값 목록과 같은 이유다 —
 * 원문이 남은 칸(CLAUDE.md 23번)은 값이 1.5여도 화면에는 "1.50"으로 보인다.
 * 화면에 다르게 보이는 두 칸을 중복이라고 칠하면 어디가 같은지 볼 수가 없다.
 */
export function collectStats(cells: CondCell[]): CondStats {
  const numbers: number[] = [];
  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (isBlank(cell)) continue;
    if (typeof cell.v === "number") numbers.push(cell.v);
    const key = foldText(cell.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  numbers.sort((a, b) => a - b);
  return { numbers, counts };
}

/**
 * 상위/하위 N의 경계값. 이 값과 같은 칸도 걸린다 — 동점이면 N보다 많이 칠해진다(엑셀과 같다).
 * 셀 수가 0이거나 N이 0 이하면 null(아무것도 안 걸린다).
 */
export function rankCut(rule: RankRule, numbers: number[]): number | null {
  const count = numbers.length;
  if (count === 0) return null;
  const wanted = rule.percent ? Math.ceil((count * rule.n) / 100) : Math.floor(rule.n);
  const k = Math.min(Math.max(wanted, 0), count);
  if (k <= 0) return null;
  return rule.op === "top" ? numbers[count - k] : numbers[k - 1];
}

// ── 보간 ────────────────────────────────────────────────────────

/** 기준점 → 실제 수. 범위에 수가 하나도 없으면 null. */
export function pointValue(point: CondPoint, numbers: number[]): number | null {
  if (point.type === "num") return Number.isFinite(point.value) ? (point.value as number) : null;
  if (numbers.length === 0) return null;
  const lo = numbers[0];
  const hi = numbers[numbers.length - 1];
  switch (point.type) {
    case "min":
      return lo;
    case "max":
      return hi;
    case "percent": {
      const p = point.value ?? 0;
      return lo + ((hi - lo) * p) / 100;
    }
    case "percentile": {
      const p = Math.min(Math.max(point.value ?? 0, 0), 100);
      const at = ((numbers.length - 1) * p) / 100;
      const i = Math.floor(at);
      const frac = at - i;
      const next = numbers[Math.min(i + 1, numbers.length - 1)];
      return numbers[i] + (next - numbers[i]) * frac;
    }
  }
}

/**
 * 값이 lo..hi에서 차지하는 자리(0..1).
 * **범위가 한 점이면 0.5다** — 값이 하나뿐이면 크고 작음을 말할 수 없다.
 */
export function scalePosition(value: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 0.5;
  if (value <= lo) return 0;
  if (value >= hi) return 1;
  return (value - lo) / (hi - lo);
}

function channel(hex: string, at: number): number {
  return parseInt(hex.slice(at, at + 2), 16);
}

/** 두 색을 t(0..1)만큼 섞는다. sRGB에서 그대로 섞는다(엑셀과 같다). */
export function mixColor(a: string, b: string, t: number): string {
  const x = a.replace("#", "");
  const y = b.replace("#", "");
  if (x.length !== 6 || y.length !== 6) return a;
  const k = Math.min(Math.max(t, 0), 1);
  let out = "#";
  for (let i = 0; i < 6; i += 2) {
    const v = Math.round(channel(x, i) + (channel(y, i) - channel(x, i)) * k);
    out += Math.min(Math.max(v, 0), 255).toString(16).padStart(2, "0");
  }
  return out;
}

/** 색 눈금을 0..1로 펴서 읽는다 — 값을 못 재는 경우(최소 = 최대)에만 쓴다. */
function colorAt(stops: ScaleStop[], t: number): string {
  const last = stops.length - 1;
  if (last <= 0) return stops[0]?.color ?? "#ffffff";
  const x = Math.min(Math.max(t, 0), 1) * last;
  const i = Math.min(Math.floor(x), last - 1);
  return mixColor(stops[i].color, stops[i + 1].color, x - i);
}

/** 색조가 이 값에 주는 색. 값이 수가 아니거나 기준점을 못 구하면 null. */
export function scaleFill(rule: ScaleRule, value: number, numbers: number[]): string | null {
  if (rule.stops.length < 2) return null;
  const points: number[] = [];
  for (const stop of rule.stops) {
    const p = pointValue(stop.at, numbers);
    if (p === null) return null;
    points.push(p);
  }
  const last = points.length - 1;
  const lo = points[0];
  const hi = points[last];
  if (!(hi > lo)) return colorAt(rule.stops, 0.5);

  // 양 끝은 먼저 못 박는다. 가운데 기준점이 끝에 붙어 버리는 일이 흔한데
  // (0이 절반인 열이면 중앙값 = 최솟값이다) 그때 최솟값 칸이 섞인 색을 받으면
  // "제일 작다"가 화면에서 사라진다.
  if (value <= lo) return rule.stops[0].color;
  if (value >= hi) return rule.stops[last].color;

  // points[i] <= value < points[i + 1]인 구간을 고른다.
  let i = 0;
  while (i < last - 1 && points[i + 1] <= value) i++;
  // 폭이 0인 구간(기준점 둘이 같은 수)에서는 섞을 자리가 없다 — 위쪽 색으로 넘긴다.
  if (!(points[i + 1] > points[i])) return rule.stops[i + 1].color;
  return mixColor(
    rule.stops[i].color,
    rule.stops[i + 1].color,
    scalePosition(value, points[i], points[i + 1]),
  );
}

/** 데이터 막대가 채우는 비율(0..1). 기준점을 못 구하면 null. */
export function barRatio(rule: BarRule, value: number, numbers: number[]): number | null {
  const lo = pointValue(rule.min, numbers);
  const hi = pointValue(rule.max, numbers);
  if (lo === null || hi === null) return null;
  return scalePosition(value, lo, hi);
}

// ── 판정 ────────────────────────────────────────────────────────

/** 규칙 하나를 굳힌 판정. 비교값 해석은 만들 때 한 번만 한다. */
export interface CondJudge {
  rule: CondRule;
  hits(cell: CondCell, stats?: CondStats): boolean;
}

function compareJudge(rule: CompareRule): (cell: CondCell) => boolean {
  const text = rule.value ?? "";
  const text2 = rule.value2 ?? "";
  const a = operandOf(text);
  const b = operandOf(text2);
  // 사이는 두 값을 거꾸로 넣어도 같은 뜻으로 읽는다(필터와 같다).
  const flip = a !== null && b !== null && (cellOrder({ v: a, text: "" }, b) ?? 0) > 0;
  const lo = flip ? b : a;
  const hi = flip ? a : b;
  const inside = (cell: CondCell): boolean | null => {
    const low = cellOrder(cell, lo);
    const high = cellOrder(cell, hi);
    if (low === null || high === null) return null;
    return low >= 0 && high <= 0;
  };

  switch (rule.op) {
    case "eq":
      return (cell) => cellEquals(cell, a, text);
    case "ne":
      return (cell) => !cellEquals(cell, a, text);
    case "gt":
      return (cell) => (cellOrder(cell, a) ?? 0) > 0;
    case "gte":
      return (cell) => {
        const d = cellOrder(cell, a);
        return d !== null && d >= 0;
      };
    case "lt":
      return (cell) => (cellOrder(cell, a) ?? 0) < 0;
    case "lte":
      return (cell) => {
        const d = cellOrder(cell, a);
        return d !== null && d <= 0;
      };
    case "between":
      return (cell) => inside(cell) === true;
    case "notBetween":
      return (cell) => inside(cell) === false;
  }
}

function textJudge(rule: TextRule): (cell: CondCell) => boolean {
  const needle = foldText(rule.value ?? "");
  switch (rule.op) {
    case "contains":
      return (cell) => foldText(cell.text).includes(needle);
    case "notContains":
      return (cell) => !foldText(cell.text).includes(needle);
    case "startsWith":
      return (cell) => foldText(cell.text).startsWith(needle);
    case "endsWith":
      return (cell) => foldText(cell.text).endsWith(needle);
  }
}

/** 규칙 목록을 판정 목록으로. 그리드는 리비전마다 한 번만 부른다. */
export function compileRules(rules: CondRule[]): CondJudge[] {
  return rules.map((rule): CondJudge => {
    switch (rule.kind) {
      case "compare": {
        const test = compareJudge(rule);
        return { rule, hits: (cell) => test(cell) };
      }
      case "text": {
        const test = textJudge(rule);
        return { rule, hits: (cell) => test(cell) };
      }
      case "blank": {
        const want = rule.op === "blank";
        return { rule, hits: (cell) => isBlank(cell) === want };
      }
      case "dup":
        return {
          rule,
          hits: (cell, stats) => {
            if (!stats || isBlank(cell)) return false;
            const n = stats.counts.get(foldText(cell.text)) ?? 0;
            return rule.op === "duplicate" ? n > 1 : n === 1;
          },
        };
      case "rank":
        return {
          rule,
          hits: (cell, stats) => {
            if (!stats || typeof cell.v !== "number") return false;
            const cut = rankCut(rule, stats.numbers);
            if (cut === null) return false;
            return rule.op === "top" ? cell.v >= cut : cell.v <= cut;
          },
        };
      case "scale":
      case "bar":
        return { rule, hits: (cell) => typeof cell.v === "number" };
    }
  });
}

/** 규칙 하나가 이 칸에 걸리는가. 색조·막대는 값이 수이기만 하면 참이다. */
export function matchesRule(rule: CondRule, cell: CondCell, stats?: CondStats): boolean {
  return compileRules([rule])[0].hits(cell, stats);
}

// ── 합성 ────────────────────────────────────────────────────────

/** 여러 규칙이 겹친 결과 — 그리드가 이대로 그린다. */
export interface CondPaint {
  style: CondStyle;
  /** 데이터 막대. ratio는 0..1. */
  bar?: { ratio: number; color: string };
}

/** 앞 규칙이 정한 속성은 뒤 규칙이 덮지 못한다. */
function layer(into: CondStyle, over: CondStyle): void {
  if (into.bold === undefined && over.bold !== undefined) into.bold = over.bold;
  if (into.italic === undefined && over.italic !== undefined) into.italic = over.italic;
  if (into.strike === undefined && over.strike !== undefined) into.strike = over.strike;
  if (into.color === undefined && over.color !== undefined) into.color = over.color;
  if (into.fill === undefined && over.fill !== undefined) into.fill = over.fill;
}

/**
 * 칸 하나의 최종 서식. 아무 규칙도 안 걸리면 null.
 *
 * **목록 순서가 우선순위다**(앞이 1순위, 엑셀과 같다). 앞 규칙이 정한 속성을 뒤 규칙이
 * 덮지 못하고, 앞 규칙이 정하지 않은 속성은 뒤 규칙이 채운다 — 그래서 "1순위가 글자색,
 * 2순위가 채우기색"이 함께 보인다. `stopIfTrue`가 걸린 규칙이 참이면 거기서 멈춘다.
 *
 * 집계는 필요할 때만 `statsOf`로 물어본다 — 규칙이 걸리지 않는 칸에서 5만 행을 세지
 * 않으려는 것이다.
 */
export function paintCell(
  judges: CondJudge[],
  cell: CondCell,
  statsOf: (rule: CondRule) => CondStats,
): CondPaint | null {
  const style: CondStyle = {};
  let bar: CondPaint["bar"];
  let hit = false;

  for (const judge of judges) {
    const rule = judge.rule;
    const stats = needsStats(rule) ? statsOf(rule) : undefined;
    if (!judge.hits(cell, stats)) continue;

    if (rule.kind === "scale") {
      const fill = scaleFill(rule, cell.v as number, stats?.numbers ?? []);
      if (fill === null) continue;
      hit = true;
      layer(style, { fill });
      continue;
    }
    if (rule.kind === "bar") {
      const ratio = barRatio(rule, cell.v as number, stats?.numbers ?? []);
      if (ratio === null) continue;
      hit = true;
      if (!bar) bar = { ratio, color: rule.color };
      continue;
    }

    hit = true;
    layer(style, rule.style);
    if (rule.stopIfTrue) break;
  }

  if (!hit) return null;
  if (bar === undefined && Object.keys(style).length === 0) return null;
  return bar ? { style, bar } : { style };
}

/** 규칙 목록을 그대로 받는 판정 — 화면 밖(테스트·한 번만 쓰는 자리)에서 쓴다. */
export function paintRules(
  rules: CondRule[],
  cell: CondCell,
  statsOf: (rule: CondRule) => CondStats,
): CondPaint | null {
  return paintCell(compileRules(rules), cell, statsOf);
}

// ── 행·열이 밀릴 때 ─────────────────────────────────────────────

function shiftSpan(
  start: number,
  end: number,
  at: number,
  delta: number,
): { start: number; end: number } | null {
  if (delta > 0) {
    return { start: start >= at ? start + delta : start, end: end >= at ? end + delta : end };
  }
  const count = -delta;
  const move = (x: number, low: boolean): number => {
    if (x >= at + count) return x - count;
    if (x >= at) return low ? at : at - 1;
    return x;
  };
  const s = move(start, true);
  const e = move(end, false);
  return e < s ? null : { start: s, end: e };
}

/**
 * 행·열이 끼워지거나 지워졌을 때 규칙 범위를 따라 옮긴다.
 * 범위가 통째로 지워진 규칙은 목록에서 사라진다 — 남겨 두면 엉뚱한 줄을 칠한다.
 */
export function shiftRules(
  rules: CondRule[],
  axis: "row" | "col",
  at: number,
  delta: number,
): CondRule[] {
  if (delta === 0) return rules;
  const out: CondRule[] = [];
  for (const rule of rules) {
    const range = rule.range;
    const span =
      axis === "row"
        ? shiftSpan(range.top, range.bottom, at, delta)
        : shiftSpan(range.left, range.right, at, delta);
    if (!span) continue;
    const next: Area =
      axis === "row"
        ? { ...range, top: span.start, bottom: span.end }
        : { ...range, left: span.start, right: span.end };
    out.push({ ...rule, range: next });
  }
  return out;
}

// ── 미리 준비한 색 ──────────────────────────────────────────────
//
// 규칙에 적히는 색은 화면 장식이 아니라 **문서에 저장되고 xlsx로 나가는 값**이라
// 토큰이 아닌 hex다(셀 채우기색과 같은 갈래). 라이트·다크 어느 쪽에서도 읽히도록
// 채우기색과 글자색을 짝으로 정해 둔다.

export const HILITE_PRESETS: { id: string; style: CondStyle }[] = [
  { id: "red", style: { fill: "#fee2e2", color: "#991b1b" } },
  { id: "amber", style: { fill: "#fef3c7", color: "#92400e" } },
  { id: "green", style: { fill: "#dcfce7", color: "#166534" } },
  { id: "blue", style: { fill: "#dbeafe", color: "#1e40af" } },
  { id: "purple", style: { fill: "#ede9fe", color: "#5b21b6" } },
  { id: "gray", style: { fill: "#e5e7eb", color: "#374151" } },
];

/** 색조 눈금. 2색은 처음과 끝만 쓴다. */
export const SCALE_PRESETS: { id: string; colors: [string, string, string] }[] = [
  { id: "rag", colors: ["#f8696b", "#ffeb84", "#63be7b"] },
  { id: "gar", colors: ["#63be7b", "#ffeb84", "#f8696b"] },
  { id: "blue", colors: ["#ffffff", "#9ec5fe", "#1d4ed8"] },
  { id: "gray", colors: ["#ffffff", "#c6c6c6", "#4b5563"] },
];

export const BAR_COLORS = ["#638ec6", "#63be7b", "#ffb454", "#f8696b"];

/** 2색·3색 눈금 만들기 — 가운데는 중앙값(백분위 50)이다(엑셀 기본값). */
export function scaleStops(colors: [string, string, string], three: boolean): ScaleStop[] {
  if (!three) {
    return [
      { at: { type: "min" }, color: colors[0] },
      { at: { type: "max" }, color: colors[2] },
    ];
  }
  return [
    { at: { type: "min" }, color: colors[0] },
    { at: { type: "percentile", value: 50 }, color: colors[1] },
    { at: { type: "max" }, color: colors[2] },
  ];
}
