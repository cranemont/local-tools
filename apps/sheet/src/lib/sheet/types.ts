/** 문서 자료구조.
 *
 * 값은 스칼라 넷(문자열·수·불리언·오류)뿐이다. 날짜는 따로 두지 않고 **엑셀 일련번호(수)
 * + 표시 형식**으로 저장한다 — 그래야 수식·정렬·서식이 한 가지 값 종류만 알면 된다.
 * (엑셀 자신이 그렇게 한다. 변환은 serial.ts.)
 */

import type { CondRule } from "./condformat";
import type { SheetFilter } from "./filter";
import type { ValidationRange } from "./validation";

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
  /**
   * 파일에서 읽은 원문. **표시가 원문과 달라지는 칸에만** 남는다
   * ("+821012345678"·"2024/01/05"·"1.50" 같은 것들).
   *
   * 이 칸은 화면에도 원문 그대로 그리고 저장할 때도 원문 그대로 내보낸다 —
   * 손대지 않은 칸이 왕복만으로 바뀌면 받는 쪽 시스템이 파일을 거부한다.
   * 값·수식·표시 형식을 건드리면 사라진다(model.ts의 putCell·applyStyle·clearStyles).
   */
  raw?: string;
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
  /**
   * 원문에서 본 표의 열 수 — 파일에서 읽어 온 시트에만 있다.
   *
   * 셀은 희소 Map이라 "빈 칸"은 아예 없다. 그래서 오른쪽 끝 열이 통째로 비어 있으면
   * 쓸 때 그 열이 있었다는 사실을 알 방법이 이 값뿐이다("a,b,\n"의 셋째 열).
   * `cols`(화면 크기)와 헷갈리지 말 것 — 이건 파일이 몇 열짜리였나다.
   * 새로 만든 시트에는 없고(없으면 쓸 때 값이 든 범위만 나간다), 열을 지우거나
   * 끼워 넣으면 함께 움직인다(model.ts).
   */
  srcCols?: number;
  /** 열 번호 → px 너비. 없으면 기본값. */
  colWidths: Map<number, number>;
  /** 행 번호 → px 높이. 없으면 기본값. */
  rowHeights: Map<number, number>;
  merges: MergeArea[];
  /** 고정 틀 — 이 개수만큼의 앞 행/열이 스크롤에서 고정된다. */
  frozenRows: number;
  frozenCols: number;
  hidden?: boolean;
  /**
   * 자동 필터 — **뷰 상태**다. 셀을 하나도 바꾸지 않고, 저장 기본값도 바꾸지 않는다
   * (걸러진 행도 파일에는 그대로 나간다). 걸린 열이 없으면 아예 없다.
   */
  filter?: SheetFilter;
  /**
   * 조건부 서식 규칙 — **문서 내용이다**(필터와 달리 뷰 상태가 아니다).
   * 편집으로 세고, 되돌리기에 남고, xlsx로 나간다.
   *
   * 앞에 적힌 것이 1순위다. 규칙 객체는 갈아 끼우기만 하고 제자리에서 고치지 않는다 —
   * 되돌리기 스냅샷이 배열 얕은 복사 한 줄로 끝나야 하기 때문이다(셀과 같은 규약).
   */
  condFormats?: CondRule[];
  /**
   * 입력 규칙 — 범위마다 하나. 셀이 아니라 **범위**에 붙는 이유는 빈 칸에도 걸려야
   * 하기 때문이다(셀은 희소 Map이라 빈 칸에는 객체가 없다). 검사는 새 입력에만
   * 걸고 이미 들어 있는 값은 고치지 않는다(CLAUDE.md 23번). 없으면 아예 없다.
   */
  validations?: ValidationRange[];
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
