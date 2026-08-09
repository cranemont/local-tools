<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { zipSync } from "fflate";
  import { editor } from "./state.svelte";
  import { processItem, targetSize } from "../image/pipeline";
  import { downloadBlob, formatBytes } from "../image/save";
  import { OUTPUT_EXT, type OutputFormat, type ResizeMode } from "../image/types";

  const FORMAT_LABELS: Record<OutputFormat, string> = {
    jpeg: "JPG",
    png: "PNG",
    webp: "WebP",
  };

  const RESIZE_MODES: { id: ResizeMode; label: string }[] = [
    { id: "none", label: t.panel.sizeOriginal },
    { id: "scale", label: t.panel.sizeScale },
    { id: "width", label: t.panel.sizeWidth },
    { id: "height", label: t.panel.sizeHeight },
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
    return { item, ...targetSize(item.width, item.height, editor.resizeSpec) };
  });

  function baseName(name: string): string {
    return name.replace(/\.[^.]+$/, "");
  }

  function cleanName(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || nameFallback;
  }

  function activateMode(mode: ResizeMode) {
    if (mode === "none") editor.setResizeNone();
    else if (mode === "scale") editor.setResizeScale(editor.resizeScale);
    else if (mode === "width")
      editor.setResizeWidth(editor.currentItem?.width ?? editor.resizeWidth);
    else editor.setResizeHeight(editor.currentItem?.height ?? editor.resizeHeight);
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
        {t.panel.sizeInfo(outDims.item.width, outDims.item.height, outDims.w, outDims.h)}
      </p>
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

  .status {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-muted);
  }
</style>
