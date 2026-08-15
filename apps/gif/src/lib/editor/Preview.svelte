<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import { getFrameBitmap } from "../gif/decode";
  import { effectiveDelayMs } from "../gif/timing";
  import { outputSize, renderFrame } from "../gif/transform";
  import type { CropRect, Transform } from "../gif/types";

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
    // 크롭 모드에서는 변형 없는 베이스 프레임 위에서 남길 영역을 고른다.
    // 가릴 영역은 그때도 그대로 들고 간다 — 좌표가 베이스 기준이라 자리가 맞고,
    // 가리는 중에 원본이 드러나지 않는다.
    const tf: Transform = editor.cropMode
      ? {
          crop: null,
          rotation: 0,
          flipH: false,
          flipV: false,
          scale: 1,
          redact: editor.transform.redact,
        }
      : editor.transform;
    const { w, h } = outputSize(baseW, baseH, tf);
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

  // ── 사각형 드래그 (크롭·가리기 공용) ───────────────
  // 두 모드가 같은 몸짓을 쓰고 손을 뗄 때만 갈라진다. 레이어를 두 벌로 만들면
  // 클램프·좌표 환산이 두 곳에서 어긋난다.
  interface ViewRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
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

  function clampToCanvas(clientX: number, clientY: number) {
    const r = canvasEl.getBoundingClientRect();
    return {
      x: Math.min(Math.max(clientX, r.left), r.right),
      y: Math.min(Math.max(clientY, r.top), r.bottom),
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
    const box = boxEl.getBoundingClientRect();
    cropView = {
      x: Math.min(cropStart.x, p.x) - box.left,
      y: Math.min(cropStart.y, p.y) - box.top,
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
    const box = boxEl.getBoundingClientRect();
    const r = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / r.width;
    const scaleY = canvasEl.height / r.height;
    const x = Math.round((view.x + box.left - r.left) * scaleX);
    const y = Math.round((view.y + box.top - r.top) * scaleY);
    const w = Math.round(view.w * scaleX);
    const h = Math.round(view.h * scaleY);

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

    {#if dragging}
      <div
        class="croplayer"
        role="application"
        aria-label={dragHint}
        onpointerdown={cropDown}
        onpointermove={cropMove}
        onpointerup={cropUp}
      >
        {#if cropView}
          <div
            class="croprect"
            style={`left:${cropView.x}px; top:${cropView.y}px; width:${cropView.w}px; height:${cropView.h}px`}
          ></div>
        {/if}
        <div class="crophint">{dragHint}</div>
      </div>
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
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .croprect {
    position: absolute;
    border: 1.5px dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    pointer-events: none;
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
