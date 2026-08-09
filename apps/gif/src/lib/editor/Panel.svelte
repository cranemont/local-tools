<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { zipSync } from "fflate";
  import {
    editor,
    SPEED_CHIPS,
    SCALE_CHIPS,
    MIN_DELAY_MS,
    MAX_DELAY_MS,
    GIF_COLOR_CHOICES,
    QUALITY_PRESETS,
    type PresetId,
  } from "./state.svelte";
  import { encodeGif, type RenderPlan } from "../gif/encode";
  import { encodeWebp } from "../gif/webp";
  import { encodeMp4 } from "../gif/mp4";
  import { extractPngFrames } from "../gif/extract";
  import { downloadBlob, formatBytes } from "../gif/save";

  const PRESET_LABELS: Record<PresetId, string> = {
    small: t.panel.presetSmall,
    balanced: t.panel.presetBalanced,
    high: t.panel.presetHigh,
  };

  let filename = $state("animation");
  let delayInput = $state(100);
  let result = $state<{ blob: Blob; revision: number } | null>(null);
  let status = $state("");

  const stale = $derived(result !== null && result.revision !== editor.revision);
  const FORMAT_LABELS = { gif: "GIF", webp: "WebP", mp4: "MP4" } as const;
  const fmtLabel = $derived(FORMAT_LABELS[editor.exportFormat]);
  const ext = $derived(editor.exportFormat);

  function cleanName(fallback: string): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || fallback;
  }

  function plan(): RenderPlan {
    return {
      frames: editor.frames,
      sources: editor.sources,
      transform: $state.snapshot(editor.transform),
      baseW: editor.base.w,
      baseH: editor.base.h,
    };
  }

  // ── 인코딩 → 용량 확인 → 저장 ─────────────────────
  async function make() {
    if (!editor.frames.length || editor.busy) return;
    editor.playing = false;
    editor.error = "";
    status = "";
    editor.busy = true;
    editor.busyMsg = t.panel.encoding(0, editor.frames.length);
    const revision = editor.revision;
    const onProgress = (done: number, total: number) =>
      (editor.busyMsg = t.panel.encoding(done, total));
    try {
      let blob: Blob;
      if (editor.exportFormat === "gif") {
        blob = await encodeGif({
          ...plan(),
          speed: editor.speed,
          repeat: editor.repeat,
          maxColors: editor.gifColors,
          dither: editor.gifDither,
          onProgress,
        });
      } else if (editor.exportFormat === "webp") {
        blob = await encodeWebp({
          ...plan(),
          speed: editor.speed,
          loop: editor.webpLoop,
          quality: editor.webpQuality,
          onProgress,
        });
      } else {
        blob = await encodeMp4({
          ...plan(),
          speed: editor.speed,
          quality: editor.mp4Quality,
          onProgress,
        });
      }
      result = { blob, revision };
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
    }
  }

  function saveResult() {
    if (!result) return;
    downloadBlob(result.blob, `${cleanName("animation")}.${ext}`);
  }

  // ── 프레임 PNG 추출 (여러 장이면 ZIP 한 개) ────────
  async function extract() {
    if (!editor.frames.length || editor.busy) return;
    editor.playing = false;
    editor.error = "";
    status = "";
    editor.busy = true;
    try {
      const pngs = await extractPngFrames(plan(), (done, total) => {
        editor.busyMsg = t.panel.extracting(done, total);
      });
      if (pngs.length === 1) {
        downloadBlob(
          new Blob([pngs[0].bytes], { type: "image/png" }),
          `${cleanName("frames")}.png`,
        );
        status = t.panel.savedPng;
      } else {
        editor.busyMsg = t.panel.zipping;
        const files: Record<string, Uint8Array> = {};
        for (const p of pngs) files[p.name] = p.bytes;
        // PNG는 이미 압축돼 있으므로 저장(무압축) 모드로 빠르게 묶음.
        const zipped = zipSync(files, { level: 0 });
        const buf = new Uint8Array(zipped.byteLength);
        buf.set(zipped);
        downloadBlob(
          new Blob([buf], { type: "application/zip" }),
          `${cleanName("frames")}.zip`,
        );
        status = t.panel.savedZip(pngs.length);
      }
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
    }
  }

  // ── 입력 핸들러 ───────────────────────────────────
  function onDelayInput(e: Event) {
    delayInput = Number((e.target as HTMLInputElement).value);
  }
  function onWidthChange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < 8) return;
    editor.setScale(v / editor.unscaledOutput.w);
  }
  function onLoopCountChange(e: Event) {
    editor.setLoopCount(Number((e.target as HTMLInputElement).value));
  }
  function onColorsChange(e: Event) {
    editor.setGifColors(Number((e.target as HTMLSelectElement).value));
  }
  function onDitherChange(e: Event) {
    editor.setGifDither((e.target as HTMLInputElement).checked);
  }
  function onWebpQualityChange(e: Event) {
    editor.setWebpQuality(Number((e.target as HTMLInputElement).value));
  }
  function toggleCropMode() {
    editor.playing = false;
    editor.cropMode = !editor.cropMode;
  }
</script>

<aside class="panel">
  <!-- 속도 -->
  <section class="sec">
    <h3>{t.panel.speed}</h3>
    <div class="chips">
      {#each SPEED_CHIPS as x (x)}
        <button
          type="button"
          class="chip"
          class:active={editor.speed === x}
          onclick={() => editor.setSpeed(x)}
        >
          {t.panel.speedChip(x)}
        </button>
      {/each}
    </div>
    <div class="row">
      <label class="lbl" for="delay-input">{t.panel.delayLabel}</label>
      <input
        id="delay-input"
        class="num"
        type="number"
        min={MIN_DELAY_MS}
        max={MAX_DELAY_MS}
        step="10"
        value={delayInput}
        oninput={onDelayInput}
      />
    </div>
    <div class="row">
      <button
        type="button"
        class="btn small"
        onclick={() => editor.setDelay(delayInput, true)}
        disabled={editor.selectedCount === 0}
      >
        {t.panel.delayApplySelected}
      </button>
      <button
        type="button"
        class="btn small"
        onclick={() => editor.setDelay(delayInput, false)}
      >
        {t.panel.delayApplyAll}
      </button>
    </div>
  </section>

  <!-- 크기 -->
  <section class="sec">
    <h3>{t.panel.size}</h3>
    <p class="info">
      {t.panel.originalSize(editor.base.w, editor.base.h)} ·
      {t.panel.outputSize(editor.output.w, editor.output.h)}
    </p>
    <div class="chips">
      {#each SCALE_CHIPS as pct (pct)}
        <button
          type="button"
          class="chip"
          class:active={Math.round(editor.transform.scale * 100) === pct}
          onclick={() => editor.setScale(pct / 100)}
        >
          {t.panel.scaleChip(pct)}
        </button>
      {/each}
    </div>
    <div class="row">
      <label class="lbl" for="width-input">{t.panel.widthLabel}</label>
      <input
        id="width-input"
        class="num"
        type="number"
        min="8"
        step="1"
        value={editor.output.w}
        onchange={onWidthChange}
      />
    </div>
  </section>

  <!-- 크롭 -->
  <section class="sec">
    <h3>{t.panel.crop}</h3>
    <div class="row">
      <button
        type="button"
        class="btn small"
        class:active={editor.cropMode}
        onclick={toggleCropMode}
      >
        <Icon name="crop" size={14} />
        {editor.cropMode ? t.panel.cropCancel : t.panel.cropStart}
      </button>
      {#if editor.transform.crop}
        <button type="button" class="btn small" onclick={() => editor.setCrop(null)}>
          {t.panel.cropClear}
        </button>
      {/if}
    </div>
    {#if editor.transform.crop}
      <p class="info">
        {t.panel.cropRect(editor.transform.crop.w, editor.transform.crop.h)}
      </p>
    {/if}
  </section>

  <!-- 회전·뒤집기 -->
  <section class="sec">
    <h3>{t.panel.rotateFlip}</h3>
    <div class="row wrap">
      <button type="button" class="btn small" onclick={() => editor.rotate90()}>
        <Icon name="rotate" size={14} /> {t.panel.rotate}
      </button>
      <button
        type="button"
        class="btn small"
        class:active={editor.transform.flipH}
        onclick={() => editor.toggleFlipH()}
      >
        <Icon name="flipH" size={14} /> {t.panel.flipH}
      </button>
      <button
        type="button"
        class="btn small"
        class:active={editor.transform.flipV}
        onclick={() => editor.toggleFlipV()}
      >
        <Icon name="flipV" size={14} /> {t.panel.flipV}
      </button>
      <button type="button" class="btn small ghost" onclick={() => editor.resetTransform()}>
        {t.panel.resetTransform}
      </button>
    </div>
  </section>

  <!-- 반복 -->
  <section class="sec">
    <h3>{t.panel.loop}</h3>
    <div class="row">
      <button
        type="button"
        class="chip"
        class:active={editor.loopForever}
        onclick={() => editor.setLoopForever(true)}
      >
        {t.panel.loopForever}
      </button>
      <button
        type="button"
        class="chip"
        class:active={!editor.loopForever}
        onclick={() => editor.setLoopForever(false)}
      >
        {t.panel.loopCount}
      </button>
      {#if !editor.loopForever}
        <input
          class="num"
          type="number"
          min="1"
          max="100"
          step="1"
          value={editor.loopCount}
          onchange={onLoopCountChange}
          aria-label={t.panel.loopCount}
        />
      {/if}
    </div>
  </section>

  <!-- 화질 -->
  <section class="sec">
    <h3>{t.panel.quality}</h3>
    <div class="chips">
      {#each QUALITY_PRESETS as p (p.id)}
        <button
          type="button"
          class="chip"
          class:active={editor.activePreset === p.id}
          onclick={() => editor.applyPreset(p.id)}
        >
          {PRESET_LABELS[p.id]}
        </button>
      {/each}
    </div>
    {#if editor.exportFormat !== "mp4"}
    <details class="adv">
      <summary>{t.panel.advanced}</summary>
      {#if editor.exportFormat === "gif"}
        <div class="row">
          <label class="lbl" for="colors-select">{t.panel.colors}</label>
          <select
            id="colors-select"
            class="num"
            value={String(editor.gifColors)}
            onchange={onColorsChange}
          >
            {#each GIF_COLOR_CHOICES as c (c)}
              <option value={String(c)}>{c}</option>
            {/each}
          </select>
        </div>
        <label class="row checkrow">
          <input type="checkbox" checked={editor.gifDither} onchange={onDitherChange} />
          <span class="lbl">{t.panel.dither}</span>
        </label>
      {:else}
        <div class="row">
          <label class="lbl" for="webp-quality">{t.panel.webpQuality}</label>
          <input
            id="webp-quality"
            class="num"
            type="number"
            min="1"
            max="100"
            step="1"
            value={editor.webpQuality}
            onchange={onWebpQualityChange}
          />
        </div>
      {/if}
    </details>
    {/if}
  </section>

  <!-- 내보내기 -->
  <section class="sec">
    <h3>{t.panel.export}</h3>
    <div class="chips" role="group" aria-label={t.panel.format}>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "gif"}
        onclick={() => editor.setExportFormat("gif")}
      >
        GIF
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "webp"}
        onclick={() => editor.setExportFormat("webp")}
      >
        WebP
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "mp4"}
        onclick={() => editor.setExportFormat("mp4")}
      >
        MP4
      </button>
    </div>
    <span class="namefield">
      <input
        class="fname"
        bind:value={filename}
        aria-label={t.panel.fileName}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="ext">.{ext}</span>
    </span>

    <button
      type="button"
      class="btn primary"
      onclick={make}
      disabled={editor.busy || editor.frames.length === 0}
    >
      <Icon name="film" size={15} />
      {result ? t.panel.reEncode : t.panel.encodeAction(fmtLabel)}
    </button>

    {#if result}
      <div class="result" class:stale>
        <p class="result-size">{t.panel.resultReady(formatBytes(result.blob.size))}</p>
        {#if stale}
          <p class="result-note">{t.panel.resultStale}</p>
        {/if}
        <button type="button" class="btn primary" onclick={saveResult} disabled={stale}>
          <Icon name="download" size={15} /> {t.panel.download}
        </button>
      </div>
    {/if}

    <button
      type="button"
      class="btn"
      onclick={extract}
      disabled={editor.busy || editor.frames.length === 0}
    >
      <Icon name="image" size={15} /> {t.panel.extractPng}
    </button>

    {#if status}
      <p class="status">{status}</p>
    {/if}
  </section>
</aside>

<style>
  .panel {
    width: 264px;
    flex: none;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sec {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .sec h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row.wrap {
    flex-wrap: wrap;
  }

  .info {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }
  .chip:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }
  .chip.active {
    background: var(--accent-weak);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
  }

  .lbl {
    font-size: 12.5px;
    color: var(--text-muted);
    flex: 1;
  }
  .num {
    width: 76px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .num:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }
  .btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.small {
    padding: 6px 10px;
    font-size: 12.5px;
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-muted);
    font-weight: 500;
  }
  .btn.ghost:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
    border-color: transparent;
  }
  .btn.active {
    background: var(--accent-weak);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .namefield {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    padding-right: 8px;
  }
  .namefield:focus-within {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .fname {
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    padding: 7px 8px;
    flex: 1;
    min-width: 0;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--accent-weak);
  }
  .result.stale {
    border-color: var(--border);
    background: var(--surface-2);
  }
  .result-size {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }
  .result-note {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .status {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .adv summary {
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text-muted);
    user-select: none;
  }
  .adv[open] summary {
    margin-bottom: 8px;
  }
  .adv {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .checkrow {
    cursor: pointer;
  }
  .checkrow input {
    accent-color: var(--accent);
  }
</style>
