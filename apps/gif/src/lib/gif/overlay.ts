// 텍스트 오버레이의 순수 계산 — 캔버스도 DOM도 만지지 않는다.
// 실제 그리기(fillText·strokeText)는 transform.ts의 renderFrame 하나뿐이고,
// 미리보기와 네 인코더(gif·webp·mp4·png)가 전부 그 함수를 지나므로
// "미리보기는 이런데 저장한 파일은 다르다"가 구조적으로 생기지 않는다(timing.ts와 같은 이유).

export type OverlayVAlign = "top" | "middle" | "bottom";
export type OverlayAlign = "left" | "center" | "right";
/** 어느 프레임에 얹을지 — 전체 / 선택한 프레임만 / 1-based 번호 구간. */
export type FrameScope = "all" | "selected" | "range";
/** 텍스트에서 쓰던 이름. 가리기 영역(redact.ts)이 같은 규약을 쓰면서 이름을 넓혔다. */
export type OverlayScope = FrameScope;

/** 프레임 범위를 적어 두는 세 칸. 텍스트와 가리기 영역이 이 모양을 포함하고,
 *  판정은 아래 isInFrameScope·isScopeUnseen 하나씩만 쓴다 — 두 벌로 갈라지면
 *  "자막은 붙는데 모자이크는 안 붙는" 프레임이 생긴다. */
export interface FrameScoped {
  scope: FrameScope;
  /** scope === "range"일 때 1-based 포함 구간. */
  from: number;
  to: number;
}

export interface TextOverlay extends FrameScoped {
  id: string;
  text: string;
  /** 세로 위치 프리셋. 가로는 align이 맡는다 — 둘이 합쳐 9방향이 된다. */
  vAlign: OverlayVAlign;
  align: OverlayAlign;
  /** 프리셋에서 밀어내는 값(px, 배율 1 기준). */
  dx: number;
  dy: number;
  /** 글자 크기(px, 배율 1 기준) — 출력 배율이 걸리면 같이 줄어든다. */
  fontSize: number;
  /** 캔버스에 칠할 색. 화면 UI가 아니라 그림 내용이라 테마 토큰을 쓰지 않는다. */
  color: string;
  strokeColor: string;
  /** 외곽선 두께(px, 배율 1 기준). 0이면 외곽선을 그리지 않는다. */
  strokeWidth: number;
}

/** 웹폰트를 내려받지 않는다(단일 HTML 오프라인 원칙) — 시스템 폰트만 쓴다.
 *  라틴은 앞쪽에서, 한글은 뒤쪽 한국어 폰트에서 글리프 단위로 떨어진다.
 *  순서를 뒤집어 한국어 폰트를 앞에 두면 영문까지 그 폰트로 그려진다. */
export const OVERLAY_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Nanum Gothic", sans-serif';

/** 자막은 얇으면 배경에 묻힌다 — 굵기는 고정이고 화면에 손잡이를 두지 않는다. */
export const OVERLAY_FONT_WEIGHT = 700;
/** 줄 간격 = 글자 크기 × 이 값. */
export const OVERLAY_LINE_HEIGHT = 1.25;
/** alphabetic 베이스라인을 쓰므로 첫 줄을 글자 크기의 이만큼 내려 찍는다. */
export const OVERLAY_ASCENT = 0.8;

export const OVERLAY_MIN_FONT_SIZE = 6;
export const OVERLAY_MAX_FONT_SIZE = 400;
export const OVERLAY_MAX_STROKE = 40;

/** 화면 밖으로 튀어나가지 않게 잡아 주는 최소 여백(px, 배율 1 기준). */
const MIN_MARGIN = 6;

function num(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** 뜻이 있는 배율은 양수뿐이다 — 0·음수·NaN은 1로 본다(timing.ts의 usableSpeed와 같은 규약). */
function usableScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 캔버스 가장자리에서 띄우는 여백(px, 배율 1 기준). 글자가 커지면 같이 커진다. */
export function overlayMargin(fontSize: number): number {
  return Math.max(MIN_MARGIN, Math.round(num(fontSize, 0) * 0.4));
}

/** 새 오버레이의 기본값 — 글자 크기는 캔버스 높이에서, 외곽선은 글자 크기에서 나온다.
 *  1000px짜리에 24px 자막을 얹으면 보이지 않고, 100px짜리에 24px은 화면을 덮는다. */
export function newOverlay(id: string, canvasH: number, frameCount: number): TextOverlay {
  const h = Math.max(1, num(canvasH, 1));
  const fontSize = clampFontSize(Math.round(h * 0.09));
  const last = clampFrameNo(frameCount, frameCount);
  return {
    id,
    text: "",
    vAlign: "bottom",
    align: "center",
    dx: 0,
    dy: 0,
    fontSize,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: Math.max(1, Math.round(fontSize / 8)),
    scope: "all",
    from: 1,
    to: last,
  };
}

export function clampFontSize(v: number): number {
  const n = Math.round(num(v, OVERLAY_MIN_FONT_SIZE));
  return Math.min(OVERLAY_MAX_FONT_SIZE, Math.max(OVERLAY_MIN_FONT_SIZE, n));
}

export function clampStrokeWidth(v: number): number {
  const n = Math.round(num(v, 0));
  return Math.min(OVERLAY_MAX_STROKE, Math.max(0, n));
}

/** 1-based 프레임 번호를 1..프레임 수로 가둔다(프레임이 없으면 1). */
export function clampFrameNo(n: number, frameCount: number): number {
  const last = Math.max(1, Math.round(num(frameCount, 1)) || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(last, Math.max(1, Math.round(n)));
}

/** 패널이 칸 하나씩 보내는 편집. id는 못 바꾼다. */
export type OverlayPatch = Partial<Omit<TextOverlay, "id">>;

/**
 * 칸 하나 편집을 오버레이에 적용한다 — 새 객체로 돌려주고 원본은 건드리지 않는다.
 * 화면에서 들어온 수는 비어 있거나 범위 밖일 수 있으므로 캔버스로 나가기 전에 가둔다.
 *
 * 구간 번호(from·to)는 **이번에 적은 칸만** 프레임 수 안으로 가둔다. 예전엔 편집할 때마다
 * 둘 다 다시 가뒀는데, 그러면 프레임이 줄어든 뒤 **글자만 고쳐도 구간 끝이 조용히 줄고**
 * 프레임을 다시 늘려도 안 돌아왔다. 적어 둔 구간은 사용자가 정한 값이므로 그대로 두고,
 * 프레임 수를 넘는 번호는 isOverlayOnFrame이 알아서 읽는다.
 */
export function applyOverlayPatch(
  o: TextOverlay,
  patch: OverlayPatch,
  frameCount: number,
): TextOverlay {
  const next: TextOverlay = { ...o, ...patch, id: o.id };
  next.fontSize = clampFontSize(next.fontSize);
  next.strokeWidth = clampStrokeWidth(next.strokeWidth);
  next.dx = Number.isFinite(next.dx) ? Math.round(next.dx) : 0;
  next.dy = Number.isFinite(next.dy) ? Math.round(next.dy) : 0;
  if ("from" in patch) next.from = clampFrameNo(next.from, frameCount);
  if ("to" in patch) next.to = clampFrameNo(next.to, frameCount);
  return next;
}

// ── 프레임 범위 판정 (텍스트·가리기 영역 공용) ───────

/**
 * 0-based 프레임 인덱스가 이 범위에 드는가.
 * `selected`는 그 프레임이 지금 필름스트립에서 선택돼 있는지 — 선택은 살아 있는 값이라
 * 선택을 바꾸면 걸리는 프레임도 따라 바뀐다.
 */
export function isInFrameScope(
  s: FrameScoped,
  index: number,
  selected: boolean,
): boolean {
  if (s.scope === "all") return true;
  if (s.scope === "selected") return selected;
  const a = Math.round(num(s.from, 1));
  const b = Math.round(num(s.to, 1));
  // 거꾸로 적힌 구간("10~3")도 같은 구간으로 읽는다 — 빈 결과를 내지 않는다.
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const n = index + 1;
  return n >= lo && n <= hi;
}

/**
 * 적어 둔 범위에 걸리는 프레임이 하나도 없는가 — 화면 경고용.
 * 선택이 비었는데 범위가 "선택"이거나, 구간이 통째로 프레임 밖일 때다.
 * (프레임을 하나씩 훑지 않고 산술로만 답한다. isInFrameScope와 같은 규칙이다.)
 */
export function isScopeUnseen(
  s: FrameScoped,
  frameCount: number,
  selectedCount: number,
): boolean {
  const frames = Math.max(0, Math.round(num(frameCount, 0)));
  if (frames === 0) return true;
  if (s.scope === "selected") return Math.max(0, Math.round(num(selectedCount, 0))) === 0;
  if (s.scope !== "range") return false;
  const a = Math.round(num(s.from, 1));
  const b = Math.round(num(s.to, 1));
  return Math.max(a, b) < 1 || Math.min(a, b) > frames;
}

/** 필름스트립 선택이 바뀌면 이 범위가 가리키는 프레임도 바뀌는가. */
export function scopeFollowsSelection(s: FrameScoped): boolean {
  return s.scope === "selected";
}

/** 0-based 프레임 인덱스가 이 오버레이의 범위에 드는가. */
export function isOverlayOnFrame(
  o: TextOverlay,
  index: number,
  selected: boolean,
): boolean {
  return isInFrameScope(o, index, selected);
}

/** 그릴 것이 있는가 — 빈 글자·공백뿐인 글자는 어느 프레임에도 자국을 남기지 않는다. */
export function isOverlayDrawable(o: TextOverlay): boolean {
  return o.text.trim() !== "";
}

/** 이 프레임에 실제로 그려질 오버레이만 추린다(빈 글자는 그릴 것이 없다). */
export function overlaysForFrame(
  overlays: readonly TextOverlay[],
  index: number,
  selected: boolean,
): TextOverlay[] {
  return overlays.filter(
    (o) => isOverlayDrawable(o) && isOverlayOnFrame(o, index, selected),
  );
}

/**
 * 필름스트립 선택이 바뀌면 그림도 바뀌는가.
 * "선택한 프레임만" 범위는 살아 있는 선택을 읽으므로, 그런 글자가 하나라도 있으면
 * 프레임을 고르고 푸는 것만으로 미리보기와 내보낼 결과가 달라진다 —
 * 그때만 리비전을 올려야 한다(늘 올리면 글자가 없어도 결과가 낡음으로 표시된다).
 */
export function selectionAffectsOverlays(overlays: readonly TextOverlay[]): boolean {
  return overlays.some((o) => scopeFollowsSelection(o) && isOverlayDrawable(o));
}

/** 적은 글자가 어느 프레임에도 안 그려지는가 — 화면 경고용. */
export function isOverlayUnseen(
  o: TextOverlay,
  frameCount: number,
  selectedCount: number,
): boolean {
  if (!isOverlayDrawable(o)) return false; // 빈 글자는 '안 보임'이 아니라 '없음'이다
  return isScopeUnseen(o, frameCount, selectedCount);
}

/** 지금 어디에도 안 그려지는 글자의 수. **목록 전체**를 센다 —
 *  편집 중인 것만 보면 다른 오버레이가 같은 상태여도 화면이 조용해진다. */
export function unseenOverlayCount(
  overlays: readonly TextOverlay[],
  frameCount: number,
  selectedCount: number,
): number {
  return overlays.filter((o) => isOverlayUnseen(o, frameCount, selectedCount)).length;
}

// ── 좌표·줄바꿈 ──────────────────────────────────────

export interface OverlayMetrics {
  /** 배율까지 반영된 실제 글자 크기(px). */
  fontPx: number;
  strokePx: number;
  marginPx: number;
  lineHeight: number;
  /** 줄바꿈이 허용하는 최대 글줄 폭(px). */
  maxWidth: number;
}

export interface OverlayLayout extends OverlayMetrics {
  align: OverlayAlign;
  /** ctx.textAlign 기준점의 x(px). */
  x: number;
  /** 첫 줄 baseline의 y(px). 다음 줄은 여기에 lineHeight씩 더한다. */
  firstBaselineY: number;
}

/** 출력 배율까지 반영한 치수. 글자·외곽선·여백이 전부 같은 배율로 줄고 는다. */
export function overlayMetrics(
  o: TextOverlay,
  canvasW: number,
  scale: number,
): OverlayMetrics {
  const s = usableScale(scale);
  const fontSize = clampFontSize(o.fontSize);
  const fontPx = fontSize * s;
  const marginPx = overlayMargin(fontSize) * s;
  return {
    fontPx,
    strokePx: clampStrokeWidth(o.strokeWidth) * s,
    marginPx,
    lineHeight: fontPx * OVERLAY_LINE_HEIGHT,
    maxWidth: Math.max(1, num(canvasW, 1) - marginPx * 2),
  };
}

/** 9방향 프리셋(세로 3 × 정렬 3)을 출력 캔버스 좌표로 푼다. */
export function layoutOverlay(
  o: TextOverlay,
  canvasW: number,
  canvasH: number,
  scale: number,
  lineCount: number,
): OverlayLayout {
  const m = overlayMetrics(o, canvasW, scale);
  const s = usableScale(scale);
  const w = num(canvasW, 1);
  const h = num(canvasH, 1);
  const lines = Math.max(1, Math.round(num(lineCount, 1)));
  const blockH = lines * m.lineHeight;

  const x =
    o.align === "left" ? m.marginPx : o.align === "right" ? w - m.marginPx : w / 2;
  const top =
    o.vAlign === "top"
      ? m.marginPx
      : o.vAlign === "bottom"
        ? h - m.marginPx - blockH
        : (h - blockH) / 2;

  return {
    ...m,
    align: o.align,
    x: x + num(o.dx, 0) * s,
    firstBaselineY: top + m.fontPx * OVERLAY_ASCENT + num(o.dy, 0) * s,
  };
}

/**
 * 글줄을 캔버스 폭 안으로 접는다. 글자 폭 재기를 인자로 받으므로 순수하다
 * (실제 측정은 ctx.measureText, 테스트는 글자 수 × 상수).
 * 한 낱말이 한 줄보다 길면 글자 단위로 끊는다 — 띄어쓰기 없는 한 덩어리가 흔하다.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const paragraphs = text.split("\n");
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return paragraphs;
  const out: string[] = [];
  for (const para of paragraphs) out.push(...wrapParagraph(para, maxWidth, measure));
  return out;
}

function wrapParagraph(
  para: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    out.push(line);
    line = "";
  };

  for (const word of para.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== "") flush();
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    // 낱말 하나가 한 줄보다 길다 — 글자(코드포인트) 단위로 끊는다.
    for (const ch of word) {
      if (line !== "" && measure(line + ch) > maxWidth) flush();
      line += ch;
    }
  }
  // 빈 문단은 빈 줄로 남는다 — 줄 수가 줄면 세로 위치가 어긋난다.
  if (line !== "" || out.length === 0) out.push(line);
  return out;
}

/** canvas의 font 속성에 넣을 문자열. */
export function overlayFont(fontPx: number): string {
  return `${OVERLAY_FONT_WEIGHT} ${Math.max(1, fontPx)}px ${OVERLAY_FONT_STACK}`;
}
