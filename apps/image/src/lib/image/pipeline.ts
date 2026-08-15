import Pica from "pica";
import { t } from "../i18n";
import { encodeAvif } from "./avif";
import { getBitmap } from "./decode";
import { embedJpegExif, embedWebpExif, extractExif, neutralizeOrientation } from "./exif";
import { applyPalette, quantize } from "./quantize";
import { pngStepAt, pngSteps, searchTarget, type AttemptInfo } from "./target";
import {
  OUTPUT_MIME,
  supportsExifKeep,
  type ImageItem,
  type OutputSettings,
} from "./types";
import { effectiveFit, fitPlan, targetSize } from "./size";

const pica = new Pica();

/** 목표 용량 탐색이 돌았을 때만 채워진다 — 화면이 무엇을 고른 건지 말할 수 있게. */
export interface SearchInfo {
  /** 목표 이하로 떨어뜨렸는가. 거짓이면 가장 작은 결과를 돌려준 것이다. */
  met: boolean;
  attempts: number;
  /** 고른 품질(png가 아닐 때). */
  quality?: number;
  /** 고른 팔레트 색 수(png일 때). null이면 색을 줄이지 않기로 한 것이다. */
  colors?: number | null;
  /** 더 건 축소 배율 %(png일 때). 100이면 크기를 건드리지 않았다. */
  scale?: number;
}

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
  search?: SearchInfo;
}

/** 목표 용량 탐색의 진행 알림 — 여러 장을 처리할 때 화면이 멈춘 것처럼 보이지 않게 쓴다. */
export type AttemptReport = (info: AttemptInfo) => void;

/** 회전만 적용한 원본 PNG — 크롭 오버레이의 바탕 화면용. */
export async function renderRotated(item: ImageItem): Promise<Blob> {
  const bitmap = await getBitmap(item);
  const canvas = rotateToCanvas(bitmap, item);
  return canvasToBlob(canvas, "image/png");
}

/**
 * 아이템 한 장을 처리: 디코드 → 회전·반전·크롭 → 맞춤·리사이즈(pica) → 인코딩 → (EXIF 유지).
 * `settings.targetBytes`가 있으면 그 이하로 떨어지는 가장 높은 설정을 이진 탐색으로 찾는다
 * (탐색 계획은 target.ts, 여기서는 그 계획에 인코딩을 물려 준다).
 */
export async function processItem(
  item: ImageItem,
  settings: OutputSettings,
  onAttempt?: AttemptReport,
): Promise<ProcessResult> {
  const target = settings.targetBytes;
  if (target === null || !(target > 0)) {
    const stage = await renderStage(item, settings);
    const colors = settings.format === "png" ? settings.pngColors : null;
    const blob = await finish(stage, item, settings, settings.quality, colors);
    return { blob, width: stage.w, height: stage.h };
  }
  return settings.format === "png"
    ? searchPng(item, settings, target, onAttempt)
    : searchQuality(item, settings, target, onAttempt);
}

// ── 목표 용량 탐색 ────────────────────────────────────────────────────────────

/** 품질이 있는 형식: 스테이지는 한 번만 그리고 품질만 바꿔 다시 인코딩한다.
 *  상한은 사용자가 고른 품질이다 — 부탁한 것보다 높은 품질을 돌려주지 않는다. */
async function searchQuality(
  item: ImageItem,
  settings: OutputSettings,
  target: number,
  onAttempt?: AttemptReport,
): Promise<ProcessResult> {
  const stage = await renderStage(item, settings);
  const max = Math.min(100, Math.max(1, Math.round(settings.quality)));
  const hit = await searchTarget(
    { targetBytes: target, min: 1, max },
    async (quality) => {
      const blob = await finish(stage, item, settings, quality, null);
      return { bytes: blob.size, result: blob };
    },
    onAttempt,
  );
  if (!hit) throw new Error(t.errors.encodeFail);
  return {
    blob: hit.result,
    width: stage.w,
    height: stage.h,
    search: { met: hit.met, attempts: hit.attempts, quality: hit.value },
  };
}

/** PNG: 품질 손잡이가 없으니 색 수·축소 배율 사다리(target.ts)를 축으로 쓴다.
 *  상한은 사용자가 고른 색 수다 — 품질 축과 같은 약속으로, 목표가 헐거우면 고른 그 설정이
 *  그대로 나온다(사다리의 맨 위 칸이 곧 그 설정이다).
 *  배율이 바뀔 때만 스테이지를 다시 그린다 — 같은 배율의 칸끼리는 캔버스를 재사용한다. */
async function searchPng(
  item: ImageItem,
  settings: OutputSettings,
  target: number,
  onAttempt?: AttemptReport,
): Promise<ProcessResult> {
  const cap = settings.pngColors;
  let cached: { scale: number; stage: Stage } | null = null;
  const hit = await searchTarget(
    { targetBytes: target, min: 0, max: pngSteps(cap) - 1 },
    async (value) => {
      const step = pngStepAt(value, cap);
      let stage: Stage;
      if (cached && cached.scale === step.scale) {
        stage = cached.stage;
      } else {
        stage = await renderStage(item, settings, step.scale);
        cached = { scale: step.scale, stage };
      }
      const blob = await finish(stage, item, settings, settings.quality, step.colors);
      return { bytes: blob.size, result: { blob, w: stage.w, h: stage.h, step } };
    },
    onAttempt,
  );
  if (!hit) throw new Error(t.errors.encodeFail);
  return {
    blob: hit.result.blob,
    width: hit.result.w,
    height: hit.result.h,
    search: {
      met: hit.met,
      attempts: hit.attempts,
      colors: hit.result.step.colors,
      scale: hit.result.step.scale,
    },
  };
}

// ── 스테이지(그리기) / 인코딩 ─────────────────────────────────────────────────

/** 인코딩 직전의 캔버스. 목표 용량 탐색은 이걸 한 번 만들어 여러 번 인코딩한다. */
interface Stage {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** 스테이지 픽셀. **여러 번 불러도 캔버스는 한 번만 읽는다** — 탐색이 같은 스테이지를
   *  최대 아홉 번 인코딩하는데(AVIF는 매 품질마다, PNG는 매 색 수마다 픽셀이 필요하다)
   *  같은 캔버스에 `getImageData`를 되풀이하면 크로미엄이 GPU에서 매번 되읽으며
   *  `willReadFrequently` 경고를 띄운다. 컨텍스트 옵션으로는 못 고친다 —
   *  `getContext("2d")`는 처음 만들 때 준 옵션만 쓰고, 그렇다고 스테이지를 통째로
   *  소프트웨어 캔버스로 만들면 pica·drawImage가 느려진다.
   *
   *  ⚠️ **돌려받은 것을 제자리에서 고치지 말 것** — 다음 시도가 고쳐진 픽셀을 인코딩한다.
   *  색 축소는 `applyPalette`가 새 배열에 칠하게 해서 이 규약을 지킨다. */
  pixels(): ImageData;
}

function stageOf(canvas: HTMLCanvasElement, w: number, h: number): Stage {
  let read: ImageData | null = null;
  return {
    canvas,
    w,
    h,
    pixels: () => (read ??= context2d(canvas).getImageData(0, 0, w, h)),
  };
}

/** extraScale은 리사이즈로 정해진 목표 크기에 더 거는 축소 배율(%)이다 — PNG 탐색만 쓴다. */
async function renderStage(
  item: ImageItem,
  settings: OutputSettings,
  extraScale = 100,
): Promise<Stage> {
  const bitmap = await getBitmap(item);
  const base = renderBase(bitmap, item);
  const target = targetSize(base.width, base.height, settings.resize);
  const w = scaleSide(target.w, extraScale);
  const h = scaleSide(target.h, extraScale);
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

  return stageOf(stage, w, h);
}

function scaleSide(n: number, pct: number): number {
  return pct === 100 ? n : Math.max(1, Math.round((n * pct) / 100));
}

/** 인코딩 + EXIF 유지까지 — 탐색이 재는 바이트가 실제 저장될 파일 크기와 같아야 한다. */
async function finish(
  stage: Stage,
  item: ImageItem,
  settings: OutputSettings,
  quality: number,
  colors: number | null,
): Promise<Blob> {
  const blob = await encodeStage(stage, settings, quality, colors);
  return keepExif(blob, item, settings, stage.w, stage.h);
}

async function encodeStage(
  stage: Stage,
  settings: OutputSettings,
  quality: number,
  colors: number | null,
): Promise<Blob> {
  const { canvas } = stage;
  if (settings.format === "avif") {
    return encodeAvif(stage.pixels(), quality);
  }
  if (settings.format === "png") {
    const target = colors === null ? canvas : reduceColors(stage, colors, settings.pngDither);
    return canvasToBlob(target, OUTPUT_MIME.png);
  }
  return canvasToBlob(canvas, OUTPUT_MIME[settings.format], quality / 100);
}

/** 색을 줄인 **사본** 캔버스. 스테이지 픽셀은 읽기만 한다 —
 *  탐색이 같은 스테이지를 색 수만 바꿔 여러 번 인코딩하기 때문이다.
 *  quantize는 입력을 읽기만 하고, 칠한 결과는 따로 잡은 배열로 받는다. */
function reduceColors(stage: Stage, colors: number, dither: boolean): HTMLCanvasElement {
  const { w, h } = stage;
  const src = stage.pixels();
  const painted = new Uint8ClampedArray(w * h * 4);
  applyPalette(quantize(src.data, w, h, { colors, dither }), painted);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  context2d(out).putImageData(new ImageData(painted, w, h), 0, 0);
  return out;
}

async function keepExif(
  blob: Blob,
  item: ImageItem,
  settings: OutputSettings,
  w: number,
  h: number,
): Promise<Blob> {
  if (!settings.keepExif || !supportsExifKeep(settings.format)) return blob;
  const tiff = extractExif(item.bytes, item.mime);
  if (!tiff) return blob;
  const neutral = neutralizeOrientation(tiff);
  const out = new Uint8Array(await blob.arrayBuffer());
  const embedded =
    settings.format === "jpeg"
      ? embedJpegExif(out, neutral)
      : embedWebpExif(out, neutral, w, h);
  return embedded ? new Blob([embedded], { type: OUTPUT_MIME[settings.format] }) : blob;
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
