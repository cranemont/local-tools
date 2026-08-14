// 타임라인 썸네일 스트립 — 영상 전체를 균등 샘플링해 캔버스 하나에 이어 그린다.
// 현재 프레임 한 장을 원본 해상도로 뽑는 것도 같은 CanvasSink를 쓴다.
import { BlobSource, CanvasSink, Input, type Rotation } from "mediabunny";
import { VIDEO_FORMATS } from "./probe";

/**
 * `canvas`에 스트립을 그린다. 캔버스 백킹 크기도 여기서 설정한다.
 * `alive`가 false를 돌려주면(파일 교체 등) 중간에 조용히 멈춘다.
 */
export async function drawTimelineStrip(
  file: File,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  alive: () => boolean,
): Promise<void> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !alive()) return;
    const duration = await input.computeDuration();

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const aspect = track.displayWidth / Math.max(1, track.displayHeight);
    const thumbW = Math.max(8, Math.round(h * aspect));
    const count = Math.max(1, Math.ceil(w / thumbW));
    const sink = new CanvasSink(track, { width: Math.round(thumbW), poolSize: 2 });

    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) timestamps.push(((i + 0.5) / count) * duration);

    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (!alive()) return;
      if (wrapped) ctx.drawImage(wrapped.canvas, i * thumbW, 0, thumbW, h);
      i++;
    }
  } finally {
    input.dispose();
  }
}

/** 프레임에 걸 회전·반전 — 화면 미리보기·내보내기와 같은 순서(회전 → 반전)로 적용한다. */
export interface FrameTransform {
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
}

/** 해당 시각의 프레임을 원본 해상도 PNG로 뽑는다. 프레임이 없으면 null. */
export async function frameAt(
  file: File,
  timeS: number,
  xf: FrameTransform,
): Promise<Blob | null> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    // width를 지정하지 않아 원본 해상도 그대로 받는다.
    const sink = new CanvasSink(track, { poolSize: 1 });
    const wrapped = await sink.getCanvas(Math.max(0, timeS));
    if (!wrapped) return null;

    const sw = wrapped.canvas.width;
    const sh = wrapped.canvas.height;
    const swap = xf.rotate % 180 !== 0;
    const canvas = new OffscreenCanvas(swap ? sh : sw, swap ? sw : sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // 회전 → 반전 순서 (반전은 돌아간 그림 기준). 캔버스 변환은 나중에 건 것이
    // 그림에 먼저 걸리므로 scale을 rotate보다 앞에 쓴다.
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1);
    ctx.rotate((xf.rotate * Math.PI) / 180);
    ctx.drawImage(wrapped.canvas, -sw / 2, -sh / 2);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    input.dispose();
  }
}
