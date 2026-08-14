<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { formatBytes } from "../doc/save";
  import { editor } from "./state.svelte";
  import { scrollToPage } from "./scroll";
  import type { PaneView } from "./view";

  let {
    view,
    narrow,
    setView,
    sync,
    toggleSync,
    canFind,
    toggleFind,
    outline,
    toggleOutline,
  }: {
    view: PaneView;
    /** 좁은 화면 — 두 판을 나란히 놓을 자리가 없다 */
    narrow: boolean;
    setView: (next: PaneView) => void;
    sync: boolean;
    toggleSync: () => void;
    canFind: boolean;
    toggleFind: () => void;
    outline: boolean;
    toggleOutline: () => void;
  } = $props();

  /** 쪽 번호를 받아 그 쪽으로. 범위를 벗어난 숫자는 양끝으로 자른다. */
  function gotoPage(event: Event): void {
    const field = event.currentTarget as HTMLInputElement;
    const wanted = Number(field.value);
    if (!Number.isFinite(wanted)) return;
    const page = Math.min(editor.pageCount, Math.max(1, Math.round(wanted))) - 1;
    field.value = String(page + 1);
    scrollToPage(page);
  }

  const all: { id: PaneView; label: string }[] = [
    { id: "original", label: t.panes.original },
    { id: "both", label: t.panes.both },
    { id: "markdown", label: t.panes.markdown },
  ];

  // 좁은 화면에서는 "나란히"를 눌러도 한 판만 나온다 — 아예 내놓지 않는다.
  const views = $derived(narrow ? all.filter((option) => option.id !== "both") : all);

  const busy = $derived(editor.busy !== null);
  const isHwp = $derived(editor.kind !== "docx");
  /** 목차·쪽 이동·배율은 원본 판만 움직인다 — 그 판이 없으면 눌러도 아무 일이 없다. */
  const onOriginal = $derived(view !== "markdown");
</script>

<div class="bar">
  <div class="file">
    <Icon name={isHwp ? "hangul" : "doc"} size={16} />
    <span class="name" title={editor.fileName}>{editor.title ?? editor.fileName}</span>
    <span class="meta">
      {editor.kind ? t.file.kind[editor.kind] : ""}
      · {formatBytes(editor.fileSize)}
      {#if editor.pageCount > 0}· {t.file.pages(editor.pageCount)}{/if}
    </span>
  </div>

  <div class="views" role="group" aria-label={t.panes.original}>
    {#each views as option (option.id)}
      <button
        class="btn small"
        class:active={view === option.id}
        aria-pressed={view === option.id}
        onclick={() => setView(option.id)}
      >
        {option.label}
      </button>
    {/each}
  </div>

  {#if onOriginal}
    <button
      class="icon-btn tool"
      class:active={outline}
      aria-pressed={outline}
      onclick={toggleOutline}
      disabled={editor.outline.length === 0}
      title={editor.outline.length === 0
        ? t.view.outlineEmpty
        : outline
          ? t.view.outlineClose
          : t.view.outlineOpen}
    >
      <Icon name="list" size={16} />
      <span class="sr-only">{t.view.outline}</span>
    </button>

    {#if editor.pageCount > 0}
      <div class="page-nav">
        <input
          class="page-input"
          type="number"
          min="1"
          max={editor.pageCount}
          value={editor.currentPage + 1}
          onchange={gotoPage}
          aria-label={t.view.page}
        />
        <span class="total">{t.view.pageTotal(editor.pageCount)}</span>
      </div>
    {/if}

    <div class="zoom" role="group" aria-label={t.view.zoom}>
      <button
        class="icon-btn tool"
        onclick={() => editor.zoomOut()}
        disabled={!editor.canZoomOut}
        title={t.view.zoomOut}
      >
        <Icon name="zoom-out" size={16} />
        <span class="sr-only">{t.view.zoomOut}</span>
      </button>
      <button class="btn small" onclick={() => editor.fitWidth()} title={t.view.fitWidth}>
        {t.view.percent(editor.zoom)}
      </button>
      <button
        class="icon-btn tool"
        onclick={() => editor.zoomIn()}
        disabled={!editor.canZoomIn}
        title={t.view.zoomIn}
      >
        <Icon name="zoom-in" size={16} />
        <span class="sr-only">{t.view.zoomIn}</span>
      </button>
    </div>
  {/if}

  <div class="spacer"></div>

  {#if editor.editable}
    <button
      class="btn small"
      class:active={editor.editing}
      onclick={() => editor.toggleEditing()}
    >
      <Icon name="pencil" size={15} />
      {editor.editing ? t.edit.stop : t.edit.start}
    </button>
  {/if}

  {#if editor.editing}
    <button
      class="icon-btn tool"
      onclick={() => editor.undo()}
      disabled={!editor.canUndo}
      title={t.edit.undo}
    >
      <Icon name="undo" size={16} />
      <span class="sr-only">{t.edit.undo}</span>
    </button>
    <button
      class="icon-btn tool"
      onclick={() => editor.redo()}
      disabled={!editor.canRedo}
      title={t.edit.redo}
    >
      <Icon name="redo" size={16} />
      <span class="sr-only">{t.edit.redo}</span>
    </button>
  {/if}

  {#if editor.dirty}
    <button
      class="btn small primary"
      onclick={() => void editor.saveEdited()}
      disabled={busy}
    >
      <Icon name="download" size={15} />
      {t.edit.save}
    </button>
  {/if}

  {#if canFind}
    <button class="icon-btn tool" onclick={toggleFind} title={t.actions.find}>
      <Icon name="search" size={16} />
      <span class="sr-only">{t.actions.find}</span>
    </button>
  {/if}

  <button
    class="icon-btn tool"
    class:active={sync}
    onclick={toggleSync}
    disabled={view !== "both"}
    title={t.panes.syncScroll}
  >
    <Icon name="link" size={16} />
    <span class="sr-only">{t.panes.syncScroll}</span>
  </button>

  <button class="btn small" onclick={() => void editor.copyMarkdown()} disabled={busy}>
    <Icon name="copy" size={15} />
    {t.actions.copyMarkdown}
  </button>

  <button
    class="btn small"
    onclick={() => void editor.saveHwpx()}
    disabled={busy}
  >
    <Icon name="hangul" size={15} />
    {isHwp ? t.actions.saveHwpx : t.actions.saveHwpxFromDocx}
  </button>

  <button class="btn small" onclick={() => editor.print()} disabled={busy}>
    <Icon name="print" size={15} />
    {t.actions.print}
  </button>

  <button
    class="btn small primary"
    onclick={() => void editor.saveMarkdownFile()}
    disabled={busy}
  >
    <Icon name="download" size={15} />
    {t.actions.saveMarkdown}
  </button>

  <button class="icon-btn tool" onclick={() => editor.close()} title={t.file.close}>
    <Icon name="x" size={16} />
    <span class="sr-only">{t.file.close}</span>
  </button>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-wrap: wrap;
  }

  .file {
    display: flex;
    align-items: baseline;
    gap: var(--space-2xs);
    min-width: 0;
    color: var(--text-muted);
  }
  .file :global(.icon) {
    align-self: center;
    color: var(--accent-ink);
  }
  .name {
    max-width: 28ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-weight: 600;
  }
  .meta {
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .views {
    display: inline-flex;
    gap: var(--space-3xs);
    margin-left: var(--space-xs);
  }

  .spacer {
    flex: 1;
  }

  .page-nav {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-3xs);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .page-input {
    width: 5ch;
    padding: var(--space-3xs) var(--space-3xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .total {
    white-space: nowrap;
  }

  .zoom {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3xs);
  }
  /* 배율 숫자는 폭이 바뀌면 옆 버튼이 흔들린다 — 자리를 고정한다. */
  .zoom .btn {
    min-width: 6ch;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }

  @media print {
    .bar {
      display: none;
    }
  }
</style>
