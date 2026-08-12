<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { zipSync } from "fflate";
  import { editor } from "./state.svelte";
  import { effectiveSize, processItem, targetSize } from "../image/pipeline";
  import { readExifDisplay, type ExifDisplay } from "../image/exif";
  import { downloadBlob, formatBytes } from "../image/save";
  import {
    OUTPUT_EXT,
    supportsExifKeep,
    type OutputFormat,
    type ResizeMode,
  } from "../image/types";

  const FORMAT_LABELS: Record<OutputFormat, string> = {
    jpeg: "JPG",
    png: "PNG",
    webp: "WebP",
    avif: "AVIF",
  };

  const RESIZE_MODES: { id: ResizeMode; label: string }[] = [
    { id: "none", label: t.panel.sizeOriginal },
    { id: "scale", label: t.panel.sizeScale },
    { id: "width", label: t.panel.sizeWidth },
    { id: "height", label: t.panel.sizeHeight },
  ];

  const CROP_RATIOS: { label: string; value: number | null }[] = [
    { label: t.edit.ratioFree, value: null },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "16:9", value: 16 / 9 },
  ];

  let filename = $state("");
  let status = $state("");

  const ext = $derived(OUTPUT_EXT[editor.format]);
  const multiple = $derived(editor.items.length > 1);
  const nameFallback = $derived(
    multiple ? "images" : baseName(editor.items[0]?.name ?? "image"),
  );
  const outDims = $derived.by(() => {
    const item = editor.currentItem;
    if (!item) return null;
    const eff = effectiveSize(item);
    return { eff, ...targetSize(eff.w, eff.h, editor.resizeSpec) };
  });
  const currentCrop = $derived(editor.currentItem?.transform.crop ?? null);
  const currentEdited = $derived.by(() => {
    const tf = editor.currentItem?.transform;
    return !!tf && (tf.rotation !== 0 || tf.crop !== null);
  });

  // ── EXIF 표시 (장별 캐시) ─────────────────────────
  const exifCache = new Map<string, ExifDisplay | null>();
  let exifInfo = $state<ExifDisplay | null>(null);
  let exifLoading = $state(false);
  $effect(() => {
    const item = editor.currentItem;
    if (!item) {
      exifInfo = null;
      return;
    }
    const cached = exifCache.get(item.id);
    if (cached !== undefined) {
      exifInfo = cached;
      return;
    }
    let cancelled = false;
    exifLoading = true;
    exifInfo = null;
    void readExifDisplay(item).then((info) => {
      if (cancelled) return;
      exifCache.set(item.id, info);
      exifInfo = info;
      exifLoading = false;
    });
    return () => {
      cancelled = true;
      exifLoading = false;
    };
  });

  function baseName(name: string): string {
    return name.replace(/\.[^.]+$/, "");
  }

  function cleanName(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || nameFallback;
  }

  function activateMode(mode: ResizeMode) {
    const item = editor.currentItem;
    const eff = item ? effectiveSize(item) : null;
    if (mode === "none") editor.setResizeNone();
    else if (mode === "scale") editor.setResizeScale(editor.resizeScale);
    else if (mode === "width") editor.setResizeWidth(eff?.w ?? editor.resizeWidth);
    else editor.setResizeHeight(eff?.h ?? editor.resizeHeight);
  }

  function toggleCropMode() {
    if (editor.cropMode) editor.cancelCrop();
    else editor.startCrop();
  }
  function onKeepExifChange(e: Event) {
    editor.setKeepExif((e.target as HTMLInputElement).checked);
  }

  function onQualityInput(e: Event) {
    editor.setQuality(Number((e.target as HTMLInputElement).value));
  }
  function onScaleChange(e: Event) {
    editor.setResizeScale(Number((e.target as HTMLInputElement).value));
  }
  function onWidthChange(e: Event) {
    editor.setResizeWidth(Number((e.target as HTMLInputElement).value));
  }
  function onHeightChange(e: Event) {
    editor.setResizeHeight(Number((e.target as HTMLInputElement).value));
  }

  // ── 저장: 한 장 = 파일, 여러 장 = ZIP 한 개 ────────
  async function saveAll() {
    const items = editor.items;
    if (!items.length || editor.busy) return;
    editor.error = "";
    status = "";
    editor.busy = true;
    try {
      const settings = editor.settings;
      if (items.length === 1) {
        editor.busyMsg = t.panel.converting(items[0].name, 1, 1);
        const r = await processItem(items[0], settings);
        downloadBlob(r.blob, `${cleanName()}.${ext}`);
        status = t.panel.savedOne(formatBytes(r.blob.size));
      } else {
        const files: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        let total = 0;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          editor.busyMsg = t.panel.converting(item.name, i + 1, items.length);
          const r = await processItem(item, settings);
          files[uniqueName(used, baseName(item.name))] = new Uint8Array(
            await r.blob.arrayBuffer(),
          );
          total += r.blob.size;
        }
        editor.busyMsg = t.panel.zipping;
        // 이미지 포맷은 이미 압축돼 있으므로 저장(무압축) 모드로 빠르게 묶음.
        const zipped = zipSync(files, { level: 0 });
        const buf = new Uint8Array(zipped.byteLength);
        buf.set(zipped);
        downloadBlob(new Blob([buf], { type: "application/zip" }), `${cleanName()}.zip`);
        status = t.panel.savedZip(items.length, formatBytes(total));
      }
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
    }
  }

  function uniqueName(used: Set<string>, base: string): string {
    let name = `${base}.${ext}`;
    let i = 1;
    while (used.has(name)) name = `${base} (${i++}).${ext}`;
    used.add(name);
    return name;
  }
</script>

<aside class="panel">
  <!-- 형식 -->
  <section class="sec">
    <h3>{t.panel.format}</h3>
    <div class="chips" role="group" aria-label={t.panel.format}>
      {#each Object.entries(FORMAT_LABELS) as [id, label] (id)}
        <button
          type="button"
          class="chip"
          class:active={editor.format === id}
          onclick={() => editor.setFormat(id as OutputFormat)}
        >
          {label}
        </button>
      {/each}
    </div>
  </section>

  <!-- 품질 -->
  <section class="sec">
    <h3>{t.panel.quality}</h3>
    {#if editor.format === "png"}
      <p class="info">{t.panel.qualityPngNote}</p>
    {:else}
      <div class="row">
        <input
          class="slider"
          type="range"
          min="1"
          max="100"
          step="1"
          value={editor.quality}
          oninput={onQualityInput}
          aria-label={t.panel.quality}
        />
        <input
          class="num"
          type="number"
          min="1"
          max="100"
          step="1"
          value={editor.quality}
          onchange={onQualityInput}
          aria-label={t.panel.quality}
        />
      </div>
    {/if}
  </section>

  <!-- 크기 -->
  <section class="sec">
    <h3>{t.panel.size}</h3>
    <div class="chips">
      {#each RESIZE_MODES as m (m.id)}
        <button
          type="button"
          class="chip"
          class:active={editor.resizeMode === m.id}
          onclick={() => activateMode(m.id)}
        >
          {m.label}
        </button>
      {/each}
    </div>
    {#if editor.resizeMode === "scale"}
      <div class="row">
        <label class="lbl" for="resize-scale">{t.panel.sizeScale}({t.panel.scaleUnit})</label>
        <input
          id="resize-scale"
          class="num"
          type="number"
          min="1"
          max="400"
          step="1"
          value={editor.resizeScale}
          onchange={onScaleChange}
        />
      </div>
    {:else if editor.resizeMode === "width"}
      <div class="row">
        <label class="lbl" for="resize-width">{t.panel.sizeWidth}({t.panel.pxUnit})</label>
        <input
          id="resize-width"
          class="num"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeWidth}
          onchange={onWidthChange}
        />
      </div>
    {:else if editor.resizeMode === "height"}
      <div class="row">
        <label class="lbl" for="resize-height">{t.panel.sizeHeight}({t.panel.pxUnit})</label>
        <input
          id="resize-height"
          class="num"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeHeight}
          onchange={onHeightChange}
        />
      </div>
    {/if}
    {#if outDims}
      <p class="info">
        {t.panel.sizeInfo(outDims.eff.w, outDims.eff.h, outDims.w, outDims.h)}
      </p>
    {/if}
  </section>

  <!-- 선택한 장 (크롭·회전) -->
  <section class="sec">
    <h3>{t.edit.title}</h3>
    <div class="row wrap">
      <button
        type="button"
        class="btn small"
        class:active={editor.cropMode}
        onclick={toggleCropMode}
      >
        <Icon name="crop" size={14} />
        {editor.cropMode ? t.edit.cropCancel : t.edit.cropStart}
      </button>
      <button type="button" class="btn small" onclick={() => editor.rotateCurrent()}>
        <Icon name="rotate" size={14} /> {t.edit.rotate}
      </button>
    </div>
    {#if editor.cropMode}
      <div class="chips">
        {#each CROP_RATIOS as r (r.label)}
          <button
            type="button"
            class="chip"
            class:active={editor.cropRatio === r.value}
            onclick={() => editor.setCropRatio(r.value)}
          >
            {r.label}
          </button>
        {/each}
      </div>
    {/if}
    {#if currentCrop}
      <div class="row">
        <p class="info grow">{t.edit.cropRect(currentCrop.w, currentCrop.h)}</p>
        <button type="button" class="btn small" onclick={() => editor.setCurrentCrop(null)}>
          {t.edit.cropClear}
        </button>
      </div>
    {/if}
    {#if currentEdited}
      <button type="button" class="btn small ghost" onclick={() => editor.resetCurrentEdit()}>
        {t.edit.reset}
      </button>
    {/if}
  </section>

  <!-- EXIF -->
  <section class="sec">
    <h3>{t.exif.title}</h3>
    {#if exifLoading}
      <p class="info">{t.exif.loading}</p>
    {:else if exifInfo}
      <dl class="kv">
        {#if exifInfo.date}<dt>{t.exif.date}</dt><dd>{exifInfo.date}</dd>{/if}
        {#if exifInfo.camera}<dt>{t.exif.camera}</dt><dd>{exifInfo.camera}</dd>{/if}
        {#if exifInfo.exposure}<dt>{t.exif.exposure}</dt><dd>{exifInfo.exposure}</dd>{/if}
        {#if exifInfo.gps}<dt>{t.exif.gps}</dt><dd>{exifInfo.gps}</dd>{/if}
      </dl>
    {:else}
      <p class="info">{t.exif.none}</p>
    {/if}
    <label class="row checkrow">
      <input
        type="checkbox"
        checked={editor.keepExif}
        disabled={!supportsExifKeep(editor.format)}
        onchange={onKeepExifChange}
      />
      <span class="lbl">{t.exif.keep}</span>
    </label>
    {#if !supportsExifKeep(editor.format)}
      <p class="info">{t.exif.keepUnsupportedNote}</p>
    {/if}
  </section>

  <!-- 내보내기 -->
  <section class="sec">
    <h3>{t.panel.export}</h3>
    <span class="namefield">
      <input
        class="fname"
        bind:value={filename}
        placeholder={nameFallback}
        aria-label={t.panel.fileName}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="ext">.{multiple ? "zip" : ext}</span>
    </span>

    <button
      type="button"
      class="btn primary"
      onclick={saveAll}
      disabled={editor.busy || editor.items.length === 0}
    >
      <Icon name="download" size={15} /> {t.panel.save}
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
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .chip:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }
  .chip.active {
    background: var(--accent-weak);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent-ink);
  }

  .lbl {
    font-size: var(--text-md);
    color: var(--text-muted);
    flex: 1;
  }
  .slider {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .num {
    width: 76px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-base);
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .num:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
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
    font-size: var(--text-base);
    padding: 7px 8px;
    flex: 1;
    min-width: 0;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: var(--text-md);
    color: var(--text-muted);
  }

  .status {
    margin: 0;
    font-size: var(--text-md);
    color: var(--text-muted);
  }

  .info.grow {
    flex: 1;
  }

  .kv {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    font-size: var(--text-sm);
  }
  .kv dt {
    color: var(--text-muted);
  }
  .kv dd {
    margin: 0;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .checkrow {
    cursor: pointer;
  }
  .checkrow input {
    accent-color: var(--accent);
  }

  @media (max-width: 760px) {
    .panel {
      width: auto;
      overflow-y: visible;
    }
  }
</style>
