/** 다른 형식으로 내보내기/가져오기 — JSON · 마크다운 표 · HTML 표.
 *
 * 표 하나를 다른 곳에 붙여 넣으려고 사이트를 찾아다니는 일을 없애는 게 목적이라,
 * "머리글 있는 표"라는 흔한 모양을 기본으로 잡는다.
 */

import { cellKey } from "./a1";
import { parseInput } from "./model";
import { emptySheet, isError, type Cell, type Scalar, type SheetDoc } from "./types";

export type ExportFormat = "json" | "json-rows" | "markdown" | "html";

export interface ExportOptions {
  /** 첫 줄을 머리글(키 이름)로 쓸지. */
  header: boolean;
}

interface Grid {
  rows: string[][];
  values: Scalar[][];
}

/**
 * 시트를 사각 격자로 굳힌다 — render는 표시 형식이 적용된 화면 문자열을 준다.
 * `rows`를 주면 그 줄만 그 차례대로 담는다(자동 필터의 "보이는 행만").
 */
function toGrid(
  sheet: SheetDoc,
  render: (row: number, col: number) => string,
  rows?: number[],
): Grid {
  let bottom = -1;
  let right = -1;
  for (const key of sheet.cells.keys()) {
    const r = Math.floor(key / 16_384);
    const c = key % 16_384;
    if (r > bottom) bottom = r;
    if (c > right) right = c;
  }

  const order: number[] = [];
  if (rows) {
    for (const r of rows) if (r >= 0 && r <= bottom) order.push(r);
  } else {
    for (let r = 0; r <= bottom; r++) order.push(r);
  }

  const lines: string[][] = [];
  const values: Scalar[][] = [];
  for (const r of order) {
    const line: string[] = [];
    const raw: Scalar[] = [];
    for (let c = 0; c <= right; c++) {
      line.push(render(r, c));
      raw.push(sheet.cells.get(cellKey(r, c))?.v ?? null);
    }
    lines.push(line);
    values.push(raw);
  }
  return { rows: lines, values };
}

/** JSON 값으로 — 오류는 문자열, 빈 칸은 null. */
function jsonValue(v: Scalar): string | number | boolean | null {
  if (v === null) return null;
  if (isError(v)) return v.code;
  return v;
}

function uniqueKeys(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((name, i) => {
    const base = name.trim() || `열${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function exportText(
  sheet: SheetDoc,
  render: (row: number, col: number) => string,
  format: ExportFormat,
  options: ExportOptions = { header: true },
  rows?: number[],
): string {
  const grid = toGrid(sheet, render, rows);
  if (grid.rows.length === 0) return format === "json" || format === "json-rows" ? "[]" : "";

  switch (format) {
    case "json": {
      if (!options.header) {
        return JSON.stringify(grid.values.map((row) => row.map(jsonValue)), null, 2);
      }
      const keys = uniqueKeys(grid.rows[0]);
      const objects = grid.values.slice(1).map((row) => {
        const obj: Record<string, unknown> = {};
        keys.forEach((key, i) => {
          obj[key] = jsonValue(row[i] ?? null);
        });
        return obj;
      });
      return JSON.stringify(objects, null, 2);
    }

    case "json-rows":
      return JSON.stringify(grid.values.map((row) => row.map(jsonValue)), null, 2);

    case "markdown": {
      const escape = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
      const widths = grid.rows[0].map((_, c) =>
        Math.max(...grid.rows.map((row) => escape(row[c] ?? "").length), 3),
      );
      const line = (cells: string[]): string =>
        `| ${cells.map((cell, i) => escape(cell).padEnd(widths[i])).join(" | ")} |`;

      const head = options.header ? grid.rows[0] : grid.rows[0].map((_, i) => `열${i + 1}`);
      const body = options.header ? grid.rows.slice(1) : grid.rows;
      const rule = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
      return [line(head), rule, ...body.map(line)].join("\n");
    }

    case "html": {
      const escape = (text: string): string =>
        text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const cells = (row: string[], tag: "td" | "th"): string =>
        row.map((cell) => `    <${tag}>${escape(cell)}</${tag}>`).join("\n");

      const parts: string[] = ["<table>"];
      if (options.header) {
        parts.push("  <thead>", "  <tr>", cells(grid.rows[0], "th"), "  </tr>", "  </thead>");
      }
      parts.push("  <tbody>");
      for (const row of options.header ? grid.rows.slice(1) : grid.rows) {
        parts.push("  <tr>", cells(row, "td"), "  </tr>");
      }
      parts.push("  </tbody>", "</table>");
      return parts.join("\n");
    }
  }
}

/** JSON 텍스트 → 시트. 객체 배열이면 키를 머리글로 쓴다. */
export function readJson(text: string, name = "Sheet1"): SheetDoc {
  const data: unknown = JSON.parse(text);
  const sheet = emptySheet(name);

  const put = (row: number, col: number, value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "number" || typeof value === "boolean") {
      sheet.cells.set(cellKey(row, col), { v: value });
      return;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const parsed = parseInput(text);
    const cell: Cell = { v: parsed.value };
    // JSON에서 온 문자열은 수식으로 해석하지 않는다 — 데이터를 코드로 만들지 않기 위해.
    if (parsed.formula) cell.v = text;
    if (parsed.numFmt) cell.s = { numFmt: parsed.numFmt };
    sheet.cells.set(cellKey(row, col), cell);
  };

  if (!Array.isArray(data)) throw new Error("JSON 최상위가 배열이어야 해요");

  const objectRows = data.filter(
    (row) => row !== null && typeof row === "object" && !Array.isArray(row),
  ) as Record<string, unknown>[];

  if (objectRows.length === data.length && data.length > 0) {
    const keys: string[] = [];
    for (const row of objectRows) {
      for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
    }
    keys.forEach((key, c) => sheet.cells.set(cellKey(0, c), { v: key, s: { bold: true } }));
    objectRows.forEach((row, r) => {
      keys.forEach((key, c) => put(r + 1, c, row[key]));
    });
    sheet.frozenRows = 1;
    sheet.cols = Math.max(26, keys.length + 3);
    sheet.rows = Math.max(200, objectRows.length + 20);
    return sheet;
  }

  data.forEach((row, r) => {
    if (Array.isArray(row)) row.forEach((cell, c) => put(r, c, cell));
    else put(r, 0, row);
  });
  sheet.rows = Math.max(200, data.length + 20);
  return sheet;
}
