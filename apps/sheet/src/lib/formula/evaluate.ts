/** 구문 트리 평가.
 *
 * 엑셀의 값 규칙을 따른다:
 *   · 빈 칸은 셈에서 0, 잇기에서 "", 비교에서 0/"".
 *   · 인자에 오류가 하나라도 있으면 그대로 번져 나간다(오류를 다루는 함수만 예외).
 *   · IF·IFERROR류는 고른 가지만 계산한다 — IF(B1=0,"",A1/B1)이 살아야 하니까.
 */

import { areaOf, type Area } from "../sheet/a1";
import { formatValue } from "../sheet/numfmt";
import { CellError, ERR, isError, type Scalar } from "../sheet/types";
import type { Node } from "./ast";
import { callFunction, ERROR_TOLERANT, fromJs, toJs, type FnResult } from "./functions";

export interface EvalContext {
  /** 셀 하나의 현재 값. 시트 이름이 없으면 수식이 있는 시트. */
  cell(sheet: string | undefined, row: number, col: number): Scalar;
  /** 범위의 값(행 우선 2차원). */
  range(sheet: string | undefined, area: Area): Scalar[][];
}

/** 평가 중간값 — 스칼라이거나 2차원 배열(범위·배열 리터럴). */
type Value = Scalar | Scalar[][];

function isMatrix(v: Value): v is Scalar[][] {
  return Array.isArray(v);
}

/** 스칼라가 필요한 자리에 범위가 오면 왼쪽 위 한 칸으로 접는다. */
function scalarOf(v: Value): Scalar {
  if (!isMatrix(v)) return v;
  const first = v[0]?.[0];
  return first === undefined ? null : first;
}

export function toNumber(v: Scalar): number | CellError {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isError(v)) return v;
  const trimmed = v.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : ERR.value;
}

export function toText(v: Scalar): string | CellError {
  if (v === null) return "";
  if (isError(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return formatValue(v);
}

export function toBool(v: Scalar): boolean | CellError {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isError(v)) return v;
  const upper = v.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE" || upper === "") return false;
  return ERR.value;
}

/** 엑셀 비교 순서: 수 < 글자 < FALSE < TRUE. 빈 칸은 상대 타입의 영값으로 읽는다. */
function compare(a: Scalar, b: Scalar): number | CellError {
  if (isError(a)) return a;
  if (isError(b)) return b;

  let x = a;
  let y = b;
  if (x === null) x = typeof y === "string" ? "" : typeof y === "boolean" ? false : 0;
  if (y === null) y = typeof x === "string" ? "" : typeof x === "boolean" ? false : 0;

  const rank = (v: Scalar): number =>
    typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
  if (rank(x) !== rank(y)) return rank(x) - rank(y);

  if (typeof x === "number") return x - (y as number);
  if (typeof x === "string") {
    const s = x.toLowerCase();
    const t = (y as string).toLowerCase();
    return s < t ? -1 : s > t ? 1 : 0;
  }
  return Number(x) - Number(y as boolean);
}

/** 깊이 훑어 첫 오류를 찾는다. */
function findError(v: unknown): CellError | null {
  if (isError(v)) return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findError(item);
      if (found) return found;
    }
  }
  return null;
}

/** 고른 가지만 계산하는 함수 — 인자를 미리 평가하면 안 된다. */
const LAZY = new Set(["IF", "IFERROR", "IFNA", "IFS", "SWITCH", "CHOOSE"]);

/**
 * 우리 값 체계로 직접 구현하는 함수.
 *
 * formulajs에 맡기면 틀리는 것들이다 — 오류 판별 함수는 formulajs 자기 오류 클래스만
 * 참으로 보고(우리 CellError는 못 알아본다), TEXT는 날짜를 일련번호로 저장하는
 * 우리 규약을 모른다(=TEXT(A1,"yyyy년")이 46246을 그대로 돌려줬다).
 */
const NATIVE = new Set([
  "ISERROR",
  "ISERR",
  "ISNA",
  "ISBLANK",
  "ISNUMBER",
  "ISTEXT",
  "ISNONTEXT",
  "ISLOGICAL",
  "ERROR.TYPE",
  "NA",
  "TYPE",
  "N",
  "TEXT",
]);

class Evaluator {
  constructor(private readonly ctx: EvalContext) {}

  run(node: Node): FnResult {
    const value = this.eval(node);
    return { value: scalarOf(value), dateFormat: this.dateFormat };
  }

  /** 마지막 함수 호출이 날짜를 돌려줬는지 — 셀 형식 자동 지정에 쓴다. */
  private dateFormat: string | undefined;

  private eval(node: Node): Value {
    switch (node.k) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "bool":
        return node.v;
      case "err":
        return node.v;
      case "name":
        return ERR.name;

      case "ref":
        return this.ctx.cell(node.sheet, node.at.row, node.at.col);

      case "range":
        return this.ctx.range(
          node.sheet,
          areaOf({ row: node.from.row, col: node.from.col }, { row: node.to.row, col: node.to.col }),
        );

      case "array":
        return node.rows.map((row) => row.map((cell) => scalarOf(this.eval(cell))));

      case "unary": {
        const x = toNumber(scalarOf(this.eval(node.x)));
        if (isError(x)) return x;
        return node.op === "-" ? -x : x;
      }

      case "percent": {
        const x = toNumber(scalarOf(this.eval(node.x)));
        if (isError(x)) return x;
        return x / 100;
      }

      case "binary":
        return this.binary(node);

      case "call":
        return this.call(node);
    }
  }

  private binary(node: Node & { k: "binary" }): Value {
    const a = scalarOf(this.eval(node.a));
    const b = scalarOf(this.eval(node.b));

    if (node.op === "&") {
      const s = toText(a);
      if (isError(s)) return s;
      const t = toText(b);
      if (isError(t)) return t;
      return s + t;
    }

    if (node.op === "=" || node.op === "<>" || node.op === "<" || node.op === ">" || node.op === "<=" || node.op === ">=") {
      const c = compare(a, b);
      if (isError(c)) return c;
      switch (node.op) {
        case "=":
          return c === 0;
        case "<>":
          return c !== 0;
        case "<":
          return c < 0;
        case ">":
          return c > 0;
        case "<=":
          return c <= 0;
        default:
          return c >= 0;
      }
    }

    const x = toNumber(a);
    if (isError(x)) return x;
    const y = toNumber(b);
    if (isError(y)) return y;

    switch (node.op) {
      case "+":
        return x + y;
      case "-":
        return x - y;
      case "*":
        return x * y;
      case "/":
        if (y === 0) return ERR.div0;
        return x / y;
      case "^": {
        const r = x ** y;
        return Number.isFinite(r) ? r : ERR.num;
      }
    }
    return ERR.value;
  }

  private call(node: Node & { k: "call" }): Value {
    if (LAZY.has(node.name)) return this.lazyCall(node);
    if (NATIVE.has(node.name)) return this.nativeCall(node);

    const args: unknown[] = [];
    for (const arg of node.args) {
      const v = this.eval(arg);
      if (!ERROR_TOLERANT.has(node.name)) {
        const err = findError(v);
        if (err) return err;
      }
      args.push(isMatrix(v) ? v.map((row) => row.map(toJs)) : toJs(v));
    }

    const result = callFunction(node.name, args);
    if (result.dateFormat) this.dateFormat = result.dateFormat;
    return result.value;
  }

  /** CellError·일련번호 규약을 아는 쪽에서 해야 맞는 함수들. */
  private nativeCall(node: Node & { k: "call" }): Value {
    const arg = (i: number): Scalar =>
      i < node.args.length ? scalarOf(this.eval(node.args[i])) : null;

    switch (node.name) {
      case "NA":
        return ERR.na;

      case "ISERROR":
        return isError(arg(0));
      case "ISERR": {
        const v = arg(0);
        return isError(v) && v.code !== "#N/A";
      }
      case "ISNA": {
        const v = arg(0);
        return isError(v) && v.code === "#N/A";
      }
      case "ISBLANK":
        return arg(0) === null;
      case "ISNUMBER":
        return typeof arg(0) === "number";
      case "ISTEXT":
        return typeof arg(0) === "string";
      case "ISNONTEXT":
        return typeof arg(0) !== "string";
      case "ISLOGICAL":
        return typeof arg(0) === "boolean";

      case "ERROR.TYPE": {
        const v = arg(0);
        if (!isError(v)) return ERR.na;
        const order: Record<string, number> = {
          "#NULL!": 1,
          "#DIV/0!": 2,
          "#VALUE!": 3,
          "#REF!": 4,
          "#NAME?": 5,
          "#NUM!": 6,
          "#N/A": 7,
          "#CIRC!": 8,
        };
        return order[v.code] ?? 8;
      }

      case "TYPE": {
        const raw = node.args.length > 0 ? this.eval(node.args[0]) : null;
        if (isMatrix(raw)) return 64;
        if (typeof raw === "number") return 1;
        if (typeof raw === "string") return 2;
        if (typeof raw === "boolean") return 4;
        if (isError(raw)) return 16;
        return 1; // 빈 칸은 수로 친다(엑셀과 같음)
      }

      case "N": {
        const v = arg(0);
        if (isError(v)) return v;
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        return 0;
      }

      case "TEXT": {
        const v = arg(0);
        if (isError(v)) return v;
        const fmt = arg(1);
        if (isError(fmt)) return fmt;
        return formatValue(v, typeof fmt === "string" ? fmt : undefined);
      }
    }

    return ERR.name;
  }

  /** 고른 가지만 계산하는 함수들. */
  private lazyCall(node: Node & { k: "call" }): Value {
    const args = node.args;

    switch (node.name) {
      case "IF": {
        if (args.length < 2) return ERR.value;
        const cond = toBool(scalarOf(this.eval(args[0])));
        if (isError(cond)) return cond;
        if (cond) return this.eval(args[1]);
        return args.length >= 3 ? this.eval(args[2]) : false;
      }

      case "IFERROR": {
        if (args.length < 2) return ERR.value;
        const v = this.eval(args[0]);
        return findError(v) ? this.eval(args[1]) : v;
      }

      case "IFNA": {
        if (args.length < 2) return ERR.value;
        const v = this.eval(args[0]);
        const err = findError(v);
        return err?.code === "#N/A" ? this.eval(args[1]) : v;
      }

      case "IFS": {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const cond = toBool(scalarOf(this.eval(args[i])));
          if (isError(cond)) return cond;
          if (cond) return this.eval(args[i + 1]);
        }
        return ERR.na;
      }

      case "SWITCH": {
        if (args.length < 3) return ERR.value;
        const subject = scalarOf(this.eval(args[0]));
        if (isError(subject)) return subject;
        let i = 1;
        for (; i + 1 < args.length; i += 2) {
          const candidate = scalarOf(this.eval(args[i]));
          const c = compare(subject, candidate);
          if (isError(c)) return c;
          if (c === 0) return this.eval(args[i + 1]);
        }
        // 남은 인자 하나는 기본값.
        return i < args.length ? this.eval(args[i]) : ERR.na;
      }

      case "CHOOSE": {
        if (args.length < 2) return ERR.value;
        const idx = toNumber(scalarOf(this.eval(args[0])));
        if (isError(idx)) return idx;
        const pick = Math.trunc(idx);
        if (pick < 1 || pick >= args.length) return ERR.value;
        return this.eval(args[pick]);
      }
    }

    return ERR.name;
  }
}

/** 트리 하나를 평가한다. 오류는 던지지 않고 값으로 돌아온다. */
export function evaluate(node: Node, ctx: EvalContext): FnResult {
  try {
    return new Evaluator(ctx).run(node);
  } catch {
    return { value: ERR.value };
  }
}

/** 함수 결과가 아닌 순수 JS 값을 셀 값으로 — csv/xlsx 어댑터가 쓴다. */
export { fromJs };
