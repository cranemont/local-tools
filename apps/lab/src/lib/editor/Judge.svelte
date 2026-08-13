<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { pool, readMark, relevantFor } from "../embed/judge";
  import { lab } from "./state.svelte";

  const items = $derived(lab.items);
  const n = $derived(lab.viewA?.count ?? lab.viewB?.count ?? 0);
  const focus = $derived(Math.min(lab.focus, Math.max(0, n - 1)));

  let depth = $state(10);

  /** 지금까지 돌린 **모든** 실행의 점수판 — 풀링은 슬롯 A·B에 국한되지 않는다. */
  const matrices = $derived(
    lab.runs
      .filter((r) => r.corpusKey === lab.corpusKey)
      .map((r) => (r.kind === "lexical" ? r.matrix : null))
      .filter((m): m is Float32Array => m !== null)
      .concat([lab.viewA?.matrix, lab.viewB?.matrix].filter((m): m is Float32Array => !!m)),
  );

  const candidates = $derived(n > 0 && matrices.length ? pool(matrices, n, focus, depth) : []);
  const relevant = $derived(relevantFor(lab.marks, focus));
  // marksRev를 읽어 표를 누를 때마다 다시 그린다
  const markOf = $derived.by(() => {
    lab.marksRev;
    return (doc: number) => readMark(lab.marks, focus, doc);
  });

  function clearAll() {
    if (confirm(t.judge.confirmClear)) lab.clearMarks();
  }
</script>

<div class="judge">
  <p class="intro">{t.judge.intro}</p>

  <div class="bar">
    <label class="picker">
      <span>{t.judge.query}</span>
      <select value={String(focus)} onchange={(e) => (lab.focus = Number(e.currentTarget.value))}>
        {#each items as item, i (i)}
          <option value={String(i)}>{item.text}</option>
        {/each}
      </select>
    </label>

    <label class="depth">
      <span>{t.judge.depth}</span>
      <input
        type="range"
        min="3"
        max="20"
        value={depth}
        oninput={(e) => (depth = Number(e.currentTarget.value))}
      />
      <span class="dval">{depth}</span>
    </label>
  </div>

  {#if !matrices.length}
    <p class="empty">{t.judge.needRun}</p>
  {:else}
    <ul class="cands">
      {#each candidates as c (c.doc)}
        {@const mark = markOf(c.doc)}
        <li class:self={c.doc === focus}>
          <span class="txt">{items[c.doc]?.text}</span>
          <span class="votes">{t.judge.votes(c.votes)}</span>
          <span class="acts">
            <button
              class="btn small"
              class:active={mark === true}
              onclick={() => lab.mark(focus, c.doc, mark === true ? null : true)}
            >
              <Icon name="check" size={13} />
              <span>{t.judge.relevant}</span>
            </button>
            <button
              class="btn small"
              class:active={mark === false}
              onclick={() => lab.mark(focus, c.doc, mark === false ? null : false)}
            >
              <Icon name="x" size={13} />
              <span>{t.judge.notRelevant}</span>
            </button>
          </span>
        </li>
      {/each}
    </ul>

    <p class="bias"><Icon name="info" size={13} /><span>{t.judge.bias}</span></p>

    <footer>
      <span class="counts">
        {t.judge.marks(Object.keys(lab.marks).length)} · {t.ir.queries(lab.viewA?.ir.queries ?? 0)}
        {#if relevant.size}· 이 질의 정답 {relevant.size}개{/if}
      </span>
      <span class="acts">
        {#if lab.source === "probe"}
          <button class="btn small" title={t.judge.seedHelp} onclick={() => lab.seedMarks()}>
            {t.judge.seed}
          </button>
        {/if}
        <button class="btn small ghost danger" onclick={clearAll}>{t.judge.clear}</button>
      </span>
    </footer>
    <p class="saved">{t.judge.saved}</p>
  {/if}
</div>

<style>
  .judge {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .intro,
  .saved,
  .empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-lg);
    flex-wrap: wrap;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex: 1;
    min-width: 240px;
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
  .depth {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .depth input {
    width: 100px;
    accent-color: var(--accent);
  }
  .dval {
    font-family: var(--font-mono);
    width: 2ch;
  }

  .cands {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .cands li {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
  }
  .cands li:last-child {
    border-bottom: 0;
  }
  /* 자기 자신은 이웃이 아니라 질의다 — 판정 대상에서 눈으로 구분되게 */
  .cands li.self {
    background: var(--surface-2);
  }
  .txt {
    flex: 1;
    min-width: 0;
    font-size: var(--text-base);
    line-height: 1.45;
  }
  .votes {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .acts {
    display: flex;
    gap: var(--space-2xs);
    flex: none;
  }

  .bias {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    margin: 0;
    padding: var(--space-sm);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--text-muted);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
    flex-wrap: wrap;
  }
  .counts {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  @media (max-width: 700px) {
    .cands li {
      flex-wrap: wrap;
    }
    .txt {
      flex-basis: 100%;
    }
  }
</style>
