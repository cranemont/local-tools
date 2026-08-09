<script lang="ts">
  import { diffLines } from "diff";
  import { t } from "../i18n";

  let left = $state("");
  let right = $state("");
  let ignoreWs = $state(false);

  const parts = $derived(
    left || right ? diffLines(left, right, { ignoreWhitespace: ignoreWs }) : [],
  );
  const added = $derived(parts.reduce((n, p) => n + (p.added ? (p.count ?? 0) : 0), 0));
  const removed = $derived(parts.reduce((n, p) => n + (p.removed ? (p.count ?? 0) : 0), 0));
</script>

<div class="tool">
  <div class="t-controls">
    <label class="t-checkrow">
      <input type="checkbox" bind:checked={ignoreWs} />
      {t.diff.ignoreWs}
    </label>
    {#if parts.length}
      <span class="counts" class:same={added === 0 && removed === 0}>
        {added === 0 && removed === 0 ? t.diff.same : t.diff.counts(added, removed)}
      </span>
    {/if}
  </div>

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.diff.left}</span></div>
      <textarea class="t-textarea" bind:value={left} spellcheck="false"></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.diff.right}</span></div>
      <textarea class="t-textarea" bind:value={right} spellcheck="false"></textarea>
    </div>
  </div>

  {#if parts.length}
    <pre class="result">{#each parts as p, i (i)}<span
        class:add={p.added}
        class:del={p.removed}>{p.value}</span>{/each}</pre>
  {:else}
    <p class="t-note">{t.diff.hint}</p>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .counts {
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
  }
  .counts.same {
    color: var(--text-muted);
  }
  .result {
    margin: 12px 0 0;
    padding: 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: auto;
    max-height: 50vh;
  }
  .add {
    background: oklch(0.62 0.15 150 / 0.16);
  }
  .del {
    background: color-mix(in oklab, var(--danger) 14%, transparent);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklab, var(--danger) 45%, transparent);
  }
</style>
