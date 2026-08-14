<script lang="ts">
  import { fmtTime, t } from "../i18n";
  import { drawTimelineStrip } from "../video/thumbs";
  import { editor } from "./state.svelte";

  const STRIP_H = 56;

  let container: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);

  // ── 썸네일 스트립 생성 (파일 교체·리사이즈 시 재생성) ──
  let gen = 0;
  let redrawTimer = 0;

  function draw() {
    const file = editor.file;
    if (!file || !canvas || width < 8) return;
    const my = ++gen;
    void drawTimelineStrip(file, canvas, width, STRIP_H, () => my === gen && editor.file === file);
  }

  $effect(() => {
    void editor.file;
    void width;
    clearTimeout(redrawTimer);
    redrawTimer = window.setTimeout(draw, 150);
    return () => clearTimeout(redrawTimer);
  });

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      width = entries[0].contentRect.width;
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  // ── 위치 계산 ─────────────────────────────────────
  const startPct = $derived(editor.duration ? (editor.trimStart / editor.duration) * 100 : 0);
  const endPct = $derived(editor.duration ? (editor.trimEnd / editor.duration) * 100 : 100);
  const playPct = $derived(
    editor.duration ? Math.min(100, (editor.currentTime / editor.duration) * 100) : 0,
  );
  /** 무손실 모드에서만 키프레임 눈금 표시 (너무 많으면 생략). */
  const keyframeTicks = $derived(
    editor.cutMode === "lossless" && editor.duration && editor.keyframes.length <= 500
      ? editor.keyframes.map((k) => (k / editor.duration) * 100)
      : [],
  );

  // ── 드래그 (핸들 2개 + 빈 곳 클릭·드래그 = 탐색) ──
  type DragMode = "start" | "end" | "seek";
  let drag: DragMode | null = null;

  function timeAt(clientX: number): number {
    if (!container) return 0;
    const r = container.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return ratio * editor.duration;
  }
  function apply(e: PointerEvent) {
    const tS = timeAt(e.clientX);
    if (drag === "start") {
      editor.setTrimStart(tS);
      editor.seek(editor.trimStart); // 드래그하는 지점의 프레임을 바로 보여준다
    } else if (drag === "end") {
      editor.setTrimEnd(tS);
      editor.seek(editor.trimEnd);
    } else if (drag === "seek") {
      editor.seek(tS);
    }
  }
  function down(e: PointerEvent, mode: DragMode) {
    e.preventDefault();
    if (mode !== "seek") e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = mode;
    apply(e);
  }
  function move(e: PointerEvent) {
    if (drag) apply(e);
  }
  function up() {
    drag = null;
  }

  /** 핸들에 포커스가 있을 때의 조절 — 보폭은 전역 단축키와 같다(한 프레임 / Shift는 1초). */
  function handleKey(e: KeyboardEvent, which: "start" | "end") {
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation(); // 전역 단축키의 탐색과 겹치지 않게
    const step = (e.shiftKey ? 1 : editor.frameStep) * dir;
    if (which === "start") editor.setTrimStart(editor.trimStart + step);
    else editor.setTrimEnd(editor.trimEnd + step);
  }
</script>

<div
  class="timeline"
  bind:this={container}
  role="application"
  aria-label={t.panel.trim}
  onpointerdown={(e) => down(e, "seek")}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  <canvas bind:this={canvas} class="strip" style="height: {STRIP_H}px"></canvas>
  {#each keyframeTicks as pct (pct)}
    <div class="kf" style="left: {pct}%"></div>
  {/each}
  <div class="shade" style="left: 0; width: {startPct}%"></div>
  <div class="shade" style="left: {endPct}%; width: {100 - endPct}%"></div>
  <div class="range" style="left: {startPct}%; width: {endPct - startPct}%"></div>
  <div class="playhead" style="left: {playPct}%"></div>
  <div
    class="handle"
    role="slider"
    tabindex="0"
    aria-label={t.panel.trimStart}
    aria-valuemin={0}
    aria-valuemax={editor.duration}
    aria-valuenow={editor.trimStart}
    aria-valuetext={fmtTime(editor.trimStart)}
    style="left: {startPct}%"
    onpointerdown={(e) => down(e, "start")}
    onkeydown={(e) => handleKey(e, "start")}
  ></div>
  <div
    class="handle"
    role="slider"
    tabindex="0"
    aria-label={t.panel.trimEnd}
    aria-valuemin={0}
    aria-valuemax={editor.duration}
    aria-valuenow={editor.trimEnd}
    aria-valuetext={fmtTime(editor.trimEnd)}
    style="left: {endPct}%"
    onpointerdown={(e) => down(e, "end")}
    onkeydown={(e) => handleKey(e, "end")}
  ></div>
</div>

<style>
  .timeline {
    position: relative;
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
    touch-action: none;
    cursor: crosshair;
  }
  .strip {
    display: block;
    width: 100%;
    background: var(--surface-2);
  }
  .shade {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--bg) 65%, transparent);
    pointer-events: none;
  }
  .kf {
    position: absolute;
    top: 0;
    height: 10px;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    opacity: 0.9;
    pointer-events: none;
  }
  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    border: 2px solid var(--accent);
    border-left: 0;
    border-right: 0;
    pointer-events: none;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    opacity: 0.8;
    pointer-events: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 12px;
    margin-left: -6px;
    cursor: ew-resize;
    background: var(--accent);
    border-radius: 3px;
    opacity: 0.95;
  }
  .handle::after {
    content: "";
    position: absolute;
    inset: 14px 4px;
    border-radius: 2px;
    background: var(--accent-contrast);
    opacity: 0.85;
  }
  .handle:hover,
  .handle:focus-visible {
    background: var(--accent-hover);
  }
</style>
