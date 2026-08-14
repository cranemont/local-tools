// 형식이 실제로 저장하는 프레임 딜레이를 계산하는 단 하나의 자리.
// 미리보기(Preview)와 세 인코더(encode·webp·mp4)가 모두 여기를 거치므로
// "미리보기는 빠른데 저장한 파일은 느리다"가 구조적으로 생기지 않는다.

export type ExportFormat = "gif" | "webp" | "mp4";

/** GIF는 딜레이를 1/100초 단위로 적는다 — 0·1(=0~10ms)은 브라우저가 100ms로 되돌리므로 20ms가 실질 하한. */
export const GIF_MIN_DELAY_MS = 20;
/** WebP ANMF duration 하한 — 0에 가까우면 뷰어가 무시할 수 있어 안전값으로. */
export const WEBP_MIN_DURATION_MS = 10;
/** MP4는 규격상 하한이 없지만 0 길이 프레임은 muxer가 싫어한다. */
export const MP4_MIN_DURATION_MS = 10;

export function formatMinDelayMs(fmt: ExportFormat): number {
  if (fmt === "gif") return GIF_MIN_DELAY_MS;
  return fmt === "webp" ? WEBP_MIN_DURATION_MS : MP4_MIN_DURATION_MS;
}

/** 뜻이 있는 배속은 양수뿐이다 — 0·음수·NaN은 1배속으로 본다.
 *  음수를 그대로 나누면 raw가 통째로 음수가 되어 모든 프레임이 하한에 걸린 것처럼 보인다. */
function usableSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/** 배속까지 적용한 날것의 딜레이(ms). 유한한 수가 아니면 하한 아래로 본다 —
 *  NaN·Infinity는 Math.max(20, NaN) = NaN으로 하한을 그냥 통과해
 *  gifenc의 writeUInt16이나 WebP ANMF duration에 그대로 실린다. */
function rawDelayMs(delayMs: number, speed: number): number {
  if (!Number.isFinite(delayMs)) return Number.NEGATIVE_INFINITY;
  return delayMs / usableSpeed(speed);
}

/** 배속을 적용하고 형식의 하한·눈금에 맞춘 실제 딜레이(ms). */
export function effectiveDelayMs(
  delayMs: number,
  speed: number,
  fmt: ExportFormat,
): number {
  const min = formatMinDelayMs(fmt);
  const raw = rawDelayMs(delayMs, speed);
  if (raw < min) return min;
  // GIF는 10ms 눈금에 스냅된다. 나머지는 ms 단위 그대로.
  const snapped = fmt === "gif" ? Math.round(raw / 10) * 10 : Math.round(raw);
  return Math.max(min, snapped);
}

/** 형식의 하한에 걸려 결과가 느려지는 프레임인가 (화면 경고용).
 *  10ms 눈금 스냅은 여기서 세지 않는다 — 경고 문구가 말하는 것은 하한 하나뿐이다. */
export function isDelayFloored(
  delayMs: number,
  speed: number,
  fmt: ExportFormat,
): boolean {
  return rawDelayMs(delayMs, speed) < formatMinDelayMs(fmt);
}
