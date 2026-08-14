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
} from "./types";
import { effectiveFit, fitPlan, targetSize } from "./size";

const pica = new Pica();

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
}

/** 회전만 적용한 원본 PNG — 크롭 오버레이의 바탕 화면용. */
export async function renderRotated(item: ImageItem): Promise<Blob> {
  const bitmap = await getBitmap(item);
  const canvas = rotateToCanvas(bitmap, item);
  return canvasToBlob(canvas, "image/png");
}

/** 아이템 한 장을 처리: 디코드 → 회전·반전·크롭 → 맞춤·리사이즈(pica) → 인코딩 → (EXIF 유지). */
export async function processItem(
  item: ImageItem,
  settings: OutputSettings,
): Promise<ProcessResult> {
  const bitmap = await getBitmap(item);
  const base = renderBase(bitmap, item);
  const { w, h } = targetSize(base.width, base.height, settings.resize);
  const plan = fitPlan(base.width, base.height, w, h, effectiveFit(settings.resize));

  // cover: 목표 비율만큼만 가운데에서 잘라 낸다 — renderBase의 크롭과 같은 방식.
  let source = base;
  if (plan.src.w !== base.width || plan.src.h !== base.height) {
    const cut = document.createElement("canvas");
    cut.width = plan.src.w;
    cut.height = plan.src.h;
    context2d(cut).drawImage(
      base,
      Math.round((base.width - plan.src.w) / 2),
      Math.round((base.height - plan.src.h) / 2),
      plan.src.w,
      plan.src.h,
      0,
      0,
      plan.src.w,
      plan.src.h,
    );
    source = cut;
  }

  let stage = source;
  if (plan.draw.w !== source.width || plan.draw.h !== source.height) {
    stage = document.createElement("canvas");
    stage.width = plan.draw.w;
    stage.height = plan.draw.h;
    await pica.resize(source, stage, { alpha: true });
  }

  // contain: 그림이 목표보다 작으면 배경색 캔버스 가운데에 놓는다.
  if (stage.width !== w || stage.height !== h) {
    const pad = document.createElement("canvas");
    pad.width = w;
    pad.height = h;
    const ctx = context2d(pad);
    if (settings.resize.padColor) {
      ctx.fillStyle = settings.resize.padColor;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(
      stage,
      Math.round((w - stage.width) / 2),
      Math.round((h - stage.height) / 2),
    );
    stage = pad;
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

/** 회전·반전 → 크롭을 적용한 베이스 캔버스. */
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
  // 반전은 회전 뒤 화면 좌표계 기준이다 — 그래서 rotate보다 먼저 쌓는다(안쪽이 먼저 적용).
  ctx.scale(item.transform.flipX ? -1 : 1, item.transform.flipY ? -1 : 1);
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
