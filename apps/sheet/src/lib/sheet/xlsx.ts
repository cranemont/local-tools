/** xlsx 어댑터 — ExcelJS(MIT)를 이 파일 안에만 가둔다.
 *
 * 엔진을 여기 한 곳에 묶어 둔 이유 둘:
 *   ① ExcelJS는 압축 전 848kB다. `await import()`로 미루면 CSV만 쓰는 사람은 안 받는다.
 *   ② 더 가벼운 구현(@office-kit/xlsx 등)으로 갈아탈 때 고칠 파일이 이것뿐이다.
 *
 * 단위 환산이 두 군데 있다 — 열 너비는 "표준 글자 수", 행 높이는 포인트다.
 */

import { cellKey, cellName, colName, formatArea, parseArea, parseRef, type Area } from "./a1";
import {
  compareArity,
  isStyled,
  newRuleId,
  type CompareOp,
  type CondPoint,
  type CondRule,
  type CondStyle,
  type ScaleStop,
} from "./condformat";
import { operandOf } from "./filter";
import { isDateFormat, toSerial } from "./serial";
import {
  fromXlsxValidation,
  packAreas,
  toXlsxValidation,
  type ValidationRange,
} from "./validation";
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

/** 읽기 결과 — 통합문서와, 옮겨 적지 못한 것의 수. */
export interface XlsxRead {
  book: WorkbookDoc;
  /** 우리에게 없는 종류라 못 읽은 조건부 서식 규칙 수(아이콘 집합·기간 등). */
  condSkipped: number;
}

/** xlsx 바이트 → 통합문서. */
export async function readXlsx(bytes: ArrayBuffer, filename: string): Promise<XlsxRead> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  const sheets: SheetDoc[] = [];
  let condSkipped = 0;

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

    const validations = readValidations(ws);
    if (validations.length > 0) sheet.validations = validations;

    const cond = condRulesFromXlsx(
      Array.isArray((ws as AnySheet).conditionalFormattings) ? (ws as AnySheet).conditionalFormattings : [],
    );
    if (cond.rules.length > 0) sheet.condFormats = cond.rules;
    condSkipped += cond.skipped;

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
  return { book: { sheets, active: 0, filename, origin: "xlsx" }, condSkipped };
}

/**
 * 입력 규칙 읽기 — ExcelJS는 sqref를 **칸마다 펼쳐서** 준다("A1:A9"이면 아홉 칸이
 * 같은 규칙 객체를 가리킨다). 그래서 객체가 같은 칸끼리 모아 직사각형으로 접는다.
 * 접지 않으면 한 열짜리 규칙이 범위 만 개가 되어 칸을 그릴 때마다 그 목록을 훑게 된다.
 */
function readValidations(ws: AnySheet): ValidationRange[] {
  const model = ws.dataValidations?.model as Record<string, unknown> | undefined;
  if (!model) return [];

  const groups = new Map<unknown, { row: number; col: number }[]>();
  const out: ValidationRange[] = [];

  for (const [address, dv] of Object.entries(model)) {
    if (!dv) continue;
    if (address.includes(":")) {
      // 범위 그대로 온 경우(우리가 쓴 파일을 다시 읽을 때).
      const area = parseArea(address);
      const rule = fromXlsxValidation(dv);
      if (area && rule) out.push({ area, rule });
      continue;
    }
    const at = parseRef(address);
    if (!at) continue;
    const list = groups.get(dv);
    if (list) list.push({ row: at.row, col: at.col });
    else groups.set(dv, [{ row: at.row, col: at.col }]);
  }

  for (const [dv, cells] of groups) {
    const rule = fromXlsxValidation(dv);
    if (!rule) continue;
    for (const area of packAreas(cells)) out.push({ area, rule });
  }
  return out;
}

// ── 조건부 서식 ─────────────────────────────────────────────────
//
// ExcelJS는 조건부 서식을 읽고 쓴다(`ws.conditionalFormattings`) — dxf 서식까지
// 왕복한다. 다만 옮겨 적을 수 있는 규칙 종류가 서로 다르다:
//   · 우리 규칙은 전부 엑셀 규칙으로 나간다(중복·고유와 일부 글자 조건은 수식 규칙으로).
//   · 반대로 엑셀에서 온 규칙 중 아이콘 집합·평균 위/아래·기간처럼 우리에게 없는 것은
//     못 읽는다. 그 수를 세어 화면에 알린다(`XlsxRead.condSkipped`) — 조용히 잃으면
//     저장할 때 파일에서 사라진다.
//   · **"참이면 중지"는 왕복하지 않는다.** ExcelJS가 stopIfTrue 속성을 쓰지도 읽지도
//     않는다(cf-rule-xform). 알려진 한계다.

const CELL_IS_OPS: Record<string, CompareOp> = {
  equal: "eq",
  notEqual: "ne",
  greaterThan: "gt",
  greaterThanOrEqual: "gte",
  lessThan: "lt",
  lessThanOrEqual: "lte",
  between: "between",
  notBetween: "notBetween",
};

const XLSX_OPS: Record<CompareOp, string> = {
  eq: "equal",
  ne: "notEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual",
  between: "between",
  notBetween: "notBetween",
};

/** 문자열 하나를 엑셀 수식 리터럴로. */
function quoteLiteral(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function unquoteLiteral(text: string): string {
  return text.replace(/""/g, '"');
}

/** 비교값 → 엑셀 수식에 적히는 글자. 수·불리언은 그대로, 나머지는 따옴표를 두른다. */
function condLiteral(text: string): string {
  const value = operandOf(text);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return quoteLiteral(text.trim());
}

function condPointFrom(cfvo: AnyCell): CondPoint {
  const value = typeof cfvo?.value === "number" ? cfvo.value : undefined;
  switch (cfvo?.type) {
    case "num":
      return { type: "num", value: value ?? 0 };
    case "percent":
      return { type: "percent", value: value ?? 0 };
    case "percentile":
      return { type: "percentile", value: value ?? 50 };
    case "max":
    case "autoMax":
      return { type: "max" };
    default:
      return { type: "min" };
  }
}

function condPointTo(point: CondPoint): AnyCell {
  if (point.type === "min" || point.type === "max") return { type: point.type };
  return { type: point.type, value: point.value ?? 0 };
}

function condStyleFrom(raw: unknown): CondStyle {
  // 색조·막대 규칙에는 dxf 서식이 없다 — 색이 값에서 나오기 때문이다.
  if (!raw || typeof raw !== "object") return {};
  const style = readStyle(raw as AnyCell);
  if (!style) return {};
  return {
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.fill ? { fill: style.fill } : {}),
  };
}

function condStyleTo(style: CondStyle): AnyCell {
  const dxf: AnyCell = {};
  writeStyle(dxf, style);
  return dxf;
}

/** 우리가 쓴 수식 규칙을 되읽는다. 엑셀이 쓴 다른 수식은 알아보지 못한다(그건 못 읽음으로 센다). */
const EXPR_PATTERNS: { re: RegExp; make: (m: RegExpExecArray) => Partial<CondRule> | null }[] = [
  { re: /^ISERROR\(SEARCH\("(.*)",[^)]*\)\)$/, make: (m) => ({ kind: "text", op: "notContains", value: unquoteLiteral(m[1]) } as Partial<CondRule>) },
  { re: /^LEFT\([^,]+,\d+\)="(.*)"$/, make: (m) => ({ kind: "text", op: "startsWith", value: unquoteLiteral(m[1]) } as Partial<CondRule>) },
  { re: /^RIGHT\([^,]+,\d+\)="(.*)"$/, make: (m) => ({ kind: "text", op: "endsWith", value: unquoteLiteral(m[1]) } as Partial<CondRule>) },
  { re: /^COUNTIF\(.+,.+\)>1$/, make: () => ({ kind: "dup", op: "duplicate" } as Partial<CondRule>) },
  { re: /^COUNTIF\(.+,.+\)=1$/, make: () => ({ kind: "dup", op: "unique" } as Partial<CondRule>) },
];

function fromXlsxCondRule(raw: AnyCell, range: Area): CondRule | null {
  const id = newRuleId();
  const style = condStyleFrom(raw.style);
  const formula = String(raw.formulae?.[0] ?? "");

  switch (raw.type) {
    case "cellIs": {
      const op = CELL_IS_OPS[String(raw.operator)];
      if (!op) return null;
      const value = String(raw.formulae?.[0] ?? "").replace(/^"|"$/g, "");
      const value2 = String(raw.formulae?.[1] ?? "").replace(/^"|"$/g, "");
      return { id, range, kind: "compare", op, value: unquoteLiteral(value), value2: unquoteLiteral(value2), style };
    }
    case "containsText": {
      if (raw.operator === "containsBlanks") return { id, range, kind: "blank", op: "blank", style };
      if (raw.operator === "notContainsBlanks") return { id, range, kind: "blank", op: "notBlank", style };
      if (raw.operator !== "containsText") return null;
      const text = typeof raw.text === "string" ? raw.text : (/SEARCH\("(.*)",/.exec(formula)?.[1] ?? "");
      return { id, range, kind: "text", op: "contains", value: unquoteLiteral(text), style };
    }
    case "top10":
      return {
        id,
        range,
        kind: "rank",
        op: raw.bottom ? "bottom" : "top",
        n: Math.max(1, Number(raw.rank) || 10),
        percent: raw.percent === true,
        style,
      };
    case "duplicateValues":
      return { id, range, kind: "dup", op: "duplicate", style };
    case "uniqueValues":
      return { id, range, kind: "dup", op: "unique", style };
    case "colorScale": {
      const cfvo: AnyCell[] = Array.isArray(raw.cfvo) ? raw.cfvo : [];
      const colors: AnyCell[] = Array.isArray(raw.color) ? raw.color : [];
      if (cfvo.length < 2 || colors.length < 2) return null;
      const stops: ScaleStop[] = [];
      for (let i = 0; i < Math.min(cfvo.length, colors.length); i++) {
        stops.push({ at: condPointFrom(cfvo[i]), color: argbToHex(colors[i]) ?? "#ffffff" });
      }
      return { id, range, kind: "scale", stops };
    }
    case "dataBar": {
      const cfvo: AnyCell[] = Array.isArray(raw.cfvo) ? raw.cfvo : [];
      if (cfvo.length < 2) return null;
      return {
        id,
        range,
        kind: "bar",
        color: argbToHex(raw.color) ?? "#638ec6",
        min: condPointFrom(cfvo[0]),
        max: condPointFrom(cfvo[1]),
      };
    }
    case "expression": {
      for (const { re, make } of EXPR_PATTERNS) {
        const m = re.exec(formula);
        if (!m) continue;
        const part = make(m);
        if (part) return { id, range, style, ...part } as CondRule;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * ExcelJS 모델의 조건부 서식 목록 → 우리 규칙. 못 옮긴 규칙 수도 함께 준다.
 *
 * 시트가 아니라 목록을 받는다 — 이 변환이 이 파일에서 유일하게 엑셀 파일 없이
 * 시험할 수 있는 조각이라서다(tests/sheet-condformat.test.ts).
 */
export function condRulesFromXlsx(groups: unknown[]): { rules: CondRule[]; skipped: number } {
  const found: { at: number; rule: CondRule }[] = [];
  let skipped = 0;

  for (const entry of groups) {
    const group = entry as AnyCell;
    // sqref는 "A1:C9" 하나일 수도, 공백으로 이어 붙인 여러 개일 수도 있다.
    const areas = String(group?.ref ?? "")
      .split(/\s+/)
      .map((part) => parseArea(part.replace(/\$/g, "")))
      .filter((area): area is Area => area !== null);
    const rules: unknown[] = Array.isArray(group.rules) ? group.rules : [];
    if (areas.length === 0) {
      // 범위를 못 읽으면 규칙도 못 건다. 여기서 조용히 넘기면 저장할 때 파일에서
      // 사라지므로 못 읽은 수에 넣는다(엑셀은 "A:A" 같은 온열 범위도 쓴다).
      skipped += rules.length;
      continue;
    }

    for (const raw of rules as AnyCell[]) {
      let made = 0;
      for (const area of areas) {
        const rule = fromXlsxCondRule(raw, area);
        if (!rule) break;
        found.push({ at: Number(raw.priority) || found.length + 1, rule });
        made++;
      }
      if (made === 0) skipped++;
    }
  }

  // 순위 번호가 작을수록 앞이다 — 목록 순서가 곧 우리 우선순위다.
  found.sort((a, b) => a.at - b.at);
  return { rules: found.map((entry) => entry.rule), skipped };
}

/** 범위 → "$A$1:$C$9". 수식 규칙 안에서 범위를 가리킬 때 쓴다(붙는 칸마다 밀리면 안 된다). */
function absoluteRange(area: Area): string {
  return `$${colName(area.left)}$${area.top + 1}:$${colName(area.right)}$${area.bottom + 1}`;
}

/**
 * 우리 규칙 → ExcelJS 규칙 하나.
 *
 * 수식 규칙(`expression`)의 기준 칸은 **범위의 왼쪽 위**다 — 엑셀이 나머지 칸에는
 * 그만큼 밀어서 적용한다.
 */
function toXlsxCondRule(rule: CondRule): AnyCell {
  const style = isStyled(rule) ? condStyleTo(rule.style) : undefined;
  const head = cellName(rule.range.top, rule.range.left);

  switch (rule.kind) {
    case "compare": {
      const formulae = [condLiteral(rule.value)];
      if (compareArity(rule.op) === 2) formulae.push(condLiteral(rule.value2 ?? ""));
      return { type: "cellIs", operator: XLSX_OPS[rule.op], formulae, style };
    }
    case "text": {
      const text = rule.value;
      if (rule.op === "contains") {
        return { type: "containsText", operator: "containsText", text, style };
      }
      const quoted = quoteLiteral(text);
      const formula =
        rule.op === "notContains"
          ? `ISERROR(SEARCH(${quoted},${head}))`
          : rule.op === "startsWith"
            ? `LEFT(${head},${text.length})=${quoted}`
            : `RIGHT(${head},${text.length})=${quoted}`;
      return { type: "expression", formulae: [formula], style };
    }
    case "blank":
      return {
        type: "containsText",
        operator: rule.op === "blank" ? "containsBlanks" : "notContainsBlanks",
        style,
      };
    case "dup": {
      // 엑셀의 duplicateValues는 ExcelJS가 **쓰지 못한다**(렌더 분기가 없어 조용히 빠진다).
      // 같은 뜻의 수식 규칙으로 내보내면 엑셀에서도 같게 보이고 되읽기도 된다.
      const formula = `COUNTIF(${absoluteRange(rule.range)},${head})${rule.op === "duplicate" ? ">1" : "=1"}`;
      return { type: "expression", formulae: [formula], style };
    }
    case "rank":
      return {
        type: "top10",
        rank: rule.n,
        percent: rule.percent,
        bottom: rule.op === "bottom",
        style,
      };
    case "scale":
      return {
        type: "colorScale",
        cfvo: rule.stops.map((stop) => condPointTo(stop.at)),
        color: rule.stops.map((stop) => ({ argb: hexToArgb(stop.color) })),
      };
    case "bar":
      return {
        type: "dataBar",
        cfvo: [condPointTo(rule.min), condPointTo(rule.max)],
        color: { argb: hexToArgb(rule.color) },
      };
  }
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

    // 입력 규칙 — 범위를 키로 넣으면 ExcelJS가 그 sqref를 그대로 쓴다(칸마다 넣지 않는다).
    // 엑셀이 모르는 것은 여기서 빠진다: 위반 시 동작은 errorStyle(거부=stop·경고=warning)로만
    // 남고, 값이 덜 적힌 규칙은 아예 안 나간다(toXlsxValidation이 null을 준다).
    const dvModel = (ws as AnySheet).dataValidations?.model as Record<string, unknown> | undefined;
    if (dvModel) {
      for (const entry of sheet.validations ?? []) {
        const dv = toXlsxValidation(entry.rule);
        if (dv) dvModel[formatArea(entry.area)] = dv;
      }
    }

    // 조건부 서식 — 규칙마다 따로 넣는다. ExcelJS가 넣은 차례대로 우선순위 번호를
    // 매기므로(1, 2, 3…) 우리 목록 순서가 그대로 엑셀의 순위가 된다.
    for (const rule of sheet.condFormats ?? []) {
      ws.addConditionalFormatting({
        ref: formatArea(rule.range),
        rules: [toXlsxCondRule(rule) as AnyCell],
      });
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
