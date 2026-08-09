import { t } from "../i18n";
import { decodeHeic, isHeicMime } from "./heic";
import type { ImageItem } from "./types";

const uid = (): string => crypto.randomUUID();

const THUMB_MAX = 96;

/** 크로미엄이 네이티브로 디코딩하는 정지 이미지 포맷 (GIF는 첫 프레임만 — 움짤은 GIF 앱 소관)
 *  + HEIC/HEIF(libheif CDN wasm — 이 경로만 인터넷 필요). */
const SUPPORTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
  "image/heic",
  "image/heif",
]);

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "";
  }
}

/** 파일 하나를 ImageItem으로 변환. 썸네일만 만들어 상주시키고 비트맵은 캐시에 넣는다. */
export async function loadImage(file: File): Promise<ImageItem> {
  const mime = file.type || mimeFromName(file.name);
  if (!SUPPORTED_MIME.has(mime)) throw new Error(t.errors.unsupported(file.name));

  const bytes = new Uint8Array(await file.arrayBuffer());
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBytes(bytes, mime);
  } catch (err) {
    // HEIC 엔진 오류(네트워크·검증 실패)는 원인 그대로 보여준다.
    if (isHeicMime(mime) && err instanceof Error) throw err;
    throw new Error(t.errors.decodeFail(file.name));
  }

  const item: ImageItem = {
    id: uid(),
    name: file.name,
    mime,
    bytes,
    width: bitmap.width,
    height: bitmap.height,
    thumb: renderThumb(bitmap),
    transform: { rotation: 0, crop: null },
  };
  cachePut(item.id, bitmap);
  return item;
}

async function decodeBytes(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<ImageBitmap> {
  if (isHeicMime(mime)) return decodeHeic(bytes);
  const blob = new Blob([bytes], { type: mime });
  // SVG는 createImageBitmap이 못 읽는다 — <img> 경유로 래스터화.
  if (mime === "image/svg+xml") {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error("svg size");
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return createImageBitmap(blob);
}

function renderThumb(bitmap: ImageBitmap): string {
  const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t.errors.canvasFail);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

// ── 온디맨드 풀사이즈 비트맵 (LRU 소수만 상주) ────────────

const bitmaps = new Map<string, ImageBitmap>();
const BITMAP_CACHE_MAX = 4;

function cachePut(id: string, bitmap: ImageBitmap): void {
  bitmaps.set(id, bitmap);
  while (bitmaps.size > BITMAP_CACHE_MAX) {
    const oldest = bitmaps.entries().next().value;
    if (!oldest) break;
    oldest[1].close();
    bitmaps.delete(oldest[0]);
  }
}

/** 아이템의 풀사이즈 비트맵을 온디맨드로 디코딩한다. */
export async function getBitmap(item: ImageItem): Promise<ImageBitmap> {
  const hit = bitmaps.get(item.id);
  if (hit) {
    // LRU 갱신
    bitmaps.delete(item.id);
    bitmaps.set(item.id, hit);
    return hit;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBytes(item.bytes, item.mime);
  } catch (err) {
    if (isHeicMime(item.mime) && err instanceof Error) throw err;
    throw new Error(t.errors.decodeFail(item.name));
  }
  cachePut(item.id, bitmap);
  return bitmap;
}

/** 비트맵 캐시 해제 (모두 비우기 시). */
export function releaseAll(): void {
  for (const bitmap of bitmaps.values()) bitmap.close();
  bitmaps.clear();
}

/** 개별 아이템 삭제 시 캐시 정리. */
export function releaseOne(id: string): void {
  const bitmap = bitmaps.get(id);
  if (bitmap) {
    bitmap.close();
    bitmaps.delete(id);
  }
}
