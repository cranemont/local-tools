/** 엑셀 날짜 일련번호 ↔ JS Date.
 *
 * 엑셀은 1899-12-30을 0일로 세고, 소수부가 하루 안의 시각이다. 1900년 윤년 버그까지
 * 흉내 내야 파일이 왕복해도 하루가 안 밀린다: 1900은 윤년이 아닌데 엑셀은 존재하지 않는
 * 1900-02-29를 60번으로 센다. 그래서 **1900-03-01 이전은 실제 경과일보다 하나 적게** 나간다
 * (1900-01-01=1, 1900-02-28=59, 60=가짜 1900-02-29, 1900-03-01=61부터는 경과일과 같다).
 * 부호를 뒤집지 말 것 — 예전엔 반대로 더해서 1900-02-27과 28이 둘 다 60이었다.
 */

const MS_PER_DAY = 86_400_000;
/** 1899-12-30T00:00:00Z */
const EPOCH = Date.UTC(1899, 11, 30);

/** JS Date → 엑셀 일련번호. 로컬 시각을 그대로 읽는다(시간대 이동 금지). */
export function toSerial(date: Date): number {
  const local = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  const days = (local - EPOCH) / MS_PER_DAY;
  // 1900-03-01(경과일 61) 전이면 가짜 하루를 빼고 센다.
  return days < 61 ? days - 1 : days;
}

/**
 * ExcelJS가 푼 Date → 파일에 적혀 있던 일련번호. **ExcelJS 어댑터 두 곳만 쓴다**
 * (`xlsx.ts`의 readValue, `validation.ts`의 utcToIso).
 *
 * ExcelJS는 일련번호를 `1899-12-30 UTC + serial일`로 푼다 — 실측: 45296 →
 * 2024-01-05T00:00:00Z, 61 → 1900-03-01Z, 1 → 1899-12-31Z. **1900년 윤년 버그를
 * 흉내 내지 않는다**(그래서 61 미만에서 위 toSerial과 하루 어긋난다). 이 함수는 그
 * 대응의 역이라 파일에 적힌 값이 그대로 돌아온다 — 윤년 가지를 여기 넣으면 1900년
 * 초의 날짜가 왕복마다 하루씩 밀린다.
 *
 * 로컬 시각을 읽는 `toSerial`을 쓰면 여는 순간 시간대 오프셋만큼 값이 밀리고(UTC+9면
 * +0.375) 저장할 때 그 값이 파일에 적혀 왕복마다 쌓인다. 여기서는 `getTime()`만
 * 보므로 실행 시간대와 무관하다.
 */
export function serialFromExcelJsDate(date: Date): number {
  return (date.getTime() - EPOCH) / MS_PER_DAY;
}

/** 엑셀 일련번호 → JS Date(로컬).
 *  60번(가짜 1900-02-29)은 실재하지 않으므로 1900-02-28에 겹쳐 그린다. */
export function fromSerial(serial: number): Date {
  const days = serial < 60 ? serial + 1 : serial;
  const ms = EPOCH + Math.round(days * MS_PER_DAY);
  const utc = new Date(ms);
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    utc.getUTCSeconds(),
    utc.getUTCMilliseconds(),
  );
}

/** 표시 형식이 날짜/시간을 그리는가 — 색 코드와 따옴표 안 글자는 빼고 본다. */
export function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  // [h]·[mm]·[ss]는 경과 시간이다 — 대괄호를 통째로 버리면 시간 형식인 걸 놓친다.
  if (/\[(h+|m+|s+)\]/i.test(fmt)) return true;
  const bare = fmt
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "");
  return /[ymdhs]/i.test(bare);
}

const ISO_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const ISO_DATETIME = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** 사람이 친 날짜/시각 문자열 → {serial, fmt}. 날짜로 안 읽히면 null. */
export function parseDateInput(text: string): { serial: number; fmt: string } | null {
  const s = text.trim();

  const dt = ISO_DATETIME.exec(s);
  if (dt) {
    const d = new Date(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], dt[6] ? +dt[6] : 0);
    if (Number.isNaN(d.getTime())) return null;
    return { serial: toSerial(d), fmt: dt[6] ? "yyyy-mm-dd hh:mm:ss" : "yyyy-mm-dd hh:mm" };
  }

  const only = ISO_DATE.exec(s);
  if (only) {
    const d = new Date(+only[1], +only[2] - 1, +only[3]);
    if (Number.isNaN(d.getTime())) return null;
    // 실재하지 않는 날짜(2월 30일 등)는 Date가 조용히 넘겨 버리므로 되돌려 확인한다.
    if (d.getMonth() !== +only[2] - 1 || d.getDate() !== +only[3]) return null;
    return { serial: toSerial(d), fmt: "yyyy-mm-dd" };
  }

  const tm = TIME_ONLY.exec(s);
  if (tm) {
    const h = +tm[1];
    const mi = +tm[2];
    const sec = tm[3] ? +tm[3] : 0;
    if (h > 23 || mi > 59 || sec > 59) return null;
    return {
      serial: (h * 3600 + mi * 60 + sec) / 86_400,
      fmt: tm[3] ? "hh:mm:ss" : "hh:mm",
    };
  }

  return null;
}
