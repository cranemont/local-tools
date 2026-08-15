/** 시트 데이터 유효성 검사 — 규칙 하나가 값 하나를 통과시키는가.
 *
 * 이 엔진이 답하는 것은 둘이다.
 *   ① 새 입력이 규칙에 맞는가(`checkValue`). 문서를 모르므로 범위 목록과 사용자
 *      지정 수식은 부르는 쪽이 풀어서 `ValidationContext`로 건넨다.
 *   ② 규칙이 걸린 범위가 편집을 따라 어떻게 움직이는가(겹쳐 걸기·행 삽입·삭제).
 *
 * 조심하는 자리 셋:
 *   · 빈 칸과 0·"0"·FALSE는 다르다. 0을 빈 칸으로 세면 금액 열의 0원이 막힌다.
 *   · 수인지는 **시트의 값 체계**로 가른다. "010"·19자리 번호는 글자로 남으므로
 *     (CLAUDE.md 23번) 정수 규칙을 통과하지 못한다.
 *   · 풀지 못한 것은 막지 않는다. 범위를 못 읽었거나 수식을 계산 못 했으면 통과다 —
 *     우리 쪽 실패로 입력을 되돌리면 그 칸에는 아무것도 넣을 수 없다.
 */

import { describe, it, expect } from "vitest";

import { parseInput } from "../apps/sheet/src/lib/sheet/model";
import { toSerial } from "../apps/sheet/src/lib/sheet/serial";
import { ERR } from "../apps/sheet/src/lib/sheet/types";
import {
  absoluteArea,
  boundNumber,
  checkValue,
  compareArity,
  defaultRule,
  entryAt,
  fromXlsxValidation,
  isBlankInput,
  listRange,
  looksLikeRange,
  matchesList,
  packAreas,
  parseListItems,
  reasonKey,
  ruleItems,
  setValidationOver,
  shiftValidationCols,
  shiftValidationRows,
  subtractArea,
  toXlsxValidation,
  usesCompare,
  type ValidationInput,
  type ValidationRange,
  type ValidationRule,
} from "../apps/sheet/src/lib/sheet/validation";

/** 사람이 친 글자 하나를 화면이 넘기는 모습으로 — 셀을 읽을 때와 같은 해석을 쓴다. */
function input(text: string): ValidationInput {
  return { text, value: parseInput(text).value };
}

function rule(patch: Partial<ValidationRule>): ValidationRule {
  return { ...defaultRule(patch.kind ?? "list"), ...patch };
}

function reasonOf(r: ValidationRule, text: string, ctx = {}): string | null {
  const verdict = checkValue(r, input(text), ctx);
  return verdict.ok ? null : reasonKey(verdict.reason!);
}

const area = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

describe("규칙이 없으면", () => {
  it("무엇을 넣어도 통과한다", () => {
    expect(checkValue(undefined, input("아무거나")).ok).toBe(true);
    expect(checkValue(undefined, input("")).ok).toBe(true);
  });
});

describe("빈 칸", () => {
  const list = rule({ kind: "list", source: "서울,부산" });

  it("값이 없거나 공백뿐이면 빈 칸이다 — 0·\"0\"·FALSE는 아니다", () => {
    expect(isBlankInput(input(""))).toBe(true);
    expect(isBlankInput(input("   "))).toBe(true);
    expect(isBlankInput(input("0"))).toBe(false);
    expect(isBlankInput({ text: "0", value: "0" })).toBe(false);
    expect(isBlankInput(input("FALSE"))).toBe(false);
  });

  it("허용하면 다른 검사를 건너뛴다", () => {
    expect(checkValue({ ...list, allowBlank: true }, input("")).ok).toBe(true);
    expect(checkValue({ ...list, allowBlank: true }, input("   ")).ok).toBe(true);
  });

  it("허용하지 않으면 이유가 빈 칸이다", () => {
    expect(reasonOf({ ...list, allowBlank: false }, "")).toBe("blank");
    expect(reasonOf({ ...list, allowBlank: false }, "   ")).toBe("blank");
  });

  it("빈 칸을 막아도 목록에 있는 값은 통과한다", () => {
    expect(checkValue({ ...list, allowBlank: false }, input("서울")).ok).toBe(true);
  });
});

describe("목록 원본 파싱", () => {
  it("쉼표로 나누고 앞뒤 공백을 뗀다", () => {
    expect(parseListItems("서울, 부산 ,대구")).toEqual(["서울", "부산", "대구"]);
  });

  it("빈 항목은 버린다", () => {
    expect(parseListItems("가,,나,")).toEqual(["가", "나"]);
    expect(parseListItems(",,")).toEqual([]);
  });

  it("같은 항목은 한 번만 남긴다 — 드롭다운에 같은 줄이 둘 뜨면 무엇을 고른 건지 모른다", () => {
    expect(parseListItems("가,나,가")).toEqual(["가", "나"]);
  });

  it("따옴표로 감싼 항목은 안쪽 쉼표와 앞뒤 공백을 지킨다", () => {
    expect(parseListItems('"서울, 부산",대구')).toEqual(["서울, 부산", "대구"]);
    expect(parseListItems('" 여백 "')).toEqual([" 여백 "]);
  });

  it('따옴표 두 개는 따옴표 한 글자다', () => {
    expect(parseListItems('"큰""따옴표"')).toEqual(['큰"따옴표']);
  });

  it("줄바꿈도 구분자다 — 열을 그대로 붙여 넣는 경우가 있다", () => {
    expect(parseListItems("가\n나\r\n다")).toEqual(["가", "나", "다"]);
  });

  it("빈 원본은 항목이 없다", () => {
    expect(parseListItems("")).toEqual([]);
    expect(parseListItems("   ")).toEqual([]);
  });
});

describe("목록 원본이 범위인가", () => {
  it("콜론이 있어야 범위로 읽는다", () => {
    expect(listRange("A1:A9")).toEqual(area(0, 0, 8, 0));
    expect(listRange("=$A$1:$B$3")).toEqual(area(0, 0, 2, 1));
    expect(listRange(" A1:A9 ")).toEqual(area(0, 0, 8, 0));
  });

  it("한 칸짜리 참조는 범위가 아니다 — 'A1' 한 항목짜리 목록을 적을 수 있어야 한다", () => {
    expect(listRange("A1")).toBeNull();
  });

  it("쉼표·따옴표가 섞이면 직접 적은 목록이다", () => {
    expect(listRange("서울,부산")).toBeNull();
    expect(listRange('"A1:A9"')).toBeNull();
    expect(listRange("")).toBeNull();
    expect(listRange(undefined)).toBeNull();
  });

  it("콜론이 들어간 글자라도 참조 모양이 아니면 목록이다", () => {
    expect(looksLikeRange("오전:오후")).toBe(false);
    expect(listRange("오전:오후")).toBeNull();
    expect(ruleItems(rule({ kind: "list", source: "오전:오후" }))).toEqual(["오전:오후"]);
  });

  it("다른 시트를 가리키는 원본은 범위로 읽되 풀지는 못한다", () => {
    expect(looksLikeRange("Sheet2!$A$1:$A$9")).toBe(true);
    expect(looksLikeRange("'내 시트'!A1:A9")).toBe(true);
    expect(listRange("Sheet2!$A$1:$A$9")).toBeNull();
  });

  it("못 푼 범위는 막지 않는다 — 항목 한 개짜리 목록으로 읽으면 그 열에 아무것도 못 넣는다", () => {
    const other = rule({ kind: "list", source: "Sheet2!$A$1:$A$9" });
    expect(ruleItems(other)).toBeNull();
    expect(checkValue(other, input("서울")).ok).toBe(true);
  });

  it("못 푼 범위도 엑셀로는 적힌 그대로 나간다", () => {
    expect(toXlsxValidation(rule({ kind: "list", source: "=Sheet2!$A$1:$A$9" }))?.formulae).toEqual([
      "Sheet2!$A$1:$A$9",
    ]);
  });
});

describe("목록 규칙", () => {
  const list = rule({ kind: "list", source: "서울, 부산, Seoul" });

  it("목록에 있으면 통과, 없으면 위반이다", () => {
    expect(checkValue(list, input("서울")).ok).toBe(true);
    expect(reasonOf(list, "대전")).toBe("list");
  });

  it("대소문자는 무시한다", () => {
    expect(checkValue(list, input("SEOUL")).ok).toBe(true);
    expect(checkValue(list, input("seoul")).ok).toBe(true);
  });

  it("앞뒤 공백은 떼고 견준다", () => {
    expect(matchesList(["서울"], "  서울  ")).toBe(true);
  });

  it("빈 목록은 아무것도 막지 않는다 — 규칙이 덜 적힌 것이다", () => {
    expect(ruleItems(rule({ kind: "list", source: "" }))).toBeNull();
    expect(checkValue(rule({ kind: "list", source: "" }), input("아무거나")).ok).toBe(true);
  });

  it("범위 원본은 부르는 쪽이 푼 항목으로 견준다", () => {
    const byRange = rule({ kind: "list", source: "A1:A3" });
    expect(checkValue(byRange, input("서울"), { items: ["서울", "부산"] }).ok).toBe(true);
    expect(reasonOf(byRange, "대전", { items: ["서울", "부산"] })).toBe("list");
  });

  it("범위를 못 풀었으면 막지 않는다", () => {
    const byRange = rule({ kind: "list", source: "A1:A3" });
    expect(checkValue(byRange, input("대전")).ok).toBe(true);
    expect(checkValue(byRange, input("대전"), { items: [] }).ok).toBe(true);
  });

  it("수를 적은 목록은 화면 글자로 견준다", () => {
    const nums = rule({ kind: "list", source: "1,2,3" });
    expect(checkValue(nums, input("2")).ok).toBe(true);
    expect(reasonOf(nums, "4")).toBe("list");
  });
});

describe("정수 규칙", () => {
  const whole = rule({ kind: "whole", op: "between", value: "1", value2: "10" });

  it("범위 안의 정수는 통과한다", () => {
    expect(checkValue(whole, input("1")).ok).toBe(true);
    expect(checkValue(whole, input("10")).ok).toBe(true);
    expect(checkValue(whole, input("5")).ok).toBe(true);
  });

  it("경계 밖은 범위 위반이다", () => {
    expect(reasonOf(whole, "0")).toBe("range");
    expect(reasonOf(whole, "11")).toBe("range");
  });

  it("소수는 정수 위반이다", () => {
    expect(reasonOf(whole, "1.5")).toBe("whole");
  });

  it("글자·불리언은 수가 아니다", () => {
    expect(reasonOf(whole, "다섯")).toBe("whole");
    expect(reasonOf(whole, "TRUE")).toBe("whole");
  });

  it("앞자리 0이 붙은 번호는 글자로 남으므로 통과하지 못한다(CLAUDE.md 23번)", () => {
    expect(parseInput("010").value).toBe("010");
    expect(reasonOf(rule({ kind: "whole", op: "gt", value: "0" }), "010")).toBe("whole");
  });

  it("안전 정수 밖의 숫자열도 글자다 — 19자리 송장번호가 여기 걸린다", () => {
    expect(reasonOf(rule({ kind: "whole", op: "gt", value: "0" }), "12345678901234567890")).toBe(
      "whole",
    );
  });

  it("음수와 0도 경계에 걸린다", () => {
    const negative = rule({ kind: "whole", op: "between", value: "-5", value2: "0" });
    expect(checkValue(negative, input("-5")).ok).toBe(true);
    expect(checkValue(negative, input("0")).ok).toBe(true);
    expect(reasonOf(negative, "-6")).toBe("range");
    expect(reasonOf(negative, "1")).toBe("range");
  });

  it("두 값을 거꾸로 넣어도 같은 뜻으로 읽는다", () => {
    const flipped = rule({ kind: "whole", op: "between", value: "10", value2: "1" });
    expect(checkValue(flipped, input("5")).ok).toBe(true);
  });

  it("비교값이 비어 있으면 그 검사를 건너뛴다", () => {
    const half = rule({ kind: "whole", op: "between", value: "1", value2: "" });
    expect(checkValue(half, input("999")).ok).toBe(true);
  });
});

describe("비교 연산자", () => {
  const at = (op: ValidationRule["op"], value: string, value2 = "") =>
    rule({ kind: "decimal", op, value, value2 });

  it("사이·사이 아님", () => {
    expect(compareArity("between")).toBe(2);
    expect(compareArity("gt")).toBe(1);
    expect(checkValue(at("notBetween", "1", "10"), input("11")).ok).toBe(true);
    expect(reasonOf(at("notBetween", "1", "10"), "5")).toBe("range");
  });

  it("같음·같지 않음", () => {
    expect(checkValue(at("eq", "3"), input("3")).ok).toBe(true);
    expect(reasonOf(at("eq", "3"), "4")).toBe("range");
    expect(checkValue(at("ne", "3"), input("4")).ok).toBe(true);
  });

  it("크다·이상·작다·이하", () => {
    expect(checkValue(at("gt", "0"), input("0.5")).ok).toBe(true);
    expect(reasonOf(at("gt", "0"), "0")).toBe("range");
    expect(checkValue(at("gte", "0"), input("0")).ok).toBe(true);
    expect(checkValue(at("lt", "0"), input("-0.5")).ok).toBe(true);
    expect(checkValue(at("lte", "0"), input("0")).ok).toBe(true);
  });

  it("소수 규칙은 소수를 받는다", () => {
    expect(checkValue(at("between", "0", "1"), input("0.25")).ok).toBe(true);
    expect(reasonOf(at("between", "0", "1"), "가")).toBe("number");
  });

  it("비교값도 셀과 같은 규칙으로 읽는다 — 천 단위 쉼표·백분율", () => {
    expect(boundNumber("1,200")).toBe(1200);
    expect(boundNumber("50%")).toBe(0.5);
    expect(boundNumber("")).toBeNull();
    expect(boundNumber(undefined)).toBeNull();
    expect(boundNumber("가나다")).toBeNull();
  });
});

describe("날짜 규칙", () => {
  const start = toSerial(new Date(2026, 0, 1));
  const end = toSerial(new Date(2026, 11, 31));
  const dates = rule({ kind: "date", op: "between", value: "2026-01-01", value2: "2026-12-31" });

  it("비교값을 일련번호로 읽는다", () => {
    expect(boundNumber("2026-01-01")).toBe(start);
    expect(boundNumber("2026-12-31")).toBe(end);
  });

  it("범위 안의 날짜는 통과하고 밖은 위반이다", () => {
    expect(checkValue(dates, input("2026-06-15")).ok).toBe(true);
    expect(checkValue(dates, input("2026-01-01")).ok).toBe(true);
    expect(reasonOf(dates, "2025-12-31")).toBe("range");
    expect(reasonOf(dates, "2027-01-01")).toBe("range");
  });

  it("날짜로 안 읽히는 글자는 날짜 위반이다", () => {
    expect(reasonOf(dates, "내일")).toBe("date");
    expect(reasonOf(dates, "2026-13-01")).toBe("date");
  });

  it("일련번호를 그대로 친 것도 날짜로 본다(엑셀과 같다)", () => {
    expect(checkValue(dates, input(String(start))).ok).toBe(true);
  });
});

describe("글자 길이 규칙", () => {
  const len = rule({ kind: "textLength", op: "between", value: "2", value2: "4" });

  it("경계를 포함한다", () => {
    expect(checkValue(len, input("가나")).ok).toBe(true);
    expect(checkValue(len, input("가나다라")).ok).toBe(true);
    expect(reasonOf(len, "가")).toBe("length");
    expect(reasonOf(len, "가나다라마")).toBe("length");
  });

  it("앞뒤 공백은 세지 않는다", () => {
    expect(checkValue(len, input("  가나  ")).ok).toBe(true);
  });

  it("수를 넣어도 친 글자 수로 센다", () => {
    expect(checkValue(len, input("1234")).ok).toBe(true);
    expect(reasonOf(len, "12345")).toBe("length");
  });

  it("최대 길이만 걸 수도 있다", () => {
    const max = rule({ kind: "textLength", op: "lte", value: "3" });
    expect(checkValue(max, input("가나다")).ok).toBe(true);
    expect(reasonOf(max, "가나다라")).toBe("length");
  });
});

describe("사용자 지정 수식", () => {
  const custom = rule({ kind: "custom", formula: "A1>0" });

  it("결과가 참이면 통과한다", () => {
    expect(checkValue(custom, input("5"), { custom: true }).ok).toBe(true);
    expect(checkValue(custom, input("5"), { custom: 1 }).ok).toBe(true);
    expect(checkValue(custom, input("5"), { custom: "TRUE" }).ok).toBe(true);
  });

  it("거짓·0·빈 값·오류는 위반이다", () => {
    expect(reasonOf(custom, "5", { custom: false })).toBe("custom");
    expect(reasonOf(custom, "5", { custom: 0 })).toBe("custom");
    expect(reasonOf(custom, "5", { custom: null })).toBe("custom");
    expect(reasonOf(custom, "5", { custom: "아무 글자" })).toBe("custom");
    expect(reasonOf(custom, "5", { custom: ERR.div0 })).toBe("custom");
  });

  it("계산하지 못했으면 막지 않는다", () => {
    expect(checkValue(custom, input("5")).ok).toBe(true);
  });
});

describe("위반 이유 → 문구 키", () => {
  it("이유마다 하나씩 대응한다", () => {
    expect(reasonKey("blank")).toBe("blank");
    expect(reasonKey("notInList")).toBe("list");
    expect(reasonKey("notWhole")).toBe("whole");
    expect(reasonKey("notNumber")).toBe("number");
    expect(reasonKey("notDate")).toBe("date");
    expect(reasonKey("outOfRange")).toBe("range");
    expect(reasonKey("badLength")).toBe("length");
    expect(reasonKey("custom")).toBe("custom");
  });

  it("크기 비교를 쓰는 종류만 조건란이 필요하다", () => {
    expect(usesCompare("whole")).toBe(true);
    expect(usesCompare("date")).toBe(true);
    expect(usesCompare("textLength")).toBe(true);
    expect(usesCompare("list")).toBe(false);
    expect(usesCompare("custom")).toBe(false);
  });
});

describe("범위에 걸린 규칙 찾기", () => {
  const a = rule({ kind: "list", source: "가" });
  const b = rule({ kind: "list", source: "나" });
  const list: ValidationRange[] = [
    { area: area(0, 0, 9, 0), rule: a },
    { area: area(0, 0, 0, 0), rule: b },
  ];

  it("겹치면 나중에 건 것이 이긴다", () => {
    expect(entryAt(list, 0, 0)?.rule).toBe(b);
    expect(entryAt(list, 1, 0)?.rule).toBe(a);
  });

  it("범위 밖이면 없다", () => {
    expect(entryAt(list, 0, 1)).toBeUndefined();
    expect(entryAt(undefined, 0, 0)).toBeUndefined();
  });
});

describe("범위에 규칙 걸기·지우기", () => {
  const a = rule({ kind: "list", source: "가" });
  const b = rule({ kind: "whole", value: "1", value2: "9" });

  it("사각형에서 사각형을 도려낸다", () => {
    expect(subtractArea(area(0, 0, 9, 0), area(3, 0, 4, 0))).toEqual([
      area(0, 0, 2, 0),
      area(5, 0, 9, 0),
    ]);
    expect(subtractArea(area(0, 0, 2, 2), area(1, 1, 1, 1))).toEqual([
      area(0, 0, 0, 2),
      area(2, 0, 2, 2),
      area(1, 0, 1, 0),
      area(1, 2, 1, 2),
    ]);
  });

  it("겹치지 않으면 그대로 남는다", () => {
    expect(subtractArea(area(0, 0, 1, 1), area(5, 5, 6, 6))).toEqual([area(0, 0, 1, 1)]);
  });

  it("한 칸에 규칙이 둘 쌓이지 않는다 — 새 규칙이 옛 범위를 도려낸다", () => {
    const first = setValidationOver(undefined, area(0, 0, 9, 0), a);
    const second = setValidationOver(first, area(3, 0, 4, 0), b);
    expect(entryAt(second, 3, 0)?.rule).toBe(b);
    expect(entryAt(second, 2, 0)?.rule).toBe(a);
    expect(entryAt(second, 5, 0)?.rule).toBe(a);
  });

  it("null을 걸면 그 범위에서만 지워진다", () => {
    const first = setValidationOver(undefined, area(0, 0, 9, 0), a);
    const cleared = setValidationOver(first, area(0, 0, 4, 0), null);
    expect(entryAt(cleared, 0, 0)).toBeUndefined();
    expect(entryAt(cleared, 5, 0)?.rule).toBe(a);
  });

  it("범위 전체를 덮으면 옛 규칙이 사라진다", () => {
    const first = setValidationOver(undefined, area(0, 0, 9, 0), a);
    expect(setValidationOver(first, area(0, 0, 9, 0), null)).toEqual([]);
  });
});

describe("행·열을 끼우고 지울 때", () => {
  const r = rule({ kind: "list", source: "가" });
  const list: ValidationRange[] = [{ area: area(2, 1, 5, 1), rule: r }];

  it("위에 행을 끼우면 함께 내려간다", () => {
    expect(shiftValidationRows(list, 0, 2)[0].area).toEqual(area(4, 1, 7, 1));
  });

  it("범위 안에 끼우면 범위가 그만큼 넓어진다", () => {
    expect(shiftValidationRows(list, 3, 1)[0].area).toEqual(area(2, 1, 6, 1));
  });

  it("아래쪽에 끼우면 그대로다", () => {
    expect(shiftValidationRows(list, 9, 3)[0].area).toEqual(area(2, 1, 5, 1));
  });

  it("위쪽 행을 지우면 올라온다", () => {
    expect(shiftValidationRows(list, 0, -2)[0].area).toEqual(area(0, 1, 3, 1));
  });

  it("걸친 행을 지우면 남은 만큼으로 줄어든다", () => {
    expect(shiftValidationRows(list, 4, -3)[0].area).toEqual(area(2, 1, 3, 1));
  });

  it("범위 전체를 지우면 규칙도 사라진다", () => {
    expect(shiftValidationRows(list, 2, -4)).toEqual([]);
  });

  it("열도 같다", () => {
    expect(shiftValidationCols(list, 0, 1)[0].area).toEqual(area(2, 2, 5, 2));
    expect(shiftValidationCols(list, 1, -1)).toEqual([]);
  });

  it("규칙이 없으면 빈 목록이다", () => {
    expect(shiftValidationRows(undefined, 0, 1)).toEqual([]);
    expect(shiftValidationCols(undefined, 0, -1)).toEqual([]);
  });
});

describe("목록 원본 범위도 함께 밀린다", () => {
  const byRange = (source: string): ValidationRange[] => [
    { area: area(0, 3, 9, 3), rule: rule({ kind: "list", source }) },
  ];

  it("위에 행을 끼우면 원본도 내려간다 — 안 밀면 항목이 한 줄씩 어긋난다", () => {
    expect(shiftValidationRows(byRange("A1:A9"), 0, 1)[0].rule.source).toBe("$A$2:$A$10");
  });

  it("원본 범위 안에 행을 끼우면 원본이 넓어진다", () => {
    expect(shiftValidationRows(byRange("A1:A9"), 3, 2)[0].rule.source).toBe("$A$1:$A$11");
  });

  it("원본이 있던 행을 지우면 원본도 줄어든다", () => {
    expect(shiftValidationRows(byRange("$A$1:$A$9"), 0, -2)[0].rule.source).toBe("$A$1:$A$7");
  });

  it("원본이 사라지면 원본을 비운다 — 못 푼 목록은 막지 않는다", () => {
    const shifted = shiftValidationRows(byRange("A1:A9"), 0, -9)[0];
    expect(shifted.rule.source).toBe("");
    expect(checkValue(shifted.rule, input("아무거나")).ok).toBe(true);
  });

  it("열도 같다", () => {
    expect(shiftValidationCols(byRange("A1:A9"), 0, 1)[0].rule.source).toBe("$B$1:$B$9");
  });

  it("직접 적은 목록은 손대지 않는다", () => {
    expect(shiftValidationRows(byRange("서울,부산"), 0, 3)[0].rule.source).toBe("서울,부산");
  });

  it("규칙 객체를 제자리에서 고치지 않는다 — 되돌리기 스냅샷이 같은 객체를 본다", () => {
    const list = byRange("A1:A9");
    shiftValidationRows(list, 0, 1);
    expect(list[0].rule.source).toBe("A1:A9");
  });
});

describe("칸 좌표를 직사각형으로 접기", () => {
  it("한 열은 범위 하나가 된다", () => {
    const cells = [0, 1, 2, 3].map((row) => ({ row, col: 1 }));
    expect(packAreas(cells)).toEqual([area(0, 1, 3, 1)]);
  });

  it("직사각형이면 한 덩어리다", () => {
    const cells = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) cells.push({ row: r, col: c });
    expect(packAreas(cells)).toEqual([area(0, 0, 1, 2)]);
  });

  it("떨어진 덩어리는 따로 접는다", () => {
    expect(packAreas([{ row: 0, col: 0 }, { row: 5, col: 0 }])).toEqual([
      area(0, 0, 0, 0),
      area(5, 0, 5, 0),
    ]);
  });

  it("빈 목록은 빈 결과다", () => {
    expect(packAreas([])).toEqual([]);
  });

  it("마지막 열에서 다음 줄 첫 칸으로 넘어가 붙지 않는다", () => {
    // 셀 키가 row*16384+col이라, 마지막 열(16383)의 오른쪽을 물으면
    // 다음 줄 첫 칸과 같은 값이 나온다.
    expect(packAreas([{ row: 0, col: 16383 }, { row: 1, col: 0 }])).toEqual([
      area(0, 16383, 0, 16383),
      area(1, 0, 1, 0),
    ]);
  });
});

describe("xlsx 왕복", () => {
  it("직접 적은 목록은 따옴표로 감싼 한 덩어리로 나간다", () => {
    const dv = toXlsxValidation(rule({ kind: "list", source: "서울, 부산" }));
    expect(dv).toEqual({
      type: "list",
      formulae: ['"서울,부산"'],
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: "stop",
    });
    expect(fromXlsxValidation(dv)?.source).toBe("서울,부산");
  });

  it("범위 원본은 절대 참조로 나간다 — 엑셀은 적용 범위의 왼쪽 위 칸 기준으로 읽는다", () => {
    expect(absoluteArea(area(0, 0, 8, 0))).toBe("$A$1:$A$9");
    const dv = toXlsxValidation(rule({ kind: "list", source: "=$A$1:$A$9" }));
    expect(dv?.formulae).toEqual(["$A$1:$A$9"]);
    expect(fromXlsxValidation(dv)?.source).toBe("$A$1:$A$9");
    // 상대 참조로 적어도 절대 참조로 나간다. 안 그러면 B2:B10에 건 규칙이
    // 줄마다 다른 목록을 보게 된다.
    expect(toXlsxValidation(rule({ kind: "list", source: "A1:A9" }))?.formulae).toEqual([
      "$A$1:$A$9",
    ]);
  });

  it('사용자 지정 수식은 "=" 없이 나간다 — 엑셀 formula1에는 수식 본문만 들어간다', () => {
    expect(toXlsxValidation(rule({ kind: "custom", formula: "A1>0" }))?.formulae).toEqual(["A1>0"]);
    // 읽을 때는 "="가 붙어 온 것도 받는다(다른 도구가 그렇게 적을 수 있다).
    expect(fromXlsxValidation({ type: "custom", formulae: ["=A1>0"] })?.formula).toBe("A1>0");
  });

  it("정수 범위는 연산자와 두 값으로 나간다", () => {
    const dv = toXlsxValidation(rule({ kind: "whole", op: "between", value: "1", value2: "10" }));
    expect(dv?.type).toBe("whole");
    expect(dv?.operator).toBe("between");
    expect(dv?.formulae).toEqual([1, 10]);

    const back = fromXlsxValidation(dv);
    expect(back?.kind).toBe("whole");
    expect(back?.op).toBe("between");
    expect(checkValue(back, input("5")).ok).toBe(true);
    expect(reasonOf(back!, "11")).toBe("range");
  });

  it("연산자 이름은 엑셀 쪽 이름으로 바뀌었다 돌아온다", () => {
    for (const [ours, theirs] of [
      ["eq", "equal"],
      ["ne", "notEqual"],
      ["gt", "greaterThan"],
      ["gte", "greaterThanOrEqual"],
      ["lt", "lessThan"],
      ["lte", "lessThanOrEqual"],
    ] as const) {
      const dv = toXlsxValidation(rule({ kind: "decimal", op: ours, value: "1" }));
      expect(dv?.operator).toBe(theirs);
      expect(fromXlsxValidation(dv)?.op).toBe(ours);
    }
  });

  it("날짜 경계는 날짜 글자로 오간다", () => {
    const dv = toXlsxValidation(
      rule({ kind: "date", op: "between", value: "2026-01-01", value2: "2026-12-31" }),
    );
    expect(dv?.formulae).toEqual(["2026-01-01", "2026-12-31"]);
    // ExcelJS는 읽을 때 일련번호를 UTC 자정의 Date로 푼다.
    const back = fromXlsxValidation({
      type: "date",
      operator: "between",
      formulae: [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 11, 31))],
      allowBlank: true,
    });
    expect(back?.value).toBe("2026-01-01");
    expect(back?.value2).toBe("2026-12-31");
  });

  it("위반 시 동작은 errorStyle로만 남는다", () => {
    expect(toXlsxValidation(rule({ kind: "custom", formula: "A1>0", action: "warn" }))?.errorStyle).toBe(
      "warning",
    );
    expect(fromXlsxValidation({ type: "custom", formulae: ["=A1>0"], errorStyle: "warning" })?.action).toBe(
      "warn",
    );
    expect(fromXlsxValidation({ type: "custom", formulae: ["=A1>0"] })?.action).toBe("reject");
  });

  it("빈 칸 허용은 엑셀 기본값(끔)을 따라 읽는다", () => {
    expect(fromXlsxValidation({ type: "custom", formulae: ["=A1>0"] })?.allowBlank).toBe(false);
    expect(
      fromXlsxValidation({ type: "custom", formulae: ["=A1>0"], allowBlank: true })?.allowBlank,
    ).toBe(true);
  });

  it("값이 덜 적힌 규칙은 내보내지 않는다", () => {
    expect(toXlsxValidation(rule({ kind: "list", source: "" }))).toBeNull();
    expect(toXlsxValidation(rule({ kind: "custom", formula: "" }))).toBeNull();
    expect(toXlsxValidation(rule({ kind: "whole", op: "between", value: "1", value2: "" }))).toBeNull();
  });

  it("모르는 모양은 규칙으로 읽지 않는다", () => {
    expect(fromXlsxValidation(null)).toBeNull();
    expect(fromXlsxValidation({ type: "any", formulae: [] })).toBeNull();
    expect(fromXlsxValidation({ type: "list", formulae: [] })).toBeNull();
  });
});
