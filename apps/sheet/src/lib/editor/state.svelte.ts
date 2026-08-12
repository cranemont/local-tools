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
  type CsvWriteOptions,
  type Delimiter,
} from "../sheet/csv";
import { exportText, readJson, type ExportFormat } from "../sheet/convert";
import {
  applyStyle,
  clearContents,
  clearStyles,
  colWidth,
  deleteCols,
  deleteRows,
  getCell,
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
} from "../sheet/model";
import { formatValue } from "../sheet/numfmt";
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

  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private clip: ClipBuffer | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** 화면에 보이는 문자열(표시 형식 적용 후). */
  displayAt(row: number, col: number): string {
    const cell = this.cellAt(row, col);
    if (!cell) return "";
    return formatValue(cell.v, cell.s?.numFmt);
  }

  /** 수식 입력줄에 넣을 문자열 — 수식이면 원문, 아니면 편집 가능한 원값. */
  editTextAt(row: number, col: number): string {
    const cell = this.cellAt(row, col);
    if (!cell) return "";
    if (cell.f) return `=${cell.f}`;
    if (cell.v === null) return "";
    if (isError(cell.v)) return cell.v.code;
    if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
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

  /** 선택 영역 요약(합계·평균 등). */
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

    if (wide) {
      for (const [key, cell] of sheet.cells) {
        const r = Math.floor(key / MAX_COLS);
        const c = key % MAX_COLS;
        if (r < area.top || r > area.bottom || c < area.left || c > area.right) continue;
        visit(cell.v);
      }
    } else {
      for (let r = area.top; r <= area.bottom; r++) {
        for (let c = area.left; c <= area.right; c++) visit(sheet.cells.get(cellKey(r, c))?.v ?? null);
      }
    }

    return {
      count,
      numbers,
      sum,
      average: numbers > 0 ? sum / numbers : 0,
      min: numbers > 0 ? min : 0,
      max: numbers > 0 ? max : 0,
      rows: areaHeight(area),
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
    this.doc.sheets = snap.sheets;
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

  move(dRow: number, dCol: number, extend = false): void {
    const from = extend ? this.anchor : this.cursor;
    const row = clamp(from.row + dRow, 0, this.maxRow);
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
      const nr = row + dRow;
      const nc = col + dCol;
      if (nr < 0 || nc < 0 || nr > this.maxRow || nc > this.maxCol) break;
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
      const parsed = parseInput(text);
      const existing = getCell(sheet, row, col);
      const style = { ...existing?.s };

      if (parsed.numFmt && !style.numFmt) style.numFmt = parsed.numFmt;
      // 텍스트로 되돌아가면 남아 있던 날짜 형식을 떼어 준다(1이 1900-01-01로 보이는 사고 방지).
      if (typeof parsed.value === "string" && style.numFmt && parsed.formula === undefined) {
        delete style.numFmt;
      }

      const next: Partial<Cell> = { v: parsed.value, f: parsed.formula };
      next.s = Object.keys(style).length > 0 ? style : undefined;
      putCell(sheet, row, col, next);
      if (parsed.formula) this.error = formulaError(parsed.formula) ?? "";
      else this.error = "";
    });
  }

  clearSelection(): void {
    this.mutate(() => {
      clearContents(this.doc.sheets[this.doc.active], this.selection);
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

  deleteRowsAt(): void {
    const area = this.selection;
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
      const text = formatValue(cell.v, cell.s?.numFmt);
      // 한글은 폭이 대략 두 배다.
      let units = 0;
      for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
      if (units > widest) widest = units;
    }
    this.setColWidth(col, widest === 0 ? DEFAULT_COL_WIDTH : clamp(widest * 7.4 + 18, 48, 620));
  }

  sortBySelection(asc: boolean): void {
    const area = this.selection;
    const sheet = this.doc.sheets[this.doc.active];
    // 한 칸만 골랐으면 그 열이 속한 데이터 덩어리 전체를 정렬한다(머리글은 빼고).
    const single = areaWidth(area) === 1 && areaHeight(area) === 1;
    const used = usedRange(sheet);
    const target: Area = single
      ? { top: sheet.frozenRows, left: 0, bottom: used.bottom, right: used.right }
      : area;
    if (target.bottom <= target.top) return;

    this.mutate(() => {
      sortArea(sheet, target, this.cursor.col, asc);
    });
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

  /** 선택 영역을 TSV로 — 클립보드 텍스트이자 외부 앱과의 접점. */
  private selectionAsText(): string {
    const sheet = this.doc.sheets[this.doc.active];
    const area = this.selection;
    const lines: string[] = [];
    for (let r = area.top; r <= area.bottom; r++) {
      const fields: string[] = [];
      for (let c = area.left; c <= area.right; c++) {
        const cell = sheet.cells.get(cellKey(r, c));
        const text = formatValue(cell?.v ?? null, cell?.s?.numFmt);
        fields.push(/[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
      }
      lines.push(fields.join("\t"));
    }
    return lines.join("\n");
  }

  async copy(): Promise<void> {
    const sheet = this.doc.sheets[this.doc.active];
    const area = this.selection;
    const cells: (Cell | undefined)[][] = [];
    for (let r = area.top; r <= area.bottom; r++) {
      const row: (Cell | undefined)[] = [];
      for (let c = area.left; c <= area.right; c++) row.push(sheet.cells.get(cellKey(r, c)));
      cells.push(row);
    }
    const text = this.selectionAsText();
    this.clip = { area: { ...area }, cells, text };
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
    const dRow = target.row - clip.area.top;
    const dCol = target.col - clip.area.left;

    this.mutate(() => {
      const sheet = this.doc.sheets[this.doc.active];
      clip.cells.forEach((row, r) => {
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
        const result = readCsv(bytes, "Sheet1", lower.endsWith(".tsv") ? "\t" : undefined);
        this.doc = {
          sheets: [result.sheet],
          active: 0,
          filename: file.name,
          origin: lower.endsWith(".tsv") ? "tsv" : "csv",
        };
        this.encoding = result.encoding;
        this.delimiter = result.delimiter;
        this.csvOptions = { ...this.csvOptions, delimiter: result.delimiter };
      } else {
        this.error = t.file.unsupported;
        return;
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

  // ── 저장·내보내기 ────────────────────────────────────────────

  private renderer(): (row: number, col: number) => string {
    const sheet = this.doc.sheets[this.doc.active];
    return (row, col) => {
      const cell = sheet.cells.get(cellKey(row, col));
      return cell ? formatValue(cell.v, cell.s?.numFmt) : "";
    };
  }

  saveCsv(delimiter: Delimiter = this.csvOptions.delimiter): void {
    const options = { ...this.csvOptions, delimiter };
    const bytes = writeCsv(this.doc.sheets[this.doc.active], this.renderer(), options);
    const name = withExtension(this.filename || "시트", delimiter === "\t" ? "tsv" : "csv");
    downloadBlob(new Blob([bytes as BlobPart], { type: "text/csv;charset=utf-8" }), name);
    this.dirty = false;
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
    const text = exportText(this.doc.sheets[this.doc.active], this.renderer(), "json", {
      header: this.exportHeader,
    });
    const name = withExtension(this.filename || "시트", "json");
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), name);
    this.dirty = false;
    this.flash(t.save.saved(name));
  }

  async copyAs(format: ExportFormat): Promise<void> {
    const text = exportText(this.doc.sheets[this.doc.active], this.renderer(), format, {
      header: this.exportHeader,
    });
    try {
      await navigator.clipboard.writeText(text);
      this.flash(t.save.copied);
    } catch {
      this.error = "클립보드에 쓸 수 없어요";
    }
  }

  // ── 찾기·바꾸기 ──────────────────────────────────────────────

  findMatches(query: string, matchCase: boolean): Pos[] {
    void this.revision;
    if (!query) return [];
    const sheet = this.doc.sheets[this.doc.active];
    const needle = matchCase ? query : query.toLowerCase();
    const found: Pos[] = [];
    for (const [key, cell] of sheet.cells) {
      const text = formatValue(cell.v, cell.s?.numFmt);
      const hay = matchCase ? text : text.toLowerCase();
      if (hay.includes(needle)) found.push({ row: Math.floor(key / MAX_COLS), col: key % MAX_COLS });
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
        const text = formatValue(cell.v, cell.s?.numFmt);
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
