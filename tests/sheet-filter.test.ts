/** 시트 자동 필터 — 술어·고유값·여러 열 AND·보이는 행 목록.
 *
 * 이 엔진이 답하는 것은 하나다: **어떤 행이 화면에 남는가.** 그래서 여기 적힌
 * 명세도 전부 그 형태다 — 값 하나가 조건에 걸리는가, 걸러 낸 목록이 원래 행
 * 번호를 그대로 들고 있는가.
 *
 * 특히 조심하는 자리 셋:
 *   ① 빈 칸과 0·"0"·FALSE는 다르다. 0을 빈 칸으로 세면 금액 열의 0원이 통째로 사라진다.
 *   ② 수 100과 글자 "100"은 화면에 똑같이 보인다 — 필터에서 갈리면 설명할 길이 없다.
 *   ③ 고유값 목록은 **표시 문자열** 기준이다. 원문이 남은 칸("1.50")은 그 글자가 정체다
 *      (CLAUDE.md 23번). 목록엔 "1.5", 화면엔 "1.50"이면 같은 칸을 두 이름으로 부른다.
 */

import { describe, it, expect } from "vitest";

import { cellKey } from "../apps/sheet/src/lib/sheet/a1";
import { DEFAULT_CSV_WRITE, readCsv, writeCsv } from "../apps/sheet/src/lib/sheet/csv";
import { exportText } from "../apps/sheet/src/lib/sheet/convert";
import {
  isBlank,
  matchesFilter,
  opArity,
  predicateOf,
  uniqueValues,
  visibleRows,
  type ColumnFilter,
  type ConditionOp,
  type FilterCell,
} from "../apps/sheet/src/lib/sheet/filter";
import {
  cellText,
  deleteRowSet,
  filterCellAt,
  parseInput,
  putCell,
} from "../apps/sheet/src/lib/sheet/model";
import { formatValue } from "../apps/sheet/src/lib/sheet/numfmt";
import { emptySheet, ERR, type Scalar, type SheetDoc } from "../apps/sheet/src/lib/sheet/types";

/** 값 하나를 필터가 보는 모습으로. 표시 형식을 주면 화면 글자도 그 형식을 따른다. */
function cell(v: Scalar, fmt?: string): FilterCell {
  return { v, text: formatValue(v, fmt) };
}

/** 파일에서 온 원문이 남은 칸 — 값과 화면 글자가 다르다. */
function preserved(v: Scalar, raw: string): FilterCell {
  return { v, text: raw };
}

const BLANK: FilterCell = { v: null, text: "" };

function condition(op: ConditionOp, value = "", value2?: string): ColumnFilter {
  return { kind: "condition", op, value, value2 };
}

function hits(filter: ColumnFilter, cells: FilterCell[]): boolean[] {
  const ok = predicateOf(filter);
  return cells.map(ok);
}

/** 사람이 친 글자를 시트에 넣은 것과 같은 칸으로. 날짜·수·백분율 해석이 함께 온다. */
function typed(text: string): FilterCell {
  const parsed = parseInput(text);
  return { v: parsed.value, text: formatValue(parsed.value, parsed.numFmt) };
}

/** 세로 한 줄짜리 시트 — 표시 형식과 원문 보존을 함께 시험하려고 model을 그대로 쓴다. */
function columnSheet(values: (string | null)[]): SheetDoc {
  const sheet = emptySheet("Sheet1", values.length + 10, 5);
  values.forEach((text, r) => {
    if (text === null) return;
    const parsed = parseInput(text);
    putCell(sheet, r, 0, {
      v: parsed.value,
      f: parsed.formula,
      ...(parsed.numFmt ? { s: { numFmt: parsed.numFmt } } : {}),
    });
  });
  return sheet;
}

// ────────────────────────────────────────────────────────────────
describe("빈 칸의 경계", () => {
  it("값이 없는 칸만 빈 칸이다", () => {
    expect(isBlank(BLANK)).toBe(true);
    expect(isBlank(cell(""))).toBe(true);
  });

  it("0·\"0\"·FALSE는 빈 칸이 아니다", () => {
    expect(isBlank(cell(0))).toBe(false);
    expect(isBlank(cell("0"))).toBe(false);
    expect(isBlank(cell(false))).toBe(false);
  });

  it("공백 한 칸은 빈 칸이 아니다 — 지우지 않은 칸이니 세어야 한다", () => {
    expect(isBlank(cell(" "))).toBe(false);
  });

  it("빈 칸/빈 칸 아님은 서로의 여집합이다", () => {
    const cells = [BLANK, cell(0), cell("0"), cell(false), cell(ERR.div0)];
    const blank = hits(condition("blank"), cells);
    const notBlank = hits(condition("notBlank"), cells);
    expect(blank).toEqual([true, false, false, false, false]);
    expect(notBlank).toEqual(blank.map((v) => !v));
  });

  it("빈 칸 조건은 값을 받지 않는다", () => {
    expect(opArity("blank")).toBe(0);
    expect(opArity("notBlank")).toBe(0);
    expect(opArity("eq")).toBe(1);
    expect(opArity("between")).toBe(2);
  });
});

describe("같음 · 같지 않음", () => {
  it("수 100과 글자 \"100\"은 둘 다 100에 걸린다 — 화면에 똑같이 보이니까", () => {
    expect(matchesFilter(condition("eq", "100"), cell(100))).toBe(true);
    expect(matchesFilter(condition("eq", "100"), cell("100"))).toBe(true);
  });

  it("천단위 쉼표를 친 값도 같은 수로 읽는다", () => {
    expect(matchesFilter(condition("eq", "1,200"), cell(1200))).toBe(true);
  });

  it("0은 빈 칸과 같지 않다", () => {
    expect(matchesFilter(condition("eq", "0"), cell(0))).toBe(true);
    expect(matchesFilter(condition("eq", "0"), BLANK)).toBe(false);
  });

  it("대소문자는 무시한다", () => {
    expect(matchesFilter(condition("eq", "seoul"), cell("Seoul"))).toBe(true);
    expect(matchesFilter(condition("eq", "SEOUL"), cell("seoul"))).toBe(true);
  });

  it("비교값이 비어 있으면 빈 칸을 고른다", () => {
    expect(matchesFilter(condition("eq", ""), BLANK)).toBe(true);
    expect(matchesFilter(condition("eq", ""), cell("가"))).toBe(false);
  });

  it("오류 칸은 오류 코드로 고른다", () => {
    expect(matchesFilter(condition("eq", "#DIV/0!"), cell(ERR.div0))).toBe(true);
    expect(matchesFilter(condition("eq", "#N/A"), cell(ERR.div0))).toBe(false);
  });

  it("불리언은 TRUE·FALSE로 고른다", () => {
    expect(matchesFilter(condition("eq", "TRUE"), cell(true))).toBe(true);
    expect(matchesFilter(condition("eq", "true"), cell(false))).toBe(false);
  });

  it("원문이 남은 칸은 그 글자로도 걸린다", () => {
    const paid = preserved(1.5, "1.50");
    expect(matchesFilter(condition("eq", "1.50"), paid)).toBe(true);
    // 값이 1.5인 것도 사실이라 수로 쳐도 걸린다.
    expect(matchesFilter(condition("eq", "1.5"), paid)).toBe(true);
  });

  it("같지 않음은 같음의 여집합이다", () => {
    const cells = [cell(100), cell("100"), cell("서울"), BLANK];
    const eq = hits(condition("eq", "100"), cells);
    const ne = hits(condition("ne", "100"), cells);
    expect(ne).toEqual(eq.map((v) => !v));
  });
});

describe("포함 · 시작 · 끝", () => {
  const cells = [cell("서울특별시"), cell("부산광역시"), cell("SEOUL"), BLANK, cell(0)];

  it("포함은 보이는 글자를 대소문자 없이 훑는다", () => {
    expect(hits(condition("contains", "seoul"), cells)).toEqual([false, false, true, false, false]);
    expect(hits(condition("contains", "광역"), cells)).toEqual([false, true, false, false, false]);
  });

  it("포함 안 함에는 빈 칸도 들어간다 — 그 칸에 그 글자는 없다", () => {
    expect(hits(condition("notContains", "서울"), cells)).toEqual([false, true, true, true, true]);
  });

  it("시작·끝은 표시 문자열 기준이다", () => {
    expect(hits(condition("startsWith", "서울"), cells)).toEqual([true, false, false, false, false]);
    expect(hits(condition("endsWith", "시"), cells)).toEqual([true, true, false, false, false]);
  });

  it("수 0의 표시는 \"0\"이라 글자 조건에도 걸린다", () => {
    expect(matchesFilter(condition("contains", "0"), cell(0))).toBe(true);
  });

  it("표시 형식이 붙은 수는 그 형식대로 훑는다", () => {
    const rate = cell(0.125, "0.0%"); // "12.5%"
    expect(rate.text).toBe("12.5%");
    expect(matchesFilter(condition("endsWith", "%"), rate)).toBe(true);
    expect(matchesFilter(condition("contains", "0.125"), rate)).toBe(false);
  });
});

describe("보다 큼 · 작음 · 사이", () => {
  it("수끼리 잰다", () => {
    const cells = [cell(10), cell(100), cell(1000)];
    expect(hits(condition("gt", "100"), cells)).toEqual([false, false, true]);
    expect(hits(condition("lt", "100"), cells)).toEqual([true, false, false]);
  });

  it("사이는 양 끝을 포함하고, 거꾸로 적어도 같은 뜻이다", () => {
    const cells = [cell(9), cell(10), cell(50), cell(100), cell(101)];
    const asc = hits(condition("between", "10", "100"), cells);
    const desc = hits(condition("between", "100", "10"), cells);
    expect(asc).toEqual([false, true, true, true, false]);
    expect(desc).toEqual(asc);
  });

  it("글자는 글자끼리 잰다(한국어 차례)", () => {
    const cells = [cell("가"), cell("나"), cell("다")];
    expect(hits(condition("gt", "나"), cells)).toEqual([false, false, true]);
  });

  it("수 칸에 글자 조건을 걸면 아무것도 안 걸린다 — 견줄 수 없는 것을 견주지 않는다", () => {
    expect(matchesFilter(condition("gt", "서울"), cell(100))).toBe(false);
    expect(matchesFilter(condition("lt", "100"), cell("서울"))).toBe(false);
  });

  it("빈 칸·불리언·오류는 크기 비교에 끼지 않는다", () => {
    const cells = [BLANK, cell(true), cell(ERR.value)];
    expect(hits(condition("gt", "0"), cells)).toEqual([false, false, false]);
    expect(hits(condition("lt", "1000000"), cells)).toEqual([false, false, false]);
    expect(hits(condition("between", "0", "1000000"), cells)).toEqual([false, false, false]);
  });

  it("0은 빈 칸이 아니므로 \"0보다 작음\"의 경계에 제대로 선다", () => {
    expect(matchesFilter(condition("lt", "0"), cell(0))).toBe(false);
    expect(matchesFilter(condition("lt", "0"), cell(-1))).toBe(true);
    expect(matchesFilter(condition("lt", "0"), BLANK)).toBe(false);
  });

  it("날짜는 일련번호로 재므로 날짜 글자를 그대로 쓸 수 있다", () => {
    const days = [typed("2024-01-01"), typed("2024-06-01"), typed("2025-01-01")];
    expect(days.every((d) => typeof d.v === "number")).toBe(true);
    expect(hits(condition("gt", "2024-12-31"), days)).toEqual([false, false, true]);
    expect(hits(condition("between", "2024-01-01", "2024-12-31"), days)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("앞자리 0이 붙은 번호는 글자라 수 비교에 걸리지 않는다", () => {
    const phone = typed("01012345678");
    expect(typeof phone.v).toBe("string");
    expect(matchesFilter(condition("gt", "100"), phone)).toBe(false);
    expect(matchesFilter(condition("startsWith", "010"), phone)).toBe(true);
  });
});

describe("값 목록 필터", () => {
  it("고른 표시 문자열만 남는다", () => {
    const filter: ColumnFilter = { kind: "values", picked: new Set(["서울", "부산"]) };
    const cells = [cell("서울"), cell("대구"), cell("부산")];
    expect(hits(filter, cells)).toEqual([true, false, true]);
  });

  it("빈 칸은 빈 문자열로 고른다", () => {
    const filter: ColumnFilter = { kind: "values", picked: new Set([""]) };
    expect(hits(filter, [BLANK, cell("서울")])).toEqual([true, false]);
  });

  it("원문이 남은 칸은 원문 글자가 정체다", () => {
    const filter: ColumnFilter = { kind: "values", picked: new Set(["1.50"]) };
    expect(hits(filter, [preserved(1.5, "1.50"), cell(1.5)])).toEqual([true, false]);
  });

  /**
   * 목록을 모으는 쪽과 거르는 쪽이 **같은 키**를 봐야 한다.
   * 공백만 든 원문(CSV의 `" "`)은 값이 비어 있어 목록에서는 "(빈 칸)"으로 세어지는데,
   * 술어가 `cell.text`(=" ")를 보던 시절에는 그 줄을 고르면 도리어 사라졌다 —
   * 화면이 센 개수와 남는 줄 수가 달랐다.
   */
  it("목록의 키와 술어의 키가 같다 — 목록에 뜬 줄을 고르면 반드시 남는다", () => {
    const cells = [cell("서울"), BLANK, preserved(null, " "), preserved(1.5, "1.50")];
    for (const item of uniqueValues(cells)) {
      const filter: ColumnFilter = { kind: "values", picked: new Set([item.text]) };
      const kept = cells.filter((c) => matchesFilter(filter, c)).length;
      expect([item.text, kept]).toEqual([item.text, item.count]);
    }
  });

  it("공백만 든 원문은 빈 칸 줄에 함께 모이고, 그 줄을 고르면 함께 남는다", () => {
    // CSV의 `" "` 한 칸 — 값은 비었는데 원문이 남아 화면에는 공백이 보인다.
    const read = readCsv(new TextEncoder().encode("메모\n가\n \n"));
    const cells = [1, 2].map((r) => filterCellAt(read.sheet, r, 0));
    expect(cells.map((c) => [c.v, c.text])).toEqual([
      ["가", "가"],
      [null, " "],
    ]);
    const list = uniqueValues(cells);
    expect(list.find((v) => v.blank)).toEqual({ text: "", count: 1, blank: true });
    expect(hits({ kind: "values", picked: new Set([""]) }, cells)).toEqual([false, true]);
  });
});

describe("고유값 수집", () => {
  it("표시 문자열로 모으고 개수를 센다 — 수 100과 글자 \"100\"은 한 줄이다", () => {
    const list = uniqueValues([cell(100), cell("100"), cell("서울")]);
    expect(list.map((v) => v.text)).toEqual(["100", "서울"]);
    expect(list[0].count).toBe(2);
  });

  it("표시 형식을 따른다 — 화면에 보이는 그 글자가 목록에 뜬다", () => {
    const sheet = columnSheet(["12.5%", "12.5%", "50%"]);
    const cells = [0, 1, 2].map((r) => filterCellAt(sheet, r, 0));
    expect(cells.map((c) => c.text)).toEqual(["12.50%", "12.50%", "50.00%"]);
    const list = uniqueValues(cells);
    expect(list.map((v) => [v.text, v.count])).toEqual([
      ["12.50%", 2],
      ["50.00%", 1],
    ]);
  });

  it("파일 원문이 남은 칸은 원문 그대로 목록에 뜬다", () => {
    const read = readCsv(new TextEncoder().encode("금액\n1.50\n1.5\n"));
    const cells = [1, 2].map((r) => filterCellAt(read.sheet, r, 0));
    expect(cells.map((c) => c.text)).toEqual(["1.50", "1.5"]);
    // 값이 둘 다 1.5라 차례는 표시 문자열이 가른다 — 두 줄이 한 줄로 뭉치지 않는 것이 핵심이다.
    expect(uniqueValues(cells).map((v) => v.text)).toEqual(["1.5", "1.50"]);
  });

  it("차례는 시트 정렬과 같다 — 수, 글자, 불리언, 오류, 빈 칸 순", () => {
    const list = uniqueValues([
      cell("나"),
      BLANK,
      cell(2),
      cell(ERR.na),
      cell("가"),
      cell(1),
      cell(true),
    ]);
    expect(list.map((v) => v.text)).toEqual(["1", "2", "가", "나", "TRUE", "#N/A", ""]);
    expect(list[list.length - 1].blank).toBe(true);
  });

  it("빈 칸은 한 줄로 모인다", () => {
    const list = uniqueValues([BLANK, BLANK, cell("")]);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ text: "", count: 3, blank: true });
  });

  it("값이 하나도 없으면 빈 목록이다", () => {
    expect(uniqueValues([])).toEqual([]);
  });
});

describe("보이는 행 목록", () => {
  const rows = [10, 11, 12, 13, 14];
  const city = [cell("서울"), cell("부산"), cell("서울"), cell("대구"), BLANK];
  const amount = [cell(100), cell(200), cell(50), cell(300), cell(400)];

  it("걸러 낸 뒤에도 **원래 행 번호**를 그대로 준다 — 순번이 아니다", () => {
    const kept = visibleRows(rows, [
      { filter: { kind: "values", picked: new Set(["서울"]) }, cells: city },
    ]);
    expect(kept).toEqual([10, 12]);
  });

  it("여러 열은 AND로 합친다", () => {
    const kept = visibleRows(rows, [
      { filter: { kind: "values", picked: new Set(["서울"]) }, cells: city },
      { filter: condition("gt", "80"), cells: amount },
    ]);
    expect(kept).toEqual([10]);
  });

  it("한 열이 아무것도 안 남기면 결과도 비어 있다", () => {
    const kept = visibleRows(rows, [
      { filter: { kind: "values", picked: new Set(["제주"]) }, cells: city },
      { filter: condition("notBlank"), cells: amount },
    ]);
    expect(kept).toEqual([]);
  });

  it("필터가 없으면 받은 목록 그대로다(같은 배열은 아니다)", () => {
    const kept = visibleRows(rows, []);
    expect(kept).toEqual(rows);
    expect(kept).not.toBe(rows);
  });

  it("차례를 흩뜨리지 않는다", () => {
    const kept = visibleRows(rows, [{ filter: condition("notBlank"), cells: city }]);
    expect(kept).toEqual([10, 11, 12, 13]);
    expect([...kept].sort((a, b) => a - b)).toEqual(kept);
  });

  it("행 번호가 0부터가 아니어도 된다 — 머리글 아래부터 거른다", () => {
    const kept = visibleRows([3, 4, 5], [
      { filter: condition("contains", "서"), cells: [cell("서울"), cell("부산"), cell("서귀포")] },
    ]);
    expect(kept).toEqual([3, 5]);
  });
});

describe("보이는 행만 지우기 — deleteRowSet", () => {
  function sample(): SheetDoc {
    const sheet = emptySheet("Sheet1", 10, 5);
    ["a", "b", "c", "d", "e"].forEach((v, r) => putCell(sheet, r, 0, { v }));
    return sheet;
  }

  const noop = (f: string): string => f;

  it("흩어진 줄을 지우고 남은 줄이 위로 올라온다", () => {
    const sheet = sample();
    deleteRowSet(sheet, [1, 3], noop);
    expect([0, 1, 2, 3].map((r) => sheet.cells.get(cellKey(r, 0))?.v ?? null)).toEqual([
      "a",
      "c",
      "e",
      null,
    ]);
  });

  it("지운 줄 수만큼 시트가 줄어든다", () => {
    const sheet = sample();
    const before = sheet.rows;
    deleteRowSet(sheet, [0, 2, 4], noop);
    expect(sheet.rows).toBe(before - 3);
  });

  it("같은 줄을 두 번 줘도 한 번만 센다", () => {
    const sheet = sample();
    deleteRowSet(sheet, [1, 1, 1], noop);
    expect(sheet.rows).toBe(9);
    expect(sheet.cells.get(cellKey(1, 0))?.v).toBe("c");
  });

  it("참조 보정은 이어진 덩어리 단위로, 아래쪽부터 부른다", () => {
    const sheet = sample();
    putCell(sheet, 4, 1, { v: null, f: "A1" });
    const calls: { at: number; count: number }[] = [];
    deleteRowSet(sheet, [1, 2, 5], (f, at, count) => {
      calls.push({ at, count });
      return f;
    });
    // [1,2]는 한 덩어리, [5]는 따로 — 위쪽을 먼저 지우면 아래쪽 번호가 밀린다.
    expect(calls).toEqual([
      { at: 5, count: 1 },
      { at: 1, count: 2 },
    ]);
  });

  it("행 높이도 함께 따라 올라온다", () => {
    const sheet = sample();
    sheet.rowHeights.set(4, 44);
    deleteRowSet(sheet, [1, 3], noop);
    expect(sheet.rowHeights.get(2)).toBe(44);
    expect(sheet.rowHeights.get(4)).toBeUndefined();
  });

  it("빈 목록은 아무것도 하지 않는다", () => {
    const sheet = sample();
    deleteRowSet(sheet, [], noop);
    expect(sheet.rows).toBe(10);
    expect(sheet.cells.get(cellKey(1, 0))?.v).toBe("b");
  });
});

describe("보이는 행만 내보내기", () => {
  const source = "이름,도시\n김,서울\n이,부산\n박,서울\n";

  function renderer(sheet: SheetDoc): (row: number, col: number) => string {
    return (row, col) => cellText(sheet.cells.get(cellKey(row, col)));
  }

  it("행 목록을 안 주면 표 전체가 나간다 — 기본은 언제나 전부다", () => {
    const read = readCsv(new TextEncoder().encode(source));
    const out = writeCsv(read.sheet, renderer(read.sheet), {
      ...DEFAULT_CSV_WRITE,
      bom: false,
    });
    expect(new TextDecoder().decode(out)).toBe("이름,도시\r\n김,서울\r\n이,부산\r\n박,서울\r\n");
  });

  it("행 목록을 주면 그 줄만 그 차례대로 나간다", () => {
    const read = readCsv(new TextEncoder().encode(source));
    const out = writeCsv(
      read.sheet,
      renderer(read.sheet),
      { ...DEFAULT_CSV_WRITE, bom: false },
      [0, 1, 3],
    );
    expect(new TextDecoder().decode(out)).toBe("이름,도시\r\n김,서울\r\n박,서울\r\n");
  });

  it("표 밖의 행 번호는 조용히 버린다 — 표 아래 빈 줄까지 보내지 않는다", () => {
    const read = readCsv(new TextEncoder().encode(source));
    const out = writeCsv(
      read.sheet,
      renderer(read.sheet),
      { ...DEFAULT_CSV_WRITE, bom: false },
      [0, 1, 3, 99, 120],
    );
    expect(new TextDecoder().decode(out).trimEnd().split("\r\n")).toHaveLength(3);
  });

  it("마크다운 표도 같은 목록을 따른다", () => {
    const read = readCsv(new TextEncoder().encode(source));
    const md = exportText(read.sheet, renderer(read.sheet), "markdown", { header: true }, [0, 2]);
    expect(md.split("\n")).toHaveLength(3); // 머리글 + 구분선 + 한 줄
    expect(md).toContain("부산");
    expect(md).not.toContain("서울");
  });

  it("JSON도 같은 목록을 따른다", () => {
    const read = readCsv(new TextEncoder().encode(source));
    const json = exportText(read.sheet, renderer(read.sheet), "json", { header: true }, [0, 1, 3]);
    expect(JSON.parse(json)).toEqual([
      { 이름: "김", 도시: "서울" },
      { 이름: "박", 도시: "서울" },
    ]);
  });
});
