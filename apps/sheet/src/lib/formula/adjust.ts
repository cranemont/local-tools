/** 수식 안의 참조를 옮긴다 — 복사·채우기·행열 삽입/삭제.
 *
 * 문자열을 정규식으로 치환하지 않고 파서를 거친다. "A1"은 문자열 리터럴 안에도,
 * 함수 이름 속에도 나타날 수 있어서(TEXT(A1,"A1")) 정규식으로는 반드시 틀린다.
 */

import { colName, MAX_COLS, MAX_ROWS, type RefAddr } from "../sheet/a1";
import { formatValue } from "../sheet/numfmt";
import type { Node } from "./ast";
import { astOf } from "./engine";
import { FormulaSyntaxError } from "./tokenize";

function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function refText(ref: RefAddr): string {
  if (ref.row < 0 || ref.col < 0) return "#REF!";
  return `${ref.absCol ? "$" : ""}${colName(ref.col)}${ref.absRow ? "$" : ""}${ref.row + 1}`;
}

/** 트리 → 수식 문자열("=" 없음). */
export function stringify(node: Node): string {
  switch (node.k) {
    case "num":
      return formatValue(node.v);
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
      return `${node.op}${stringify(node.x)}`;
    case "percent":
      return `${stringify(node.x)}%`;
    case "binary":
      return `${stringify(node.a)}${node.op}${stringify(node.b)}`;
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
