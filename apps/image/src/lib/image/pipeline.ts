import Pica from "pica";
import { t } from "../i18n";
import { getBitmap } from "./decode";
import { OUTPUT_MIME, type ImageItem, type OutputSettings, type ResizeSpec } from "./types";

const pica = new Pica();

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
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

/** 아이템 한 장을 공통 설정으로 처리: 디코드 → 리사이즈(pica) → 인코딩. */
export async function processItem(
  item: ImageItem,
  settings: OutputSettings,
): Promise<ProcessResult> {
  const bitmap = await getBitmap(item);
  const { w, h } = targetSize(item.width, item.height, settings.resize);

  let stage = document.createElement("canvas");
  if (w === item.width && h === item.height) {
    stage.width = w;
    stage.height = h;
    context2d(stage).drawImage(bitmap, 0, 0);
  } else {
    const src = document.createElement("canvas");
    src.width = item.width;
    src.height = item.height;
    context2d(src).drawImage(bitmap, 0, 0);
    stage.width = w;
    stage.height = h;
    await pica.resize(src, stage, { alpha: true });
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

  const quality = settings.format === "png" ? undefined : settings.quality / 100;
  const blob = await canvasToBlob(stage, OUTPUT_MIME[settings.format], quality);
  return { blob, width: w, height: h };
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
