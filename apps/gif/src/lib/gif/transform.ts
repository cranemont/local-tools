import {
  layoutOverlay,
  overlayFont,
  overlayMetrics,
  overlaysForFrame,
  wrapLines,
  type TextOverlay,
} from "./overlay";
import {
  blurRadiusPx,
  blurSampleRect,
  blurWantRect,
  mosaicBlockPx,
  mosaicGrid,
  regionToOutput,
  regionsForFrame,
  type RedactRect,
} from "./redact";
import type { CropRect, Transform } from "./types";

export interface Size {
  w: number;
  h: number;
}

/** 이 프레임에 무엇이 얹히는지 renderFrame이 스스로 고르게 하는 입력.
 *  고르는 일을 부르는 쪽에 맡기면 다섯 군데(미리보기·gif·webp·mp4·png)가 갈라진다.
 *  가릴 영역은 tf.redact에 있고 여기서는 어느 프레임인지만 온다. */
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
 * 순서는 그림 → 가리기 → 텍스트다. 가리기는 그림 내용을 지우는 처리라 그림 바로 위에 오고,
 * 텍스트는 사용자가 얹은 것이라 가려지지 않는다. 순서를 뒤집으면 자막까지 뭉개진다.
 *
 * 텍스트는 변형을 되돌린 **뒤에** 출력 캔버스 좌표로 얹는다 —
 * 자막은 그림이 90° 돌아도 화면 기준 수평으로 읽혀야 한다.
 * 가릴 영역은 반대로 베이스 좌표에 적혀 있어 그림과 함께 돌고 잘린다(redact.ts).
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
  drawRedactions(ctx, tf, baseW, baseH, { w: outW, h: outH }, ov);
  for (const o of overlaysForFrame(ov.overlays, ov.index, ov.selected)) {
    drawOverlay(ctx, o, outW, outH, tf.scale);
  }
}

/** 이 프레임에서 가려야 할 영역을 차례로 덮는다. 좌표·세기 계산은 전부 redact.ts에서 온다. */
function drawRedactions(
  ctx: Ctx2D,
  tf: Transform,
  baseW: number,
  baseH: number,
  out: Size,
  ov: OverlayContext,
): void {
  for (const r of regionsForFrame(tf.redact, ov.index, ov.selected)) {
    const box = regionToOutput(r, baseW, baseH, out, tf);
    if (!box) continue; // 크롭이 통째로 잘라낸 영역
    if (r.mode === "blur") blurBox(ctx, box, blurRadiusPx(r.strength, tf.scale), out);
    else mosaicBox(ctx, box, mosaicBlockPx(r.strength, tf.scale));
  }
}

/**
 * 가린 그림을 영역 자리에 얹기 전에 원본을 먼저 지운다.
 *
 * drawImage는 기본 합성(source-over)이라, 얹는 그림의 알파가 1보다 작으면 그 비율만큼
 * **원본이 밑에서 그대로 비친다.** 프레임에 투명한 데가 있으면(GIF 투명 배경, 소스 크기가
 * 달라 생긴 베이스 캔버스 여백) 모자이크 칸·블러 결과의 알파가 1 밑으로 내려가므로
 * 가려야 할 글자가 남는다. 크로미엄에서 잰 값: 40×20 영역의 절반이 투명일 때 모자이크
 * 뒤에도 흰 글자 자리가 127, 검은 배경 자리가 0으로 그대로 읽혔다(지우면 둘 다 같은 값).
 * 영역과 지우는 사각형이 같으므로 clip 없이 clearRect 하나면 된다.
 */
function clearBox(ctx: Ctx2D, box: RedactRect): void {
  ctx.clearRect(box.x, box.y, box.w, box.h);
}

/**
 * 되쓰는 스크래치 캔버스. 영역·프레임마다 새로 만들면 500프레임 × 영역 3개에 2500개가 되고,
 * 크로미엄에서 잰 생성+컨텍스트 비용이 2500개에 86~100ms다(모자이크 왕복 전체로는
 * 새로 만들기 276→411ms, 되쓰기 288→157ms — 도는 동안 격차가 벌어진다).
 * 필요한 만큼만 키우고 줄이지는 않는다. renderFrame이 동기 함수라 한 호출이 다 쓰고 놓는다.
 *
 * **결과 픽셀이 같은 자리에만 쓴다.** 모자이크의 축소본과 블러의 표본은 크로미엄에서
 * 새로 만든 것과 바이트가 같았다(격자 5·20, 반경 4·10, 안쪽·아래끝·왼위끝 전부 0 차이).
 * 반면 블러의 work 캔버스는 되쓰면 결과가 최대 5/255 달라졌고 그 차이가 캔버스 크기에
 * 딸려 있다 — 앞서 그린 영역 크기에 따라 같은 입력이 다른 파일이 되므로 여기만 새로 만든다.
 */
type Scratch = { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null;
const scratchSlots: Scratch[] = [null, null];

function scratch(slot: number, w: number, h: number): Scratch {
  const need = { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
  const cur = scratchSlots[slot];
  if (cur && cur.canvas.width >= need.w && cur.canvas.height >= need.h) {
    // 남아 있는 그림 위에 겹쳐 그리면 알파가 1 밑인 자리로 옛 픽셀이 비친다. 쓰는 자리보다
    // 넓게 지우는 이유는 블러다 — 표본 상자 밖은 비어 있어야 커널이 옛 픽셀을 빨아들이지 않는다.
    cur.ctx.clearRect(0, 0, cur.canvas.width, cur.canvas.height);
    cur.ctx.filter = "none";
    return cur;
  }
  const canvas = new OffscreenCanvas(
    Math.max(need.w, cur?.canvas.width ?? 0),
    Math.max(need.h, cur?.canvas.height ?? 0),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const next = { canvas, ctx };
  scratchSlots[slot] = next;
  return next;
}

/** 모자이크 — 영역을 격자 수만큼 줄여 평균색을 얻고, 스무딩을 끈 채 되늘린다.
 *  wasm 없이 도는 것이 이 앱의 전제라 캔버스 두 번 그리기로 끝낸다(CLAUDE.md 8번). */
function mosaicBox(ctx: Ctx2D, box: RedactRect, blockPx: number): void {
  const grid = mosaicGrid(box, blockPx);
  const small = scratch(0, grid.w, grid.h);
  if (!small) return;
  // 줄일 때는 스무딩을 켠다 — 꺼 두면 칸이 원본 픽셀 하나를 그대로 집는다.
  // 켜도 크로미엄의 한 번짜리 축소는 이웃 몇 개만 섞으므로, 격자가 커질수록 칸 하나가
  // 평균색이 아니라 표본에 가까워진다(실측: 격자 20px에서 칸이 원본의 흰·검 둘 중
  // 하나로 나왔다). 가릴 내용은 사라지지만 "평균색"은 아니다.
  small.ctx.imageSmoothingEnabled = true;
  small.ctx.drawImage(ctx.canvas, box.x, box.y, box.w, box.h, 0, 0, grid.w, grid.h);

  ctx.save();
  clearBox(ctx, box); // 평균색을 뜬 다음에 지운다
  // 되늘릴 때는 끈다 — 켜 두면 격자가 뭉개져 얼굴 윤곽이 다시 보인다.
  ctx.imageSmoothingEnabled = false;
  // 스크래치는 격자보다 클 수 있으므로 쓴 자리만 잘라 되늘린다.
  ctx.drawImage(small.canvas, 0, 0, grid.w, grid.h, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** 알파를 채우는 겹치기 횟수. 한 번에 a → 1-(1-a)²이므로 0.5에서 세 번이면 0.998이다.
 *  네 번으로 둔 것은 캔버스 모서리에 붙은 영역의 알파가 0.3까지 내려가서다. */
const ALPHA_FILL_PASSES = 4;

/**
 * 뜬 표본이 캔버스에 잘려 모자란 만큼, 가장자리 픽셀을 늘려 채운다.
 * `filled`는 스크래치 안에서 실제 픽셀이 들어간 자리이고 나머지는 비어 있다.
 * 좌우를 먼저 늘린 뒤 위아래를 폭 전체로 늘리므로 네 귀퉁이도 함께 찬다.
 */
function padSampleEdges(ctx: Ctx2D, filled: RedactRect, w: number, h: number): void {
  const right = filled.x + filled.w;
  const bottom = filled.y + filled.h;
  const c = ctx.canvas;
  if (filled.x > 0) {
    ctx.drawImage(c, filled.x, filled.y, 1, filled.h, 0, filled.y, filled.x, filled.h);
  }
  if (right < w) {
    ctx.drawImage(c, right - 1, filled.y, 1, filled.h, right, filled.y, w - right, filled.h);
  }
  if (filled.y > 0) {
    ctx.drawImage(c, 0, filled.y, w, 1, 0, 0, w, filled.y);
  }
  if (bottom < h) {
    ctx.drawImage(c, 0, bottom - 1, w, 1, 0, bottom, w, h - bottom);
  }
}

/** 블러 — 반경의 세 배만큼 넓게 떠서 흐린 뒤 영역만 남긴다.
 *  넓게 뜨지 않으면 테두리가 밖을 빨아들여 사각형 자국이 남는다. */
function blurBox(ctx: Ctx2D, box: RedactRect, radiusPx: number, out: Size): void {
  const want = blurWantRect(box, radiusPx);
  const src = blurSampleRect(box, radiusPx, out);
  const tmp = scratch(1, want.w, want.h);
  if (!tmp) return;
  const fx = src.x - want.x;
  const fy = src.y - want.y;
  tmp.ctx.drawImage(ctx.canvas, src.x, src.y, src.w, src.h, fx, fy, src.w, src.h);
  // 영역이 캔버스 가장자리에 붙으면 표본이 그만큼 잘린다. 빈자리를 그대로 두면 커널이
  // 빈칸을 세면서 그 줄만 덜 흐려진다 — 크로미엄 실측(반경 10, 아래 끝에 붙인 26px 숫자):
  // 마지막 줄의 가로 대비가 63으로 남고, 늘려 채우면 33으로 떨어져 안 잘린 경우와 같아진다.
  padSampleEdges(tmp.ctx, { x: fx, y: fy, w: src.w, h: src.h }, want.w, want.h);

  // 흐린 그림은 영역 크기 캔버스에 따로 만든다 — 알파를 채우는 겹치기가 여기서 끝난다.
  // 이 한 장만 새로 만든다(위 주석: 되쓰면 결과가 캔버스 크기에 딸려 5/255까지 흔들린다).
  const work = new OffscreenCanvas(box.w, box.h);
  const wctx = work.getContext("2d");
  if (!wctx) return;
  wctx.filter = `blur(${radiusPx}px)`;
  wctx.drawImage(tmp.canvas, 0, 0, want.w, want.h, want.x - box.x, want.y - box.y, want.w, want.h);
  wctx.filter = "none";
  // 원본에 투명한 데가 있으면 흐린 결과의 알파도 1 밑으로 내려가고, 그 비율만큼 밑의
  // 원본이 비친다(크로미엄 실측: 흰 글자 자리 214 대 빈자리 69). 같은 그림을 겹쳐 알파만
  // 올린다 — 색은 그대로이고 원래 알파가 0인 자리는 0으로 남는다.
  for (let i = 0; i < ALPHA_FILL_PASSES; i++) wctx.drawImage(work, 0, 0);

  ctx.save();
  clearBox(ctx, box); // 표본을 뜬 다음에 지운다
  ctx.drawImage(work, box.x, box.y);
  ctx.restore();
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
