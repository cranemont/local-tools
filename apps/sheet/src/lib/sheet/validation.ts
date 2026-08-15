/** 데이터 유효성 검사 — 규칙과 판정. **문서 객체를 모른다.**
 *
 * 칸 하나를 두 가지로 본 것만 들어온다(`ValidationInput`):
 *   text  — 사람이 친 글자 그대로. 목록 대조·글자 수가 이걸 본다.
 *   value — parseInput이 해석한 값. 수·날짜 범위가 이걸 본다.
 * 문서를 읽어야 푸는 두 가지(다른 범위를 원본으로 쓴 목록, 사용자 지정 수식)는
 * 부르는 쪽이 풀어서 `ValidationContext`로 건넨다.
 *
 * 검사는 **새 입력에만** 건다. 파일에서 읽은 값은 검사가 고치지 않는다 — 셀은
 * 가져온 원문(raw)을 들고 있고 편집 전까지 그대로 다시 나간다(CLAUDE.md 23번).
 * 이미 들어 있는 위반 값은 화면에 표시만 하고 그대로 둔다.
 *
 * 값이 수인지는 **시트의 값 체계**로 가른다(`typeof value === "number"`). "010"은
 * parseInput이 글자로 남기므로(앞자리 0 보존) 정수 규칙에 걸린다. 표시 형식이
 * 텍스트(@)인 열도 같다 — 값이 글자면 수 규칙은 통과하지 못한다.
 */

import { adjustCols, adjustRows } from "../formula/adjust";
import { areaContains, cellKey, colName, keyCol, keyRow, MAX_COLS, parseArea, type Area } from "./a1";
import { parseInput } from "./model";
import { fromSerial } from "./serial";
import { isError, type Scalar } from "./types";

export const VALIDATION_KINDS = [
  "list",
  "whole",
  "decimal",
  "date",
  "textLength",
  "custom",
] as const;

export type ValidationKind = (typeof VALIDATION_KINDS)[number];

export const COMPARE_OPS = [
  "between",
  "notBetween",
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

export type CompareOp = (typeof COMPARE_OPS)[number];

/** 값을 둘 받는 연산자인가 — 화면이 끝 값 입력란을 띄우는 데 쓴다. */
export function compareArity(op: CompareOp): 1 | 2 {
  return op === "between" || op === "notBetween" ? 2 : 1;
}

/** 크기 비교를 쓰는 종류인가(목록·사용자 지정은 아니다). */
export function usesCompare(kind: ValidationKind): boolean {
  return kind === "whole" || kind === "decimal" || kind === "date" || kind === "textLength";
}

/**
 * 위반했을 때 무엇을 하나.
 *   reject — 입력을 되돌린다. 규칙을 건 뜻이 "이 값만 받겠다"이므로 이쪽이 기본값이다.
 *   warn   — 넣되 그 칸에 표시를 남긴다.
 */
export type ViolationAction = "reject" | "warn";

export interface ValidationRule {
  kind: ValidationKind;
  /** 목록 원본 — 직접 적은 값("서울, 부산")이거나 같은 시트의 범위("A1:A9"). */
  source?: string;
  /** whole·decimal·date·textLength의 비교 방법. */
  op?: CompareOp;
  /** 비교값 — 사람이 친 글자 그대로 둔다. 수·날짜 해석은 판정할 때 한 번만 한다. */
  value?: string;
  /** between·notBetween의 둘째 값. */
  value2?: string;
  /** 사용자 지정 수식 — "=" 없이 저장한다. 범위의 왼쪽 위 칸 기준으로 적는다. */
  formula?: string;
  /** 빈 칸을 통과시킬지. */
  allowBlank: boolean;
  action: ViolationAction;
}

/** 규칙 하나가 걸린 범위. */
export interface ValidationRange {
  area: Area;
  rule: ValidationRule;
}

export function defaultRule(kind: ValidationKind = "list"): ValidationRule {
  return { kind, source: "", op: "between", value: "", value2: "", formula: "", allowBlank: true, action: "reject" };
}

// ── 판정 ────────────────────────────────────────────────────────

export interface ValidationInput {
  text: string;
  value: Scalar;
}

export interface ValidationContext {
  /** 범위를 원본으로 쓴 목록을 푼 결과. 못 풀었으면 주지 않는다. */
  items?: string[] | null;
  /** 사용자 지정 수식의 결과. 문서를 모르는 이 파일은 계산하지 못한다. */
  custom?: Scalar;
}

export type ViolationReason =
  | "blank"
  | "notInList"
  | "notWhole"
  | "notNumber"
  | "notDate"
  | "outOfRange"
  | "badLength"
  | "custom";

export interface Verdict {
  ok: boolean;
  reason?: ViolationReason;
}

/** 위반 이유 → 화면 문구 키(i18n의 `t.validation.reason`). */
export type ReasonKey = "blank" | "list" | "whole" | "number" | "date" | "range" | "length" | "custom";

const REASON_KEY: Record<ViolationReason, ReasonKey> = {
  blank: "blank",
  notInList: "list",
  notWhole: "whole",
  notNumber: "number",
  notDate: "date",
  outOfRange: "range",
  badLength: "length",
  custom: "custom",
};

export function reasonKey(reason: ViolationReason): ReasonKey {
  return REASON_KEY[reason];
}

const OK: Verdict = { ok: true };

function fail(reason: ViolationReason): Verdict {
  return { ok: false, reason };
}

/** 빈 칸인가 — 값이 없거나 공백뿐이면 빈 칸이다(0·"0"·FALSE는 아니다). */
export function isBlankInput(input: ValidationInput): boolean {
  if (input.value === null) return true;
  if (typeof input.value === "string") return input.value.trim() === "";
  return false;
}

/**
 * 값 하나를 규칙에 견준다. 규칙이 없으면 통과다.
 *
 * **풀지 못한 것은 막지 않는다** — 범위 원본을 못 읽었거나(ctx.items 없음) 사용자
 * 지정 수식을 계산하지 못했으면(ctx.custom 없음) 통과로 본다. 우리 쪽 실패로
 * 사용자 입력을 되돌리면 그 칸에는 아무것도 넣을 수 없게 된다.
 */
export function checkValue(
  rule: ValidationRule | undefined,
  input: ValidationInput,
  ctx: ValidationContext = {},
): Verdict {
  if (!rule) return OK;
  if (isBlankInput(input)) return rule.allowBlank ? OK : fail("blank");

  switch (rule.kind) {
    case "list": {
      const items = ruleItems(rule, ctx);
      if (!items) return OK;
      return matchesItem(items, input) ? OK : fail("notInList");
    }
    case "whole": {
      const n = numberOf(input);
      if (n === null || !Number.isInteger(n)) return fail("notWhole");
      return inBounds(n, rule) ? OK : fail("outOfRange");
    }
    case "decimal": {
      const n = numberOf(input);
      if (n === null) return fail("notNumber");
      return inBounds(n, rule) ? OK : fail("outOfRange");
    }
    case "date": {
      // 날짜는 일련번호(수)로 저장된다 — 수면 날짜다(엑셀도 그렇게 본다).
      const n = numberOf(input);
      if (n === null) return fail("notDate");
      return inBounds(n, rule) ? OK : fail("outOfRange");
    }
    case "textLength": {
      const len = input.text.trim().length;
      return inBounds(len, rule) ? OK : fail("badLength");
    }
    case "custom": {
      if (ctx.custom === undefined) return OK;
      return truthy(ctx.custom) ? OK : fail("custom");
    }
  }
}

/** 시트의 값 체계에서 수인 것만 수로 센다. 불리언·글자는 수가 아니다. */
function numberOf(input: ValidationInput): number | null {
  return typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null;
}

/** 사용자 지정 수식의 결과가 참인가. 엑셀과 같게 오류·글자는 거짓으로 본다. */
function truthy(v: Scalar): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isError(v)) return false;
  return v.trim().toUpperCase() === "TRUE";
}

/**
 * 비교값 → 수. 셀을 읽을 때와 같은 규칙(parseInput)을 쓴다 —
 * 그래야 "2026-01-01"이 날짜 일련번호로, "1,200"이 수로 똑같이 읽힌다.
 * 비어 있거나 수로 안 읽히면 null이고, 그 검사는 건너뛴다(규칙이 덜 적힌 것이다).
 */
export function boundNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const s = text.trim();
  if (s === "") return null;
  const parsed = parseInput(s);
  return typeof parsed.value === "number" && Number.isFinite(parsed.value) ? parsed.value : null;
}

function inBounds(n: number, rule: ValidationRule): boolean {
  const op = rule.op ?? "between";
  const a = boundNumber(rule.value);
  const b = boundNumber(rule.value2);

  if (op === "between" || op === "notBetween") {
    if (a === null || b === null) return true;
    // 두 값을 거꾸로 넣어도 같은 뜻으로 읽는다(필터의 between과 같다).
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const inside = n >= lo && n <= hi;
    return op === "between" ? inside : !inside;
  }

  if (a === null) return true;
  switch (op) {
    case "eq":
      return n === a;
    case "ne":
      return n !== a;
    case "gt":
      return n > a;
    case "gte":
      return n >= a;
    case "lt":
      return n < a;
    case "lte":
      return n <= a;
  }
}

// ── 목록 원본 ───────────────────────────────────────────────────

/**
 * 참조 두 개를 콜론으로 이은 모양인가. 앞에 시트 이름이 붙어 있어도 받는다
 * (`Sheet2!A1:A9`·`'내 시트'!$A$1:$A$9`).
 *
 * **콜론이 있어야 범위로 읽는다.** 한 칸짜리 참조까지 범위로 보면 "A1"이라는 한
 * 항목짜리 목록을 적을 수 없다.
 */
const RANGE_SHAPE =
  /^(?:('(?:[^']|'')*'|[^'!]*)!)?(\$?[A-Za-z]{1,3}\$?\d{1,7}:\$?[A-Za-z]{1,3}\$?\d{1,7})$/;

/**
 * 원본을 범위로 적은 것인가 — **풀 수 있는지와는 다른 질문이다.**
 *
 * 다른 시트를 가리키면 지금은 못 푼다. 그때 이 함수만 참이고 `listRange`는 null인데,
 * 그 차이가 중요하다 — 못 푼 것을 "항목 한 개짜리 목록"으로 읽으면 그 열에는
 * `Sheet2!$A$1:$A$9`라는 글자 말고는 아무것도 넣을 수 없게 된다.
 */
export function looksLikeRange(source: string | undefined): boolean {
  if (!source) return false;
  return RANGE_SHAPE.test(source.trim().replace(/^=/, ""));
}

/**
 * 목록 원본이 가리키는 영역 — `A1:A9`·`=$A$1:$A$9`면 그 영역, 아니면 null.
 * 시트 이름이 붙으면 null이다(같은 시트만 푼다).
 */
export function listRange(source: string | undefined): Area | null {
  if (!source) return null;
  const m = RANGE_SHAPE.exec(source.trim().replace(/^=/, ""));
  if (!m || m[1] !== undefined) return null;
  return parseArea(m[2].replace(/\$/g, ""));
}

/**
 * 범위 → "$A$1:$A$9".
 *
 * 목록 원본은 언제나 절대 참조로 적는다. 엑셀은 유효성 수식을 **적용 범위의 왼쪽 위
 * 칸 기준**으로 읽으므로, B2:B10에 "A1:A9"를 상대 참조로 적어 두면 B3은 A2:A10을,
 * B4는 A3:A11을 보게 된다 — 줄마다 목록이 달라진다.
 */
export function absoluteArea(area: Area): string {
  const head = `$${colName(area.left)}$${area.top + 1}`;
  const tail = `$${colName(area.right)}$${area.bottom + 1}`;
  return `${head}:${tail}`;
}

/**
 * 직접 적은 목록 원본 → 항목 배열.
 *
 * 쉼표와 줄바꿈으로 나눈다(열을 그대로 붙여 넣는 경우가 있다). 따옴표로 감싼
 * 항목은 안쪽 쉼표를 그대로 품고 앞뒤 공백도 지킨다("서울, 부산" 한 항목).
 * 빈 항목은 버리고 같은 글자는 한 번만 남긴다 — 드롭다운에 빈 줄과 중복이 뜨면
 * 무엇을 고른 것인지 알 수 없다.
 */
export function parseListItems(source: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let field = "";
  let quoted = false;
  let wasQuoted = false;

  const push = (): void => {
    const item = wasQuoted ? field : field.trim();
    field = "";
    wasQuoted = false;
    if (item === "" || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      quoted = true;
      wasQuoted = true;
      continue;
    }
    if (ch === "," || ch === "\n" || ch === "\r") {
      push();
      continue;
    }
    field += ch;
  }
  push();
  return out;
}

/**
 * 이 규칙이 고르게 할 항목들. 못 풀면 null이다(→ 판정은 통과로 둔다).
 * 범위 원본은 문서를 읽어야 하므로 부르는 쪽이 `ctx.items`로 건넨다.
 */
export function ruleItems(
  rule: ValidationRule | undefined,
  ctx: ValidationContext = {},
): string[] | null {
  if (rule?.kind !== "list") return null;
  // 범위로 적은 것은 부르는 쪽이 푼 항목만 쓴다. 못 풀었으면 null이고, 그때는 막지 않는다.
  if (looksLikeRange(rule.source)) return ctx.items && ctx.items.length > 0 ? ctx.items : null;
  const items = parseListItems(rule.source ?? "");
  return items.length > 0 ? items : null;
}

/** 목록 대조 — 앞뒤 공백을 떼고 대소문자를 무시한다(엑셀과 같다). */
export function matchesList(items: string[], text: string): boolean {
  const needle = text.trim().toLowerCase();
  return items.some((item) => item.trim().toLowerCase() === needle);
}

/**
 * 목록 대조 — 글자로 맞춰 보고, 안 맞으면 **값으로** 한 번 더 본다.
 *
 * 글자만 보면 넣은 직후에 위반 표시가 붙는 칸이 생긴다. 목록에 `1.50`을 적어 두고
 * `1.50`을 치면 입력은 통과하지만(친 글자가 항목과 같다) 칸에 남는 값은 1.5이고
 * 화면 글자는 "1.5"라, 이미 든 값을 다시 볼 때는 목록에 없는 값이 된다.
 * 항목도 셀과 같은 해석(`parseInput`)을 거치므로 둘 다 1.5가 되어 맞는다.
 *
 * 값 대조는 수일 때만 한다. "010"·19자리 번호는 parseInput이 글자로 남기므로
 * (CLAUDE.md 23번) 여기서도 글자 대조만 걸린다 — 앞자리 0이 다른 값을 같다고
 * 하지 않는다.
 */
function matchesItem(items: string[], input: ValidationInput): boolean {
  if (matchesList(items, input.text)) return true;
  if (typeof input.value !== "number") return false;
  return items.some((item) => boundNumber(item) === input.value);
}

// ── 범위 목록 ───────────────────────────────────────────────────

/** 이 칸에 걸린 규칙 — 겹치면 **나중에 건 것**이 이긴다. */
export function entryAt(
  list: ValidationRange[] | undefined,
  row: number,
  col: number,
): ValidationRange | undefined {
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    if (areaContains(list[i].area, row, col)) return list[i];
  }
  return undefined;
}

/** 사각형에서 다른 사각형을 도려낸다. 남는 조각(최대 4개)만 돌려준다. */
export function subtractArea(from: Area, cut: Area): Area[] {
  const overlap =
    cut.left <= from.right && cut.right >= from.left && cut.top <= from.bottom && cut.bottom >= from.top;
  if (!overlap) return [{ ...from }];

  const out: Area[] = [];
  if (cut.top > from.top) out.push({ ...from, bottom: cut.top - 1 });
  if (cut.bottom < from.bottom) out.push({ ...from, top: cut.bottom + 1 });
  const top = Math.max(from.top, cut.top);
  const bottom = Math.min(from.bottom, cut.bottom);
  if (cut.left > from.left) out.push({ top, bottom, left: from.left, right: cut.left - 1 });
  if (cut.right < from.right) out.push({ top, bottom, left: cut.right + 1, right: from.right });
  return out;
}

/**
 * 범위에 규칙을 걸거나(rule=null이면) 지운다.
 *
 * 겹치는 옛 범위는 도려낸다 — 한 칸에 규칙이 둘 쌓이면 드롭다운에 무엇이 떠야
 * 하는지 답이 없다. 엑셀도 고른 칸의 규칙을 갈아 끼운다.
 */
export function setValidationOver(
  list: ValidationRange[] | undefined,
  area: Area,
  rule: ValidationRule | null,
): ValidationRange[] {
  const out: ValidationRange[] = [];
  for (const entry of list ?? []) {
    for (const piece of subtractArea(entry.area, area)) out.push({ area: piece, rule: entry.rule });
  }
  if (rule) out.push({ area: { ...area }, rule });
  return out;
}

/** 삽입·삭제 뒤의 좌표 하나. count가 음수면 삭제다. */
function shiftStart(v: number, at: number, count: number): number {
  if (count > 0) return v >= at ? v + count : v;
  const removed = -count;
  if (v < at) return v;
  if (v < at + removed) return at;
  return v - removed;
}

function shiftEnd(v: number, at: number, count: number): number {
  if (count > 0) return v >= at ? v + count : v;
  const removed = -count;
  if (v < at) return v;
  if (v < at + removed) return at - 1;
  return v - removed;
}

/**
 * 규칙이 들고 있는 참조도 같이 민다 — 목록 원본의 범위와 사용자 지정 수식.
 *
 * 규칙 범위만 밀면 원본이 제자리에 남아 다른 칸을 가리킨다 — A1:A9를 원본으로 쓰는
 * 목록에서 1행 위에 행을 끼우면 항목이 한 줄씩 밀려 마지막 항목이 빠지고 새로 생긴
 * 빈 줄이 들어온다. 밀린 뒤 범위가 없어지면 원본을 비운다(항목이 없으면 막지 않는다).
 *
 * 사용자 지정 수식은 셀 수식과 같은 보정을 탄다(`formula/adjust.ts`). 안 태우면
 * `A5>0`으로 걸어 둔 규칙이 1행을 끼운 뒤에도 A5를 본다 — 한 줄 내려간 데이터가
 * 아니라 새로 생긴 빈 줄을 검사하게 된다. 가리키던 줄을 지우면 `#REF!`가 되고,
 * 그때는 규칙이 통과를 안 준다(엑셀도 그렇다).
 */
function shiftRuleRefs(
  rule: ValidationRule,
  axis: "row" | "col",
  at: number,
  count: number,
): ValidationRule {
  if (rule.kind === "custom") {
    const formula = rule.formula?.trim();
    if (!formula) return rule;
    const next = axis === "row" ? adjustRows(formula, at, count) : adjustCols(formula, at, count);
    return next === rule.formula ? rule : { ...rule, formula: next };
  }
  if (rule.kind !== "list") return rule;
  const range = listRange(rule.source);
  if (!range) return rule;

  const start = shiftStart(axis === "row" ? range.top : range.left, at, count);
  const end = shiftEnd(axis === "row" ? range.bottom : range.right, at, count);
  if (end < start) return { ...rule, source: "" };

  const next: Area =
    axis === "row" ? { ...range, top: start, bottom: end } : { ...range, left: start, right: end };
  return { ...rule, source: absoluteArea(next) };
}

/**
 * 행을 끼우거나 지운 만큼 규칙 범위를 민다. count가 음수면 삭제.
 * 지운 줄이 범위 전체를 덮으면 그 규칙도 사라진다.
 */
export function shiftValidationRows(
  list: ValidationRange[] | undefined,
  at: number,
  count: number,
): ValidationRange[] {
  return (list ?? [])
    .map((entry) => ({
      rule: shiftRuleRefs(entry.rule, "row", at, count),
      area: {
        ...entry.area,
        top: shiftStart(entry.area.top, at, count),
        bottom: shiftEnd(entry.area.bottom, at, count),
      },
    }))
    .filter((entry) => entry.area.bottom >= entry.area.top);
}

/** 열 쪽 같은 것. */
export function shiftValidationCols(
  list: ValidationRange[] | undefined,
  at: number,
  count: number,
): ValidationRange[] {
  return (list ?? [])
    .map((entry) => ({
      rule: shiftRuleRefs(entry.rule, "col", at, count),
      area: {
        ...entry.area,
        left: shiftStart(entry.area.left, at, count),
        right: shiftEnd(entry.area.right, at, count),
      },
    }))
    .filter((entry) => entry.area.right >= entry.area.left);
}

/**
 * 흩어진 칸 좌표를 직사각형 몇 개로 접는다.
 *
 * xlsx는 규칙을 칸마다 펼쳐서 읽히므로(ExcelJS가 sqref를 칸으로 풀어 준다)
 * 그대로 두면 한 열에 규칙 하나가 만 개 범위가 된다 — 칸을 그릴 때마다 그
 * 목록을 훑게 되므로 여기서 접는다. 아래로 늘리고 오른쪽으로 늘리는 순서다.
 */
export function packAreas(cells: { row: number; col: number }[]): Area[] {
  const left = new Set<number>();
  for (const cell of cells) left.add(cellKey(cell.row, cell.col));
  const sorted = [...left].sort((a, b) => a - b);

  // 마지막 열을 넘겨 물으면 cellKey가 다음 줄 첫 칸과 같은 값이 된다 — 거기서 멈춘다.
  const has = (row: number, col: number): boolean => col < MAX_COLS && left.has(cellKey(row, col));
  const out: Area[] = [];

  for (const key of sorted) {
    if (!left.has(key)) continue;
    const row = keyRow(key);
    const col = keyCol(key);

    let height = 1;
    while (has(row + height, col)) height++;

    let width = 1;
    for (;;) {
      let full = true;
      for (let i = 0; i < height; i++) {
        if (!has(row + i, col + width)) {
          full = false;
          break;
        }
      }
      if (!full) break;
      width++;
    }

    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) left.delete(cellKey(row + i, col + j));
    }
    out.push({ top: row, left: col, bottom: row + height - 1, right: col + width - 1 });
  }
  return out;
}

// ── xlsx 왕복 ───────────────────────────────────────────────────
//
// ExcelJS는 칸마다 dataValidation 객체를 읽고 쓴다. 여기서는 그 객체의 **모양만**
// 안다(엔진은 xlsx.ts 안에만 있다). 엑셀에 없는 것은 왕복에서 빠진다 — 위반 시
// 동작은 errorStyle로만 남으므로 거부/경고 두 가지는 지켜지고, 그 밖의 문구는 없다.

export interface XlsxValidation {
  type: ValidationKind;
  formulae: (string | number)[];
  operator?: string;
  allowBlank?: boolean;
  showErrorMessage?: boolean;
  errorStyle?: string;
}

const XLSX_OP: Record<CompareOp, string> = {
  between: "between",
  notBetween: "notBetween",
  eq: "equal",
  ne: "notEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual",
};

const OUR_OP = new Map<string, CompareOp>(
  Object.entries(XLSX_OP).map(([ours, theirs]) => [theirs, ours as CompareOp]),
);

/** 일련번호 → "yyyy-mm-dd". 엑셀은 날짜 규칙의 경계를 날짜로 싣는다. */
function serialToIso(serial: number): string {
  const d = fromSerial(serial);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** UTC 자정으로 온 Date → "yyyy-mm-dd". ExcelJS가 일련번호를 UTC 기준으로 푼다. */
function utcToIso(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 규칙 → ExcelJS가 받는 모양. 적을 것이 없으면 null. */
export function toXlsxValidation(rule: ValidationRule): XlsxValidation | null {
  const base = {
    allowBlank: rule.allowBlank,
    showErrorMessage: true,
    errorStyle: rule.action === "warn" ? "warning" : "stop",
  };

  if (rule.kind === "list") {
    const range = listRange(rule.source);
    // 범위 원본은 절대 참조로 나간다(위 absoluteArea 참고).
    if (range) return { ...base, type: "list", formulae: [absoluteArea(range)] };
    // 우리가 못 푸는 범위(다른 시트)는 적힌 그대로 내보낸다 — 엑셀은 이걸 푼다.
    if (looksLikeRange(rule.source)) {
      return { ...base, type: "list", formulae: [(rule.source ?? "").trim().replace(/^=/, "")] };
    }
    const items = parseListItems(rule.source ?? "");
    if (items.length === 0) return null;
    // 엑셀은 직접 적은 목록을 따옴표로 감싼 한 덩어리로 싣는다.
    return { ...base, type: "list", formulae: [`"${items.join(",").replace(/"/g, "'")}"`] };
  }

  if (rule.kind === "custom") {
    const formula = (rule.formula ?? "").trim();
    if (formula === "") return null;
    // formula1에는 "="를 붙이지 않는다 — 엑셀이 적는 자리에는 수식 본문만 들어간다.
    // "=A1>0"을 넣으면 엑셀이 파일을 고치면서 그 규칙을 버린다.
    return { ...base, type: "custom", formulae: [formula] };
  }

  const op = rule.op ?? "between";
  const a = boundNumber(rule.value);
  if (a === null) return null;
  const b = compareArity(op) === 2 ? boundNumber(rule.value2) : null;
  if (compareArity(op) === 2 && b === null) return null;

  const cast = (n: number): string | number => (rule.kind === "date" ? serialToIso(n) : n);
  return {
    ...base,
    type: rule.kind,
    operator: XLSX_OP[op],
    formulae: b === null ? [cast(a)] : [cast(a), cast(b)],
  };
}

/** ExcelJS가 읽어 온 모양 → 규칙. 우리가 모르는 종류면 null. */
export function fromXlsxValidation(dv: unknown): ValidationRule | null {
  if (!dv || typeof dv !== "object") return null;
  const raw = dv as Partial<XlsxValidation>;
  const kind = VALIDATION_KINDS.find((k) => k === raw.type);
  if (!kind) return null;

  const rule = defaultRule(kind);
  rule.allowBlank = raw.allowBlank === true;
  rule.action = raw.errorStyle === "warning" || raw.errorStyle === "information" ? "warn" : "reject";

  const formulae = Array.isArray(raw.formulae) ? raw.formulae : [];
  const asText = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return utcToIso(v);
    return String(v);
  };

  if (kind === "list") {
    const first = asText(formulae[0]).trim();
    // 따옴표로 감싸여 있으면 직접 적은 목록, 아니면 범위 참조다.
    rule.source = first.startsWith('"') && first.endsWith('"') ? first.slice(1, -1) : first;
    return rule.source === "" ? null : rule;
  }

  if (kind === "custom") {
    rule.formula = asText(formulae[0]).trim().replace(/^=/, "");
    return rule.formula === "" ? null : rule;
  }

  rule.op = OUR_OP.get(String(raw.operator ?? "between")) ?? "between";
  rule.value = asText(formulae[0]);
  rule.value2 = asText(formulae[1]);
  return rule.value === "" ? null : rule;
}
