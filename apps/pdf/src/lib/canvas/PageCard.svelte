<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import type { PageItem } from "../pdf/types";

  let {
    page,
    onToggle,
    onRotate,
    onDelete,
  }: {
    page: PageItem;
    onToggle: () => void;
    onRotate: () => void;
    onDelete: () => void;
  } = $props();
</script>

<div class="card" class:selected={page.selected}>
  <button
    type="button"
    class="thumb"
    onclick={onToggle}
    title={t.canvas.select}
    aria-pressed={page.selected}
  >
    <img
      src={page.thumb}
      alt={page.label}
      draggable="false"
      style={`transform: rotate(${page.rotation}deg)`}
    />
    <span class="check" aria-hidden="true">
      {#if page.selected}<Icon name="check" size={13} />{/if}
    </span>
  </button>

  <div class="controls">
    <button type="button" onclick={onRotate} title={t.canvas.rotate}>
      <Icon name="rotate" size={15} />
    </button>
    <button type="button" class="danger" onclick={onDelete} title={t.canvas.delete}>
      <Icon name="trash" size={15} />
    </button>
  </div>

  <div class="label" title={page.label}>{page.label}</div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    user-select: none;
  }

  .thumb {
    position: relative;
    aspect-ratio: 3 / 4;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .thumb:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    box-shadow: var(--shadow-1);
    background: #fff;
    transition: transform 0.18s ease;
    pointer-events: none;
  }

  .card.selected .thumb {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-weak);
  }

  .check {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: transparent;
  }
  .card.selected .check {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }

  .controls {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .card:hover .controls,
  .card:focus-within .controls {
    opacity: 1;
  }
  .controls button {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-1);
  }
  .controls button:hover {
    color: var(--text);
  }
  .controls button.danger:hover {
    color: var(--accent-contrast);
    background: var(--danger);
    border-color: var(--danger);
  }

  .label {
    font-size: 11.5px;
    color: var(--text-muted);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* .card 는 position 컨텍스트가 필요(컨트롤/체크 절대배치) */
  .card {
    position: relative;
  }
</style>
