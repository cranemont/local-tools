/** 이미지 표본 — `@napi-rs/canvas`로 PNG·JPEG를 굽는다(node 층 전용).
 *
 * 공통 규약(의존성·바이너리 금지·결정성)은 `tests/fixtures/pdf.ts` 머리말에 있다.
 *
 * 무늬를 짓는 계산과 결과를 재는 계산은 `rgba.ts`에 있고 여기서 그대로 다시 내보낸다 —
 * 브라우저 층이 그 절반만 쓰기 때문이다(거기서는 네이티브 캔버스가 굽는다).
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { makeRgba, type Rgba, type ImageSpec } from "./rgba";

export * from "./rgba";

function canvasOf(image: Rgba) {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const buffer = ctx.createImageData(image.width, image.height);
  buffer.data.set(image.data);
  ctx.putImageData(buffer, 0, 0);
  return canvas;
}

/** 잔 무늬 PNG. 손실이 없어 픽셀이 그대로 돌아온다. */
export function makePng(spec: ImageSpec = {}): Uint8Array {
  return new Uint8Array(canvasOf(makeRgba(spec)).toBuffer("image/png"));
}

/** 잔 무늬 JPEG. `quality`는 0~100이다(napi-rs 규약). */
export function makeJpeg(spec: ImageSpec = {}, quality = 90): Uint8Array {
  return new Uint8Array(canvasOf(makeRgba(spec)).toBuffer("image/jpeg", quality));
}

/** 원시 픽셀을 PNG로. 손으로 지은 표본을 파일로 만들 때 쓴다. */
export function encodePng(image: Rgba): Uint8Array {
  return new Uint8Array(canvasOf(image).toBuffer("image/png"));
}

/** 이미지 바이트 → 원시 픽셀. PNG·JPEG 모두 받는다. */
export async function decodeImage(bytes: Uint8Array): Promise<Rgba> {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const out = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data: out.data };
}
