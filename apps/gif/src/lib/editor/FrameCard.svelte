<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import type { Frame } from "../gif/types";

  let { frame, index }: { frame: Frame; index: number } = $props();

  const isCurrent = $derived(index === editor.current);

  function activate() {
    editor.playing = false;
    editor.current = index;
  }
</script>

<div class="card" class:selected={frame.selected} class:current={isCurrent}>
  <button type="button" class="thumb" onclick={activate} title={t.frames.activate}>
    <img src={frame.thumb} alt={`#${index + 1}`} draggable="false" />
  </button>

  <button
    type="button"
    class="check"
    class:on={frame.selected}
    title={t.frames.select}
    aria-pressed={frame.selected}
    onclick={() => editor.toggleSelect(frame.id)}
  >
    {#if frame.selected}<Icon name="check" size={12} />{/if}
  </button>

  <div class="controls">
    <button
      type="button"
      onclick={() => editor.duplicateOne(frame.id)}
      title={t.frames.duplicate}
    >
      <Icon name="copy" size={13} />
    </button>
    <button
      type="button"
      class="danger"
      onclick={() => editor.deleteOne(frame.id)}
      title={t.frames.delete}
    >
      <Icon name="trash" size={13} />
    </button>
  </div>

  <div class="meta">
    <span class="idx">{index + 1}</span>
    <span class="delay">{t.frames.delayBadge(frame.delayMs)}</span>
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
      border-color 0.12s ease,
      box-shadow 0.12s ease;
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
  .card.selected .thumb {
    box-shadow: 0 0 0 2px var(--accent-weak);
  }

  .check {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: transparent;
    padding: 0;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }

  .controls {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 3px;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .card:hover .controls,
  .card:focus-within .controls {
    opacity: 1;
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
  .controls button:hover {
    color: var(--text);
  }
  .controls button.danger:hover {
    color: var(--accent-contrast);
    background: var(--danger);
    border-color: var(--danger);
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10.5px;
    color: var(--text-muted);
    padding: 0 2px;
  }
  .card.current .idx {
    color: var(--accent);
    font-weight: 700;
  }
  .delay {
    font-variant-numeric: tabular-nums;
  }
</style>
