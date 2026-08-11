<script lang="ts">
  // 요약 숫자 + 레인 필터 + 검색.
  // 필터로 뭔가 사라졌으면 반드시 그 사실을 적는다 — 조용히 줄어든 지도는 거짓말이 된다.
  import { graph } from "./state.svelte";
  import { KIND_LABEL, KIND_ORDER, SUMMARY, TECHS } from "../data/stack";
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";

  const laneCount = (kind: (typeof KIND_ORDER)[number]) =>
    TECHS.filter((tech) => tech.kind === kind).length;

  const stats = [
    { label: t.summary.apps, value: SUMMARY.apps },
    { label: t.summary.features, value: SUMMARY.features },
    { label: t.summary.techs, value: SUMMARY.techs },
    { label: t.summary.thirdParty, value: SUMMARY.thirdParty },
    { label: t.summary.wasm, value: SUMMARY.wasm },
  ];

  const hidden = $derived(graph.hiddenFeatures + graph.hiddenTechs > 0);
</script>

<div class="controls">
  <div class="stats">
    {#each stats as stat (stat.label)}
      <div class="stat">
        <span class="num">{stat.value}</span>
        <span class="cap">{stat.label}</span>
      </div>
    {/each}
    <div class="stat net">
      <span class="num">{SUMMARY.network}</span>
      <span class="cap">{t.summary.network}</span>
    </div>
    <p class="hint">{t.summary.networkHint}</p>
  </div>

  <div class="row">
    <div class="lanes" role="group" aria-label={t.controls.lanes}>
      {#each KIND_ORDER as kind (kind)}
        <button
          class="btn small pill lane k-{kind}"
          class:active={graph.kinds.includes(kind)}
          aria-pressed={graph.kinds.includes(kind)}
          onclick={() => graph.toggleKind(kind)}
        >
          <span class="swatch"></span>
          {KIND_LABEL[kind]}
          <span class="count">{laneCount(kind)}</span>
        </button>
      {/each}
    </div>

    <button
      class="btn small pill netonly"
      class:active={graph.networkOnly}
      aria-pressed={graph.networkOnly}
      title={t.controls.networkOnlyHint}
      onclick={() => graph.toggleNetworkOnly()}
    >
      <Icon name="globe" size={14} />
      {t.controls.networkOnly}
    </button>

    <div class="search">
      <Icon name="search" size={15} />
      <input
        type="search"
        aria-label={t.controls.searchLabel}
        placeholder={t.controls.searchPlaceholder}
        bind:value={graph.query}
      />
      {#if graph.query}
        <button
          class="icon-btn tiny"
          title={t.controls.searchClear}
          onclick={() => (graph.query = "")}
        >
          <Icon name="x" size={13} />
          <span class="sr-only">{t.controls.searchClear}</span>
        </button>
      {/if}
    </div>
  </div>

  {#if graph.query || hidden}
    <div class="notes">
      {#if graph.query}
        <span class="note" class:warn={graph.matchCount === 0}>
          {graph.matchCount === 0 ? t.controls.noMatch : t.controls.matchCount(graph.matchCount)}
        </span>
      {/if}
      {#if hidden}
        <span class="note">
          {t.controls.hidden(graph.hiddenFeatures, graph.hiddenTechs)}
        </span>
      {/if}
      <button class="btn small ghost" onclick={() => graph.resetFilters()}>
        {t.controls.reset}
      </button>
    </div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  /* ── 요약 숫자 ─────────────────────────────────────────── */
  .stats {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-lg);
  }
  .stat {
    display: flex;
    align-items: baseline;
    gap: var(--space-2xs);
  }
  .num {
    font-size: var(--text-4xl);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .cap {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .stat.net .num {
    color: var(--cat-4-ink);
  }
  .hint {
    margin: 0;
    flex: 1 1 auto;
    min-width: 12ch;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* ── 필터 줄 ──────────────────────────────────────────── */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .lanes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .lane .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--k);
  }
  /* 꺼진 레인은 색 점도 같이 꺼진다 — 켜짐/꺼짐이 한눈에 보여야 한다 */
  .lane:not(.active) .swatch {
    background: var(--border-strong);
  }
  .count {
    color: var(--text-muted);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .lane.active .count {
    color: inherit;
  }
  .netonly.active {
    background: color-mix(in srgb, var(--cat-4) 16%, transparent);
    border-color: var(--cat-4);
    color: var(--cat-4-ink);
  }

  /* ── 검색 ─────────────────────────────────────────────── */
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex: 1 1 220px;
    min-width: 180px;
    padding: 0 var(--space-sm);
    height: 32px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-muted);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-base);
    outline: none;
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .icon-btn.tiny {
    width: 22px;
    height: 22px;
    border-color: transparent;
  }

  /* ── 상태 알림 ────────────────────────────────────────── */
  .notes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .note.warn {
    color: var(--danger);
  }
</style>
