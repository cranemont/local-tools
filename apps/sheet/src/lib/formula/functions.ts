/** 함수 표 — 구현은 @formulajs/formulajs(MIT)를 쓰고, 여기서는 값 변환만 맡는다.
 *
 * 경계에서 두 가지를 바꾼다:
 *   · 오류: formulajs는 message가 "#DIV/0!"인 Error를 던지듯 돌려준다 → CellError로.
 *   · 날짜: formulajs는 JS Date를 돌려준다 → 엑셀 일련번호로(문서는 스칼라만 담는다).
 *
 * 지연 평가가 필요한 함수(IF·IFERROR 등)는 여기 없다 — evaluate.ts가 특수형으로 처리한다.
 */

import * as fx from "@formulajs/formulajs";
import { toSerial } from "../sheet/serial";
import { CellError, ERR, isError, type Scalar } from "../sheet/types";

/** 함수 결과가 날짜냐 — 셀에 표시 형식을 자동으로 붙일지 정할 때 쓴다. */
export interface FnResult {
  value: Scalar;
  dateFormat?: string;
}

const registry = fx as unknown as Record<string, unknown>;

/** 날짜를 돌려주는 함수들 — 결과 셀에 날짜 형식을 붙여 준다. */
const DATE_FUNCTIONS = new Set([
  "DATE",
  "DATEVALUE",
  "EDATE",
  "EOMONTH",
  "TODAY",
  "WORKDAY",
  "WORKDAY.INTL",
]);
const DATETIME_FUNCTIONS = new Set(["NOW"]);
const TIME_FUNCTIONS = new Set(["TIME", "TIMEVALUE"]);

/** 인자에 오류가 섞여도 그대로 넘겨야 하는 함수(오류를 다루는 게 일이라서). */
export const ERROR_TOLERANT = new Set([
  "ISERROR",
  "ISERR",
  "ISNA",
  "ERROR.TYPE",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "ISBLANK",
  "ISTEXT",
  "ISNUMBER",
  "ISLOGICAL",
  "ISNONTEXT",
  "N",
  "TYPE",
]);

/** 문서 값 → formulajs가 아는 값. */
export function toJs(v: Scalar): unknown {
  if (isError(v)) return new Error(v.code);
  return v;
}

/** formulajs 결과 → 문서 값. */
export function fromJs(result: unknown): Scalar {
  if (result === null || result === undefined) return null;
  if (result instanceof Error) return new CellError(normalizeCode(result.message));
  if (result instanceof Date) {
    const t = result.getTime();
    return Number.isNaN(t) ? ERR.value : toSerial(result);
  }
  if (typeof result === "number") return Number.isFinite(result) ? result : ERR.num;
  if (typeof result === "string" || typeof result === "boolean") return result;
  if (Array.isArray(result)) {
    // 동적 배열(SORT·UNIQUE 등)은 아직 안 흘린다 — 왼쪽 위 한 칸만 보여 준다.
    const first = Array.isArray(result[0]) ? result[0][0] : result[0];
    return first === undefined ? null : fromJs(first);
  }
  return ERR.value;
}

function normalizeCode(message: string): CellError["code"] {
  const known = Object.values(ERR).find((e) => e.code === message);
  return known ? known.code : "#VALUE!";
}

export function hasFunction(name: string): boolean {
  return typeof registry[name] === "function" || EXTRA[name] !== undefined;
}

/** 이름으로 함수를 부른다. 없는 이름이면 #NAME?. */
export function callFunction(name: string, args: unknown[]): FnResult {
  const extra = EXTRA[name];
  if (extra) {
    try {
      return { value: fromJs(extra(args)) };
    } catch {
      return { value: ERR.value };
    }
  }

  const fn = registry[name];
  if (typeof fn !== "function") return { value: ERR.name };

  let raw: unknown;
  try {
    raw = (fn as (...a: unknown[]) => unknown)(...args);
  } catch {
    return { value: ERR.value };
  }

  const value = fromJs(raw);
  if (isError(value)) return { value };

  if (DATE_FUNCTIONS.has(name)) return { value, dateFormat: "yyyy-mm-dd" };
  if (DATETIME_FUNCTIONS.has(name)) return { value, dateFormat: "yyyy-mm-dd hh:mm" };
  if (TIME_FUNCTIONS.has(name)) return { value, dateFormat: "hh:mm:ss" };
  return { value };
}

// ── formulajs에 없는 것 보강 ─────────────────────────────────────

function flatten(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [v];
  return v.flatMap(flatten);
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

const EXTRA: Record<string, (args: unknown[]) => unknown> = {
  /** XLOOKUP(찾을값, 찾을범위, 반환범위, [없을때], [일치방식]) — 정확 일치만 지원. */
  XLOOKUP: (args) => {
    const [needle, haystack, results, notFound] = args;
    const keys = flatten(haystack);
    const vals = flatten(results);
    const i = keys.findIndex((k) => looseEqual(k, needle));
    if (i < 0 || i >= vals.length) return notFound === undefined ? new Error("#N/A") : notFound;
    return vals[i];
  },

  /** FILTER(범위, 조건범위) — 첫 통과 값만 돌려준다(배열 흘리기 전까지의 절충). */
  FILTER: (args) => {
    const [source, condition] = args;
    const values = flatten(source);
    const flags = flatten(condition);
    const kept = values.filter((_, i) => flags[i] === true || flags[i] === 1);
    if (kept.length === 0) return new Error("#N/A");
    return kept[0];
  },
};

/** 자동완성 목록용 — 쓸 수 있는 함수 이름 전부. */
export function allFunctionNames(): string[] {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(registry)) {
    if (typeof value === "function" && /^[A-Z][A-Z0-9._]*$/.test(key)) names.add(key);
  }
  for (const key of Object.keys(EXTRA)) names.add(key);
  for (const key of ["IF", "IFERROR", "IFNA", "IFS", "SWITCH", "CHOOSE", "AND", "OR"]) names.add(key);
  return [...names].sort();
}
