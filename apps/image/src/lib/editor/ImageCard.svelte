<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import { formatBytes } from "../image/save";
  import type { ImageItem } from "../image/types";

  let { item, index }: { item: ImageItem; index: number } = $props();

  const isCurrent = $derived(index === editor.current);
</script>

<div class="card" class:current={isCurrent}>
  <button
    type="button"
    class="thumb"
    onclick={() => editor.select(index)}
    title={t.cards.activate}
  >
    <img src={item.thumb} alt={item.name} draggable="false" />
    {#if item.transform.rotation !== 0 || item.transform.crop}
      <span class="edited" title={t.edit.edited}><Icon name="crop" size={10} /></span>
    {/if}
  </button>

  <div class="controls">
    <button
      type="button"
      class="danger"
      onclick={() => editor.removeOne(item.id)}
      title={t.cards.remove}
    >
      <Icon name="trash" size={13} />
    </button>
  </div>

  <div class="meta">
    <span class="name" title={item.name}>{item.name}</span>
    <span class="size">{formatBytes(item.bytes.byteLength)}</span>
  </div>
</div>

<style>
  .card {
    position: relative;
    width: 88px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    user-select: none;
  }

  .thumb {
    position: relative;
    width: 88px;
    height: 66px;
    padding: 4px;
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition:
      border-color var(--dur-short) var(--ease-out),
      box-shadow var(--dur-short) var(--ease-out);
  }
  .thumb:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    pointer-events: none;
  }
  .card.current .thumb {
    border-color: var(--accent);
  }

  .edited {
    position: absolute;
    bottom: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .controls {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 3px;
    opacity: 0;
    transition: opacity var(--dur-short) var(--ease-out);
  }
  .card:hover .controls,
  .card:focus-within .controls {
    opacity: 1;
  }

  /* 터치 기기엔 hover도 focus-within도 없다 — 컨트롤을 항상 노출한다.
   * 이게 없으면 폰·태블릿에서 회전·삭제에 아예 닿을 수 없다. */
  @media (hover: none) {
    .controls {
      opacity: 1;
    }
  }
  .controls button {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-1);
    padding: 0;
  }
  .controls button.danger:hover {
    color: var(--accent-contrast);
    background: var(--danger);
    border-color: var(--danger);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    padding: 0 2px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card.current .name {
    color: var(--accent-ink);
    font-weight: 700;
  }
  .size {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
</style>
