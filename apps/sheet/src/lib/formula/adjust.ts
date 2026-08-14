/** 수식 안의 참조를 옮긴다 — 복사·채우기·행열 삽입/삭제.
 *
 * 문자열을 정규식으로 치환하지 않고 파서를 거친다. "A1"은 문자열 리터럴 안에도,
 * 함수 이름 속에도 나타날 수 있어서(TEXT(A1,"A1")) 정규식으로는 반드시 틀린다.
 */

import { colName, MAX_COLS, MAX_ROWS, type RefAddr } from "../sheet/a1";
import { ERR } from "../sheet/types";
import type { BinaryOp, Node } from "./ast";
import { astOf } from "./engine";
import { FormulaSyntaxError } from "./tokenize";

function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * 숫자 상수는 **화면 표시가 아니라 원문**으로 되쓴다.
 *
 * 예전엔 formatValue를 썼는데 그건 General 형식이라 12자리에서 반올림하고
 * 1e11부터 지수로 적는다 — 행을 하나 넣었다고 `A1*123456789012.5`가
 * `A2*1.23457E+11`이 됐다(괄호를 잃던 것과 같은 종류의 조용한 값 변경).
 * String()은 다시 읽으면 정확히 같은 수가 되는 가장 짧은 표기라
 * 토크나이저의 NUM_BODY가 그대로 받는다(`1e+21`·`2.5e-11` 포함).
 */
function numText(v: number): string {
  // `=1e999`처럼 리터럴이 이미 무한대인 경우만 여기로 온다.
  return Number.isFinite(v) ? String(v) : ERR.num.code;
}

function refText(ref: RefAddr): string {
  if (ref.row < 0 || ref.col < 0) return "#REF!";
  return `${ref.absCol ? "$" : ""}${colName(ref.col)}${ref.absRow ? "$" : ""}${ref.row + 1}`;
}

/**
 * 우선순위 — parse.ts의 하강 순서와 같은 값이어야 한다(낮을수록 느슨하다).
 * 괄호는 파싱하면 사라지므로, 글로 되돌릴 때 이 표를 보고 다시 씌운다.
 */
const BINARY_PREC: Record<BinaryOp, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};
const UNARY_PREC = 6;
const PERCENT_PREC = 7;
/** 그 자체로 더 쪼개지지 않는 것들 — 괄호가 필요할 일이 없다. */
const ATOM_PREC = 9;

function precOf(node: Node): number {
  switch (node.k) {
    case "binary":
      return BINARY_PREC[node.op];
    case "unary":
      return UNARY_PREC;
    case "percent":
      return PERCENT_PREC;
    default:
      return ATOM_PREC;
  }
}

/**
 * 자식을 글로 옮기되, 그대로 이어 붙이면 다시 읽을 때 다른 뜻이 되는 경우 괄호를 씌운다.
 *
 * 이항 연산자는 전부 왼쪽 결합이라, 오른쪽 자식은 우선순위가 **같아도** 묶어야 한다
 * (a-(b-c) · a/(b*c) · a^(b^c)). 왼쪽 자식은 같은 우선순위면 그냥 이어도 뜻이 같다.
 */
function child(node: Node, parentPrec: number, rightOfBinary = false): string {
  const text = stringify(node);
  const need = rightOfBinary ? precOf(node) <= parentPrec : precOf(node) < parentPrec;
  return need ? `(${text})` : text;
}

/** 트리 → 수식 문자열("=" 없음). */
export function stringify(node: Node): string {
  switch (node.k) {
    case "num":
      return numText(node.v);
    case "str":
      return `"${node.v.replace(/"/g, '""')}"`;
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "err":
      return node.v.code;
    case "name":
      return node.text;
    case "ref":
      return (node.sheet ? `${quoteSheet(node.sheet)}!` : "") + refText(node.at);
    case "range":
      return (
        (node.sheet ? `${quoteSheet(node.sheet)}!` : "") +
        `${refText(node.from)}:${refText(node.to)}`
      );
    case "unary":
      return `${node.op}${child(node.x, UNARY_PREC)}`;
    case "percent":
      return `${child(node.x, PERCENT_PREC)}%`;
    case "binary": {
      const prec = BINARY_PREC[node.op];
      return `${child(node.a, prec)}${node.op}${child(node.b, prec, true)}`;
    }
    case "call":
      return `${node.name}(${node.args.map(stringify).join(",")})`;
    case "array":
      return `{${node.rows.map((row) => row.map(stringify).join(",")).join(";")}}`;
  }
}

type RefMapper = (ref: RefAddr) => RefAddr;

function mapRefs(node: Node, fn: RefMapper): Node {
  switch (node.k) {
    case "ref":
      return { ...node, at: fn(node.at) };
    case "range":
      return { ...node, from: fn(node.from), to: fn(node.to) };
    case "unary":
      return { ...node, x: mapRefs(node.x, fn) };
    case "percent":
      return { ...node, x: mapRefs(node.x, fn) };
    case "binary":
      return { ...node, a: mapRefs(node.a, fn), b: mapRefs(node.b, fn) };
    case "call":
      return { ...node, args: node.args.map((a) => mapRefs(a, fn)) };
    case "array":
      return { ...node, rows: node.rows.map((row) => row.map((c) => mapRefs(c, fn))) };
    default:
      return node;
  }
}

function rewrite(formula: string, fn: RefMapper): string {
  const ast = astOf(formula);
  if (ast instanceof FormulaSyntaxError) return formula;
  return stringify(mapRefs(ast, fn));
}

/**
 * 복사·채우기용 이동. 상대 참조만 델타만큼 움직이고 $는 그대로 둔다.
 * 시트 밖으로 나가면 #REF!(row/col = -1)로 표시한다.
 */
export function translateFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;
  return rewrite(formula, (ref) => {
    const row = ref.absRow ? ref.row : ref.row + dRow;
    const col = ref.absCol ? ref.col : ref.col + dCol;
    const out = row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS;
    return { ...ref, row: out ? -1 : row, col: out ? -1 : col };
  });
}

/** 행 삽입/삭제에 맞춰 참조를 민다. count가 음수면 삭제. */
export function adjustRows(formula: string, at: number, count: number): string {
  return rewrite(formula, (ref) => {
    if (ref.row < 0) return ref;
    if (count > 0) return ref.row >= at ? { ...ref, row: ref.row + count } : ref;
    const removed = -count;
    if (ref.row >= at && ref.row < at + removed) return { ...ref, row: -1 }; // 지워진 행을 가리킴
    return ref.row >= at + removed ? { ...ref, row: ref.row - removed } : ref;
  });
}

/** 열 삽입/삭제에 맞춰 참조를 민다. count가 음수면 삭제. */
export function adjustCols(formula: string, at: number, count: number): string {
  return rewrite(formula, (ref) => {
    if (ref.col < 0) return ref;
    if (count > 0) return ref.col >= at ? { ...ref, col: ref.col + count } : ref;
    const removed = -count;
    if (ref.col >= at && ref.col < at + removed) return { ...ref, col: -1 };
    return ref.col >= at + removed ? { ...ref, col: ref.col - removed } : ref;
  });
}
