/** 시트의 바닥 세 장 — 좌표(a1)·날짜 일련번호(serial)·표시 형식(numfmt).
 *
 * 여기 적힌 it 이름이 곧 명세다. 화면에서 걷어낸 해설 문단이 이 자리로 옮겨 온 것이고,
 * 규칙이 깨지면 테스트가 문장으로 항의한다.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_ROWS,
  MAX_COLS,
  colName,
  colIndex,
  cellName,
  parseRef,
  formatRef,
  areaOf,
  areaContains,
  areaWidth,
  areaHeight,
  parseArea,
  formatArea,
  cellKey,
  keyRow,
  keyCol,
} from "../apps/sheet/src/lib/sheet/a1";
import {
  toSerial,
  fromSerial,
  isDateFormat,
  parseDateInput,
  serialFromExcelJsDate,
} from "../apps/sheet/src/lib/sheet/serial";
import { formatValue, FORMAT_PRESETS } from "../apps/sheet/src/lib/sheet/numfmt";
import { ERR } from "../apps/sheet/src/lib/sheet/types";

/** 엑셀 일련번호는 1899-12-30을 0으로 세므로, 1900-03-01 이후는 실제 경과일과 같다. */
const D2024_01_01 = 45292; // 손으로 센 값: 2000-01-01(36526) + 24년(8766일)
const D2024_02_29 = 45351; // 45292 + 31 + 28
const HH13_45 = (13 * 3600 + 45 * 60) / 86400;

describe("a1 — 열 이름은 26진수가 아니다", () => {
  it("A는 0열, Z는 25열, 그 다음 AA가 26열이다", () => {
    expect(colIndex("A")).toBe(0);
    expect(colIndex("Z")).toBe(25);
    expect(colIndex("AA")).toBe(26);
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colName(26)).toBe("AA");
  });

  it("자릿수가 늘 때마다 오프셋이 붙는다 — ZZ는 701, AAA는 702다", () => {
    // 26진수라면 ZZ 다음은 700번대가 아니라 675다. 이 표기법에는 0에 해당하는 글자가 없다.
    expect(colIndex("ZZ")).toBe(701);
    expect(colIndex("AAA")).toBe(702);
    expect(colName(701)).toBe("ZZ");
    expect(colName(702)).toBe("AAA");
  });

  it("xlsx 마지막 열은 XFD이고 그 번호는 16383(= MAX_COLS - 1)이다", () => {
    expect(colIndex("XFD")).toBe(MAX_COLS - 1);
    expect(colIndex("XFD")).toBe(16383);
    expect(colName(16383)).toBe("XFD");
  });

  it("첫 열부터 마지막 열까지 이름↔번호 왕복이 한 칸도 어긋나지 않는다", () => {
    const broken: number[] = [];
    for (let i = 0; i < MAX_COLS; i++) {
      if (colIndex(colName(i)) !== i) broken.push(i);
    }
    expect(broken).toEqual([]);
  });

  it("소문자로 쳐도 같은 열이다 — 사용자는 a1이라고 친다", () => {
    expect(colIndex("aa")).toBe(colIndex("AA"));
    expect(colIndex("xfd")).toBe(16383);
  });

  it("빈 이름과 알파벳 아닌 글자가 섞인 이름은 -1이다", () => {
    expect(colIndex("")).toBe(-1);
    expect(colIndex("A1")).toBe(-1);
    expect(colIndex("A ")).toBe(-1);
    expect(colIndex("가")).toBe(-1);
  });

  it("셀 이름은 열 이름 + 1부터 세는 행 번호다", () => {
    expect(cellName(0, 0)).toBe("A1");
    expect(cellName(8, 2)).toBe("C9");
    expect(cellName(MAX_ROWS - 1, MAX_COLS - 1)).toBe("XFD1048576");
  });
});

describe("a1 — 참조 파싱은 시트 한 장 밖으로 나가지 않는다", () => {
  it("$는 절대 표시로만 읽고 좌표 자체는 상대 참조와 같다", () => {
    expect(parseRef("B7")).toEqual({ row: 6, col: 1, absRow: false, absCol: false });
    expect(parseRef("$B$7")).toEqual({ row: 6, col: 1, absRow: true, absCol: true });
    expect(parseRef("$B7")).toEqual({ row: 6, col: 1, absRow: false, absCol: true });
    expect(parseRef("B$7")).toEqual({ row: 6, col: 1, absRow: true, absCol: false });
  });

  it("행은 1부터 센다 — A0은 참조가 아니다", () => {
    expect(parseRef("A1")?.row).toBe(0);
    expect(parseRef("A0")).toBeNull();
    expect(parseRef("A-1")).toBeNull();
  });

  it("마지막 칸 XFD1048576은 유효하고, 한 칸이라도 넘으면 null이다", () => {
    expect(parseRef("XFD1048576")).toEqual({
      row: MAX_ROWS - 1,
      col: MAX_COLS - 1,
      absRow: false,
      absCol: false,
    });
    expect(parseRef("XFE1")).toBeNull(); // 16384열 — 시트 밖
    expect(parseRef("A1048577")).toBeNull(); // 1048576행 — 시트 밖
  });

  it("참조 문자열은 절대 표시까지 그대로 왕복한다", () => {
    for (const s of ["A1", "$B$7", "$C9", "D$10", "XFD1048576", "AA26"]) {
      const ref = parseRef(s);
      expect(ref).not.toBeNull();
      expect(formatRef(ref!)).toBe(s);
    }
  });

  it("앞뒤 공백은 흘려 보내고 소문자는 대문자로 정규화한다", () => {
    expect(formatRef(parseRef("  b7  ")!)).toBe("B7");
    expect(formatRef(parseRef("$aa$1")!)).toBe("$AA$1");
  });

  it("시트 접두사가 붙은 참조는 이 파일이 읽지 않는다(수식 렉서가 미리 뗀다)", () => {
    expect(parseRef("Sheet1!C3")).toBeNull();
    expect(parseArea("Sheet1!A1:C9")).toBeNull();
  });
});

describe("a1 — 영역은 모서리 순서를 타지 않는다", () => {
  it("어느 모서리를 먼저 집든 같은 사각형이 된다", () => {
    const a = areaOf({ row: 8, col: 2 }, { row: 0, col: 0 });
    const b = areaOf({ row: 0, col: 0 }, { row: 8, col: 2 });
    expect(a).toEqual({ top: 0, left: 0, bottom: 8, right: 2 });
    expect(a).toEqual(b);
    expect(parseArea("C9:A1")).toEqual(parseArea("A1:C9"));
  });

  it("한 칸짜리 영역은 A1:A1이 아니라 A1로 적힌다", () => {
    const one = parseArea("A1")!;
    expect(one).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
    expect(formatArea(one)).toBe("A1");
    expect(areaWidth(one)).toBe(1);
    expect(areaHeight(one)).toBe(1);
  });

  it("너비·높이는 양 끝을 포함해서 센다 — A1:C9는 3×9다", () => {
    const area = parseArea("A1:C9")!;
    expect(areaWidth(area)).toBe(3);
    expect(areaHeight(area)).toBe(9);
    expect(formatArea(area)).toBe("A1:C9");
  });

  it("포함 판정은 경계선을 안쪽으로 친다", () => {
    const area = parseArea("B2:D4")!;
    expect(areaContains(area, 1, 1)).toBe(true); // B2
    expect(areaContains(area, 3, 3)).toBe(true); // D4
    expect(areaContains(area, 0, 1)).toBe(false); // B1
    expect(areaContains(area, 4, 3)).toBe(false); // D5
  });

  it("콜론이 두 개 이상이거나 한쪽이 참조가 아니면 영역이 아니다", () => {
    expect(parseArea("A1:B2:C3")).toBeNull();
    expect(parseArea("A1:")).toBeNull();
    expect(parseArea(":B2")).toBeNull();
    expect(parseArea("")).toBeNull();
  });
});

describe("a1 — 셀 키는 (행,열)을 정수 하나로 접는다", () => {
  it("마지막 칸까지 접었다 펴도 자기 자신이다", () => {
    for (const [row, col] of [
      [0, 0],
      [0, MAX_COLS - 1],
      [MAX_ROWS - 1, 0],
      [MAX_ROWS - 1, MAX_COLS - 1],
      [7, 3],
    ]) {
      const key = cellKey(row, col);
      expect(Number.isSafeInteger(key)).toBe(true);
      expect(keyRow(key)).toBe(row);
      expect(keyCol(key)).toBe(col);
    }
  });

  it("행이 하나 늘어난 칸과 열이 하나 늘어난 칸의 키는 겹치지 않는다", () => {
    expect(cellKey(1, 0)).toBe(MAX_COLS);
    expect(cellKey(0, 1)).toBe(1);
    expect(cellKey(1, 0)).not.toBe(cellKey(0, 1));
  });
});

describe("serial — 엑셀 날짜 일련번호", () => {
  it("1899-12-30을 0일로 세므로 1900-03-01은 61이다", () => {
    expect(toSerial(new Date(1900, 2, 1))).toBe(61);
    const back = fromSerial(61);
    expect([back.getFullYear(), back.getMonth() + 1, back.getDate()]).toEqual([1900, 3, 1]);
  });

  it("2000-01-01은 36526, 2024-01-01은 45292다", () => {
    expect(toSerial(new Date(2000, 0, 1))).toBe(36526);
    expect(toSerial(new Date(2024, 0, 1))).toBe(D2024_01_01);
  });

  it("2024-02-29 같은 진짜 윤년 하루는 그대로 하루로 센다", () => {
    expect(toSerial(new Date(2024, 1, 29))).toBe(D2024_02_29);
    expect(toSerial(new Date(2024, 2, 1))).toBe(D2024_02_29 + 1);
  });

  it("소수부는 하루 안의 시각이다 — 0.5는 정오다", () => {
    expect(toSerial(new Date(2024, 0, 1, 12, 0, 0))).toBe(D2024_01_01 + 0.5);
    expect(toSerial(new Date(2024, 0, 1, 6, 0, 0))).toBe(D2024_01_01 + 0.25);
    const noon = fromSerial(D2024_01_01 + 0.5);
    expect(noon.getHours()).toBe(12);
    expect(noon.getMinutes()).toBe(0);
  });

  it("1900-03-01 이후 날짜는 Date→일련번호→Date 왕복이 자기 자신이다", () => {
    const samples = [
      new Date(1900, 2, 1),
      new Date(1970, 0, 1, 12, 0, 0),
      new Date(1999, 11, 31, 23, 59, 59),
      new Date(2024, 1, 29, 13, 45, 30),
      new Date(2026, 7, 14, 9, 5, 0),
      new Date(2099, 11, 31),
    ];
    for (const d of samples) {
      expect(fromSerial(toSerial(d)).getTime()).toBe(d.getTime());
    }
  });

  it("일련번호→Date→일련번호도 정수·소수 모두 제자리로 돌아온다", () => {
    for (const s of [61, 1000, D2024_01_01, D2024_01_01 + 0.5, D2024_01_01 + HH13_45, 60000.75]) {
      expect(toSerial(fromSerial(s))).toBeCloseTo(s, 9);
    }
  });

  it("시간대를 타지 않는다 — 로컬 시각 그대로 읽고 로컬 시각 그대로 돌려준다", () => {
    // Date.UTC로 옮겨 재고 다시 로컬 성분으로 조립하므로, 실행 머신의 TZ와 무관하다.
    const d = new Date(2024, 6, 1, 0, 0, 0);
    expect(toSerial(d) % 1).toBe(0);
    expect(fromSerial(toSerial(d)).getHours()).toBe(0);
  });
});

describe("serial — 1900년 윤년 버그를 흉내 내는 방향", () => {
  // 1900은 윤년이 아니지만 엑셀은 존재하지 않는 1900-02-29를 60번으로 센다.
  // 그래서 1900-03-01 이전 날짜는 실제 경과일보다 하나 "적은" 번호를 받는다.
  it("엑셀 1번은 1900-01-01이다", () => {
    expect(toSerial(new Date(1900, 0, 1))).toBe(1);
    const d = fromSerial(1);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([1900, 1, 1]);
  });

  it("1900-02-28은 59이고 61이 1900-03-01이다 — 60은 가짜 1900-02-29의 자리다", () => {
    expect(toSerial(new Date(1900, 1, 28))).toBe(59);
    expect(toSerial(new Date(1900, 2, 1))).toBe(61);
    const d = fromSerial(59);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([1900, 2, 28]);
  });

  it("2월의 날들이 서로 다른 번호를 갖는다 — 27일과 28일이 같은 번호면 안 된다", () => {
    expect(toSerial(new Date(1900, 1, 27))).toBe(58);
    expect(toSerial(new Date(1900, 1, 27))).not.toBe(toSerial(new Date(1900, 1, 28)));
    const seen = new Set<number>();
    for (let day = 1; day <= 28; day++) seen.add(toSerial(new Date(1900, 1, day)));
    expect(seen.size).toBe(28);
  });

  it("1900-01-01부터 1900-02-28까지 날짜→번호→날짜 왕복이 자기 자신이다", () => {
    const broken: string[] = [];
    for (const [m, d] of [
      [0, 1],
      [0, 31],
      [1, 1],
      [1, 27],
      [1, 28],
    ]) {
      const src = new Date(1900, m, d);
      if (fromSerial(toSerial(src)).getTime() !== src.getTime()) broken.push(`1900-${m + 1}-${d}`);
    }
    expect(broken).toEqual([]);
  });

  it("시각이 붙어도 같은 규칙이다 — 1900-01-01 정오는 1.5다", () => {
    expect(toSerial(new Date(1900, 0, 1, 12, 0, 0))).toBe(1.5);
  });

  it("1900년대 초 날짜도 형식으로 그리면 엑셀과 같은 날이 나온다", () => {
    expect(formatValue(1, "yyyy-mm-dd")).toBe("1900-01-01");
    expect(formatValue(59, "yyyy-mm-dd")).toBe("1900-02-28");
    expect(formatValue(61, "yyyy-mm-dd")).toBe("1900-03-01");
  });
});

describe("serial — ExcelJS가 준 Date 되읽기(serialFromExcelJsDate)", () => {
  // xlsx 어댑터 둘(xlsx.ts의 readValue·validation.ts의 utcToIso)이 쓰는 함수다.
  // ExcelJS는 일련번호를 `1899-12-30 UTC + serial일`로 풀고 **1900년 윤년 버그를
  // 흉내 내지 않는다** — 그래서 위 toSerial과 달리 61 미만에서도 보정이 없다.
  // 실물 파일로 재는 것은 tests/sheet-roundtrip.test.ts의 시간대 표다.

  const utc = (iso: string): Date => new Date(iso);

  it("ExcelJS의 대응을 그대로 뒤집는다 — 파일에 적힌 수가 그대로 돌아온다", () => {
    // 오른쪽 Date는 ExcelJS가 돌려준 값이다 — 같은 파일을 열어 찍어 봤다.
    expect(serialFromExcelJsDate(utc("2024-01-05T00:00:00Z"))).toBe(45296);
    expect(serialFromExcelJsDate(utc("2024-01-05T12:00:00Z"))).toBe(45296.5);
    expect(serialFromExcelJsDate(utc("1900-03-01T00:00:00Z"))).toBe(61);
    expect(serialFromExcelJsDate(utc("1900-02-28T00:00:00Z"))).toBe(60);
    expect(serialFromExcelJsDate(utc("1899-12-31T00:00:00Z"))).toBe(1);
    expect(serialFromExcelJsDate(utc("1899-12-30T12:00:00Z"))).toBe(0.5);
  });

  it("61 미만에서 윤년 보정을 하지 않는다 — 얹으면 파일의 1이 0으로 저장된다", () => {
    // toSerial은 같은 날짜에 보정을 얹는다. 두 함수가 갈리는 자리가 여기다.
    expect(serialFromExcelJsDate(utc("1899-12-31T00:00:00Z"))).toBe(1);
    expect(toSerial(new Date(1899, 11, 31))).toBe(0);
  });

  it("시간대를 읽지 않는다 — 같은 순간이면 어느 시간대에서 돌려도 같은 값이다", () => {
    // getTime()만 쓰므로 로컬 성분을 볼 자리가 없다. 같은 순간을 로컬 문자열로
    // 적어 넣어도(오프셋이 붙은 ISO) 값이 하나다.
    const moment = utc("2024-01-05T00:00:00Z");
    expect(serialFromExcelJsDate(new Date("2024-01-05T09:00:00+09:00"))).toBe(
      serialFromExcelJsDate(moment),
    );
    expect(serialFromExcelJsDate(new Date("2024-01-04T19:00:00-05:00"))).toBe(45296);
  });
});

describe("serial — 사람이 친 날짜 읽기", () => {
  it("yyyy-mm-dd는 일련번호와 표시 형식을 함께 정해 준다", () => {
    expect(parseDateInput("2024-01-01")).toEqual({ serial: D2024_01_01, fmt: "yyyy-mm-dd" });
  });

  it("구분자는 -, /, . 셋 다 같은 날짜로 읽는다", () => {
    expect(parseDateInput("2024/01/01")?.serial).toBe(D2024_01_01);
    expect(parseDateInput("2024.01.01")?.serial).toBe(D2024_01_01);
    expect(parseDateInput("2024-1-1")?.serial).toBe(D2024_01_01);
  });

  it("없는 날짜는 조용히 넘기지 않고 거절한다 — Date는 2월 30일을 3월 1일로 흘린다", () => {
    expect(parseDateInput("2024-02-30")).toBeNull();
    expect(parseDateInput("2023-02-29")).toBeNull(); // 평년
    expect(parseDateInput("2024-13-01")).toBeNull();
    expect(parseDateInput("2024-00-10")).toBeNull();
    expect(parseDateInput("2024-02-29")?.serial).toBe(D2024_02_29); // 윤년은 통과
  });

  it("시각만 치면 날짜 없이 하루의 분수만 남는다", () => {
    expect(parseDateInput("13:45")?.serial).toBeCloseTo(HH13_45, 12);
    expect(parseDateInput("12:00")?.serial).toBe(0.5);
    expect(parseDateInput("00:00")?.serial).toBe(0);
    expect(parseDateInput("13:45")?.fmt).toBe("hh:mm");
    expect(parseDateInput("13:45:30")?.fmt).toBe("hh:mm:ss");
  });

  it("24시·60분·60초는 시각이 아니다", () => {
    expect(parseDateInput("24:00")).toBeNull();
    expect(parseDateInput("12:60")).toBeNull();
    expect(parseDateInput("12:30:60")).toBeNull();
    expect(parseDateInput("23:59:59")).not.toBeNull();
  });

  it("날짜+시각은 초를 친 사람에게만 초 형식을 준다", () => {
    expect(parseDateInput("2024-01-01 13:45")).toEqual({
      serial: D2024_01_01 + 45 * 60 / 86400 + 13 * 3600 / 86400,
      fmt: "yyyy-mm-dd hh:mm",
    });
    expect(parseDateInput("2024-01-01T13:45:30")?.fmt).toBe("yyyy-mm-dd hh:mm:ss");
  });

  it("날짜로 안 읽히는 것은 전부 null이다 — 빈 칸·글자·순수한 수", () => {
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("안녕")).toBeNull();
    expect(parseDateInput("45292")).toBeNull();
    expect(parseDateInput("2024-01")).toBeNull();
  });

  it("친 날짜를 그 형식으로 다시 그리면 친 그대로다(입력↔표시 왕복)", () => {
    for (const text of ["2024-01-01", "1999-12-31", "2026-08-14"]) {
      const parsed = parseDateInput(text)!;
      expect(formatValue(parsed.serial, parsed.fmt)).toBe(text);
    }
    const t = parseDateInput("13:45")!;
    expect(formatValue(t.serial, t.fmt)).toBe("13:45");
  });
});

describe("serial — 이 형식이 날짜를 그리는가", () => {
  it("y·m·d·h·s가 진짜 자리표시자로 있을 때만 날짜다", () => {
    expect(isDateFormat("yyyy-mm-dd")).toBe(true);
    expect(isDateFormat("hh:mm:ss")).toBe(true);
    expect(isDateFormat("#,##0.00")).toBe(false);
    expect(isDateFormat("0.0%")).toBe(false);
    expect(isDateFormat(undefined)).toBe(false);
    expect(isDateFormat("")).toBe(false);
    expect(isDateFormat("General")).toBe(false);
  });

  it("대괄호 안 색 코드의 글자는 세지 않는다 — [Red]의 d에 속으면 안 된다", () => {
    expect(isDateFormat("[Red]#,##0")).toBe(false);
    expect(isDateFormat("[$₩-412]#,##0")).toBe(false);
    expect(isDateFormat("[빨강]-₩#,##0")).toBe(false);
  });

  it("경과 시간 [h]·[mm]·[ss]는 대괄호 안에 있어도 시간 형식이다", () => {
    expect(isDateFormat("[h]:mm")).toBe(true);
    expect(isDateFormat("[mm]:ss")).toBe(true);
    expect(isDateFormat("[ss]")).toBe(true);
    expect(isDateFormat("[빨강]#,##0")).toBe(false); // 색 코드와 헷갈리지 않는다
  });

  it("따옴표 안 글자와 역슬래시로 이스케이프한 글자도 세지 않는다", () => {
    expect(isDateFormat('0" sec"')).toBe(false);
    expect(isDateFormat('#,##0" 시간"')).toBe(false);
    expect(isDateFormat("0\\d")).toBe(false);
  });
});

describe("numfmt — 반올림 경계", () => {
  it("0.5는 언제나 올린다 — 은행가 반올림이 아니다", () => {
    // 은행가 반올림이면 0.5→0, 2.5→2가 된다. 엑셀은 그렇게 하지 않는다.
    expect(formatValue(0.5, "0")).toBe("1");
    expect(formatValue(1.5, "0")).toBe("2");
    expect(formatValue(2.5, "0")).toBe("3");
    expect(formatValue(3.5, "0")).toBe("4");
  });

  it("음수는 0에서 멀어지는 쪽으로 올린다", () => {
    expect(formatValue(-0.5, "0")).toBe("-1");
    expect(formatValue(-2.5, "0")).toBe("-3");
  });

  it("소수 자리에서도 같은 규칙이다", () => {
    expect(formatValue(0.125, "0.00")).toBe("0.13");
    expect(formatValue(1.005, "0.0")).toBe("1.0");
    expect(formatValue(2 / 3, "0.00")).toBe("0.67");
  });

  it("반올림은 표시만 바꾼다 — 값은 형식 없이 보면 그대로다", () => {
    expect(formatValue(2.5, "0")).toBe("3");
    expect(formatValue(2.5)).toBe("2.5");
  });
});

describe("numfmt — 숫자 자리와 천 단위", () => {
  it("#은 지워지는 자리, 0은 반드시 남는 자리다", () => {
    expect(formatValue(4520, "#,##0.##")).toBe("4,520"); // 소수부가 0이면 소수점째 사라진다
    expect(formatValue(4520.5, "#,##0.##")).toBe("4,520.5");
    expect(formatValue(4520, "#,##0.00")).toBe("4,520.00"); // 0은 남는다
  });

  it("정수부의 0은 자릿수를 채운다 — 우편번호가 앞의 0을 잃지 않는다", () => {
    expect(formatValue(42, "00000")).toBe("00042");
    expect(formatValue(0, "00000")).toBe("00000");
  });

  it("정수부에 0이 하나도 없으면 0.5는 .5로 그린다", () => {
    expect(formatValue(0.5, "#.##")).toBe(".5");
    expect(formatValue(0.5, "0.##")).toBe("0.5");
  });

  it("쉼표는 세 자리마다 끊는다 — 0과 한 자리에서도 깨지지 않는다", () => {
    expect(formatValue(1234567, "#,##0")).toBe("1,234,567");
    expect(formatValue(1000, "#,##0")).toBe("1,000");
    expect(formatValue(999, "#,##0")).toBe("999");
    expect(formatValue(0, "#,##0")).toBe("0");
    expect(formatValue(-1234567, "#,##0")).toBe("-1,234,567");
  });

  it("자리표시자 뒤에 붙은 쉼표는 천 단위가 아니라 1000으로 나누라는 뜻이다", () => {
    expect(formatValue(1234567, "#,##0,")).toBe("1,235"); // 천 단위
    expect(formatValue(1234567890, "#,##0,,")).toBe("1,235"); // 백만 단위
  });

  it("백분율은 100을 곱하고 %를 붙인다", () => {
    expect(formatValue(0.1234, "0.0%")).toBe("12.3%");
    expect(formatValue(1, "0%")).toBe("100%");
    expect(formatValue(0, "0.0%")).toBe("0.0%");
    expect(formatValue(0.005, "0.00%")).toBe("0.50%");
  });

  it("따옴표 안 글자와 [$기호] 통화 구역은 숫자 앞뒤에 그대로 붙는다", () => {
    expect(formatValue(1234.5, '"$"#,##0.00')).toBe("$1,234.50");
    expect(formatValue(1500, "₩#,##0")).toBe("₩1,500");
    expect(formatValue(1500, "[$₩-412]#,##0")).toBe("₩1,500");
    expect(formatValue(3, '#,##0" 개"')).toBe("3 개");
  });

  it("색 코드는 표시 문자열에 남지 않는다", () => {
    expect(formatValue(1500, "[빨강]#,##0")).toBe("1,500");
  });
});

describe("numfmt — 세미콜론으로 갈린 구역", () => {
  it("첫 구역은 양수, 둘째는 음수 — 부호는 음수 구역이 직접 그린다", () => {
    expect(formatValue(1234, "#,##0;(#,##0)")).toBe("1,234");
    expect(formatValue(-1234, "#,##0;(#,##0)")).toBe("(1,234)"); // 빼기표가 아니라 괄호
    expect(formatValue(-1500, "₩#,##0;[빨강]-₩#,##0")).toBe("-₩1,500");
    expect(formatValue(1500, "₩#,##0;[빨강]-₩#,##0")).toBe("₩1,500");
  });

  it("음수 구역이 없으면 양수 구역에 빼기표를 앞세운다", () => {
    expect(formatValue(-1500, "₩#,##0")).toBe("-₩1,500");
  });

  it("음수 구역이 비어 있어도 값을 감추지 않고 양수 구역으로 그린다", () => {
    // 엑셀은 여기서 음수를 숨기지만, 이 구현은 값이 안 보이는 쪽을 택하지 않는다.
    expect(formatValue(-1234, "#,##0;")).toBe("-1,234");
  });

  it("0은 셋째 구역이 있을 때만 따로 그린다", () => {
    expect(formatValue(0, "#,##0;(#,##0)")).toBe("0"); // 구역이 둘뿐이면 양수 구역
    expect(formatValue(0, "#,##0;(#,##0);0.00")).toBe("0.00");
  });

  it("넷째 구역은 텍스트 자리다 — @가 원문으로 바뀐다", () => {
    expect(formatValue("abc", '#,##0;-#,##0;0;"["@"]"')).toBe("[abc]");
  });

  it("따옴표 안 세미콜론은 구역을 가르지 않는다", () => {
    expect(formatValue(5, '0";"')).toBe("5;");
  });
});

describe("numfmt — 날짜 그리기", () => {
  it("yyyy-mm-dd는 0을 채우고, yy·m·d는 채우지 않는다", () => {
    expect(formatValue(D2024_01_01, "yyyy-mm-dd")).toBe("2024-01-01");
    expect(formatValue(D2024_01_01, "yy/m/d")).toBe("24/1/1");
    expect(formatValue(D2024_02_29, "yyyy-mm-dd")).toBe("2024-02-29");
  });

  it("시(h) 다음의 m은 월이 아니라 분이다 — 같은 글자를 자리로 가른다", () => {
    const s = D2024_01_01 + HH13_45;
    expect(formatValue(s, "hh:mm")).toBe("13:45");
    expect(formatValue(s, "mm")).toBe("01"); // 시가 앞에 없으면 월
    expect(formatValue(s, "yyyy-mm-dd hh:mm")).toBe("2024-01-01 13:45");
  });

  it("AM/PM이 붙으면 12시제로 그리고, 0시는 12 AM이다", () => {
    expect(formatValue(D2024_01_01 + HH13_45, "h:mm AM/PM")).toBe("1:45 PM");
    expect(formatValue(D2024_01_01 + 30 * 60 / 86400, "h:mm AM/PM")).toBe("12:30 AM");
    expect(formatValue(D2024_01_01 + 0.5, "h:mm AM/PM")).toBe("12:00 PM");
  });

  it("ddd·dddd·mmm은 한국어 요일·월 이름이다", () => {
    // 2024-01-01은 월요일이다.
    expect(formatValue(D2024_01_01, "ddd")).toBe("월");
    expect(formatValue(D2024_01_01, "dddd")).toBe("월요일");
    expect(formatValue(D2024_01_01, "mmm")).toBe("1월");
  });

  it("따옴표 안 글자는 그대로 찍고 [ ] 로케일 코드는 버린다", () => {
    expect(formatValue(D2024_01_01, '[$-ko-KR]yyyy"년" m"월" d"일"')).toBe("2024년 1월 1일");
  });

  it("초를 포함한 시각도 자리를 채워 그린다", () => {
    const s = D2024_01_01 + (13 * 3600 + 45 * 60 + 5) / 86400;
    expect(formatValue(s, "hh:mm:ss")).toBe("13:45:05");
  });

  it("General은 날짜 형식이 아니므로 일련번호를 수로 보여 준다", () => {
    expect(formatValue(D2024_01_01)).toBe("45292");
    expect(formatValue(D2024_01_01, "General")).toBe("45292");
  });
});

describe("numfmt — General(기본 표시)", () => {
  it("긴 정수를 지수 표기로 접지 않는다 — 16자리 주문번호가 굳어 저장되던 사고", () => {
    expect(formatValue(1234567890123456)).toBe("1234567890123456");
    expect(formatValue(1e15)).toBe("1000000000000000");
    expect(formatValue(-1e15)).toBe("-1000000000000000");
  });

  it("부동소수 잡음은 지우되 유효자리는 남긴다", () => {
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(1 / 3)).toBe("0.333333333333");
  });

  it("지수 표기로 접히는 것은 정수가 아닌 값뿐이다 — 큰 쪽 1e11, 작은 쪽 1e-10", () => {
    expect(formatValue(123456789012.5)).toBe("1.23457E+11"); // 1e11 이상 + 소수
    expect(formatValue(150000000000)).toBe("150000000000"); // 같은 크기라도 정수면 그대로
    expect(formatValue(1e-11)).toBe("1.00000E-11");
    expect(formatValue(0)).toBe("0");
  });

  it("지수부의 0을 소수 자리처럼 잘라 먹지 않는다 — 1e-10이 0.1로 보이던 사고", () => {
    expect(formatValue(1e-10)).toBe("1E-10");
    expect(formatValue(1.5e-10)).toBe("1.5E-10");
    expect(formatValue(-1.2e-10)).toBe("-1.2E-10");
    // 크기가 아홉 자리 어긋나지 않는지 값으로도 확인한다.
    expect(Number(formatValue(1e-10))).toBe(1e-10);
    expect(Number(formatValue(1.5e-10))).toBe(1.5e-10);
  });

  it("유한하지 않은 수는 #NUM!이다", () => {
    expect(formatValue(Infinity)).toBe("#NUM!");
    expect(formatValue(-Infinity)).toBe("#NUM!");
    expect(formatValue(NaN)).toBe("#NUM!");
  });
});

describe("numfmt — 지수 표시형식", () => {
  it("E 뒤의 자릿수는 지수 자리이지 소수 자리가 아니다", () => {
    // "0.00E+00" = 가수 소수 두 자리 + 지수 두 자리. 엑셀은 1.23E+04로 그린다.
    expect(formatValue(12345, "0.00E+00")).toBe("1.23E+04");
    expect(formatValue(0.00012345, "0.00E+00")).toBe("1.23E-04");
    expect(formatValue(0, "0.00E+00")).toBe("0.00E+00");
  });

  it("지수는 형식이 적은 자릿수만큼 채우되 넘치면 그대로 적는다", () => {
    expect(formatValue(12345, "0E+0")).toBe("1E+4");
    expect(formatValue(1.5e120, "0.0E+00")).toBe("1.5E+120");
  });

  it("E-00은 양의 지수에 +를 붙이지 않는다", () => {
    expect(formatValue(12345, "0.00E-00")).toBe("1.23E04");
    expect(formatValue(0.00012345, "0.00E-00")).toBe("1.23E-04");
  });

  it("음수는 가수 앞에 부호를 세운다", () => {
    expect(formatValue(-12345, "0.00E+00")).toBe("-1.23E+04");
  });

  it("툴바의 '지수' 프리셋이 바로 이 형식이다", () => {
    const sci = FORMAT_PRESETS.find((p) => p.id === "sci")!;
    expect(sci.code).toBe("0.00E+00");
    expect(formatValue(12345, sci.code)).toBe("1.23E+04");
  });
});

describe("numfmt — 분(m)과 월(m)을 가르는 자리", () => {
  const T13_45_05 = D2024_01_01 + (13 * 3600 + 45 * 60 + 5) / 86400;

  it("s에 붙은 m은 분이다 — mm:ss는 45분 5초다", () => {
    expect(formatValue(T13_45_05, "mm:ss")).toBe("45:05");
    expect(formatValue(T13_45_05, "m:s")).toBe("45:5");
  });

  it("앞에 시도 없고 뒤에 초도 없으면 여전히 월이다", () => {
    expect(formatValue(D2024_01_01, "mm")).toBe("01");
    expect(formatValue(D2024_01_01, "mm-dd")).toBe("01-01");
    expect(formatValue(D2024_01_01, "yyyy-mm-dd")).toBe("2024-01-01");
  });

  it("대괄호 [h]는 색 코드가 아니라 경과 시간이다 — 하루 반은 36시간이다", () => {
    expect(formatValue(1.5, "[h]:mm")).toBe("36:00");
    expect(formatValue(0.5, "[h]:mm")).toBe("12:00");
    expect(formatValue((26 * 3600 + 5 * 60) / 86400, "[h]:mm")).toBe("26:05");
  });

  it("[mm]은 총 분, [ss]는 총 초이고 자릿수는 형식이 정한다", () => {
    expect(formatValue((90 * 60 + 30) / 86400, "[mm]:ss")).toBe("90:30");
    expect(formatValue(125 / 86400, "[ss]")).toBe("125");
    expect(formatValue(5 / 86400, "[hh]:mm:ss")).toBe("00:00:05");
  });
});

describe("numfmt — 글자만 있는 구역", () => {
  const ACC = '#,##0;(#,##0);"-"';

  it("셋째 구역이 글자뿐이면 0은 그 글자로 그린다(회계 형식)", () => {
    expect(formatValue(0, ACC)).toBe("-");
    expect(formatValue(1234, ACC)).toBe("1,234");
    expect(formatValue(-1234, ACC)).toBe("(1,234)");
  });

  it("따옴표 없이 적은 글자도 그대로 나온다", () => {
    expect(formatValue(0, "#,##0;-#,##0;–")).toBe("–");
  });

  it("엑셀이 실제로 쓰는 회계 형식도 그대로 읽는다 — 여백(_)·채움(*) 코드가 글자로 새지 않는다", () => {
    // xlsx의 '회계' 서식은 언제나 이 꼴로 들어온다. _x는 x 폭만큼의 여백,
    // *x는 칸을 채우는 반복이라 둘 다 화면 글자가 아니다.
    const ACC = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';
    expect(formatValue(1234.5, ACC)).toBe("1,234.50");
    expect(formatValue(-1234.5, ACC)).toBe("-1,234.50");
    expect(formatValue(0, ACC)).toBe("-");
  });

  it("General이라 적힌 구역은 글자가 아니라 기본 표시다", () => {
    expect(formatValue(0, "#,##0;-#,##0;General")).toBe("0");
  });

  it("빈 구역은 여전히 값을 감추지 않는다", () => {
    expect(formatValue(0, "#,##0;-#,##0;")).toBe("0");
  });
});

describe("numfmt — 텍스트 구역(넷째 구역)", () => {
  it("회계 서식이 걸린 칸에 글자를 넣어도 여백(_)·채움(*) 코드가 새지 않는다", () => {
    // 넷째 구역 `_-@_-`는 xlsx '회계' 서식에 언제나 딸려 온다. 숫자 구역과 같은 규약이라
    // _x·*x는 화면 글자가 아니다 — 예전엔 "_-미정_-"이 그대로 보였다.
    const ACC = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';
    expect(formatValue("미정", ACC)).toBe("미정");
  });

  it("따옴표 안 글자는 그대로, 역슬래시로 이스케이프한 글자는 그 글자만 남는다", () => {
    expect(formatValue("미정", '#,##0;(#,##0);"-";"["@"]"')).toBe("[미정]");
    expect(formatValue("미정", "#,##0;;;\\<@\\>")).toBe("<미정>");
  });

  it("색 코드는 글자가 아니다", () => {
    expect(formatValue("미정", '#,##0;(#,##0);"-";[빨강]@')).toBe("미정");
  });

  it("넷째 구역이 없으면 글자는 원문 그대로다", () => {
    expect(formatValue("미정", "#,##0")).toBe("미정");
    expect(formatValue("미정", '#,##0;(#,##0);"-"')).toBe("미정");
  });
});

describe("numfmt — 숫자가 아닌 값", () => {
  it("빈 셀은 빈 문자열이다", () => {
    expect(formatValue(null)).toBe("");
    expect(formatValue(null, "#,##0")).toBe("");
  });

  it("오류값은 어떤 형식에도 흔들리지 않고 코드 그대로다", () => {
    expect(formatValue(ERR.div0, "#,##0.00")).toBe("#DIV/0!");
    expect(formatValue(ERR.na, "yyyy-mm-dd")).toBe("#N/A");
  });

  it("불리언은 형식과 무관하게 TRUE/FALSE다", () => {
    expect(formatValue(true, "#,##0")).toBe("TRUE");
    expect(formatValue(false)).toBe("FALSE");
  });

  it("텍스트는 숫자 형식에 닿아도 원문 그대로 남는다", () => {
    // 앞의 +와 0을 살려 둬야 하는 값들이 여기에 걸린다.
    expect(formatValue("+821012345678", "#,##0")).toBe("+821012345678");
    expect(formatValue("00123", "0")).toBe("00123");
    expect(formatValue("abc")).toBe("abc");
  });

  it("텍스트 형식(@)은 수도 손대지 않고 General로 보여 준다", () => {
    expect(formatValue(1234.5, "@")).toBe("1234.5");
  });
});

describe("numfmt — 툴바 프리셋", () => {
  it("프리셋 코드는 전부 빈 화면을 만들지 않는다", () => {
    for (const preset of FORMAT_PRESETS) {
      expect(formatValue(1234.5, preset.code), preset.id).not.toBe("");
      expect(formatValue(D2024_01_01, preset.code), preset.id).not.toBe("");
      expect(formatValue(0, preset.code), preset.id).not.toBe("");
    }
  });

  it("프리셋 id는 중복되지 않는다", () => {
    const ids = FORMAT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
