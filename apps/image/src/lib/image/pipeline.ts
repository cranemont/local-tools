import Pica from "pica";
import { t } from "../i18n";
import { encodeAvif } from "./avif";
import { getBitmap } from "./decode";
import { embedJpegExif, embedWebpExif, extractExif, neutralizeOrientation } from "./exif";
import {
  OUTPUT_MIME,
  supportsExifKeep,
  type ImageItem,
  type OutputSettings,
  type ResizeSpec,
} from "./types";

const pica = new Pica();

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
}

/** 장별 편집(회전·크롭) 적용 후 크기 — 리사이즈 입력의 기준. */
export function effectiveSize(item: ImageItem): { w: number; h: number } {
  const tf = item.transform;
  if (tf.crop) return { w: tf.crop.w, h: tf.crop.h };
  const swap = tf.rotation % 180 !== 0;
  return swap ? { w: item.height, h: item.width } : { w: item.width, h: item.height };
}

/** 리사이즈 설정을 적용한 목표 크기 — 비율은 항상 유지. */
export function targetSize(
  w: number,
  h: number,
  resize: ResizeSpec,
): { w: number; h: number } {
  const clamp = (n: number) => Math.max(1, Math.round(n));
  switch (resize.mode) {
    case "scale":
      return { w: clamp((w * resize.scale) / 100), h: clamp((h * resize.scale) / 100) };
    case "width":
      return { w: clamp(resize.width), h: clamp((h * resize.width) / w) };
    case "height":
      return { w: clamp((w * resize.height) / h), h: clamp(resize.height) };
    default:
      return { w, h };
  }
}

/** 회전만 적용한 원본 PNG — 크롭 오버레이의 바탕 화면용. */
export async function renderRotated(item: ImageItem): Promise<Blob> {
  const bitmap = await getBitmap(item);
  const canvas = rotateToCanvas(bitmap, item);
  return canvasToBlob(canvas, "image/png");
}

/** 아이템 한 장을 처리: 디코드 → 회전·크롭 → 리사이즈(pica) → 인코딩 → (EXIF 유지). */
export async function processItem(
  item: ImageItem,
  settings: OutputSettings,
): Promise<ProcessResult> {
  const bitmap = await getBitmap(item);
  const base = renderBase(bitmap, item);
  const { w, h } = targetSize(base.width, base.height, settings.resize);

  let stage = base;
  if (w !== base.width || h !== base.height) {
    stage = document.createElement("canvas");
    stage.width = w;
    stage.height = h;
    await pica.resize(base, stage, { alpha: true });
  }

  // JPEG는 알파가 없다 — 투명 픽셀이 검게 뭉개지지 않게 흰 배경에 합성.
  if (settings.format === "jpeg") {
    const flat = document.createElement("canvas");
    flat.width = w;
    flat.height = h;
    const ctx = context2d(flat);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(stage, 0, 0);
    stage = flat;
  }

  let blob: Blob;
  if (settings.format === "avif") {
    const ctx = context2d(stage);
    blob = await encodeAvif(ctx.getImageData(0, 0, w, h), settings.quality);
  } else {
    const quality = settings.format === "png" ? undefined : settings.quality / 100;
    blob = await canvasToBlob(stage, OUTPUT_MIME[settings.format], quality);
  }

  if (settings.keepExif && supportsExifKeep(settings.format)) {
    const tiff = extractExif(item.bytes, item.mime);
    if (tiff) {
      const neutral = neutralizeOrientation(tiff);
      const out = new Uint8Array(await blob.arrayBuffer());
      const embedded =
        settings.format === "jpeg"
          ? embedJpegExif(out, neutral)
          : embedWebpExif(out, neutral, w, h);
      if (embedded) blob = new Blob([embedded], { type: OUTPUT_MIME[settings.format] });
    }
  }

  return { blob, width: w, height: h };
}

/** 회전 → 크롭을 적용한 베이스 캔버스. */
function renderBase(bitmap: ImageBitmap, item: ImageItem): HTMLCanvasElement {
  const rotated = rotateToCanvas(bitmap, item);
  const crop = item.transform.crop;
  if (!crop) return rotated;
  const out = document.createElement("canvas");
  out.width = crop.w;
  out.height = crop.h;
  context2d(out).drawImage(rotated, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  return out;
}

function rotateToCanvas(bitmap: ImageBitmap, item: ImageItem): HTMLCanvasElement {
  const rotation = item.transform.rotation;
  const swap = rotation % 180 !== 0;
  const rw = swap ? item.height : item.width;
  const rh = swap ? item.width : item.height;
  const canvas = document.createElement("canvas");
  canvas.width = rw;
  canvas.height = rh;
  const ctx = context2d(canvas);
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -item.width / 2, -item.height / 2);
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t.errors.canvasFail);
  return ctx;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t.errors.encodeFail))),
      type,
      quality,
    );
  });
}
