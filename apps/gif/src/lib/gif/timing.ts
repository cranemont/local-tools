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

/** 배속을 적용하고 형식의 하한·눈금에 맞춘 실제 딜레이(ms). */
export function effectiveDelayMs(
  delayMs: number,
  speed: number,
  fmt: ExportFormat,
): number {
  const raw = delayMs / (speed || 1);
  // GIF는 10ms 눈금에 스냅된다. 나머지는 ms 단위 그대로.
  const snapped = fmt === "gif" ? Math.round(raw / 10) * 10 : Math.round(raw);
  return Math.max(formatMinDelayMs(fmt), snapped);
}

/** 형식의 하한에 걸려 결과가 느려지는 프레임인가 (화면 경고용).
 *  10ms 눈금 스냅은 여기서 세지 않는다 — 경고 문구가 말하는 것은 하한 하나뿐이다. */
export function isDelayFloored(
  delayMs: number,
  speed: number,
  fmt: ExportFormat,
): boolean {
  return delayMs / (speed || 1) < formatMinDelayMs(fmt);
}
