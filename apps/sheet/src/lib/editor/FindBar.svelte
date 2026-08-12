<script lang="ts">
  /** 찾기·바꾸기 막대. 찾은 자리로 커서를 옮기는 것까지가 이 컴포넌트의 일이다. */
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let { onClose }: { onClose: () => void } = $props();

  let query = $state("");
  let replacement = $state("");
  let matchCase = $state(false);
  let index = $state(0);
  let field = $state<HTMLInputElement | null>(null);

  const matches = $derived(editor.findMatches(query, matchCase));

  function go(step: number): void {
    if (matches.length === 0) return;
    index = (index + step + matches.length) % matches.length;
    const hit = matches[index];
    editor.select(hit.row, hit.col);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      go(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    event.stopPropagation();
  }

  $effect(() => {
    field?.focus();
  });

  // 검색어가 바뀌면 첫 결과로 되돌아간다.
  $effect(() => {
    void query;
    void matchCase;
    index = 0;
  });
</script>

<div class="find" role="search">
  <Icon name="search" size={15} />
  <input
    bind:this={field}
    bind:value={query}
    onkeydown={onKey}
    placeholder={t.find.placeholder}
    aria-label={t.find.placeholder}
    spellcheck="false"
  />
  <span class="count">
    {matches.length > 0 ? t.find.count(index + 1, matches.length) : query ? t.find.none : ""}
  </span>
  <button class="btn small ghost" onclick={() => go(-1)} disabled={matches.length === 0}>
    {t.find.prev}
  </button>
  <button class="btn small ghost" onclick={() => go(1)} disabled={matches.length === 0}>
    {t.find.next}
  </button>

  <span class="divider" aria-hidden="true"></span>

  <input
    bind:value={replacement}
    onkeydown={onKey}
    placeholder={t.find.replaceWith}
    aria-label={t.find.replaceWith}
    spellcheck="false"
  />
  <button
    class="btn small"
    onclick={() => editor.replaceAll(query, replacement, matchCase)}
    disabled={!query}
  >
    {t.find.replaceAll}
  </button>

  <label class="case">
    <input type="checkbox" bind:checked={matchCase} />
    {t.find.matchCase}
  </label>

  <button class="icon-btn" title={t.file.close} onclick={onClose}>
    <Icon name="x" size={14} />
    <span class="sr-only">{t.file.close}</span>
  </button>
</div>

<style>
  .find {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-muted);
    flex-wrap: wrap;
  }

  input:not([type]) {
    width: 168px;
    padding: var(--space-2xs) var(--space-xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-base);
  }

  .count {
    min-width: 56px;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .divider {
    width: 1px;
    height: 20px;
    background: var(--border);
  }

  .case {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .case input {
    width: auto;
    accent-color: var(--accent);
  }
</style>
