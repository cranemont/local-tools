/** 토큰 → 구문 트리 (재귀 하강).
 *
 * 우선순위는 엑셀과 같다(낮은 것부터):
 *   비교(= <> < > <= >=) → 잇기(&) → 덧뺄셈 → 곱나눗셈 → 거듭제곱(^) →
 *   단항 부호 → 백분율(후위 %) → 범위(:)
 * ^는 엑셀에서 왼쪽 결합이다(2^3^2 = 64).
 */

import { parseRef } from "../sheet/a1";
import { ERR } from "../sheet/types";
import type { BinaryOp, Node } from "./ast";
import { FormulaSyntaxError, tokenize, type Token } from "./tokenize";

const COMPARE = new Set(["=", "<>", "<", ">", "<=", ">="]);

class Parser {
  private i = 0;

  constructor(private readonly toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }

  private eat(kind: string, text?: string): Token | null {
    const t = this.toks[this.i];
    if (!t || t.kind !== kind || (text !== undefined && t.text !== text)) return null;
    this.i++;
    return t;
  }

  private expect(kind: string, what: string): Token {
    const t = this.toks[this.i];
    if (!t || t.kind !== kind) {
      throw new FormulaSyntaxError(`${what}가 필요해요`, t?.pos ?? -1);
    }
    this.i++;
    return t;
  }

  private isOp(...texts: string[]): boolean {
    const t = this.toks[this.i];
    return !!t && t.kind === "op" && texts.includes(t.text);
  }

  parse(): Node {
    const node = this.comparison();
    const rest = this.peek();
    if (rest) throw new FormulaSyntaxError(`여기서 끝나야 해요: ${rest.text}`, rest.pos);
    return node;
  }

  private comparison(): Node {
    let a = this.concat();
    while (this.peek()?.kind === "op" && COMPARE.has(this.peek()!.text)) {
      const op = this.toks[this.i++].text as BinaryOp;
      a = { k: "binary", op, a, b: this.concat() };
    }
    return a;
  }

  private concat(): Node {
    let a = this.additive();
    while (this.isOp("&")) {
      this.i++;
      a = { k: "binary", op: "&", a, b: this.additive() };
    }
    return a;
  }

  private additive(): Node {
    let a = this.multiplicative();
    while (this.isOp("+", "-")) {
      const op = this.toks[this.i++].text as BinaryOp;
      a = { k: "binary", op, a, b: this.multiplicative() };
    }
    return a;
  }

  private multiplicative(): Node {
    let a = this.power();
    while (this.isOp("*", "/")) {
      const op = this.toks[this.i++].text as BinaryOp;
      a = { k: "binary", op, a, b: this.power() };
    }
    return a;
  }

  private power(): Node {
    let a = this.unary();
    while (this.isOp("^")) {
      this.i++;
      a = { k: "binary", op: "^", a, b: this.unary() };
    }
    return a;
  }

  private unary(): Node {
    if (this.isOp("-", "+")) {
      const op = this.toks[this.i++].text as "-" | "+";
      return { k: "unary", op, x: this.unary() };
    }
    return this.percent();
  }

  private percent(): Node {
    let x = this.rangeExpr();
    while (this.isOp("%")) {
      this.i++;
      x = { k: "percent", x };
    }
    return x;
  }

  private rangeExpr(): Node {
    const a = this.primary();
    if (!this.isOp(":")) return a;
    this.i++;
    const b = this.primary();
    if (a.k !== "ref" || b.k !== "ref") {
      throw new FormulaSyntaxError("범위는 셀 주소끼리만 이을 수 있어요", this.peek()?.pos ?? -1);
    }
    return { k: "range", sheet: a.sheet ?? b.sheet, from: a.at, to: b.at };
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaSyntaxError("수식이 도중에 끝났어요", -1);

    switch (t.kind) {
      case "num":
        this.i++;
        return { k: "num", v: Number(t.text) };

      case "str":
        this.i++;
        return { k: "str", v: t.text };

      case "bool":
        this.i++;
        return { k: "bool", v: t.text === "TRUE" };

      case "err": {
        this.i++;
        const found = Object.values(ERR).find((e) => e.code === t.text);
        return { k: "err", v: found ?? ERR.value };
      }

      case "ref": {
        this.i++;
        const at = parseRef(t.text);
        if (!at) return { k: "err", v: ERR.ref };
        return t.sheet ? { k: "ref", sheet: t.sheet, at } : { k: "ref", at };
      }

      case "name": {
        this.i++;
        if (this.eat("(")) {
          const args: Node[] = [];
          if (!this.eat(")")) {
            for (;;) {
              // 빈 인자 — IF(A1,,"x")처럼 가운데를 비우는 관례를 허용한다.
              if (this.peek()?.kind === "," || this.peek()?.kind === ")") args.push({ k: "str", v: "" });
              else args.push(this.comparison());
              if (this.eat(",")) continue;
              this.expect(")", "닫는 괄호 )");
              break;
            }
          }
          return { k: "call", name: t.text.toUpperCase(), args };
        }
        return { k: "name", text: t.text };
      }

      case "(": {
        this.i++;
        const inner = this.comparison();
        this.expect(")", "닫는 괄호 )");
        return inner;
      }

      case "{": {
        this.i++;
        const rows: Node[][] = [];
        let row: Node[] = [];
        for (;;) {
          row.push(this.comparison());
          if (this.eat(",")) continue;
          if (this.eat(";")) {
            rows.push(row);
            row = [];
            continue;
          }
          this.expect("}", "닫는 중괄호 }");
          rows.push(row);
          break;
        }
        return { k: "array", rows };
      }

      default:
        throw new FormulaSyntaxError(`여기 올 수 없는 것이에요: ${t.text}`, t.pos);
    }
  }
}

/** "=" 없는 수식 본문을 트리로. 문법 오류면 FormulaSyntaxError를 던진다. */
export function parseFormula(body: string): Node {
  return new Parser(tokenize(body)).parse();
}
