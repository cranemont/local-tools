<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { formatBytes } from "../doc/save";
  import { editor } from "./state.svelte";
  import type { PaneView } from "./view";

  let {
    view,
    setView,
    sync,
    toggleSync,
    toggleFind,
  }: {
    view: PaneView;
    setView: (next: PaneView) => void;
    sync: boolean;
    toggleSync: () => void;
    toggleFind: () => void;
  } = $props();

  const views: { id: PaneView; label: string }[] = [
    { id: "original", label: t.panes.original },
    { id: "both", label: t.panes.both },
    { id: "markdown", label: t.panes.markdown },
  ];

  const busy = $derived(editor.busy !== null);
  const isHwp = $derived(editor.kind !== "docx");
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

  <div class="spacer"></div>

  {#if isHwp}
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
    title={sync ? t.panes.syncScrollOn : t.panes.syncScrollOff}
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
    title={t.actions.saveHwpxHint}
  >
    <Icon name="hangul" size={15} />
    {isHwp ? t.actions.saveHwpx : t.actions.saveHwpxFromDocx}
  </button>

  <button class="btn small" onclick={() => editor.print()} disabled={busy} title={t.actions.printHint}>
    <Icon name="print" size={15} />
    {t.actions.print}
  </button>

  <button
    class="btn small primary"
    onclick={() => void editor.saveMarkdownFile()}
    disabled={busy}
    title={t.actions.saveMarkdownHint}
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

  @media print {
    .bar {
      display: none;
    }
  }
</style>
