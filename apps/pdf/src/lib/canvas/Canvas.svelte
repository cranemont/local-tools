<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import PageCard from "./PageCard.svelte";
  import { loadFile, loadPdf, PdfPasswordError, type LoadResult } from "../pdf/engine";
  import { buildPdf, buildPdfParts } from "../pdf/exporter";
  import { chunkEvery, parseRange } from "../pdf/range";
  import { saveBytes, saveZip } from "../pdf/save";
  import { unlockPdf } from "../pdf/unlock.svelte";
  import type { PageItem, Rotation, SourceDoc } from "../pdf/types";

  // 소스는 렌더에 직접 쓰이지 않으므로(썸네일은 page.thumb) 일반 Map으로 보관.
  const sources = new Map<string, SourceDoc>();

  type SplitMode = "ranges" | "every" | "single";

  let pages = $state<PageItem[]>([]);
  let busy = $state(false);
  let busyMsg = $state("");
  let errorMsg = $state("");
  let statusMsg = $state("");
  let dragOver = $state(false);

  let dragFrom = $state<number | null>(null);
  let dragTo = $state<number | null>(null);

  let fileInput: HTMLInputElement;
  let filename = $state("merged");

  // 쪽 범위 — 선택과 분할이 같은 표기를 나눠 쓴다.
  let rangeSpec = $state("");
  let rangeError = $state("");
  let splitMode = $state<SplitMode>("ranges");
  let splitSize = $state(2);

  const splitModes: { id: SplitMode; label: string }[] = [
    { id: "ranges", label: t.canvas.splitByRange },
    { id: "every", label: t.canvas.splitEvery },
    { id: "single", label: t.canvas.splitSingle },
  ];

  const selectedCount = $derived(pages.filter((p) => p.selected).length);

  function outputBase(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || "merged";
  }
  const nextRotation = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

  async function addFiles(files: FileList | File[]) {
    errorMsg = "";
    statusMsg = "";
    busy = true;
    const arr = Array.from(files);
    try {
      for (let i = 0; i < arr.length; i++) {
        const label = t.canvas.loading(arr[i].name, i + 1, arr.length);
        busyMsg = label;
        try {
          await addOne(arr[i], label);
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  /** 파일 하나 — 암호가 걸려 있으면 비밀번호를 물어 푼 뒤 얹는다. */
  async function addOne(file: File, label: string) {
    let result: LoadResult;
    try {
      result = await loadFile(file);
    } catch (err) {
      if (!(err instanceof PdfPasswordError)) throw err;
      // 비밀번호 창이 떠 있는 동안에는 진행 오버레이를 걷는다.
      busy = false;
      const unlocked = await unlockPdf(err.fileName, err.bytes, (msg) => {
        busy = msg !== "";
        busyMsg = msg;
      });
      busy = true;
      busyMsg = label;
      if (!unlocked) {
        errorMsg = t.unlock.canceled(file.name);
        return;
      }
      result = await loadPdf(file.name, unlocked);
    }
    sources.set(result.source.id, result.source);
    pages = [...pages, ...result.pages];
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
    statusMsg = "";
    rangeError = "";
  }

  // ── 쪽 범위로 고르기 ─────────────────────────────
  function applyPicked(picked: Set<number>) {
    pages = pages.map((p, i) => ({ ...p, selected: picked.has(i) }));
  }
  function applyRange() {
    const { indices, invalid } = parseRange(rangeSpec, pages.length);
    if (invalid || indices.length === 0) {
      rangeError = t.errors.rangeInvalid;
      return;
    }
    rangeError = "";
    applyPicked(new Set(indices));
  }
  /** 1쪽부터 세어 홀수·짝수를 고른다. */
  function selectParity(odd: boolean) {
    rangeError = "";
    const picked = new Set<number>();
    pages.forEach((_, i) => {
      if ((i % 2 === 0) === odd) picked.add(i);
    });
    applyPicked(picked);
  }

  // ── 나누기 ───────────────────────────────────────
  /** 규칙대로 페이지를 묶는다. 읽을 수 없는 범위면 null. */
  function splitGroups(): PageItem[][] | null {
    if (splitMode === "ranges") {
      const { groups, invalid } = parseRange(rangeSpec, pages.length);
      if (invalid || groups.length === 0) return null;
      return groups.map((g) => g.map((i) => pages[i]));
    }
    const all = pages.map((_, i) => i);
    const size = splitMode === "single" ? 1 : splitSize;
    return chunkEvery(all, size)
      .filter((g) => g.length > 0)
      .map((g) => g.map((i) => pages[i]));
  }

  async function splitPdf() {
    const groups = splitGroups();
    if (!groups || groups.length === 0) {
      rangeError = t.errors.rangeInvalid;
      return;
    }
    rangeError = "";
    errorMsg = "";
    statusMsg = "";
    busy = true;
    busyMsg = t.canvas.splitting(1, groups.length);
    try {
      const base = outputBase();
      if (groups.length === 1) {
        // 묶음이 하나면 ZIP으로 감싸지 않는다.
        const bytes = await buildPdf(groups[0], sources);
        saveBytes(bytes, `${base}.pdf`);
      } else {
        const parts = await buildPdfParts(groups, sources, base, (done, total) => {
          busyMsg = t.canvas.splitting(done, total);
        });
        const files: Record<string, Uint8Array> = {};
        for (const part of parts) files[part.name] = part.bytes;
        saveZip(files, `${base}.zip`);
      }
      statusMsg = t.canvas.splitDone(groups.length);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
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
    statusMsg = "";
    try {
      const bytes = await buildPdf(items, sources);
      saveBytes(bytes, `${outputBase()}.pdf`);
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

      {#if statusMsg}<span class="status">{statusMsg}</span>{/if}
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

    <div class="rangebar">
      <span class="rlabel" id="range-label">{t.canvas.rangeLabel}</span>
      <input
        class="range"
        bind:value={rangeSpec}
        placeholder={t.canvas.rangePlaceholder}
        aria-labelledby="range-label"
        spellcheck="false"
        autocomplete="off"
        onkeydown={(e) => {
          if (e.key === "Enter") applyRange();
        }}
      />
      <button type="button" class="btn ghost small" onclick={applyRange}>
        {t.canvas.rangeApply}
      </button>
      <button type="button" class="btn ghost small" onclick={() => selectParity(true)}>
        {t.canvas.rangeOdd}
      </button>
      <button type="button" class="btn ghost small" onclick={() => selectParity(false)}>
        {t.canvas.rangeEven}
      </button>

      <span class="sep"></span>

      <span class="rlabel" id="split-label">{t.canvas.splitLabel}</span>
      <select class="sel" bind:value={splitMode} aria-labelledby="split-label">
        {#each splitModes as m (m.id)}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
      {#if splitMode === "every"}
        <input
          class="num"
          type="number"
          min="1"
          max={Math.max(1, pages.length)}
          bind:value={splitSize}
          aria-label={t.canvas.splitSize}
        />
      {/if}
      <button type="button" class="btn small" onclick={splitPdf}>
        <Icon name="split" size={15} /> {t.canvas.split}
      </button>

      {#if rangeError}<span class="rerror" role="alert">{rangeError}</span>{/if}
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
  .status {
    font-size: var(--text-md);
    color: var(--accent-ink);
    margin-right: 4px;
  }

  /* 쪽 범위 + 나누기 — 선택과 분할이 같은 표기를 나눠 쓰므로 한 줄에 둔다 */
  .rangebar {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-wrap: wrap;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .rlabel {
    font-size: var(--text-md);
    color: var(--text-muted);
  }
  .range,
  .num,
  .sel {
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-md);
    font-family: inherit;
    padding: var(--space-2xs) var(--space-xs);
  }
  .range {
    width: 150px;
  }
  .num {
    width: 64px;
  }
  .range:focus,
  .num:focus,
  .sel:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  .rerror {
    font-size: var(--text-md);
    color: var(--danger);
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
    /* 안쪽 스크롤이 끝에 닿아도 페이지 전체가 딸려 올라가지 않게 한다.
     * 도구 아래 설명(section#intro)으로 스크롤이 넘어가면 화면이 잘린 것처럼 보인다. */
    overscroll-behavior: contain;
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
