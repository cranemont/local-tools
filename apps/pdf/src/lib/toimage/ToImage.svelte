<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { zipSync } from "fflate";
  import { rasterizePdf, type RasterPage } from "../pdf/rasterize";
  import { downloadBlob } from "../pdf/save";

  interface Doc {
    name: string;
    bytes: Uint8Array;
  }
  const docs: Doc[] = [];

  let pages = $state<RasterPage[]>([]);
  let scale = $state(2);
  let busy = $state(false);
  let busyMsg = $state("");
  let error = $state("");
  let status = $state("");
  let dragOver = $state(false);
  let fileInput: HTMLInputElement;
  let zipName = $state("images");

  const scales = [
    { label: t.toImg.q1, value: 1.5 },
    { label: t.toImg.q2, value: 2 },
    { label: t.toImg.q3, value: 3 },
  ];

  function revokeAll() {
    for (const p of pages) URL.revokeObjectURL(p.url);
  }

  async function rasterizeAll() {
    revokeAll();
    pages = [];
    error = "";
    status = "";
    busy = true;
    try {
      const all: RasterPage[] = [];
      for (const doc of docs) {
        const rendered = await rasterizePdf(doc.name, doc.bytes, scale, (i, total) => {
          busyMsg = t.toImg.rendering(i, total, doc.name);
        });
        all.push(...rendered);
      }
      pages = all;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!arr.length) {
      error = "PDF 파일만 변환할 수 있어요.";
      return;
    }
    for (const f of arr) {
      docs.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    await rasterizeAll();
  }

  function pick() {
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) addFiles(input.files);
    input.value = "";
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragOver = true;
  }
  function onDragLeave() {
    dragOver = false;
  }
  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer.files);
  }

  function setScale(v: number) {
    if (v === scale) return;
    scale = v;
    if (docs.length) rasterizeAll();
  }

  async function saveAll() {
    if (!pages.length) return;
    error = "";
    status = "";
    const base = zipName.replace(/[\\/:*?"<>|]/g, "").trim() || "images";

    // 1장이면 그냥 PNG 다운로드, 여러 장이면 ZIP 하나로 묶는다.
    if (pages.length === 1) {
      downloadBlob(pages[0].blob, `${base}.png`);
      status = t.toImg.savedDl(1);
      return;
    }

    busy = true;
    busyMsg = t.toImg.zipping;
    try {
      const files: Record<string, Uint8Array> = {};
      for (const p of pages) {
        files[p.name] = new Uint8Array(await p.blob.arrayBuffer());
      }
      // PNG는 이미 압축돼 있으므로 저장(무압축) 모드로 빠르게 묶음.
      const zipped = zipSync(files, { level: 0 });
      const buf = new Uint8Array(zipped.byteLength);
      buf.set(zipped);
      downloadBlob(new Blob([buf], { type: "application/zip" }), `${base}.zip`);
      status = t.toImg.savedZip(pages.length);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  function clearAll() {
    revokeAll();
    pages = [];
    docs.length = 0;
    error = "";
    status = "";
  }
</script>

<div
  class="tool"
  class:dragover={dragOver}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="region"
  aria-label={t.tabs.toImage}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="application/pdf"
    multiple
    hidden
    onchange={onInputChange}
  />

  {#if pages.length === 0 && !busy}
    <button type="button" class="dropzone" onclick={pick}>
      <span class="dz-icon"><Icon name="image" size={30} /></span>
      <p class="dz-title">{t.toImg.dropHint}</p>
      <p class="dz-sub">{t.toImg.dropSub}</p>
    </button>
  {:else}
    <div class="toolbar">
      <button type="button" class="btn" onclick={pick}>
        <Icon name="plus" size={15} /> {t.toImg.addPdf}
      </button>
      <span class="sep"></span>
      <span class="qlabel">{t.toImg.quality}</span>
      <div class="seg" role="group" aria-label={t.toImg.quality}>
        {#each scales as s (s.value)}
          <button
            type="button"
            class="segbtn"
            class:active={scale === s.value}
            aria-pressed={scale === s.value}
            onclick={() => setScale(s.value)}
          >
            {s.label}
          </button>
        {/each}
      </div>

      <span class="spacer"></span>

      {#if status}<span class="status">{status}</span>{/if}
      <span class="count">{t.toImg.pageCount(pages.length)}</span>
      <span class="namefield">
        <input
          class="fname"
          bind:value={zipName}
          aria-label={t.toImg.fileName}
          spellcheck="false"
          autocomplete="off"
        />
        <span class="ext">{pages.length > 1 ? ".zip" : ".png"}</span>
      </span>
      <button
        type="button"
        class="btn primary"
        onclick={saveAll}
        disabled={pages.length === 0}
      >
        <Icon name="download" size={15} />
        {pages.length > 1 ? t.toImg.saveZip : t.toImg.download}
      </button>
    </div>

    <div class="grid">
      {#each pages as p (p.id)}
        <div class="card">
          <div class="thumb">
            <img src={p.url} alt={p.name} />
          </div>
          <div class="row">
            <span class="label" title={p.name}>{p.name}</span>
            <button
              type="button"
              class="dl"
              title={t.toImg.download}
              onclick={() => downloadBlob(p.blob, p.name)}
            >
              <Icon name="download" size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>

    <div class="footer-row">
      <button type="button" class="btn ghost danger" onclick={clearAll}>
        <Icon name="x" size={15} /> {t.toImg.clear}
      </button>
    </div>
  {/if}

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  {#if busy}
    <div class="overlay">
      <div class="spinner" aria-hidden="true"></div>
      <p>{busyMsg}</p>
    </div>
  {/if}
</div>

<style>
  .tool {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-radius: var(--radius-lg);
    transition: box-shadow 0.12s ease;
  }
  .tool.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  .dropzone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
    padding: 40px;
  }
  .dropzone:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: var(--accent-weak);
  }
  .dz-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .dz-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .dz-sub {
    margin: 0;
    font-size: 13px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 2px 4px;
  }
  .spacer {
    flex: 1;
  }
  .qlabel {
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .status {
    font-size: 12.5px;
    color: var(--accent);
    margin-right: 4px;
  }
  .count {
    font-size: 12.5px;
    color: var(--text-muted);
    margin-right: 4px;
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
    width: 110px;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .segbtn {
    border: 0;
    background: transparent;
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .segbtn.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
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
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-muted);
    font-weight: 500;
  }
  .btn.ghost:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .btn.ghost.danger:hover {
    color: var(--danger);
  }

  .grid {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
    align-content: start;
    padding: 4px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .thumb {
    aspect-ratio: 3 / 4;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    box-shadow: var(--shadow-1);
    background: #fff;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .label {
    flex: 1;
    font-size: 11.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dl {
    width: 26px;
    height: 26px;
    flex: none;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dl:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .footer-row {
    display: flex;
    justify-content: flex-end;
  }

  .error {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: 13px;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(2px);
    border-radius: var(--radius-lg);
    color: var(--text-muted);
    font-size: 13.5px;
  }
  .spinner {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
