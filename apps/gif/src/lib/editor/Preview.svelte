<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import { getFrameBitmap } from "../gif/decode";
  import { effectiveDelayMs } from "../gif/timing";
  import { renderFrame } from "../gif/transform";
  import {
    REDACT_HANDLES,
    dragRegionRect,
    regionToOutput,
    regionsForFrame,
    type RedactDrag,
    type RedactMode,
    type RedactRect,
  } from "../gif/redact";
  import type { CropRect } from "../gif/types";

  let boxEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── 렌더 ─────────────────────────────────────────
  let renderSeq = 0;

  async function render() {
    const canvas = canvasEl;
    if (!canvas || !editor.frames.length) return;
    const seq = ++renderSeq;

    const index = Math.min(editor.current, editor.frames.length - 1);
    const frame = editor.frames[index];
    const source = editor.sources.get(frame.sourceId);
    if (!source) return;

    const bitmap = await getFrameBitmap(source, frame.frameIndex);
    if (seq !== renderSeq) return;

    const { w: baseW, h: baseH } = editor.base;
    // 크롭 모드에서 어떻게 그리는지는 state의 previewTransform 하나에 있다 —
    // 화면의 상자와 패널의 크기 표시가 같은 좌표계를 보게 하려는 것이다.
    const tf = editor.previewTransform;
    const { w, h } = editor.previewOutput;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 크롭 모드에서는 텍스트를 얹지 않는다 — 변형 전 좌표계라 결과와 자리가 다르고,
    // 남길 영역을 고르는 화면에 글자가 겹치면 방해만 된다.
    renderFrame(ctx, bitmap, tf, baseW, baseH, {
      overlays: editor.cropMode ? [] : editor.overlays,
      index,
      selected: frame.selected,
    });
  }

  // 일시정지 상태의 다시 그리기 (변형·프레임 변경 반영)
  $effect(() => {
    const tf = editor.transform;
    void tf.crop;
    void tf.rotation;
    void tf.flipH;
    void tf.flipV;
    void tf.scale;
    void tf.redact;
    void editor.current;
    void editor.revision;
    void editor.cropMode;
    void editor.frames.length;
    if (!editor.playing) void render();
  });

  // 재생 루프 — playing만 의존성으로 잡고 내부 읽기는 untrack
  $effect(() => {
    if (!editor.playing) return;
    let alive = true;
    void untrack(() => playLoop(() => alive));
    return () => {
      alive = false;
    };
  });

  async function playLoop(isAlive: () => boolean) {
    while (isAlive() && editor.playing && editor.frames.length) {
      const started = performance.now();
      await render();
      const frame = editor.frames[Math.min(editor.current, editor.frames.length - 1)];
      if (!frame) break;
      // 내보낸 파일과 같은 속도로 돈다 — 하한·눈금까지 인코더와 같은 함수로 계산한다.
      const delay = effectiveDelayMs(frame.delayMs, editor.speed, editor.exportFormat);
      const wait = delay - (performance.now() - started);
      if (wait > 0) await sleep(wait);
      if (!isAlive() || !editor.playing || !editor.frames.length) break;
      editor.current = (editor.current + 1) % editor.frames.length;
    }
  }

  // ── 그려진 그림의 상자 ─────────────────────────────
  // 캔버스는 max-width/height로만 줄어드는 대체 요소라 요소 상자가 곧 그림 상자다.
  // 다만 absolute의 기준은 stagebox의 **패딩 상자**여서 테두리(clientLeft/Top)만큼 뺀다.
  // inset:0으로 두면 padding 여백이 그림처럼 잡혀 여백에서도 드래그가 시작된다
  // (apps/image의 measurePaint와 같은 계산 — CLAUDE.md 12번).
  interface ViewRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  let paint = $state<ViewRect | null>(null);

  function measurePaint() {
    if (!canvasEl || !boxEl) {
      paint = null;
      return;
    }
    const r = canvasEl.getBoundingClientRect();
    const box = boxEl.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) {
      paint = null;
      return;
    }
    paint = {
      x: r.left - box.left - boxEl.clientLeft,
      y: r.top - box.top - boxEl.clientTop,
      w: r.width,
      h: r.height,
    };
  }

  $effect(() => {
    // 캔버스 픽셀 크기가 바뀌면 화면에 그려지는 크기도 바뀐다.
    void editor.previewOutput;
    void editor.frames.length;
    if (!canvasEl || !boxEl) {
      paint = null;
      return;
    }
    measurePaint();
    const ro = new ResizeObserver(() => measurePaint());
    ro.observe(canvasEl);
    ro.observe(boxEl);
    return () => ro.disconnect();
  });

  /** 화면 1px이 출력 캔버스 몇 px인가. 끌기·상자 그리기가 이 값으로만 환산한다. */
  const toCanvasX = $derived(paint ? editor.previewOutput.w / Math.max(1, paint.w) : 1);
  const toCanvasY = $derived(paint ? editor.previewOutput.h / Math.max(1, paint.h) : 1);

  // ── 가릴 영역의 윤곽 ───────────────────────────────
  // 지금 프레임에 실제로 그려지는 영역만 상자로 보여 준다 — 범위 밖이거나 크롭에 잘린 것은
  // 화면에 없는 것이 맞다(패널의 "안 나옴" 배지가 그쪽을 맡는다).
  const REDACT_MODE_LABELS: Record<RedactMode, string> = {
    mosaic: t.panel.redactMosaic,
    blur: t.panel.redactBlur,
  };
  const shapes = $derived.by(() => {
    const p = paint;
    if (!p || editor.playing || !editor.frames.length) return [];
    const index = Math.min(editor.current, editor.frames.length - 1);
    const frame = editor.frames[index];
    const drawn = new Set(
      regionsForFrame(editor.regions, index, !!frame?.selected).map((r) => r.id),
    );
    const out = editor.previewOutput;
    const tf = editor.previewTransform;
    const kx = p.w / Math.max(1, out.w);
    const ky = p.h / Math.max(1, out.h);
    const list: { id: string; label: string; view: ViewRect }[] = [];
    editor.regions.forEach((r, i) => {
      if (!drawn.has(r.id)) return;
      const box = regionToOutput(r, editor.base.w, editor.base.h, out, tf);
      if (!box) return;
      list.push({
        id: r.id,
        label: t.panel.redactItem(i + 1, REDACT_MODE_LABELS[r.mode], box.w, box.h),
        view: { x: box.x * kx, y: box.y * ky, w: box.w * kx, h: box.h * ky },
      });
    });
    return list;
  });

  /** 크롭 모드에서는 윤곽만 보여 준다 — 그 화면의 드래그는 남길 영역을 고르는 뜻이다. */
  const shapesLive = $derived(!editor.cropMode);

  type RegionDrag = {
    id: string;
    mode: RedactDrag;
    start: RedactRect;
    px: number;
    py: number;
  };
  let regionDrag: RegionDrag | null = null;

  function shapeDown(e: PointerEvent) {
    if (!shapesLive || !paint) return;
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>("[data-region]");
    const id = el?.dataset.region;
    if (!el || !id) return;
    const region = editor.regions.find((r) => r.id === id);
    if (!region) return;
    // 끌기의 기준은 **화면에 보이는 상자**다. 크롭에 반쯤 잘린 영역을 잡으면 보이는 만큼만
    // 남는다 — 손잡이가 붙은 자리가 곧 사각형이어야 잡은 곳과 움직이는 곳이 같다.
    const start = regionToOutput(
      region,
      editor.base.w,
      editor.base.h,
      editor.previewOutput,
      editor.previewTransform,
    );
    if (!start) return;
    editor.beginRegionDrag(id);
    regionDrag = {
      id,
      mode: (target.dataset.handle as RedactDrag | undefined) ?? "move",
      start,
      px: e.clientX,
      py: e.clientY,
    };
    try {
      // 캡처는 상자 자신에게 건다 — 레이어는 pointer-events가 none이다.
      el.setPointerCapture(e.pointerId);
    } catch {
      // 활성 포인터가 없으면(합성 이벤트 등) 캡처 없이 진행
    }
  }

  function shapeMove(e: PointerEvent) {
    const d = regionDrag;
    if (!d) return;
    editor.dragRegionTo(
      d.id,
      dragRegionRect(
        d.start,
        d.mode,
        (e.clientX - d.px) * toCanvasX,
        (e.clientY - d.py) * toCanvasY,
        editor.previewOutput,
      ),
    );
  }

  function shapeUp() {
    if (!regionDrag) return;
    regionDrag = null;
    editor.endRegionDrag();
  }

  // ── 새 사각형 드래그 (크롭·가리기 공용) ─────────────
  // 두 모드가 같은 몸짓을 쓰고 손을 뗄 때만 갈라진다. 레이어를 두 벌로 만들면
  // 클램프·좌표 환산이 두 곳에서 어긋난다.
  let cropStart: { x: number; y: number } | null = null;
  let cropView = $state<ViewRect | null>(null);
  const dragging = $derived(editor.cropMode || editor.redactMode);
  const dragHint = $derived(editor.cropMode ? t.panel.cropHint : t.panel.redactHint);

  // 모드를 떠나면 그리던 점선을 버린다 — Esc는 드래그 도중에도 들어온다.
  $effect(() => {
    if (dragging) return;
    cropStart = null;
    cropView = null;
  });

  /** 포인터를 그림 안으로 여민 좌표(레이어 = 그림 상자이므로 왼쪽 위가 원점이다). */
  function clampToCanvas(clientX: number, clientY: number) {
    const r = canvasEl.getBoundingClientRect();
    return {
      x: Math.min(Math.max(clientX, r.left), r.right) - r.left,
      y: Math.min(Math.max(clientY, r.top), r.bottom) - r.top,
    };
  }

  function cropDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cropStart = clampToCanvas(e.clientX, e.clientY);
    cropView = null;
  }

  function cropMove(e: PointerEvent) {
    if (!cropStart) return;
    const p = clampToCanvas(e.clientX, e.clientY);
    cropView = {
      x: Math.min(cropStart.x, p.x),
      y: Math.min(cropStart.y, p.y),
      w: Math.abs(p.x - cropStart.x),
      h: Math.abs(p.y - cropStart.y),
    };
  }

  function cropUp() {
    const view = cropView;
    const wasCrop = editor.cropMode;
    cropStart = null;
    cropView = null;
    // 그냥 클릭이면 모드 유지
    if (!view || view.w < 5 || view.h < 5) return;

    // 캔버스 픽셀 좌표로 옮긴다. 크롭 모드에서는 변형이 없어 그것이 곧 베이스 좌표이고,
    // 가리기 모드에서는 출력 좌표라 state가 베이스 좌표로 되돌려 저장한다.
    const x = Math.round(view.x * toCanvasX);
    const y = Math.round(view.y * toCanvasY);
    const w = Math.round(view.w * toCanvasX);
    const h = Math.round(view.h * toCanvasY);

    if (!wasCrop) {
      editor.addRegionFromOutput({ x, y, w, h });
      return; // 영역은 여러 개를 잇달아 그린다 — 모드를 유지한다
    }
    const rect = clampCrop(x, y, w, h);
    editor.cropMode = false;
    if (rect) editor.setCrop(rect);
  }

  function clampCrop(x: number, y: number, w: number, h: number): CropRect | null {
    const bw = editor.base.w;
    const bh = editor.base.h;
    const nx = Math.max(0, Math.min(x, bw - 1));
    const ny = Math.max(0, Math.min(y, bh - 1));
    const nw = Math.max(1, Math.min(w, bw - nx));
    const nh = Math.max(1, Math.min(h, bh - ny));
    if (nw < 4 || nh < 4) return null;
    return { x: nx, y: ny, w: nw, h: nh };
  }
</script>

<div class="preview">
  <div class="stagebox" bind:this={boxEl}>
    <canvas bind:this={canvasEl}></canvas>

    {#if dragging && paint}
      <div
        class="croplayer"
        role="application"
        aria-label={dragHint}
        style={`left:${paint.x}px; top:${paint.y}px; width:${paint.w}px; height:${paint.h}px`}
        onpointerdown={cropDown}
        onpointermove={cropMove}
        onpointerup={cropUp}
        onpointercancel={cropUp}
      >
        {#if cropView}
          <div
            class="croprect"
            style={`left:${cropView.x}px; top:${cropView.y}px; width:${cropView.w}px; height:${cropView.h}px`}
          ></div>
        {/if}
      </div>
    {/if}

    <!-- 가릴 영역의 윤곽. 그리기 레이어 **위에** 둔다 — 상자를 잡으면 옮기고,
         빈자리를 끌면 밑의 레이어가 새 영역을 만든다. -->
    {#if shapes.length && paint}
      <div
        class="shapelayer"
        class:live={shapesLive}
        role="application"
        aria-label={t.panel.redact}
        style={`left:${paint.x}px; top:${paint.y}px; width:${paint.w}px; height:${paint.h}px`}
        onpointerdown={shapeDown}
        onpointermove={shapeMove}
        onpointerup={shapeUp}
        onpointercancel={shapeUp}
      >
        {#each shapes as s (s.id)}
          <div
            class="rbox"
            class:active={s.id === editor.activeRegionId}
            data-region={s.id}
            title={s.label}
            style={`left:${s.view.x}px; top:${s.view.y}px; width:${s.view.w}px; height:${s.view.h}px`}
          >
            {#if shapesLive && s.id === editor.activeRegionId}
              {#each REDACT_HANDLES as h (h)}
                <div class="rhandle {h}" data-handle={h}></div>
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if dragging}
      <div class="crophint">{dragHint}</div>
    {/if}
  </div>

  <div class="transport">
    <button
      type="button"
      class="tbtn"
      onclick={() => editor.step(-1)}
      aria-label={t.player.prevFrame}
      title="{t.player.prevFrame} ({t.keys.step})"
      disabled={editor.cropMode}
    >
      <Icon name="stepBack" size={16} />
    </button>
    <button
      type="button"
      class="tbtn primary"
      onclick={() => editor.togglePlay()}
      aria-label={editor.playing ? t.player.pause : t.player.play}
      title="{editor.playing ? t.player.pause : t.player.play} ({t.keys.play})"
      disabled={editor.cropMode}
    >
      <Icon name={editor.playing ? "pause" : "play"} size={16} />
    </button>
    <button
      type="button"
      class="tbtn"
      onclick={() => editor.step(1)}
      aria-label={t.player.nextFrame}
      title="{t.player.nextFrame} ({t.keys.step})"
      disabled={editor.cropMode}
    >
      <Icon name="stepForward" size={16} />
    </button>
    <span class="counter">
      {t.player.frameOf(Math.min(editor.current + 1, editor.frames.length), editor.frames.length)}
    </span>
  </div>
</div>

<style>
  .preview {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .stagebox {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    padding: 12px;
  }

  canvas {
    max-width: 100%;
    max-height: 100%;
    /* 투명 픽셀 확인용 체커보드 */
    background: conic-gradient(
        var(--surface-2) 25%,
        transparent 0 50%,
        var(--surface-2) 0 75%,
        transparent 0
      )
      0 0 / 16px 16px;
    box-shadow: var(--shadow-1);
  }

  .croplayer {
    position: absolute;
    cursor: crosshair;
    touch-action: none;
  }
  .croprect {
    position: absolute;
    border: 1.5px dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    pointer-events: none;
  }

  /* 레이어는 뚫려 있고 상자만 포인터를 받는다 — 빈자리를 끌면 밑에서 새 영역이 만들어진다. */
  .shapelayer {
    position: absolute;
    pointer-events: none;
    touch-action: none;
  }
  .rbox {
    position: absolute;
    box-sizing: border-box;
    border: 1px dashed var(--text-muted);
  }
  .shapelayer.live .rbox {
    pointer-events: auto;
    cursor: move;
  }
  .rbox.active {
    border: 1.5px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .rhandle {
    position: absolute;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 2px solid var(--accent);
    background: var(--surface);
  }
  /* 손가락·마우스 모두 잡기 쉽게 히트 영역만 넓힌다(그림은 10px 그대로). */
  .rhandle::before {
    content: "";
    position: absolute;
    inset: -7px;
  }
  .rhandle.nw,
  .rhandle.w,
  .rhandle.sw {
    left: -5px;
  }
  .rhandle.n,
  .rhandle.s {
    left: calc(50% - 5px);
  }
  .rhandle.ne,
  .rhandle.e,
  .rhandle.se {
    right: -5px;
  }
  .rhandle.nw,
  .rhandle.n,
  .rhandle.ne {
    top: -5px;
  }
  .rhandle.w,
  .rhandle.e {
    top: calc(50% - 5px);
  }
  .rhandle.sw,
  .rhandle.s,
  .rhandle.se {
    bottom: -5px;
  }
  .rhandle.nw,
  .rhandle.se {
    cursor: nwse-resize;
  }
  .rhandle.ne,
  .rhandle.sw {
    cursor: nesw-resize;
  }
  .rhandle.n,
  .rhandle.s {
    cursor: ns-resize;
  }
  .rhandle.w,
  .rhandle.e {
    cursor: ew-resize;
  }
  .crophint {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-md);
    pointer-events: none;
    white-space: nowrap;
  }

  .transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .tbtn {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--surface);
    color: var(--text);
  }
  .tbtn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .tbtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tbtn.primary {
    width: 40px;
    height: 40px;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .tbtn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .counter {
    min-width: 64px;
    text-align: center;
    font-size: var(--text-md);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
