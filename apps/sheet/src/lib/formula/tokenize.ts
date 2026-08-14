/** 수식 문자열 → 토큰.
 *
 * 엑셀 문법의 성가신 부분 셋을 여기서 흡수한다:
 *   · 시트 이름에 공백이 있으면 작은따옴표로 감싸고, 안의 '는 ''로 escape한다.
 *   · 문자열 리터럴은 큰따옴표이고 안의 "는 ""로 escape한다.
 *   · A1은 이름처럼 생겼다 — 참조인지 함수명인지는 뒤에 (가 오는지로 갈린다.
 */

export type TokenKind =
  | "num"
  | "str"
  | "bool"
  | "err"
  | "ref" // A1 · $B$7 (시트 접두사 포함 가능)
  | "name" // 함수명 또는 이름 정의
  | "op"
  | "("
  | ")"
  | ","
  | "{"
  | "}"
  | ";";

export interface Token {
  kind: TokenKind;
  text: string;
  /** ref 토큰의 시트 접두사(따옴표 벗긴 원문). 없으면 현재 시트. */
  sheet?: string;
  pos: number;
}

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

const ERROR_LITERALS = [
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#CIRC!",
];

const REF_BODY = /^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}(?![0-9A-Za-z_.])/;
const NAME_BODY = /^[A-Za-z_\\][A-Za-z0-9_.\\]*/;
const NUM_BODY = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * 셀 주소 꼴인데 실은 함수 이름인 경우를 가른다 — LOG10(100)이 대표다.
 * (LOG10은 LOG열 10행이기도 해서 주소 규칙에 먼저 걸린다.)
 *
 * 판정은 위 주석대로 "뒤에 (가 오는가" 하나다. 단 함수 이름으로 읽으려면 그 글자들이
 * 이름 규칙에도 그대로 맞아야 한다 — $B$2(처럼 $가 섞이면 이름일 수 없으니 주소로 둔다.
 */
function looksLikeCall(rest: string, ref: string): boolean {
  const name = NAME_BODY.exec(rest);
  if (!name || name[0] !== ref) return false;
  let j = ref.length;
  while (j < rest.length && isSpace(rest[j])) j++;
  return rest[j] === "(";
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (isSpace(ch)) {
      i++;
      continue;
    }

    // 오류 리터럴 — 이름보다 먼저 봐야 한다(#로 시작해 이름 규칙에 안 걸린다).
    if (ch === "#") {
      const found = ERROR_LITERALS.find((lit) => src.startsWith(lit, i));
      if (!found) throw new FormulaSyntaxError(`알 수 없는 오류값입니다`, i);
      out.push({ kind: "err", text: found, pos: i });
      i += found.length;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError("따옴표가 닫히지 않았어요", i);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          j++;
          break;
        }
        text += src[j];
        j++;
      }
      out.push({ kind: "str", text, pos: i });
      i = j;
      continue;
    }

    // 시트 접두사: 'My Sheet'!A1 또는 Sheet1!A1
    if (ch === "'") {
      let j = i + 1;
      let name = "";
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError("시트 이름 따옴표가 닫히지 않았어요", i);
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          j++;
          break;
        }
        name += src[j];
        j++;
      }
      if (src[j] !== "!") throw new FormulaSyntaxError("시트 이름 뒤에는 !가 와야 해요", j);
      j++;
      const m = REF_BODY.exec(src.slice(j));
      if (!m) throw new FormulaSyntaxError("시트 뒤에 셀 주소가 없어요", j);
      out.push({ kind: "ref", text: m[0], sheet: name, pos: i });
      i = j + m[0].length;
      continue;
    }

    if (NUM_BODY.test(src.slice(i))) {
      const m = NUM_BODY.exec(src.slice(i)) as RegExpExecArray;
      out.push({ kind: "num", text: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (ch === "$" || /[A-Za-z_\\]/.test(ch)) {
      const rest = src.slice(i);

      // 따옴표 없는 시트 접두사 — Sheet1!A1
      const bare = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
      if (bare) {
        const after = rest.slice(bare[0].length);
        const m = REF_BODY.exec(after);
        if (!m) throw new FormulaSyntaxError("시트 뒤에 셀 주소가 없어요", i + bare[0].length);
        out.push({ kind: "ref", text: m[0], sheet: bare[1], pos: i });
        i += bare[0].length + m[0].length;
        continue;
      }

      const ref = REF_BODY.exec(rest);
      if (ref && !looksLikeCall(rest, ref[0])) {
        out.push({ kind: "ref", text: ref[0], pos: i });
        i += ref[0].length;
        continue;
      }

      const name = NAME_BODY.exec(rest);
      if (name) {
        const upper = name[0].toUpperCase();
        if (upper === "TRUE" || upper === "FALSE") {
          out.push({ kind: "bool", text: upper, pos: i });
        } else {
          out.push({ kind: "name", text: name[0], pos: i });
        }
        i += name[0].length;
        continue;
      }
      throw new FormulaSyntaxError(`읽을 수 없는 글자예요: ${ch}`, i);
    }

    if (ch === "(" || ch === ")" || ch === "," || ch === "{" || ch === "}" || ch === ";") {
      out.push({ kind: ch as TokenKind, text: ch, pos: i });
      i++;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ kind: "op", text: two, pos: i });
      i += 2;
      continue;
    }

    if ("+-*/^&=<>:%".includes(ch)) {
      out.push({ kind: "op", text: ch, pos: i });
      i++;
      continue;
    }

    throw new FormulaSyntaxError(`읽을 수 없는 글자예요: ${ch}`, i);
  }

  return out;
}
