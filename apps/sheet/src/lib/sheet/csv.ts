/** CSV/TSV 읽고 쓰기 — 인코딩 추정, 구분자 추론, RFC 4180 파싱.
 *
 * 한국에서 받는 CSV는 절반이 cp949다. 그래서 "UTF-8로 엄격하게 읽어 보고 실패하면
 * euc-kr"이라는 순서를 쓴다. TextDecoder가 두 인코딩을 모두 네이티브로 알고 있어서
 * 라이브러리가 필요 없다(크로미엄 전제).
 */

import { cellKey } from "./a1";
import { parseInput } from "./model";
import { emptySheet, type Cell, type SheetDoc } from "./types";

export type Delimiter = "," | "\t" | ";" | "|";

export interface CsvReadResult {
  sheet: SheetDoc;
  encoding: string;
  delimiter: Delimiter;
  /** 첫 줄을 머리글로 볼 만한가 — 자동 굵게 처리에 쓴다. */
  headerLikely: boolean;
}

export interface CsvWriteOptions {
  delimiter: Delimiter;
  /** 엑셀이 UTF-8 CSV를 열 때 BOM이 없으면 한글이 깨진다. 기본은 붙이는 쪽. */
  bom: boolean;
  /** 수식 셀을 원문(=SUM(...))으로 쓸지, 계산된 값으로 쓸지. */
  formulas: boolean;
  newline: "\n" | "\r\n";
}

export const DEFAULT_CSV_WRITE: CsvWriteOptions = {
  delimiter: ",",
  bom: true,
  formulas: false,
  newline: "\r\n",
};

/** 바이트를 글자로. BOM을 먼저 보고, 없으면 UTF-8 → cp949 순으로 시도한다. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16LE" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16BE" };
  }

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    // euc-kr 디코더는 cp949(확장 완성형)까지 받아 준다.
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "CP949" };
  }
}

const CANDIDATES: Delimiter[] = [",", "\t", ";", "|"];

/** 구분자 추론 — 따옴표 밖에서 줄마다 개수가 가장 일정한 후보를 고른다. */
export function sniffDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64 * 1024);
  let best: Delimiter = ",";
  let bestScore = -1;

  for (const cand of CANDIDATES) {
    const counts: number[] = [];
    let quote = false;
    let current = 0;
    let lines = 0;

    for (let i = 0; i < sample.length && lines < 40; i++) {
      const ch = sample[i];
      if (ch === '"') {
        if (quote && sample[i + 1] === '"') i++;
        else quote = !quote;
        continue;
      }
      if (quote) continue;
      if (ch === cand) current++;
      else if (ch === "\n") {
        counts.push(current);
        current = 0;
        lines++;
      }
    }
    if (current > 0 || counts.length === 0) counts.push(current);

    const used = counts.filter((c) => c > 0);
    if (used.length === 0) continue;
    // 일관된 열 수 = 좋은 구분자. 편차가 클수록 감점.
    const mean = used.reduce((a, b) => a + b, 0) / used.length;
    const variance = used.reduce((a, b) => a + (b - mean) ** 2, 0) / used.length;
    const score = mean * used.length - variance * 4;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/** RFC 4180 파싱. 따옴표 안의 구분자·줄바꿈·""를 지킨다. */
export function parseRows(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = (): void => {
    row.push(field);
    field = "";
    started = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    field += ch;
    started = true;
  }

  // 마지막 줄에 개행이 없으면 남은 것을 마저 담는다(빈 꼬리는 버린다).
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** 첫 줄이 머리글처럼 생겼나 — 전부 글자이고, 둘째 줄에 수가 하나라도 있으면 그렇다고 본다. */
function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const head = rows[0];
  const body = rows[1];
  if (head.length === 0 || head.every((c) => c.trim() === "")) return false;
  const headAllText = head.every((c) => c.trim() !== "" && Number.isNaN(Number(c.replace(/,/g, ""))));
  const bodyHasNumber = body.some((c) => c.trim() !== "" && !Number.isNaN(Number(c.replace(/,/g, ""))));
  return headAllText && bodyHasNumber;
}

/** 텍스트 → 시트. 값 해석(수·날짜·불리언)은 parseInput과 같은 규칙을 쓴다. */
export function readCsv(bytes: Uint8Array, name = "Sheet1", forced?: Delimiter): CsvReadResult {
  const { text, encoding } = decodeText(bytes);
  const delimiter = forced ?? sniffDelimiter(text);
  const rows = parseRows(text, delimiter);
  const headerLikely = looksLikeHeader(rows);

  const sheet = emptySheet(name, Math.max(200, rows.length + 20), 26);
  let maxCols = 0;

  for (let r = 0; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length > maxCols) maxCols = cols.length;
    for (let c = 0; c < cols.length; c++) {
      const raw = cols[c];
      if (raw === "") continue;
      const parsed = parseInput(raw);
      const cell: Cell = { v: parsed.value };
      if (parsed.formula) cell.f = parsed.formula;
      if (parsed.numFmt) cell.s = { numFmt: parsed.numFmt };
      if (headerLikely && r === 0) cell.s = { ...cell.s, bold: true };
      sheet.cells.set(cellKey(r, c), cell);
    }
  }

  sheet.cols = Math.max(26, maxCols + 3);
  if (headerLikely) sheet.frozenRows = 1;
  return { sheet, encoding, delimiter, headerLikely };
}

function quoteField(text: string, delimiter: Delimiter): string {
  const needs =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    text !== text.trim();
  return needs ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 시트 → CSV 바이트. 화면에 보이는 문자열(표시 형식 적용 후)로 내보낸다. */
export function writeCsv(
  sheet: SheetDoc,
  render: (row: number, col: number) => string,
  options: CsvWriteOptions = DEFAULT_CSV_WRITE,
): Uint8Array {
  let bottom = -1;
  let right = -1;
  for (const key of sheet.cells.keys()) {
    const r = Math.floor(key / 16_384);
    const c = key % 16_384;
    if (r > bottom) bottom = r;
    if (c > right) right = c;
  }

  const lines: string[] = [];
  for (let r = 0; r <= bottom; r++) {
    const fields: string[] = [];
    for (let c = 0; c <= right; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      const text = options.formulas && cell?.f ? `=${cell.f}` : render(r, c);
      fields.push(quoteField(text, options.delimiter));
    }
    // 오른쪽 끝의 빈 칸들은 떨어낸다 — 파일이 쓸데없이 넓어 보인다.
    while (fields.length > 0 && fields[fields.length - 1] === "") fields.pop();
    lines.push(fields.join(options.delimiter));
  }

  const body = lines.join(options.newline) + options.newline;
  const encoded = new TextEncoder().encode(body);
  if (!options.bom) return encoded;

  const out = new Uint8Array(encoded.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(encoded, 3);
  return out;
}
