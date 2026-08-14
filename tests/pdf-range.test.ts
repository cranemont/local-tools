import { describe, it, expect } from "vitest";
import {
  parseRange,
  isRangeSyntaxValid,
  chunkEvery,
  resolveRange,
  RangeSpecError,
} from "../apps/pdf/src/lib/pdf/range";

/**
 * 쪽 범위 표기의 명세.
 *
 * 화면에서 "이렇게 적으면 이렇게 됩니다"라는 해설을 걷어냈으므로, 그 규칙은
 * 여기서 실행 가능한 형태로 남는다. 기대값은 전부 손으로 센 것이다.
 *
 * 좌표계 주의: 사람이 적는 표기는 1-based("1쪽"), 돌려주는 인덱스는 0-based다.
 */

describe("쪽 표기 → 인덱스: 기본 문법", () => {
  it("낱개 숫자 한 개는 그 쪽 하나만 고른다 — 1쪽은 인덱스 0이다", () => {
    const r = parseRange("1", 10);
    expect(r.groups).toEqual([[0]]);
    expect(r.indices).toEqual([0]);
    expect(r.invalid).toBe(false);
  });

  it("문서의 마지막 쪽은 경계 안이다 — 10쪽 문서의 '10'은 유효하다", () => {
    const r = parseRange("10", 10);
    expect(r.indices).toEqual([9]);
    expect(r.invalid).toBe(false);
  });

  it("닫힌 범위는 양끝을 포함한다 — '1-5'는 다섯 장이다", () => {
    const r = parseRange("1-5", 10);
    expect(r.groups).toEqual([[0, 1, 2, 3, 4]]);
    expect(r.invalid).toBe(false);
  });

  it("양끝이 같은 범위는 한 장이다 — '3-3'은 '3'과 같다", () => {
    expect(parseRange("3-3", 10).groups).toEqual(parseRange("3", 10).groups);
  });

  it("여러 조각은 쉼표로 잇고, 문서 주석의 예시 '1-5, 8, 12-'가 그대로 읽힌다", () => {
    const r = parseRange("1-5, 8, 12-", 15);
    expect(r.groups).toEqual([
      [0, 1, 2, 3, 4],
      [7],
      [11, 12, 13, 14],
    ]);
    expect(r.indices).toEqual([0, 1, 2, 3, 4, 7, 11, 12, 13, 14]);
    expect(r.invalid).toBe(false);
  });

  it("쉼표·세미콜론·줄바꿈은 모두 같은 구분자다", () => {
    const comma = parseRange("1,3,5", 10);
    expect(parseRange("1;3;5", 10)).toEqual(comma);
    expect(parseRange("1\n3\n5", 10)).toEqual(comma);
    expect(parseRange("1,3;5", 10)).toEqual(comma);
  });

  it("붙임표·en dash·물결표는 모두 같은 범위 기호다 — 한글 자판에서 셋 다 흔하다", () => {
    const dash = parseRange("2-4", 10);
    expect(parseRange("2–4", 10)).toEqual(dash);
    expect(parseRange("2~4", 10)).toEqual(dash);
  });
});

describe("쪽 표기 → 인덱스: 공백과 빈 조각", () => {
  it("숫자와 기호 사이 공백은 무시한다 — ' 1 - 5 '는 '1-5'와 같다", () => {
    expect(parseRange("  1 - 5  ", 10)).toEqual(parseRange("1-5", 10));
  });

  it("꼬리 쉼표와 연속 쉼표는 잘못이 아니다 — 타이핑 중인 상태를 오류로 몰지 않는다", () => {
    const r = parseRange("1-3, ,", 10);
    expect(r.groups).toEqual([[0, 1, 2]]);
    expect(r.invalid).toBe(false);
  });

  it("빈 문자열은 아무것도 고르지 않지만 '잘못된 표기'는 아니다 — 비어 있음의 판단은 부르는 쪽 몫이다", () => {
    const r = parseRange("", 10);
    expect(r.groups).toEqual([]);
    expect(r.indices).toEqual([]);
    expect(r.invalid).toBe(false);
  });

  it("공백만 적힌 것도 빈 문자열과 같다", () => {
    expect(parseRange("   \n  ", 10)).toEqual(parseRange("", 10));
  });
});

describe("열린 범위 — 이 파서에서 제일 많이 틀렸던 자리", () => {
  it("'12-'는 12쪽부터 문서 끝까지다", () => {
    const r = parseRange("12-", 15);
    expect(r.groups).toEqual([[11, 12, 13, 14]]);
    expect(r.invalid).toBe(false);
  });

  it("'-5'는 처음부터 5쪽까지다 — 앞의 기호는 음수가 아니라 '문서 시작'이다", () => {
    const r = parseRange("-5", 10);
    expect(r.groups).toEqual([[0, 1, 2, 3, 4]]);
    expect(r.invalid).toBe(false);
  });

  it("'-5'의 끝이 문서 밖이면 마지막 쪽에서 멈춘다 — 시작은 이미 문서 안이다", () => {
    const r = parseRange("-5", 3);
    expect(r.groups).toEqual([[0, 1, 2]]);
    expect(r.invalid).toBe(false);
  });

  it("★ 9쪽 문서의 '12-'는 무효다 — 마지막 한 장이 조용히 선택되면 안 된다", () => {
    // 회귀: 예전에는 열린 범위도 뒤집어서 12..9 → 9..12 → 9쪽 한 장이 잡혔다.
    // 사용자는 12쪽부터를 요청했는데 엉뚱한 한 장을 받는다.
    const r = parseRange("12-", 9);
    expect(r.groups).toEqual([]);
    expect(r.indices).toEqual([]);
    expect(r.invalid).toBe(true);
  });

  it("★ 열린 시작이 마지막 쪽 바로 다음이어도 무효다 — 경계는 total이지 total+1이 아니다", () => {
    expect(parseRange("10-", 9).invalid).toBe(true);
    expect(parseRange("9-", 9).groups).toEqual([[8]]);
  });

  it("기호만 적은 '-'는 문법이 아니다 — 양끝이 다 비면 읽을 수 없다", () => {
    const r = parseRange("-", 10);
    expect(r.groups).toEqual([]);
    expect(r.invalid).toBe(true);
  });
});

describe("역순 — 양끝을 다 적은 경우에만 뒤집는다", () => {
  it("'8-3'은 3쪽부터 8쪽까지로 읽는다 — 양끝이 다 적혀 있으니 의도가 분명하다", () => {
    const r = parseRange("8-3", 10);
    expect(r.groups).toEqual([[2, 3, 4, 5, 6, 7]]);
    expect(r.invalid).toBe(false);
  });

  it("뒤집힌 범위는 오름차순으로 펴진다 — 순서를 보존하지 않는다", () => {
    expect(parseRange("8-3", 10).indices).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("뒤집은 뒤에도 문서 경계로 자른다 — 20쪽 문서의 '30-5'는 5~20쪽이다", () => {
    const r = parseRange("30-5", 20);
    expect(r.indices[0]).toBe(4);
    expect(r.indices[r.indices.length - 1]).toBe(19);
    expect(r.indices.length).toBe(16);
  });

  it("★ 열린 범위는 뒤집기 규칙을 타지 않는다 — 한쪽이 비어 있으면 의도를 추측하지 않는다", () => {
    // "12-"는 뒤집으면 유효해 보이지만, 뒤집지 않아야 '문서 밖'이라고 말해 준다.
    expect(parseRange("12-", 9).invalid).toBe(true);
    // 반대로 "-12"는 뒤집을 것도 없이 시작이 1이라 유효하다.
    expect(parseRange("-12", 9).invalid).toBe(false);
    expect(parseRange("-12", 9).groups).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
  });
});

describe("문서 밖·0·음수", () => {
  it("문서 밖만 가리킨 낱개 숫자는 무효다 — 9쪽 문서의 '50'은 조용히 무시되지 않는다", () => {
    const r = parseRange("50", 9);
    expect(r.groups).toEqual([]);
    expect(r.invalid).toBe(true);
  });

  it("문서 경계에 걸친 범위는 걸친 만큼만 남기고 잘못이라고 하지 않는다 — '8-99'는 8쪽부터 끝까지다", () => {
    const r = parseRange("8-99", 10);
    expect(r.groups).toEqual([[7, 8, 9]]);
    expect(r.invalid).toBe(false);
  });

  it("0쪽은 없다 — '0'은 무효다", () => {
    expect(parseRange("0", 10).invalid).toBe(true);
    expect(parseRange("0", 10).indices).toEqual([]);
  });

  it("범위의 끝에 0이 오는 것도 무효다 — '0-5'·'5-0' 둘 다 읽지 않는다", () => {
    expect(parseRange("0-5", 10).invalid).toBe(true);
    expect(parseRange("5-0", 10).invalid).toBe(true);
  });

  it("빈 문서(total 0)에서는 어떤 표기도 고를 것이 없다", () => {
    const r = parseRange("1", 0);
    expect(r.groups).toEqual([]);
    expect(r.indices).toEqual([]);
    expect(r.invalid).toBe(true);
  });

  it("한 장짜리 문서에서 '1'은 유효하고 '2'는 무효다", () => {
    expect(parseRange("1", 1).indices).toEqual([0]);
    expect(parseRange("2", 1).invalid).toBe(true);
  });

  it("한 장짜리 문서에서 열린 범위 '1-'은 그 한 장이다", () => {
    expect(parseRange("1-", 1).groups).toEqual([[0]]);
  });
});

describe("쓰레기 입력", () => {
  it("숫자가 아닌 조각은 무효다", () => {
    for (const junk of ["abc", "1a", "a1", "１", "3.5", "1/5", "+", "?"]) {
      expect(parseRange(junk, 10).invalid, junk).toBe(true);
      expect(parseRange(junk, 10).groups, junk).toEqual([]);
    }
  });

  it("범위 기호가 두 번 이상 나오면 무효다 — '1-2-3'을 추측해서 읽지 않는다", () => {
    expect(parseRange("1-2-3", 10).invalid).toBe(true);
    expect(parseRange("1--5", 10).invalid).toBe(true);
  });

  it("★ 한 조각이 틀려도 나머지는 살아남고, invalid로 알린다 — 부르는 쪽이 판단한다", () => {
    const r = parseRange("1, abc, 3", 10);
    expect(r.groups).toEqual([[0], [2]]);
    expect(r.indices).toEqual([0, 2]);
    expect(r.invalid).toBe(true);
  });
});

describe("groups와 indices는 다른 물건이다", () => {
  it("groups는 적힌 순서 그대로다 — 오름차순으로 정렬하지 않는다(분할 파일 순서가 이것이다)", () => {
    const r = parseRange("8, 1-2", 10);
    expect(r.groups).toEqual([[7], [0, 1]]);
  });

  it("indices는 언제나 오름차순이다 — 적힌 순서와 무관하다", () => {
    expect(parseRange("8, 1-2", 10).indices).toEqual([0, 1, 7]);
  });

  it("groups는 겹침을 그대로 두고, indices만 중복을 없앤다", () => {
    const r = parseRange("1-3, 2-4", 10);
    expect(r.groups).toEqual([
      [0, 1, 2],
      [1, 2, 3],
    ]);
    expect(r.indices).toEqual([0, 1, 2, 3]);
  });

  it("같은 쪽을 여러 번 적으면 분할은 그만큼 파일이 되고, 선택은 한 장이다", () => {
    const r = parseRange("5, 5, 5", 10);
    expect(r.groups.length).toBe(3); // 분할: 같은 쪽이 든 파일 세 개
    expect(r.indices).toEqual([4]); // 선택: 한 장
  });

  it("indices는 groups를 편 집합과 정확히 같다 — 어느 한쪽에만 있는 쪽은 없다", () => {
    for (const spec of ["1-5, 8, 12-", "8-3, 2, 9", "1, 1-3, 20-25"]) {
      const r = parseRange(spec, 30);
      const flat = [...new Set(r.groups.flat())].sort((a, b) => a - b);
      expect(r.indices, spec).toEqual(flat);
    }
  });

  it("모든 인덱스는 0 이상 total 미만이다 — 문서 밖 인덱스가 새어 나가면 렌더가 죽는다", () => {
    const total = 12;
    for (const spec of ["-99", "99-", "1-99", "0-3", "8-3", "1,7,12"]) {
      for (const i of parseRange(spec, total).indices) {
        expect(i, `${spec} → ${i}`).toBeGreaterThanOrEqual(0);
        expect(i, `${spec} → ${i}`).toBeLessThan(total);
      }
    }
  });
});

describe("왕복 — 읽은 것을 다시 적어도 같은 쪽을 가리킨다", () => {
  /** groups를 사람이 적는 표기로 되돌린다(1-based, 연속 묶음은 a-b). */
  const format = (groups: number[][]) =>
    groups
      .map((g) => {
        const a = g[0] + 1;
        const b = g[g.length - 1] + 1;
        return a === b ? `${a}` : `${a}-${b}`;
      })
      .join(", ");

  it("파싱 → 표기 → 파싱이 같은 결과로 수렴한다", () => {
    const total = 20;
    for (const spec of ["1-5, 8, 12-", "8-3", "-4, 17-", "1,2,3", "20"]) {
      const first = parseRange(spec, total);
      const second = parseRange(format(first.groups), total);
      expect(second.groups, spec).toEqual(first.groups);
      expect(second.indices, spec).toEqual(first.indices);
      expect(second.invalid, spec).toBe(false);
    }
  });

  it("잘라 낸 결과를 다시 적어도 잘리지 않는다 — 경계 보정은 한 번으로 끝난다", () => {
    const r = parseRange("8-99", 10);
    expect(parseRange(format(r.groups), 10).groups).toEqual(r.groups);
  });
});

describe("문법만 보는 검사(isRangeSyntaxValid) — 쪽 수를 모르는 자리에서 쓴다", () => {
  it("쪽 수를 모르므로 열린 범위는 언제나 문법상 옳다", () => {
    expect(isRangeSyntaxValid("12-")).toBe(true);
    expect(isRangeSyntaxValid("-5")).toBe(true);
  });

  it("★ 문법 검사는 문서 밖인지 말해 주지 않는다 — 9쪽 문서의 '12-'도 여기서는 통과한다", () => {
    expect(isRangeSyntaxValid("12-")).toBe(true);
    expect(parseRange("12-", 9).invalid).toBe(true);
  });

  it("빈 문자열은 문법상 옳지 않다 — 한 조각도 못 읽었기 때문이다", () => {
    expect(isRangeSyntaxValid("")).toBe(false);
    expect(isRangeSyntaxValid("   ")).toBe(false);
    expect(isRangeSyntaxValid(",,")).toBe(false);
  });

  it("0·기호만·이중 기호·문자는 문법상 틀렸다", () => {
    for (const junk of ["0", "-", "1-2-3", "abc", "0-5", "1, abc"]) {
      expect(isRangeSyntaxValid(junk), junk).toBe(false);
    }
  });

  it("여러 조각 중 하나만 틀려도 전체가 틀린 것이다", () => {
    expect(isRangeSyntaxValid("1-5, 8")).toBe(true);
    expect(isRangeSyntaxValid("1-5, 8, ?")).toBe(false);
  });

  it("parseRange가 문법을 이유로 무효라 한 것은 여기서도 무효다", () => {
    for (const junk of ["abc", "0", "-", "1-2-3"]) {
      expect(isRangeSyntaxValid(junk), junk).toBe(false);
      expect(parseRange(junk, 10).invalid, junk).toBe(true);
    }
  });
});

describe("N쪽마다 끊기(chunkEvery)", () => {
  it("앞에서부터 size개씩 끊고, 마지막 묶음은 남는 만큼만 담는다", () => {
    expect(chunkEvery([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("size 1은 낱장이다 — 한 쪽이 파일 하나", () => {
    expect(chunkEvery([0, 1, 2], 1)).toEqual([[0], [1], [2]]);
  });

  it("size가 전체보다 크면 묶음은 하나뿐이다", () => {
    expect(chunkEvery([0, 1, 2], 10)).toEqual([[0, 1, 2]]);
  });

  it("빈 목록은 빈 결과다 — 빈 묶음 하나를 만들지 않는다", () => {
    expect(chunkEvery([], 3)).toEqual([]);
  });

  it("★ size가 0이나 음수여도 낱장으로 물러난다 — 0이면 무한 루프가 된다", () => {
    expect(chunkEvery([0, 1, 2], 0)).toEqual([[0], [1], [2]]);
    expect(chunkEvery([0, 1, 2], -5)).toEqual([[0], [1], [2]]);
  });

  it("★ 입력란을 비워 숫자가 아닌 값이 와도 낱장으로 물러난다 — 던지지 않는다", () => {
    expect(chunkEvery([0, 1], NaN)).toEqual([[0], [1]]);
    expect(chunkEvery([0, 1], undefined as unknown as number)).toEqual([
      [0],
      [1],
    ]);
  });

  it("소수는 내림한다 — '2.9쪽마다'는 2쪽마다다", () => {
    expect(chunkEvery([0, 1, 2, 3, 4], 2.9)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("★ 어떤 size로 끊어도 원본 순서 그대로 전부 한 번씩 들어간다 — 쪽이 사라지거나 겹치면 분할이 깨진다", () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    for (const size of [0, 1, 2, 3, 7, 8, NaN]) {
      expect(chunkEvery(all, size).flat(), String(size)).toEqual(all);
    }
  });

  it("주어진 순서를 정렬하지 않는다 — 넘긴 순서가 곧 파일 순서다", () => {
    expect(chunkEvery([5, 0, 3], 2)).toEqual([[5, 0], [3]]);
  });

  it("★ size가 무한대면 '끊지 않는다' — 전부 한 묶음이다", () => {
    // 회귀: Number.isFinite(Infinity)가 false라 '읽을 수 없는 값'과 같은 갈래로 떨어져
    // 낱장이 됐다. 뜻이 정반대다 — 무한히 크게 끊으면 자를 자리가 없다.
    expect(chunkEvery([0, 1, 2, 3], Infinity)).toEqual([[0, 1, 2, 3]]);
  });

  it("빈 목록은 무한대로 끊어도 빈 결과다 — 빈 묶음 하나를 만들지 않는다", () => {
    expect(chunkEvery([], Infinity)).toEqual([]);
  });

  it("음의 무한대는 크기가 아니라 읽을 수 없는 값이다 — 낱장으로 물러난다", () => {
    expect(chunkEvery([0, 1, 2], -Infinity)).toEqual([[0], [1], [2]]);
  });
});

describe("앞자리 0 — 낱개와 범위가 같은 규칙이다", () => {
  it("★ '007'은 무효다 — 범위 양끝인 '007-9'가 이미 무효인데 낱개만 통과하면 이유를 알 수 없다", () => {
    expect(parseRange("007", 10).invalid).toBe(true);
    expect(parseRange("007", 10).indices).toEqual([]);
    expect(isRangeSyntaxValid("007")).toBe(false);
  });

  it("낱개·범위 양끝이 같은 이유로 거절된다 — 0으로 시작하는 숫자는 쪽 번호가 아니다", () => {
    for (const junk of ["0", "00", "007", "007-9", "9-007", "0-5"]) {
      expect(parseRange(junk, 10).invalid, junk).toBe(true);
      expect(parseRange(junk, 10).indices, junk).toEqual([]);
      expect(isRangeSyntaxValid(junk), junk).toBe(false);
    }
  });

  it("앞자리 0이 없는 숫자는 그대로 읽는다 — 엄격해진 규칙이 정상 표기를 잡아먹지 않는다", () => {
    expect(parseRange("7", 10).indices).toEqual([6]);
    expect(parseRange("10", 10).indices).toEqual([9]);
    expect(parseRange("1-10", 10).indices.length).toBe(10);
  });
});

describe("★ 두 탭이 같은 규칙을 쓴다(resolveRange)", () => {
  /**
   * parseRange는 "읽힌 조각"과 "invalid 깃발"을 함께 돌려주고 판단을 부르는 쪽에 맡긴다.
   * 그 판단이 탭마다 갈리면 같은 입력이 편집 탭에서는 오류, 이미지 탭에서는 0장이 된다.
   * 화면이 쓰는 규칙은 여기 한 곳에만 있다 — 조각 하나라도 못 읽으면 전부 거부.
   */
  it("문서 밖만 가리킨 조각이 있으면 아무것도 내주지 않는다 — 9쪽 문서의 '12-'", () => {
    const r = resolveRange("12-", 9);
    expect(r.problem).toBe("syntax");
    expect(r.groups).toEqual([]);
    expect(r.indices).toEqual([]);
  });

  it("한 조각만 틀려도 살아남은 조각까지 버린다 — 반쪽 결과는 화면에서 구분할 수 없다", () => {
    // parseRange 자체는 살아남은 조각을 그대로 돌려준다(부르는 쪽 몫).
    expect(parseRange("1, 50, 3", 9).indices).toEqual([0, 2]);
    const r = resolveRange("1, 50, 3", 9);
    expect(r.problem).toBe("syntax");
    expect(r.indices).toEqual([]);
  });

  it("읽히긴 했으나 고를 쪽이 없는 경우는 문법 오류와 다른 문제다 — 안내 문구가 갈린다", () => {
    expect(resolveRange("", 9).problem).toBe("noPages");
    expect(resolveRange("  , ; ", 9).problem).toBe("noPages");
  });

  it("정상 표기는 parseRange 결과를 그대로 통과시킨다 — groups 순서도 보존한다", () => {
    const r = resolveRange("8, 1-2", 10);
    expect(r.problem).toBe(null);
    expect(r.groups).toEqual([[7], [0, 1]]);
    expect(r.indices).toEqual([0, 1, 7]);
  });

  it("문서 경계에 걸쳐 잘린 것은 문제가 아니다 — '8-99'는 8쪽부터 끝까지다", () => {
    const r = resolveRange("8-99", 10);
    expect(r.problem).toBe(null);
    expect(r.indices).toEqual([7, 8, 9]);
  });

  it("문제가 있으면 언제나 빈 결과다 — 부르는 쪽이 problem을 잊어도 반쪽 렌더가 안 나간다", () => {
    for (const spec of ["12-", "50", "abc", "1, ?", "0", ""]) {
      const r = resolveRange(spec, 9);
      if (r.problem) {
        expect(r.groups, spec).toEqual([]);
        expect(r.indices, spec).toEqual([]);
      }
    }
  });

  it("같은 표기가 문서마다 갈린다 — 여러 파일을 한 번에 변환하면 짧은 쪽이 전체를 거부한다", () => {
    // 이미지 탭은 문서를 하나씩 재고, 한 문서라도 거부하면 한 장도 내지 않는다.
    // 엄격한 쪽으로 통일한 대가다 — 여기 적어 두어야 나중에 우연으로 읽히지 않는다.
    expect(resolveRange("5", 10).indices).toEqual([4]);
    expect(resolveRange("5", 3).problem).toBe("syntax");
  });

  it("문법 검사가 거절한 표기는 resolveRange도 거절한다 — 두 관문이 어긋나면 배지가 거짓말을 한다", () => {
    // 이미지 탭은 관문이 둘이다: 입력 즉시 도는 isRangeSyntaxValid(쪽 수를 모른다)와
    // 변환하며 도는 resolveRange(쪽 수를 안다). 앞이 통과시킨 것을 뒤가 다른 이유로
    // 거절하는 것은 정상이지만(문서 밖), 앞이 거절한 것을 뒤가 통과시키면 안 된다.
    for (const junk of ["abc", "1-2-3", "1--5", "007", "1, ?", "0-5"]) {
      expect(isRangeSyntaxValid(junk), junk).toBe(false);
      expect(resolveRange(junk, 100).problem, junk).not.toBe(null);
    }
  });
});

describe("표기를 쓸 수 없다는 신호(RangeSpecError)", () => {
  it("Error 하위형이라 catch가 다른 실패와 가려낼 수 있다 — 배지와 오류 배너가 갈린다", () => {
    const err = new RangeSpecError("noPages", "보고서.pdf");
    expect(err instanceof RangeSpecError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err.problem).toBe("noPages");
    expect(err.fileName).toBe("보고서.pdf");
  });

  it("문구가 아니라 이유 코드만 들고 간다 — 사용자 문구는 i18n.ts에만 있다", () => {
    // 배너로 새어 나가더라도 한국어 문장이 되면 안 된다. 그러면 i18n을 우회한 문구다.
    const err = new RangeSpecError("syntax", "a.pdf");
    expect(err.message).toBe("range:syntax");
    expect(/[가-힣]/.test(err.message)).toBe(false);
  });
});
