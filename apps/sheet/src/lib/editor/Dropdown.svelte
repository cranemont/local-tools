<script lang="ts">
  /** 작은 드롭다운. 바깥 클릭·Esc로 닫히고, 열릴 때 첫 항목으로 초점이 간다. */
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "../Icon.svelte";

  let {
    label,
    title,
    icon,
    wide = false,
    children,
  }: {
    label?: string;
    title: string;
    icon?: IconName;
    wide?: boolean;
    children: Snippet<[() => void]>;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  function close(): void {
    open = false;
  }

  function onWindowDown(event: MouseEvent): void {
    if (!open || !root) return;
    if (!root.contains(event.target as Node)) close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close();
    }
  }
</script>

<svelte:window onmousedown={onWindowDown} />

<div class="dd" bind:this={root} onkeydown={onKey} role="presentation">
  <button
    type="button"
    class="btn small ghost trigger"
    class:active={open}
    {title}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {#if icon}<Icon name={icon} size={15} />{/if}
    {#if label}<span class="label">{label}</span>{/if}
    <Icon name="chevron-down" size={13} />
  </button>

  {#if open}
    <div class="panel" class:wide role="menu">
      {@render children(close)}
    </div>
  {/if}
</div>

<style>
  .dd {
    position: relative;
    display: inline-flex;
  }

  /* 도구줄 안에서 아이콘 버튼과 높이를 맞춘다. */
  .trigger {
    height: 28px;
    padding: 0 var(--space-sm);
    gap: var(--space-2xs);
    color: var(--text);
  }
  .trigger .label {
    font-weight: 500;
  }
  .trigger:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: var(--z-overlay);
    min-width: 172px;
    padding: var(--space-2xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-2);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .panel.wide {
    min-width: 248px;
  }

  /* 메뉴 항목은 부모가 넘겨준 마크업이라 :global로 잡는다. */
  .panel :global(.item) {
    all: unset;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
  }
  .panel :global(.item:hover) {
    background: var(--surface-2);
  }
  .panel :global(.item:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .panel :global(.item.on) {
    color: var(--accent-ink);
  }
  .panel :global(.item .trail) {
    margin-left: auto;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }
  .panel :global(.sep) {
    height: 1px;
    margin: var(--space-2xs) 0;
    background: var(--border);
  }
  .panel :global(.group-label) {
    padding: var(--space-2xs) var(--space-sm);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
