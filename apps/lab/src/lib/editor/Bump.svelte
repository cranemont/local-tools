<script lang="ts">
  import { t } from "../i18n";
  import { topK } from "../embed/vector";
  import { lab, type SlotView } from "./state.svelte";

  let { viewA, viewB }: { viewA: SlotView; viewB: SlotView } = $props();

  const ROW = 34;

  const items = $derived(lab.items);
  const n = $derived(viewA.count);
  const k = $derived(Math.min(lab.topK, Math.max(1, n - 1)));

  const listA = $derived(topK(viewA.matrix, n, lab.focus, k));
  const listB = $derived(topK(viewB.matrix, n, lab.focus, k));

  const rankB = $derived(new Map(listB.map((x, r) => [x.index, r])));
  const rankA = $derived(new Map(listA.map((x, r) => [x.index, r])));

  const height = $derived(Math.max(listA.length, listB.length) * ROW);

  type Link = { y1: number; y2: number; kind: "stayed" | "moved" | "left" | "entered" };

  const links = $derived.by<Link[]>(() => {
    const out: Link[] = [];
    listA.forEach((a, r) => {
      const to = rankB.get(a.index);
      if (to === undefined) out.push({ y1: mid(r), y2: mid(r), kind: "left" });
      else out.push({ y1: mid(r), y2: mid(to), kind: to === r ? "stayed" : "moved" });
    });
    listB.forEach((b, r) => {
      if (!rankA.has(b.index)) out.push({ y1: mid(r), y2: mid(r), kind: "entered" });
    });
    return out;
  });

  function mid(row: number): number {
    return row * ROW + ROW / 2;
  }

  function shift(index: number): string {
    const a = rankA.get(index);
    const b = rankB.get(index);
    if (a === undefined || b === undefined) return "";
    const d = a - b;
    return d === 0 ? "=" : d > 0 ? `▲${d}` : `▼${-d}`;
  }
</script>

<div class="bump">
  <label class="picker">
    <span>{t.bump.query}</span>
    <select value={String(lab.focus)} onchange={(e) => (lab.focus = Number(e.currentTarget.value))}>
      {#each items as item, i (i)}
        <option value={String(i)}>{item.text}</option>
      {/each}
    </select>
  </label>

  <div class="cols" style:--row={`${ROW}px`}>
    <ol class="col">
      <li class="head" data-slot="A">{viewA.label}</li>
      {#each listA as x, r (x.index)}
        <li class="row" class:dropped={!rankB.has(x.index)}>
          <span class="rank">{r + 1}</span>
          <span class="text">{items[x.index]?.text}</span>
          <span class="score">{x.score.toFixed(4)}</span>
        </li>
      {/each}
    </ol>

    <div class="mid">
      <div class="mid-head"></div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style:height={`${height}px`}>
        {#each links as l, i (i)}
          {#if l.kind === "left"}
            <path d={`M0 ${l.y1} L 46 ${l.y1}`} class="link left" />
          {:else if l.kind === "entered"}
            <path d={`M54 ${l.y2} L 100 ${l.y2}`} class="link entered" />
          {:else}
            <path
              d={`M0 ${l.y1} C 40 ${l.y1}, 60 ${l.y2}, 100 ${l.y2}`}
              class="link {l.kind}"
            />
          {/if}
        {/each}
      </svg>
    </div>

    <ol class="col">
      <li class="head" data-slot="B">{viewB.label}</li>
      {#each listB as x, r (x.index)}
        <li class="row" class:fresh={!rankA.has(x.index)}>
          <span class="rank">{r + 1}</span>
          <span class="text">{items[x.index]?.text}</span>
          <span class="delta">{shift(x.index)}</span>
          <span class="score">{x.score.toFixed(4)}</span>
        </li>
      {/each}
    </ol>
  </div>

  <ul class="key">
    <li><i class="sw stayed"></i>{t.bump.stayed}</li>
    <li><i class="sw moved"></i>{t.bump.moved}</li>
    <li><i class="sw entered"></i>{t.bump.entered}</li>
    <li><i class="sw left"></i>{t.bump.left}</li>
  </ul>
</div>

<style>
  .bump {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .picker {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .picker select {
    flex: 1;
    min-width: 0;
    padding: var(--space-2xs) var(--space-xs);
    font: inherit;
    font-size: var(--text-base);
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .cols {
    display: grid;
    grid-template-columns: 1fr 100px 1fr;
    gap: var(--space-sm);
    align-items: start;
  }

  .col {
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }

  .head {
    height: var(--row);
    display: flex;
    align-items: center;
    padding: 0 var(--space-xs);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head[data-slot="A"] {
    border-bottom-color: var(--cat-1);
  }
  .head[data-slot="B"] {
    border-bottom-color: var(--cat-3);
  }

  .row {
    height: var(--row);
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 0 var(--space-xs);
    font-size: var(--text-base);
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .row.dropped {
    color: var(--text-muted);
  }
  .row.fresh {
    background: var(--accent-weak);
  }
  .rank {
    flex: none;
    width: 18px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .score,
  .delta {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .mid {
    min-width: 0;
  }
  .mid-head {
    height: var(--row);
  }
  .mid svg {
    display: block;
    width: 100%;
    overflow: visible;
  }

  .link {
    fill: none;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .link.stayed {
    stroke: var(--border-strong);
  }
  .link.moved {
    stroke: var(--cat-3);
  }
  .link.entered {
    stroke: var(--cat-2);
    stroke-dasharray: 3 3;
  }
  .link.left {
    stroke: var(--cat-4);
    stroke-dasharray: 3 3;
  }

  .key {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-md);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .key li {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
  }
  .sw {
    width: 14px;
    height: 2px;
    border-radius: 1px;
  }
  .sw.stayed {
    background: var(--border-strong);
  }
  .sw.moved {
    background: var(--cat-3);
  }
  .sw.entered {
    background: var(--cat-2);
  }
  .sw.left {
    background: var(--cat-4);
  }

  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
    .mid {
      display: none;
    }
  }
</style>
