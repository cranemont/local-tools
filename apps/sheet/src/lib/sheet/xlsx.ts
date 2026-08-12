/** xlsx 어댑터 — ExcelJS(MIT)를 이 파일 안에만 가둔다.
 *
 * 엔진을 여기 한 곳에 묶어 둔 이유 둘:
 *   ① ExcelJS는 압축 전 848kB다. `await import()`로 미루면 CSV만 쓰는 사람은 안 받는다.
 *   ② 더 가벼운 구현(@office-kit/xlsx 등)으로 갈아탈 때 고칠 파일이 이것뿐이다.
 *
 * 단위 환산이 두 군데 있다 — 열 너비는 "표준 글자 수", 행 높이는 포인트다.
 */

import { cellKey } from "./a1";
import { isDateFormat, toSerial } from "./serial";
import { CellError, emptySheet, type BorderSide, type Cell, type CellStyle, type MergeArea, type Scalar, type SheetDoc, type WorkbookDoc } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyCell = any;
type AnySheet = any;

/** 엑셀 열 너비(글자 수) ↔ px. 엑셀이 쓰는 근사식(맑은 고딕 11pt 기준). */
const charsToPx = (chars: number): number => Math.round(chars * 7 + 5);
const pxToChars = (px: number): number => Math.max(0, (px - 5) / 7);

/** 행 높이는 포인트. */
const ptToPx = (pt: number): number => Math.round((pt * 96) / 72);
const pxToPt = (px: number): number => (px * 72) / 96;

function argbToHex(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  const argb = (color as { argb?: string }).argb;
  if (typeof argb !== "string") return undefined; // theme·indexed 색은 못 풀어서 버린다
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : undefined;
}

function hexToArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

const SIDES: BorderSide[] = ["top", "right", "bottom", "left"];

function readStyle(cell: AnyCell): CellStyle | undefined {
  const style: CellStyle = {};

  const font = cell.font;
  if (font) {
    if (font.bold) style.bold = true;
    if (font.italic) style.italic = true;
    if (font.underline) style.underline = true;
    if (font.strike) style.strike = true;
    if (typeof font.size === "number" && font.size !== 11) style.fontSize = font.size;
    const color = argbToHex(font.color);
    if (color && color !== "#000000") style.color = color;
  }

  const fill = cell.fill;
  if (fill?.type === "pattern" && fill.pattern !== "none") {
    const bg = argbToHex(fill.fgColor);
    if (bg && bg !== "#ffffff") style.fill = bg;
  }

  const align = cell.alignment;
  if (align) {
    if (align.horizontal === "left" || align.horizontal === "center" || align.horizontal === "right") {
      style.align = align.horizontal;
    }
    if (align.vertical === "top" || align.vertical === "middle" || align.vertical === "bottom") {
      style.valign = align.vertical;
    }
    if (align.wrapText) style.wrap = true;
  }

  if (typeof cell.numFmt === "string" && cell.numFmt && cell.numFmt !== "General") {
    style.numFmt = cell.numFmt;
  }

  const border = cell.border;
  if (border) {
    const sides = SIDES.filter((side) => border[side]?.style);
    if (sides.length > 0) style.borders = sides;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function writeStyle(cell: AnyCell, style: CellStyle | undefined): void {
  if (!style) return;

  if (style.bold || style.italic || style.underline || style.strike || style.color || style.fontSize) {
    cell.font = {
      ...(style.bold ? { bold: true } : {}),
      ...(style.italic ? { italic: true } : {}),
      ...(style.underline ? { underline: true } : {}),
      ...(style.strike ? { strike: true } : {}),
      ...(style.fontSize ? { size: style.fontSize } : {}),
      ...(style.color ? { color: { argb: hexToArgb(style.color) } } : {}),
    };
  }

  if (style.fill) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(style.fill) } };
  }

  if (style.align || style.valign || style.wrap) {
    cell.alignment = {
      ...(style.align ? { horizontal: style.align } : {}),
      ...(style.valign ? { vertical: style.valign } : {}),
      ...(style.wrap ? { wrapText: true } : {}),
    };
  }

  if (style.numFmt) cell.numFmt = style.numFmt;

  if (style.borders?.length) {
    const thin = { style: "thin" as const };
    cell.border = Object.fromEntries(style.borders.map((side) => [side, thin]));
  }
}

/** ExcelJS 셀 값 → 문서 값(+ 수식). */
function readValue(raw: unknown, numFmt: string | undefined): { v: Scalar; f?: string; numFmt?: string } {
  if (raw === null || raw === undefined) return { v: null };

  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
    return { v: raw };
  }

  if (raw instanceof Date) {
    return { v: toSerial(raw), numFmt: numFmt && isDateFormat(numFmt) ? undefined : "yyyy-mm-dd" };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.formula === "string" || typeof obj.sharedFormula === "string") {
    const body = (obj.formula ?? obj.sharedFormula) as string;
    const cached = obj.result;
    const resolved = readValue(cached ?? null, numFmt);
    return { v: resolved.v, f: body.replace(/^=/, ""), numFmt: resolved.numFmt };
  }

  if (Array.isArray(obj.richText)) {
    return { v: obj.richText.map((run) => String((run as { text?: string }).text ?? "")).join("") };
  }

  if (typeof obj.text === "string") return { v: obj.text }; // 하이퍼링크
  if (typeof obj.error === "string") return { v: new CellError(obj.error as CellError["code"]) };

  if (obj.result !== undefined) return readValue(obj.result, numFmt);

  return { v: String(raw) };
}

/** xlsx 바이트 → 통합문서. */
export async function readXlsx(bytes: ArrayBuffer, filename: string): Promise<WorkbookDoc> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  const sheets: SheetDoc[] = [];

  wb.eachSheet((ws: AnySheet) => {
    const sheet = emptySheet(ws.name || `Sheet${sheets.length + 1}`);
    let maxRow = 0;
    let maxCol = 0;

    ws.eachRow({ includeEmpty: false }, (row: AnyCell, rowNumber: number) => {
      if (typeof row.height === "number") sheet.rowHeights.set(rowNumber - 1, ptToPx(row.height));
      row.eachCell({ includeEmpty: false }, (cell: AnyCell, colNumber: number) => {
        const style = readStyle(cell);
        const read = readValue(cell.value, style?.numFmt);
        if (read.v === null && read.f === undefined && !style) return;

        const merged: CellStyle | undefined = read.numFmt
          ? { ...style, numFmt: read.numFmt }
          : style;

        const entry: Cell = { v: read.v };
        if (read.f) entry.f = read.f;
        if (merged) entry.s = merged;
        sheet.cells.set(cellKey(rowNumber - 1, colNumber - 1), entry);

        if (rowNumber > maxRow) maxRow = rowNumber;
        if (colNumber > maxCol) maxCol = colNumber;
      });
    });

    ws.columns?.forEach((col: AnyCell, i: number) => {
      if (typeof col?.width === "number") sheet.colWidths.set(i, charsToPx(col.width));
    });

    // 병합 정보는 버전에 따라 모델 위치가 달라서 둘 다 본다.
    const merges: unknown =
      (ws as AnySheet).model?.merges ?? Object.keys((ws as AnySheet)._merges ?? {});
    if (Array.isArray(merges)) {
      for (const range of merges) {
        const parsed = parseMergeRange(String(range));
        if (parsed) sheet.merges.push(parsed);
      }
    }

    const view = ws.views?.[0];
    if (view?.state === "frozen") {
      sheet.frozenRows = Math.max(0, Number(view.ySplit) || 0);
      sheet.frozenCols = Math.max(0, Number(view.xSplit) || 0);
    }
    if (ws.state === "hidden" || ws.state === "veryHidden") sheet.hidden = true;

    sheet.rows = Math.max(200, maxRow + 20);
    sheet.cols = Math.max(26, maxCol + 3);
    sheets.push(sheet);
  });

  if (sheets.length === 0) sheets.push(emptySheet("Sheet1"));
  return { sheets, active: 0, filename, origin: "xlsx" };
}

const MERGE_RE = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i;

function parseMergeRange(text: string): MergeArea | null {
  const m = MERGE_RE.exec(text.replace(/\$/g, "").split("!").pop() ?? "");
  if (!m) return null;
  const col = (name: string): number => {
    let n = 0;
    for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const top = Number(m[2]) - 1;
  const bottom = Number(m[4]) - 1;
  const left = col(m[1]);
  const right = col(m[3]);
  return { top: Math.min(top, bottom), left: Math.min(left, right), bottom: Math.max(top, bottom), right: Math.max(left, right) };
}

/** 통합문서 → xlsx 바이트. */
export async function writeXlsx(book: WorkbookDoc): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "local-tools 시트";
  wb.created = new Date();

  for (const sheet of book.sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views:
        sheet.frozenRows > 0 || sheet.frozenCols > 0
          ? [{ state: "frozen", xSplit: sheet.frozenCols, ySplit: sheet.frozenRows }]
          : undefined,
      state: sheet.hidden ? "hidden" : "visible",
    });

    for (const [key, cell] of sheet.cells) {
      const row = Math.floor(key / 16_384) + 1;
      const col = (key % 16_384) + 1;
      const target = ws.getCell(row, col);

      if (cell.f) {
        target.value = { formula: cell.f, result: toExcelValue(cell) };
      } else {
        target.value = toExcelValue(cell);
      }
      writeStyle(target, cell.s);
    }

    for (const [col, px] of sheet.colWidths) {
      ws.getColumn(col + 1).width = pxToChars(px);
    }
    for (const [row, px] of sheet.rowHeights) {
      ws.getRow(row + 1).height = pxToPt(px);
    }
    for (const m of sheet.merges) {
      try {
        ws.mergeCells(m.top + 1, m.left + 1, m.bottom + 1, m.right + 1);
      } catch {
        // 겹치는 병합은 엑셀도 거부한다 — 그 한 건만 버리고 계속한다.
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** 문서 값 → ExcelJS가 받는 값. 오류는 엑셀 오류 객체로 나간다. */
function toExcelValue(cell: Cell): AnyCell {
  const v = cell.v;
  if (v === null) return null;
  if (v instanceof CellError) return { error: v.code };
  return v;
}
