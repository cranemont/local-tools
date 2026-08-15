/** 문서 조작 — 셀 읽기/쓰기, 사용 범위, 서식, 행·열 삽입/삭제, 정렬.
 *
 * 전부 순수 함수거나 문서를 제자리에서 고치는 함수다. 반응성은 여기 없다 —
 * 그리드는 state.svelte.ts의 revision 하나만 보고 다시 그린다(셀 수십만 개에
 * 세밀한 구독을 걸면 편집 한 번이 그만큼의 작업이 된다).
 */

import { areaContains, cellKey, type Area } from "./a1";
import type { FilterCell } from "./filter";
import { formatValue } from "./numfmt";
import { parseDateInput } from "./serial";
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  type Cell,
  type CellStyle,
  type Scalar,
  type SheetDoc,
} from "./types";

/** 영역이 덮는 행 번호들. */
function areaRows(area: Area): number[] {
  const out: number[] = [];
  for (let r = area.top; r <= area.bottom; r++) out.push(r);
  return out;
}

export function getCell(sheet: SheetDoc, row: number, col: number): Cell | undefined {
  return sheet.cells.get(cellKey(row, col));
}

export function getValue(sheet: SheetDoc, row: number, col: number): Scalar {
  return sheet.cells.get(cellKey(row, col))?.v ?? null;
}

/**
 * 셀 하나가 글자로 어떻게 보이는가 — 화면·복사·내보내기가 전부 이 함수를 거친다.
 *
 * 원문(raw)이 남아 있는 칸은 원문이 곧 표시다. 그래서 "화면에 보이는 것"과
 * "파일에 적히는 것"이 언제나 같다 — 손대지 않은 칸이 조용히 바뀔 자리가 없다.
 */
export function cellText(cell: Cell | undefined): string {
  if (!cell) return "";
  if (cell.raw !== undefined) return cell.raw;
  return formatValue(cell.v, cell.s?.numFmt);
}

/**
 * 이 칸이 내보낼 내용을 갖고 있나 — 값도 수식도 원문도 없이 **서식만 든 칸**은 아니다.
 *
 * 서식은 빈 칸에도 걸린다(아래 applyStyle이 칸을 만든다). 그런 칸을 표의 일부로 세면
 * 원문의 빈 줄이 ";;;;;;;"가 되고 표 오른쪽에 빈 열이 붙는다 — CSV·마크다운·JSON은
 * 서식을 담지 못하므로 사용자가 얻는 것 없이 파일만 달라진다(CLAUDE.md 23번).
 * 그래서 **내보내기가 표의 범위를 잴 때 이 판정을 쓴다**(csv.ts의 writeCsv,
 * convert.ts의 toGrid). 서식만 든 칸을 지우지는 않는다 — xlsx에서는 그 칸이
 * `<c r="B2" s="1"/>`로 파일에 나가기 때문이다.
 *
 * 위 cellText와 짝이다: 여기서 참인 칸만 글자를 내놓는다. `raw`를 빼면 값이 아직
 * null인데 원문만 든 칸의 글자가 파일에서 사라진다.
 */
export function hasContent(cell: Cell | undefined): boolean {
  return cell !== undefined && (cell.v !== null || cell.f !== undefined || cell.raw !== undefined);
}

/** 셀을 고친다. 값·수식·서식 중 준 것만 바뀐다. 빈 셀이 되면 Map에서 지운다. */
export function putCell(sheet: SheetDoc, row: number, col: number, patch: Partial<Cell>): void {
  const key = cellKey(row, col);
  const prev = sheet.cells.get(key);
  const next: Cell = { v: prev?.v ?? null, ...prev, ...patch };
  if (patch.f === undefined && "f" in patch) delete next.f;
  if (next.f === undefined) delete next.f;
  if (next.s && Object.keys(next.s).length === 0) delete next.s;
  // 값이나 수식을 새로 넣은 칸은 더 이상 "파일에서 온 그대로"가 아니다.
  if (patch.raw === undefined && ("v" in patch || "f" in patch)) delete next.raw;

  if (next.v === null && next.f === undefined && !next.s) sheet.cells.delete(key);
  else sheet.cells.set(key, next);
}

/**
 * 필터가 보는 칸 하나 — 계산된 값과 화면에 보이는 글자.
 * 필터 엔진(filter.ts)은 문서를 모르므로 여기서 건네준다.
 */
export function filterCellAt(sheet: SheetDoc, row: number, col: number): FilterCell {
  const cell = sheet.cells.get(cellKey(row, col));
  return { v: cell?.v ?? null, text: cellText(cell) };
}

/**
 * 값과 수식만 지운다(서식은 남긴다) — Delete 키의 동작.
 *
 * `rows`를 주면 그 줄들만 지운다 — 필터가 걸린 표에서 **보이는 칸만** 지우려는 것이다
 * (숨은 줄이 함께 지워지면 사용자는 무엇이 사라졌는지 볼 수도 없다).
 */
export function clearContents(sheet: SheetDoc, area: Area, rows?: number[]): void {
  const lines = rows ?? areaRows(area);
  for (const r of lines) {
    for (let c = area.left; c <= area.right; c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells.get(key);
      if (!cell) continue;
      if (cell.s) sheet.cells.set(key, { v: null, s: cell.s });
      else sheet.cells.delete(key);
    }
  }
}

/** 서식만 지운다. `rows`를 주면 그 줄만(=필터가 걸린 표의 보이는 줄만). */
export function clearStyles(sheet: SheetDoc, area: Area, rows?: number[]): void {
  for (const r of rows ?? areaRows(area)) {
    for (let c = area.left; c <= area.right; c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells.get(key);
      if (!cell?.s) continue;
      // 표시 형식까지 떨어져 나가므로 원문 보존도 여기서 끝난다(아래 applyStyle과 같은 이유).
      const { s: _drop, raw: _dropRaw, ...rest } = cell;
      if (rest.v === null && rest.f === undefined) sheet.cells.delete(key);
      else sheet.cells.set(key, rest);
    }
  }
}

/**
 * 영역에 서식을 덮어쓴다. 값이 undefined인 키는 그 속성을 지운다는 뜻이다.
 * `rows`를 주면 그 줄만 — 필터가 걸린 표에서 **보이는 칸에만** 걸기 위한 것이다.
 */
export function applyStyle(
  sheet: SheetDoc,
  area: Area,
  patch: Partial<CellStyle>,
  rows?: number[],
): void {
  // 표시 형식을 손대면 "원문 그대로 보이고 원문 그대로 나간다"는 약속이 깨진다 —
  // 사용자가 형식을 골랐다는 건 그 형식으로 보고 싶다는 뜻이므로 원문을 놓아 준다.
  const dropRaw = "numFmt" in patch;

  for (const r of rows ?? areaRows(area)) {
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
          if (dropRaw) delete rest.raw;
          sheet.cells.set(key, rest);
        }
      } else {
        const next: Cell = { ...cell, s: style };
        if (dropRaw) delete next.raw;
        sheet.cells.set(key, next);
      }
    }
  }
}

/**
 * 영역의 값을 보이는 그대로 글자로 굳히고 표시 형식을 "@"(텍스트)로 못 박는다.
 *
 * 전화번호·주민번호·송장번호 열이 수로 읽혔을 때 되돌리는 통로다. 원문이 남아
 * 있으면 그 원문이 그대로 값이 되므로 파일에 적힌 글자를 정확히 되찾는다.
 * 수식 셀은 건드리지 않는다(값이 아니라 식을 지우게 된다). 바뀐 칸 수를 준다.
 * `rows`를 주면 그 줄만 — 보이는 글자를 값으로 굳히는 조작이라 서식과 같은 갈래다.
 */
export function forceText(sheet: SheetDoc, area: Area, rows?: number[]): number {
  let changed = 0;
  for (const r of rows ?? areaRows(area)) {
    for (let c = area.left; c <= area.right; c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells.get(key);
      if (!cell || cell.f !== undefined || cell.v === null) continue;
      const text = cellText(cell);
      const style: CellStyle = { ...cell.s, numFmt: "@" };
      sheet.cells.set(key, { v: text, s: style });
      changed++;
    }
  }
  return changed;
}

/**
 * 첫 줄을 아래로 채운다(Ctrl+D).
 *
 * `rows`가 채울 줄 **전부**다 — 맨 앞이 원본이고 나머지가 대상이다. 필터가 걸려
 * 있으면 보이는 줄만 들어오므로 원본도 "화면에서 맨 위 줄"이 된다(엑셀과 같다).
 * 수식은 원본과의 **실제 행 차이**만큼 옮긴다 — 건너뛴 숨은 줄만큼 어긋나면
 * A2를 참조하던 식이 엉뚱한 줄을 가리킨다.
 */
export function fillDown(
  sheet: SheetDoc,
  area: Area,
  rows: number[],
  shift: (formula: string, dRow: number) => string,
): void {
  if (rows.length < 2) return;
  const from = rows[0];
  for (let c = area.left; c <= area.right; c++) {
    const source = sheet.cells.get(cellKey(from, c));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!source) {
        sheet.cells.delete(cellKey(r, c));
        continue;
      }
      putCell(sheet, r, c, {
        v: source.v,
        f: source.f ? shift(source.f, r - from) : undefined,
        s: source.s,
      });
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
    if (Number.isFinite(n) && !losesDigits(s, n)) {
      return { value: n, numFmt: s.includes(",") ? "#,##0" : undefined };
    }
  }

  return { value: text };
}

/**
 * 이 문자열을 수로 바꾸면 자릿수가 날아가는가.
 *
 * 안전 정수(2^53−1)를 넘는 정수는 double이 담지 못한다 — 19자리 송장번호,
 * 카드번호, 유전자 ID가 그 자리에서 다른 수가 된다. 되돌릴 방법이 없으므로
 * 글자로 남긴다. 소수점을 찍은 표기("1.23E+20")는 애초에 근삿값을 적은 것이라
 * 그대로 수로 받는다 — 식별자는 소수점을 안 쓴다.
 */
function losesDigits(text: string, n: number): boolean {
  if (text.includes(".")) return false;
  return !Number.isSafeInteger(n);
}

/** 첫 줄이 머리글로 보이면 1, 아니면 0 — 정렬에서 첫 줄을 뺄지 정하는 기본값. */
export function guessHeaderRows(sheet: SheetDoc): number {
  if (sheet.frozenRows > 0) return Math.min(sheet.frozenRows, 5);
  const used = usedRange(sheet);
  if (used.bottom < 1) return 0;

  let headText = 0;
  let bodyNumbers = 0;
  for (let c = used.left; c <= used.right; c++) {
    const head = sheet.cells.get(cellKey(0, c))?.v ?? null;
    const body = sheet.cells.get(cellKey(1, c))?.v ?? null;
    if (typeof head === "string" && head.trim() !== "") headText++;
    else if (head !== null) return 0; // 첫 줄에 수가 있으면 머리글이 아니다
    if (typeof body === "number") bodyNumbers++;
  }
  return headText > 0 && bodyNumbers > 0 ? 1 : 0;
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

/** 참조 보정 콜백 중 "어디서 몇 줄"을 함께 받는 것 — 여러 덩어리를 한 번에 지울 때 쓴다. */
export type RowShift = (formula: string, at: number, count: number) => string;

/** 정렬된 행 번호 배열을 이어진 덩어리로 접는다. */
function runsOf(sorted: number[]): { at: number; count: number }[] {
  const runs: { at: number; count: number }[] = [];
  for (const row of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.at + last.count === row) last.count++;
    else runs.push({ at: row, count: 1 });
  }
  return runs;
}

/**
 * 흩어진 여러 줄을 한 번에 지운다 — 필터가 걸린 표에서 **보이는 행만** 지우는 통로다.
 *
 * 이어지지 않은 줄들이라 `deleteRows`를 여러 번 부르면 부를 때마다 셀 Map을 통째로
 * 다시 만든다(줄 수만큼 O(n)). 여기서는 한 번만 훑고, 참조 보정만 덩어리 단위로
 * **아래쪽부터** 적용한다 — 위쪽을 먼저 지우면 아래쪽 덩어리의 번호가 밀려 틀린다.
 */
export function deleteRowSet(sheet: SheetDoc, rows: number[], shift: RowShift): void {
  const doomed = [...new Set(rows)].sort((a, b) => a - b);
  if (doomed.length === 0) return;
  const gone = new Set(doomed);
  const runs = runsOf(doomed);

  /** 이 줄보다 앞에서 몇 줄이 사라지는가 = 위로 올라갈 칸 수. */
  const lifted = (row: number): number => {
    let lo = 0;
    let hi = doomed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (doomed[mid] < row) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  moveCells(
    sheet,
    (f) => runs.reduceRight((acc, run) => shift(acc, run.at, run.count), f),
    (row) => !gone.has(row),
    (row, col) => ({ row: row - lifted(row), col }),
  );

  let heights = sheet.rowHeights;
  for (let i = runs.length - 1; i >= 0; i--) heights = shiftSizes(heights, runs[i].at, -runs[i].count);
  sheet.rowHeights = heights;
  sheet.rows = Math.max(1, sheet.rows - doomed.length);
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
  // 표 안에 끼워 넣었으면 표도 그만큼 넓어진다(오른쪽 바깥이면 표는 그대로).
  if (sheet.srcCols !== undefined && at < sheet.srcCols) sheet.srcCols += count;
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
  // 지운 열 중 표 안에 있던 것만큼 표가 좁아진다 — 안 그러면 지운 열이
  // 빈 칸으로 파일에 계속 남는다(csv.ts의 srcCols).
  if (sheet.srcCols !== undefined && at < sheet.srcCols) {
    sheet.srcCols -= Math.min(at + count, sheet.srcCols) - at;
  }
}

// ── 정렬 ────────────────────────────────────────────────────────

/** 값 비교 — 수 < 글자 < 불리언 < 오류, 빈 칸은 언제나 맨 뒤. 필터 목록도 이 차례를 쓴다. */
export function compareScalar(a: Scalar, b: Scalar): number {
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

/** 정렬 기준 한 줄. 앞에 적은 것이 1순위다. */
export interface SortKey {
  col: number;
  asc: boolean;
}

/**
 * 영역을 정렬한다. 셀 값·서식·원문이 통째로 따라 움직인다.
 *
 * 기준은 여러 개를 받는다 — 앞의 키가 같을 때만 다음 키를 본다("부서 오름차순
 * 다음 금액 내림차순"). 같은 값끼리의 원래 순서는 Array.prototype.sort가
 * 명세상 안정 정렬이라 저절로 지켜진다.
 *
 * 수식은 옮기지 않는다 — 정렬된 수식은 거의 언제나 틀린 참조를 가리키므로
 * 계산된 값으로 굳혀서 옮긴다.
 */
export function sortArea(sheet: SheetDoc, area: Area, keys: SortKey[]): void {
  if (keys.length === 0) return;

  const rows: { cells: (Cell | undefined)[]; keyValues: Scalar[] }[] = [];
  for (let r = area.top; r <= area.bottom; r++) {
    const cells: (Cell | undefined)[] = [];
    for (let c = area.left; c <= area.right; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      cells.push(
        cell
          ? {
              v: cell.v,
              ...(cell.s ? { s: cell.s } : {}),
              ...(cell.raw !== undefined ? { raw: cell.raw } : {}),
            }
          : undefined,
      );
    }
    rows.push({
      cells,
      keyValues: keys.map((k) => sheet.cells.get(cellKey(r, k.col))?.v ?? null),
    });
  }

  rows.sort((x, y) => {
    for (let i = 0; i < keys.length; i++) {
      const d = compareScalar(x.keyValues[i], y.keyValues[i]);
      if (d !== 0) return keys[i].asc ? d : -d;
    }
    return 0;
  });

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
