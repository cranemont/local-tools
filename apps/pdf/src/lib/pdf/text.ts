/**
 * 텍스트 조각(좌표 + 글자) → 줄·문단 문자열 재구성.
 *
 * **pdf.js를 부르지 않는다.** 좌표와 글자만 받는 순수 계산이라 브라우저 없이 잰다
 * (명세는 tests/pdf-text.test.ts). pdf.js 호출부는 extract.ts에 있다.
 *
 * 좌표계는 **화면 좌표**다 — x는 오른쪽, y는 **아래로** 갈수록 크다. 회전은 부르는 쪽이
 * 이미 걷어낸 뒤 넘긴다(뷰포트 변환으로 한 번, 그러고도 글이 누워 있으면
 * `uprightCorrection`으로 한 번 더). 그래서 layoutText는 언제나 "글줄이 가로로 눕고
 * 위에서 아래로 읽는" 한 가지 경우만 다룬다.
 */

/** 화면 좌표로 옮겨 놓은 텍스트 조각 하나(pdf.js의 TextItem 한 개에 해당). */
export interface TextPiece {
  /** 그려진 글자. 빈 문자열은 pdf.js가 줄 끝 표시로만 내는 조각이다. */
  str: string;
  /** 왼쪽 끝 x. */
  x: number;
  /** 기준선(baseline) y. 아래로 갈수록 크다. */
  y: number;
  /** 그려진 폭. 0 이하면 폭을 모르는 것으로 본다. */
  width: number;
  /** 글자 높이(대략 글꼴 크기). 0 이하면 높이를 모르는 것으로 본다. */
  height: number;
  /** pdf.js가 "이 조각 뒤에서 줄이 끝났다"고 표시한 경우. */
  hasEOL?: boolean;
}

/** 재구성된 줄 하나. */
export interface TextLine {
  /** 줄의 왼쪽 끝. */
  x: number;
  /** 줄의 기준선(그 줄 조각들 중 제일 위). */
  y: number;
  /** 줄의 대표 글자 높이(제일 큰 것). */
  height: number;
  text: string;
}

export interface PageText {
  lines: TextLine[];
  /** 문단 사이에 빈 줄이 들어간 최종 문자열. */
  text: string;
  /** 글자가 한 자도 없었는가 — 스캔 PDF 경고의 근거다. */
  empty: boolean;
}

export interface LayoutOptions {
  /** 같은 줄로 볼 기준선 차이 = 글자 높이 × 이 값. */
  lineTolerance?: number;
  /** 조각 사이 틈이 글자 한 개 폭 × 이 값을 넘으면 공백을 끼운다. */
  spaceFactor?: number;
  /** 줄 간격이 그 쪽의 평소 간격(중앙값) × 이 값을 넘으면 문단을 나눈다. */
  paragraphFactor?: number;
}

/** 쪽 경계 — pdftotext의 관례를 그대로 쓴다(글자가 아니라 제어문자라 문구가 아니다). */
export const PAGE_BREAK = "\f";

/**
 * 화면 좌표로 합성된 변환 행렬 [a, b, c, d, e, f]와 pdf.js가 잰 치수로 조각 하나를 만든다.
 * 행렬 곱(뷰포트 × 아이템)만 pdf.js에 맡기고, **그 결과를 읽는 규칙은 여기** 있다.
 */
export function pieceFromMatrix(
  str: string,
  matrix: readonly number[],
  width: number,
  height: number,
  hasEOL = false,
): TextPiece {
  const [a, , c, d, e, f] = matrix;
  const w = Math.max(0, width);
  return {
    str,
    // 회전을 걷어냈는데도 글이 왼쪽으로 나아가면(뒤집힌 조판) 원점이 오른쪽 끝이다.
    x: a < 0 ? e - w : e,
    y: f,
    width: w,
    // height가 0으로 오는 조각이 있다 — 그럴 땐 행렬에서 글꼴 크기를 잰다.
    height: height > 0 ? height : Math.hypot(c, d),
    hasEOL,
  };
}

/**
 * 조각들을 가로로 눕히는 보정 행렬. 되돌릴 것이 없으면 null이다.
 *
 * 뷰포트 변환이 쪽 회전(/Rotate)을 걷어내는 것은 **글이 그 회전에 맞춰 그려졌을
 * 때뿐**이다. 회전 도구는 내용 스트림은 놔둔 채 /Rotate만 바꾸므로(우리 편집 탭이
 * 바로 그렇다) 그렇게 나온 문서에서는 뷰포트 변환이 오히려 글을 눕힌다 — 90·270°는
 * 줄이 세로로 흩어지고 180°는 줄과 조각 순서가 통째로 뒤집힌다.
 *
 * 그래서 기준을 쪽이 아니라 **글 자신**에 둔다: 조각의 기준선이 전부 같은 쪽을
 * 가리키면 그쪽을 가로로 되돌린다. 방향이 섞여 있으면(똑바른 본문 위에 눕힌 도장
 * 하나) 되돌릴 '한 방향'이 없으므로 손대지 않는다 — 고르면 본문이 눕는다.
 *
 * width·height는 뷰포트(화면 상자)의 크기다. 좌표를 상자 안에 남겨 두는 데만 쓰고,
 * 줄 묶기는 상대 위치만 보므로 이 값이 어긋나도 재구성 결과는 같다.
 */
export function uprightCorrection(
  matrices: readonly (readonly number[])[],
  width: number,
  height: number,
): number[] | null {
  let spin: QuarterTurn | null = null;
  for (const m of matrices) {
    const q = quarterTurn(m[0], m[1]);
    if (q === null) continue; // 방향이 없는 조각(글꼴 크기 0)은 투표하지 않는다
    if (spin === null) spin = q;
    else if (spin !== q) return null; // 방향이 섞였다
  }

  switch (spin) {
    case 90:
      return [0, -1, 1, 0, 0, width];
    case 180:
      return [-1, 0, 0, -1, width, height];
    case 270:
      return [0, 1, -1, 0, height, 0];
    default:
      return null; // 이미 가로이거나, 잴 조각이 하나도 없다
  }
}

type QuarterTurn = 0 | 90 | 180 | 270;

/** 기준선 방향(a, b)을 90° 눈금으로 스냅한다. 길이가 0이면 방향이 없다 → null. */
function quarterTurn(a: number, b: number): QuarterTurn | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === 0 && b === 0) return null;
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as QuarterTurn;
}

const DEFAULT_LINE_TOLERANCE = 0.5;
const DEFAULT_SPACE_FACTOR = 0.3;
const DEFAULT_PARAGRAPH_FACTOR = 1.5;

/** 입력 순서를 기억한 조각 — hasEOL은 "그 다음"이 어디인지 알아야 쓸 수 있다. */
interface Piece extends TextPiece {
  order: number;
}

/**
 * 조각들을 읽는 순서의 글줄로 되돌린다.
 *
 * 셋을 차례로 한다 — ① y로 줄 묶기 ② 줄 안에서 x로 정렬하며 공백 짐작
 * ③ 줄 간격이 평소보다 벌어진 자리에서 문단 나누기.
 */
export function layoutText(
  pieces: readonly TextPiece[],
  options: LayoutOptions = {},
): PageText {
  const lineTolerance = options.lineTolerance ?? DEFAULT_LINE_TOLERANCE;
  const spaceFactor = options.spaceFactor ?? DEFAULT_SPACE_FACTOR;
  const paragraphFactor = options.paragraphFactor ?? DEFAULT_PARAGRAPH_FACTOR;

  const kept = usable(pieces);
  const lines: TextLine[] = [];
  // 여기서 나오는 순서가 곧 읽는 순서다 — 다시 정렬하지 않는다.
  // 묶음은 이미 y 오름차순이고, 줄 끝 표시로 갈린 조각들은 **같은 y**를 가져서
  // 좌표로는 다시 세울 수 없다(x로 세우면 되돌아온 다음 줄이 앞으로 튀어나온다).
  for (const group of groupByBaseline(kept, lineTolerance)) {
    for (const part of splitAtEol(group)) {
      const line = joinPieces(part, spaceFactor);
      if (line) lines.push(line);
    }
  }

  return {
    lines,
    text: toParagraphs(lines, paragraphFactor),
    empty: lines.length === 0,
  };
}

/** 쪽별 텍스트를 파일 한 장으로 잇는다. 빈 쪽도 자리를 지킨다(쪽 번호가 밀리지 않게). */
export function joinPages(pages: readonly string[]): string {
  if (pages.length === 0) return "";
  return pages.join(`\n${PAGE_BREAK}\n`);
}

/**
 * 쓸 수 있는 조각만 고른다.
 *
 * 글자가 없는 조각은 좌표가 앞 줄을 가리켜서 줄 묶기에 넣으면 없는 자리를 만든다.
 * 다만 pdf.js는 그것을 줄 끝 표시로도 쓰므로, **표시만 앞 조각에 옮겨** 준다.
 */
function usable(pieces: readonly TextPiece[]): Piece[] {
  const kept: Piece[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.str === "") {
      if (p.hasEOL && kept.length) kept[kept.length - 1].hasEOL = true;
      continue;
    }
    // 좌표를 모르는 조각은 어느 줄에도 놓을 수 없다 — 조용히 버린다.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    kept.push({ ...p, order: i });
  }
  return kept;
}

/**
 * 기준선 y로 줄을 묶는다.
 *
 * 비교 대상은 **묶음의 첫 조각**이지 바로 앞 조각이 아니다. 앞 조각과만 재면
 * 허용오차만큼씩 조금씩 내려가는 쪽에서 줄이 사슬처럼 이어져 한 줄이 된다.
 */
function groupByBaseline(pieces: Piece[], tolerance: number): Piece[][] {
  const sorted = [...pieces].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.order - b.order,
  );
  const groups: Piece[][] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const anchor = last[0];
      const tol = Math.max(0, anchor.height, p.height) * tolerance;
      if (p.y - anchor.y <= tol) {
        last.push(p);
        continue;
      }
    }
    groups.push([p]);
  }
  return groups;
}

/**
 * 한 묶음 안에서 pdf.js의 줄 끝 표시로 줄을 더 가른다.
 *
 * 가르는 조건은 **x가 왼쪽으로 되돌아갈 때**뿐이다. 오른쪽으로 이어지는 조각은
 * 줄 끝 표시가 있어도 눈에 보이는 줄이 하나다 — 2단 조판이 여기 걸린다.
 * 오른쪽 단은 왼쪽 단의 "다음 줄"이 아니라 옆이므로, 이 규칙은 두 단을
 * 한 줄로 잇는다(알려진 한계, tests/pdf-text.test.ts에 못 박아 둔다).
 */
function splitAtEol(group: Piece[]): Piece[][] {
  if (group.length < 2 || !group.some((p) => p.hasEOL)) return [group];

  const byOrder = [...group].sort((a, b) => a.order - b.order);
  const parts: Piece[][] = [];
  let current: Piece[] = [];
  for (const p of byOrder) {
    current.push(p);
    if (p.hasEOL) {
      parts.push(current);
      current = [];
    }
  }
  if (current.length) parts.push(current);

  const merged: Piece[][] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && leftEdge(part) > rightEdge(prev)) {
      prev.push(...part);
      continue;
    }
    merged.push(part);
  }
  return merged;
}

// 조각이 수천 개인 줄에서도 안전하게(스프레드는 인자 한도가 있다) 접어서 잰다.
const leftEdge = (part: Piece[]): number =>
  part.reduce((min, p) => Math.min(min, p.x), Infinity);
const rightEdge = (part: Piece[]): number =>
  part.reduce((max, p) => Math.max(max, p.x + Math.max(0, p.width)), -Infinity);

/**
 * 한 줄을 x 순서로 잇고, 틈이 벌어진 자리에 공백을 끼운다.
 *
 * pdf.js는 단어 사이를 별도 조각으로 쪼개 주기도 하고(공백 없이) 공백 글자를
 * 그대로 주기도 한다. 그래서 **틈의 크기**로 판단한다 — 앞 조각의 글자 한 개 평균
 * 폭에 견줘 충분히 벌어졌으면 단어가 갈린 것이다.
 */
function joinPieces(part: Piece[], spaceFactor: number): TextLine | null {
  const byX = [...part].sort((a, b) => a.x - b.x || a.order - b.order);

  let text = "";
  let prev: Piece | null = null;
  let x = Infinity;
  let y = Infinity;
  let height = 0;
  for (const p of byX) {
    if (prev && needsSpace(prev, p, text, spaceFactor)) text += " ";
    text += p.str;
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    height = Math.max(height, p.height);
    prev = p;
  }

  const trimmed = text.trim();
  if (!trimmed) return null; // 공백만 그려진 줄은 눈에 보이지 않는다

  return { x, y, height, text: trimmed };
}

function needsSpace(
  prev: Piece,
  next: Piece,
  soFar: string,
  spaceFactor: number,
): boolean {
  const gap = next.x - (prev.x + Math.max(0, prev.width));
  if (!(gap > 0)) return false; // 붙어 있거나 겹친다
  // 이미 공백이 있으면 더 넣지 않는다 — pdf.js가 공백 글자를 그대로 주는 경우다.
  if (/\s$/.test(soFar)) return false;
  if (/^\s/.test(next.str)) return false;
  return gap > charWidth(prev) * spaceFactor;
}

/** 조각의 글자 한 개 평균 폭. 폭을 모르면 높이에서 짐작한다. */
function charWidth(p: Piece): number {
  const count = [...p.str].length;
  if (count > 0 && p.width > 0) return p.width / count;
  return p.height > 0 ? p.height * 0.5 : 1;
}

/**
 * 줄 간격이 평소보다 벌어진 자리에서 문단을 나눈다.
 *
 * "평소"는 그 쪽 줄 간격의 **중앙값**이다 — 평균은 제목 하나에 끌려간다.
 * 잴 간격이 없으면(줄이 한둘) 나누지 않는다. 근거 없이 나누느니 붙여 두는 쪽이
 * 되돌리기 쉽다.
 */
function toParagraphs(lines: TextLine[], factor: number): string {
  if (lines.length === 0) return "";

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y;
    if (gap > 0) gaps.push(gap);
  }
  const normal = median(gaps);
  const threshold = normal > 0 ? normal * factor : Infinity;

  let out = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y;
    out += gap > threshold ? `\n\n${lines[i].text}` : `\n${lines[i].text}`;
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
