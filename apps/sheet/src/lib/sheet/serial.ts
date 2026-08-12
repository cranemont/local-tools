/** 엑셀 날짜 일련번호 ↔ JS Date.
 *
 * 엑셀은 1899-12-30을 0일로 세고, 소수부가 하루 안의 시각이다. 1900년 윤년 버그까지
 * 흉내 내야 파일이 왕복해도 하루가 안 밀린다(엑셀은 존재하지 않는 1900-02-29를 60번으로
 * 친다 — 그래서 60 미만 구간만 하루를 도로 더해 준다).
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
  return days < 60 ? days + 1 : days;
}

/** 엑셀 일련번호 → JS Date(로컬). */
export function fromSerial(serial: number): Date {
  const days = serial < 61 ? serial - 1 : serial;
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
