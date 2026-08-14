/** CSV/TSV 읽고 쓰기 — 인코딩 추정, 구분자 추론, RFC 4180 파싱.
 *
 * 한국에서 받는 CSV는 절반이 cp949다. 그래서 "UTF-8로 엄격하게 읽어 보고 실패하면
 * euc-kr"이라는 순서를 쓴다. TextDecoder가 두 인코딩을 모두 네이티브로 알고 있어서
 * 라이브러리가 필요 없다(크로미엄 전제).
 */

import { cellKey } from "./a1";
import { parseInput } from "./model";
import { formatValue } from "./numfmt";
import { emptySheet, type Cell, type SheetDoc } from "./types";

export type Delimiter = "," | "\t" | ";" | "|";

/** 손으로 고를 수 있는 인코딩 — 라벨은 TextDecoder에 그대로 넘긴다. */
export const ENCODINGS: { id: string; label: string }[] = [
  { id: "auto", label: "자동" },
  { id: "utf-8", label: "UTF-8" },
  { id: "euc-kr", label: "CP949" },
  { id: "utf-16le", label: "UTF-16LE" },
  { id: "utf-16be", label: "UTF-16BE" },
  { id: "shift_jis", label: "Shift_JIS" },
  { id: "windows-1252", label: "Latin-1" },
];

export const DELIMITERS: { id: Delimiter; label: string }[] = [
  { id: ",", label: "쉼표 ," },
  { id: "\t", label: "탭" },
  { id: ";", label: "세미콜론 ;" },
  { id: "|", label: "수직선 |" },
];

export interface CsvReadOptions {
  /** 구분자를 못 박는다. 없으면 추론. */
  delimiter?: Delimiter;
  /** TextDecoder 라벨을 못 박는다("euc-kr" 등). 없거나 "auto"면 판별. */
  encoding?: string;
}

export interface CsvReadResult {
  sheet: SheetDoc;
  encoding: string;
  delimiter: Delimiter;
  /** 첫 줄을 머리글로 볼 만한가 — 자동 굵게 처리에 쓴다. */
  headerLikely: boolean;
  /** 실제로 잡힌 열 수 — 1이면 구분자 추론이 빗나갔다는 뜻이다. */
  columns: number;
  /** 원문 그대로 남긴 칸 수(수·날짜로 읽으면 표기가 바뀌던 칸들). */
  preserved: number;
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

/**
 * 바이트를 글자로. BOM을 먼저 보고, 없으면 UTF-8 → cp949 순으로 시도한다.
 * `forced`를 주면 판별을 건너뛰고 그 인코딩으로 읽는다(추론이 빗나갔을 때의 손잡이).
 */
export function decodeText(bytes: Uint8Array, forced?: string): { text: string; encoding: string } {
  if (forced && forced !== "auto") {
    const label = ENCODINGS.find((e) => e.id === forced)?.label ?? forced.toUpperCase();
    // BOM 제거는 TextDecoder가 한다(ignoreBOM 기본값이 false).
    return { text: new TextDecoder(forced).decode(bytes), encoding: label };
  }

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

/**
 * 텍스트 → 시트. 값 해석(수·날짜·불리언)은 parseInput과 같은 규칙을 쓴다.
 *
 * 해석 결과를 다시 그렸을 때 원문과 달라지는 칸은 **원문을 함께 들고 있는다**
 * (`Cell.raw`). 그 칸은 화면에도 원문으로 보이고 저장할 때도 원문 그대로 나간다 —
 * 값은 수로 갖고 있으므로 합계·정렬은 그대로 된다.
 */
export function readCsv(
  bytes: Uint8Array,
  name = "Sheet1",
  options: CsvReadOptions = {},
): CsvReadResult {
  const { text, encoding } = decodeText(bytes, options.encoding);
  const delimiter = options.delimiter ?? sniffDelimiter(text);
  const rows = parseRows(text, delimiter);
  const headerLikely = looksLikeHeader(rows);

  const sheet = emptySheet(name, Math.max(200, rows.length + 20), 26);
  let maxCols = 0;
  let preserved = 0;

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
      // 수식 셀은 값이 계산 결과라 원문과 같을 수가 없다 — 원문은 f가 이미 갖고 있다.
      if (!parsed.formula && formatValue(parsed.value, parsed.numFmt) !== raw) {
        cell.raw = raw;
        preserved++;
      }
      if (headerLikely && r === 0) cell.s = { ...cell.s, bold: true };
      sheet.cells.set(cellKey(r, c), cell);
    }
  }

  sheet.cols = Math.max(26, maxCols + 3);
  // 원문이 몇 열짜리였나를 적어 둔다 — 오른쪽 끝 열이 통째로 비어 있으면
  // 셀 Map만 봐서는 그 열이 있었다는 걸 알 수 없다(types.ts의 srcCols).
  sheet.srcCols = maxCols;
  if (headerLikely) sheet.frozenRows = 1;
  return { sheet, encoding, delimiter, headerLikely, columns: maxCols, preserved };
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

/**
 * 시트 → CSV 바이트. 화면에 보이는 문자열(표시 형식 적용 후)로 내보낸다.
 * 파일에서 온 뒤로 손대지 않은 칸은 원문(`raw`)을 그대로 다시 쓴다 — 한 칸만
 * 고치고 저장했는데 건드리지 않은 열이 통째로 달라져 있는 일을 막는다.
 *
 * **표는 네모로 나간다.** 열 수는 값이 든 칸의 오른쪽 끝과 원문에서 본 열 수
 * (`srcCols`) 중 넓은 쪽이고, 모든 줄을 그 폭에 맞춘다. 예전엔 줄마다 오른쪽 끝의
 * 빈 칸을 떨어냈는데, 그러면 마지막 열이 빈 줄이 왕복만으로 한 칸 좁아져
 * ("이름,메모\r\n김,\r\n" → "…\r\n김\r\n") 받는 쪽에서 열이 밀렸다.
 * 예외는 **칸이 하나도 없는 줄** 하나뿐이다 — 원문의 빈 줄에 없던 구분자를
 * 지어내지 않는다.
 */
export function writeCsv(
  sheet: SheetDoc,
  render: (row: number, col: number) => string,
  options: CsvWriteOptions = DEFAULT_CSV_WRITE,
): Uint8Array {
  let bottom = -1;
  let right = -1;
  const filled = new Set<number>();
  for (const key of sheet.cells.keys()) {
    const r = Math.floor(key / 16_384);
    const c = key % 16_384;
    if (r > bottom) bottom = r;
    if (c > right) right = c;
    filled.add(r);
  }

  // 표의 폭. 값이 든 범위보다 원문이 넓었다면(오른쪽 끝 빈 열) 원문 쪽을 따른다.
  const width = Math.max(right + 1, sheet.srcCols ?? 0);

  const lines: string[] = [];
  for (let r = 0; r <= bottom; r++) {
    // 칸이 하나도 없는 줄은 빈 줄 그대로 — 원문에 없던 구분자를 만들지 않는다.
    if (!filled.has(r)) {
      lines.push("");
      continue;
    }
    const fields: string[] = [];
    for (let c = 0; c < width; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      const text =
        options.formulas && cell?.f ? `=${cell.f}` : (cell?.raw ?? render(r, c));
      fields.push(quoteField(text, options.delimiter));
    }
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
