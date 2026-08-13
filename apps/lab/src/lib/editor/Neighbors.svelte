<script lang="ts">
  import { t } from "../i18n";
  import { groupLabel } from "../corpus/samples";
  import { topK } from "../embed/vector";
  import { lab, type SlotView } from "./state.svelte";

  let { view }: { view: SlotView } = $props();

  const items = $derived(lab.items);
  const n = $derived(view.count);
  const focus = $derived(Math.min(lab.focus, Math.max(0, n - 1)));
  const list = $derived(topK(view.matrix, n, focus, Math.min(lab.topK, Math.max(1, n - 1))));
  const current = $derived(items[focus]);
</script>

<div class="neighbors">
  <ol class="items">
    {#each items as item, i (i)}
      <li>
        <button class="item" class:on={i === focus} onclick={() => (lab.focus = i)}>
          {#if item.kind}
            <span class="tag">{groupLabel(item.kind)}</span>
          {/if}
          <span class="txt">{item.text}</span>
        </button>
      </li>
    {/each}
  </ol>

  <div class="detail">
    {#if current}
      <p class="self">
        <span class="badge">{t.neighbors.self}</span>
        {current.text}
      </p>
      <ol class="ranks">
        {#each list as x, r (x.index)}
          {@const other = items[x.index]}
          {@const partner =
            !!current.probeId && other?.probeId === current.probeId}
          <li class:partner>
            <span class="rank">{r + 1}</span>
            <button class="jump" onclick={() => (lab.focus = x.index)}>{other?.text}</button>
            {#if partner}<span class="badge ok">{t.neighbors.partner}</span>{/if}
            <span class="score">{x.score.toFixed(4)}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="empty">{t.neighbors.empty}</p>
    {/if}
  </div>
</div>

<style>
  .neighbors {
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(260px, 1.4fr);
    gap: var(--space-xl);
    align-items: start;
  }

  .items {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 60vh;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .item {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    text-align: left;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: var(--text-base);
    line-height: 1.45;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.on {
    background: var(--accent-weak);
    color: var(--accent-ink);
  }
  .tag {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .txt {
    flex: 1;
    min-width: 0;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .self {
    margin: 0;
    padding: var(--space-sm);
    font-size: var(--text-lg);
    line-height: 1.5;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }
  .badge {
    display: inline-block;
    margin-right: var(--space-2xs);
    padding: 1px var(--space-xs);
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--accent-ink);
    background: var(--accent-weak);
    border-radius: var(--radius-pill);
  }
  .badge.ok {
    color: var(--success);
    background: transparent;
    border: 1px solid var(--success);
  }

  .ranks {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }
  .ranks li {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    padding: var(--space-xs) 0;
    border-bottom: 1px solid var(--border);
  }
  .rank {
    flex: none;
    width: 18px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .jump {
    flex: 1;
    min-width: 0;
    padding: 0;
    text-align: left;
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    font-size: var(--text-base);
    line-height: 1.45;
  }
  .jump:hover {
    color: var(--accent-ink);
  }
  .score {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  @media (max-width: 760px) {
    .neighbors {
      grid-template-columns: 1fr;
    }
  }
</style>
