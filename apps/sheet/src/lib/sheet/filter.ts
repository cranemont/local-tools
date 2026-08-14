/** 자동 필터 — 명세와 술어. **문서 객체를 모른다.**
 *
 * 여기 들어오는 것은 칸 하나를 두 가지로 본 것뿐이다(`FilterCell`):
 *   v    — 계산된 값. 수·글자·불리언·오류·빈 칸. 크기 비교는 이걸 본다.
 *   text — 화면에 보이는 문자열. 고유값 목록·글자 조건은 이걸 본다.
 * 둘을 함께 받는 이유는 시트의 규약 때문이다 — 원문(`raw`)이 남은 칸은 값이 1.5여도
 * 화면에는 "1.50"으로 보인다(CLAUDE.md 23번). 목록에 "1.5"라고 적어 놓고 화면에는
 * "1.50"이 보이면 같은 열의 같은 칸을 두 이름으로 부르는 셈이 된다.
 *
 * 행 번호는 부르는 쪽이 들고 있는다. `visibleRows`는 받은 행 번호 배열에서
 * 걸러 남은 것을 **그 번호 그대로** 돌려준다 — 필터가 만드는 "순번" 좌표계와
 * 문서의 "행 번호" 좌표계가 섞이지 않게 하려는 것이다.
 */

import { compareScalar, parseInput } from "./model";
import type { Scalar } from "./types";

/** 필터가 보는 칸 하나. */
export interface FilterCell {
  v: Scalar;
  text: string;
}

/** 조건 필터의 연산자. */
export const CONDITION_OPS = [
  "eq",
  "ne",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "gt",
  "lt",
  "between",
  "blank",
  "notBlank",
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

/** 값을 하나도 안 받는 연산자 — 화면이 입력란을 감추는 데 쓴다. */
export function opArity(op: ConditionOp): 0 | 1 | 2 {
  if (op === "blank" || op === "notBlank") return 0;
  if (op === "between") return 2;
  return 1;
}

export interface ConditionFilter {
  kind: "condition";
  op: ConditionOp;
  /** 사용자가 친 글자 그대로. 수·날짜 해석은 술어를 만들 때 한 번만 한다. */
  value: string;
  /** `between`의 둘째 값. */
  value2?: string;
}

export interface ValuesFilter {
  kind: "values";
  /** 남길 표시 문자열들. 빈 칸은 ""로 들어간다. */
  picked: Set<string>;
}

export type ColumnFilter = ValuesFilter | ConditionFilter;

/** 한 시트에 걸린 필터 전체. */
export interface SheetFilter {
  /**
   * 머리글 줄 수 — 이 줄들은 걸러지지 않는다.
   * 첫 필터를 걸 때 굳힌다. 표 내용이 바뀌었다고 머리글이 사라지면 안 되기 때문이다.
   */
  headerRows: number;
  /** 열 번호 → 그 열에 걸린 필터. 여러 열은 AND로 합쳐진다. */
  cols: Map<number, ColumnFilter>;
}

/** 빈 칸인가. 값이 없거나 빈 글자면 빈 칸이다(공백 한 칸은 빈 칸이 아니다). */
export function isBlank(cell: FilterCell): boolean {
  return cell.v === null || cell.v === "";
}

/**
 * 값 목록에서 이 칸의 이름 — 체크박스 한 줄의 정체다.
 *
 * **목록을 모으는 쪽과 거르는 쪽이 반드시 같은 함수를 써야 한다.** 예전엔 목록은
 * "빈 칸이면 빈 문자열"로 모으고 술어는 `cell.text`를 그대로 봐서, 값이 비었는데
 * 원문이 공백뿐인 칸(CSV의 `" "`)이 목록에는 "(빈 칸)"으로 뜨는데 그 줄을 고르면
 * 사라졌다 — 화면이 센 개수와 남는 줄 수가 달랐다.
 */
export function valueKey(cell: FilterCell): string {
  return isBlank(cell) ? "" : cell.text;
}

function fold(text: string): string {
  return text.toLowerCase();
}

/**
 * 사용자가 친 비교값 → 스칼라.
 *
 * 셀을 읽을 때와 **같은 규칙**(parseInput)을 쓴다. 그래야 "2024-01-05"가 날짜
 * 일련번호로, "1,200"이 수로, "010"이 글자로 똑같이 해석된다. 다만 "="로 시작해도
 * 수식으로 보지 않는다 — 필터 값은 계산하는 것이 아니다.
 */
function operandOf(text: string): Scalar {
  const s = text.trim();
  if (s === "") return null;
  const parsed = parseInput(s);
  if (parsed.formula !== undefined) return s;
  return parsed.value;
}

/**
 * 같음 — 수는 수끼리, 나머지는 보이는 글자끼리(대소문자 무시).
 *
 * 그래서 수 100과 글자 "100"은 **둘 다** `100`에 걸린다. 화면에 똑같이 보이는
 * 두 칸이 필터에서 갈리면 "왜 하나만 남았나"를 설명할 길이 없다.
 */
function equals(cell: FilterCell, operand: Scalar, operandText: string): boolean {
  if (operand === null) return isBlank(cell);
  if (typeof cell.v === "number" && typeof operand === "number") return cell.v === operand;
  if (typeof cell.v === "boolean" && typeof operand === "boolean") return cell.v === operand;
  return fold(cell.text) === fold(operandText.trim());
}

/** 크기 비교 — 수는 수끼리, 글자는 글자끼리. 섞이면 비교하지 않는다(빈 칸·오류도 제외). */
function order(cell: FilterCell, operand: Scalar): number | null {
  if (isBlank(cell) || operand === null) return null;
  if (typeof cell.v === "number" && typeof operand === "number") return cell.v - operand;
  if (typeof cell.v === "string" && typeof operand === "string") {
    return cell.v.localeCompare(operand, "ko");
  }
  return null;
}

/** 필터 하나를 술어로 굳힌다. 비교값 해석은 여기서 한 번만 한다. */
export function predicateOf(filter: ColumnFilter): (cell: FilterCell) => boolean {
  if (filter.kind === "values") {
    const picked = filter.picked;
    return (cell) => picked.has(valueKey(cell));
  }

  const text = filter.value ?? "";
  const needle = fold(text.trim());
  const a = operandOf(text);
  const b = operandOf(filter.value2 ?? "");

  switch (filter.op) {
    case "eq":
      return (cell) => equals(cell, a, text);
    case "ne":
      return (cell) => !equals(cell, a, text);
    case "contains":
      return (cell) => fold(cell.text).includes(needle);
    case "notContains":
      return (cell) => !fold(cell.text).includes(needle);
    case "startsWith":
      return (cell) => fold(cell.text).startsWith(needle);
    case "endsWith":
      return (cell) => fold(cell.text).endsWith(needle);
    case "gt":
      return (cell) => {
        const d = order(cell, a);
        return d !== null && d > 0;
      };
    case "lt":
      return (cell) => {
        const d = order(cell, a);
        return d !== null && d < 0;
      };
    case "between": {
      // 두 값을 거꾸로 넣어도 같은 뜻으로 읽는다.
      const swap = a !== null && b !== null && (order({ v: a, text: "" }, b) ?? 0) > 0;
      const lo = swap ? b : a;
      const hi = swap ? a : b;
      return (cell) => {
        const low = order(cell, lo);
        const high = order(cell, hi);
        return low !== null && high !== null && low >= 0 && high <= 0;
      };
    }
    case "blank":
      return (cell) => isBlank(cell);
    case "notBlank":
      return (cell) => !isBlank(cell);
  }
}

export function matchesFilter(filter: ColumnFilter, cell: FilterCell): boolean {
  return predicateOf(filter)(cell);
}

/** 열 하나 — 걸린 필터와, 행 배열과 같은 순서로 늘어놓은 값들. */
export interface FilterColumn {
  filter: ColumnFilter;
  /** cells[i]는 rows[i] 행의 칸이다. */
  cells: FilterCell[];
}

/**
 * 여러 열의 필터를 AND로 합쳐 **남는 행 번호**를 준다.
 *
 * 돌려주는 것은 받은 행 번호 그대로다(순번이 아니다) — 행 머리글의 번호·커서·
 * 수식 참조가 전부 이 좌표계에 남아야 한다.
 */
export function visibleRows(rows: number[], columns: FilterColumn[]): number[] {
  if (columns.length === 0) return rows.slice();
  const tests = columns.map((column) => ({ ok: predicateOf(column.filter), cells: column.cells }));

  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    let keep = true;
    for (const test of tests) {
      const cell = test.cells[i];
      if (cell && test.ok(cell)) continue;
      if (!cell && test.ok({ v: null, text: "" })) continue;
      keep = false;
      break;
    }
    if (keep) out.push(rows[i]);
  }
  return out;
}

/** 고유값 하나 — 체크박스 한 줄. */
export interface UniqueValue {
  /** 표시 문자열. 이것이 곧 값의 정체다(ValuesFilter.picked에 들어가는 키). */
  text: string;
  /** 이 표시로 보이는 칸 수. */
  count: number;
  blank: boolean;
}

/**
 * 한 열의 고유값 — **표시 문자열 기준**으로 모으고 값 종류로 정렬한다.
 *
 * 정렬은 시트의 정렬과 같은 규칙이다(수 < 글자 < 불리언 < 오류 < 빈 칸).
 * 목록의 차례가 열을 정렬했을 때의 차례와 다르면 같은 표를 두 번 배우게 된다.
 */
export function uniqueValues(cells: FilterCell[]): UniqueValue[] {
  const seen = new Map<string, { count: number; v: Scalar; blank: boolean }>();
  for (const cell of cells) {
    const blank = isBlank(cell);
    const key = valueKey(cell);
    const hit = seen.get(key);
    if (hit) hit.count++;
    else seen.set(key, { count: 1, v: blank ? null : cell.v, blank });
  }

  return [...seen]
    .sort((x, y) => {
      const d = compareScalar(x[1].v, y[1].v);
      return d !== 0 ? d : x[0].localeCompare(y[0], "ko");
    })
    .map(([text, info]) => ({ text, count: info.count, blank: info.blank }));
}
