/** 엑셀 표시 형식(number format) → 화면 문자열.
 *
 * 전부를 구현하지 않는다. 실제 파일에 나오는 것 — 자릿수·천단위·백분율·통화 기호·
 * 날짜/시간·괄호 음수·구역 분리(양;음;0;텍스트) — 까지만 다루고, 나머지는 General로
 * 떨어뜨린다. 형식을 못 읽어서 값이 안 보이는 것보다 낫다.
 *
 * 저장할 때는 이 파일을 거치지 않는다 — 형식 문자열 자체가 xlsx로 그대로 나간다.
 */

import { fromSerial, isDateFormat } from "./serial";
import type { Scalar } from "./types";
import { isError } from "./types";

const MONTHS_SHORT = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const DAYS_SHORT = ["일", "월", "화", "수", "목", "금", "토"];

/** 형식 문자열을 구역으로 쪼갠다. 따옴표·대괄호 안의 세미콜론은 구분자가 아니다. */
function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let bracket = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "\\") {
      cur += ch + (fmt[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') quote = !quote;
    else if (!quote && ch === "[") bracket = true;
    else if (!quote && ch === "]") bracket = false;
    if (ch === ";" && !quote && !bracket) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** 값에 맞는 구역을 고른다(양수;음수;0;텍스트 관례). */
function pickSection(sections: string[], n: number): { fmt: string; abs: boolean } {
  if (sections.length === 1) return { fmt: sections[0], abs: false };
  if (n > 0) return { fmt: sections[0], abs: false };
  if (n < 0) {
    // 음수 구역이 따로 있으면 부호는 그 구역이 그린다 — 값은 절댓값으로 넘긴다.
    if (sections.length >= 2 && sections[1].trim() !== "") return { fmt: sections[1], abs: true };
    return { fmt: sections[0], abs: false };
  }
  if (sections.length >= 3) return { fmt: sections[2], abs: false };
  return { fmt: sections[0], abs: false };
}

function pad(n: number, width: number): string {
  return String(Math.floor(Math.abs(n))).padStart(width, "0");
}

/** 경과 시간([h]·[mm]·[ss]) — 날짜가 아니라 일련번호 전체를 시/분/초로 편다. */
function elapsed(serial: number, unit: string, width: number): string {
  const totalMs = Math.round(serial * 86_400_000);
  const per = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  const n = Math.floor(Math.abs(totalMs) / per);
  return (totalMs < 0 ? "-" : "") + String(n).padStart(width, "0");
}

/** 이 m 다음에 오는 첫 날짜 코드가 초(s)인가 — 사이의 구분 기호는 건너뛴다.
 *  엑셀은 "mm:ss"의 m을 월이 아니라 분으로 본다. */
function beforeSeconds(rest: string): boolean {
  return /^[^a-z0-9"[\\]*s/i.test(rest);
}

/** 날짜/시간 형식을 그린다. */
function renderDate(serial: number, fmt: string): string {
  const d = fromSerial(serial);
  const has12h = /am\/pm|a\/p/i.test(fmt);
  let out = "";
  let i = 0;
  // 분(m)과 월(m)은 같은 글자다 — 직전에 시(h)가 나왔거나 뒤에 초(s)가 붙으면 분으로 읽는다.
  let afterHour = false;

  while (i < fmt.length) {
    const ch = fmt[i];

    if (ch === "\\") {
      out += fmt[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      out += fmt.slice(i + 1, end < 0 ? fmt.length : end);
      i = end < 0 ? fmt.length : end + 1;
      continue;
    }
    if (ch === "[") {
      const end = fmt.indexOf("]", i);
      const body = end < 0 ? "" : fmt.slice(i + 1, end);
      i = end < 0 ? fmt.length : end + 1;
      // [h]·[mm]·[ss]는 경과 시간이다. [빨강]·[$-ko-KR] 등 나머지는 무시.
      const unit = /^(h+|m+|s+)$/i.exec(body);
      if (unit) {
        out += elapsed(serial, unit[1][0].toLowerCase(), unit[1].length);
        // [h] 다음의 m은 월이 아니라 분이다.
        afterHour = unit[1][0].toLowerCase() === "h";
      }
      continue;
    }

    const rest = fmt.slice(i);
    const ampm = /^(AM\/PM|A\/P)/i.exec(rest);
    if (ampm) {
      out += d.getHours() < 12 ? "AM" : "PM";
      i += ampm[1].length;
      continue;
    }

    const run = /^(y+|m+|d+|h+|s+)/i.exec(rest);
    if (run) {
      const tok = run[1].toLowerCase();
      const len = tok.length;
      switch (tok[0]) {
        case "y":
          out += len <= 2 ? pad(d.getFullYear() % 100, 2) : String(d.getFullYear());
          break;
        case "d":
          if (len === 1) out += String(d.getDate());
          else if (len === 2) out += pad(d.getDate(), 2);
          else if (len === 3) out += DAYS_SHORT[d.getDay()];
          else out += `${DAYS_SHORT[d.getDay()]}요일`;
          break;
        case "h": {
          const h = has12h ? d.getHours() % 12 || 12 : d.getHours();
          out += len === 1 ? String(h) : pad(h, 2);
          afterHour = true;
          i += len;
          continue;
        }
        case "s":
          out += len === 1 ? String(d.getSeconds()) : pad(d.getSeconds(), 2);
          break;
        case "m":
          if (afterHour || beforeSeconds(fmt.slice(i + len))) {
            out += len === 1 ? String(d.getMinutes()) : pad(d.getMinutes(), 2);
          } else if (len === 1) out += String(d.getMonth() + 1);
          else if (len === 2) out += pad(d.getMonth() + 1, 2);
          else out += MONTHS_SHORT[d.getMonth()];
          break;
      }
      afterHour = false;
      i += len;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

interface NumPattern {
  intDigits: number;
  /** 소수부 최대 자릿수 — 0·#·? 를 모두 센다. */
  fracDigits: number;
  /** 소수부 필수 자릿수 — 0만 센다. #은 값이 0이면 지워지는 선택 자리다.
   *  ("#,##0.####"가 4,520.0000이 아니라 4,520으로 보이게 하는 구분) */
  fracMin: number;
  grouping: boolean;
  percent: number;
  scale: number;
  prefix: string;
  suffix: string;
  scientific: boolean;
  /** E 뒤의 자릿수 — 지수를 0으로 채울 폭이다(소수 자릿수와 별개). */
  expDigits: number;
  /** "E+"는 양의 지수에도 +를 적고, "E-"는 적지 않는다. */
  expPlus: boolean;
}

/** 숫자 형식 한 구역을 뜯어 자릿수·기호를 뽑는다. */
function readPattern(fmt: string): NumPattern | null {
  let prefix = "";
  let suffix = "";
  let digits = "";
  let seenDigit = false;
  let percent = 0;
  let scale = 0;
  let scientific = false;
  let expDigits = 0;
  let expPlus = false;

  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "\\") {
      const lit = fmt[i + 1] ?? "";
      if (seenDigit) suffix += lit;
      else prefix += lit;
      i++;
      continue;
    }
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      const lit = fmt.slice(i + 1, end < 0 ? fmt.length : end);
      if (seenDigit) suffix += lit;
      else prefix += lit;
      i = end < 0 ? fmt.length : end;
      continue;
    }
    if (ch === "[") {
      const end = fmt.indexOf("]", i);
      const body = fmt.slice(i + 1, end < 0 ? fmt.length : end);
      // [$₩-412] 같은 통화 구역에서 기호만 건진다. [빨강] 등 색은 버린다.
      if (body.startsWith("$")) {
        const sym = body.slice(1).split("-")[0];
        if (seenDigit) suffix += sym;
        else prefix += sym;
      }
      i = end < 0 ? fmt.length : end;
      continue;
    }
    if (ch === "0" || ch === "#" || ch === "?" || ch === "." || ch === ",") {
      seenDigit = true;
      digits += ch;
      continue;
    }
    if (ch === "%") {
      percent++;
      if (seenDigit) suffix += "%";
      else prefix += "%";
      continue;
    }
    if ((ch === "E" || ch === "e") && (fmt[i + 1] === "+" || fmt[i + 1] === "-")) {
      // E 뒤의 0#?는 지수 자릿수다. digits에 섞으면 소수 자릿수로 세어져
      // "0.00E+00"이 소수 네 자리가 된다(1.2345E+4).
      scientific = true;
      expPlus = fmt[i + 1] === "+";
      i++;
      while (i + 1 < fmt.length && /[0#?]/.test(fmt[i + 1])) {
        expDigits++;
        i++;
      }
      continue;
    }
    if (ch === "_" || ch === "*") {
      // _x는 x 폭만큼의 여백, *x는 칸을 채우는 반복이다. 칸 폭을 모르니 흉내 내지 않고
      // 둘 다 건너뛴다 — 글자로 흘리면 회계 형식이 "_-* 1,234.50_-"으로 보인다.
      i++;
      continue;
    }
    if (ch === "@") return null; // 텍스트 자리표시자 — 숫자 형식이 아니다
    if (seenDigit) suffix += ch;
    else prefix += ch;
  }

  if (!seenDigit) return null;

  // 소수점 뒤 콤마는 천 단위가 아니라 1000배 축약이다("#,##0,," = 백만 단위).
  const trailing = /,+$/.exec(digits.replace(/[^0#?,.]/g, ""));
  if (trailing) scale = trailing[0].length;
  const core = digits.replace(/,+$/, "");
  const grouping = core.includes(",");
  const clean = core.replace(/,/g, "");
  const dot = clean.indexOf(".");
  const intPart = dot < 0 ? clean : clean.slice(0, dot);
  const fracPart = dot < 0 ? "" : clean.slice(dot + 1);

  return {
    intDigits: (intPart.match(/0/g) ?? []).length,
    fracDigits: (fracPart.match(/[0#?]/g) ?? []).length,
    fracMin: (fracPart.match(/0/g) ?? []).length,
    grouping,
    percent,
    scale,
    prefix,
    suffix,
    scientific,
    expDigits,
    expPlus,
  };
}

/** 자리표시자 없이 글자만 있는 구역 — 회계 형식의 `;"-"`처럼 0을 글자로 그리는 자리.
 *  숫자·날짜 코드나 General이 섞이면 null(= 이 구역은 값을 그린다). */
function literalOnly(fmt: string): string | null {
  let out = "";
  let quoted = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "\\") {
      out += fmt[i + 1] ?? "";
      i++;
      continue;
    }
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      out += fmt.slice(i + 1, end < 0 ? fmt.length : end);
      quoted = true;
      i = end < 0 ? fmt.length : end;
      continue;
    }
    if (ch === "[") {
      const end = fmt.indexOf("]", i);
      i = end < 0 ? fmt.length : end;
      continue;
    }
    if (ch === "0" || ch === "#" || ch === "?" || ch === "@") return null;
    if (/[a-z]/i.test(ch)) return null; // General·날짜 코드가 섞였다
    if (ch === "_" || ch === "*") {
      i++; // 다음 글자만큼의 여백·채움 — 흉내 내지 않고 건너뛴다
      continue;
    }
    out += ch;
  }
  return quoted || out.trim() !== "" ? out : null;
}

/** 텍스트 구역(넷째)을 그린다 — @가 원문 자리다. 숫자 구역과 같은 규약으로
 *  따옴표 안 글자·역슬래시 이스케이프는 살리고, 여백(_x)·채움(*x)·색 코드는 버린다.
 *  (xlsx '회계' 서식의 `_-@_-`가 "_-미정_-"으로 보이던 자리) */
function renderText(fmt: string, text: string): string {
  let out = "";
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "\\") {
      out += fmt[i + 1] ?? "";
      i++;
      continue;
    }
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      out += fmt.slice(i + 1, end < 0 ? fmt.length : end);
      i = end < 0 ? fmt.length : end;
      continue;
    }
    if (ch === "[") {
      const end = fmt.indexOf("]", i);
      i = end < 0 ? fmt.length : end;
      continue;
    }
    if (ch === "_" || ch === "*") {
      i++;
      continue;
    }
    out += ch === "@" ? text : ch;
  }
  return out;
}

function group(intText: string): string {
  return intText.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function renderNumber(n: number, p: NumPattern): string {
  let value = n;
  for (let i = 0; i < p.percent; i++) value *= 100;
  for (let i = 0; i < p.scale; i++) value /= 1000;

  if (p.scientific) {
    const neg = value < 0;
    const [mant, exp] = Math.abs(value).toExponential(p.fracDigits).split("e");
    const e = Number(exp);
    const sign = e < 0 ? "-" : p.expPlus ? "+" : "";
    const digits = String(Math.abs(e)).padStart(p.expDigits, "0");
    return `${neg ? "-" : ""}${p.prefix}${mant}E${sign}${digits}${p.suffix}`;
  }

  const fixed = value.toFixed(p.fracDigits);
  const neg = fixed.startsWith("-");
  const body = neg ? fixed.slice(1) : fixed;
  const dot = body.indexOf(".");
  let intText = dot < 0 ? body : body.slice(0, dot);
  let fracText = dot < 0 ? "" : body.slice(dot + 1);

  // 선택 자리(#)에 남은 0은 떼어낸다. 필수 자리(0)까지만 줄인다.
  if (p.fracMin < fracText.length) {
    let end = fracText.length;
    while (end > p.fracMin && fracText[end - 1] === "0") end--;
    fracText = fracText.slice(0, end);
  }

  if (intText.length < p.intDigits) intText = intText.padStart(p.intDigits, "0");
  // 정수부에 필수 자리(0)가 하나도 없으면 0은 자리를 차지하지 않는다 — "#"·"??"는
  // 지워지는 자리다("#.##"의 0.5가 ".5"인 것과 같은 규칙, 회계 형식의 0이 "-"인 이유).
  if (p.intDigits === 0 && intText === "0") intText = "";
  if (p.grouping) intText = group(intText);

  const num = fracText ? `${intText}.${fracText}` : intText;
  return `${neg ? "-" : ""}${p.prefix}${num}${p.suffix}`;
}

/** General — 엑셀 기본 표시. 정수는 그대로, 긴 소수는 유효자리로 줄인다. */
function general(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "#NUM!" : "#NUM!";
  // 정수는 자릿수를 줄이지 않는다. 예전엔 1e15부터 지수 표기로 떨어뜨렸는데,
  // 그러면 16자리 주문번호가 "1.23457E+15"로 굳어 저장돼 되돌릴 수 없었다.
  // (1e21부터는 JS의 String 자신이 지수로 적는다. 지수 표기가 필요하면 형식으로 고른다.)
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-10)) return n.toExponential(5).replace("e", "E");
  // 부동소수 잡음(0.1+0.2)을 없애되 유효자리는 보존한다.
  // 꼬리 0은 가수에서만 떼어낸다 — 지수부까지 훑으면 1e-10이 "1e-1"로 잘려 0.1이 됐다.
  const p = n.toPrecision(12);
  const at = p.search(/e/i);
  const mant = at < 0 ? p : p.slice(0, at);
  const exp = at < 0 ? "" : p.slice(at);
  const s = mant.includes(".") ? mant.replace(/0+$/, "").replace(/\.$/, "") : mant;
  return String(Number(s + exp)).replace("e", "E");
}

/** 셀 값 + 표시 형식 → 화면 문자열. */
export function formatValue(v: Scalar, fmt?: string): string {
  if (v === null || v === undefined) return "";
  if (isError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";

  if (typeof v === "string") {
    if (!fmt) return v;
    const sections = splitSections(fmt);
    // 텍스트 구역은 네 번째. @는 원문 자리.
    const textFmt = sections.length >= 4 ? sections[3] : null;
    if (!textFmt) return v;
    return renderText(textFmt, v);
  }

  if (!fmt || fmt === "General" || fmt === "@") return general(v);
  if (isDateFormat(fmt)) return renderDate(v, splitSections(fmt)[0]);

  const { fmt: section, abs } = pickSection(splitSections(fmt), v);
  const pattern = readPattern(section);
  if (!pattern) {
    // 자리표시자가 없는 구역은 글자를 그린다(회계 형식의 0 자리 `"-"`).
    const lit = literalOnly(section);
    if (lit !== null) return lit;
    return general(v);
  }
  return renderNumber(abs ? Math.abs(v) : v, pattern);
}

/** 자주 쓰는 형식 — 툴바 드롭다운에 그대로 나간다. */
export const FORMAT_PRESETS: { id: string; label: string; code: string }[] = [
  { id: "general", label: "일반", code: "General" },
  { id: "int", label: "정수", code: "#,##0" },
  { id: "dec2", label: "소수점 2자리", code: "#,##0.00" },
  { id: "won", label: "원화", code: '₩#,##0;[빨강]-₩#,##0' },
  { id: "usd", label: "달러", code: '"$"#,##0.00' },
  { id: "pct", label: "백분율", code: "0.0%" },
  { id: "sci", label: "지수", code: "0.00E+00" },
  { id: "date", label: "날짜", code: "yyyy-mm-dd" },
  { id: "datetime", label: "날짜+시각", code: "yyyy-mm-dd hh:mm" },
  { id: "time", label: "시각", code: "hh:mm:ss" },
  { id: "text", label: "텍스트", code: "@" },
];
