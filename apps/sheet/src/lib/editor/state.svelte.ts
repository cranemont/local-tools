/** 에디터 전역 상태. 앱에 표가 하나뿐이라 모듈 싱글턴으로 둔다.
 *
 * 반응성 규약: 문서(WorkbookDoc)는 **일반 객체**로 두고 `revision` 하나만 $state다.
 * 셀 수십만 개에 세밀한 구독을 걸면 편집 한 번이 그만큼의 작업이 되기 때문이다.
 * 대신 문서를 읽는 메서드는 전부 첫 줄에서 `this.revision`을 건드린다 —
 * $derived 안에서 그 메서드를 부르면 자동으로 의존이 걸린다.
 */

import { adjustCols, adjustRows, translateFormula } from "../formula/adjust";
import { formulaError, recalculate } from "../formula/engine";
import {
  areaHeight,
  areaOf,
  areaWidth,
  cellKey,
  cellName,
  colName,
  formatArea,
  MAX_COLS,
  MAX_ROWS,
  type Area,
} from "../sheet/a1";
import {
  DEFAULT_CSV_WRITE,
  readCsv,
  writeCsv,
  type CsvReadResult,
  type CsvWriteOptions,
  type Delimiter,
} from "../sheet/csv";
import { exportText, readJson, type ExportFormat } from "../sheet/convert";
import {
  uniqueValues,
  visibleRows as filterRows,
  type ColumnFilter,
  type FilterColumn,
  type SheetFilter,
  type UniqueValue,
} from "../sheet/filter";
import {
  applyStyle,
  cellText,
  clearContents,
  clearStyles,
  colWidth,
  deleteCols,
  deleteRows,
  deleteRowSet,
  filterCellAt,
  forceText,
  getCell,
  guessHeaderRows,
  insertCols,
  insertRows,
  mergeAt,
  mergeCells,
  parseInput,
  putCell,
  rowHeight,
  sortArea,
  unmergeCells,
  usedRange,
  type ParsedInput,
  type SortKey,
} from "../sheet/model";
import { formatValue } from "../sheet/numfmt";
import { isDateFormat } from "../sheet/serial";
import { downloadBlob, withExtension } from "../sheet/save";
import {
  DEFAULT_COL_WIDTH,
  emptySheet,
  emptyWorkbook,
  isError,
  type Cell,
  type CellStyle,
  type Scalar,
  type SheetDoc,
  type WorkbookDoc,
} from "../sheet/types";
import { t } from "../i18n";

export interface Pos {
  row: number;
  col: number;
}

export interface EditBuffer {
  row: number;
  col: number;
  text: string;
  /** 타자로 시작했으면 true — Esc가 원래 값을 되돌린다. */
  fromTyping: boolean;
}

/** 내부 복사 버퍼 — 수식·서식까지 살려서 붙여 넣으려고 둔다. */
interface ClipBuffer {
  area: Area;
  cells: (Cell | undefined)[][];
  /**
   * 각 줄이 어느 행에서 왔나. 필터가 걸려 있으면 숨은 줄을 건너뛰므로
   * `area.top + i`로는 알 수 없다 — 수식 참조 보정이 이 값으로 간다.
   */
  rows: number[];
  /** 클립보드에 실제로 쓴 텍스트. 외부에서 바뀌었는지 대조하는 데 쓴다. */
  text: string;
}

/** 되돌리기 지점. 셀 객체는 불변이라 Map만 복사하면 된다(재계산도 새 객체를 만든다). */
interface Snapshot {
  sheets: SheetDoc[];
  active: number;
  cursor: Pos;
  anchor: Pos;
}

const HISTORY_MAX = 40;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function cloneSheet(sheet: SheetDoc): SheetDoc {
  return {
    ...sheet,
    cells: new Map(sheet.cells),
    colWidths: new Map(sheet.colWidths),
    rowHeights: new Map(sheet.rowHeights),
    merges: sheet.merges.map((m) => ({ ...m })),
    ...(sheet.filter
      ? { filter: { headerRows: sheet.filter.headerRows, cols: new Map(sheet.filter.cols) } }
      : {}),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export class EditorState {
  /** 문서. 반응형이 아니다 — 바꾼 뒤 반드시 touch()를 부를 것. */
  private doc: WorkbookDoc = emptyWorkbook();

  /** 문서 리비전. 화면은 전부 이 값에 매달려 있다. */
  revision = $state(0);

  hasFile = $state(false);
  filename = $state("");
  encoding = $state("");
  delimiter = $state<Delimiter>(",");
  dirty = $state(false);

  /** 인코딩을 손으로 고른 값("auto"면 판별에 맡긴다). 다시 읽기가 이걸 쓴다. */
  encodingChoice = $state("auto");
  /** 원본 바이트를 들고 있는가 — CSV류만 참이고, 다시 읽기 메뉴가 이 값으로 뜬다. */
  canReread = $state(false);

  cursor = $state<Pos>({ row: 0, col: 0 });
  anchor = $state<Pos>({ row: 0, col: 0 });
  editing = $state<EditBuffer | null>(null);

  busy = $state(false);
  busyMsg = $state("");
  error = $state("");
  notice = $state("");

  canUndo = $state(false);
  canRedo = $state(false);

  csvOptions = $state<CsvWriteOptions>({ ...DEFAULT_CSV_WRITE });
  exportHeader = $state(true);
  /** 저장·복사에 보이는 행만 넣을지. 기본은 전부 — 거르는 쪽이 명시적인 선택이어야 한다. */
  exportVisibleOnly = $state(false);

  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private clip: ClipBuffer | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 마지막으로 연 CSV의 원본 바이트 — 인코딩·구분자를 바꿔 다시 읽으려면 필요하다. */
  private lastBytes: Uint8Array | null = null;

  // ── 읽기 ──────────────────────────────────────────────────────
  // 전부 revision을 건드린 뒤 값을 돌려준다(위 반응성 규약 참고).

  get book(): WorkbookDoc {
    void this.revision;
    return this.doc;
  }

  get sheet(): SheetDoc {
    void this.revision;
    return this.doc.sheets[this.doc.active] ?? this.doc.sheets[0];
  }

  get sheetNames(): string[] {
    void this.revision;
    return this.doc.sheets.map((s) => s.name);
  }

  get activeSheet(): number {
    void this.revision;
    return this.doc.active;
  }

  readonly selection = $derived<Area>(areaOf(this.cursor, this.anchor));

  readonly selectionLabel = $derived.by(() => {
    const area = this.selection;
    if (areaWidth(area) === 1 && areaHeight(area) === 1) return cellName(area.top, area.left);
    return formatArea(area);
  });

  cellAt(row: number, col: number): Cell | undefined {
    void this.revision;
    return getCell(this.doc.sheets[this.doc.active], row, col);
  }

  /** 화면에 보이는 문자열 — 원문이 남은 칸은 원문, 아니면 표시 형식을 적용한 값. */
  displayAt(row: number, col: number): string {
    return cellText(this.cellAt(row, col));
  }

  /** 수식 입력줄에 넣을 문자열 — 수식이면 원문, 아니면 편집 가능한 원값. */
  editTextAt(row: number, col: number): string {
    const cell = this.cellAt(row, col);
    if (!cell) return "";
    if (cell.f) return `=${cell.f}`;
    if (cell.v === null) return "";
    if (isError(cell.v)) return cell.v.code;
    if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
    // 파일에서 온 그대로인 칸은 그 글자를 고치게 한다 — 화면에 보이는 것과 같아야 한다.
    if (cell.raw !== undefined) return cell.raw;
    if (typeof cell.v === "number") return formatValue(cell.v, cell.s?.numFmt);
    return cell.v;
  }

  colWidthAt(col: number): number {
    void this.revision;
    return colWidth(this.doc.sheets[this.doc.active], col);
  }

  rowHeightAt(row: number): number {
    void this.revision;
    return rowHeight(this.doc.sheets[this.doc.active], row);
  }

  mergeCovering(row: number, col: number): Area | null {
    void this.revision;
    return mergeAt(this.doc.sheets[this.doc.active], row, col);
  }

  /** 선택 영역의 대표 서식 — 툴바 토글 상태에 쓴다. */
  readonly cursorStyle = $derived.by((): CellStyle => this.cellAt(this.cursor.row, this.cursor.col)?.s ?? {});

  /** 파일에서 온 그대로 들고 있는 칸 수 — 상태줄이 "원문 유지 N칸"으로 보여 준다. */
  readonly preservedCount = $derived.by(() => {
    void this.revision;
    let n = 0;
    for (const cell of this.doc.sheets[this.doc.active].cells.values()) {
      if (cell.raw !== undefined) n++;
    }
    return n;
  });

  /** 첫 줄이 머리글로 보이는가 — 정렬 대화의 기본값. */
  get headerRowsGuess(): number {
    void this.revision;
    return guessHeaderRows(this.doc.sheets[this.doc.active]);
  }

  /** 정렬 기준으로 고를 수 있는 열 — 머리글 글자가 있으면 함께 준다. */
  sortableColumns(headerRows: number): { col: number; label: string }[] {
    void this.revision;
    const sheet = this.doc.sheets[this.doc.active];
    const used = usedRange(sheet);
    const out: { col: number; label: string }[] = [];
    for (let c = used.left; c <= used.right; c++) {
      const head = headerRows > 0 ? cellText(sheet.cells.get(cellKey(0, c))).trim() : "";
      out.push({ col: c, label: head ? `${colName(c)} — ${head}` : colName(c) });
    }
    return out;
  }

  // ── 자동 필터 ─────────────────────────────────────────────────
  //
  // 좌표계가 둘이다. **행 번호**는 문서의 좌표(A1의 1, 수식·커서·복사가 쓰는 것)이고,
  // **순번**은 보이는 행 목록에서의 자리(그리드가 세로로 그리는 위치)다.
  // `visibleRows`가 순번 → 행 번호 표이고, 이 클래스 밖으로는 행 번호만 나간다.

  /**
   * 보이는 행 번호들. 필터가 없거나 아무 줄도 안 걸러지면 **null**이다 —
   * 그때 순번은 곧 행 번호이므로 백만 줄짜리 배열을 만들 이유가 없다.
   */
  readonly visibleRows = $derived.by((): number[] | null => {
    void this.revision;
    const sheet = this.doc.sheets[this.doc.active];
    const state = sheet.filter;
    if (!state || state.cols.size === 0) return null;

    const used = usedRange(sheet);
    const top = Math.min(state.headerRows, Math.max(sheet.rows - 1, 0));
    const bottom = Math.min(used.bottom, sheet.rows - 1);
    if (bottom < top) return null;

    const range: number[] = [];
    for (let r = top; r <= bottom; r++) range.push(r);

    const columns: FilterColumn[] = [];
    for (const [col, filter] of state.cols) {
      columns.push({ filter, cells: range.map((r) => filterCellAt(sheet, r, col)) });
    }

    const kept = filterRows(range, columns);
    if (kept.length === range.length) return null;

    // 머리글과 표 아래쪽 빈 줄은 걸러지지 않는다 — 엑셀과 같다.
    const out: number[] = [];
    for (let r = 0; r < top; r++) out.push(r);
    for (const r of kept) out.push(r);
    for (let r = bottom + 1; r < sheet.rows; r++) out.push(r);
    return out;
  });

  readonly hiddenRowCount = $derived.by(() => {
    const rows = this.visibleRows;
    if (!rows) return 0;
    void this.revision;
    return Math.max(0, this.doc.sheets[this.doc.active].rows - rows.length);
  });

  /** 걸린 필터 수 — 도구줄의 "필터 지우기"가 이 값으로 켜진다. */
  readonly filterCount = $derived.by(() => {
    void this.revision;
    return this.doc.sheets[this.doc.active].filter?.cols.size ?? 0;
  });

  /** 이 행이 화면에 있나. 필터가 없으면 언제나 참. */
  isRowVisible(row: number): boolean {
    const rows = this.visibleRows;
    if (!rows) return true;
    return rows[this.rowOrdinal(row)] === row;
  }

  /**
   * 행 번호 → 순번. 숨은 행이면 **바로 다음 보이는 행**의 순번을 준다
   * (그 자리가 화면에서 이 행이 있던 곳이다).
   */
  rowOrdinal(row: number): number {
    const rows = this.visibleRows;
    if (!rows) return row;
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid] < row) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 영역 안에서 보이는 행들. 필터가 없으면 null(=전부). */
  private visibleRowsIn(area: Area): number[] | null {
    const rows = this.visibleRows;
    if (!rows) return null;
    const out: number[] = [];
    for (let i = this.rowOrdinal(area.top); i < rows.length && rows[i] <= area.bottom; i++) {
      out.push(rows[i]);
    }
    return out;
  }

  /** 걸러진 줄에 있는 행 번호를 가장 가까운 보이는 줄로 옮긴다. */
  private snapRow(row: number): number {
    const rows = this.visibleRows;
    if (!rows || rows.length === 0) return row;
    const i = this.rowOrdinal(row);
    if (rows[i] === row) return row;
    return rows[Math.min(i, rows.length - 1)];
  }

  /**
   * 커서가 걸러진 줄에 남아 있으면 보이는 줄로 데려온다.
   *
   * 안 보이는 칸에 커서가 있으면 **편집 상자가 아예 안 그려진다**(그 줄이 DOM에 없다).
   * 그 상태로 글자를 치면 화면에는 아무 일도 안 일어나는데 편집은 시작돼 있고,
   * 이어서 다른 칸을 누르면 빈 글자가 확정되어 **보이지도 않는 칸의 내용이 지워졌다.**
   * 그래서 필터를 걸 때와 편집을 시작할 때 커서를 화면 안으로 데려온다.
   */
  private snapCursor(): void {
    const row = this.snapRow(this.cursor.row);
    if (row !== this.cursor.row) this.cursor = { row, col: this.cursor.col };
    const anchor = this.snapRow(this.anchor.row);
    if (anchor !== this.anchor.row) this.anchor = { row: anchor, col: this.anchor.col };
  }

  /** 보이는 행을 따라 dRow만큼 움직인 행 번호. 숨은 줄은 세지 않는다. */
  private stepRow(row: number, dRow: number): number {
    const rows = this.visibleRows;
    if (!rows) return clamp(row + dRow, 0, this.maxRow);
    if (rows.length === 0) return row;
    const i = this.rowOrdinal(row);
    const onRow = rows[i] === row;
    const to = onRow ? i + dRow : dRow > 0 ? i + dRow - 1 : i + dRow;
    return rows[clamp(to, 0, rows.length - 1)];
  }

  columnFilter(col: number): ColumnFilter | undefined {
    void this.revision;
    return this.doc.sheets[this.doc.active].filter?.cols.get(col);
  }

  /**
   * 필터 메뉴에 띄울 고유값 — **다른 열의 필터가 적용된 상태**에서 모은다.
   * 그래야 목록에 뜬 값을 골랐는데 아무 행도 안 남는 일이 없다(엑셀과 같다).
   */
  filterValues(col: number): UniqueValue[] {
    void this.revision;
    const sheet = this.doc.sheets[this.doc.active];
    const used = usedRange(sheet);
    const top = Math.min(sheet.filter?.headerRows ?? guessHeaderRows(sheet), Math.max(sheet.rows - 1, 0));
    const bottom = Math.min(used.bottom, sheet.rows - 1);
    if (bottom < top) return [];

    const range: number[] = [];
    for (let r = top; r <= bottom; r++) range.push(r);

    const columns: FilterColumn[] = [];
    for (const [other, filter] of sheet.filter?.cols ?? []) {
      if (other === col) continue;
      columns.push({ filter, cells: range.map((r) => filterCellAt(sheet, r, other)) });
    }

    const rows = filterRows(range, columns);
    return uniqueValues(rows.map((r) => filterCellAt(sheet, r, col)));
  }

  /**
   * 열에 필터를 걸거나(=null이면) 푼다.
   *
   * 되돌리기에 남기지 않고 dirty도 세우지 않는다 — 필터는 셀을 하나도 바꾸지 않는
   * 뷰 상태다. 저장하지 않은 편집이 없는데 "저장 안 함"이 뜨면 그 표시가 거짓말이 된다.
   */
  setColumnFilter(col: number, filter: ColumnFilter | null): void {
    const sheet = this.doc.sheets[this.doc.active];
    const state: SheetFilter = sheet.filter ?? {
      // 머리글 줄 수는 첫 필터를 걸 때 굳힌다 — 나중에 내용이 바뀌어도 머리글은 머리글이다.
      headerRows: guessHeaderRows(sheet),
      cols: new Map(),
    };
    if (filter) state.cols.set(col, filter);
    else state.cols.delete(col);
    sheet.filter = state.cols.size > 0 ? state : undefined;
    this.touch();
    this.snapCursor();
  }

  clearFilters(): void {
    const sheet = this.doc.sheets[this.doc.active];
    if (!sheet.filter) return;
    sheet.filter = undefined;
    this.touch();
  }

  /** 선택 영역 요약(합계·평균 등). 필터가 걸려 있으면 **보이는 칸만** 센다. */
  readonly summary = $derived.by(() => {
    void this.revision;
    const sheet = this.doc.sheets[this.doc.active];
    const area = this.selection;
    let count = 0;
    let numbers = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    // 선택이 아주 넓으면 실제로 값이 있는 칸만 훑는다(A:A 전체 선택 대비).
    const wide = areaWidth(area) * areaHeight(area) > 50_000;
    const visit = (v: Scalar): void => {
      if (v === null) return;
      count++;
      if (typeof v === "number") {
        numbers++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    };

    // 걸러진 행은 화면에 없다 — 안 보이는 칸이 합계에 들어가면 그 수는 아무 데도
    // 없는 수가 된다. 세로 칸 수(rows)도 보이는 줄만 센다.
    const hidden = this.visibleRows !== null;
    let rows = areaHeight(area);

    if (wide) {
      for (const [key, cell] of sheet.cells) {
        const r = Math.floor(key / MAX_COLS);
        const c = key % MAX_COLS;
        if (r < area.top || r > area.bottom || c < area.left || c > area.right) continue;
        if (hidden && !this.isRowVisible(r)) continue;
        visit(cell.v);
      }
    } else {
      for (let r = area.top; r <= area.bottom; r++) {
        if (hidden && !this.isRowVisible(r)) continue;
        for (let c = area.left; c <= area.right; c++) visit(sheet.cells.get(cellKey(r, c))?.v ?? null);
      }
    }

    if (hidden) rows = this.visibleRowsIn(area)?.length ?? rows;

    return {
      count,
      numbers,
      sum,
      average: numbers > 0 ? sum / numbers : 0,
      min: numbers > 0 ? min : 0,
      max: numbers > 0 ? max : 0,
      rows,
      cols: areaWidth(area),
    };
  });

  // ── 변경 ──────────────────────────────────────────────────────

  touch(): void {
    this.revision++;
  }

  private flash(message: string): void {
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = "";
    }, 2400);
  }

  private snapshot(): Snapshot {
    return {
      sheets: this.doc.sheets.map(cloneSheet),
      active: this.doc.active,
      cursor: { ...this.cursor },
      anchor: { ...this.anchor },
    };
  }

  /** 되돌릴 수 있는 편집을 감싼다. 콜백이 false를 주면 지점을 남기지 않는다. */
  private mutate(change: () => boolean | void, options: { recalc?: boolean } = {}): void {
    const before = this.snapshot();
    const result = change();
    if (result === false) return;

    this.past.push(before);
    if (this.past.length > HISTORY_MAX) this.past.shift();
    this.future.length = 0;
    this.canUndo = true;
    this.canRedo = false;
    this.dirty = true;

    if (options.recalc !== false) recalculate(this.doc);
    this.touch();
  }

  private restore(snap: Snapshot): void {
    // 필터는 뷰 상태다 — 되돌리기가 되돌리는 것은 셀이지 보기 방식이 아니다.
    // (스냅샷에도 딸려 있지만, 지금 걸어 둔 것이 이긴다.)
    //
    // 다만 자리로 옮기는 것이라 **장 수가 달라졌으면 옮기지 않는다** — 장을 지운 것을
    // 되돌리면 자리가 한 칸씩 밀려서 B장의 필터가 A장에 얹힌다(엉뚱한 줄이 사라진다).
    // 그때는 스냅샷이 들고 있는 그 장의 필터를 그대로 쓴다.
    const filters = this.doc.sheets.map((s) => s.filter);
    this.doc.sheets = snap.sheets;
    if (filters.length === this.doc.sheets.length) {
      this.doc.sheets.forEach((s, i) => {
        s.filter = filters[i];
      });
    }
    this.doc.active = snap.active;
    this.cursor = snap.cursor;
    this.anchor = snap.anchor;
  }

  undo(): void {
    const snap = this.past.pop();
    if (!snap) return;
    this.future.push(this.snapshot());
    this.restore(snap);
    this.canUndo = this.past.length > 0;
    this.canRedo = true;
    this.dirty = true;
    recalculate(this.doc);
    this.touch();
    // 스냅샷의 커서가 지금 걸린 필터에서는 안 보이는 줄일 수 있다.
    this.snapCursor();
  }

  redo(): void {
    const snap = this.future.pop();
    if (!snap) return;
    this.past.push(this.snapshot());
    this.restore(snap);
    this.canUndo = true;
    this.canRedo = this.future.length > 0;
    this.dirty = true;
    recalculate(this.doc);
    this.touch();
    this.snapCursor();
  }

  // ── 선택·이동 ─────────────────────────────────────────────────

  private get maxRow(): number {
    return Math.max(this.doc.sheets[this.doc.active].rows - 1, 0);
  }

  private get maxCol(): number {
    return Math.max(this.doc.sheets[this.doc.active].cols - 1, 0);
  }

  select(row: number, col: number, extend = false): void {
    const r = clamp(row, 0, this.maxRow);
    const c = clamp(col, 0, this.maxCol);
    this.cursor = { row: r, col: c };
    if (!extend) this.anchor = { row: r, col: c };
  }

  extendTo(row: number, col: number): void {
    this.anchor = { row: clamp(row, 0, this.maxRow), col: clamp(col, 0, this.maxCol) };
  }

  /** 세로 이동은 **보이는 행**을 센다 — 걸러진 줄은 화면에 없으니 지나갈 수도 없다. */
  move(dRow: number, dCol: number, extend = false): void {
    const from = extend ? this.anchor : this.cursor;
    const row = this.stepRow(from.row, dRow);
    const col = clamp(from.col + dCol, 0, this.maxCol);
    if (extend) this.anchor = { row, col };
    else this.select(row, col);
  }

  /** Ctrl+방향 — 데이터 덩어리의 끝으로 뛴다. */
  jump(dRow: number, dCol: number, extend = false): void {
    const sheet = this.doc.sheets[this.doc.active];
    const from = extend ? this.anchor : this.cursor;
    let { row, col } = from;
    const filled = (r: number, c: number): boolean => (sheet.cells.get(cellKey(r, c))?.v ?? null) !== null;

    const startFilled = filled(row, col);
    for (let i = 0; i < 100_000; i++) {
      const nr = dRow === 0 ? row : this.stepRow(row, dRow);
      const nc = col + dCol;
      if (nc < 0 || nc > this.maxCol) break;
      // 더 갈 곳이 없으면 stepRow가 제자리를 준다.
      if (nr === row && nc === col) break;
      if (startFilled && !filled(nr, nc)) break;
      row = nr;
      col = nc;
      if (!startFilled && filled(row, col)) break;
    }
    if (extend) this.anchor = { row, col };
    else this.select(row, col);
  }

  selectAll(): void {
    const used = usedRange(this.doc.sheets[this.doc.active]);
    this.cursor = { row: 0, col: 0 };
    this.anchor = { row: used.bottom, col: used.right };
  }

  selectRow(row: number, extend = false): void {
    this.cursor = { row, col: 0 };
    this.anchor = { row: extend ? this.anchor.row : row, col: this.maxCol };
  }

  selectCol(col: number, extend = false): void {
    this.cursor = { row: 0, col };
    this.anchor = { row: this.maxRow, col: extend ? this.anchor.col : col };
  }

  // ── 셀 편집 ───────────────────────────────────────────────────

  beginEdit(initial?: string): void {
    // 걸러진 줄에서는 편집 상자가 그려지지 않는다 — 먼저 보이는 줄로 데려온다.
    this.snapCursor();
    const { row, col } = this.cursor;
    this.editing = {
      row,
      col,
      text: initial ?? this.editTextAt(row, col),
      fromTyping: initial !== undefined,
    };
  }

  cancelEdit(): void {
    this.editing = null;
  }

  /** 편집 확정. 이동 방향을 주면 확정 후 커서를 옮긴다. */
  commitEdit(text: string, move: { row: number; col: number } = { row: 1, col: 0 }): void {
    const buffer = this.editing;
    this.editing = null;
    if (!buffer) return;

    const { row, col } = buffer;
    const before = this.editTextAt(row, col);
    if (text === before) {
      this.move(move.row, move.col);
      return;
    }

    this.setCellText(row, col, text);
    this.move(move.row, move.col);
  }

  /** 셀 하나에 사람이 친 문자열을 넣는다. */
  setCellText(row: number, col: number, text: string): void {
    this.mutate(() => {
      const sheet = this.doc.sheets[this.doc.active];
      const existing = getCell(sheet, row, col);
      const style = { ...existing?.s };
      // 표시 형식이 "텍스트"(@)인 칸은 해석하지 않는다 — 전화번호 열에 010-…을
      // 다시 쳐 넣었을 때 또 수가 되면 열을 텍스트로 바꾼 뜻이 없다.
      const asText = style.numFmt === "@" && !text.trim().startsWith("=");
      const parsed: ParsedInput = asText ? { value: text === "" ? null : text } : parseInput(text);

      if (parsed.numFmt && !style.numFmt) style.numFmt = parsed.numFmt;
      // 텍스트로 되돌아가면 남아 있던 날짜 형식을 떼어 준다(1이 1900-01-01로 보이는 사고 방지).
      if (typeof parsed.value === "string" && isDateFormat(style.numFmt) && parsed.formula === undefined) {
        delete style.numFmt;
      }

      const next: Partial<Cell> = { v: parsed.value, f: parsed.formula };
      next.s = Object.keys(style).length > 0 ? style : undefined;
      putCell(sheet, row, col, next);
      if (parsed.formula) this.error = formulaError(parsed.formula) ?? "";
      else this.error = "";
    });
  }

  /** Delete — 필터가 걸려 있으면 보이는 칸만 지운다(엑셀과 같다). */
  clearSelection(): void {
    const rows = this.visibleRowsIn(this.selection);
    this.mutate(() => {
      clearContents(this.doc.sheets[this.doc.active], this.selection, rows ?? undefined);
    });
  }

  clearSelectionFormat(): void {
    this.mutate(() => {
      clearStyles(this.doc.sheets[this.doc.active], this.selection);
    }, { recalc: false });
  }

  // ── 서식 ─────────────────────────────────────────────────────

  applyFormat(patch: Partial<CellStyle>): void {
    this.mutate(() => {
      applyStyle(this.doc.sheets[this.doc.active], this.selection, patch);
    }, { recalc: false });
  }

  toggleFormat(key: "bold" | "italic" | "underline" | "strike" | "wrap"): void {
    const on = this.cursorStyle[key] === true;
    this.applyFormat({ [key]: on ? undefined : true } as Partial<CellStyle>);
  }

  setNumberFormat(code: string): void {
    this.applyFormat({ numFmt: code === "General" ? undefined : code });
    // 표시 형식이 바뀌면 날짜 물려받기 결과도 달라질 수 있어 다시 계산한다.
    recalculate(this.doc);
    this.touch();
  }

  // ── 행·열 ────────────────────────────────────────────────────

  insertRowsAt(count = 1): void {
    const at = this.selection.top;
    this.mutate(() => {
      insertRows(this.doc.sheets[this.doc.active], at, count, (f) => adjustRows(f, at, count));
    });
  }

  /**
   * 행 삭제. 필터가 걸려 있으면 **보이는 행만** 지운다 — 화면에 없던 줄이 함께
   * 사라지면 무엇을 잃었는지 볼 방법이 없다.
   */
  deleteRowsAt(): void {
    const area = this.selection;
    const visible = this.visibleRowsIn(area);
    if (visible) {
      if (visible.length === 0) return;
      this.mutate(() => {
        deleteRowSet(this.doc.sheets[this.doc.active], visible, (f, at, count) =>
          adjustRows(f, at, -count),
        );
      });
      return;
    }
    const count = areaHeight(area);
    this.mutate(() => {
      deleteRows(this.doc.sheets[this.doc.active], area.top, count, (f) =>
        adjustRows(f, area.top, -count),
      );
    });
  }

  insertColsAt(count = 1): void {
    const at = this.selection.left;
    this.mutate(() => {
      insertCols(this.doc.sheets[this.doc.active], at, count, (f) => adjustCols(f, at, count));
    });
  }

  deleteColsAt(): void {
    const area = this.selection;
    const count = areaWidth(area);
    this.mutate(() => {
      deleteCols(this.doc.sheets[this.doc.active], area.left, count, (f) =>
        adjustCols(f, area.left, -count),
      );
    });
  }

  setColWidth(col: number, px: number): void {
    this.mutate(() => {
      this.doc.sheets[this.doc.active].colWidths.set(col, clamp(Math.round(px), 24, 1200));
    }, { recalc: false });
  }

  setRowHeight(row: number, px: number): void {
    this.mutate(() => {
      this.doc.sheets[this.doc.active].rowHeights.set(row, clamp(Math.round(px), 18, 600));
    }, { recalc: false });
  }

  /** 내용에 맞춰 열 너비를 잡는다 — 글자 폭을 재는 대신 글자 수로 어림한다. */
  autoFitColumn(col: number): void {
    const sheet = this.doc.sheets[this.doc.active];
    const used = usedRange(sheet);
    let widest = 0;
    for (let r = 0; r <= used.bottom; r++) {
      const cell = sheet.cells.get(cellKey(r, col));
      if (!cell) continue;
      const text = cellText(cell);
      // 한글은 폭이 대략 두 배다.
      let units = 0;
      for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
      if (units > widest) widest = units;
    }
    this.setColWidth(col, widest === 0 ? DEFAULT_COL_WIDTH : clamp(widest * 7.4 + 18, 48, 620));
  }

  /**
   * 정렬. **언제나 행 전체를 옮긴다** — 고른 열만 재배열하면 그 옆 열과 짝이
   * 어긋나 표가 조용히 망가진다(열 머리글을 누르고 정렬하면 늘 그랬다).
   *
   * 선택이 여러 행을 덮으면 그 행들만, 아니면 머리글 아래 전체를 정렬한다.
   */
  sortRows(keys: SortKey[], headerRows: number): void {
    const sheet = this.doc.sheets[this.doc.active];
    const used = usedRange(sheet);
    const area = this.selection;
    const valid = keys.filter((k) => k.col >= 0 && k.col <= used.right);
    if (valid.length === 0) return;

    // 한 행만 고른 상태(=한 칸·한 열)는 "표 전체"라는 뜻으로 읽는다.
    const wholeTable = areaHeight(area) === 1 || (area.top <= headerRows && area.bottom >= used.bottom);
    const top = wholeTable ? Math.min(headerRows, used.bottom) : area.top;
    const bottom = wholeTable ? used.bottom : Math.min(area.bottom, used.bottom);
    if (bottom <= top) return;

    const target: Area = { top, left: 0, bottom, right: used.right };
    const widened = !wholeTable && (area.left > 0 || area.right < used.right);

    this.mutate(() => {
      sortArea(sheet, target, valid);
    });
    if (widened) this.flash(t.edit.sortWidened);
  }

  /** 도구줄의 빠른 정렬 — 커서가 놓인 열 하나를 기준으로 삼는다. */
  sortBySelection(asc: boolean): void {
    this.sortRows([{ col: this.cursor.col, asc }], this.headerRowsGuess);
  }

  /**
   * 필터 메뉴의 정렬 — 고른 영역과 무관하게 **표 전체**를 그 열로 정렬한다.
   *
   * 걸러진 행도 함께 옮긴다. 보이는 행만 정렬하면 필터를 풀었을 때 표가 뒤섞여
   * 있고(숨은 줄만 제자리), 그건 사용자가 시킨 적 없는 편집이다.
   */
  sortByColumn(col: number, asc: boolean): void {
    const sheet = this.doc.sheets[this.doc.active];
    const used = usedRange(sheet);
    const headerRows = sheet.filter?.headerRows ?? guessHeaderRows(sheet);
    const top = Math.min(headerRows, used.bottom);
    if (used.bottom <= top) return;
    this.mutate(() => {
      sortArea(sheet, { top, left: 0, bottom: used.bottom, right: used.right }, [{ col, asc }]);
    });
  }

  /** 고른 열을 텍스트로 굳힌다 — 수로 읽혀 버린 전화번호·송장번호 열의 탈출구. */
  forceSelectionText(): void {
    const sheet = this.doc.sheets[this.doc.active];
    const used = usedRange(sheet);
    const area = this.selection;
    const target: Area = {
      top: Math.min(area.top, used.bottom),
      left: area.left,
      bottom: Math.min(area.bottom, used.bottom),
      right: Math.min(area.right, used.right),
    };

    let changed = 0;
    this.mutate(() => {
      changed = forceText(sheet, target);
      if (changed === 0) return false;
    });
    if (changed > 0) this.flash(t.edit.textDone(changed));
  }

  toggleMerge(): void {
    const area = this.selection;
    const sheet = this.doc.sheets[this.doc.active];
    const existing = mergeAt(sheet, area.top, area.left);
    this.mutate(() => {
      if (existing) unmergeCells(sheet, area);
      else mergeCells(sheet, area);
    }, { recalc: false });
  }

  /**
   * 틀 고정 토글. 버튼 글자가 "고정 해제"면 반드시 풀리게 한다 —
   * 예전엔 커서 위치와 현재 고정값을 견주는 바람에, 해제라고 적힌 버튼이
   * 다른 자리에 다시 고정을 걸곤 했다.
   */
  freezeHere(): void {
    const sheet = this.doc.sheets[this.doc.active];
    const { row, col } = this.cursor;
    this.mutate(() => {
      if (sheet.frozenRows > 0 || sheet.frozenCols > 0) {
        sheet.frozenRows = 0;
        sheet.frozenCols = 0;
        return;
      }
      // A1에 커서를 둔 채 누르면 "머리글 한 줄 고정"이 거의 언제나 의도다.
      if (row === 0 && col === 0) {
        sheet.frozenRows = 1;
        sheet.frozenCols = 0;
        return;
      }
      sheet.frozenRows = row;
      sheet.frozenCols = col;
    }, { recalc: false });
  }

  // ── 시트 ─────────────────────────────────────────────────────

  switchSheet(index: number): void {
    if (index < 0 || index >= this.doc.sheets.length) return;
    this.doc.active = index;
    this.cursor = { row: 0, col: 0 };
    this.anchor = { row: 0, col: 0 };
    this.touch();
  }

  addSheet(): void {
    this.mutate(() => {
      const names = new Set(this.doc.sheets.map((s) => s.name));
      let n = this.doc.sheets.length + 1;
      while (names.has(`Sheet${n}`)) n++;
      this.doc.sheets.push(emptySheet(`Sheet${n}`));
      this.doc.active = this.doc.sheets.length - 1;
      this.cursor = { row: 0, col: 0 };
      this.anchor = { row: 0, col: 0 };
    }, { recalc: false });
  }

  duplicateSheet(index: number): void {
    this.mutate(() => {
      const source = this.doc.sheets[index];
      if (!source) return false;
      const names = new Set(this.doc.sheets.map((s) => s.name));
      let name = `${source.name} 사본`;
      let n = 2;
      while (names.has(name)) name = `${source.name} 사본 ${n++}`;
      this.doc.sheets.splice(index + 1, 0, { ...cloneSheet(source), name });
      this.doc.active = index + 1;
    });
  }

  removeSheet(index: number): void {
    if (this.doc.sheets.length <= 1) {
      this.error = t.sheets.lastOne;
      return;
    }
    this.mutate(() => {
      this.doc.sheets.splice(index, 1);
      this.doc.active = clamp(this.doc.active, 0, this.doc.sheets.length - 1);
      this.cursor = { row: 0, col: 0 };
      this.anchor = { row: 0, col: 0 };
    });
  }

  renameSheet(index: number, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (this.doc.sheets.some((s, i) => i !== index && s.name === trimmed)) {
      this.error = t.sheets.nameTaken;
      return;
    }
    this.mutate(() => {
      this.doc.sheets[index].name = trimmed;
    });
  }

  // ── 복사·붙여넣기 ────────────────────────────────────────────

  /** 복사 대상 행 — 필터가 걸려 있으면 보이는 줄만 나간다(엑셀과 같다). */
  private copyRows(area: Area): number[] {
    const visible = this.visibleRowsIn(area);
    if (visible) return visible;
    const out: number[] = [];
    for (let r = area.top; r <= area.bottom; r++) out.push(r);
    return out;
  }

  /** 선택 영역을 TSV로 — 클립보드 텍스트이자 외부 앱과의 접점. */
  private selectionAsText(): string {
    const sheet = this.doc.sheets[this.doc.active];
    const area = this.selection;
    const lines: string[] = [];
    for (const r of this.copyRows(area)) {
      const fields: string[] = [];
      for (let c = area.left; c <= area.right; c++) {
        const text = cellText(sheet.cells.get(cellKey(r, c)));
        fields.push(/[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
      }
      lines.push(fields.join("\t"));
    }
    return lines.join("\n");
  }

  async copy(): Promise<void> {
    const sheet = this.doc.sheets[this.doc.active];
    const area = this.selection;
    const rows = this.copyRows(area);
    const cells: (Cell | undefined)[][] = [];
    for (const r of rows) {
      const row: (Cell | undefined)[] = [];
      for (let c = area.left; c <= area.right; c++) row.push(sheet.cells.get(cellKey(r, c)));
      cells.push(row);
    }
    const text = this.selectionAsText();
    this.clip = { area: { ...area }, cells, rows, text };
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없어도 앱 안에서의 붙여넣기는 내부 버퍼로 계속 된다.
    }
  }

  async cut(): Promise<void> {
    await this.copy();
    this.clearSelection();
  }

  async paste(): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = this.clip?.text ?? "";
    }

    // 우리가 복사한 그대로면 수식·서식까지 살려서 붙인다.
    if (this.clip && text === this.clip.text) {
      this.pasteRich(this.clip);
      return;
    }
    if (!text) return;
    this.pastePlain(text);
  }

  private pasteRich(clip: ClipBuffer): void {
    const target = this.cursor;
    const dCol = target.col - clip.area.left;

    this.mutate(() => {
      const sheet = this.doc.sheets[this.doc.active];
      clip.cells.forEach((row, r) => {
        // 원본 행이 어디였는지로 참조를 옮긴다 — 숨은 줄을 건너뛰고 복사했으면
        // 붙는 자리와 원본 자리의 차이가 줄마다 다르다.
        const dRow = target.row + r - (clip.rows[r] ?? clip.area.top + r);
        row.forEach((cell, c) => {
          const to = { row: target.row + r, col: target.col + c };
          if (to.row > MAX_ROWS - 1 || to.col > MAX_COLS - 1) return;
          if (!cell) {
            putCell(sheet, to.row, to.col, { v: null, f: undefined, s: undefined });
            sheet.cells.delete(cellKey(to.row, to.col));
            return;
          }
          putCell(sheet, to.row, to.col, {
            v: cell.v,
            f: cell.f ? translateFormula(cell.f, dRow, dCol) : undefined,
            s: cell.s,
          });
        });
      });
      this.growTo(target.row + clip.cells.length, target.col + (clip.cells[0]?.length ?? 0));
      this.anchor = {
        row: clamp(target.row + clip.cells.length - 1, 0, MAX_ROWS - 1),
        col: clamp(target.col + (clip.cells[0]?.length ?? 1) - 1, 0, MAX_COLS - 1),
      };
    });
  }

  private pastePlain(text: string): void {
    const delimiter: Delimiter = text.includes("\t") ? "\t" : ",";
    const rows = text
      .replace(/\r\n/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => splitDelimited(line, delimiter));

    const target = this.cursor;
    this.mutate(() => {
      const sheet = this.doc.sheets[this.doc.active];
      rows.forEach((cols, r) => {
        cols.forEach((raw, c) => {
          const to = { row: target.row + r, col: target.col + c };
          if (to.row > MAX_ROWS - 1 || to.col > MAX_COLS - 1) return;
          const parsed = parseInput(raw);
          putCell(sheet, to.row, to.col, {
            v: parsed.value,
            f: parsed.formula,
            ...(parsed.numFmt ? { s: { numFmt: parsed.numFmt } } : {}),
          });
        });
      });
      this.growTo(target.row + rows.length, target.col + Math.max(...rows.map((r) => r.length), 1));
      this.anchor = {
        row: clamp(target.row + rows.length - 1, 0, MAX_ROWS - 1),
        col: clamp(target.col + Math.max(...rows.map((r) => r.length), 1) - 1, 0, MAX_COLS - 1),
      };
    });
  }

  /** 붙여넣기·채우기가 시트 밖으로 나가면 시트를 넓힌다. */
  private growTo(rows: number, cols: number): void {
    const sheet = this.doc.sheets[this.doc.active];
    if (rows + 10 > sheet.rows) sheet.rows = Math.min(MAX_ROWS, rows + 50);
    if (cols + 3 > sheet.cols) sheet.cols = Math.min(MAX_COLS, cols + 10);
  }

  /** Ctrl+D — 선택 영역의 첫 줄을 아래로 채운다. */
  fillDown(): void {
    const area = this.selection;
    if (areaHeight(area) < 2) return;
    this.mutate(() => {
      const sheet = this.doc.sheets[this.doc.active];
      for (let c = area.left; c <= area.right; c++) {
        const source = sheet.cells.get(cellKey(area.top, c));
        for (let r = area.top + 1; r <= area.bottom; r++) {
          if (!source) {
            sheet.cells.delete(cellKey(r, c));
            continue;
          }
          putCell(sheet, r, c, {
            v: source.v,
            f: source.f ? translateFormula(source.f, r - area.top, 0) : undefined,
            s: source.s,
          });
        }
      }
    });
  }

  // ── 파일 ─────────────────────────────────────────────────────

  newBook(): void {
    this.doc = emptyWorkbook();
    this.lastBytes = null;
    this.canReread = false;
    this.encodingChoice = "auto";
    this.past.length = 0;
    this.future.length = 0;
    this.canUndo = false;
    this.canRedo = false;
    this.hasFile = true;
    this.dirty = false;
    this.filename = "새 시트.csv";
    this.encoding = "UTF-8";
    this.delimiter = ",";
    this.cursor = { row: 0, col: 0 };
    this.anchor = { row: 0, col: 0 };
    this.error = "";
    this.touch();
  }

  closeBook(): void {
    this.doc = emptyWorkbook();
    this.lastBytes = null;
    this.canReread = false;
    this.encodingChoice = "auto";
    this.hasFile = false;
    this.dirty = false;
    this.filename = "";
    this.past.length = 0;
    this.future.length = 0;
    this.canUndo = false;
    this.canRedo = false;
    this.error = "";
    this.touch();
  }

  async openFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_BYTES) {
      this.error = t.file.tooBig;
      return;
    }

    this.busy = true;
    this.busyMsg = t.file.reading(file.name);
    this.error = "";

    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
        const { readXlsx } = await import("../sheet/xlsx");
        this.doc = await readXlsx(await file.arrayBuffer(), file.name);
        this.encoding = "XLSX";
        this.delimiter = ",";
      } else if (lower.endsWith(".json")) {
        const text = new TextDecoder().decode(await file.arrayBuffer());
        this.doc = {
          sheets: [readJson(text, "Sheet1")],
          active: 0,
          filename: file.name,
          origin: "json",
        };
        this.encoding = "UTF-8";
      } else if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        this.lastBytes = bytes;
        this.canReread = true;
        this.encodingChoice = "auto";
        const result = readCsv(bytes, "Sheet1", {
          delimiter: lower.endsWith(".tsv") ? "\t" : undefined,
        });
        this.doc = {
          sheets: [result.sheet],
          active: 0,
          filename: file.name,
          origin: lower.endsWith(".tsv") ? "tsv" : "csv",
        };
        this.adoptCsv(result);
      } else {
        this.error = t.file.unsupported;
        return;
      }

      if (!lower.endsWith(".csv") && !lower.endsWith(".tsv") && !lower.endsWith(".txt")) {
        this.lastBytes = null;
        this.canReread = false;
      }

      recalculate(this.doc);
      this.filename = file.name;
      this.hasFile = true;
      this.dirty = false;
      this.past.length = 0;
      this.future.length = 0;
      this.canUndo = false;
      this.canRedo = false;
      this.cursor = { row: 0, col: 0 };
      this.anchor = { row: 0, col: 0 };
      this.touch();
    } catch (e) {
      this.error = `${t.file.readFailed(file.name)} — ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
  }

  /** 읽기 결과를 화면 상태에 반영한다. 여는 경로와 다시 읽는 경로가 함께 쓴다. */
  private adoptCsv(result: CsvReadResult): void {
    this.encoding = result.encoding;
    this.delimiter = result.delimiter;
    this.csvOptions = { ...this.csvOptions, delimiter: result.delimiter };
    // 열이 하나뿐이면 구분자 추론이 빗나간 것이다 — 먼저 그 말을 해 준다.
    if (result.columns <= 1) this.flash(t.file.oneColumn);
    else if (result.preserved > 0) this.flash(t.file.preserved(result.preserved));
  }

  /**
   * 같은 바이트를 인코딩·구분자만 바꿔 다시 읽는다.
   * 판별이 한 번 빗나가면 파일을 열 방법이 아예 없어지므로 남겨 둔 손잡이다.
   * 편집분은 사라지므로 부르는 쪽에서 먼저 확인을 받는다.
   */
  reread(options: { encoding?: string; delimiter?: Delimiter } = {}): void {
    const bytes = this.lastBytes;
    if (!bytes) return;

    const encoding = options.encoding ?? this.encodingChoice;
    const delimiter = options.delimiter ?? this.delimiter;
    try {
      const result = readCsv(bytes, this.doc.sheets[0]?.name ?? "Sheet1", { encoding, delimiter });
      this.encodingChoice = encoding;
      this.doc = { ...this.doc, sheets: [result.sheet], active: 0 };
      this.adoptCsv(result);
      recalculate(this.doc);
      this.past.length = 0;
      this.future.length = 0;
      this.canUndo = false;
      this.canRedo = false;
      this.dirty = false;
      this.cursor = { row: 0, col: 0 };
      this.anchor = { row: 0, col: 0 };
      this.error = "";
      this.touch();
    } catch (e) {
      this.error = `${t.file.rereadFailed} — ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── 저장·내보내기 ────────────────────────────────────────────

  private renderer(): (row: number, col: number) => string {
    const sheet = this.doc.sheets[this.doc.active];
    return (row, col) => cellText(sheet.cells.get(cellKey(row, col)));
  }

  /**
   * 내보낼 행 — 기본은 undefined(=전부)다.
   *
   * 필터는 뷰 상태이므로 저장에는 영향을 주지 않는 것이 기본이다. 화면에서 안 보인다는
   * 이유로 파일에서 조용히 사라지면 그게 최악이다. 거르려면 저장 메뉴에서 명시적으로 켠다.
   */
  private exportRows(): number[] | undefined {
    if (!this.exportVisibleOnly) return undefined;
    return this.visibleRows ?? undefined;
  }

  saveCsv(delimiter: Delimiter = this.csvOptions.delimiter): void {
    const options = { ...this.csvOptions, delimiter };
    const rows = this.exportRows();
    const bytes = writeCsv(this.doc.sheets[this.doc.active], this.renderer(), options, rows);
    const name = withExtension(this.filename || "시트", delimiter === "\t" ? "tsv" : "csv");
    downloadBlob(new Blob([bytes as BlobPart], { type: "text/csv;charset=utf-8" }), name);
    // 일부만 내보낸 파일은 "저장했다"가 아니다 — 걸러진 줄은 아직 어느 파일에도 없다.
    // 여기서 dirty를 내리면 창을 닫을 때 브라우저가 묻지 않아 그 줄들이 그냥 사라진다.
    if (!rows) this.dirty = false;
    this.flash(t.save.saved(name));
  }

  async saveXlsx(): Promise<void> {
    this.busy = true;
    this.busyMsg = t.save.saving;
    try {
      const { writeXlsx } = await import("../sheet/xlsx");
      const bytes = await writeXlsx(this.doc);
      const name = withExtension(this.filename || "시트", "xlsx");
      downloadBlob(
        new Blob([bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        name,
      );
      this.dirty = false;
      this.flash(t.save.saved(name));
    } catch (e) {
      this.error = `${t.save.failed} — ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
  }

  saveJson(): void {
    const rows = this.exportRows();
    const text = exportText(
      this.doc.sheets[this.doc.active],
      this.renderer(),
      "json",
      { header: this.exportHeader },
      rows,
    );
    const name = withExtension(this.filename || "시트", "json");
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), name);
    if (!rows) this.dirty = false;
    this.flash(t.save.saved(name));
  }

  async copyAs(format: ExportFormat): Promise<void> {
    const text = exportText(
      this.doc.sheets[this.doc.active],
      this.renderer(),
      format,
      { header: this.exportHeader },
      this.exportRows(),
    );
    try {
      await navigator.clipboard.writeText(text);
      this.flash(t.save.copied);
    } catch {
      this.error = "클립보드에 쓸 수 없어요";
    }
  }

  // ── 찾기·바꾸기 ──────────────────────────────────────────────

  /** 찾기. 걸러진 행은 결과에서 뺀다 — 갈 수 없는 자리를 세어 주면 개수만 거짓말이 된다. */
  findMatches(query: string, matchCase: boolean): Pos[] {
    void this.revision;
    if (!query) return [];
    const sheet = this.doc.sheets[this.doc.active];
    const needle = matchCase ? query : query.toLowerCase();
    const hidden = this.visibleRows !== null;
    const found: Pos[] = [];
    for (const [key, cell] of sheet.cells) {
      const text = cellText(cell);
      const hay = matchCase ? text : text.toLowerCase();
      if (!hay.includes(needle)) continue;
      const row = Math.floor(key / MAX_COLS);
      if (hidden && !this.isRowVisible(row)) continue;
      found.push({ row, col: key % MAX_COLS });
    }
    found.sort((a, b) => a.row - b.row || a.col - b.col);
    return found;
  }

  replaceAll(query: string, replacement: string, matchCase: boolean): number {
    if (!query) return 0;
    const matches = this.findMatches(query, matchCase);
    if (matches.length === 0) {
      this.error = t.find.none;
      return 0;
    }

    let changed = 0;
    this.mutate(() => {
      const sheet = this.doc.sheets[this.doc.active];
      for (const { row, col } of matches) {
        const cell = sheet.cells.get(cellKey(row, col));
        if (!cell || cell.f) continue; // 수식 원문은 건드리지 않는다
        const text = cellText(cell);
        const next = matchCase
          ? text.split(query).join(replacement)
          : replaceInsensitive(text, query, replacement);
        if (next === text) continue;
        const parsed = parseInput(next);
        putCell(sheet, row, col, { v: parsed.value, f: parsed.formula });
        changed++;
      }
      if (changed === 0) return false;
    });

    if (changed > 0) this.flash(t.find.replaced(changed));
    return changed;
  }

  /** 열 머리글 이름 — 그리드가 부른다. */
  columnLabel(col: number): string {
    return colName(col);
  }
}

function replaceInsensitive(text: string, query: string, replacement: string): string {
  let out = "";
  let i = 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  for (;;) {
    const at = lowerText.indexOf(lowerQuery, i);
    if (at < 0) {
      out += text.slice(i);
      return out;
    }
    out += text.slice(i, at) + replacement;
    i = at + query.length;
  }
}

/** 붙여넣기용 한 줄 쪼개기 — 따옴표를 지킨다. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      out.push(field);
      field = "";
      continue;
    }
    field += ch;
  }
  out.push(field);
  return out;
}

export const editor = new EditorState();
