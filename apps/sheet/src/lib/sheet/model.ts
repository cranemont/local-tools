/** 문서 조작 — 셀 읽기/쓰기, 사용 범위, 서식, 행·열 삽입/삭제, 정렬.
 *
 * 전부 순수 함수거나 문서를 제자리에서 고치는 함수다. 반응성은 여기 없다 —
 * 그리드는 state.svelte.ts의 revision 하나만 보고 다시 그린다(셀 수십만 개에
 * 세밀한 구독을 걸면 편집 한 번이 그만큼의 작업이 된다).
 */

import { areaContains, cellKey, type Area } from "./a1";
import { parseDateInput } from "./serial";
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  type Cell,
  type CellStyle,
  type Scalar,
  type SheetDoc,
} from "./types";

export function getCell(sheet: SheetDoc, row: number, col: number): Cell | undefined {
  return sheet.cells.get(cellKey(row, col));
}

export function getValue(sheet: SheetDoc, row: number, col: number): Scalar {
  return sheet.cells.get(cellKey(row, col))?.v ?? null;
}

/** 셀을 고친다. 값·수식·서식 중 준 것만 바뀐다. 빈 셀이 되면 Map에서 지운다. */
export function putCell(sheet: SheetDoc, row: number, col: number, patch: Partial<Cell>): void {
  const key = cellKey(row, col);
  const prev = sheet.cells.get(key);
  const next: Cell = { v: prev?.v ?? null, ...prev, ...patch };
  if (patch.f === undefined && "f" in patch) delete next.f;
  if (next.f === undefined) delete next.f;
  if (next.s && Object.keys(next.s).length === 0) delete next.s;

  if (next.v === null && next.f === undefined && !next.s) sheet.cells.delete(key);
  else sheet.cells.set(key, next);
}

/** 값과 수식만 지운다(서식은 남긴다) — Delete 키의 동작. */
export function clearContents(sheet: SheetDoc, area: Area): void {
  for (let r = area.top; r <= area.bottom; r++) {
    for (let c = area.left; c <= area.right; c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells.get(key);
      if (!cell) continue;
      if (cell.s) sheet.cells.set(key, { v: null, s: cell.s });
      else sheet.cells.delete(key);
    }
  }
}

/** 서식만 지운다. */
export function clearStyles(sheet: SheetDoc, area: Area): void {
  for (let r = area.top; r <= area.bottom; r++) {
    for (let c = area.left; c <= area.right; c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells.get(key);
      if (!cell?.s) continue;
      const { s: _drop, ...rest } = cell;
      if (rest.v === null && rest.f === undefined) sheet.cells.delete(key);
      else sheet.cells.set(key, rest);
    }
  }
}

/** 영역에 서식을 덮어쓴다. 값이 undefined인 키는 그 속성을 지운다는 뜻이다. */
export function applyStyle(sheet: SheetDoc, area: Area, patch: Partial<CellStyle>): void {
  for (let r = area.top; r <= area.bottom; r++) {
    for (let c = area.left; c <= area.right; c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells.get(key) ?? { v: null };
      const style: CellStyle = { ...cell.s };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === false) delete (style as Record<string, unknown>)[k];
        else (style as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(style).length === 0) {
        if (cell.v === null && cell.f === undefined) sheet.cells.delete(key);
        else {
          const { s: _drop, ...rest } = cell;
          sheet.cells.set(key, rest);
        }
      } else {
        sheet.cells.set(key, { ...cell, s: style });
      }
    }
  }
}

/** 실제로 내용이 있는 범위. 비어 있으면 A1 한 칸. */
export function usedRange(sheet: SheetDoc): Area {
  let bottom = -1;
  let right = -1;
  for (const key of sheet.cells.keys()) {
    const r = Math.floor(key / 16_384);
    const c = key % 16_384;
    if (r > bottom) bottom = r;
    if (c > right) right = c;
  }
  if (bottom < 0) return { top: 0, left: 0, bottom: 0, right: 0 };
  return { top: 0, left: 0, bottom, right };
}

export function colWidth(sheet: SheetDoc, col: number): number {
  return sheet.colWidths.get(col) ?? DEFAULT_COL_WIDTH;
}

export function rowHeight(sheet: SheetDoc, row: number): number {
  return sheet.rowHeights.get(row) ?? DEFAULT_ROW_HEIGHT;
}

// ── 입력 해석 ────────────────────────────────────────────────────
// 사람이 친 문자열 하나를 값·수식·표시형식으로 나눈다. 여기 규칙이 곧
// "왜 010이 10이 되지 않는가" 같은 체감을 만든다.

export interface ParsedInput {
  value: Scalar;
  formula?: string;
  /** 입력만으로 형식이 정해지는 경우(날짜·백분율). 기존 형식이 없을 때만 쓴다. */
  numFmt?: string;
}

const NUMBER_RE = /^[+-]?(\d{1,3}(,\d{3})*|\d*)(\.\d+)?([eE][+-]?\d+)?$/;

export function parseInput(text: string): ParsedInput {
  const s = text.trim();
  if (s === "") return { value: null };

  if (s.startsWith("=")) {
    const body = s.slice(1).trim();
    // "=" 하나만 친 경우는 수식이 아니라 글자로 둔다.
    return body ? { value: null, formula: body } : { value: s };
  }

  // 앞에 '를 붙이면 무조건 글자 — 010·1-2 같은 걸 지키는 탈출구.
  if (s.startsWith("'")) return { value: text.slice(text.indexOf("'") + 1) };

  if (s === "TRUE" || s === "true") return { value: true };
  if (s === "FALSE" || s === "false") return { value: false };

  const date = parseDateInput(s);
  if (date) return { value: date.serial, numFmt: date.fmt };

  if (s.endsWith("%")) {
    const head = s.slice(0, -1).trim();
    if (NUMBER_RE.test(head) && head !== "") {
      const n = Number(head.replace(/,/g, ""));
      if (Number.isFinite(n)) return { value: n / 100, numFmt: "0.00%" };
    }
  }

  // 앞자리 0이 있는 문자열(전화번호·우편번호)은 수로 바꾸지 않는다.
  const leadingZero = /^0\d/.test(s);
  if (!leadingZero && NUMBER_RE.test(s) && /\d/.test(s)) {
    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n)) return { value: n, numFmt: s.includes(",") ? "#,##0" : undefined };
  }

  return { value: text };
}

// ── 행·열 삽입/삭제 ──────────────────────────────────────────────
// 셀을 옮기고 나면 수식 속 참조도 따라와야 한다. 참조 보정은 formula/adjust.ts가
// 하고(파서를 거쳐야 하므로), 여기서는 콜백으로 받아 결합만 한다.

export type RefShift = (formula: string) => string;

function moveCells(
  sheet: SheetDoc,
  shiftFormula: RefShift,
  keep: (row: number, col: number) => boolean,
  move: (row: number, col: number) => { row: number; col: number },
): void {
  const next = new Map<number, Cell>();
  for (const [key, cell] of sheet.cells) {
    const row = Math.floor(key / 16_384);
    const col = key % 16_384;
    if (!keep(row, col)) continue;
    const to = move(row, col);
    next.set(cellKey(to.row, to.col), cell.f ? { ...cell, f: shiftFormula(cell.f) } : cell);
  }
  sheet.cells = next;
}

function shiftSizes(sizes: Map<number, number>, at: number, delta: number): Map<number, number> {
  const next = new Map<number, number>();
  for (const [i, v] of sizes) {
    if (i < at) next.set(i, v);
    else if (delta > 0) next.set(i + delta, v);
    else if (i >= at - delta) next.set(i + delta, v);
  }
  return next;
}

export function insertRows(sheet: SheetDoc, at: number, count: number, shift: RefShift): void {
  moveCells(
    sheet,
    shift,
    () => true,
    (row, col) => ({ row: row >= at ? row + count : row, col }),
  );
  sheet.rowHeights = shiftSizes(sheet.rowHeights, at, count);
  sheet.rows += count;
}

export function deleteRows(sheet: SheetDoc, at: number, count: number, shift: RefShift): void {
  moveCells(
    sheet,
    shift,
    (row) => row < at || row >= at + count,
    (row, col) => ({ row: row >= at + count ? row - count : row, col }),
  );
  sheet.rowHeights = shiftSizes(sheet.rowHeights, at, -count);
  sheet.rows = Math.max(1, sheet.rows - count);
}

export function insertCols(sheet: SheetDoc, at: number, count: number, shift: RefShift): void {
  moveCells(
    sheet,
    shift,
    () => true,
    (row, col) => ({ row, col: col >= at ? col + count : col }),
  );
  sheet.colWidths = shiftSizes(sheet.colWidths, at, count);
  sheet.cols += count;
}

export function deleteCols(sheet: SheetDoc, at: number, count: number, shift: RefShift): void {
  moveCells(
    sheet,
    shift,
    (_row, col) => col < at || col >= at + count,
    (row, col) => ({ row, col: col >= at + count ? col - count : col }),
  );
  sheet.colWidths = shiftSizes(sheet.colWidths, at, -count);
  sheet.cols = Math.max(1, sheet.cols - count);
}

// ── 정렬 ────────────────────────────────────────────────────────

/** 값 비교 — 수 < 글자 < 불리언 < 오류, 빈 칸은 언제나 맨 뒤. */
function compareScalar(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar): number => {
    if (v === null) return 4;
    if (typeof v === "number") return 0;
    if (typeof v === "string") return 1;
    if (typeof v === "boolean") return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a as number) - (b as number);
  if (ra === 1) return (a as string).localeCompare(b as string, "ko");
  if (ra === 2) return Number(a) - Number(b);
  return 0;
}

/**
 * 영역을 특정 열 기준으로 정렬한다. 셀 값·서식이 통째로 따라 움직인다.
 * 수식은 옮기지 않는다 — 정렬된 수식은 거의 언제나 틀린 참조를 가리키므로
 * 계산된 값으로 굳혀서 옮긴다.
 */
export function sortArea(sheet: SheetDoc, area: Area, byCol: number, asc: boolean): void {
  const rows: { cells: (Cell | undefined)[]; keyValue: Scalar }[] = [];
  for (let r = area.top; r <= area.bottom; r++) {
    const cells: (Cell | undefined)[] = [];
    for (let c = area.left; c <= area.right; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      cells.push(cell ? { v: cell.v, ...(cell.s ? { s: cell.s } : {}) } : undefined);
    }
    rows.push({ cells, keyValue: sheet.cells.get(cellKey(r, byCol))?.v ?? null });
  }

  rows.sort((x, y) => (asc ? 1 : -1) * compareScalar(x.keyValue, y.keyValue));

  for (let i = 0; i < rows.length; i++) {
    const r = area.top + i;
    for (let j = 0; j < rows[i].cells.length; j++) {
      const c = area.left + j;
      const cell = rows[i].cells[j];
      if (cell) sheet.cells.set(cellKey(r, c), cell);
      else sheet.cells.delete(cellKey(r, c));
    }
  }
}

/** 병합 영역 중 이 칸을 덮는 것. 없으면 null. */
export function mergeAt(sheet: SheetDoc, row: number, col: number): Area | null {
  for (const m of sheet.merges) {
    if (areaContains(m, row, col)) return m;
  }
  return null;
}

export function mergeCells(sheet: SheetDoc, area: Area): void {
  unmergeCells(sheet, area);
  if (area.top === area.bottom && area.left === area.right) return;
  sheet.merges.push({ ...area });
}

export function unmergeCells(sheet: SheetDoc, area: Area): void {
  sheet.merges = sheet.merges.filter(
    (m) => m.right < area.left || m.left > area.right || m.bottom < area.top || m.top > area.bottom,
  );
}
