import { t } from "../i18n";
import type { Frame, FrameSource } from "./types";

const uid = (): string => crypto.randomUUID();

const THUMB_MAX = 96;
/** 정지 이미지를 프레임으로 추가할 때 기본 표시 시간. */
export const DEFAULT_STILL_DELAY_MS = 500;

const ANIMATED_MIME = new Set(["image/gif", "image/webp"]);
const STILL_MIME = new Set(["image/png", "image/jpeg"]);

export interface LoadResult {
  source: FrameSource;
  frames: Frame[];
}

/** 파일 하나를 소스 + 프레임 목록으로 변환. 썸네일만 만들어 상주시킨다. */
export async function loadFile(
  file: File,
  onProgress?: (i: number, total: number) => void,
): Promise<LoadResult> {
  const mime = file.type || mimeFromName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (ANIMATED_MIME.has(mime)) return loadAnimated(file.name, mime, bytes, onProgress);
  if (STILL_MIME.has(mime)) return loadStill(file.name, mime, bytes);
  throw new Error(t.errors.unsupported(file.name));
}

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "";
  }
}

async function loadAnimated(
  name: string,
  mime: string,
  bytes: Uint8Array<ArrayBuffer>,
  onProgress?: (i: number, total: number) => void,
): Promise<LoadResult> {
  if (typeof ImageDecoder === "undefined") throw new Error(t.errors.noImageDecoder);

  const decoder = new ImageDecoder({ data: bytes, type: mime });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error(t.errors.decodeFail(name));

    const frameCount = track.frameCount;
    const sourceId = uid();
    const thumbCanvas = document.createElement("canvas");
    const frames: Frame[] = [];
    let width = 0;
    let height = 0;

    for (let i = 0; i < frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      if (i === 0) {
        width = image.displayWidth;
        height = image.displayHeight;
      }
      frames.push({
        id: uid(),
        sourceId,
        frameIndex: i,
        delayMs: normalizeDelay(image.duration),
        selected: false,
        thumb: renderThumb(thumbCanvas, image, image.displayWidth, image.displayHeight),
      });
      image.close();
      onProgress?.(i + 1, frameCount);
    }

    const source: FrameSource = {
      id: sourceId,
      kind: "animated",
      name,
      mime,
      bytes,
      width,
      height,
      frameCount,
    };
    // 임포트에 쓴 디코더를 온디맨드 캐시에 그대로 등록해 재생성 비용을 아낀다.
    decoders.set(sourceId, decoder);
    return { source, frames };
  } catch (err) {
    decoder.close();
    throw err;
  }
}

async function loadStill(
  name: string,
  mime: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<LoadResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  } catch {
    throw new Error(t.errors.decodeFail(name));
  }

  const sourceId = uid();
  const source: FrameSource = {
    id: sourceId,
    kind: "still",
    name,
    mime,
    bytes,
    width: bitmap.width,
    height: bitmap.height,
    frameCount: 1,
  };
  const thumb = renderThumb(
    document.createElement("canvas"),
    bitmap,
    bitmap.width,
    bitmap.height,
  );
  bitmap.close();

  const frames: Frame[] = [
    {
      id: uid(),
      sourceId,
      frameIndex: 0,
      delayMs: DEFAULT_STILL_DELAY_MS,
      selected: false,
      thumb,
    },
  ];
  return { source, frames };
}

/** GIF 관례: 20ms 미만 딜레이는 브라우저가 100ms로 취급하므로 동일하게 정규화. */
function normalizeDelay(durationUs: number | null): number {
  const ms = durationUs ? Math.round(durationUs / 1000) : 0;
  return ms < 20 ? 100 : ms;
}

function renderThumb(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  width: number,
  height: number,
): string {
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t.errors.canvasFail);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

// ── 온디맨드 풀사이즈 프레임 ──────────────────────────────
// 소스별 ImageDecoder를 유지하고, 최근 비트맵 소수만 LRU로 캐시한다.
// (풀사이즈 전체 상주 금지 — 메모리 설계 합의)

const decoders = new Map<string, ImageDecoder>();
const bitmaps = new Map<string, ImageBitmap>();
const BITMAP_CACHE_MAX = 8;

async function getDecoder(source: FrameSource): Promise<ImageDecoder> {
  const existing = decoders.get(source.id);
  if (existing) return existing;
  if (typeof ImageDecoder === "undefined") throw new Error(t.errors.noImageDecoder);
  const decoder = new ImageDecoder({ data: source.bytes, type: source.mime });
  decoders.set(source.id, decoder);
  await decoder.tracks.ready;
  return decoder;
}

/** 프레임 풀사이즈 비트맵을 온디맨드로 디코딩한다. */
export async function getFrameBitmap(
  source: FrameSource,
  frameIndex: number,
): Promise<ImageBitmap> {
  const key = `${source.id}:${frameIndex}`;
  const hit = bitmaps.get(key);
  if (hit) {
    // LRU 갱신
    bitmaps.delete(key);
    bitmaps.set(key, hit);
    return hit;
  }

  let bitmap: ImageBitmap;
  if (source.kind === "still") {
    bitmap = await createImageBitmap(new Blob([source.bytes], { type: source.mime }));
  } else {
    const decoder = await getDecoder(source);
    const { image } = await decoder.decode({ frameIndex });
    bitmap = await createImageBitmap(image);
    image.close();
  }

  bitmaps.set(key, bitmap);
  while (bitmaps.size > BITMAP_CACHE_MAX) {
    const oldest = bitmaps.entries().next().value;
    if (!oldest) break;
    oldest[1].close();
    bitmaps.delete(oldest[0]);
  }
  return bitmap;
}

/** 모든 디코더·비트맵 캐시 해제 (모두 비우기 시). */
export function releaseAll(): void {
  for (const decoder of decoders.values()) decoder.close();
  decoders.clear();
  for (const bitmap of bitmaps.values()) bitmap.close();
  bitmaps.clear();
}
