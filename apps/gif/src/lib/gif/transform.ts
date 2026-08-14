import {
  layoutOverlay,
  overlayFont,
  overlayMetrics,
  overlaysForFrame,
  wrapLines,
  type TextOverlay,
} from "./overlay";
import type { CropRect, Transform } from "./types";

export interface Size {
  w: number;
  h: number;
}

/** 이 프레임에 어떤 오버레이가 얹히는지 renderFrame이 스스로 고르게 하는 입력.
 *  고르는 일을 부르는 쪽에 맡기면 다섯 군데(미리보기·gif·webp·mp4·png)가 갈라진다. */
export interface OverlayContext {
  overlays: readonly TextOverlay[];
  /** 0-based 프레임 인덱스 — 구간 범위 판정에 쓴다. */
  index: number;
  /** 이 프레임이 선택돼 있는가 — "선택한 프레임만" 범위 판정에 쓴다. */
  selected: boolean;
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
 *
 * 텍스트는 변형을 되돌린 **뒤에** 출력 캔버스 좌표로 얹는다 —
 * 자막은 그림이 90° 돌아도 화면 기준 수평으로 읽혀야 한다.
 */
export function renderFrame(
  ctx: Ctx2D,
  bitmap: ImageBitmap,
  tf: Transform,
  baseW: number,
  baseH: number,
  ov?: OverlayContext,
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

  if (!ov) return;
  for (const o of overlaysForFrame(ov.overlays, ov.index, ov.selected)) {
    drawOverlay(ctx, o, outW, outH, tf.scale);
  }
}

/** 오버레이 한 개를 출력 캔버스에 찍는다. 좌표·줄바꿈 계획은 전부 overlay.ts에서 온다. */
function drawOverlay(
  ctx: Ctx2D,
  o: TextOverlay,
  outW: number,
  outH: number,
  scale: number,
): void {
  const metrics = overlayMetrics(o, outW, scale);
  ctx.save();
  // 줄바꿈을 재기 전에 font를 먼저 걸어야 measureText가 같은 글꼴로 잰다.
  ctx.font = overlayFont(metrics.fontPx);
  const lines = wrapLines(o.text, metrics.maxWidth, (s) => ctx.measureText(s).width);
  const box = layoutOverlay(o, outW, outH, scale, lines.length);
  ctx.font = overlayFont(box.fontPx);
  ctx.textAlign = box.align;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = o.strokeColor;
  ctx.lineWidth = box.strokePx;
  ctx.fillStyle = o.color;
  for (let i = 0; i < lines.length; i++) {
    const y = box.firstBaselineY + i * box.lineHeight;
    // 외곽선을 먼저 깔고 그 위에 글자를 채운다 — 반대로 하면 획이 글자를 갉아먹는다.
    if (box.strokePx > 0) ctx.strokeText(lines[i], box.x, y);
    ctx.fillText(lines[i], box.x, y);
  }
  ctx.restore();
}
