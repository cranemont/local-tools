// 타임라인 썸네일 스트립 — 영상 전체를 균등 샘플링해 캔버스 하나에 이어 그린다.
import { BlobSource, CanvasSink, Input } from "mediabunny";
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
