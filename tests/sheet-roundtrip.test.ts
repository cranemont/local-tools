/** 시트의 실물 파일 왕복 — CSV 바이트와 xlsx 부품.
 *
 * `tests/sheet-csv.test.ts`가 조각(인코딩 판별·구분자 추론·RFC 4180·`raw` 규약)을 하나씩
 * 못 박는다면, 이 파일은 **파일 한 장을 그대로** 넣고 나온 바이트를 잰다. 갈래가 나뉘는
 * 이유는 규칙이 하나씩 맞아도 겹치면 어긋날 수 있어서다 — 세미콜론 구분에 따옴표 친
 * 여러 줄 칸이 있고 마지막 열에 값이 하나도 없는 파일은 규칙 넷을 한 번에 지나간다.
 *
 * CLAUDE.md 23번이 이 파일의 명세다: 셀은 가져온 원문(`raw`)을 들고 있고 편집 전까지
 * **바이트 단위로 그대로 다시 나간다**. 같은 문서를 xlsx로 내보내면 그 약속이 하나
 * 깨지는데(원문이 아니라 값+표시형식으로 나간다), 그것도 여기서 못 박는다 — 알려진
 * 경계는 적어 두어야 경계이지, 안 적으면 다음 사람이 사고로 만난다.
 *
 * ## xlsx 쪽에서 두 층을 잰다
 *
 *   ① 모델 왕복 — `readXlsx`→`writeXlsx`→`readXlsx`. `sheet/xlsx.ts`가 잃는 것을 잡는다.
 *   ② 푼 XML  — zip을 열어 `sheet1.xml`을 직접 읽는다. ①만 하면 쓰는 쪽과 읽는 쪽이
 *      같은 오해를 해도 왕복이 통과한다(양쪽이 `duplicateValues`를 안 쓰기로 하면
 *      왕복은 초록인데 엑셀에서 열면 규칙이 없다).
 *
 * 표본은 `tests/fixtures/xlsx.ts`가 짓는다. 그 파일 머리말이 "바이트는 결정적이지
 * 않고 푼 내용이 결정적이다"의 이유를 적어 두었다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cellKey, type Area } from "../apps/sheet/src/lib/sheet/a1";
import { newRuleId, type CondRule } from "../apps/sheet/src/lib/sheet/condformat";
import {
  DEFAULT_CSV_WRITE,
  decodeText,
  readCsv,
  writeCsv,
  type CsvWriteOptions,
} from "../apps/sheet/src/lib/sheet/csv";
import { applyStyle, cellText, parseInput, putCell } from "../apps/sheet/src/lib/sheet/model";
import {
  emptySheet,
  isError,
  type Cell,
  type SheetDoc,
  type WorkbookDoc,
} from "../apps/sheet/src/lib/sheet/types";
import type { ValidationRange } from "../apps/sheet/src/lib/sheet/validation";
import { readXlsx, writeXlsx, xlsxLosses } from "../apps/sheet/src/lib/sheet/xlsx";
import {
  asArrayBuffer,
  makeXlsx,
  sheetXml,
  xlsxEntries,
  xlsxPart,
  type XlsxSheetSpec,
} from "./fixtures/xlsx";

const utf8 = new TextEncoder();

function bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

/** BOM 붙은 UTF-8 — 엑셀이 만드는 CSV의 기본 모습이다. */
function bomBytes(text: string): Uint8Array {
  const body = utf8.encode(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/**
 * cp949 인코더 — node에는 인코더가 없어 **디코더로 표를 뒤집어** 만든다.
 *
 * 리드 0x81~0xFD × 트레일 0x41~0xFE 조합을 euc-kr 디코더에 하나씩 넣어 글자→바이트
 * 표를 짓는다(한 번만, 실측 3ms). 표에 없는 글자를 만나면 던진다 — 조용히 물음표로
 * 흘려 보내면 "cp949로 읽었다"는 단언이 아무것도 재지 않게 된다.
 */
let cp949: Map<string, [number, number]> | null = null;

function encodeCp949(text: string): Uint8Array {
  if (!cp949) {
    const decoder = new TextDecoder("euc-kr");
    const pair = new Uint8Array(2);
    cp949 = new Map();
    for (let lead = 0x81; lead <= 0xfd; lead++) {
      for (let trail = 0x41; trail <= 0xfe; trail++) {
        pair[0] = lead;
        pair[1] = trail;
        const ch = decoder.decode(pair);
        if (ch.length !== 1 || ch === "�") continue;
        if (!cp949.has(ch)) cp949.set(ch, [lead, trail]);
      }
    }
  }

  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const pair = cp949.get(ch);
    if (!pair) throw new Error(`cp949에 없는 글자: ${ch}`);
    out.push(pair[0], pair[1]);
  }
  return new Uint8Array(out);
}

/** 화면에 보이는 문자열을 주는 렌더러 — 앱의 state.svelte.ts가 넘기는 것과 같다. */
function renderer(sheet: SheetDoc): (row: number, col: number) => string {
  return (row, col) => cellText(sheet.cells.get(cellKey(row, col)));
}

function writeBack(sheet: SheetDoc, over: Partial<CsvWriteOptions> = {}): Uint8Array {
  return writeCsv(sheet, renderer(sheet), { ...DEFAULT_CSV_WRITE, ...over });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

function textOf(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

function cellAt(sheet: SheetDoc, row: number, col: number): Cell | undefined {
  return sheet.cells.get(cellKey(row, col));
}

function area(top: number, left: number, bottom: number, right: number): Area {
  return { top, left, bottom, right };
}

// ────────────────────────────────────────────────────────────────
// 현장에서 받는 CSV 한 장. 규칙 넷이 한꺼번에 지나간다 —
// BOM + CRLF + 세미콜론 구분 + 따옴표 친 여러 줄 칸, 마지막 열에는 값이 하나도 없다.
// 값 쪽으로는 19자리 송장번호·앞자리 0·"1.50"·"+82…"·천 단위 쉼표·두 가지 날짜 표기가
// 한 줄에 모여 있다. 하나만 어긋나도 바이트가 달라진다.
const FIELD_CSV =
  "주문번호;고객;전화;금액;수량;등록일;메모;비고\r\n" +
  '1234567890123456789;"김;철수";+821012345678;1.50;0012;2024/01/05;"그는 ""안녕""이라\r\n했다";\r\n' +
  "2345678901234567890;이영희;01098765432;2,300;0034;2024/02/29;;\r\n" +
  "\r\n" +
  "합계;;;3.80;;;;\r\n";

describe("현장에서 받는 CSV 한 장 — 읽고 다시 쓰면 바이트가 같다", () => {
  it("구분자·인코딩·열 수를 스스로 알아본다", () => {
    const read = readCsv(bomBytes(FIELD_CSV));
    expect(read.delimiter).toBe(";");
    expect(read.encoding).toBe("UTF-8 (BOM)");
    expect(read.columns).toBe(8);
    expect(read.sheet.srcCols).toBe(8);
    expect(read.headerLikely).toBe(true);
  });

  it("한 줄에만 몰린 세미콜론은 구분자로 뽑히지 않는다 — 줄마다 고른 쪽이 이긴다", () => {
    // 메모 칸에 세미콜론으로 이어 붙인 목록이 한 줄 들어온 파일. 세미콜론이 쉼표보다
    // 많이 나오지만(12 대 4) 나오는 줄이 둘뿐이고 개수가 들쭉날쭉하다.
    // 편차 감점을 빼면 여기서 세미콜론이 이겨 표가 두 열로 접힌다.
    const messy =
      "이름,메모\n" +
      "김철수,보통\n" +
      "이영희,태그 a;b;c;d;e;f;g;h;i;j;k\n" +
      "박민수,짧게; 끝\n";
    const read = readCsv(bytes(messy));
    expect(read.delimiter).toBe(",");
    expect(read.columns).toBe(2);
    expect(cellAt(read.sheet, 2, 1)?.v).toBe("태그 a;b;c;d;e;f;g;h;i;j;k");
  });

  it("BOM·CRLF·따옴표·여러 줄 칸·빈 줄·빈 마지막 열이 한 파일에 있어도 바이트가 그대로다", () => {
    const input = bomBytes(FIELD_CSV);
    const read = readCsv(input);
    const out = writeBack(read.sheet, { delimiter: read.delimiter });
    expect(textOf(out.subarray(3))).toBe(FIELD_CSV);
    expect(sameBytes(out, input)).toBe(true);
  });

  it("두 번 왕복해도 더는 변하지 않는다(멱등)", () => {
    const once = writeBack(readCsv(bomBytes(FIELD_CSV)).sheet, { delimiter: ";" });
    const twice = writeBack(readCsv(once).sheet, { delimiter: ";" });
    expect(sameBytes(twice, once)).toBe(true);
  });

  it("칸마다 값이 제대로 해석돼 있다 — 바이트만 같고 값이 글자 덩어리면 표가 아니다", () => {
    const { sheet } = readCsv(bomBytes(FIELD_CSV));
    // 19자리 송장번호는 글자, 금액은 수, 앞자리 0인 수량도 글자다.
    expect(cellAt(sheet, 1, 0)?.v).toBe("1234567890123456789");
    expect(cellAt(sheet, 1, 3)?.v).toBe(1.5);
    expect(cellAt(sheet, 1, 4)?.v).toBe("0012");
    // 천 단위 쉼표가 든 칸은 수로 읽고 표시 형식을 스스로 정한다.
    expect(cellAt(sheet, 2, 3)?.v).toBe(2300);
    expect(cellAt(sheet, 2, 3)?.s?.numFmt).toBe("#,##0");
    // 따옴표 안의 구분자와 줄바꿈은 값의 일부다.
    expect(cellAt(sheet, 1, 1)?.v).toBe("김;철수");
    expect(cellAt(sheet, 1, 6)?.v).toBe('그는 "안녕"이라\r\n했다');
  });

  it("표시가 원문과 달라지는 칸에만 원문이 붙는다 — 그 수를 읽는 쪽에 알린다", () => {
    const read = readCsv(bomBytes(FIELD_CSV));
    // "1.50"·"+82…"·"3.80"·날짜 둘 — 다섯 칸이다. 나머지는 다시 그려도 같은 글자라
    // 원문을 안 든다(19자리 번호는 글자 그대로, "2,300"은 표시 형식이 원문을 되그린다).
    expect(read.preserved).toBe(5);
    expect(cellAt(read.sheet, 1, 3)?.raw).toBe("1.50");
    expect(cellAt(read.sheet, 1, 2)?.raw).toBe("+821012345678");
    expect(cellAt(read.sheet, 1, 5)?.raw).toBe("2024/01/05");
    expect(cellAt(read.sheet, 2, 4)?.raw).toBeUndefined();
    expect(cellAt(read.sheet, 1, 0)?.raw).toBeUndefined();
  });

  it("원문이 붙은 칸은 화면에도 원문으로 보인다 — 화면과 파일을 같은 함수가 그린다", () => {
    const { sheet } = readCsv(bomBytes(FIELD_CSV));
    expect(cellText(cellAt(sheet, 1, 3))).toBe("1.50");
    expect(cellText(cellAt(sheet, 1, 2))).toBe("+821012345678");
    expect(cellText(cellAt(sheet, 1, 5))).toBe("2024/01/05");
    expect(cellText(cellAt(sheet, 4, 3))).toBe("3.80");
    // 원문이 없는 칸은 값 + 표시 형식으로 그린다.
    expect(cellText(cellAt(sheet, 2, 3))).toBe("2,300");
  });

  it("가운데 빈 줄은 빈 줄로 남는다 — 없던 구분자를 지어내지 않는다", () => {
    const out = textOf(writeBack(readCsv(bomBytes(FIELD_CSV)).sheet, { delimiter: ";" }).subarray(3));
    expect(out.split("\r\n")[4]).toBe("");
    // 그 다음 줄은 그대로 살아 있다 — 빈 줄에서 표가 끝났다고 보면 안 된다.
    expect(out.split("\r\n")[5]).toBe("합계;;;3.80;;;;");
  });

  it("[알려진 예외] 구분자가 아닌 쉼표가 든 칸은 따옴표를 잃는다 — 값은 같고 바이트는 달라진다", () => {
    // 세미콜론 파일에서 "김,철수"는 감쌀 이유가 없다(RFC 4180에서 따옴표는 선택이다).
    const src = "이름;메모\r\n\"김,철수\";x\r\n";
    const read = readCsv(bomBytes(src));
    expect(cellAt(read.sheet, 1, 0)?.v).toBe("김,철수");
    expect(textOf(writeBack(read.sheet, { delimiter: ";" }).subarray(3))).toBe(
      "이름;메모\r\n김,철수;x\r\n",
    );
  });
});

describe("한 칸을 고쳐 저장하면 그 칸만 달라진다", () => {
  const original = FIELD_CSV;

  function editedText(edit: (sheet: SheetDoc) => void): string {
    const read = readCsv(bomBytes(original));
    edit(read.sheet);
    return textOf(writeBack(read.sheet, { delimiter: ";" }).subarray(3));
  }

  it("값을 새로 넣은 칸만 바뀌고 나머지 바이트는 제자리다", () => {
    const out = editedText((sheet) => {
      const parsed = parseInput("2");
      putCell(sheet, 1, 3, { v: parsed.value, s: undefined });
    });
    expect(out).toBe(original.replace("1.50", "2"));
  });

  it("표시 형식을 고르면 그 칸이 원문을 놓는다 — 사용자가 표현을 정한 것이다", () => {
    const out = editedText((sheet) => {
      applyStyle(sheet, area(1, 3, 1, 3), { numFmt: "0.0" });
    });
    expect(out).toBe(original.replace("1.50", "1.5"));
  });

  it("표시 형식과 무관한 서식은 원문을 놓지 않는다 — 굵게 한 번에 손대지 않은 칸까지 바뀌면 안 된다", () => {
    const out = editedText((sheet) => {
      applyStyle(sheet, area(0, 0, 2, 7), { bold: true });
    });
    expect(out).toBe(original);
  });

  it("[알려진 결함] 빈 줄까지 골라 서식을 걸면 그 줄이 구분자 줄로 바뀐다", () => {
    // 서식은 빈 칸에도 걸리고(칸이 생긴다), CSV 쓰기는 "칸이 하나도 없는 줄"만 빈 줄로
    // 내보낸다. 그래서 빈 줄까지 골라 굵게 한 번이면 원문의 빈 줄이 ";;;;;;;"가 된다 —
    // CSV는 서식을 담지도 못하므로 사용자가 얻는 것 없이 파일만 달라진다.
    const out = editedText((sheet) => {
      applyStyle(sheet, area(0, 0, 4, 7), { bold: true });
    });
    expect(out).toBe(original.replace("\r\n\r\n합계", "\r\n;;;;;;;\r\n합계"));
  });

  it("표시 형식을 지웠다 다시 걸어도 원문은 돌아오지 않는다 — 한 번 놓으면 끝이다", () => {
    const out = editedText((sheet) => {
      applyStyle(sheet, area(1, 3, 1, 3), { numFmt: "0.0" });
      applyStyle(sheet, area(1, 3, 1, 3), { numFmt: undefined });
    });
    expect(out).toBe(original.replace("1.50", "1.5"));
  });
});

// ────────────────────────────────────────────────────────────────
describe("cp949로 온 파일", () => {
  const CP949_CSV = "고객명,전화,금액\r\n김철수,01012345678,1.50\r\n박영희,01098765432,2.30\r\n";

  it("UTF-8로 못 읽는 바이트라 cp949로 물러나고 글자가 온전하다", () => {
    const input = encodeCp949(CP949_CSV);
    const read = readCsv(input);
    expect(read.encoding).toBe("CP949");
    expect(cellAt(read.sheet, 1, 0)?.v).toBe("김철수");
    expect(cellAt(read.sheet, 2, 0)?.v).toBe("박영희");
    expect(cellAt(read.sheet, 1, 1)?.v).toBe("01012345678");
    expect(cellAt(read.sheet, 1, 2)?.v).toBe(1.5);
  });

  it("[알려진 경계] 내보내기는 언제나 UTF-8이다 — 바뀌는 것은 인코딩뿐이고 글자는 그대로다", () => {
    const input = encodeCp949(CP949_CSV);
    const out = writeBack(readCsv(input).sheet, { bom: false });
    // 입력 바이트와는 다르다(cp949 → UTF-8).
    expect(sameBytes(out, input)).toBe(false);
    // 그러나 같은 글자를 UTF-8로 적은 것과는 바이트까지 같다 — 표기는 하나도 안 바뀐다.
    expect(sameBytes(out, bytes(CP949_CSV))).toBe(true);
  });

  it("한 번 UTF-8로 나간 파일은 그대로 다시 왕복한다", () => {
    const once = writeBack(readCsv(encodeCp949(CP949_CSV)).sheet, { bom: false });
    const twice = writeBack(readCsv(once).sheet, { bom: false });
    expect(sameBytes(twice, once)).toBe(true);
  });

  it("cp949 표본이 정말 cp949다 — '한'은 C7D1이다", () => {
    expect(Array.from(encodeCp949("한글"))).toEqual([0xc7, 0xd1, 0xb1, 0xdb]);
    expect(decodeText(encodeCp949("가나다")).encoding).toBe("CP949");
  });
});

// ────────────────────────────────────────────────────────────────
// 식별자 열. 여기서 한 칸이라도 수로 굳으면 받는 쪽 시스템이 파일을 거부한다.
const IDS_CSV =
  "휴대전화,국제전화,주민번호,카드번호,카드번호2,송장번호,우편번호,사번\r\n" +
  "010-1234-5678,+821012345678,901231-1234567,1234 5678 9012 3456,1234567890123456,1234567890123456789,06236,0007\r\n";

describe("식별자 열 — 안전 정수(2^53) 밖은 글자로 남는다", () => {
  const { sheet } = readCsv(bomBytes(IDS_CSV));

  it("하이픈·공백·앞자리 0이 있는 번호는 애초에 수로 해석하지 않는다", () => {
    expect(cellAt(sheet, 1, 0)?.v).toBe("010-1234-5678");
    expect(cellAt(sheet, 1, 2)?.v).toBe("901231-1234567");
    expect(cellAt(sheet, 1, 3)?.v).toBe("1234 5678 9012 3456");
    expect(cellAt(sheet, 1, 6)?.v).toBe("06236");
    expect(cellAt(sheet, 1, 7)?.v).toBe("0007");
  });

  it("19자리 송장번호는 글자, 16자리 카드번호는 수 — 경계는 자릿수가 아니라 2^53이다", () => {
    expect(cellAt(sheet, 1, 5)?.v).toBe("1234567890123456789");
    expect(cellAt(sheet, 1, 4)?.v).toBe(1234567890123456);
    // 수로 읽힌 쪽도 표기가 안 바뀐다 — 지수 표기로 접히면 카드번호가 다른 글자가 된다.
    expect(cellText(cellAt(sheet, 1, 4))).toBe("1234567890123456");
  });

  it("여덟 열이 든 줄이 왕복에서 바이트가 그대로다", () => {
    const input = bomBytes(IDS_CSV);
    expect(sameBytes(writeBack(readCsv(input).sheet), input)).toBe(true);
  });

  it("xlsx로 나갔다 와도 글자로 남은 번호는 글자다", async () => {
    const book: WorkbookDoc = { sheets: [sheet], active: 0, filename: "ids.csv", origin: "csv" };
    const back = (await readXlsx(asArrayBuffer(await writeXlsx(book)), "ids.xlsx")).book;
    const after = back.sheets[0];
    for (const col of [0, 2, 3, 6, 7]) {
      expect(cellAt(after, 1, col)?.v).toBe(cellAt(sheet, 1, col)?.v);
    }
    expect(cellAt(after, 1, 5)?.v).toBe("1234567890123456789");
    expect(cellAt(after, 1, 4)?.v).toBe(1234567890123456);
  });

  it("[알려진 경계] xlsx는 원문이 아니라 값으로 나간다 — 국제전화의 +가 사라진다", async () => {
    // CLAUDE.md 23번: xlsx 저장은 raw가 아니라 값+표시형식이다. CSV로는 지켜지는
    // "손대지 않은 칸은 그대로"가 xlsx에서는 깨진다는 뜻이다.
    expect(cellAt(sheet, 1, 1)?.raw).toBe("+821012345678");
    const book: WorkbookDoc = { sheets: [sheet], active: 0, filename: "ids.csv", origin: "csv" };
    const back = (await readXlsx(asArrayBuffer(await writeXlsx(book)), "ids.xlsx")).book;
    expect(cellAt(back.sheets[0], 1, 1)?.v).toBe(821012345678);
    expect(cellAt(back.sheets[0], 1, 1)?.raw).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// xlsx. 표본은 한 번만 짓고(빌드가 제일 비싸다) 테스트마다 새로 읽는다 —
// 테스트가 읽은 문서를 고치므로 공유하면 순서에 기댄다.

const SALES: XlsxSheetSpec = {
  name: "판매",
  // 행 수와 열 수를 다르게 둔다 — 같은 수면 두 값이 뒤바뀌어도 왕복이 통과한다.
  freeze: { rows: 2, cols: 1 },
  cells: {
    A1: { value: "품목", bold: true, fill: "#ffff00", borders: ["top", "bottom"] },
    B1: { value: "수량", bold: true, italic: true, color: "#c00000", fontSize: 14 },
    C1: { value: "금액", bold: true, underline: true, strike: true, align: "center", wrap: true },
    A2: { value: "연필" },
    B2: { value: 3 },
    C2: { value: 1234.5, numFmt: "#,##0.00" },
    A3: { value: "지우개" },
    B3: { value: 12 },
    C3: { value: 0.25, numFmt: "0.0%" },
    A4: { value: "합계", bold: true, align: "right", valign: "middle" },
    B4: { formula: "SUM(B2:B3)", result: 15 },
    C4: { formula: "SUM(C2:C3)", result: 1234.75, numFmt: "#,##0.00" },
    D4: { error: "#DIV/0!" },
    A6: { value: "메모", borders: ["left", "right"] },
  },
  colWidths: { A: 20, C: 12 },
  rowHeights: { 1: 30 },
  merges: ["A6:C6"],
};

const NOTES: XlsxSheetSpec = {
  name: "숨긴 장",
  hidden: true,
  cells: { A1: { value: "여기도 살아 있어야 한다" } },
};

let salesBytes: Uint8Array;

beforeAll(async () => {
  salesBytes = await makeXlsx([SALES, NOTES]);
});

async function openSales(): Promise<WorkbookDoc> {
  return (await readXlsx(asArrayBuffer(salesBytes), "판매.xlsx")).book;
}

/** 왕복 한 번 — 쓰고 다시 읽는다. */
async function tripXlsx(book: WorkbookDoc): Promise<{ out: Uint8Array; book: WorkbookDoc }> {
  const out = await writeXlsx(book);
  return { out, book: (await readXlsx(asArrayBuffer(out), "다시.xlsx")).book };
}

/** 비교용 모양 — 규칙 id는 읽을 때마다 새로 나므로 뺀다. */
function shapeOf(sheet: SheetDoc): unknown {
  return {
    name: sheet.name,
    hidden: sheet.hidden ?? false,
    frozen: [sheet.frozenRows, sheet.frozenCols],
    colWidths: [...sheet.colWidths].sort((a, b) => a[0] - b[0]),
    rowHeights: [...sheet.rowHeights].sort((a, b) => a[0] - b[0]),
    merges: sheet.merges,
    cells: [...sheet.cells].sort((a, b) => a[0] - b[0]).map(([key, cell]) => [key, cell]),
    validations: sheet.validations,
    condFormats: (sheet.condFormats ?? []).map(({ id: _id, ...rest }) => rest),
  };
}

describe("xlsx 왕복 — 서식·수식·틀이 살아 돌아온다", () => {
  it("글꼴 서식과 색·정렬·줄바꿈·테두리가 그대로 돌아온다", async () => {
    const before = (await openSales()).sheets[0];
    const after = (await tripXlsx(await openSales())).book.sheets[0];
    for (const [row, col] of [
      [0, 0],
      [0, 1],
      [0, 2],
      [3, 0],
      [5, 0],
    ]) {
      expect(cellAt(after, row, col)?.s).toEqual(cellAt(before, row, col)?.s);
    }
    expect(cellAt(after, 0, 0)?.s).toEqual({
      bold: true,
      fill: "#ffff00",
      borders: ["top", "bottom"],
    });
    expect(cellAt(after, 0, 1)?.s).toEqual({
      bold: true,
      italic: true,
      color: "#c00000",
      fontSize: 14,
    });
    expect(cellAt(after, 0, 2)?.s).toEqual({
      bold: true,
      underline: true,
      strike: true,
      align: "center",
      wrap: true,
    });
  });

  it("표시 형식과 수식 원문이 계산 결과와 함께 돌아온다", async () => {
    const after = (await tripXlsx(await openSales())).book.sheets[0];
    expect(cellAt(after, 1, 2)?.s?.numFmt).toBe("#,##0.00");
    expect(cellAt(after, 2, 2)?.s?.numFmt).toBe("0.0%");
    expect(cellAt(after, 3, 1)).toEqual({ v: 15, f: "SUM(B2:B3)" });
    expect(cellAt(after, 3, 2)?.f).toBe("SUM(C2:C3)");
    expect(cellAt(after, 3, 2)?.v).toBe(1234.75);
  });

  it("오류값은 엑셀 오류로 나갔다가 오류로 돌아온다 — 글자 '#DIV/0!'가 아니다", async () => {
    const after = (await tripXlsx(await openSales())).book.sheets[0];
    const cell = cellAt(after, 3, 3);
    expect(isError(cell?.v)).toBe(true);
    expect(String(cell?.v)).toBe("#DIV/0!");
  });

  it("열 너비·행 높이는 단위를 두 번 갈아 끼워도 같은 px로 돌아온다", async () => {
    // 파일은 글자 수와 포인트로 적고 우리는 px로 든다. 왕복마다 반올림이 쌓이면
    // 열이 조금씩 좁아진다.
    const before = (await openSales()).sheets[0];
    expect([...before.colWidths]).toEqual([
      [0, 145],
      [2, 89],
    ]);
    expect([...before.rowHeights]).toEqual([[0, 40]]);
    const after = (await tripXlsx(await openSales())).book.sheets[0];
    expect([...after.colWidths]).toEqual([...before.colWidths]);
    expect([...after.rowHeights]).toEqual([...before.rowHeights]);
  });

  it("병합·틀 고정·숨긴 장이 살아 돌아온다", async () => {
    const { book } = await tripXlsx(await openSales());
    const [sales, notes] = book.sheets;
    expect(sales.merges).toEqual([{ top: 5, left: 0, bottom: 5, right: 2 }]);
    expect([sales.frozenRows, sales.frozenCols]).toEqual([2, 1]);
    expect(sales.name).toBe("판매");
    expect(notes.name).toBe("숨긴 장");
    expect(notes.hidden).toBe(true);
    expect(cellAt(notes, 0, 0)?.v).toBe("여기도 살아 있어야 한다");
  });

  it("두 번 왕복해도 모양이 더는 변하지 않는다(멱등)", async () => {
    const once = await tripXlsx(await openSales());
    const twice = await tripXlsx(once.book);
    expect(twice.book.sheets.map(shapeOf)).toEqual(once.book.sheets.map(shapeOf));
  });

  it("시트가 하나도 없는 파일도 빈 장 하나로 연다 — 장이 없으면 sheets[active]가 undefined다", async () => {
    const empty = await makeXlsx([]);
    const read = await readXlsx(asArrayBuffer(empty), "빈.xlsx");
    expect(read.book.sheets.map((s) => s.name)).toEqual(["Sheet1"]);
    expect(read.book.sheets[0].cells.size).toBe(0);
  });

  it("xlsx가 아닌 바이트는 열다가 던진다 — 조용히 빈 표가 되면 안 된다", async () => {
    const broken = salesBytes.slice(0, Math.floor(salesBytes.length * 0.6));
    await expect(readXlsx(asArrayBuffer(broken), "깨진.xlsx")).rejects.toThrow();
  });
});

describe("xlsx 파일 속 — zip을 풀어 XML을 직접 본다", () => {
  it("엑셀이 요구하는 부품이 다 들어 있다", async () => {
    const { out } = await tripXlsx(await openSales());
    const names = Object.keys(xlsxEntries(out));
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/styles.xml",
      "docProps/core.xml",
    ]) {
      expect(names).toContain(part);
    }
  });

  it("병합·틀 고정·수식·열 너비가 sheet1.xml에 그대로 적힌다", async () => {
    const { out } = await tripXlsx(await openSales());
    const xml = sheetXml(out);
    expect(xml).toContain('<mergeCell ref="A6:C6"/>');
    expect(xml).toContain('state="frozen"');
    // xSplit이 열, ySplit이 행이다. 두 값을 맞바꿔 적으면 파일에서만 티가 난다 —
    // 우리끼리 쓰고 읽는 왕복은 뒤바뀐 채로도 맞아떨어진다.
    expect(xml).toContain('xSplit="1"');
    expect(xml).toContain('ySplit="2"');
    expect(xml).toContain("<f>SUM(B2:B3)</f>");
    expect(xml).toContain('<col min="1" max="1" width="20"');
  });

  it("숨긴 장은 시트 XML이 아니라 workbook.xml에 적힌다", async () => {
    const { out } = await tripXlsx(await openSales());
    expect(xlsxPart(out, "xl/workbook.xml")).toContain('state="hidden"');
  });

  it("표시 형식은 styles.xml에 적히되, 엑셀 기본 형식은 코드가 아니라 번호로 나간다", async () => {
    const { out } = await tripXlsx(await openSales());
    const styles = xlsxPart(out, "xl/styles.xml");
    // "0.0%"는 엑셀 기본 목록에 없어 164번부터 새로 만들어 formatCode를 적는다.
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="0.0%"/>');
    // "#,##0.00"은 기본 4번이라 코드가 파일에 안 적힌다 — 글자로 찾으면 못 찾는다.
    expect(styles).not.toContain("#,##0.00");
    expect(styles).toContain('numFmtId="4"');
    // 그래도 되읽으면 코드로 돌아온다(ExcelJS가 번호를 코드로 되돌린다).
    const back = (await readXlsx(asArrayBuffer(out), "다시.xlsx")).book.sheets[0];
    expect(cellAt(back, 1, 2)?.s?.numFmt).toBe("#,##0.00");
  });

  it("없는 부품을 물으면 판독기가 던진다 — 오타가 빈 글자 단언으로 통과하지 않게", async () => {
    const { out } = await tripXlsx(await openSales());
    expect(() => xlsxPart(out, "xl/worksheets/sheet9.xml")).toThrow(/sheet9/);
  });
});

// ────────────────────────────────────────────────────────────────
// 조건부 서식. 시트의 규칙 일곱 갈래가 엑셀 규칙으로 나갔다가 되읽힌다.

function rule(part: Omit<CondRule, "id">): CondRule {
  return { id: newRuleId(), ...part } as CondRule;
}

function condBook(rules: CondRule[]): WorkbookDoc {
  const sheet = emptySheet("규칙");
  sheet.cells.set(cellKey(0, 0), { v: "가" });
  sheet.cells.set(cellKey(1, 0), { v: "가" });
  sheet.cells.set(cellKey(0, 1), { v: 3 });
  sheet.cells.set(cellKey(1, 1), { v: 9 });
  sheet.condFormats = rules;
  return { sheets: [sheet], active: 0, filename: "규칙.xlsx", origin: "xlsx" };
}

const A_COL = area(0, 0, 8, 0);
const B_COL = area(0, 1, 8, 1);

describe("xlsx 조건부 서식 왕복", () => {
  it("비교·글자·빈 칸·중복·순위·색조·막대 일곱 갈래가 그대로 돌아온다", async () => {
    const rules: CondRule[] = [
      rule({ range: B_COL, kind: "compare", op: "between", value: "1", value2: "5", style: { fill: "#ffcccc" } }),
      rule({ range: A_COL, kind: "text", op: "contains", value: "가", style: { bold: true } }),
      rule({ range: A_COL, kind: "text", op: "startsWith", value: "가", style: { italic: true } }),
      rule({ range: A_COL, kind: "text", op: "notContains", value: '따"옴표', style: { strike: true } }),
      rule({ range: A_COL, kind: "blank", op: "notBlank", style: { fill: "#eeeeee" } }),
      rule({ range: A_COL, kind: "dup", op: "duplicate", style: { color: "#ffffff", fill: "#000000" } }),
      rule({ range: B_COL, kind: "rank", op: "bottom", n: 3, percent: true, style: { bold: true } }),
      rule({
        range: B_COL,
        kind: "scale",
        stops: [
          { at: { type: "min" }, color: "#ffffff" },
          { at: { type: "percentile", value: 50 }, color: "#ffff00" },
          { at: { type: "max" }, color: "#ff0000" },
        ],
      }),
      rule({ range: B_COL, kind: "bar", color: "#638ec6", min: { type: "min" }, max: { type: "num", value: 100 } }),
    ];
    const { book } = await tripXlsx(condBook(rules));
    const back = book.sheets[0].condFormats ?? [];
    expect(back.map(({ id: _id, ...rest }) => rest)).toEqual(
      rules.map(({ id: _id, ...rest }) => rest),
    );
  });

  it("목록 차례가 곧 엑셀의 우선순위 번호다 — 앞의 규칙이 1번이다", async () => {
    const { out } = await tripXlsx(
      condBook([
        rule({ range: A_COL, kind: "text", op: "contains", value: "가", style: { bold: true } }),
        rule({ range: A_COL, kind: "blank", op: "blank", style: { italic: true } }),
      ]),
    );
    const xml = sheetXml(out);
    expect(/priority="1"/.test(xml)).toBe(true);
    expect(xml.indexOf('priority="1"')).toBeLessThan(xml.indexOf('priority="2"'));
  });

  it("읽을 때는 적힌 차례가 아니라 우선순위 번호를 따른다 — 엑셀은 뒤에 적고도 1번을 줄 수 있다", async () => {
    // 우리가 쓴 파일은 차례와 번호가 늘 같아 왕복만으로는 이 자리가 안 드러난다.
    const group = (value: number, priority: number) => ({
      ref: "A1:A9",
      rules: [
        {
          type: "cellIs" as const,
          operator: "greaterThan" as const,
          formulae: [value],
          priority,
          style: { font: { bold: true } },
        },
      ],
    });
    const bytes = await makeXlsx([
      {
        cells: { A1: { value: 1 } },
        // 문서에는 2번이 먼저 적혀 있다.
        condFormats: [group(10, 2), group(20, 1)],
      },
    ]);

    const sheet = (await readXlsx(asArrayBuffer(bytes), "차례.xlsx")).book.sheets[0];
    const rules = sheet.condFormats ?? [];
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => ("value" in r ? r.value : null))).toEqual(["20", "10"]);
  });

  it("중복 규칙은 duplicateValues가 아니라 COUNTIF 수식으로 나간다 — ExcelJS가 그것을 못 쓴다", async () => {
    const { out } = await tripXlsx(
      condBook([rule({ range: A_COL, kind: "dup", op: "duplicate", style: { bold: true } })]),
    );
    const xml = sheetXml(out);
    expect(xml).not.toContain("duplicateValues");
    expect(xml).toContain("COUNTIF($A$1:$A$9,A1)&gt;1");
  });

  it("글자 규칙의 기준 칸은 범위의 왼쪽 위다 — 엑셀이 나머지 칸에 밀어서 적용한다", async () => {
    const { out } = await tripXlsx(
      condBook([
        rule({ range: area(2, 1, 8, 3), kind: "text", op: "startsWith", value: "가", style: { bold: true } }),
      ]),
    );
    expect(sheetXml(out)).toContain("LEFT(B3,1)=&quot;가&quot;");
  });

  it("규칙이 칠하는 색은 흰 글자·검은 배경도 살아 돌아온다 — 셀 서식과 달리 버리지 않는다", async () => {
    // readStyle은 #ffffff 채우기와 #000000 글자색을 셀 기본값으로 보고 버린다.
    // 규칙이 정한 색은 사용자가 고른 값이라 그 규칙을 쓰면 안 된다.
    const rules = [
      rule({ range: A_COL, kind: "text", op: "contains", value: "가", style: { color: "#ffffff", fill: "#000000" } }),
    ];
    const { book } = await tripXlsx(condBook(rules));
    const back = book.sheets[0].condFormats?.[0];
    expect(back && "style" in back ? back.style : null).toEqual({
      color: "#ffffff",
      fill: "#000000",
    });
  });

  it("엑셀이 쓴 규칙 색은 bgColor에 있다 — 거기서 못 찾으면 열 때마다 색이 사라진다", async () => {
    // 우리가 쓴 파일은 같은 색을 fgColor에도 적어 두므로 왕복만으로는 이 자리가 안 드러난다.
    // 엑셀이 쓰는 모양(patternType 없이 bgColor만)을 표본으로 직접 지어야 잰다.
    const bytes = await makeXlsx([
      {
        cells: { A1: { value: 1 } },
        condFormats: [
          {
            ref: "A1:A9",
            rules: [
              {
                type: "cellIs",
                operator: "greaterThan",
                formulae: [0],
                priority: 1,
                style: {
                  font: { color: { argb: "FFFFFFFF" } },
                  fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FF000000" } },
                },
              },
            ],
          },
        ],
      },
    ]);
    const sheet = (await readXlsx(asArrayBuffer(bytes), "규칙.xlsx")).book.sheets[0];
    const back = sheet.condFormats?.[0];
    expect(back && "style" in back ? back.style : null).toEqual({
      color: "#ffffff",
      fill: "#000000",
    });
  });

  it("[알려진 한계] '참이면 중지'는 파일에 안 담긴다 — 저장 전에 그 수를 세어 알린다", async () => {
    const book = condBook([
      rule({ range: A_COL, kind: "text", op: "contains", value: "가", stopIfTrue: true, style: { bold: true } }),
      rule({ range: A_COL, kind: "blank", op: "blank", stopIfTrue: true, style: { italic: true } }),
    ]);
    expect(xlsxLosses(book).stopIfTrue).toBe(2);

    const { out, book: back } = await tripXlsx(book);
    expect(sheetXml(out)).not.toContain("stopIfTrue");
    expect(back.sheets[0].condFormats?.every((r) => r.stopIfTrue === undefined)).toBe(true);
  });

  it("[알려진 한계] 우리에게 없는 종류는 못 읽고, 그 수를 읽는 쪽에 알린다", async () => {
    const bytes = await makeXlsx([
      {
        cells: { A1: { value: 1 } },
        condFormats: [
          {
            ref: "A1:A9",
            rules: [
              {
                type: "iconSet",
                iconSet: "3TrafficLights",
                priority: 1,
                cfvo: [{ type: "min" }, { type: "percent", value: 50 }, { type: "max" }],
              },
            ],
          },
        ],
      },
    ]);
    const read = await readXlsx(asArrayBuffer(bytes), "아이콘.xlsx");
    expect(read.condSkipped).toBe(1);
    expect(read.book.sheets[0].condFormats).toBeUndefined();
    // 못 읽은 규칙은 저장하면 파일에서도 사라진다 — 그래서 조용히 넘기지 않는다.
    const { out } = await tripXlsx(read.book);
    expect(sheetXml(out)).not.toContain("conditionalFormatting");
  });
});

// ────────────────────────────────────────────────────────────────
describe("xlsx 입력 규칙 왕복", () => {
  function ruleBook(validations: ValidationRange[]): WorkbookDoc {
    const sheet = emptySheet("규칙");
    sheet.cells.set(cellKey(0, 0), { v: "가" });
    sheet.validations = validations;
    return { sheets: [sheet], active: 0, filename: "규칙.xlsx", origin: "xlsx" };
  }

  it("목록·정수·날짜·사용자 지정이 범위째 돌아온다", async () => {
    const given: ValidationRange[] = [
      {
        area: area(0, 2, 4, 2),
        rule: { kind: "list", source: "서울, 부산", allowBlank: true, action: "reject" },
      },
      {
        area: area(0, 3, 4, 3),
        rule: { kind: "whole", op: "between", value: "1", value2: "10", allowBlank: false, action: "warn" },
      },
      {
        area: area(0, 4, 4, 4),
        rule: { kind: "date", op: "gte", value: "2024-01-05", allowBlank: true, action: "reject" },
      },
      {
        area: area(0, 5, 4, 5),
        rule: { kind: "custom", formula: "A1>0", allowBlank: true, action: "warn" },
      },
    ];
    const { book } = await tripXlsx(ruleBook(given));
    const back = book.sheets[0].validations ?? [];
    expect(back.map((entry) => entry.area)).toEqual(given.map((entry) => entry.area));
    expect(back.map((entry) => entry.rule.kind)).toEqual(["list", "whole", "date", "custom"]);
    // 목록은 항목만 남고 공백은 정리된다. 값·동작은 그대로다.
    expect(back[0].rule.source).toBe("서울,부산");
    expect(back[1].rule.value2).toBe("10");
    expect(back[1].rule.allowBlank).toBe(false);
    expect(back[1].rule.action).toBe("warn");
    expect(back[2].rule.value).toBe("2024-01-05");
    expect(back[3].rule.formula).toBe("A1>0");
  });

  it("엑셀이 칸마다 펼쳐 적은 규칙은 직사각형으로 접어서 읽는다", async () => {
    // 실제 엑셀 파일은 "A1:A9"이면 아홉 칸이 같은 규칙 객체를 가리킨다. 안 접으면
    // 한 열짜리 규칙이 범위 아홉 개가 되어 칸을 그릴 때마다 그 목록을 훑는다.
    const dv = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: "stop",
      formulae: ['"서울,부산"'],
    };
    const bytes = await makeXlsx([
      { cells: { A1: { value: "가" } }, validations: { D1: dv, D2: dv, D3: dv } },
    ]);
    const read = await readXlsx(asArrayBuffer(bytes), "규칙.xlsx");
    expect(read.book.sheets[0].validations).toEqual([
      {
        area: area(0, 3, 2, 3),
        rule: {
          kind: "list",
          source: "서울,부산",
          op: "between",
          value: "",
          value2: "",
          formula: "",
          allowBlank: true,
          action: "reject",
        },
      },
    ]);
  });

  it("우리가 쓴 파일에서는 범위가 sqref 하나로 적힌다", async () => {
    const { out } = await tripXlsx(
      ruleBook([
        {
          area: area(0, 3, 8, 3),
          rule: { kind: "list", source: "서울, 부산", allowBlank: true, action: "reject" },
        },
      ]),
    );
    expect(sheetXml(out)).toContain('sqref="D1:D9"');
    expect(sheetXml(out)).toContain('type="list"');
  });

  it("[알려진 한계] 엑셀 모양으로 못 옮기는 규칙은 파일에 안 나가고, 그 수를 세어 알린다", async () => {
    const book = ruleBook([
      {
        area: area(0, 3, 4, 3),
        rule: { kind: "whole", op: "gt", value: "숫자가 아님", allowBlank: true, action: "reject" },
      },
    ]);
    expect(xlsxLosses(book).validation).toBe(1);
    const { out, book: back } = await tripXlsx(book);
    expect(sheetXml(out)).not.toContain("dataValidation");
    expect(back.sheets[0].validations).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
describe("xlsx가 못 싣는 것 — 없어진다는 사실을 못 박는다", () => {
  it("테마 색은 버려진다 — argb가 없어 어느 색인지 알 수 없다", async () => {
    const bytes = await makeXlsx([
      { cells: { A1: { value: "테마색", themeColor: 3 }, A2: { value: "직접색", color: "#c00000" } } },
    ]);
    const sheet = (await readXlsx(asArrayBuffer(bytes), "테마.xlsx")).book.sheets[0];
    expect(cellAt(sheet, 0, 0)?.s).toBeUndefined();
    expect(cellAt(sheet, 1, 0)?.s).toEqual({ color: "#c00000" });
  });

  it("셀 기본값과 같은 색·글자 크기는 '지정 안 함'으로 읽는다", async () => {
    const bytes = await makeXlsx([
      {
        cells: {
          A1: { value: "기본", color: "#000000", fill: "#ffffff", fontSize: 11 },
          A2: { value: "고른 값", color: "#000001", fontSize: 12 },
        },
      },
    ]);
    const sheet = (await readXlsx(asArrayBuffer(bytes), "기본.xlsx")).book.sheets[0];
    expect(cellAt(sheet, 0, 0)?.s).toBeUndefined();
    expect(cellAt(sheet, 1, 0)?.s).toEqual({ color: "#000001", fontSize: 12 });
  });

  it("표에서 본 열 수(srcCols)는 xlsx에 적을 자리가 없다 — CSV에서만 지킨다", async () => {
    const csv = readCsv(bomBytes("이름,메모\r\n김,\r\n"));
    expect(csv.sheet.srcCols).toBe(2);
    const book: WorkbookDoc = { sheets: [csv.sheet], active: 0, filename: "a.csv", origin: "csv" };
    const { book: back } = await tripXlsx(book);
    expect(back.sheets[0].srcCols).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 날짜. 아래는 지금 동작을 그대로 못 박은 것이고, **고쳐야 할 결함**이다.
//
// ExcelJS는 파일에 적힌 일련번호를 UTC 기준으로 Date로 푼다(validation.ts의
// utcToIso가 그 사실을 이미 알고 있다). 그런데 xlsx.ts의 readValue는 그 Date를
// serial.ts의 toSerial로 되돌리는데, toSerial은 **로컬 시각**을 읽는다. 그래서
// 파일을 열 때마다 값이 시간대 오프셋만큼 밀리고, 저장할 때는 밀린 값이 그대로
// 적혀 왕복마다 쌓인다.
describe("[알려진 결함] 날짜 칸이 xlsx 왕복마다 시간대 오프셋만큼 밀린다", () => {
  const saved = process.env.TZ;

  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  /** 45296 = 2024-01-05. 이 값을 든 파일 하나. */
  async function dateFile(): Promise<Uint8Array> {
    return makeXlsx([{ cells: { A1: { value: 45296, numFmt: "yyyy-mm-dd" } } } as XlsxSheetSpec]);
  }

  it("UTC+9에서는 열자마자 아홉 시간이 붙는다", async () => {
    process.env.TZ = "Asia/Seoul";
    const sheet = (await readXlsx(asArrayBuffer(await dateFile()), "날짜.xlsx")).book.sheets[0];
    expect(cellAt(sheet, 0, 0)?.v).toBeCloseTo(45296 + 9 / 24, 6);
    // 아직은 같은 날로 보인다 — 그래서 여기서 안 잡히고 아래까지 간다.
    expect(cellText(cellAt(sheet, 0, 0))).toBe("2024-01-05");
  });

  it("UTC+9에서 세 번 왕복하면 하루가 넘어가 2024-01-06이 된다", async () => {
    process.env.TZ = "Asia/Seoul";
    let book = (await readXlsx(asArrayBuffer(await dateFile()), "날짜.xlsx")).book;
    for (let i = 0; i < 2; i++) book = (await tripXlsx(book)).book;
    expect(cellAt(book.sheets[0], 0, 0)?.v).toBeCloseTo(45296 + 27 / 24, 6);
    expect(cellText(cellAt(book.sheets[0], 0, 0))).toBe("2024-01-06");
  });

  it("UTC−5에서는 한 번만 열어도 전날로 보인다", async () => {
    process.env.TZ = "America/New_York";
    const sheet = (await readXlsx(asArrayBuffer(await dateFile()), "날짜.xlsx")).book.sheets[0];
    expect(cellAt(sheet, 0, 0)?.v).toBeCloseTo(45296 - 5 / 24, 6);
    expect(cellText(cellAt(sheet, 0, 0))).toBe("2024-01-04");
  });

  it("UTC에서는 안 밀린다 — 그래서 CI만 보면 이 결함이 안 보인다", async () => {
    process.env.TZ = "UTC";
    const sheet = (await readXlsx(asArrayBuffer(await dateFile()), "날짜.xlsx")).book.sheets[0];
    expect(cellAt(sheet, 0, 0)?.v).toBe(45296);
    expect(cellText(cellAt(sheet, 0, 0))).toBe("2024-01-05");
  });

  it("입력 규칙의 날짜 경계는 안 밀린다 — 그쪽은 UTC로 되돌린다(validation.ts의 utcToIso)", async () => {
    process.env.TZ = "America/New_York";
    const sheet = emptySheet("규칙");
    sheet.validations = [
      {
        area: area(0, 0, 4, 0),
        rule: { kind: "date", op: "gte", value: "2024-01-05", allowBlank: true, action: "reject" },
      },
    ];
    const book: WorkbookDoc = { sheets: [sheet], active: 0, filename: "a.xlsx", origin: "xlsx" };
    const { book: back } = await tripXlsx(book);
    expect(back.sheets[0].validations?.[0].rule.value).toBe("2024-01-05");
  });
});

// ────────────────────────────────────────────────────────────────
describe("xlsx 표본 자체", () => {
  it("같은 명세로 두 번 지으면 푼 내용이 같다", async () => {
    const once = await makeXlsx([SALES]);
    const twice = await makeXlsx([SALES]);
    expect(xlsxEntries(twice)).toEqual(xlsxEntries(once));
  });

  it("문서 정보가 epoch로 박혀 있다 — 안 박으면 실행 시각이 core.xml에 들어간다", async () => {
    const core = xlsxPart(await makeXlsx([SALES]), "docProps/core.xml");
    expect(core).toContain("<dcterms:created xsi:type=\"dcterms:W3CDTF\">1970-01-01T00:00:00Z</dcterms:created>");
    expect(core).toContain("<dcterms:modified xsi:type=\"dcterms:W3CDTF\">1970-01-01T00:00:00Z</dcterms:modified>");
    expect(core).not.toContain(String(new Date().getFullYear()));
  });

  it("[알려진 한계] 바이트는 결정적이지 않다 — zip 항목 시각이 실행 시각이다", async () => {
    // ExcelJS가 archiver에 date를 안 넘긴다. 그래서 xlsx 표본으로 바이트를 비교하지
    // 말 것 — 푼 내용은 같고 바이트는 다르다.
    //
    // 두 번 지어 견주려면 zip 시각의 눈금(2초)만큼 기다려야 하는데, 그 한 줄이
    // 이 파일을 전체 실행의 최장 경로로 만든다. 대신 시각이 박히는 자리를 직접 읽어
    // 그 값이 고정값이 아니라 오늘이라는 것을 못 박는다 — 재는 것은 같고 값싸다.
    const before = new Date();
    const bytes = await makeXlsx([SALES]);
    const after = new Date();
    expect([ymdOf(before), ymdOf(after)]).toContainEqual(zipStampOf(bytes));
    // 고정값(zip의 epoch)이었다면 여기가 1980-01-01이다.
    expect(zipStampOf(bytes).year).not.toBe(1980);
  });
});

/** zip 로컬 헤더가 적어 둔 수정 날짜(12~13바이트, DOS 형식). */
function zipStampOf(bytes: Uint8Array): { year: number; month: number; day: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x04034b50); // "PK\x03\x04"
  const date = view.getUint16(12, true);
  return { year: 1980 + (date >> 9), month: (date >> 5) & 0xf, day: date & 0x1f };
}

function ymdOf(d: Date): { year: number; month: number; day: number } {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
