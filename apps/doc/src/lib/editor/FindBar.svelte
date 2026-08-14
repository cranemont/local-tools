<script lang="ts">
  /**
   * 왼쪽 원본은 SVG라 브라우저 Ctrl+F가 닿지 않는다. 그 자리를 메우는 바다 —
   * 엔진에게 문서 전체를 물어 몇 곳에 있는지 세고, 그 자리로 데려간 뒤 칠한다
   * (칠하는 것은 Pages가 하고, 여기는 "지금 몇 번째"만 옮긴다).
   * (오른쪽 마크다운은 그냥 글자라 브라우저 찾기가 그대로 먹는다.)
   */
  import { onDestroy } from "svelte";
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";
  import { scrollToPage } from "./scroll";

  /** `focus`는 값이 바뀔 때마다 입력란으로 돌아오라는 신호다(Ctrl+F를 다시 눌렀을 때). */
  let { close, focus }: { close: () => void; focus: number } = $props();

  let query = $state("");
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    focus;
    input?.focus();
    input?.select();
  });

  /** 엔진 검색은 문서 전체를 훑는다 — 타자마다 부르면 큰 문서에서 손이 걸린다. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => {
    clearTimeout(timer);
    // 바를 닫으면 칠해 둔 자리도 함께 걷는다.
    editor.clearFind();
  });

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  }

  function run(): void {
    clearTimeout(timer);
    editor.search(query);
    goto(0);
  }

  function goto(index: number): void {
    const at = editor.focusHit(index);
    if (!at) return;
    scrollToPage(at.page, at.y);
  }

  function step(delta: number): void {
    const count = editor.hits.length;
    if (count === 0) return;
    goto((Math.max(0, editor.currentHit) + delta + count) % count);
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
    oninput={schedule}
    onkeydown={onKey}
    aria-label={t.find.placeholder}
  />

  {#if query.trim()}
    <span class="count" aria-live="polite">
      {editor.hits.length > 0
        ? `${Math.max(0, editor.currentHit) + 1} / ${t.find.count(editor.hits.length)}`
        : t.find.none}
    </span>
    <button
      class="icon-btn tool"
      onclick={() => step(-1)}
      disabled={editor.hits.length === 0}
      title={t.find.prev}
    >
      <Icon name="chevron-up" size={16} />
      <span class="sr-only">{t.find.prev}</span>
    </button>
    <button
      class="icon-btn tool"
      onclick={() => step(1)}
      disabled={editor.hits.length === 0}
      title={t.find.next}
    >
      <Icon name="chevron-down" size={16} />
      <span class="sr-only">{t.find.next}</span>
    </button>
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

  .count {
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  @media print {
    .find {
      display: none;
    }
  }
</style>
