/** 통합문서 재계산 — 의존성 그래프를 세우고 위상 순서로 값을 채운다.
 *
 * 편집 한 번마다 수식 셀 전체를 다시 계산한다. 부분 재계산(더러운 부분집합)이 아니라
 * 전체인 이유는, 개인 도구 규모(수식 수천 개 = 밀리초)에서는 "언제나 맞다"가
 * "조금 빠르다"보다 값싸기 때문이다. 느려지면 여기만 손보면 된다.
 */

import { areaContains, cellKey, keyCol, keyRow, type Area } from "../sheet/a1";
import { isDateFormat } from "../sheet/serial";
import { ERR, type Cell, type Scalar, type SheetDoc, type WorkbookDoc } from "../sheet/types";
import type { Node } from "./ast";
import { evaluate, type EvalContext } from "./evaluate";
import { parseFormula } from "./parse";
import { FormulaSyntaxError } from "./tokenize";

/** 수식 원문 → 구문 트리. 같은 수식이 여러 셀에 있으면 트리를 나눠 쓴다. */
const astCache = new Map<string, Node | FormulaSyntaxError>();

export function astOf(formula: string): Node | FormulaSyntaxError {
  const hit = astCache.get(formula);
  if (hit) return hit;
  let result: Node | FormulaSyntaxError;
  try {
    result = parseFormula(formula);
  } catch (e) {
    result = e instanceof FormulaSyntaxError ? e : new FormulaSyntaxError("수식을 읽을 수 없어요", -1);
  }
  if (astCache.size > 5000) astCache.clear();
  astCache.set(formula, result);
  return result;
}

/** 수식 문법을 미리 확인한다 — 입력 즉시 사용자에게 알려 주려는 용도. */
export function formulaError(formula: string): string | null {
  const ast = astOf(formula);
  return ast instanceof FormulaSyntaxError ? ast.message : null;
}

interface FormulaCell {
  sheet: number;
  row: number;
  col: number;
  ast: Node | FormulaSyntaxError;
}

/** 트리에서 참조하는 셀·범위를 모은다. */
function collectDeps(
  node: Node,
  ownSheet: number,
  sheetIndex: (name: string | undefined) => number,
  refs: { sheet: number; row: number; col: number }[],
  ranges: { sheet: number; area: Area }[],
): void {
  switch (node.k) {
    case "ref":
      refs.push({ sheet: node.sheet ? sheetIndex(node.sheet) : ownSheet, row: node.at.row, col: node.at.col });
      return;
    case "range": {
      const s = node.sheet ? sheetIndex(node.sheet) : ownSheet;
      ranges.push({
        sheet: s,
        area: {
          top: Math.min(node.from.row, node.to.row),
          left: Math.min(node.from.col, node.to.col),
          bottom: Math.max(node.from.row, node.to.row),
          right: Math.max(node.from.col, node.to.col),
        },
      });
      return;
    }
    case "unary":
    case "percent":
      collectDeps(node.x, ownSheet, sheetIndex, refs, ranges);
      return;
    case "binary":
      collectDeps(node.a, ownSheet, sheetIndex, refs, ranges);
      collectDeps(node.b, ownSheet, sheetIndex, refs, ranges);
      return;
    case "call":
      for (const arg of node.args) collectDeps(arg, ownSheet, sheetIndex, refs, ranges);
      return;
    case "array":
      for (const row of node.rows) for (const cell of row) collectDeps(cell, ownSheet, sheetIndex, refs, ranges);
      return;
    default:
      return;
  }
}

function readCell(sheet: SheetDoc | undefined, row: number, col: number): Scalar {
  return sheet?.cells.get(cellKey(row, col))?.v ?? null;
}

/**
 * 날짜 서식 물려받기 — =A1+30이 46276이 아니라 2026-09-11로 보이게 하는 규칙.
 *
 * 엑셀 규칙을 따른다: 날짜 + 수 = 날짜, 날짜 − 수 = 날짜, 날짜 − 날짜 = 그냥 수(일수).
 * 참조가 아닌 계산(SUM 등)은 물려받지 않는다.
 */
function inheritedDateFormat(
  node: Node,
  ownSheet: number,
  lookupFormat: (sheet: number, row: number, col: number) => string | undefined,
  sheetIndex: (name: string | undefined) => number,
): string | undefined {
  switch (node.k) {
    case "ref": {
      const si = node.sheet ? sheetIndex(node.sheet) : ownSheet;
      if (si < 0) return undefined;
      const fmt = lookupFormat(si, node.at.row, node.at.col);
      return isDateFormat(fmt) ? fmt : undefined;
    }
    case "unary":
      return inheritedDateFormat(node.x, ownSheet, lookupFormat, sheetIndex);
    case "binary": {
      if (node.op !== "+" && node.op !== "-") return undefined;
      const a = inheritedDateFormat(node.a, ownSheet, lookupFormat, sheetIndex);
      const b = inheritedDateFormat(node.b, ownSheet, lookupFormat, sheetIndex);
      if (node.op === "-") return a && !b ? a : undefined;
      return a ?? b;
    }
    default:
      return undefined;
  }
}

/**
 * 통합문서 전체를 재계산한다. 수식 셀의 `v`가 제자리에서 갱신된다.
 * 순환 참조에 걸린 셀은 #CIRC!가 된다.
 */
export function recalculate(book: WorkbookDoc): void {
  const byName = new Map<string, number>();
  book.sheets.forEach((s, i) => byName.set(s.name.toLowerCase(), i));
  const sheetIndex = (name: string | undefined): number =>
    name === undefined ? -1 : (byName.get(name.toLowerCase()) ?? -1);
  const lookupFormat = (sheet: number, row: number, col: number): string | undefined =>
    book.sheets[sheet]?.cells.get(cellKey(row, col))?.s?.numFmt;

  // ① 수식 셀 모으기
  const cells: FormulaCell[] = [];
  const indexOf = new Map<string, number>();
  book.sheets.forEach((sheet, si) => {
    for (const [key, cell] of sheet.cells) {
      if (cell.f === undefined) continue;
      const row = keyRow(key);
      const col = keyCol(key);
      indexOf.set(`${si}:${key}`, cells.length);
      cells.push({ sheet: si, row, col, ast: astOf(cell.f) });
    }
  });
  if (cells.length === 0) return;

  // ② 간선 세우기 — "앞서 계산돼야 하는 것 → 나" 방향.
  const outgoing: number[][] = cells.map(() => []);
  const indegree = new Array<number>(cells.length).fill(0);

  // 시트별 수식 셀 목록 — 범위 의존을 훑을 때 쓴다.
  const bySheet = new Map<number, number[]>();
  cells.forEach((c, i) => {
    const list = bySheet.get(c.sheet);
    if (list) list.push(i);
    else bySheet.set(c.sheet, [i]);
  });

  const link = (from: number, to: number): void => {
    if (from === to) return;
    outgoing[from].push(to);
    indegree[to]++;
  };

  cells.forEach((cell, i) => {
    if (cell.ast instanceof FormulaSyntaxError) return;
    const refs: { sheet: number; row: number; col: number }[] = [];
    const ranges: { sheet: number; area: Area }[] = [];
    collectDeps(cell.ast, cell.sheet, sheetIndex, refs, ranges);

    for (const ref of refs) {
      if (ref.sheet < 0) continue;
      const src = indexOf.get(`${ref.sheet}:${cellKey(ref.row, ref.col)}`);
      if (src !== undefined) link(src, i);
    }
    for (const range of ranges) {
      if (range.sheet < 0) continue;
      for (const j of bySheet.get(range.sheet) ?? []) {
        if (areaContains(range.area, cells[j].row, cells[j].col)) link(j, i);
      }
    }
  });

  // ③ 위상 정렬(Kahn). 남은 것이 순환.
  const order: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < cells.length; i++) if (indegree[i] === 0) queue.push(i);
  while (queue.length > 0) {
    const i = queue.pop() as number;
    order.push(i);
    for (const j of outgoing[i]) {
      if (--indegree[j] === 0) queue.push(j);
    }
  }

  const circular = new Set<number>();
  if (order.length < cells.length) {
    for (let i = 0; i < cells.length; i++) if (indegree[i] > 0) circular.add(i);
  }

  // ④ 순서대로 계산
  const ctx = (ownSheet: number): EvalContext => ({
    cell: (name, row, col) => {
      const si = name ? sheetIndex(name) : ownSheet;
      if (si < 0) return ERR.ref;
      return readCell(book.sheets[si], row, col);
    },
    range: (name, area) => {
      const si = name ? sheetIndex(name) : ownSheet;
      if (si < 0) return [[ERR.ref]];
      const sheet = book.sheets[si];
      const out: Scalar[][] = [];
      for (let r = area.top; r <= area.bottom; r++) {
        const row: Scalar[] = [];
        for (let c = area.left; c <= area.right; c++) row.push(readCell(sheet, r, c));
        out.push(row);
      }
      return out;
    },
  });

  // 셀 객체는 제자리에서 고치지 않고 새로 만들어 갈아 끼운다. 그래야 되돌리기
  // 스냅샷이 `new Map(cells)` 한 줄로 끝난다(셀은 공유하고 Map만 복사).
  const replace = (si: number, row: number, col: number, next: Cell): void => {
    book.sheets[si].cells.set(cellKey(row, col), next);
  };

  for (const i of circular) {
    const fc = cells[i];
    const cell = book.sheets[fc.sheet].cells.get(cellKey(fc.row, fc.col));
    if (cell) replace(fc.sheet, fc.row, fc.col, { ...cell, v: ERR.circ });
  }

  for (const i of order) {
    const fc = cells[i];
    const cell = book.sheets[fc.sheet].cells.get(cellKey(fc.row, fc.col));
    if (!cell) continue;

    if (fc.ast instanceof FormulaSyntaxError) {
      replace(fc.sheet, fc.row, fc.col, { ...cell, v: ERR.name });
      continue;
    }

    const result = evaluate(fc.ast, ctx(fc.sheet));
    const next: Cell = { ...cell, v: result.value };

    // 형식이 없으면 붙여 준다 — 안 그러면 날짜가 46276 같은 일련번호로만 보인다.
    // ① 날짜를 돌려주는 함수(TODAY·DATE…) ② 날짜 셀을 더하고 뺀 식(=A1+30)
    if (!cell.s?.numFmt && typeof result.value === "number") {
      const fmt =
        result.dateFormat ?? inheritedDateFormat(fc.ast, fc.sheet, lookupFormat, sheetIndex);
      if (fmt) next.s = { ...cell.s, numFmt: fmt };
    }

    replace(fc.sheet, fc.row, fc.col, next);
  }
}
