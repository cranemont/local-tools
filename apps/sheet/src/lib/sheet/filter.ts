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

/** 대소문자 접기. 필터·조건부 서식이 같은 것을 써야 "abc"와 "ABC"가 두 화면에서 같다. */
export function foldText(text: string): string {
  return text.toLowerCase();
}

const fold = foldText;

/**
 * 사용자가 친 비교값 → 스칼라.
 *
 * 셀을 읽을 때와 **같은 규칙**(parseInput)을 쓴다. 그래야 "2024-01-05"가 날짜
 * 일련번호로, "1,200"이 수로, "010"이 글자로 똑같이 해석된다. 다만 "="로 시작해도
 * 수식으로 보지 않는다 — 필터 값은 계산하는 것이 아니다.
 *
 * 조건부 서식(condformat.ts)도 이 함수를 쓴다 — 필터에서 100에 걸리던 칸이
 * 조건부 서식에서는 안 걸리면 같은 표를 두 번 배우게 된다.
 */
export function operandOf(text: string): Scalar {
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
export function cellEquals(cell: FilterCell, operand: Scalar, operandText: string): boolean {
  if (operand === null) return isBlank(cell);
  if (typeof cell.v === "number" && typeof operand === "number") return cell.v === operand;
  if (typeof cell.v === "boolean" && typeof operand === "boolean") return cell.v === operand;
  return fold(cell.text) === fold(operandText.trim());
}

/** 크기 비교 — 수는 수끼리, 글자는 글자끼리. 섞이면 비교하지 않는다(빈 칸·오류도 제외). */
export function cellOrder(cell: FilterCell, operand: Scalar): number | null {
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
      return (cell) => cellEquals(cell, a, text);
    case "ne":
      return (cell) => !cellEquals(cell, a, text);
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
        const d = cellOrder(cell, a);
        return d !== null && d > 0;
      };
    case "lt":
      return (cell) => {
        const d = cellOrder(cell, a);
        return d !== null && d < 0;
      };
    case "between": {
      // 두 값을 거꾸로 넣어도 같은 뜻으로 읽는다.
      const swap = a !== null && b !== null && (cellOrder({ v: a, text: "" }, b) ?? 0) > 0;
      const lo = swap ? b : a;
      const hi = swap ? a : b;
      return (cell) => {
        const low = cellOrder(cell, lo);
        const high = cellOrder(cell, hi);
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

// ── 조작이 닿는 범위 ─────────────────────────────────────────────
//
// 필터는 셀을 하나도 바꾸지 않는 뷰 상태다. 그런데 그 상태에서 한 조작이 **화면에
// 없는 줄**까지 바꾸면 사용자는 무엇이 바뀌었는지 볼 수도 없다. 그래서 조작마다
// 갈래를 정해 두고, 그 갈래는 아래 표 하나가 정한다(기준은 엑셀).
//
//   보이는 행만 — 고른 영역은 곧 "화면에서 고른 것"이다. 숨은 줄은 고른 적이 없다.
//   전부       — 이어진 한 덩어리를 다루거나, 표의 짜임 자체를 바꾸는 조작들.
//
// 붙여넣기가 "전부"인 것이 유일하게 놀라운 자리다. 엑셀도 숨은 줄을 덮는다 —
// 붙일 블록은 이어진 직사각형이라 줄을 건너뛰면 원본과 모양이 달라지고, 어느 줄이
// 어디로 갔는지 아무도 셀 수 없게 된다. 대신 **덮은 숨은 줄 수를 알려 준다**.
//
// 열 삽입·열 삭제는 표에 없다. 행 갈래를 물을 것이 없는 조작이라서다 — 한 열은
// 보이는 줄에서만 사라질 수 없다(엑셀도 열을 통째로 지운다).

/** 조작 하나가 닿는 범위. */
export type FilterScope = "visible" | "all";

/** 갈래를 물어볼 수 있는 조작들. */
export type FilterOp =
  | "clear"
  | "format"
  | "clearFormat"
  | "asText"
  | "fillDown"
  | "deleteRows"
  | "copy"
  | "replace"
  | "paste"
  | "insertRows"
  | "sort"
  | "merge"
  | "condFormat";

/** ★ 규약의 정본. "이 조작은 보이는 행만, 저 조작은 전부"가 여기 한 곳에 있다. */
export const OP_SCOPE: Record<FilterOp, FilterScope> = {
  /** Delete — 안 보이는 칸이 함께 비워지면 무엇을 잃었는지 볼 방법이 없다. */
  clear: "visible",
  /** 굵게·색·표시 형식 — 서식은 눈으로 고르는 것이라 눈에 보이는 칸에만 걸린다. */
  format: "visible",
  /** 서식 지우기 — 서식을 거는 것과 같은 갈래여야 왕복이 맞는다. */
  clearFormat: "visible",
  /** 텍스트로 굳히기 — 보이는 글자를 값으로 굳히는 조작이라 서식과 같은 갈래다. */
  asText: "visible",
  /** Ctrl+D — 엑셀도 보이는 칸만 채운다(필터 걸고 채우기가 이 기능의 쓰임새다). */
  fillDown: "visible",
  /** 행 삭제 — 걸러진 줄까지 지우면 되돌리기 말고는 확인할 길이 없다. */
  deleteRows: "visible",
  /** 복사 — 화면에 보이는 것이 복사된다. 숨은 줄이 딸려 가면 붙인 쪽에서 알 수 없다. */
  copy: "visible",
  /** 모두 바꾸기 — 찾기가 못 세는 자리는 바꾸지도 않는다. */
  replace: "visible",
  /** 붙여넣기 — 숨은 줄도 덮는다(위 설명). 엑셀과 같다. */
  paste: "all",
  /** 행 삽입 — 자리를 미는 조작이라 보이는 줄만 밀 수가 없다. */
  insertRows: "all",
  /** 정렬 — 표 전체를 옮겨야 필터를 풀었을 때 표가 성하다. */
  sort: "all",
  /** 병합 — 이어진 직사각형 하나를 만드는 조작이라 줄을 건너뛸 수 없다. */
  merge: "all",
  /**
   * 조건부 서식의 집계(상위/하위 N·중복·색조·막대의 모수) — 걸러진 행도 센다.
   *
   * 셀을 바꾸는 조작이 아니라 **무엇을 모수로 보는가**를 묻는 자리다. 전부로 둔 이유는
   * 필터를 걸고 풀 때마다 같은 칸의 색이 바뀌지 않게 하려는 것이고, 엑셀도 그렇다.
   * 여기를 "visible"로 바꾸면 집계에서 숨은 줄이 빠진다(state.svelte.ts의 condCells).
   */
  condFormat: "all",
};

export function scopeOf(op: FilterOp): FilterScope {
  return OP_SCOPE[op];
}

/** 조작이 노린 행 구간 — 위아래 끝(행 번호). */
export interface RowSpan {
  top: number;
  bottom: number;
}

/** 구간이 덮는 행 번호 전부. */
export function spanRows(span: RowSpan): number[] {
  const out: number[] = [];
  for (let r = span.top; r <= span.bottom; r++) out.push(r);
  return out;
}

/**
 * 이 조작이 실제로 닿을 행 번호.
 *
 * `visible`은 **그 구간에서 보이는 행들**이다(필터가 걸려 있을 때만 부른다).
 * 갈래가 "보이는 행만"이면 그것을 그대로, "전부"면 구간을 통째로 돌려준다.
 */
export function rowsForOp(op: FilterOp, span: RowSpan, visible: number[]): number[] {
  return OP_SCOPE[op] === "visible" ? visible : spanRows(span);
}

/** 이 구간에서 조작이 덮는 숨은 줄 수 — "전부"인 조작이 무엇을 덮었는지 알릴 때 쓴다. */
export function hiddenCovered(op: FilterOp, span: RowSpan, visible: number[]): number {
  return rowsForOp(op, span, visible).length - visible.length;
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
