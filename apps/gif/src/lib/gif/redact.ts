// 모자이크·블러로 가릴 사각 영역의 순수 계산 — 캔버스도 DOM도 만지지 않는다.
// 실제 픽셀 조작(축소했다 늘리기·ctx.filter)은 transform.ts의 renderFrame 하나뿐이고,
// 미리보기와 네 인코더(gif·webp·mp4·png)가 전부 그 함수를 지난다(overlay.ts와 같은 구조).
//
// 좌표계: 영역은 **베이스 캔버스 좌표**에 적는다 — CropRect와 같은 자리다.
// 가리려는 것은 얼굴·계좌번호처럼 원본 그림 위의 자리라서, 나중에 크롭·회전·배율을
// 바꿔도 같은 곳을 덮어야 한다. 출력 좌표로 적어 두면 크롭을 걸 때마다 영역이 어긋난다.
// 그리는 시점에 regionToOutput이 그때의 변형으로 옮겨 놓고, 크롭 밖으로 나간 부분은
// 출력 캔버스 경계에서 잘린다(남는 것이 없으면 null — 그 프레임에는 안 그린다).
//
// 프레임 범위 판정은 텍스트와 같은 함수를 쓴다(overlay.ts의 isInFrameScope).

import { clampFrameNo, isInFrameScope, isScopeUnseen, scopeFollowsSelection } from "./overlay";
import type { FrameScoped } from "./overlay";
// 타입만 가져온다 — 컴파일에서 지워지므로 transform.ts와 실행 시점 순환이 생기지 않는다.
import type { Size } from "./transform";
import type { CropRect } from "./types";

/** 격자로 뭉개기 / 흐리기. 둘 다 원본 픽셀을 지우는 처리라 되돌릴 수 없다. */
export type RedactMode = "mosaic" | "blur";

/** 축에 나란한 사각형. 베이스 좌표에서도 출력 좌표에서도 같은 모양을 쓴다. */
export interface RedactRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactRegion extends RedactRect, FrameScoped {
  id: string;
  mode: RedactMode;
  /** mosaic이면 격자 한 칸, blur면 반경(px, 배율 1 기준).
   *  한 칸으로 둔 이유: 모드를 바꿔도 "얼마나 세게"가 이어진다. 범위만 모드별로 가둔다. */
  strength: number;
}

/** 좌표 변환에 필요한 기하 정보 — Transform이 이 모양을 포함한다.
 *  types.ts가 RedactRegion을 참조하므로 여기서 Transform을 되받지 않는다. */
export interface RedactGeometry {
  crop: CropRect | null;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  scale: number;
}

/** 이보다 작은 사각형은 가릴 뜻이 아니라 잘못 찍은 클릭이다(크롭의 최소 크기와 같다). */
export const REDACT_MIN_SIZE = 4;

/** 격자 1px은 원본 픽셀 그대로라 아무것도 못 가린다 — 배율을 곱한 뒤에도 2px 밑으로 안 내린다. */
export const MOSAIC_MIN_BLOCK = 2;
export const MOSAIC_MAX_BLOCK = 200;
export const BLUR_MIN_RADIUS = 1;
export const BLUR_MAX_RADIUS = 100;

/** 가우시안이 실질적으로 닿는 거리는 표준편차의 세 배다.
 *  블러는 이만큼 넓게 떠서 흐린 뒤 영역만 남긴다 — 안 그러면 테두리가 캔버스 밖(투명)을 빨아들여 흐려진다. */
export const BLUR_SAMPLE_PAD = 3;

/** 빈 칸(undefined)과 NaN·Infinity를 같은 자리에서 걸러 낸다 — 화면에서 오는 수는 셋 다 온다. */
function num(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 뜻이 있는 배율은 양수뿐이다 — 0·음수·NaN은 1로 본다(overlay.ts·timing.ts와 같은 규약). */
function usableScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 90의 배수로 여민 회전각. 데이터에 90의 배수가 아닌 값이 들어와도 축 정렬이 깨지지 않는다. */
function normRotation(deg: number): 0 | 90 | 180 | 270 {
  const n = (((Math.round(num(deg, 0) / 90) * 90) % 360) + 360) % 360;
  return n as 0 | 90 | 180 | 270;
}

// 회전은 90의 배수뿐이라 삼각함수 대신 표를 쓴다 — Math.cos(π/2)의 6.1e-17이 좌표에 섞이지 않는다.
const COS: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

/** 크롭이 없으면 베이스 전체가 크롭이다(transform.ts의 effectiveCrop와 같은 규칙). */
function cropOf(baseW: number, baseH: number, crop: CropRect | null): CropRect {
  return crop ?? { x: 0, y: 0, w: baseW, h: baseH };
}

// ── 영역 정규화 ──────────────────────────────────────

/**
 * 끌어서 만든 사각형을 베이스 캔버스 안의 정수 좌표로 여민다.
 * 음수 폭·높이는 반대쪽 모서리에서 끈 것이므로 뒤집어 읽고, 캔버스 밖은 잘라 낸다.
 * 남은 크기가 REDACT_MIN_SIZE보다 작으면 null — 0 크기와 실수 클릭이 여기서 걸러진다.
 */
export function normalizeRegionRect(
  rect: Partial<RedactRect>,
  baseW: number,
  baseH: number,
): RedactRect | null {
  const bw = Math.max(1, Math.round(num(baseW, 1)));
  const bh = Math.max(1, Math.round(num(baseH, 1)));
  const x0 = num(rect.x, 0);
  const y0 = num(rect.y, 0);
  const x1 = x0 + num(rect.w, 0);
  const y1 = y0 + num(rect.h, 0);

  const clampX = (v: number) => Math.min(bw, Math.max(0, Math.round(v)));
  const clampY = (v: number) => Math.min(bh, Math.max(0, Math.round(v)));
  const left = clampX(Math.min(x0, x1));
  const right = clampX(Math.max(x0, x1));
  const top = clampY(Math.min(y0, y1));
  const bottom = clampY(Math.max(y0, y1));

  const w = right - left;
  const h = bottom - top;
  if (w < REDACT_MIN_SIZE || h < REDACT_MIN_SIZE) return null;
  return { x: left, y: top, w, h };
}

/** 세기의 범위는 모드마다 다르다 — 격자는 2..200px, 블러 반경은 1..100px. */
export function clampStrength(mode: RedactMode, v: number): number {
  const lo = mode === "blur" ? BLUR_MIN_RADIUS : MOSAIC_MIN_BLOCK;
  const hi = mode === "blur" ? BLUR_MAX_RADIUS : MOSAIC_MAX_BLOCK;
  const n = Math.round(num(v, lo));
  return Math.min(hi, Math.max(lo, n));
}

/** 새 영역의 기본 세기 — 영역 크기에서 나온다.
 *  40px짜리 얼굴에 격자 24px을 걸면 한 칸이 되고, 400px짜리에 4px을 걸면 얼굴이 그대로 읽힌다. */
export function defaultStrength(mode: RedactMode, w: number, h: number): number {
  const shorter = Math.max(1, Math.min(num(w, 1), num(h, 1)));
  return clampStrength(mode, Math.round(shorter / (mode === "blur" ? 6 : 8)));
}

/**
 * 끌어서 만든 사각형으로 새 영역을 만든다. 여미고 나서 너무 작으면 null이다.
 * 범위 기본값은 "전체" — 얼굴은 보통 모든 프레임에서 가려야 한다.
 */
export function newRegion(
  id: string,
  rect: Partial<RedactRect>,
  baseW: number,
  baseH: number,
  frameCount: number,
  mode: RedactMode = "mosaic",
): RedactRegion | null {
  const box = normalizeRegionRect(rect, baseW, baseH);
  if (!box) return null;
  return {
    id,
    mode,
    ...box,
    strength: defaultStrength(mode, box.w, box.h),
    scope: "all",
    from: 1,
    to: clampFrameNo(frameCount, frameCount),
  };
}

/** 패널이 칸 하나씩 보내는 편집. id와 좌표는 못 바꾼다 — 자리는 끌어서만 정한다. */
export type RedactPatch = Partial<
  Pick<RedactRegion, "mode" | "strength" | "scope" | "from" | "to">
>;

/**
 * 칸 하나 편집을 영역에 적용한다 — 새 객체로 돌려주고 원본은 건드리지 않는다.
 * 세기는 **바뀐 뒤의 모드** 기준으로 가둔다(격자 200에서 블러로 옮기면 100이 된다).
 * 구간 번호는 이번에 적은 칸만 가둔다 — overlay.ts의 applyOverlayPatch와 같은 이유다.
 */
export function applyRedactPatch(
  r: RedactRegion,
  patch: RedactPatch,
  frameCount: number,
): RedactRegion {
  const next: RedactRegion = { ...r, ...patch, id: r.id };
  next.strength = clampStrength(next.mode, next.strength);
  if ("from" in patch) next.from = clampFrameNo(next.from, frameCount);
  if ("to" in patch) next.to = clampFrameNo(next.to, frameCount);
  return next;
}

// ── 프레임 범위 판정 (텍스트와 같은 함수) ────────────

/** 0-based 프레임 인덱스가 이 영역의 범위에 드는가. */
export function isRegionOnFrame(
  r: RedactRegion,
  index: number,
  selected: boolean,
): boolean {
  return isInFrameScope(r, index, selected);
}

/** 이 프레임에서 가려야 할 영역만 추린다. 목록 순서 그대로 나간다(겹치면 나중 것이 위). */
export function regionsForFrame(
  regions: readonly RedactRegion[],
  index: number,
  selected: boolean,
): RedactRegion[] {
  return regions.filter((r) => isRegionOnFrame(r, index, selected));
}

/** 필름스트립 선택이 바뀌면 그림도 바뀌는가 — "선택한 프레임만" 영역이 하나라도 있을 때다. */
export function selectionAffectsRegions(regions: readonly RedactRegion[]): boolean {
  return regions.some((r) => scopeFollowsSelection(r));
}

/** 화면 경고용 입력 — 프레임 수와 지금 변형을 함께 본다. */
export interface RedactVisibility {
  frameCount: number;
  selectedCount: number;
  baseW: number;
  baseH: number;
  /** outputSize()가 준 출력 캔버스 크기. 여기서 다시 계산하지 않는다 — 식이 두 벌이 된다. */
  out: Size;
  tf: RedactGeometry;
}

/**
 * 이 영역이 어느 프레임에도 안 그려지는가.
 * 두 가지 이유가 있다 — 범위에 걸리는 프레임이 없거나, 크롭이 영역을 남김없이 잘라냈거나.
 * 화면에는 배지 하나로 합쳐 보여 준다(사용자에겐 "안 나온다"는 사실이 같다).
 */
export function isRegionUnseen(r: RedactRegion, v: RedactVisibility): boolean {
  if (isScopeUnseen(r, v.frameCount, v.selectedCount)) return true;
  return regionToOutput(r, v.baseW, v.baseH, v.out, v.tf) === null;
}

/** 지금 어디에도 안 그려지는 영역의 수. 목록 전체를 센다. */
export function unseenRegionCount(
  regions: readonly RedactRegion[],
  v: RedactVisibility,
): number {
  return regions.filter((r) => isRegionUnseen(r, v)).length;
}

// ── 좌표계 변환 ──────────────────────────────────────
//
// renderFrame이 그림에 거는 ctx 변환과 같은 식을 쓴다:
//   translate(out/2) → flip → rotate → scale → translate(-크롭 중심)
// 회전이 90의 배수뿐이라 사각형은 축 정렬을 지킨다 — 네 꼭짓점의 최소·최대가 곧 결과다.

function toOutputPoint(
  px: number,
  py: number,
  c: CropRect,
  out: Size,
  tf: RedactGeometry,
): { x: number; y: number } {
  const s = usableScale(tf.scale);
  const u = (num(px, 0) - (c.x + c.w / 2)) * s;
  const v = (num(py, 0) - (c.y + c.h / 2)) * s;
  const deg = normRotation(tf.rotation);
  const rx = u * COS[deg] - v * SIN[deg];
  const ry = u * SIN[deg] + v * COS[deg];
  return {
    x: (tf.flipH ? -rx : rx) + out.w / 2,
    y: (tf.flipV ? -ry : ry) + out.h / 2,
  };
}

function toBasePoint(
  ox: number,
  oy: number,
  c: CropRect,
  out: Size,
  tf: RedactGeometry,
): { x: number; y: number } {
  const s = usableScale(tf.scale);
  let X = num(ox, 0) - out.w / 2;
  let Y = num(oy, 0) - out.h / 2;
  if (tf.flipH) X = -X;
  if (tf.flipV) Y = -Y;
  const deg = normRotation(tf.rotation);
  // 역회전 — 회전 행렬의 전치다.
  const u = X * COS[deg] + Y * SIN[deg];
  const v = -X * SIN[deg] + Y * COS[deg];
  return { x: u / s + (c.x + c.w / 2), y: v / s + (c.y + c.h / 2) };
}

function usableSize(out: Size): Size {
  return {
    w: Math.max(1, Math.round(num(out.w, 1))),
    h: Math.max(1, Math.round(num(out.h, 1))),
  };
}

/**
 * 베이스 좌표의 영역을 출력 캔버스 좌표로 옮긴다(크롭 → 회전·뒤집기 → 배율).
 * 출력 캔버스 밖은 잘라 내고, 남는 것이 1px도 없으면 null이다 — 크롭이 영역을 버린 경우다.
 * 경계는 바깥쪽으로 여민다(floor·ceil): 반 픽셀을 남기면 가리려던 것이 한 줄 새어 나온다.
 */
export function regionToOutput(
  rect: RedactRect,
  baseW: number,
  baseH: number,
  out: Size,
  tf: RedactGeometry,
): RedactRect | null {
  const c = cropOf(baseW, baseH, tf.crop);
  const o = usableSize(out);
  const x0 = num(rect.x, 0);
  const y0 = num(rect.y, 0);
  const x1 = x0 + num(rect.w, 0);
  const y1 = y0 + num(rect.h, 0);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]) {
    const p = toOutputPoint(px, py, c, o, tf);
    xs.push(p.x);
    ys.push(p.y);
  }

  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(o.w, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(o.h, Math.ceil(Math.max(...ys)));
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return null;
  return { x: left, y: top, w, h };
}

/**
 * 출력 캔버스 좌표에서 끈 사각형을 베이스 좌표의 영역으로 되돌린다(regionToOutput의 역).
 * 미리보기는 변형이 걸린 그림을 보여 주므로, 끌어서 만든 자리는 이 함수를 지나 저장된다.
 */
export function outputToRegion(
  rect: RedactRect,
  baseW: number,
  baseH: number,
  out: Size,
  tf: RedactGeometry,
): RedactRect | null {
  const c = cropOf(baseW, baseH, tf.crop);
  const o = usableSize(out);
  const x0 = num(rect.x, 0);
  const y0 = num(rect.y, 0);
  const x1 = x0 + num(rect.w, 0);
  const y1 = y0 + num(rect.h, 0);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const [ox, oy] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]) {
    const p = toBasePoint(ox, oy, c, o, tf);
    xs.push(p.x);
    ys.push(p.y);
  }

  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return normalizeRegionRect(
    { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top },
    baseW,
    baseH,
  );
}

// ── 세기를 배율에 맞추기 ─────────────────────────────

/**
 * 출력 배율이 걸린 격자 한 칸(px). 배율 25%에서 격자도 25%가 되어야
 * 미리보기와 내보낸 파일이 같은 그림이 된다(글자 크기가 배율을 따라가는 것과 같다).
 * 다만 1px 밑으로는 안 내린다 — 격자 1px은 원본 픽셀이라 가리기를 그만두는 것이다.
 */
export function mosaicBlockPx(block: number, scale: number): number {
  const base = clampStrength("mosaic", block);
  return Math.max(MOSAIC_MIN_BLOCK, Math.round(base * usableScale(scale)));
}

/** 출력 배율이 걸린 블러 반경(px). 0이 되면 흐리지 않게 되므로 1px이 하한이다. */
export function blurRadiusPx(radius: number, scale: number): number {
  const base = clampStrength("blur", radius);
  return Math.max(BLUR_MIN_RADIUS, Math.round(base * usableScale(scale)));
}

/**
 * 블러를 뜨는 표본 상자 — 영역보다 반경의 세 배만큼 넓고, 출력 캔버스 안으로 잘린다.
 * 이만큼 떠서 흐린 뒤 영역만 남기지 않으면 테두리가 밖을 빨아들여 네모가 드러난다.
 */
export function blurSampleRect(box: RedactRect, radiusPx: number, out: Size): RedactRect {
  const o = usableSize(out);
  const pad = Math.ceil(Math.max(0, num(radiusPx, 0)) * BLUR_SAMPLE_PAD);
  const left = Math.max(0, Math.floor(num(box.x, 0)) - pad);
  const top = Math.max(0, Math.floor(num(box.y, 0)) - pad);
  const right = Math.min(o.w, Math.ceil(num(box.x, 0) + num(box.w, 0)) + pad);
  const bottom = Math.min(o.h, Math.ceil(num(box.y, 0) + num(box.h, 0)) + pad);
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

/** 모자이크가 나눌 칸 수 — 반올림으로 0이 되지 않게 최소 1칸이다. */
export function mosaicGrid(box: RedactRect, blockPx: number): Size {
  const block = Math.max(1, Math.round(num(blockPx, 1)));
  return {
    w: Math.max(1, Math.round(num(box.w, 1) / block)),
    h: Math.max(1, Math.round(num(box.h, 1) / block)),
  };
}
