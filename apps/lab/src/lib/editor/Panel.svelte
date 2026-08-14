<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { MODELS, dtypeBytes, truncationSteps } from "../embed/registry";
  import { formatBytes } from "../embed/cache";
  import { dimsOf, lab, MAX_ITEMS, runLabel, type Slot } from "./state.svelte";

  let { onStorage }: { onStorage: () => void } = $props();

  const spec = $derived(lab.spec);
  const steps = $derived(truncationSteps(spec));
  const lexical = $derived(spec.kind === "lexical");

  /** 슬롯 셀렉트의 선택지 — 실행 × 절단 단계(그 실행 자신의 눈금으로). */
  interface Choice {
    value: string;
    label: string;
  }
  const choices = $derived.by<Choice[]>(() =>
    lab.runs.flatMap((run) =>
      dimsOf(run).map((dim) => ({
        value: `${run.id}:${dim}`,
        label: runLabel(run, dim),
      })),
    ),
  );

  function slotValue(slot: Slot | null): string {
    return slot ? `${slot.runId}:${slot.dim}` : "";
  }

  function pick(which: "A" | "B", value: string) {
    if (!value) return lab.setSlot(which, null);
    const [runId, dim] = value.split(":");
    lab.setSlot(which, { runId, dim: Number(dim) });
  }
</script>

<aside class="panel">
  <!-- ── 코퍼스 ─────────────────────────────────────── -->
  <section class="block">
    <h2>{t.corpus.title}</h2>
    <div class="seg" role="group">
      <button
        class="btn small"
        class:active={lab.source === "probe"}
        onclick={() => lab.setSource("probe")}
      >
        {t.corpus.probe}
      </button>
      <button
        class="btn small"
        class:active={lab.source === "pasted"}
        onclick={() => lab.setSource("pasted")}
      >
        {t.corpus.pasted}
      </button>
    </div>

    {#if lab.source === "pasted"}
      <textarea
        class="paste"
        rows="6"
        placeholder={t.corpus.placeholder}
        value={lab.pastedText}
        oninput={(e) => lab.setPasted(e.currentTarget.value)}
      ></textarea>
    {/if}

    <p class="meta">
      {t.corpus.count(lab.items.length)}
      {#if lab.truncated}<span class="warn"> · {t.corpus.tooMany(MAX_ITEMS)}</span>{/if}
    </p>
  </section>

  <!-- ── 모델 ──────────────────────────────────────── -->
  <section class="block">
    <h2>{t.model.title}</h2>
    <div class="models">
      {#each MODELS as m (m.id)}
        <button
          class="model"
          class:on={lab.modelId === m.id}
          onclick={() => lab.selectModel(m.id)}
          disabled={lab.busy}
        >
          <span class="model-top">
            <span class="model-name">{m.label}</span>
            {#if m.koScore !== null}
              <span class="ko" title={t.model.koScoreHelp}>{m.koScore.toFixed(1)}</span>
            {:else}
              <span class="ko muted" title={t.model.koScoreHelp}>{t.model.noScore}</span>
            {/if}
          </span>
          <span class="model-meta">
            {#if m.kind === "lexical"}
              {formatBytes(0)} · {t.model.noDownload}
            {:else}
              {t.model.params(m.params)} · {t.model.dim(m.dim)} · {t.model.ctx(m.ctx)}
            {/if}
          </span>
          <span class="model-note">{m.note}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ── 정밀도·프리픽스 ───────────────────────────────
       BM25에는 정밀도도 차원도 프리픽스도 없다 — 통째로 감춘다. -->
  {#if !lexical}
  <section class="block">
    <h2>{t.model.precision}</h2>
    <div class="dtypes">
      {#each spec.dtypes as d (d.id)}
        <label class="dtype" class:on={lab.dtype === d.id}>
          <input
            type="radio"
            name="dtype"
            value={d.id}
            checked={lab.dtype === d.id}
            disabled={lab.busy}
            onchange={() => (lab.dtype = d.id)}
          />
          <span class="dtype-id">{d.id}</span>
          <span class="dtype-size">{formatBytes(dtypeBytes(spec, d.id))}</span>
          {#if d.note}<span class="dtype-note">{d.note}</span>{/if}
        </label>
      {/each}
    </div>

    <label class="check" class:disabled={!spec.prefix}>
      <input
        type="checkbox"
        checked={lab.usePrefix}
        disabled={lab.busy || !spec.prefix}
        onchange={(e) => (lab.usePrefix = e.currentTarget.checked)}
      />
      <span>{t.model.prefix}</span>
    </label>
    {#if !spec.prefix}
      <p class="hint">{t.model.noPrefix}</p>
    {/if}
    <!-- MRL 학습분이 있으면 그 단계가 곧 절단 후보라 한 줄이면 된다.
         없을 때만 우리가 만든 실험용 눈금을 따로 보여 준다. -->
    <p class="hint" class:warn={!spec.mrl.length}>
      {spec.mrl.length ? `${t.model.mrl} · ${spec.mrl.join(" / ")}` : t.model.noMrl}
    </p>
    {#if !spec.mrl.length}
      <p class="hint">{steps.join(" / ")}</p>
    {/if}
  </section>
  {/if}

  <!-- ── 실행 ──────────────────────────────────────── -->
  <section class="block">
    <button class="btn primary large run" onclick={() => lab.run()} disabled={lab.busy}>
      {#if lab.busy}
        <span class="spinner" aria-hidden="true"></span>
        <span>{lab.progressNote}</span>
      {:else}
        <Icon name="play" size={15} />
        <span>{lab.existingRun() ? t.run.rerun : t.run.start}</span>
      {/if}
    </button>

    {#if lab.busy}
      <div class="bar" role="progressbar" aria-valuenow={Math.round(lab.progress * 100)}>
        <div class="fill" style:width={`${Math.round(lab.progress * 100)}%`}></div>
      </div>
    {/if}

    {#if lab.device}
      <p class="meta">
        {t.run.device}: {lab.device === "webgpu" ? t.run.webgpu : t.run.wasm}
        {#if lab.device === "wasm"}<span class="warn"> · {t.run.wasmNote}</span>{/if}
      </p>
    {/if}

    {#if lab.error}
      <p class="err">
        <Icon name="alert" size={14} />
        <span>{lab.error}</span>
        <button class="icon-btn" title={t.errors.dismiss} onclick={() => (lab.error = null)}>
          <Icon name="x" size={13} />
        </button>
      </p>
    {/if}
  </section>

  <!-- ── 비교 슬롯 ──────────────────────────────────── -->
  <section class="block">
    <h2>{t.compare.title}</h2>
    {#if !lab.runs.length}
      <p class="hint">{t.compare.none}</p>
    {:else}
      {#each [{ key: "A", slot: lab.slotA }, { key: "B", slot: lab.slotB }] as row (row.key)}
        <label class="slot">
          <span class="slot-tag" data-slot={row.key}>{row.key}</span>
          <select
            value={slotValue(row.slot)}
            onchange={(e) => pick(row.key as "A" | "B", e.currentTarget.value)}
          >
            <option value="">{t.compare.pick}</option>
            {#each choices as c (c.value)}
              <option value={c.value}>{c.label}</option>
            {/each}
          </select>
        </label>
      {/each}

      <div class="runs">
        {#each lab.runs as run (run.id)}
          <div class="runrow">
            <span class="runlabel">{runLabel(run, dimsOf(run)[0] ?? 0)}</span>
            <span class="runstat">
              {t.run.throughput(run.embedMs > 0 ? (run.count / run.embedMs) * 1000 : 0)}
            </span>
            <button class="icon-btn" title={t.storage.remove} onclick={() => lab.removeRun(run.id)}>
              <Icon name="x" size={13} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="block">
    <button class="btn small" onclick={onStorage}>
      <Icon name="database" size={14} />
      <span>{t.storage.open}</span>
    </button>
  </section>
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
    padding: var(--space-lg);
    overflow-y: auto;
    background: var(--surface);
    border-right: 1px solid var(--border);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .hint,
  .meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .warn {
    color: var(--danger);
  }

  .seg {
    display: flex;
    gap: var(--space-2xs);
  }
  .seg .btn {
    flex: 1;
  }

  .paste {
    width: 100%;
    resize: vertical;
    padding: var(--space-sm);
    font: inherit;
    font-size: var(--text-base);
    line-height: 1.6;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }

  /* ── 모델 카드 ── */
  .models {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .model {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    padding: var(--space-sm);
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    transition:
      border-color var(--dur-short) var(--ease-out),
      background-color var(--dur-short) var(--ease-out);
  }
  .model:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .model.on {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .model:disabled {
    opacity: 0.45;
  }
  .model-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  .model-name {
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .ko {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--accent-ink);
  }
  .ko.muted {
    color: var(--text-muted);
    font-weight: 400;
  }
  .model-meta {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .model-note {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.45;
  }

  /* ── 정밀도 ── */
  .dtypes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
  }
  .dtype {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .dtype.on {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .dtype input {
    grid-column: 1;
    margin: 0;
    accent-color: var(--accent);
  }
  .dtype-id {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 600;
  }
  .dtype-size {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .dtype-note {
    grid-column: 1 / -1;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--text-base);
    cursor: pointer;
  }
  .check.disabled {
    opacity: 0.45;
    cursor: default;
  }
  .check input {
    accent-color: var(--accent);
  }

  /* ── 실행 ── */
  .run {
    width: 100%;
    justify-content: center;
    gap: var(--space-xs);
  }
  .bar {
    height: 4px;
    background: var(--surface-2);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--dur-short) var(--ease-out);
  }
  .err {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    margin: 0;
    padding: var(--space-sm);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--danger);
    background: var(--surface-2);
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
  }
  .err span {
    flex: 1;
  }

  /* ── 비교 ── */
  .slot {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .slot-tag {
    flex: none;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--accent-contrast);
  }
  .slot-tag[data-slot="A"] {
    background: var(--cat-1);
  }
  .slot-tag[data-slot="B"] {
    background: var(--cat-3);
  }
  .slot select {
    flex: 1;
    min-width: 0;
    padding: var(--space-2xs) var(--space-xs);
    font: inherit;
    font-size: var(--text-sm);
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .runs {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    margin-top: var(--space-2xs);
  }
  .runrow {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .runlabel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .runstat {
    font-family: var(--font-mono);
    flex: none;
  }
</style>
