<script module lang="ts">
  /** 목록 폭. 여는 쪽(Grid)이 칸 왼쪽에 맞춰 x를 잡을 때 같은 값을 쓴다. */
  export const PICKER_MIN_WIDTH = 140;
</script>

<script lang="ts">
  /**
   * 목록 규칙이 걸린 칸의 드롭다운.
   *
   * 그리드 바깥에 `position: fixed`로 뜬다 — 칸 안에 두면 스크롤 상자에 잘린다
   * (필터 메뉴와 같은 이유). 고르면 곧바로 그 칸에 넣는다.
   */
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let {
    row,
    col,
    x,
    y,
    width,
    onClose,
  }: {
    row: number;
    col: number;
    x: number;
    y: number;
    width: number;
    onClose: () => void;
  } = $props();

  const items = $derived(editor.listItemsAt(row, col) ?? []);
  const current = $derived(editor.displayAt(row, col).trim().toLowerCase());

  let root = $state<HTMLDivElement | null>(null);

  const place = $derived.by(() => {
    const w = Math.max(width, PICKER_MIN_WIDTH);
    const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - 240));
    return `left:${left}px; top:${top}px; min-width:${w}px`;
  });

  function pick(item: string): void {
    editor.pickListValue(row, col, item);
    onClose();
  }

  function onWindowDown(event: MouseEvent): void {
    if (root && !root.contains(event.target as Node)) onClose();
  }

  function onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  }

  $effect(() => {
    root?.querySelector("button")?.focus();
  });
</script>

<svelte:window onmousedown={onWindowDown} />

<div
  class="picker"
  style={place}
  bind:this={root}
  onkeydown={onKey}
  role="listbox"
  tabindex="-1"
  aria-label={t.validation.pick}
>
  {#each items as item (item)}
    <button
      type="button"
      class="item"
      class:on={item.trim().toLowerCase() === current}
      role="option"
      aria-selected={item.trim().toLowerCase() === current}
      onclick={() => pick(item)}
    >
      {item}
    </button>
  {/each}
</div>

<style>
  .picker {
    position: fixed;
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    max-height: 220px;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: var(--space-3xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-2);
  }

  .item {
    all: unset;
    padding: var(--space-3xs) var(--space-xs);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: var(--text-base);
    white-space: nowrap;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.on {
    color: var(--accent-ink);
    background: var(--accent-weak);
  }
  .item:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
</style>
