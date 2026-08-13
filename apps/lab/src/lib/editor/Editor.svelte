<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import Panel from "./Panel.svelte";
  import Matrix from "./Matrix.svelte";
  import Bump from "./Bump.svelte";
  import Neighbors from "./Neighbors.svelte";
  import ScoreCard from "./ScoreCard.svelte";
  import Storage from "./Storage.svelte";
  import Judge from "./Judge.svelte";
  import Pareto from "./Pareto.svelte";
  import { lab, type View } from "./state.svelte";

  let storageOpen = $state(false);

  type TabIcon = "grid" | "shuffle" | "list" | "gavel" | "scatter";
  const tabs: { id: View; label: string; icon: TabIcon }[] = [
    { id: "matrix", label: t.view.matrix, icon: "grid" },
    { id: "bump", label: t.view.bump, icon: "shuffle" },
    { id: "neighbors", label: t.view.neighbors, icon: "list" },
    { id: "judge", label: t.view.judge, icon: "gavel" },
    { id: "pareto", label: t.view.pareto, icon: "scatter" },
  ];

  /** 뷰가 그릴 대상 — B가 있으면 B(가장 최근 실행), 없으면 A. */
  const primary = $derived(lab.viewB ?? lab.viewA);
  const primarySlot = $derived<"A" | "B">(lab.viewB ? "B" : "A");
  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="editor">
  <Panel onStorage={() => (storageOpen = true)} />

  <main class="stage">
    {#if !primary}
      <div class="blank">
        <h1>{t.intro.title}</h1>
        <p>{t.intro.sub}</p>
      </div>
    {:else}
      <!-- ── 비교 지표 ─────────────────────────────── -->
      <div class="metrics">
        <div class="slots">
          <span class="chip" data-slot="A">A · {lab.viewA?.label ?? t.compare.pick}</span>
          <span class="chip" data-slot="B">B · {lab.viewB?.label ?? t.compare.pick}</span>
        </div>

        {#if lab.comparable && lab.overlap !== null && lab.spearman !== null}
          <div class="nums">
            <span class="num" title={t.compare.overlapHelp}>
              <span class="nlabel">{t.compare.overlap(lab.topK)}</span>
              <span class="nval">{pct(lab.overlap)}</span>
            </span>
            <span class="num" title={t.compare.spearmanHelp}>
              <span class="nlabel">{t.compare.spearman}</span>
              <span class="nval">{lab.spearman.toFixed(3)}</span>
            </span>
          </div>

          <!-- 겹침·상관은 "무엇이 달라졌나"까지다. 어느 쪽이 나은지는 여기서 답한다. -->
          {#if lab.verdict}
            <div class="verdict" class:differs={lab.verdict.significant} title={t.verdict.help}>
              <span class="vhead">
                {lab.verdict.significant ? t.verdict.differs : t.verdict.same}
              </span>
              <span class="vsub">
                {t.verdict.discordant(lab.verdict.discordant)} · {t.verdict.p(lab.verdict.p)}
              </span>
              {#if lab.verdict.need}
                <span class="vsub">{t.verdict.need(lab.verdict.need)}</span>
              {/if}
            </div>
          {/if}
        {:else}
          <span class="need"><Icon name="info" size={13} />{t.compare.needTwo}</span>
        {/if}

        <label class="topk">
          <span>{t.view.topK}</span>
          <input
            type="range"
            min="1"
            max="20"
            value={lab.topK}
            oninput={(e) => (lab.topK = Number(e.currentTarget.value))}
          />
          <span class="kval">{lab.topK}</span>
        </label>
      </div>

      <!-- ── 뷰 탭 ──────────────────────────────────── -->
      <div class="tabs" role="tablist">
        {#each tabs as tab (tab.id)}
          <button
            class="btn small"
            class:active={lab.view === tab.id}
            role="tab"
            aria-selected={lab.view === tab.id}
            onclick={() => (lab.view = tab.id)}
          >
            <Icon name={tab.icon} size={14} />
            <span>{tab.label}</span>
          </button>
        {/each}
      </div>

      <div class="view">
        {#if lab.view === "matrix"}
          <Matrix view={primary} slot={primarySlot} />
        {:else if lab.view === "bump"}
          {#if lab.viewA && lab.viewB}
            <Bump viewA={lab.viewA} viewB={lab.viewB} />
          {:else}
            <p class="need-two">{t.compare.needTwo}</p>
          {/if}
        {:else if lab.view === "judge"}
          <Judge />
        {:else if lab.view === "pareto"}
          <Pareto />
        {:else}
          <Neighbors view={primary} />
        {/if}
      </div>

      {#if lab.view !== "pareto"}
        <ScoreCard view={primary} />
      {/if}

      <p class="timing">
        {t.run.loadMs} {Math.round(primary.run.loadMs)}ms · {t.run.embedMs}
        {Math.round(primary.run.embedMs)}ms ·
        {t.run.throughput(
          primary.run.embedMs > 0
            ? (primary.count / primary.run.embedMs) * 1000
            : 0,
        )}
      </p>
    {/if}
  </main>
</div>

<Storage open={storageOpen} onClose={() => (storageOpen = false)} />

<style>
  .editor {
    display: grid;
    grid-template-columns: minmax(280px, 320px) 1fr;
    height: 100%;
    min-height: 0;
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    padding: var(--space-lg);
    overflow-y: auto;
    min-width: 0;
  }

  .blank {
    margin: auto;
    max-width: 34ch;
    text-align: center;
  }
  .blank h1 {
    margin: 0 0 var(--space-sm);
    font-size: var(--text-4xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .blank p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-lg);
    line-height: 1.6;
  }

  /* ── 지표 막대 ── */
  .metrics {
    display: flex;
    align-items: center;
    gap: var(--space-lg);
    flex-wrap: wrap;
    padding: var(--space-sm) var(--space-md);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    min-width: 0;
  }
  .chip {
    font-size: var(--text-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip[data-slot="A"] {
    border-left: 3px solid var(--cat-1);
    padding-left: var(--space-xs);
  }
  .chip[data-slot="B"] {
    border-left: 3px solid var(--cat-3);
    padding-left: var(--space-xs);
  }

  .nums {
    display: flex;
    gap: var(--space-xl);
  }
  .num {
    display: flex;
    flex-direction: column;
    gap: 1px;
    cursor: help;
  }
  .nlabel {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .nval {
    font-family: var(--font-mono);
    font-size: var(--text-4xl);
    font-weight: 600;
    line-height: 1.1;
  }
  .need {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .verdict {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2xs) var(--space-sm);
    border-left: 3px solid var(--border-strong);
    cursor: help;
  }
  .verdict.differs {
    border-left-color: var(--success);
  }
  .vhead {
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .verdict.differs .vhead {
    color: var(--success);
  }
  .vsub {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .topk {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-left: auto;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .topk input {
    width: 110px;
    accent-color: var(--accent);
  }
  .kval {
    font-family: var(--font-mono);
    width: 2ch;
  }

  .tabs {
    display: flex;
    gap: var(--space-2xs);
  }

  .view {
    min-width: 0;
  }
  .need-two {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  .timing {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  @media (max-width: 900px) {
    .editor {
      grid-template-columns: 1fr;
      height: auto;
    }
  }
</style>
