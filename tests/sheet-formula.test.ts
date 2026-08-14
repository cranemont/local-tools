/**
 * 시트 수식 엔진의 명세.
 *
 * 이 엔진은 직접 짠 것이다(완성품인 HyperFormula가 GPLv3라서). 그래서 "엑셀이라면
 * 이렇게 답한다"는 규칙이 코드 주석이 아니라 여기 실행 가능한 형태로 있어야 한다.
 * 기대값은 구현을 베낀 것이 아니라 엑셀의 동작(또는 손으로 센 값)이다.
 *
 * 날짜 일련번호 기준점: 2024-01-01 = 45292 → 2026-01-01 = 46023 → 2026-08-14 = 46248.
 */

import { describe, expect, it } from "vitest";
import { cellKey, parseRef } from "../apps/sheet/src/lib/sheet/a1";
import {
  emptySheet,
  emptyWorkbook,
  isError,
  type Cell,
  type Scalar,
  type SheetDoc,
  type WorkbookDoc,
} from "../apps/sheet/src/lib/sheet/types";
import { formulaError, recalculate } from "../apps/sheet/src/lib/formula/engine";
import {
  adjustCols,
  adjustRows,
  stringify,
  translateFormula,
} from "../apps/sheet/src/lib/formula/adjust";
import { fromJs, toJs } from "../apps/sheet/src/lib/formula/functions";
import { parseFormula } from "../apps/sheet/src/lib/formula/parse";
import { FormulaSyntaxError, tokenize } from "../apps/sheet/src/lib/formula/tokenize";

// ── 도구 ────────────────────────────────────────────────────────────

function put(sheet: SheetDoc, a1: string, cell: Cell): void {
  const ref = parseRef(a1);
  if (!ref) throw new Error(`주소가 아님: ${a1}`);
  sheet.cells.set(cellKey(ref.row, ref.col), cell);
}

function cellAt(book: WorkbookDoc, a1: string, si = 0): Cell | undefined {
  const ref = parseRef(a1);
  if (!ref) throw new Error(`주소가 아님: ${a1}`);
  return book.sheets[si].cells.get(cellKey(ref.row, ref.col));
}

/** 오류는 코드 문자열로 바꿔 비교한다(CellError는 인스턴스라 toBe로 못 쓴다). */
function code(v: Scalar | undefined): unknown {
  return isError(v) ? v.code : v;
}

type Input = Scalar | { f: string };

function sheetOf(cells: Record<string, Input>, name = "Sheet1"): SheetDoc {
  const sheet = emptySheet(name);
  for (const [a1, v] of Object.entries(cells)) {
    if (v !== null && typeof v === "object" && !isError(v) && "f" in v) put(sheet, a1, { v: null, f: v.f });
    else put(sheet, a1, { v: v as Scalar });
  }
  return sheet;
}

/** 수식 하나를 Z1에 놓고 통합문서를 재계산한 결과. */
function calc(formula: string, cells: Record<string, Input> = {}): unknown {
  const book = emptyWorkbook();
  book.sheets[0] = sheetOf(cells);
  put(book.sheets[0], "Z1", { v: null, f: formula });
  recalculate(book);
  return code(cellAt(book, "Z1")?.v);
}

// ── 토큰화 ──────────────────────────────────────────────────────────

describe("토큰화", () => {
  it("문자열 안의 두 겹 따옴표는 한 글자 따옴표로 푼다", () => {
    const toks = tokenize('"그는 ""안녕""이라 했다"');
    expect(toks).toHaveLength(1);
    expect(toks[0].kind).toBe("str");
    expect(toks[0].text).toBe('그는 "안녕"이라 했다');
  });

  it("따옴표가 닫히지 않으면 어디서 열렸는지를 알려 준다", () => {
    expect(() => tokenize('1+"열기만')).toThrowError(FormulaSyntaxError);
    try {
      tokenize('1+"열기만');
    } catch (e) {
      expect((e as FormulaSyntaxError).pos).toBe(2);
    }
  });

  it("공백이 든 시트 이름은 작은따옴표로 감싸고 안의 '는 ''로 적는다", () => {
    const [tok] = tokenize("'It''s mine'!A1");
    expect(tok.kind).toBe("ref");
    expect(tok.sheet).toBe("It's mine");
    expect(tok.text).toBe("A1");
  });

  it("오류 리터럴(#N/A)은 이름보다 먼저 읽는다", () => {
    const [tok] = tokenize("#N/A");
    expect(tok.kind).toBe("err");
    expect(tok.text).toBe("#N/A");
  });

  it("모르는 #오류값은 조용히 넘기지 않고 문법 오류로 세운다", () => {
    expect(() => tokenize("#NOPE!")).toThrowError(FormulaSyntaxError);
  });

  it("TRUE·FALSE는 대소문자와 무관하게 논리값 토큰이다", () => {
    expect(tokenize("true")[0].kind).toBe("bool");
    expect(tokenize("True")[0].text).toBe("TRUE");
    expect(tokenize("FALSE")[0].kind).toBe("bool");
  });

  it("두 글자 비교 연산자(<= >= <>)는 한 토큰으로 붙여 읽는다", () => {
    expect(tokenize("A1<>B1").map((t) => t.text)).toEqual(["A1", "<>", "B1"]);
    expect(tokenize("A1<=B1").map((t) => t.text)).toEqual(["A1", "<=", "B1"]);
  });
});

// ── 연산자 ──────────────────────────────────────────────────────────

describe("연산자 우선순위와 결합", () => {
  it("곱셈은 덧셈보다 먼저다", () => {
    expect(calc("1+2*3")).toBe(7);
  });

  it("괄호가 우선순위를 뒤집는다", () => {
    expect(calc("(1+2)*3")).toBe(9);
  });

  it("거듭제곱은 엑셀과 같이 왼쪽 결합이다 — 2^3^2는 512가 아니라 64", () => {
    expect(calc("2^3^2")).toBe(64);
  });

  it("단항 음수는 거듭제곱보다 세게 붙는다 — -2^2는 -4가 아니라 4", () => {
    expect(calc("-2^2")).toBe(4);
  });

  it("잇기(&)는 덧셈보다 나중, 비교보다 먼저다", () => {
    expect(calc('"a"&1+2')).toBe("a3");
    expect(calc('"a"&"b"="ab"')).toBe(true);
  });

  it("비교는 제일 나중에 본다 — 1+1=2는 (1+1)=2다", () => {
    expect(calc("1+1=2")).toBe(true);
  });

  it("후위 %는 값을 100으로 나눈다", () => {
    expect(calc("50%")).toBe(0.5);
    expect(calc("1+2%")).toBe(1.02);
    expect(calc("200%*3")).toBe(6);
  });

  it("0으로 나누면 #DIV/0!이다 — 0/0도 마찬가지", () => {
    expect(calc("1/0")).toBe("#DIV/0!");
    expect(calc("0/0")).toBe("#DIV/0!");
  });

  it("거듭제곱이 무한대로 넘치면 Infinity가 아니라 #NUM!이다", () => {
    expect(calc("9^999")).toBe("#NUM!");
  });
});

describe("값의 형 변환", () => {
  it("빈 칸은 셈에서 0, 잇기에서 빈 문자열이다", () => {
    expect(calc("A1+1")).toBe(1);
    expect(calc('"x"&A1')).toBe("x");
  });

  it("빈 칸은 비교에서 상대 타입의 영값으로 읽는다 — 빈 칸은 0이면서 동시에 \"\"다", () => {
    expect(calc("A1=0")).toBe(true);
    expect(calc('A1=""')).toBe(true);
  });

  it("문자열 비교는 대소문자를 가리지 않는다", () => {
    expect(calc('"abc"="ABC"')).toBe(true);
  });

  it("타입이 다르면 수 < 글자 < 논리값 순으로 세운다", () => {
    expect(calc('1<"a"')).toBe(true);
    expect(calc('"a"<TRUE')).toBe(true);
  });

  it("숫자로 읽히는 문자열은 셈에서 수가 된다(천 단위 콤마 포함)", () => {
    expect(calc('"3"+1')).toBe(4);
    expect(calc('"1,000"+0')).toBe(1000);
  });

  it("수로 못 읽는 문자열을 셈에 쓰면 #VALUE!다", () => {
    expect(calc('"가"+1')).toBe("#VALUE!");
  });

  it("논리값은 셈에서 1/0, 잇기에서 TRUE/FALSE 글자다", () => {
    expect(calc("TRUE+TRUE")).toBe(2);
    expect(calc('TRUE&""')).toBe("TRUE");
  });
});

// ── 오류 전파 ────────────────────────────────────────────────────────

describe("오류 전파", () => {
  it("인자에 든 오류는 함수를 건너 그대로 번져 나간다", () => {
    expect(calc("SUM(A1,1)", { A1: { f: "1/0" } })).toBe("#DIV/0!");
    expect(calc("A1*2", { A1: { f: "1/0" } })).toBe("#DIV/0!");
  });

  it("오류를 다루는 게 일인 함수(COUNT 등)는 오류를 삼키지 않고 세기만 한다", () => {
    expect(calc("COUNT(A1:A2)", { A1: { f: "1/0" }, A2: 5 })).toBe(1);
    expect(calc("COUNTA(A1:A2)", { A1: { f: "1/0" }, A2: 5 })).toBe(2);
  });

  it("없는 함수 이름은 #NAME?다", () => {
    expect(calc("NOTAFUNC(1)")).toBe("#NAME?");
  });

  it("이름 정의는 아직 지원하지 않으므로 #NAME?다", () => {
    expect(calc("myRange")).toBe("#NAME?");
  });

  it("문법이 깨진 수식이 든 셀은 값을 지어내지 않고 #NAME?로 굳는다", () => {
    expect(calc("SUM(")).toBe("#NAME?");
  });

  it("수식 오류는 입력 즉시 알려 줄 수 있게 문자열로 나온다(정상 수식은 null)", () => {
    expect(formulaError("1+1")).toBeNull();
    expect(formulaError("SUM(A1:A3)")).toBeNull();
    expect(formulaError("SUM(")).toBeTypeOf("string");
    expect(formulaError("1+*2")).toBeTypeOf("string");
  });
});

// ── LAZY ────────────────────────────────────────────────────────────

describe("고른 가지만 계산한다(LAZY)", () => {
  it("IF(B1=0,\"\",A1/B1)은 B1이 0이어도 죽지 않는다 — 이것 때문에 지연 평가가 있다", () => {
    expect(calc('IF(B1=0,"",A1/B1)', { A1: 10, B1: 0 })).toBe("");
    expect(calc('IF(B1=0,"",A1/B1)', { A1: 10, B1: 2 })).toBe(5);
  });

  it("IF는 고르지 않은 가지를 아예 계산하지 않는다", () => {
    expect(calc('IF(FALSE,1/0,"ok")')).toBe("ok");
    expect(calc('IF(TRUE,"ok",1/0)')).toBe("ok");
  });

  it("IF의 조건이 오류면 가지를 고르지 못하고 그 오류가 나온다", () => {
    expect(calc('IF(1/0,"a","b")')).toBe("#DIV/0!");
    expect(calc('IF("가","a","b")')).toBe("#VALUE!");
  });

  it("IF의 거짓 가지를 안 적으면 FALSE다", () => {
    expect(calc('IF(FALSE,"a")')).toBe(false);
  });

  it("IFERROR는 오류일 때만 대체값을 계산한다", () => {
    expect(calc('IFERROR(1/0,"대체")')).toBe("대체");
    expect(calc("IFERROR(1,1/0)")).toBe(1);
  });

  it("IFNA는 #N/A만 잡는다 — #DIV/0!는 그대로 통과시킨다", () => {
    expect(calc('IFNA(NA(),"x")')).toBe("x");
    expect(calc('IFNA(1/0,"x")')).toBe("#DIV/0!");
  });

  it("IFS는 처음 참인 가지에서 멈춘다(뒤의 식은 계산하지 않는다)", () => {
    expect(calc('IFS(FALSE,1/0,TRUE,"두번째",TRUE,1/0)')).toBe("두번째");
  });

  it("IFS가 참인 조건을 하나도 못 찾으면 #N/A다", () => {
    expect(calc('IFS(FALSE,"a",FALSE,"b")')).toBe("#N/A");
  });

  it("SWITCH는 맞는 가지만, 없으면 마지막 홀수 인자를 기본값으로 쓴다", () => {
    expect(calc('SWITCH(2,1,"a",2,"b",3,1/0)')).toBe("b");
    expect(calc('SWITCH(9,1,"a","기본")')).toBe("기본");
  });

  it("SWITCH에 기본값도 맞는 가지도 없으면 #N/A다", () => {
    expect(calc('SWITCH(9,1,"a")')).toBe("#N/A");
  });

  it("CHOOSE는 고른 번째 인자만 계산한다", () => {
    expect(calc('CHOOSE(2,1/0,"b")')).toBe("b");
  });

  it("CHOOSE의 번호는 1부터다 — 0이나 인자 수를 넘으면 #VALUE!", () => {
    expect(calc('CHOOSE(0,"a")')).toBe("#VALUE!");
    expect(calc('CHOOSE(3,"a","b")')).toBe("#VALUE!");
    expect(calc('CHOOSE(1,"a","b")')).toBe("a");
  });

  it("소수 번호는 잘라 쓴다 — CHOOSE(2.9,…)는 두 번째다", () => {
    expect(calc('CHOOSE(2.9,"a","b")')).toBe("b");
  });
});

// ── 경계 변환 ────────────────────────────────────────────────────────

describe("formulajs 경계에서 값을 바꿔 넘긴다", () => {
  it("message가 오류 코드인 Error는 CellError가 된다", () => {
    const v = fromJs(new Error("#DIV/0!"));
    expect(isError(v)).toBe(true);
    expect(code(v)).toBe("#DIV/0!");
  });

  it("우리가 모르는 Error 메시지는 #VALUE!로 접는다", () => {
    expect(code(fromJs(new Error("boom")))).toBe("#VALUE!");
  });

  it("CellError를 formulajs로 넘길 땐 코드가 message인 Error가 된다(왕복해도 같은 코드)", () => {
    const js = toJs(fromJs(new Error("#N/A")));
    expect(js).toBeInstanceOf(Error);
    expect((js as Error).message).toBe("#N/A");
    expect(code(fromJs(js))).toBe("#N/A");
  });

  it("JS Date는 엑셀 일련번호로 바뀐다 — 문서는 스칼라만 담는다", () => {
    expect(fromJs(new Date(2026, 7, 14))).toBe(46248);
    expect(calc("DATE(2026,8,14)")).toBe(46248);
  });

  it("잘못된 Date는 NaN 일련번호가 아니라 #VALUE!다", () => {
    expect(code(fromJs(new Date(Number.NaN)))).toBe("#VALUE!");
  });

  it("Infinity·NaN은 #NUM!이다", () => {
    expect(code(fromJs(Number.POSITIVE_INFINITY))).toBe("#NUM!");
    expect(code(fromJs(Number.NaN))).toBe("#NUM!");
  });

  it("undefined·null은 빈 칸이다", () => {
    expect(fromJs(undefined)).toBeNull();
    expect(fromJs(null)).toBeNull();
  });

  it("배열을 돌려주는 함수는 아직 흘리지 않고 왼쪽 위 한 칸만 쓴다", () => {
    expect(fromJs([[1, 2], [3, 4]])).toBe(1);
    expect(fromJs([])).toBeNull();
  });

  it("날짜를 돌려주는 함수는 셀에 날짜 표시 형식을 달아 준다 — 안 그러면 46248로 보인다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "DATE(2026,8,14)" });
    put(book.sheets[0], "B1", { v: null, f: "TIME(1,2,3)" });
    recalculate(book);
    expect(cellAt(book, "A1")?.s?.numFmt).toBe("yyyy-mm-dd");
    expect(cellAt(book, "B1")?.s?.numFmt).toBe("hh:mm:ss");
  });

  it("날짜 셀을 더하고 뺀 식은 형식을 물려받고, 날짜−날짜는 그냥 수다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: 46248, s: { numFmt: "yyyy-mm-dd" } });
    put(book.sheets[0], "B1", { v: null, f: "A1+30" });
    put(book.sheets[0], "C1", { v: null, f: "A1-A1" });
    put(book.sheets[0], "D1", { v: null, f: "SUM(A1)" });
    recalculate(book);
    expect(cellAt(book, "B1")?.v).toBe(46278);
    expect(cellAt(book, "B1")?.s?.numFmt).toBe("yyyy-mm-dd");
    expect(cellAt(book, "C1")?.s?.numFmt).toBeUndefined();
    expect(cellAt(book, "D1")?.s?.numFmt).toBeUndefined();
  });
});

// ── NATIVE ──────────────────────────────────────────────────────────

describe("우리 값 체계를 아는 쪽에서 직접 구현한 함수(NATIVE)", () => {
  it("ISERROR는 우리 CellError를 알아본다 — formulajs에 맡기면 늘 FALSE였다", () => {
    expect(calc("ISERROR(1/0)")).toBe(true);
    expect(calc("ISERROR(1)")).toBe(false);
    expect(calc("ISERROR(A1)")).toBe(false);
  });

  it("ISERR은 #N/A만 빼고 참이고, ISNA는 #N/A만 참이다", () => {
    expect(calc("ISERR(1/0)")).toBe(true);
    expect(calc("ISERR(NA())")).toBe(false);
    expect(calc("ISNA(NA())")).toBe(true);
    expect(calc("ISNA(1/0)")).toBe(false);
  });

  it("ISBLANK는 빈 칸만 참이다 — 빈 문자열은 값이 있는 칸이다", () => {
    expect(calc("ISBLANK(A1)")).toBe(true);
    expect(calc('ISBLANK("")')).toBe(false);
    expect(calc("ISBLANK(A1)", { A1: 0 })).toBe(false);
  });

  it("ISNUMBER·ISTEXT·ISLOGICAL·ISNONTEXT는 값의 종류를 가른다", () => {
    expect(calc("ISNUMBER(1)")).toBe(true);
    expect(calc('ISNUMBER("1")')).toBe(false);
    expect(calc('ISTEXT("a")')).toBe(true);
    expect(calc("ISTEXT(1)")).toBe(false);
    expect(calc("ISLOGICAL(TRUE)")).toBe(true);
    expect(calc("ISNONTEXT(1)")).toBe(true);
  });

  it("ERROR.TYPE은 엑셀이 정한 번호를 돌려주고, 오류가 아니면 #N/A다", () => {
    expect(calc("ERROR.TYPE(1/0)")).toBe(2); // #DIV/0!
    expect(calc('ERROR.TYPE("가"+1)')).toBe(3); // #VALUE!
    expect(calc("ERROR.TYPE(NA())")).toBe(7); // #N/A
    expect(calc("ERROR.TYPE(1)")).toBe("#N/A");
  });

  it("TYPE은 수 1·글자 2·논리 4·오류 16·배열 64를 쓴다(빈 칸은 수로 친다)", () => {
    expect(calc("TYPE(1)")).toBe(1);
    expect(calc('TYPE("a")')).toBe(2);
    expect(calc("TYPE(TRUE)")).toBe(4);
    expect(calc("TYPE(1/0)")).toBe(16);
    expect(calc("TYPE(A1:A2)", { A1: 1, A2: 2 })).toBe(64);
    expect(calc("TYPE(A1)")).toBe(1);
  });

  it("N은 수와 논리값만 수로 바꾸고 글자는 0으로 만든다", () => {
    expect(calc("N(5)")).toBe(5);
    expect(calc("N(TRUE)")).toBe(1);
    expect(calc("N(FALSE)")).toBe(0);
    expect(calc('N("abc")')).toBe(0);
  });

  it("NA()는 #N/A 값이다", () => {
    expect(calc("NA()")).toBe("#N/A");
  });

  it("TEXT는 일련번호를 날짜로 그린다 — formulajs에 맡기면 46248이 그대로 나왔다", () => {
    expect(calc('TEXT(DATE(2026,8,14),"yyyy-mm-dd")')).toBe("2026-08-14");
    expect(calc('TEXT(A1,"yyyy-mm-dd")', { A1: 46248 })).toBe("2026-08-14");
  });

  it("TEXT는 수 형식도 형식 문자열대로 그린다", () => {
    expect(calc('TEXT(0.5,"0.00%")')).toBe("50.00%");
    expect(calc('TEXT(1234.56,"#,##0")')).toBe("1,235");
  });

  it("TEXT의 인자가 오류면 그 오류가 그대로 나온다", () => {
    expect(calc('TEXT(1/0,"0.00")')).toBe("#DIV/0!");
  });
});

// ── 범위 ────────────────────────────────────────────────────────────

describe("범위 참조", () => {
  it("범위의 빈 칸과 글자는 합계에서 세지 않는다", () => {
    expect(calc("SUM(A1:A4)", { A1: 1, A3: 2 })).toBe(3);
    expect(calc("SUM(A1:A3)", { A1: 1, A2: "글", A3: 2 })).toBe(3);
    expect(calc("SUM(A1:A3)")).toBe(0);
  });

  it("빈 칸은 평균의 분모에도 들어가지 않는다", () => {
    expect(calc("AVERAGE(A1:A3)", { A1: 1, A3: 3 })).toBe(2);
  });

  it("거꾸로 쓴 범위(A3:A1)도 같은 영역이다", () => {
    expect(calc("SUM(A3:A1)", { A1: 1, A2: 2, A3: 3 })).toBe(6);
  });

  it("한 칸짜리 범위와 배열 리터럴도 범위처럼 다룬다", () => {
    expect(calc("SUM(A1)", { A1: 5 })).toBe(5);
    expect(calc("SUM({1,2;3,4})")).toBe(10);
  });

  it("스칼라 자리에 범위가 오면 왼쪽 위 한 칸으로 접는다", () => {
    expect(calc("A1:A3+1", { A1: 5, A2: 9 })).toBe(6);
  });

  it("다른 시트의 셀은 시트 이름으로 가리킨다(공백이 있으면 작은따옴표)", () => {
    const book = emptyWorkbook();
    book.sheets.push(sheetOf({ A1: 7 }, "My Sheet"));
    put(book.sheets[0], "A1", { v: null, f: "'My Sheet'!A1*2" });
    recalculate(book);
    expect(cellAt(book, "A1")?.v).toBe(14);
  });

  it("없는 시트를 가리키면 #REF!다", () => {
    expect(calc("Nope!A1")).toBe("#REF!");
  });
});

// ── 재계산 ──────────────────────────────────────────────────────────

describe("재계산 순서(위상 정렬)", () => {
  it("적어 넣은 순서와 무관하게 의존 사슬이 한 번에 맞는다", () => {
    const book = emptyWorkbook();
    // 일부러 거꾸로 넣는다 — C1이 B1보다 먼저 계산되면 값이 한 박자 늦는다.
    put(book.sheets[0], "C1", { v: null, f: "B1+1" });
    put(book.sheets[0], "B1", { v: null, f: "A1+1" });
    put(book.sheets[0], "A1", { v: 1 });
    recalculate(book);
    expect(cellAt(book, "B1")?.v).toBe(2);
    expect(cellAt(book, "C1")?.v).toBe(3);
  });

  it("긴 사슬도 한 번의 재계산으로 끝까지 흐른다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: 1 });
    for (let r = 2; r <= 20; r++) put(book.sheets[0], `A${r}`, { v: null, f: `A${r - 1}+1` });
    recalculate(book);
    expect(cellAt(book, "A20")?.v).toBe(20);
  });

  it("범위를 통한 의존도 순서에 들어간다 — SUM(A1:A3)은 A1이 채워진 뒤에 돈다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "B1", { v: null, f: "SUM(A1:A3)" });
    put(book.sheets[0], "A1", { v: null, f: "1+1" });
    put(book.sheets[0], "A2", { v: 3 });
    recalculate(book);
    expect(cellAt(book, "B1")?.v).toBe(5);
  });

  it("값이 바뀌면 사슬 전체가 다시 흐른다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: 1 });
    put(book.sheets[0], "B1", { v: null, f: "A1*10" });
    put(book.sheets[0], "C1", { v: null, f: "B1+1" });
    recalculate(book);
    expect(cellAt(book, "C1")?.v).toBe(11);
    put(book.sheets[0], "A1", { v: 5 });
    recalculate(book);
    expect(cellAt(book, "C1")?.v).toBe(51);
  });
});

describe("순환 참조", () => {
  it("서로를 가리키는 두 셀은 둘 다 #CIRC!다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "B1" });
    put(book.sheets[0], "B1", { v: null, f: "A1" });
    recalculate(book);
    expect(code(cellAt(book, "A1")?.v)).toBe("#CIRC!");
    expect(code(cellAt(book, "B1")?.v)).toBe("#CIRC!");
  });

  it("세 칸을 도는 고리도 잡는다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "C1+1" });
    put(book.sheets[0], "B1", { v: null, f: "A1+1" });
    put(book.sheets[0], "C1", { v: null, f: "B1+1" });
    recalculate(book);
    for (const a1 of ["A1", "B1", "C1"]) expect(code(cellAt(book, a1)?.v)).toBe("#CIRC!");
  });

  it("고리에 걸린 셀을 참조하는 셀도 값을 지어내지 않고 #CIRC!가 된다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "B1" });
    put(book.sheets[0], "B1", { v: null, f: "A1" });
    put(book.sheets[0], "C1", { v: null, f: "A1+1" });
    recalculate(book);
    expect(code(cellAt(book, "C1")?.v)).toBe("#CIRC!");
  });

  it("자기 자신을 가리키는 셀은 #CIRC!다 — 이전 값이 남으면 안 된다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "A1" });
    put(book.sheets[0], "B1", { v: null, f: "B1+1" });
    recalculate(book);
    expect(code(cellAt(book, "A1")?.v)).toBe("#CIRC!");
    expect(code(cellAt(book, "B1")?.v)).toBe("#CIRC!");
  });

  it("멀쩡하던 셀을 자기참조로 고치면 옛 값이 남지 않고 #CIRC!로 바뀐다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: 5 });
    put(book.sheets[0], "B1", { v: null, f: "A1*2" });
    recalculate(book);
    expect(cellAt(book, "B1")?.v).toBe(10);

    put(book.sheets[0], "B1", { v: null, f: "B1*2" });
    recalculate(book);
    expect(code(cellAt(book, "B1")?.v)).toBe("#CIRC!");
  });

  it("범위가 자기 칸을 품으면 순환이다 — SUM(D1:D3)이 D1에서 0을 내놓던 자리", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "D1", { v: null, f: "SUM(D1:D3)" });
    put(book.sheets[0], "D2", { v: 1 });
    put(book.sheets[0], "D3", { v: 2 });
    recalculate(book);
    expect(code(cellAt(book, "D1")?.v)).toBe("#CIRC!");
  });

  it("자기참조 셀을 참조하는 셀도 값을 지어내지 않는다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "A1+1" });
    put(book.sheets[0], "B1", { v: null, f: "A1*10" });
    recalculate(book);
    expect(code(cellAt(book, "B1")?.v)).toBe("#CIRC!");
  });

  it("같은 셀을 두 번 가리키는 것은 순환이 아니다 — 간선이 겹쳐도 셈은 돈다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "1+1" });
    put(book.sheets[0], "B1", { v: null, f: "A1+A1" });
    put(book.sheets[0], "C1", { v: null, f: "SUM(A1:A3)+A1" });
    recalculate(book);
    expect(cellAt(book, "B1")?.v).toBe(4);
    expect(cellAt(book, "C1")?.v).toBe(4);
  });

  it("시트 이름을 붙여 자기 자신을 가리켜도 순환이다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "Sheet1!A1" });
    recalculate(book);
    expect(code(cellAt(book, "A1")?.v)).toBe("#CIRC!");
  });

  it("다른 시트의 같은 주소는 자기참조가 아니다 — 주소만 보고 판단하면 안 된다", () => {
    const book = emptyWorkbook();
    book.sheets.push(emptySheet("Sheet2"));
    put(book.sheets[0], "A1", { v: null, f: "Sheet2!A1" });
    put(book.sheets[1], "A1", { v: 7 });
    recalculate(book);
    expect(cellAt(book, "A1")?.v).toBe(7);
  });

  it("자기 칸을 비껴간 범위는 멀쩡하다 — SUM(D2:D3)은 D1에서 정상이다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "D1", { v: null, f: "SUM(D2:D3)" });
    put(book.sheets[0], "D2", { v: 1 });
    put(book.sheets[0], "D3", { v: 2 });
    recalculate(book);
    expect(cellAt(book, "D1")?.v).toBe(3);
  });

  it("고리 밖의 셀은 멀쩡히 계산된다 — 하나가 썩어도 시트가 멈추지 않는다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: null, f: "B1" });
    put(book.sheets[0], "B1", { v: null, f: "A1" });
    put(book.sheets[0], "D1", { v: 2 });
    put(book.sheets[0], "E1", { v: null, f: "D1*3" });
    recalculate(book);
    expect(cellAt(book, "E1")?.v).toBe(6);
  });
});

describe("재계산은 셀을 제자리에서 고치지 않는다", () => {
  it("셀 객체를 새로 만들어 갈아 끼운다 — 되돌리기 스냅샷이 Map 복사 한 줄로 끝나는 근거다", () => {
    const book = emptyWorkbook();
    const sheet = book.sheets[0];
    put(sheet, "A1", { v: 1 });
    put(sheet, "B1", { v: null, f: "A1+1" });
    recalculate(book);

    const snapshotMap = new Map(sheet.cells); // 되돌리기 스택이 뜨는 스냅샷
    const snapshotCell = cellAt(book, "B1");
    expect(snapshotCell?.v).toBe(2);

    put(sheet, "A1", { v: 10 });
    recalculate(book);

    expect(cellAt(book, "B1")?.v).toBe(11);
    // 스냅샷이 들고 있던 셀 객체는 손대지 않았다.
    expect(snapshotCell?.v).toBe(2);
    expect(code((snapshotMap.get(cellKey(0, 1)) as Cell).v)).toBe(2);
    expect(cellAt(book, "B1")).not.toBe(snapshotCell);
  });

  it("갈아 끼울 때 수식·서식·원문(raw)은 그대로 옮겨 간다", () => {
    const book = emptyWorkbook();
    put(book.sheets[0], "A1", { v: 1 });
    put(book.sheets[0], "B1", { v: null, f: "A1+1", s: { bold: true, numFmt: "#,##0" }, raw: "원문" });
    recalculate(book);
    const cell = cellAt(book, "B1");
    expect(cell?.f).toBe("A1+1");
    expect(cell?.s).toEqual({ bold: true, numFmt: "#,##0" });
    expect(cell?.raw).toBe("원문");
  });
});

// ── 참조 보정 ────────────────────────────────────────────────────────

describe("복사·채우기(translateFormula)", () => {
  it("상대 참조만 델타만큼 움직이고 $는 그 자리에 남는다", () => {
    expect(translateFormula("A1+$B$2", 1, 1)).toBe("B2+$B$2");
  });

  it("혼합 참조는 $가 붙은 쪽만 고정된다", () => {
    expect(translateFormula("$A1+A$1", 2, 3)).toBe("$A3+D$1");
  });

  it("델타가 0이면 수식을 건드리지 않는다", () => {
    expect(translateFormula("A1+B2", 0, 0)).toBe("A1+B2");
  });

  it("문자열 리터럴 속의 A1은 참조가 아니다 — 정규식 치환이면 반드시 틀리는 자리", () => {
    expect(translateFormula('TEXT(A1,"A1")', 1, 0)).toBe('TEXT(A2,"A1")');
  });

  it("시트 밖으로 나가는 참조는 #REF!가 된다(위·왼쪽·아래·오른쪽 끝 모두)", () => {
    expect(translateFormula("A1", -1, 0)).toBe("#REF!");
    expect(translateFormula("A1", 0, -1)).toBe("#REF!");
    expect(translateFormula("A1048576", 1, 0)).toBe("#REF!"); // 마지막 행
    expect(translateFormula("XFD1", 0, 1)).toBe("#REF!"); // 마지막 열
  });

  it("마지막 행·열 자체는 유효하다(경계 한 칸 안쪽)", () => {
    expect(translateFormula("A1048575", 1, 0)).toBe("A1048576");
    expect(translateFormula("XFC1", 0, 1)).toBe("XFD1");
  });

  it("문법이 깨진 수식은 손대지 않고 원문 그대로 돌려준다", () => {
    expect(translateFormula("SUM(", 1, 1)).toBe("SUM(");
  });

  it("단항 음수·백분율·소수 리터럴이 붙어 있어도 참조만 옮긴다", () => {
    expect(translateFormula("-A1", 1, 0)).toBe("-A2");
    expect(translateFormula("A1%", 1, 0)).toBe("A2%");
    expect(translateFormula("A1*0.5", 1, 0)).toBe("A2*0.5");
  });
});

describe("행·열 삽입과 삭제(adjustRows·adjustCols)", () => {
  it("삽입 지점 뒤의 참조는 밀린다 — 절대 참조도 같이 밀린다", () => {
    expect(adjustRows("A5", 1, 1)).toBe("A6");
    expect(adjustRows("$A$5", 1, 1)).toBe("$A$6");
    expect(adjustCols("C1", 1, 1)).toBe("D1");
    expect(adjustCols("$C$1", 1, 1)).toBe("$D$1");
  });

  it("삽입 지점 앞의 참조는 그대로 있다", () => {
    expect(adjustRows("A5", 6, 1)).toBe("A5");
    expect(adjustCols("C1", 5, 1)).toBe("C1");
  });

  it("지워진 행·열을 가리키던 참조는 #REF!가 된다", () => {
    expect(adjustRows("A3", 2, -1)).toBe("#REF!");
    expect(adjustCols("C1", 2, -1)).toBe("#REF!");
  });

  it("지운 뒤쪽 참조는 당겨진다", () => {
    expect(adjustRows("A5", 2, -1)).toBe("A4");
    expect(adjustCols("D1", 2, -1)).toBe("C1");
  });

  it("범위는 양 끝이 각각 보정돼 삽입하면 늘어난다", () => {
    expect(adjustRows("SUM(A1:A10)", 4, 1)).toBe("SUM(A1:A11)");
    expect(adjustCols("SUM(A1:D1)", 1, 1)).toBe("SUM(A1:E1)");
  });

  it("범위가 통째로 지워지면 양 끝이 #REF!로 남는다", () => {
    expect(adjustRows("SUM(A2:A3)", 1, -2)).toBe("SUM(#REF!:#REF!)");
  });

  it("여러 줄을 한 번에 넣고 지운다", () => {
    expect(adjustRows("A5", 0, 3)).toBe("A8");
    expect(adjustRows("A10", 2, -5)).toBe("A5");
  });
});

describe("트리 → 수식 문자열(stringify)", () => {
  it("참조·범위·문자열·오류를 원문 그대로 되돌린다(왕복해도 같다)", () => {
    for (const src of [
      'SUM(A1:A3)+$B$2*2&"x"',
      '"그는 ""안녕""이라 했다"',
      "'My Sheet'!A1:B2",
      "#N/A",
      "IF(A1>0,TRUE,FALSE)",
      "-A1%",
      "{1,2;3,4}",
    ]) {
      expect(stringify(parseFormula(src))).toBe(src);
    }
  });

  it("시트 이름은 필요할 때만 따옴표를 두른다", () => {
    expect(stringify(parseFormula("Sheet1!A1"))).toBe("Sheet1!A1");
    expect(stringify(parseFormula("'My Sheet'!A1"))).toBe("'My Sheet'!A1");
  });

  it("숫자 상수는 자릿수를 잃지 않는다 — 화면 표시가 아니라 원문이다", () => {
    // 화면용 형식(General)은 12자리에서 반올림하고 1e11부터 지수로 적는다.
    // 수식 원문에 그 값을 되쓰면 상수가 조용히 다른 수가 된다.
    for (const src of [
      "1.23456789012345",
      "3.14159265358979",
      "123456789012.5",
      "0.1",
      "2.5e-11",
      "1234567890123456",
    ]) {
      expect(stringify(parseFormula(src))).toBe(String(Number(src)));
      expect(Number(stringify(parseFormula(src)))).toBe(Number(src));
    }
  });

  it("행을 넣어도 상수가 그대로다 — 보정이 값을 건드리면 안 된다", () => {
    expect(adjustRows("A1*123456789012.5", 0, 1)).toBe("A2*123456789012.5");
    expect(translateFormula("A1*1.23456789012345", 1, 0)).toBe("A2*1.23456789012345");
  });
});

// ── 괄호 ────────────────────────────────────────────────────────────

describe("stringify는 묶여 있던 것을 다시 묶는다", () => {
  /** 트리를 글로 옮겼다가 다시 읽어도 같은 트리여야 한다. */
  function reparses(src: string): void {
    const once = stringify(parseFormula(src));
    expect(stringify(parseFormula(once))).toBe(once);
    expect(parseFormula(once)).toEqual(parseFormula(src));
  }

  it("자식이 부모보다 느슨하면 괄호를 씌운다", () => {
    expect(stringify(parseFormula("(A1+A2)*2"))).toBe("(A1+A2)*2");
    expect(stringify(parseFormula("2*(A1+A2)"))).toBe("2*(A1+A2)");
    expect(stringify(parseFormula('("a"="b")&"c"'))).toBe('("a"="b")&"c"');
    expect(stringify(parseFormula("(1+2)^2"))).toBe("(1+2)^2");
  });

  it("오른쪽이 같은 우선순위면 결합 방향 때문에 괄호가 필요하다", () => {
    expect(stringify(parseFormula("1-(2-3)"))).toBe("1-(2-3)");
    expect(stringify(parseFormula("10/(2*5)"))).toBe("10/(2*5)");
    expect(stringify(parseFormula("2^(3^2)"))).toBe("2^(3^2)");
    expect(stringify(parseFormula("1=(2=3)"))).toBe("1=(2=3)");
  });

  it("왼쪽이 같은 우선순위면 괄호가 없어도 같은 뜻이다", () => {
    expect(stringify(parseFormula("(1-2)-3"))).toBe("1-2-3");
    expect(stringify(parseFormula("(2^3)^2"))).toBe("2^3^2");
  });

  it("단항 부호와 백분율도 안쪽을 묶는다", () => {
    expect(stringify(parseFormula("-(1+2)"))).toBe("-(1+2)");
    expect(stringify(parseFormula("(1+2)%"))).toBe("(1+2)%");
    expect(stringify(parseFormula("(-A1)%"))).toBe("(-A1)%");
  });

  it("필요 없는 괄호는 남기지 않는다 — 단항은 이 문법에서 ^보다 세게 붙는다", () => {
    expect(stringify(parseFormula("(A1*2)+3"))).toBe("A1*2+3");
    expect(stringify(parseFormula("(-2)^2"))).toBe("-2^2");
    expect(stringify(parseFormula("(A1%)"))).toBe("A1%");
  });

  it("어떤 식이든 글로 옮겼다가 다시 읽으면 같은 트리다", () => {
    for (const src of [
      "(A1+A2)*2",
      "2/(A1-A2)",
      "-(A1+A2)%",
      "(A1&A2)=\"ab\"",
      "SUM((A1+A2)*2,3)",
      "IF((A1+1)>2,(A1-1)*3,-(A1+1))",
      "{(1+2)*3,4;5,6}",
      "(A1:A3)",
      "((1+2))*3",
      "2^-(1+1)",
    ]) {
      reparses(src);
    }
  });

  it("값이 바뀌지 않는다 — 이게 무너지면 시트가 조용히 틀려진다", () => {
    const cells = { A1: 10, A2: 4 } as const;
    for (const src of [
      "(A1+A2)*2", // 28
      "A1/(A2-2)", // 5
      "A1-(A2-1)", // 7
      "(A1-A2)/2", // 3
      "2^(1^2)", // 2
      "-(A1+A2)", // -14
      "(A1+A2)%", // 0.14
    ]) {
      const again = stringify(parseFormula(src));
      expect(calc(again, cells)).toBe(calc(src, cells));
    }
  });
});

describe("괄호가 든 수식을 옮겨도 괄호가 남는다", () => {
  it("복사·채우기 — 이 경로가 괄호를 잃으면 되돌릴 근거도 안 남는다", () => {
    expect(translateFormula("(A1+A2)*2", 1, 0)).toBe("(A2+A3)*2");
    expect(translateFormula("A1/(B1-C1)", 0, 1)).toBe("B1/(C1-D1)");
  });

  it("행·열 삽입과 삭제", () => {
    expect(adjustRows("(A1+A2)*2", 0, 1)).toBe("(A2+A3)*2");
    expect(adjustRows("SUM(A1:A3)/(B1+B2)", 0, 1)).toBe("SUM(A2:A4)/(B2+B3)");
    expect(adjustCols("(A1-B1)*2", 0, 1)).toBe("(B1-C1)*2");
  });

  it("행을 넣어도 계산 결과가 그대로다 — 손으로 센 값", () => {
    // (A1+A2)*2 = (10+4)*2 = 28. 위에 행을 하나 넣으면 A2·A3을 가리켜야 28이 유지된다.
    const moved = adjustRows("(A1+A2)*2", 0, 1);
    expect(calc(moved, { A2: 10, A3: 4 })).toBe(28);
  });
});

// ── 파서의 관례 ──────────────────────────────────────────────────────

describe("파서가 받아 주는 관례", () => {
  it("인자를 비워 둔 IF(A1,,\"x\")는 문법 오류가 아니다", () => {
    expect(formulaError('IF(A1,,"x")')).toBeNull();
  });

  it("함수 이름은 대소문자를 가리지 않는다", () => {
    expect(calc("sum(A1:A2)", { A1: 1, A2: 2 })).toBe(3);
    expect(calc("Sum(A1:A2)", { A1: 1, A2: 2 })).toBe(3);
  });

  it("공백은 토큰 사이 어디에 있어도 된다", () => {
    expect(calc(" SUM( A1 , 2 ) ", { A1: 1 })).toBe(3);
  });

  it("범위는 셀 주소끼리만 이을 수 있다", () => {
    expect(formulaError("A1:SUM(B1)")).toBeTypeOf("string");
  });

  it("수식이 도중에 끝나거나 뒤에 군더더기가 붙으면 오류다", () => {
    expect(formulaError("1+")).toBeTypeOf("string");
    expect(formulaError("1 2")).toBeTypeOf("string");
    expect(formulaError("(1+2")).toBeTypeOf("string");
  });
});

// ── 주소처럼 생긴 함수 이름 ──────────────────────────────────────────

describe("셀 주소 꼴의 함수 이름은 뒤에 (가 오는지로 가른다", () => {
  it("LOG10은 함수다 — LOG열 10행이 아니다", () => {
    expect(calc("LOG10(100)")).toBe(2);
    expect(calc("LOG10(A1)", { A1: 10000 })).toBe(4);
    // formulajs의 LOG10은 log(x)/LN10이라 1000에서 2.9999999999999996이 나온다.
    // 엑셀은 3이다 — 자릿수 문제라 여기서는 근사로만 못 박는다.
    expect(calc("LOG10(1000)")).toBeCloseTo(3, 12);
    expect(tokenize("LOG10(100)")[0].kind).toBe("name");
  });

  it("괄호가 안 오면 여전히 셀 주소다 — LOG10은 실재하는 칸이다", () => {
    expect(tokenize("LOG10")[0].kind).toBe("ref");
    expect(calc("LOG10+1", { LOG10: 7 })).toBe(8);
    expect(calc("SUM(LOG10:LOG11)", { LOG10: 1, LOG11: 2 })).toBe(3);
  });

  it("진짜 참조는 하나도 깨지지 않는다", () => {
    for (const [src, kind] of [
      ["A1", "ref"],
      ["$B$2", "ref"],
      ["A$1", "ref"],
      ["XFD1048576", "ref"],
      ["Sheet1!A1", "ref"],
      ["'My Sheet'!A1", "ref"],
    ] as const) {
      expect(tokenize(src)[0].kind).toBe(kind);
    }
    expect(calc("SUM(A1)*(B1+1)", { A1: 2, B1: 3 })).toBe(8);
    expect(calc("(A1)*(B1)", { A1: 2, B1: 3 })).toBe(6);
    expect(calc("A1*(B1+1)", { A1: 2, B1: 3 })).toBe(8);
  });

  it("$가 붙으면 함수 이름일 수 없다 — 주소로 읽고 문법 오류로 끝난다", () => {
    expect(tokenize("$LOG$10(100)")[0].kind).toBe("ref");
  });
});
