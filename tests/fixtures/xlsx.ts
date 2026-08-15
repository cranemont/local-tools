/** xlsx 표본 — ExcelJS로 짓는다. 읽는 쪽은 앱의 `sheet/xlsx.ts`이고 그것도 ExcelJS다.
 *
 * 공통 규약(바이너리를 커밋하지 않는다·import가 두 갈래다·같은 입력이면 같은 바이트)은
 * `tests/fixtures/pdf.ts` 머리말이 정본이다. 여기서는 이 형식만의 두 가지를 적는다.
 *
 * **바이트는 결정적이지 않다 — 푼 내용이 결정적이다.** 문서 정보 넷(`creator`·
 * `lastModifiedBy`·`created`·`modified`)은 여기서 못 박지만, ExcelJS는 zip 항목을
 * archiver로 넣으면서 **항목 시각에 실행 시각**을 박는다(`lib/xlsx/xlsx.js`의
 * `zip.append`에 date 옵션이 없다). 그래서 같은 명세로 두 번 지으면 길이는 같고
 * 바이트는 다르다. 비교는 `xlsxEntries()`로 푼 내용으로 할 것 — 그쪽은 두 실행이 같다.
 * 이 성질 자체를 `tests/sheet-roundtrip.test.ts`가 못 박는다.
 *
 * **명세는 ExcelJS 모양 그대로 받는 자리가 둘 있다**(`condFormats`·`validations`).
 * `sheet/xlsx.ts`가 읽어야 하는 것이 그 모양이라서다. 중간에 우리 타입을 한 겹 끼우면
 * 그 파일이 못 읽는 규칙(아이콘 집합 등)은 표본으로 지을 수조차 없다 — 못 읽는다는
 * 사실을 재려면 못 읽는 것을 지을 수 있어야 한다.
 */

// ExcelJS는 apps/sheet의 의존성이라 앱의 node_modules를 지목한다(앱이 쓰는 판과
// 표본이 쓰는 판을 갈라 놓지 않는다). fflate는 사정이 다르다 — 시트 앱은 fflate를
// 안 쓰고, 여기서는 xlsx가 zip이라는 사실을 확인하는 판독기로만 쓴다. 그래서
// 저장소에 이미 있는 판(apps/pdf) 하나를 빌려 온다.
import ExcelJS from "../../apps/sheet/node_modules/exceljs";
import { strFromU8, unzipSync } from "../../apps/pdf/node_modules/fflate";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyCell = any;

const EPOCH = new Date(0);

export type XlsxBorderSide = "top" | "right" | "bottom" | "left";

/** 셀 하나의 명세. 값이 없고 서식만 있는 칸도 지을 수 있다(서식만 든 칸이 읽히는가). */
export interface XlsxCellSpec {
  value?: string | number | boolean | Date | null;
  /** 수식 본문. "=" 없이 적는다. */
  formula?: string;
  /** 수식 칸에 저장된 계산 결과 — 엑셀이 파일에 함께 싣는 값이다. */
  result?: string | number | boolean | null;
  /** 엑셀 오류값("#DIV/0!" 등). */
  error?: string;
  numFmt?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  /** #rrggbb — 글자색. */
  color?: string;
  /** #rrggbb — 채우기색. */
  fill?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  borders?: XlsxBorderSide[];
  /**
   * 글자색을 **테마 번호**로 준다 — argb가 없는 색이다.
   * `sheet/xlsx.ts`가 못 푸는 갈래라 표본으로 지을 수 있어야 한다.
   */
  themeColor?: number;
}

export interface XlsxSheetSpec {
  name?: string;
  /** A1 주소 → 셀. */
  cells?: Record<string, XlsxCellSpec>;
  /** 열 이름("A") → 너비. 단위는 엑셀의 "표준 글자 수"다. */
  colWidths?: Record<string, number>;
  /** 1부터 세는 행 번호 → 높이. 단위는 포인트다. */
  rowHeights?: Record<number, number>;
  /** "A4:C4" 꼴. */
  merges?: string[];
  /** 앞 몇 행·몇 열을 고정할지. */
  freeze?: { rows?: number; cols?: number };
  hidden?: boolean;
  /** ExcelJS 모양 그대로의 조건부 서식 묶음. */
  condFormats?: { ref: string; rules: unknown[] }[];
  /** sqref("C1:C9") → ExcelJS 모양의 입력 규칙. */
  validations?: Record<string, unknown>;
}

function hexToArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function applyCell(target: AnyCell, spec: XlsxCellSpec): void {
  if (spec.formula !== undefined) {
    target.value = { formula: spec.formula, result: spec.result ?? null };
  } else if (spec.error !== undefined) {
    target.value = { error: spec.error };
  } else if (spec.value !== undefined && spec.value !== null) {
    target.value = spec.value;
  }

  if (spec.numFmt) target.numFmt = spec.numFmt;

  const font: AnyCell = {};
  if (spec.bold) font.bold = true;
  if (spec.italic) font.italic = true;
  if (spec.underline) font.underline = true;
  if (spec.strike) font.strike = true;
  if (spec.fontSize) font.size = spec.fontSize;
  if (spec.color) font.color = { argb: hexToArgb(spec.color) };
  if (spec.themeColor !== undefined) font.color = { theme: spec.themeColor };
  if (Object.keys(font).length > 0) target.font = font;

  if (spec.fill) {
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(spec.fill) } };
  }

  if (spec.align || spec.valign || spec.wrap) {
    target.alignment = {
      ...(spec.align ? { horizontal: spec.align } : {}),
      ...(spec.valign ? { vertical: spec.valign } : {}),
      ...(spec.wrap ? { wrapText: true } : {}),
    };
  }

  if (spec.borders?.length) {
    target.border = Object.fromEntries(spec.borders.map((side) => [side, { style: "thin" }]));
  }
}

/** 명세대로 xlsx 한 개. 시트를 안 주면 빈 "Sheet1" 한 장이다. */
export async function makeXlsx(sheets: XlsxSheetSpec[] = [{}]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  // 문서 정보를 안 박으면 core.xml에 실행 시각이 들어가 푼 내용까지 흔들린다.
  wb.creator = "local-tools fixture";
  wb.lastModifiedBy = "local-tools fixture";
  wb.created = EPOCH;
  wb.modified = EPOCH;

  sheets.forEach((spec, i) => {
    const freeze = spec.freeze;
    const ws: AnyCell = wb.addWorksheet(spec.name ?? `Sheet${i + 1}`, {
      views:
        freeze && ((freeze.rows ?? 0) > 0 || (freeze.cols ?? 0) > 0)
          ? [{ state: "frozen", xSplit: freeze.cols ?? 0, ySplit: freeze.rows ?? 0 }]
          : undefined,
      state: spec.hidden ? "hidden" : "visible",
    });

    for (const [address, cell] of Object.entries(spec.cells ?? {})) {
      applyCell(ws.getCell(address), cell);
    }
    for (const [col, width] of Object.entries(spec.colWidths ?? {})) {
      ws.getColumn(col).width = width;
    }
    for (const [row, height] of Object.entries(spec.rowHeights ?? {})) {
      ws.getRow(Number(row)).height = height;
    }
    for (const range of spec.merges ?? []) ws.mergeCells(range);

    const dv = ws.dataValidations?.model as Record<string, unknown> | undefined;
    if (dv) {
      for (const [sqref, rule] of Object.entries(spec.validations ?? {})) dv[sqref] = rule;
    }

    for (const group of spec.condFormats ?? []) {
      ws.addConditionalFormatting({ ref: group.ref, rules: group.rules as AnyCell });
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** `readXlsx`가 받는 모양으로. 되읽기 전에 한 번 거치는 자리다. */
export function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * zip을 풀어 "경로 → 글자". 디렉터리 항목(이름이 /로 끝나는 것)은 뺀다.
 *
 * xlsx가 zip 안의 XML 몇 장이라는 사실을 그대로 쓰는 통로다 — 우리 모델로 되읽어
 * 비교하면 쓰는 쪽과 읽는 쪽이 같은 오해를 해도 왕복이 통과한다.
 */
export function xlsxEntries(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(unzipSync(bytes))) {
    if (path.endsWith("/")) continue;
    out[path] = strFromU8(data);
  }
  return out;
}

/** 항목 하나. 없으면 던진다 — 경로 오타가 "빈 글자를 단언"으로 조용히 통과하지 않게. */
export function xlsxPart(bytes: Uint8Array, path: string): string {
  const entries = xlsxEntries(bytes);
  const part = entries[path];
  if (part === undefined) {
    throw new Error(`xlsx에 ${path}가 없다 — 있는 것: ${Object.keys(entries).join(", ")}`);
  }
  return part;
}

/** n번째 시트의 XML(1부터). 표·병합·틀고정·조건부 서식·입력 규칙이 여기 적힌다. */
export function sheetXml(bytes: Uint8Array, n = 1): string {
  return xlsxPart(bytes, `xl/worksheets/sheet${n}.xml`);
}
