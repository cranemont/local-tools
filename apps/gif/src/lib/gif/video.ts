// 동영상(MP4/WebM/MOV/MKV) 임포트 — mediabunny(순수 TS) 디먹싱 + WebCodecs 디코딩.
// 선택 구간을 fps 간격으로 샘플링해, 프레임마다 WebP 정지 이미지 소스로 변환한다.
// (기존 still 파이프라인을 그대로 타므로 온디맨드 디코딩·LRU가 동일하게 적용됨)
import { BlobSource, CanvasSink, Input, MATROSKA, MP4, QTFF, WEBM } from "mediabunny";
import { t } from "../i18n";
import { renderThumb } from "./decode";
import type { Frame, FrameSource } from "./types";

const uid = (): string => crypto.randomUUID();

const VIDEO_FORMATS = [MP4, QTFF, WEBM, MATROSKA];
const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
/** 프레임 소스로 저장할 WebP 품질 — 편집 중간 표현이라 넉넉하게. */
const STILL_WEBP_QUALITY = 0.9;

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXT.has(ext);
}

export interface VideoProbeInfo {
  width: number;
  height: number;
  durationS: number;
}

/** 임포트 다이얼로그에 보여줄 메타데이터만 빠르게 읽는다. */
export async function probeVideo(file: File): Promise<VideoProbeInfo> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(t.errors.noVideoTrack(file.name));
    const durationS = await input.computeDuration();
    return { width: track.displayWidth, height: track.displayHeight, durationS };
  } catch (err) {
    throw err instanceof Error ? err : new Error(t.errors.decodeFail(file.name));
  } finally {
    input.dispose();
  }
}

export interface ExtractOptions {
  /** 초당 프레임 수 (기본 12). */
  fps: number;
  /** 출력 배율 (1 = 원본). */
  scale: number;
  startS: number;
  endS: number;
  onProgress?: (done: number, total: number) => void;
}

export interface ExtractResult {
  sources: FrameSource[];
  frames: Frame[];
}

export async function extractVideoFrames(
  file: File,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const { fps, scale, startS, endS, onProgress } = opts;
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(t.errors.noVideoTrack(file.name));

    const width = Math.max(2, Math.round(track.displayWidth * scale));
    const sink = new CanvasSink(track, { width, poolSize: 2 });

    const step = 1 / fps;
    const timestamps: number[] = [];
    for (let ts = startS; ts < endS - 1e-9; ts += step) timestamps.push(ts);
    if (!timestamps.length) timestamps.push(startS);
    const delayMs = Math.round(1000 / fps);

    const sources: FrameSource[] = [];
    const frames: Frame[] = [];
    const thumbCanvas = document.createElement("canvas");
    let done = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      done++;
      if (!wrapped) continue;
      // poolSize로 캔버스가 재사용되므로 다음 프레임 전에 바로 인코딩해 둔다.
      const bytes = new Uint8Array(await (await toWebpBlob(wrapped.canvas)).arrayBuffer());
      const sourceId = uid();
      sources.push({
        id: sourceId,
        kind: "still",
        name: `${file.name} · ${done}`,
        mime: "image/webp",
        bytes,
        width: wrapped.canvas.width,
        height: wrapped.canvas.height,
        frameCount: 1,
      });
      frames.push({
        id: uid(),
        sourceId,
        frameIndex: 0,
        delayMs,
        selected: false,
        thumb: renderThumb(thumbCanvas, wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height),
      });
      onProgress?.(done, timestamps.length);
    }
    if (!frames.length) throw new Error(t.errors.decodeFail(file.name));
    return { sources, frames };
  } finally {
    input.dispose();
  }
}

function toWebpBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/webp", quality: STILL_WEBP_QUALITY });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t.errors.canvasFail))),
      "image/webp",
      STILL_WEBP_QUALITY,
    );
  });
}
