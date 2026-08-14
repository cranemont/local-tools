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
import { applyStyle, cellText, clearStyles, forceText, parseInput, putCell } from "../apps/sheet/src/lib/sheet/model";
import type { SheetDoc } from "../apps/sheet/src/lib/sheet/types";

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

  it("[알려진 예외] 줄 끝의 빈 칸은 떨어져 나간다 — 여기서만 바이트가 달라진다", () => {
    const src = "이름,메모\r\n김,\r\n";
    // 둘째 줄의 빈 메모 칸이 사라진다(writeCsv가 오른쪽 끝 빈 칸을 떨어낸다).
    expect(textOf(roundTrip(bomBytes(src))).replace("﻿", "")).toBe("이름,메모\r\n김\r\n");
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
});
