<script lang="ts">
  /**
   * 왼쪽 원본은 SVG라 브라우저 Ctrl+F가 닿지 않는다. 그 자리를 메우는 바다 —
   * 엔진에게 문서 전체를 물어 몇 곳에 있는지 세고, 해당 쪽으로 데려간다.
   * (오른쪽 마크다운은 그냥 글자라 브라우저 찾기가 그대로 먹는다.)
   */
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";

  let { close }: { close: () => void } = $props();

  let query = $state("");
  let current = $state(0);
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    input?.focus();
  });

  function run(): void {
    editor.search(query);
    current = 0;
    goto(0);
  }

  function goto(index: number): void {
    const hit = editor.hits[index];
    if (!hit || hit.page === null) return;
    const page = document.querySelector<HTMLElement>(`[data-page="${hit.page}"]`);
    page?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function step(delta: number): void {
    if (editor.hits.length === 0) return;
    current = (current + delta + editor.hits.length) % editor.hits.length;
    goto(current);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      if (editor.query === query) step(event.shiftKey ? -1 : 1);
      else run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }
</script>

<div class="find">
  <Icon name="search" size={15} />
  <input
    bind:this={input}
    bind:value={query}
    type="search"
    placeholder={t.find.placeholder}
    oninput={run}
    onkeydown={onKey}
    aria-label={t.find.placeholder}
  />

  {#if query.trim()}
    <span class="count" aria-live="polite">
      {editor.hits.length > 0
        ? `${current + 1} / ${t.find.count(editor.hits.length)}`
        : t.find.none}
    </span>
    <button class="icon-btn tool" onclick={() => step(-1)} disabled={editor.hits.length === 0}>
      <Icon name="chevron-up" size={16} />
      <span class="sr-only">이전</span>
    </button>
    <button class="icon-btn tool" onclick={() => step(1)} disabled={editor.hits.length === 0}>
      <Icon name="chevron-down" size={16} />
      <span class="sr-only">다음</span>
    </button>
  {:else}
    <span class="hint">{t.find.hint}</span>
  {/if}

  <button class="icon-btn tool" onclick={close} title={t.find.close}>
    <Icon name="x" size={16} />
    <span class="sr-only">{t.find.close}</span>
  </button>
</div>

<style>
  .find {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-3xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-muted);
  }

  input {
    flex: 1;
    min-width: 0;
    max-width: 320px;
    padding: var(--space-3xs) var(--space-2xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .count,
  .hint {
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .hint {
    flex: 1;
  }

  @media print {
    .find {
      display: none;
    }
  }
</style>
