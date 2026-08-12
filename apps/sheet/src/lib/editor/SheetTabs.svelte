<script lang="ts">
  /** 시트 탭. 더블클릭하면 이름을 고칠 수 있다. */
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let renaming = $state<number | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);

  function startRename(index: number): void {
    renaming = index;
  }

  function finishRename(): void {
    if (renaming === null) return;
    const index = renaming;
    renaming = null;
    const value = renameInput?.value ?? "";
    if (value.trim()) editor.renameSheet(index, value);
  }

  function onRenameKey(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      finishRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      renaming = null;
    }
    event.stopPropagation();
  }

  function remove(index: number): void {
    if (editor.sheetNames.length <= 1) return;
    if (!confirm(t.sheets.confirmRemove(editor.sheetNames[index]))) return;
    editor.removeSheet(index);
  }

  $effect(() => {
    if (renaming !== null && renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  });
</script>

<div class="tabs" role="tablist" aria-label="시트">
  {#each editor.sheetNames as name, i (i + name)}
    <div class="tab" class:active={editor.activeSheet === i}>
      {#if renaming === i}
        <input
          class="rename"
          bind:this={renameInput}
          value={name}
          onblur={finishRename}
          onkeydown={onRenameKey}
        />
      {:else}
        <button
          class="name"
          role="tab"
          aria-selected={editor.activeSheet === i}
          onclick={() => editor.switchSheet(i)}
          ondblclick={() => startRename(i)}
          title={name}
        >
          {name}
        </button>
        {#if editor.activeSheet === i && editor.sheetNames.length > 1}
          <button class="close" title={t.sheets.remove} onclick={() => remove(i)}>
            <Icon name="x" size={12} />
            <span class="sr-only">{t.sheets.remove}</span>
          </button>
        {/if}
      {/if}
    </div>
  {/each}

  <button class="add" title={t.sheets.add} onclick={() => editor.addSheet()}>
    <Icon name="plus" size={14} />
    <span class="sr-only">{t.sheets.add}</span>
  </button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-3xs);
    padding: var(--space-3xs) var(--space-sm);
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    flex: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: transparent;
  }
  .tab.active {
    background: var(--surface);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .name {
    all: unset;
    padding: var(--space-xs) var(--space-md);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-base);
    color: var(--text-muted);
    cursor: pointer;
  }
  .tab.active .name {
    color: var(--text);
    font-weight: 600;
  }
  .name:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }

  .close {
    all: unset;
    display: inline-flex;
    align-items: center;
    padding: var(--space-3xs);
    margin-right: var(--space-2xs);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--danger);
  }
  .close:focus-visible {
    outline: 2px solid var(--focus);
  }

  .rename {
    width: 130px;
    margin: var(--space-3xs) var(--space-2xs);
    padding: var(--space-2xs) var(--space-xs);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-base);
  }

  .add {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    margin-left: var(--space-2xs);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    cursor: pointer;
  }
  .add:hover {
    background: var(--surface);
    color: var(--accent-ink);
  }
  .add:focus-visible {
    outline: 2px solid var(--focus);
  }
</style>
