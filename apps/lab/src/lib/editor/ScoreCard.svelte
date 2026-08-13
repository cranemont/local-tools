<script lang="ts">
  import { t } from "../i18n";
  import { wilson } from "../embed/stats";
  import { lab, type SlotView } from "./state.svelte";

  let { view }: { view: SlotView } = $props();

  const report = $derived(view.report);
  const ir = $derived(view.ir);
  const ci = $derived(wilson(report.hits, report.total));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

{#if ir.queries > 0}
  <!-- 판정을 매겼으면 그게 이 코퍼스의 진짜 정답이다 — 짝짓기보다 위에 둔다. -->
  <section class="card">
    <header>
      <h3>{t.ir.title}</h3>
      <span class="overall">{t.ir.queries(ir.queries)}</span>
    </header>
    <p class="note">{t.ir.help}</p>
    <ul class="irnums">
      <li>
        <span class="irlabel">{t.ir.ndcg(ir.k)}</span>
        <span class="irval">{ir.ndcg.mean.toFixed(3)}</span>
        <span class="irci">{t.ir.ci(ir.ndcg.lo, ir.ndcg.hi)}</span>
      </li>
      <li>
        <span class="irlabel">{t.ir.recall(ir.k)}</span>
        <span class="irval">{ir.recall.mean.toFixed(3)}</span>
        <span class="irci">{t.ir.ci(ir.recall.lo, ir.recall.hi)}</span>
      </li>
      <li>
        <span class="irlabel">{t.ir.mrr}</span>
        <span class="irval">{ir.mrr.mean.toFixed(3)}</span>
        <span class="irci">{t.ir.ci(ir.mrr.lo, ir.mrr.hi)}</span>
      </li>
    </ul>
  </section>
{/if}

<section class="card">
  <header>
    <h3>{t.score.title}</h3>
    {#if report.rate !== null}
      <span class="overall">
        {report.hits}/{report.total} · {pct(report.rate)}
        <span class="ci" title={t.score.ciHelp}>{t.score.ci(ci.lo, ci.hi)}</span>
      </span>
    {/if}
  </header>

  {#if report.rate === null}
    <p class="note">{t.score.none}</p>
  {:else}
    <p class="note">{t.score.help}</p>

    <ul class="kinds">
      {#each report.kinds as k (k.kind)}
        <li>
          <span class="klabel">{k.label}</span>
          <span class="track">
            <span class="fillbar" style:width={pct(k.rate ?? 0)}></span>
          </span>
          <span class="kval">{k.hits}/{k.total}</span>
        </li>
      {/each}
    </ul>

    {#if report.misses.length}
      <h4>{t.score.misses}</h4>
      <ul class="misses">
        {#each report.misses as m (m.index)}
          <li>
            <button class="miss" onclick={() => (lab.focus = m.index)}>
              <span class="mtext">{m.text}</span>
              <span class="mtook">{t.score.took}: {m.tookText}</span>
            </button>
            <span class="mscore">{m.tookScore.toFixed(3)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="note good">{t.score.perfect}</p>
    {/if}
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  h3 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }
  h4 {
    margin: var(--space-2xs) 0 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .overall {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--accent-ink);
  }
  /* 큰 숫자 옆에 언제나 폭을 붙여 둔다 — 40문장에서 100%는 [91%, 100%]다. */
  .ci {
    margin-left: var(--space-2xs);
    font-size: var(--text-2xs);
    font-weight: 400;
    color: var(--text-muted);
    cursor: help;
  }

  .irnums {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xl);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .irnums li {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .irlabel {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .irval {
    font-family: var(--font-mono);
    font-size: var(--text-4xl);
    font-weight: 600;
    line-height: 1.1;
  }
  .irci {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .note {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .note.good {
    color: var(--success);
  }

  .kinds {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .kinds li {
    display: grid;
    grid-template-columns: 5.5em 1fr auto;
    align-items: center;
    gap: var(--space-sm);
  }
  .klabel {
    font-size: var(--text-sm);
  }
  .track {
    height: 6px;
    background: var(--surface-2);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .fillbar {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .kval {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .misses {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .misses li {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
  }
  .miss {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0;
    text-align: left;
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
  }
  .mtext {
    font-size: var(--text-sm);
    line-height: 1.4;
  }
  .mtook {
    font-size: var(--text-2xs);
    color: var(--danger);
    line-height: 1.4;
  }
  .miss:hover .mtext {
    color: var(--accent-ink);
  }
  .mscore {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
