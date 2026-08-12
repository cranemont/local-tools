/** 문서 자료구조.
 *
 * 값은 스칼라 넷(문자열·수·불리언·오류)뿐이다. 날짜는 따로 두지 않고 **엑셀 일련번호(수)
 * + 표시 형식**으로 저장한다 — 그래야 수식·정렬·서식이 한 가지 값 종류만 알면 된다.
 * (엑셀 자신이 그렇게 한다. 변환은 serial.ts.)
 */

/** 엑셀과 같은 오류값. 문자열이 아니라 이 객체로 다뤄 값과 구분한다. */
export class CellError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code;
  }
}

export type ErrorCode =
  | "#NULL!"
  | "#DIV/0!"
  | "#VALUE!"
  | "#REF!"
  | "#NAME?"
  | "#NUM!"
  | "#N/A"
  | "#CIRC!";

export const ERR = {
  null: new CellError("#NULL!"),
  div0: new CellError("#DIV/0!"),
  value: new CellError("#VALUE!"),
  ref: new CellError("#REF!"),
  name: new CellError("#NAME?"),
  num: new CellError("#NUM!"),
  na: new CellError("#N/A"),
  circ: new CellError("#CIRC!"),
} as const;

export function isError(v: unknown): v is CellError {
  return v instanceof CellError;
}

/** 셀 하나가 가질 수 있는 값. */
export type Scalar = string | number | boolean | CellError | null;

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type BorderSide = "top" | "right" | "bottom" | "left";

/** 셀 서식. 없는 키는 "지정 안 함"이고, 그리드는 기본값으로 그린다. */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** #rrggbb */
  color?: string;
  /** #rrggbb */
  fill?: string;
  fontSize?: number;
  align?: HAlign;
  valign?: VAlign;
  wrap?: boolean;
  /** 엑셀 표시 형식 문자열. 예: "#,##0.00" · "yyyy-mm-dd" · "0.0%" */
  numFmt?: string;
  /** 테두리가 그려질 변. 색·굵기는 구분하지 않는다(1차 범위). */
  borders?: BorderSide[];
}

export interface Cell {
  /** 계산된 값. 수식 셀이면 마지막 재계산 결과가 들어 있다. */
  v: Scalar;
  /** 수식 원문 — "=" 없이 저장한다. 예: "SUM(A1:A9)" */
  f?: string;
  s?: CellStyle;
}

export interface MergeArea {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** 시트 한 장. 셀은 희소 Map이라 백만 행이어도 쓴 만큼만 메모리를 먹는다. */
export interface SheetDoc {
  name: string;
  /** cellKey(row, col) → Cell */
  cells: Map<number, Cell>;
  /** 화면에 보장할 최소 크기. 데이터가 더 크면 실제 사용 범위를 따른다. */
  rows: number;
  cols: number;
  /** 열 번호 → px 너비. 없으면 기본값. */
  colWidths: Map<number, number>;
  /** 행 번호 → px 높이. 없으면 기본값. */
  rowHeights: Map<number, number>;
  merges: MergeArea[];
  /** 고정 틀 — 이 개수만큼의 앞 행/열이 스크롤에서 고정된다. */
  frozenRows: number;
  frozenCols: number;
  hidden?: boolean;
}

export interface WorkbookDoc {
  sheets: SheetDoc[];
  active: number;
  /** 파일 이름(확장자 포함). 저장 기본값으로 쓴다. */
  filename: string;
  /** 원본이 어떤 형식이었나 — 저장 버튼의 기본 형식을 정한다. */
  origin: "csv" | "tsv" | "xlsx" | "json" | "new";
}

export const DEFAULT_COL_WIDTH = 96;
export const DEFAULT_ROW_HEIGHT = 26;

export function emptySheet(name: string, rows = 200, cols = 26): SheetDoc {
  return {
    name,
    cells: new Map(),
    rows,
    cols,
    colWidths: new Map(),
    rowHeights: new Map(),
    merges: [],
    frozenRows: 0,
    frozenCols: 0,
  };
}

export function emptyWorkbook(filename = "새 시트.csv"): WorkbookDoc {
  return { sheets: [emptySheet("Sheet1")], active: 0, filename, origin: "new" };
}
