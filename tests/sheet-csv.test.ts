/** 시트 CSV — 인코딩 판별·구분자 추론·RFC 4180·원문 보존(왕복 무손실).
 *
 * CLAUDE.md 23번이 이 파일의 명세다: "시트의 셀은 가져온 원문(raw)을 들고 있고,
 * 편집 전까지 그대로 다시 나간다." 예전엔 값+표시형식으로 재생성해서 손대지도 않은
 * 칸이 저장하면 달라졌다("1.50" → 1.5, 19자리 번호 → 지수 표기). 아래 테스트가
 * 그 사고들이 되돌아오지 못하게 막는 자물쇠다.
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_CSV_WRITE,
  decodeText,
  parseRows,
  readCsv,
  sniffDelimiter,
  writeCsv,
  type CsvWriteOptions,
  type Delimiter,
} from "../apps/sheet/src/lib/sheet/csv";
import { cellKey } from "../apps/sheet/src/lib/sheet/a1";
import { exportText } from "../apps/sheet/src/lib/sheet/convert";
import {
  applyStyle,
  cellText,
  clearContents,
  clearStyles,
  deleteCols,
  forceText,
  insertCols,
  parseInput,
  putCell,
} from "../apps/sheet/src/lib/sheet/model";
import { emptySheet, type SheetDoc } from "../apps/sheet/src/lib/sheet/types";

const utf8 = new TextEncoder();

/** BOM 없는 UTF-8 바이트. */
function bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

/** BOM 붙은 UTF-8 바이트 — 엑셀이 만드는 CSV의 기본 모습. */
function bomBytes(text: string): Uint8Array {
  const body = utf8.encode(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/** 화면에 보이는 문자열을 주는 렌더러 — 앱의 state.svelte.ts가 넘기는 것과 같다. */
function renderer(sheet: SheetDoc): (row: number, col: number) => string {
  return (row, col) => cellText(sheet.cells.get(cellKey(row, col)));
}

/** 읽고 다시 쓴다. 옵션을 안 주면 원본과 같은 모양(BOM+CRLF+쉼표)으로 쓴다. */
function roundTrip(input: Uint8Array, options: Partial<CsvWriteOptions> = {}): Uint8Array {
  const read = readCsv(input);
  const opts: CsvWriteOptions = { ...DEFAULT_CSV_WRITE, delimiter: read.delimiter, ...options };
  return writeCsv(read.sheet, renderer(read.sheet), opts);
}

function textOf(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

function valueAt(sheet: SheetDoc, row: number, col: number) {
  return sheet.cells.get(cellKey(row, col))?.v ?? null;
}

// ────────────────────────────────────────────────────────────────
describe("인코딩 판별 — 한국에서 받는 CSV는 절반이 cp949다", () => {
  it("UTF-8 BOM이 붙어 있으면 BOM을 떼고 읽고, 판별 결과를 'UTF-8 (BOM)'으로 알린다", () => {
    const got = decodeText(bomBytes("이름,수량"));
    expect(got.text).toBe("이름,수량");
    expect(got.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(got.encoding).toBe("UTF-8 (BOM)");
  });

  it("BOM이 없어도 UTF-8로 유효하면 UTF-8로 읽는다", () => {
    expect(decodeText(bytes("이름,수량"))).toEqual({ text: "이름,수량", encoding: "UTF-8" });
  });

  it("UTF-8로 못 읽는 바이트는 cp949로 물러난다 — C7D1 B1DB는 '한글'이다", () => {
    // EUC-KR(cp949) 완성형: 한 = 0xC7D1, 글 = 0xB1DB. 0xD1은 UTF-8 후속바이트가 될 수 없어
    // fatal 디코더가 반드시 실패한다 → 폴백이 확실히 탄다.
    const got = decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]));
    expect(got.text).toBe("한글");
    expect(got.encoding).toBe("CP949");
  });

  it("UTF-16LE/BE BOM도 알아보고 BOM을 떼어낸다", () => {
    // "AB" = 0x0041 0x0042
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))).toEqual({
      text: "AB",
      encoding: "UTF-16LE",
    });
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]))).toEqual({
      text: "AB",
      encoding: "UTF-16BE",
    });
  });

  it("판별이 빗나갔을 때 손으로 고른 인코딩이 이긴다 — 판별을 아예 건너뛴다", () => {
    // cp949 바이트를 UTF-8이라고 우기면 대체문자가 나와야 한다(=판별을 안 탔다는 증거).
    const forcedUtf8 = decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]), "utf-8");
    expect(forcedUtf8.encoding).toBe("UTF-8");
    expect(forcedUtf8.text).toContain("�");

    // 반대로 UTF-8 바이트를 cp949라고 우기면 깨진 글자가 나와야 한다.
    const forcedCp949 = decodeText(bytes("한글"), "euc-kr");
    expect(forcedCp949.encoding).toBe("CP949");
    expect(forcedCp949.text).not.toBe("한글");
  });

  it('"auto"는 고른 게 아니라 안 고른 것이다 — 판별을 그대로 돌린다', () => {
    expect(decodeText(bomBytes("가"), "auto").encoding).toBe("UTF-8 (BOM)");
  });

  it("손으로 고른 인코딩도 BOM은 먹어 치운다 — 첫 칸 이름에 보이지 않는 글자가 남지 않는다", () => {
    expect(decodeText(bomBytes("이름"), "utf-8").text).toBe("이름");
  });

  it("readCsv는 고른 인코딩을 그대로 통과시킨다", () => {
    // cp949 "한글,1" — 뒤쪽 ",1"은 ASCII라 두 인코딩에서 같다.
    const raw = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31]);
    expect(readCsv(raw).encoding).toBe("CP949");
    expect(valueAt(readCsv(raw).sheet, 0, 0)).toBe("한글");
    expect(readCsv(raw, "Sheet1", { encoding: "euc-kr" }).encoding).toBe("CP949");
  });
});

// ────────────────────────────────────────────────────────────────
describe("구분자 추론 — 줄마다 개수가 가장 일정한 후보가 이긴다", () => {
  it("쉼표·탭·세미콜론·수직선을 각각 알아본다", () => {
    expect(sniffDelimiter("a,b,c\nd,e,f\n")).toBe(",");
    expect(sniffDelimiter("a\tb\tc\nd\te\tf\n")).toBe("\t");
    expect(sniffDelimiter("a;b;c\nd;e;f\n")).toBe(";");
    expect(sniffDelimiter("a|b|c\nd|e|f\n")).toBe("|");
  });

  it("쉼표가 따옴표 안에만 있으면 구분자로 세지 않는다", () => {
    expect(sniffDelimiter('"김,철수";1\n"이,영희";2\n')).toBe(";");
    expect(sniffDelimiter('"a,b,c"\t1\n"d,e,f"\t2\n')).toBe("\t");
  });

  it("칸 수가 들쭉날쭉한 후보는 감점을 먹는다 — 일정한 쪽이 이긴다", () => {
    // 세미콜론은 줄마다 2개로 일정하고, 수직선은 0/3/1로 흔들린다.
    expect(sniffDelimiter("a;b;c\nd|e|f|g;h;i\nj;k;l|m\n")).toBe(";");
  });

  it("구분자가 하나도 없으면 쉼표로 물러나고, 그때 columns가 1로 신호를 준다", () => {
    expect(sniffDelimiter("한 줄짜리\n또 한 줄\n")).toBe(",");
    expect(readCsv(bytes("한 줄짜리\n또 한 줄\n")).columns).toBe(1);
  });

  it("빈 파일에도 답을 낸다(쉼표) — 추론이 예외를 던지지 않는다", () => {
    expect(sniffDelimiter("")).toBe(",");
    expect(readCsv(bytes("")).delimiter).toBe(",");
  });

  it("손으로 고른 구분자가 추론을 이긴다", () => {
    const read = readCsv(bytes("a;b\nc;d\n"), "Sheet1", { delimiter: "," });
    expect(read.delimiter).toBe(",");
    expect(read.columns).toBe(1);
    expect(valueAt(read.sheet, 0, 0)).toBe("a;b");
  });
});

// ────────────────────────────────────────────────────────────────
describe("RFC 4180 파싱", () => {
  it('따옴표 안의 ""는 따옴표 한 개다', () => {
    expect(parseRows('a,"b""c",d', ",")).toEqual([["a", 'b"c', "d"]]);
    expect(parseRows('"""",x', ",")).toEqual([['"', "x"]]);
  });

  it("따옴표 안의 구분자와 줄바꿈은 글자다 — 칸도 줄도 나뉘지 않는다", () => {
    expect(parseRows('"a,b","1\n2"', ",")).toEqual([["a,b", "1\n2"]]);
    expect(parseRows('"1\r\n2",x', ",")).toEqual([["1\r\n2", "x"]]);
  });

  it("마지막 줄에 개행이 없어도 그 줄을 잃지 않는다", () => {
    expect(parseRows("a,b\nc,d", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("마지막 줄의 개행은 빈 줄을 하나 더 만들지 않는다", () => {
    expect(parseRows("a,b\n", ",")).toEqual([["a", "b"]]);
    expect(parseRows("a,b\r\n", ",")).toEqual([["a", "b"]]);
  });

  it("CRLF는 줄바꿈 하나다 — \\r가 칸 끝에 묻어 들어가지 않는다", () => {
    expect(parseRows("a,b\r\nc,d\r\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("빈 입력은 빈 표다", () => {
    expect(parseRows("", ",")).toEqual([]);
  });

  it("가운데의 빈 칸은 남고, 줄 끝의 빈 칸도 파싱 단계에서는 남는다", () => {
    expect(parseRows("a,,c\n", ",")).toEqual([["a", "", "c"]]);
    expect(parseRows("a,b,\n", ",")).toEqual([["a", "b", ""]]);
    expect(parseRows(",,\n", ",")).toEqual([["", "", ""]]);
  });

  it("칸 한가운데의 따옴표는 인용부호가 아니라 글자다", () => {
    // 3인치를 뜻하는 3" 같은 값이 통째로 사라지면 안 된다.
    expect(parseRows('3",a', ",")).toEqual([['3"', "a"]]);
  });

  it("탭 구분에서는 쉼표가 그냥 글자다", () => {
    expect(parseRows("1,5\t2,5\n", "\t")).toEqual([["1,5", "2,5"]]);
  });
});

// ────────────────────────────────────────────────────────────────
describe("안전 정수 밖의 숫자열은 수가 아니라 글자로 남는다 (2^53 경계)", () => {
  it("2^53−1(9007199254740991)은 수로 읽는다", () => {
    expect(parseInput("9007199254740991").value).toBe(9007199254740991);
    expect(valueAt(readCsv(bytes("9007199254740991\n")).sheet, 0, 0)).toBe(9007199254740991);
  });

  it("2^53(9007199254740992)부터는 글자로 남긴다 — double이 담지 못하는 자리다", () => {
    expect(parseInput("9007199254740992").value).toBe("9007199254740992");
    expect(valueAt(readCsv(bytes("9007199254740992\n")).sheet, 0, 0)).toBe("9007199254740992");
  });

  it("음수 쪽 경계도 같다 — −2^53−1은 글자다", () => {
    expect(parseInput("-9007199254740991").value).toBe(-9007199254740991);
    expect(parseInput("-9007199254740993").value).toBe("-9007199254740993");
  });

  it("19자리 송장번호는 지수 표기로 굳지 않는다", () => {
    const out = textOf(roundTrip(bytes("송장\n1234567890123456789\n"), { bom: false, newline: "\n" }));
    expect(out).toBe("송장\n1234567890123456789\n");
    expect(out).not.toMatch(/[eE]\+/);
  });

  it("16자리 주문번호는 수로 읽히지만 표기는 그대로다 — 1e15부터 지수로 떨어뜨리던 버그", () => {
    expect(parseInput("1234567890123456").value).toBe(1234567890123456);
    expect(cellText({ v: 1234567890123456 })).toBe("1234567890123456");
  });

  it("소수점을 찍은 지수 표기는 수로 받되, 원문 표기는 raw가 지킨다", () => {
    // "1.23E+20"은 애초에 근삿값을 적은 것이라 수로 받는다. 다만 표시는 원문이 이긴다.
    const read = readCsv(bytes("1.23E+20\n"));
    expect(valueAt(read.sheet, 0, 0)).toBe(1.23e20);
    expect(read.sheet.cells.get(cellKey(0, 0))?.raw).toBe("1.23E+20");
    expect(cellText(read.sheet.cells.get(cellKey(0, 0)))).toBe("1.23E+20");
  });
});

// ────────────────────────────────────────────────────────────────
describe("원문 보존 — 표시가 원문과 달라지는 칸만 raw를 든다", () => {
  it('"1.50"은 값 1.5를 갖되 보이기는 "1.50"이다 — 합계도 되고 표기도 안 바뀐다', () => {
    const read = readCsv(bytes("1.50\n"));
    const cell = read.sheet.cells.get(cellKey(0, 0));
    expect(cell?.v).toBe(1.5);
    expect(cell?.raw).toBe("1.50");
    expect(cellText(cell)).toBe("1.50");
    expect(read.preserved).toBe(1);
  });

  it("앞자리 0이 있는 전화번호는 애초에 수로 해석하지 않는다", () => {
    const cell = readCsv(bytes("01012345678\n")).sheet.cells.get(cellKey(0, 0));
    expect(cell?.v).toBe("01012345678");
    expect(cell?.raw).toBeUndefined(); // 표시가 원문과 같으니 raw를 들 이유가 없다
  });

  it("표기만 다른 날짜는 값은 일련번호로, 표시는 원문으로 남는다", () => {
    const cell = readCsv(bytes("2024/01/05\n")).sheet.cells.get(cellKey(0, 0));
    expect(typeof cell?.v).toBe("number");
    expect(cell?.s?.numFmt).toBe("yyyy-mm-dd");
    expect(cell?.raw).toBe("2024/01/05");
  });

  it("표시와 원문이 같은 날짜는 raw를 들지 않는다 — 쓸데없는 무게를 안 진다", () => {
    const read = readCsv(bytes("2024-01-05\n"));
    expect(read.sheet.cells.get(cellKey(0, 0))?.raw).toBeUndefined();
    expect(read.preserved).toBe(0);
  });

  it("수식 셀은 raw를 들지 않는다 — 원문은 f가 이미 갖고 있다", () => {
    const cell = readCsv(bytes("=SUM(A1:A2)\n")).sheet.cells.get(cellKey(0, 0));
    expect(cell?.f).toBe("SUM(A1:A2)");
    expect(cell?.raw).toBeUndefined();
  });

  it("표시형식을 한 번이라도 고르면 그 칸은 원문을 놓는다 — 사용자가 표현을 정했다", () => {
    const sheet = readCsv(bytes("1.50\n")).sheet;
    expect(cellText(sheet.cells.get(cellKey(0, 0)))).toBe("1.50");
    applyStyle(sheet, { top: 0, left: 0, bottom: 0, right: 0 }, { numFmt: "0.0" });
    expect(sheet.cells.get(cellKey(0, 0))?.raw).toBeUndefined();
    expect(cellText(sheet.cells.get(cellKey(0, 0)))).toBe("1.5");
  });

  it("표시형식과 무관한 서식(굵게)은 원문을 놓지 않는다", () => {
    const sheet = readCsv(bytes("1.50\n")).sheet;
    applyStyle(sheet, { top: 0, left: 0, bottom: 0, right: 0 }, { bold: true });
    expect(sheet.cells.get(cellKey(0, 0))?.raw).toBe("1.50");
  });

  it("값을 새로 넣은 칸은 더 이상 '파일에서 온 그대로'가 아니다", () => {
    const sheet = readCsv(bytes("1.50\n")).sheet;
    putCell(sheet, 0, 0, { v: 2 });
    expect(sheet.cells.get(cellKey(0, 0))?.raw).toBeUndefined();
    expect(cellText(sheet.cells.get(cellKey(0, 0)))).toBe("2");
  });

  it("서식 지우기는 표시형식까지 걷어내므로 원문 보존도 거기서 끝난다", () => {
    const sheet = readCsv(bytes("2024/01/05\n")).sheet;
    clearStyles(sheet, { top: 0, left: 0, bottom: 0, right: 0 });
    expect(sheet.cells.get(cellKey(0, 0))?.raw).toBeUndefined();
  });

  it("텍스트로 굳히기는 원문이 있으면 그 원문을 값으로 되찾는다", () => {
    const sheet = readCsv(bytes("1.50\n")).sheet;
    expect(forceText(sheet, { top: 0, left: 0, bottom: 0, right: 0 })).toBe(1);
    const cell = sheet.cells.get(cellKey(0, 0));
    expect(cell?.v).toBe("1.50");
    expect(cell?.s?.numFmt).toBe("@");
    expect(cellText(cell)).toBe("1.50");
  });

  it("첫 줄이 머리글로 보이면 굵게+틀고정이 붙되 글자는 손대지 않는다", () => {
    const read = readCsv(bytes("이름,수량\n김,3\n"));
    expect(read.headerLikely).toBe(true);
    expect(read.sheet.frozenRows).toBe(1);
    expect(read.sheet.cells.get(cellKey(0, 0))?.s?.bold).toBe(true);
    expect(cellText(read.sheet.cells.get(cellKey(0, 0)))).toBe("이름");
  });
});

// ────────────────────────────────────────────────────────────────
describe("CSV 왕복 — 읽고 다시 쓰면 바이트가 같다", () => {
  it("표기가 잘 바뀌는 칸들을 한 줄에 모아도 바이트가 그대로다", () => {
    const src =
      "이름,수량,단가,전화,송장,비고,날짜\r\n" +
      '"김,철수",1.50,"1,234",01012345678,1234567890123456789,"그는 ""안녕""이라 했다",2024/01/05\r\n';
    const input = bomBytes(src);
    expect(Array.from(roundTrip(input))).toEqual(Array.from(input));
  });

  it("칸 안의 줄바꿈과 앞뒤 공백도 왕복에서 살아남는다", () => {
    const src = 'a,"1행\r\n2행"\r\nb," 공백 "\r\n';
    const input = bomBytes(src);
    expect(Array.from(roundTrip(input))).toEqual(Array.from(input));
  });

  it("탭 구분(TSV)도 그대로 왕복한다", () => {
    const src = "이름\t값\r\n가\t1.50\r\n";
    const input = bomBytes(src);
    const read = readCsv(input);
    expect(read.delimiter).toBe("\t");
    expect(Array.from(roundTrip(input))).toEqual(Array.from(input));
  });

  it("BOM 없는 LF 파일은 BOM 없는 LF로 돌려줄 수 있다 — 옵션이 모양을 정한다", () => {
    const src = "a,b\nc,1.50\n";
    const out = roundTrip(bytes(src), { bom: false, newline: "\n" });
    expect(textOf(out)).toBe(src);
    expect(out[0]).not.toBe(0xef);
  });

  it("cp949 파일을 읽어도 글자는 보존된다(내보내기는 언제나 UTF-8)", () => {
    // cp949 "한글,1.50\n"
    const src = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31, 0x2e, 0x35, 0x30, 0x0a]);
    expect(textOf(roundTrip(src, { bom: false, newline: "\n" }))).toBe("한글,1.50\n");
  });

  it("가운데 빈 칸은 왕복에서 자리를 지킨다 — 열이 밀리면 받는 쪽이 파일을 거부한다", () => {
    const src = "a,,c\n";
    expect(textOf(roundTrip(bytes(src), { bom: false, newline: "\n" }))).toBe(src);
  });

  it("두 번 왕복해도 더는 변하지 않는다(멱등)", () => {
    const src = bomBytes('제목,값\r\n"1,234",1.50\r\n');
    const once = roundTrip(src);
    expect(Array.from(roundTrip(once))).toEqual(Array.from(once));
  });

  it("[알려진 예외] 따옴표 없이 앞뒤 공백이 있던 칸은 저장할 때 따옴표가 붙는다", () => {
    // 공백이 잘려 나가는 것보다 낫다는 선택이다(값은 그대로). 대신 바이트는 달라진다.
    const out = textOf(roundTrip(bytes("  x  ,a\n"), { bom: false, newline: "\n" }));
    expect(out).toBe('"  x  ",a\n');
  });

  it("마지막 열이 빈 줄도 바이트가 그대로다 — 메모를 안 적었다고 열이 사라지면 안 된다", () => {
    const src = "이름,메모\r\n김,\r\n";
    const input = bomBytes(src);
    expect(Array.from(roundTrip(input))).toEqual(Array.from(input));
  });
});

// ────────────────────────────────────────────────────────────────
// 표는 네모다. 열 수는 (1) 값이 든 칸의 오른쪽 끝과 (2) 원문에서 본 열 수 중
// 넓은 쪽으로 정하고, 모든 줄을 그 폭에 맞춰 쓴다. 예전엔 줄마다 오른쪽 끝의 빈
// 칸을 떨어냈다 — "이름,메모\r\n김,\r\n"이 왕복만으로 "김"이 되어 받는 쪽에서
// 열이 밀렸다(CLAUDE.md 23번의 "왕복이 바이트 단위로 같다"를 정면으로 깨는 것).
describe("표의 열 수 — 왕복해도 줄지 않는다", () => {
  const opts = (over: Partial<CsvWriteOptions> = {}): CsvWriteOptions => ({
    ...DEFAULT_CSV_WRITE,
    bom: false,
    newline: "\n",
    ...over,
  });

  const noBomTrip = (src: string): string =>
    textOf(roundTrip(bytes(src), { bom: false, newline: "\n" }));

  it("값이 든 칸이 정하는 폭에 모든 줄을 맞춘다 — 짧은 줄은 빈 칸으로 채운다", () => {
    // 첫 줄이 3열이라 이 표는 3열이다. 둘째 줄도 3열로(칸 두 개는 비어서) 나가야 한다.
    expect(noBomTrip("a,b,c\nd\n")).toBe("a,b,c\nd,,\n");
  });

  it("줄 끝 빈 칸이 여러 개여도 자리를 지킨다", () => {
    expect(noBomTrip("a,b,c\r\nd,,\r\n")).toBe("a,b,c\nd,,\n");
  });

  it("원문 전체가 빈 마지막 열도 살아남는다 — 읽을 때 본 열 수를 기억한다", () => {
    // 값이 든 칸만 보면 2열이지만, 원문은 3열짜리 표다. 그 3열을 기억해서 되돌려 준다.
    const read = readCsv(bytes("a,b,\nc,d,\n"));
    expect(read.columns).toBe(3);
    expect(read.sheet.srcCols).toBe(3);
    expect(noBomTrip("a,b,\nc,d,\n")).toBe("a,b,\nc,d,\n");
  });

  it("빈 열이 둘이어도 원문 열 수 그대로 나간다", () => {
    expect(noBomTrip("a,b,,\nc,d,,\n")).toBe("a,b,,\nc,d,,\n");
  });

  it("새로 만든 표에는 기억할 원문이 없다 — 빈 열을 지어내지 않는다", () => {
    // emptySheet의 cols는 26이지만 그건 화면 크기일 뿐 표의 열 수가 아니다.
    const sheet = emptySheet("Sheet1");
    expect(sheet.srcCols).toBeUndefined();
    putCell(sheet, 0, 0, { v: "x" });
    putCell(sheet, 1, 1, { v: "y" });
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("x,\n,y\n");
  });

  it("빈 줄은 빈 줄로 남는다 — 원문에 없던 구분자를 지어내지 않는다", () => {
    expect(noBomTrip("a,b\n\nc,d\n")).toBe("a,b\n\nc,d\n");
  });

  it("탭 구분에서도 줄 끝 빈 칸이 자리를 지킨다", () => {
    const src = "이름\t메모\r\n김\t\r\n";
    const input = bomBytes(src);
    expect(readCsv(input).delimiter).toBe("\t");
    expect(Array.from(roundTrip(input))).toEqual(Array.from(input));
  });

  it("줄 끝이 비어도 두 번 왕복하면 더는 변하지 않는다(멱등)", () => {
    const once = roundTrip(bomBytes("이름,메모,비고\r\n김,,\r\n"));
    expect(Array.from(roundTrip(once))).toEqual(Array.from(once));
  });

  it("열을 지우면 기억한 열 수도 같이 줄어든다 — 지운 열이 파일에 남지 않는다", () => {
    const sheet = readCsv(bytes("a,b,\nc,d,\n")).sheet;
    deleteCols(sheet, 2, 1, (f) => f); // 빈 셋째 열을 지운다
    expect(sheet.srcCols).toBe(2);
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a,b\nc,d\n");
  });

  it("표 밖(오른쪽)의 열을 지우는 것은 표의 열 수를 건드리지 않는다", () => {
    const sheet = readCsv(bytes("a,b,\nc,d,\n")).sheet;
    deleteCols(sheet, 9, 1, (f) => f);
    expect(sheet.srcCols).toBe(3);
  });

  it("열을 끼워 넣으면 기억한 열 수도 같이 늘어난다", () => {
    const sheet = readCsv(bytes("a,b,\nc,d,\n")).sheet;
    insertCols(sheet, 1, 1, (f) => f);
    expect(sheet.srcCols).toBe(4);
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a,,b,\nc,,d,\n");
  });

  it("표 오른쪽 바깥에 끼워 넣은 열은 표를 넓히지 않는다", () => {
    const sheet = readCsv(bytes("a,b,\nc,d,\n")).sheet;
    insertCols(sheet, 5, 2, (f) => f);
    expect(sheet.srcCols).toBe(3);
  });

  it("표의 오른쪽 끝에 딱 붙여 끼워 넣은 열은 표 밖이다 — 경계는 열 수와 같은 자리다", () => {
    // 3열짜리 표(0·1·2)에 at=3은 표 다음 칸이다. `at < srcCols`가 거짓이어야 한다.
    const sheet = readCsv(bytes("a,b,\nc,d,\n")).sheet;
    insertCols(sheet, 3, 1, (f) => f);
    expect(sheet.srcCols).toBe(3);
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a,b,\nc,d,\n");
  });

  it("표 안에서 시작해 밖까지 걸친 삭제는 표 안의 몫만큼만 줄인다", () => {
    // 3열 표에서 1열부터 5개를 지운다 — 표 안에 있던 건 1·2 두 개뿐이다.
    const sheet = readCsv(bytes("a,b,\nc,d,\n")).sheet;
    deleteCols(sheet, 1, 5, (f) => f);
    expect(sheet.srcCols).toBe(1);
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a\nc\n");
  });

  it("빈 칸이 든 줄에서도 수식·표시형식 규칙은 그대로다", () => {
    const sheet = readCsv(bytes("합,메모\n1.50,\n")).sheet;
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("합,메모\n1.50,\n");
  });

  it("수식으로 내보낼 때도 줄 끝 빈 칸이 자리를 지킨다", () => {
    const sheet = readCsv(bytes("이름,메모\n김,\n")).sheet;
    expect(textOf(writeCsv(sheet, renderer(sheet), opts({ formulas: true })))).toBe(
      "이름,메모\n김,\n",
    );
  });

  it("[알려진 예외] 칸이 전부 빈 줄은 빈 줄이 되어 나간다 — 읽고 나면 둘을 가를 수 없다", () => {
    // 셀은 희소 Map이라 ",\n"도 "\n"도 읽고 나면 "셀이 없는 줄"로 똑같아진다.
    // 둘 중 하나만 되살릴 수 있는데, 흔한 쪽(원문의 빈 줄)을 지키는 편을 골랐다.
    // 그래서 여기서만 바이트가 달라진다.
    expect(noBomTrip("a,b\n,\nc,d\n")).toBe("a,b\n\nc,d\n");
  });
});

// ────────────────────────────────────────────────────────────────
describe("쓰기 규칙 (writeCsv)", () => {
  const opts = (over: Partial<CsvWriteOptions> = {}): CsvWriteOptions => ({
    ...DEFAULT_CSV_WRITE,
    bom: false,
    newline: "\n",
    ...over,
  });

  it("구분자·따옴표·줄바꿈·앞뒤 공백이 든 칸만 따옴표로 감싼다", () => {
    const sheet = readCsv(bytes('평범,"a,b","q""q","x\ny", 공백 \n')).sheet;
    const out = textOf(writeCsv(sheet, renderer(sheet), opts()));
    expect(out).toBe('평범,"a,b","q""q","x\ny"," 공백 "\n');
  });

  it("기본값은 BOM을 붙이는 쪽이다 — 엑셀이 UTF-8 CSV의 한글을 깨뜨리기 때문", () => {
    expect(DEFAULT_CSV_WRITE.bom).toBe(true);
    expect(DEFAULT_CSV_WRITE.newline).toBe("\r\n");
    const sheet = readCsv(bytes("가\n")).sheet;
    expect(Array.from(writeCsv(sheet, renderer(sheet), DEFAULT_CSV_WRITE).slice(0, 3))).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });

  it("수식 셀은 기본이 계산된 값이고, 옵션을 켜면 '=' 붙은 원문이 나간다", () => {
    const sheet = readCsv(bytes("=SUM(A2:A3)\n")).sheet;
    putCell(sheet, 0, 0, { v: 7 }); // 재계산 결과가 들어간 셈 치고
    expect(textOf(writeCsv(sheet, renderer(sheet), opts({ formulas: false })))).toBe("7\n");
    expect(textOf(writeCsv(sheet, renderer(sheet), opts({ formulas: true })))).toBe("=SUM(A2:A3)\n");
  });

  it("구분자를 바꿔 내보내면 따옴표가 필요한 칸도 따라 바뀐다", () => {
    const sheet = readCsv(bytes('"a,b";"c;d"\n')).sheet; // 세미콜론 구분으로 읽힌다
    const asComma = textOf(writeCsv(sheet, renderer(sheet), opts({ delimiter: "," })));
    expect(asComma).toBe('"a,b",c;d\n');
    const asTab = textOf(writeCsv(sheet, renderer(sheet), opts({ delimiter: "\t" as Delimiter })));
    expect(asTab).toBe("a,b\tc;d\n");
  });

  it("파일은 언제나 개행으로 끝난다", () => {
    const sheet = readCsv(bytes("a,b")).sheet; // 원본엔 마지막 개행이 없다
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a,b\n");
  });

  it("빈 시트는 개행 한 줄이다(빈 바이트가 아니다)", () => {
    const sheet = readCsv(bytes("")).sheet;
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("\n");
  });

  it("원문을 되살리는 자리는 하나다 — 파일에는 렌더러가 준 글자가 그대로 나간다", () => {
    // writeCsv 안에 `cell.raw ?? render(...)`가 한 줄 더 있었다. cellText가 첫 줄에서
    // 하는 일이라 동작은 같았지만, 규약이 두 자리에 적히면 한쪽만 고쳐 놓고 고쳤다고
    // 여기게 된다. 렌더러를 다른 것으로 바꿔 통로가 하나인지 확인한다.
    const sheet = readCsv(bytes("1.50\n")).sheet;
    expect(sheet.cells.get(cellKey(0, 0))?.raw).toBe("1.50");
    expect(textOf(writeCsv(sheet, () => "다른 글자", opts()))).toBe("다른 글자\n");
    // 앱이 넘기는 렌더러(cellText)로는 원문이 그대로 나간다.
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("1.50\n");
  });
});

// ────────────────────────────────────────────────────────────────
// 서식만 든 칸(값·수식·원문이 없고 `s`만 있는 칸)은 CSV에서 아무 글자도 아니다.
// 빈 줄·빈 열까지 골라 굵게 한 번이면 생기는 칸인데, 표의 일부로 세면 원문의 빈 줄이
// ";;;;"가 되고 오른쪽에 빈 열이 붙었다. CSV는 서식을 담지 못하므로 사용자가 얻는 것
// 없이 파일만 달라진다(CLAUDE.md 23번).
//
// 고친 자리는 내보내기 쪽이다(model.ts의 `hasContent` 하나를 csv.ts의 writeCsv와
// convert.ts의 toGrid가 함께 쓴다) — 서식을 거는 applyStyle은 그대로 칸을 만든다.
// xlsx에서는 그 칸이 파일에 나가기 때문이고, 그 사실은 tests/sheet-roundtrip.test.ts가
// 못 박는다. 마크다운·JSON 쪽 명세는 아래 describe에 있다.
describe("서식만 든 칸은 CSV의 표를 넓히지 않는다", () => {
  const opts = (over: Partial<CsvWriteOptions> = {}): CsvWriteOptions => ({
    ...DEFAULT_CSV_WRITE,
    bom: false,
    newline: "\n",
    ...over,
  });

  const SRC = "a,b\n\nc,d\n";

  function styledTrip(area: { top: number; left: number; bottom: number; right: number }): string {
    const sheet = readCsv(bytes(SRC)).sheet;
    applyStyle(sheet, area, { bold: true });
    return textOf(writeCsv(sheet, renderer(sheet), opts()));
  }

  it("빈 줄에 서식을 걸어도 빈 줄이다", () => {
    expect(styledTrip({ top: 1, left: 0, bottom: 1, right: 1 })).toBe(SRC);
  });

  it("표 오른쪽 빈 열에 서식을 걸어도 열이 안 는다", () => {
    expect(styledTrip({ top: 0, left: 0, bottom: 2, right: 9 })).toBe(SRC);
  });

  it("표 아래 빈 줄에 서식을 걸어도 줄이 안 는다", () => {
    expect(styledTrip({ top: 3, left: 0, bottom: 40, right: 1 })).toBe(SRC);
  });

  it("값이 든 칸의 서식은 줄을 지우지 않는다 — 빈 칸만 안 세는 것이다", () => {
    expect(styledTrip({ top: 0, left: 0, bottom: 2, right: 1 })).toBe(SRC);
  });

  it("서식만 든 칸이라도 값을 넣으면 그 줄이 다시 표에 든다", () => {
    // 경계의 반대쪽. `hasContent`가 값을 못 보면 이 줄이 빈 줄로 나간다.
    const sheet = readCsv(bytes(SRC)).sheet;
    applyStyle(sheet, { top: 1, left: 0, bottom: 1, right: 1 }, { bold: true });
    putCell(sheet, 1, 1, { v: "x" });
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a,b\n,x\nc,d\n");
  });

  it("수식만 든 칸도 표에 든다 — 값이 아직 null이어도 글자가 나간다", () => {
    const sheet = emptySheet("Sheet1");
    putCell(sheet, 0, 0, { v: "a" });
    putCell(sheet, 1, 0, { v: null, f: "SUM(A1:A1)" });
    expect(textOf(writeCsv(sheet, renderer(sheet), opts({ formulas: true })))).toBe(
      "a\n=SUM(A1:A1)\n",
    );
  });

  it("서식만 든 칸으로 이뤄진 시트는 개행 한 줄이다 — 빈 시트와 같다", () => {
    const sheet = emptySheet("Sheet1");
    applyStyle(sheet, { top: 0, left: 0, bottom: 3, right: 3 }, { bold: true });
    expect(sheet.cells.size).toBe(16); // 칸은 생겼다(xlsx가 쓴다)
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("\n");
  });

  it("서식이 남은 줄의 내용을 지우면 그 줄은 빈 줄로 나간다", () => {
    // 서식만 든 칸은 applyStyle 말고 Delete로도 생긴다 — clearContents가 서식을 남긴다.
    // 머리글(읽을 때 굵게가 걸린다)을 지우면 그 줄에 칸은 남지만 글자가 없다.
    // 예전에는 여기가 ",\n김,1\n"이었다. 판정을 값에 걸었으니 이쪽도 같이 움직인다.
    const sheet = readCsv(bytes("이름,값\n김,1\n")).sheet;
    clearContents(sheet, { top: 0, left: 0, bottom: 0, right: 1 });
    expect(sheet.cells.get(cellKey(0, 0))?.s?.bold).toBe(true); // 칸은 남아 있다
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("\n김,1\n");
  });

  it("값이 아직 null이어도 원문이 있으면 그 글자가 나간다", () => {
    // `hasContent`의 세 갈래 중 원문(raw)만 남은 경계다. 값·수식만 보게 줄이면
    // cellText는 "0100"을 그리는데 그 줄이 빈 줄이 되어 글자가 사라진다.
    const sheet = emptySheet("Sheet1");
    putCell(sheet, 0, 0, { v: "a" });
    sheet.cells.set(cellKey(1, 0), { v: null, raw: "0100" });
    expect(cellText(sheet.cells.get(cellKey(1, 0)))).toBe("0100");
    expect(textOf(writeCsv(sheet, renderer(sheet), opts()))).toBe("a\n0100\n");
  });
});

// ────────────────────────────────────────────────────────────────
// 같은 판정을 마크다운·JSON·HTML 내보내기(convert.ts의 toGrid)도 쓴다. 예전엔 여기만
// 옛 방식이라, 빈 줄에 굵게를 걸면 마크다운 표에 빈 줄이 하나 늘고 JSON에 빈 객체가
// 하나 늘었다(CSV만 고친 뒤 남아 있던 자리다). 서식은 세 형식 어디에도 안 실린다.
describe("서식만 든 칸은 마크다운·JSON 표도 넓히지 않는다", () => {
  const SRC = "이름,값\n\n김,1\n";

  /** 같은 시트를 서식 없이 / 빈 줄·빈 열까지 골라 굵게 한 뒤 내보낸다. */
  function bothWays(format: "markdown" | "json" | "html"): { plain: string; styled: string } {
    const a = readCsv(bytes(SRC)).sheet;
    const b = readCsv(bytes(SRC)).sheet;
    applyStyle(b, { top: 0, left: 0, bottom: 4, right: 3 }, { bold: true });
    return {
      plain: exportText(a, renderer(a), format),
      styled: exportText(b, renderer(b), format),
    };
  }

  it("마크다운 표는 굵게를 걸기 전과 같다", () => {
    const { plain, styled } = bothWays("markdown");
    expect(styled).toBe(plain);
    // 원문의 빈 줄은 그대로 한 줄이다 — 서식이 만든 줄이 뒤에 붙지 않는다.
    expect(styled.split("\n")).toHaveLength(4); // 머리글·구분선·빈 줄·김
    expect(styled).not.toContain("| 열3 |");
  });

  it("JSON은 빈 객체가 늘지 않는다", () => {
    const { plain, styled } = bothWays("json");
    expect(styled).toBe(plain);
    expect(JSON.parse(styled)).toEqual([
      { 이름: null, 값: null },
      { 이름: "김", 값: 1 },
    ]);
  });

  it("HTML 표도 같다", () => {
    const { plain, styled } = bothWays("html");
    expect(styled).toBe(plain);
  });

  it("서식만 든 칸으로 이뤄진 시트는 내보낼 것이 없다", () => {
    const sheet = emptySheet("Sheet1");
    applyStyle(sheet, { top: 0, left: 0, bottom: 3, right: 3 }, { bold: true });
    expect(exportText(sheet, renderer(sheet), "json")).toBe("[]");
    expect(exportText(sheet, renderer(sheet), "markdown")).toBe("");
  });

  it("값을 넣으면 그 줄과 열이 다시 표에 든다 — 경계의 반대쪽", () => {
    const sheet = readCsv(bytes(SRC)).sheet;
    applyStyle(sheet, { top: 0, left: 0, bottom: 4, right: 3 }, { bold: true });
    putCell(sheet, 3, 2, { v: "끝" });
    const json = JSON.parse(exportText(sheet, renderer(sheet), "json"));
    expect(json).toHaveLength(3);
    expect(json[2]).toEqual({ 이름: null, 값: null, 열3: "끝" });
  });
});
