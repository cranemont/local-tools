import type { CropRect, Transform } from "./types";

export interface Size {
  w: number;
  h: number;
}

export function effectiveCrop(
  baseW: number,
  baseH: number,
  crop: CropRect | null,
): CropRect {
  return crop ?? { x: 0, y: 0, w: baseW, h: baseH };
}

/** 변형(크롭→회전→배율) 적용 후 출력 캔버스 크기. */
export function outputSize(baseW: number, baseH: number, tf: Transform): Size {
  const c = effectiveCrop(baseW, baseH, tf.crop);
  const rotated = tf.rotation % 180 !== 0;
  const w = rotated ? c.h : c.w;
  const h = rotated ? c.w : c.h;
  return {
    w: Math.max(1, Math.round(w * tf.scale)),
    h: Math.max(1, Math.round(h * tf.scale)),
  };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * 프레임 하나를 변형 적용해 캔버스에 그린다.
 * 캔버스 픽셀 크기는 outputSize()와 일치해야 한다.
 */
export function renderFrame(
  ctx: Ctx2D,
  bitmap: ImageBitmap,
  tf: Transform,
  baseW: number,
  baseH: number,
): void {
  const c = effectiveCrop(baseW, baseH, tf.crop);
  const { w: outW, h: outH } = outputSize(baseW, baseH, tf);

  ctx.clearRect(0, 0, outW, outH);
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.scale(tf.flipH ? -1 : 1, tf.flipV ? -1 : 1);
  ctx.rotate((tf.rotation * Math.PI) / 180);
  ctx.scale(tf.scale, tf.scale);
  ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
  // 크기가 서로 다른 소스는 베이스 캔버스 중앙에 배치
  ctx.drawImage(bitmap, (baseW - bitmap.width) / 2, (baseH - bitmap.height) / 2);
  ctx.restore();
}
