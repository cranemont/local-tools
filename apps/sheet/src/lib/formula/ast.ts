import type { RefAddr } from "../sheet/a1";
import type { CellError } from "../sheet/types";

/** 수식 구문 트리. 평가기(evaluate.ts)와 참조 보정(adjust.ts)이 같이 쓴다. */
export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: CellError }
  | { k: "ref"; sheet?: string; at: RefAddr }
  | { k: "range"; sheet?: string; from: RefAddr; to: RefAddr }
  | { k: "unary"; op: "-" | "+"; x: Node }
  | { k: "percent"; x: Node }
  | { k: "binary"; op: BinaryOp; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] }
  /** 배열 리터럴 {1,2;3,4} — 행 우선. */
  | { k: "array"; rows: Node[][] }
  /** 이름 정의(현재는 미지원이라 평가 시 #NAME?). */
  | { k: "name"; text: string };

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">=";
