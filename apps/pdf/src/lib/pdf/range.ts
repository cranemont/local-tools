/**
 * "1-5, 8, 12-" 같은 쪽 범위 표기를 페이지 인덱스로 바꾸는 순수 파서.
 * 편집 탭의 선택·분할과 PDF→이미지의 대상 쪽이 같은 규칙을 쓴다.
 */

export interface ParsedRange {
  /** 조각마다 한 묶음 — 분할은 이 묶음이 곧 파일 한 개다. 0-based, 적힌 순서 그대로. */
  groups: number[][];
  /** 모든 묶음을 오름차순·중복 없이 편 것. */
  indices: number[];
  /** 읽지 못한 조각이 하나라도 있으면 true. */
  invalid: boolean;
}

/** 쉼표·세미콜론·줄바꿈 어느 것으로 끊어도 같게 읽는다. */
const SEPARATOR = /[,;\n]/;
/** 붙임표·en dash·물결표 — 한글 자판에서 셋 다 흔하다. */
const DASH = /\s*[-–~]\s*/;

/** 표기를 0-based 인덱스로 해석한다. total은 그 문서의 쪽 수. */
export function parseRange(spec: string, total: number): ParsedRange {
  const groups: number[][] = [];
  let invalid = false;

  for (const raw of spec.split(SEPARATOR)) {
    const piece = raw.trim();
    if (!piece) continue; // 꼬리 쉼표는 잘못이 아니다

    const bounds = readPiece(piece, total);
    if (!bounds) {
      invalid = true;
      continue;
    }
    const [from, to] = bounds;
    const group: number[] = [];
    for (let n = from; n <= to; n++) group.push(n - 1);
    if (group.length) groups.push(group);
    else invalid = true; // 문서 밖만 가리킨 조각
  }

  const seen = new Set<number>();
  for (const group of groups) for (const i of group) seen.add(i);

  return { groups, indices: [...seen].sort((a, b) => a - b), invalid };
}

/**
 * 쪽 수를 모르는 자리(문서마다 다르다)에서 표기 자체가 말이 되는지만 본다.
 * 열린 범위("12-")를 펴 보지 않으므로 total 없이도 안전하다.
 */
export function isRangeSyntaxValid(spec: string): boolean {
  let seen = false;
  for (const raw of spec.split(SEPARATOR)) {
    const piece = raw.trim();
    if (!piece) continue;
    if (!readBounds(piece)) return false;
    seen = true;
  }
  return seen;
}

/** 조각 하나를 1-based [시작, 끝]로. 읽지 못하면 null. */
function readPiece(piece: string, total: number): [number, number] | null {
  const bounds = readBounds(piece);
  if (!bounds) return null;

  const [head, tail] = bounds;
  let from = head ?? 1;
  let to = tail ?? total;
  // 양끝을 다 적은 역순만 뒤집는다("8-3"). 열린 범위까지 뒤집으면 9쪽 문서의
  // "12-"가 마지막 쪽으로 둔갑한다 — 문서 밖을 가리킨 것은 잘못이라고 말해야 한다.
  if (head !== null && tail !== null && from > to) [from, to] = [to, from];

  from = Math.max(1, from);
  to = Math.min(total, to);
  return from <= to ? [from, to] : null;
}

/** 조각의 양끝 — null은 열린 쪽("12-"의 끝, "-5"의 시작). 문법이 틀리면 null 하나. */
function readBounds(piece: string): [number | null, number | null] | null {
  if (/^\d+$/.test(piece)) {
    const n = Number(piece);
    return n >= 1 ? [n, n] : null;
  }

  const parts = piece.split(DASH);
  if (parts.length !== 2) return null;

  const [head, tail] = parts;
  if (!head && !tail) return null; // "-" 하나만 적힌 경우
  if (head && !/^[1-9]\d*$/.test(head)) return null;
  if (tail && !/^[1-9]\d*$/.test(tail)) return null;

  return [head ? Number(head) : null, tail ? Number(tail) : null];
}

/** 인덱스 목록을 앞에서부터 size개씩 끊는다 — "N쪽마다"와 "낱장"(size 1)이 같은 코드. */
export function chunkEvery(indices: number[], size: number): number[][] {
  // 입력란을 비우면 size가 숫자가 아니게 들어온다 — 낱장으로 물러난다.
  const step = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1;
  const out: number[][] = [];
  for (let i = 0; i < indices.length; i += step) {
    out.push(indices.slice(i, i + step));
  }
  return out;
}
