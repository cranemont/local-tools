/** A1 표기 ↔ 0-기반 좌표.
 *
 * 이 파일만 "A1"·"$B$7"·"Sheet1!C3:D9" 같은 문자열을 안다. 나머지 코드는 전부
 * {row, col} 정수만 다룬다 — 수식 엔진과 그리드가 같은 좌표계를 쓰게 하려는 것이다.
 */

/** 스프레드시트 한 장의 최대 크기. xlsx 규격과 같은 값. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** 열 번호(0-기반) → 열 이름. 0→"A", 25→"Z", 26→"AA". */
export function colName(col: number): string {
  let n = col;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/** 열 이름 → 열 번호(0-기반). 잘못된 이름이면 -1. */
export function colIndex(name: string): number {
  if (!name) return -1;
  let n = 0;
  for (const ch of name.toUpperCase()) {
    const d = ch.charCodeAt(0) - 64; // A=1
    if (d < 1 || d > 26) return -1;
    n = n * 26 + d;
  }
  return n - 1;
}

/** 0-기반 좌표 → "A1". */
export function cellName(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

export interface RefAddr {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;

/** "A1"·"$B$7" → 좌표. 형식이 아니면 null. */
export function parseRef(text: string): RefAddr | null {
  const m = REF_RE.exec(text.trim());
  if (!m) return null;
  const col = colIndex(m[2]);
  const row = Number(m[4]) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { row, col, absRow: m[3] === "$", absCol: m[1] === "$" };
}

/** 좌표 → "A1"(절대 표시 포함). */
export function formatRef(ref: RefAddr): string {
  return `${ref.absCol ? "$" : ""}${colName(ref.col)}${ref.absRow ? "$" : ""}${ref.row + 1}`;
}

export interface Area {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** 두 모서리에서 정규화된 사각 영역을 만든다(순서 무관). */
export function areaOf(a: { row: number; col: number }, b: { row: number; col: number }): Area {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function areaContains(area: Area, row: number, col: number): boolean {
  return row >= area.top && row <= area.bottom && col >= area.left && col <= area.right;
}

export function areaWidth(area: Area): number {
  return area.right - area.left + 1;
}

export function areaHeight(area: Area): number {
  return area.bottom - area.top + 1;
}

/** "A1:C9" 또는 "A1" → 영역. 형식이 아니면 null. */
export function parseArea(text: string): Area | null {
  const parts = text.split(":");
  if (parts.length === 1) {
    const one = parseRef(parts[0]);
    return one ? { top: one.row, left: one.col, bottom: one.row, right: one.col } : null;
  }
  if (parts.length !== 2) return null;
  const a = parseRef(parts[0]);
  const b = parseRef(parts[1]);
  if (!a || !b) return null;
  return areaOf(a, b);
}

/** 영역 → "A1:C9"(한 칸이면 "A1"). */
export function formatArea(area: Area): string {
  const start = cellName(area.top, area.left);
  if (area.top === area.bottom && area.left === area.right) return start;
  return `${start}:${cellName(area.bottom, area.right)}`;
}

/** 셀 키 — Map의 키로 쓰는 정수 하나. (행,열)을 한 값으로 접는다. */
export function cellKey(row: number, col: number): number {
  return row * MAX_COLS + col;
}

export function keyRow(key: number): number {
  return Math.floor(key / MAX_COLS);
}

export function keyCol(key: number): number {
  return key % MAX_COLS;
}
