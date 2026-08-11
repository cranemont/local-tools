<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import PageCard from "./PageCard.svelte";
  import { loadFile } from "../pdf/engine";
  import { buildPdf } from "../pdf/exporter";
  import { saveBytes } from "../pdf/save";
  import type { PageItem, Rotation, SourceDoc } from "../pdf/types";

  // 소스는 렌더에 직접 쓰이지 않으므로(썸네일은 page.thumb) 일반 Map으로 보관.
  const sources = new Map<string, SourceDoc>();

  let pages = $state<PageItem[]>([]);
  let busy = $state(false);
  let busyMsg = $state("");
  let errorMsg = $state("");
  let dragOver = $state(false);

  let dragFrom = $state<number | null>(null);
  let dragTo = $state<number | null>(null);

  let fileInput: HTMLInputElement;
  let filename = $state("merged");

  const selectedCount = $derived(pages.filter((p) => p.selected).length);

  function outputName(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return `${clean || "merged"}.pdf`;
  }
  const nextRotation = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

  async function addFiles(files: FileList | File[]) {
    errorMsg = "";
    busy = true;
    const arr = Array.from(files);
    try {
      for (let i = 0; i < arr.length; i++) {
        busyMsg = t.canvas.loading(arr[i].name, i + 1, arr.length);
        try {
          const { source, pages: added } = await loadFile(arr[i]);
          sources.set(source.id, source);
          pages = [...pages, ...added];
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  function pick() {
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) addFiles(input.files);
    input.value = "";
  }

  // ── 외부 파일 드롭 ────────────────────────────────
  function onZoneDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragOver = true;
  }
  function onZoneDragLeave() {
    dragOver = false;
  }
  function onZoneDrop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer.files);
  }

  // ── 페이지 동작 ──────────────────────────────────
  function toggle(id: string) {
    pages = pages.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p));
  }
  function rotate(id: string) {
    pages = pages.map((p) =>
      p.id === id ? { ...p, rotation: nextRotation(p.rotation) } : p,
    );
  }
  function remove(id: string) {
    pages = pages.filter((p) => p.id !== id);
  }
  function selectAll() {
    pages = pages.map((p) => ({ ...p, selected: true }));
  }
  function selectNone() {
    pages = pages.map((p) => ({ ...p, selected: false }));
  }
  function rotateSelected() {
    pages = pages.map((p) =>
      p.selected ? { ...p, rotation: nextRotation(p.rotation) } : p,
    );
  }
  function deleteSelected() {
    pages = pages.filter((p) => !p.selected);
  }
  function clearAll() {
    pages = [];
    sources.clear();
    errorMsg = "";
  }

  // ── 카드 드래그로 순서 변경 ───────────────────────
  function cardDragStart(e: DragEvent, index: number) {
    dragFrom = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }
  function cardDragOver(e: DragEvent, index: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    dragTo = index;
  }
  function cardDrop(index: number) {
    if (dragFrom !== null && dragFrom !== index) {
      const next = [...pages];
      const [moved] = next.splice(dragFrom, 1);
      next.splice(index, 0, moved);
      pages = next;
    }
    dragFrom = null;
    dragTo = null;
  }
  function cardDragEnd() {
    dragFrom = null;
    dragTo = null;
  }

  // ── 내보내기 ─────────────────────────────────────
  async function exportPdf(onlySelected: boolean) {
    const items = onlySelected ? pages.filter((p) => p.selected) : pages;
    if (!items.length) return;
    busy = true;
    busyMsg = t.canvas.exporting;
    errorMsg = "";
    try {
      const bytes = await buildPdf(items, sources);
      await saveBytes(bytes, outputName());
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }
</script>

<div
  class="canvas"
  class:dragover={dragOver}
  ondragover={onZoneDragOver}
  ondragleave={onZoneDragLeave}
  ondrop={onZoneDrop}
  role="region"
  aria-label={t.tabs.edit}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="application/pdf,image/png,image/jpeg"
    multiple
    hidden
    onchange={onInputChange}
  />

  {#if pages.length === 0}
    <button type="button" class="dropzone" onclick={pick}>
      <span class="dz-icon"><Icon name="plus" size={30} /></span>
      <p class="dz-title">{t.canvas.dropHint}</p>
      <p class="dz-sub">{t.canvas.dropSub}</p>
    </button>
  {:else}
    <div class="toolbar">
      <button type="button" class="btn" onclick={pick}>
        <Icon name="plus" size={15} /> {t.canvas.addFiles}
      </button>

      <span class="sep"></span>

      <button type="button" class="btn ghost" onclick={selectAll}>
        {t.canvas.selectAll}
      </button>
      <button type="button" class="btn ghost" onclick={selectNone} disabled={selectedCount === 0}>
        {t.canvas.selectNone}
      </button>
      <button type="button" class="btn ghost" onclick={rotateSelected} disabled={selectedCount === 0}>
        <Icon name="rotate" size={15} /> {t.canvas.rotateSelected}
      </button>
      <button type="button" class="btn ghost danger" onclick={deleteSelected} disabled={selectedCount === 0}>
        <Icon name="trash" size={15} /> {t.canvas.deleteSelected}
      </button>

      <span class="spacer"></span>

      <span class="count">
        {t.canvas.pageCount(pages.length)}{#if selectedCount > 0}
          · {t.canvas.selectedCount(selectedCount)}{/if}
      </span>

      <span class="namefield">
        <input
          class="fname"
          bind:value={filename}
          aria-label={t.canvas.fileName}
          spellcheck="false"
          autocomplete="off"
        />
        <span class="ext">.pdf</span>
      </span>

      <button type="button" class="btn" onclick={() => exportPdf(true)} disabled={selectedCount === 0}>
        <Icon name="download" size={15} /> {t.canvas.exportSelected}
      </button>
      <button type="button" class="btn primary" onclick={() => exportPdf(false)}>
        <Icon name="download" size={15} /> {t.canvas.exportAll}
      </button>
    </div>

    <div class="grid">
      {#each pages as page, i (page.id)}
        <div
          class="slot"
          class:target={dragTo === i && dragFrom !== null && dragFrom !== i}
          class:dragging={dragFrom === i}
          draggable="true"
          ondragstart={(e) => cardDragStart(e, i)}
          ondragover={(e) => cardDragOver(e, i)}
          ondrop={() => cardDrop(i)}
          ondragend={cardDragEnd}
          role="listitem"
        >
          <PageCard
            {page}
            onToggle={() => toggle(page.id)}
            onRotate={() => rotate(page.id)}
            onDelete={() => remove(page.id)}
          />
        </div>
      {/each}
    </div>

    <div class="footer-row">
      <button type="button" class="btn ghost danger" onclick={clearAll}>
        <Icon name="x" size={15} /> {t.canvas.clearAll}
      </button>
    </div>
  {/if}

  {#if errorMsg}
    <div class="error" role="alert">{errorMsg}</div>
  {/if}

  {#if busy}
    <div class="overlay">
      <div class="spinner" aria-hidden="true"></div>
      <p>{busyMsg}</p>
    </div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-radius: var(--radius-lg);
    transition: box-shadow var(--dur-short) var(--ease-out);
  }
  .canvas.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  /* 빈 상태 드롭존 */
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
    color: var(--accent-ink);
  }
  .dz-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--text);
  }
  .dz-sub {
    margin: 0;
    font-size: var(--text-base);
  }

  /* 툴바 */
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
  .count {
    font-size: var(--text-md);
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
    font-size: var(--text-base);
    padding: 7px 8px;
    width: 110px;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: var(--text-md);
    color: var(--text-muted);
  }


  /* 그리드 */
  .grid {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
    align-content: start;
    padding: 4px;
  }
  .slot {
    border-radius: var(--radius-md);
    cursor: grab;
  }
  .slot.dragging {
    opacity: 0.4;
  }
  .slot.target {
    box-shadow: -3px 0 0 var(--accent);
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
    font-size: var(--text-base);
  }

  /* 로딩 오버레이 */
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
    font-size: var(--text-lg);
  }
</style>
