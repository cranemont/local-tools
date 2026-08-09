<script lang="ts">
  import cronstrue from "cronstrue";
  import "cronstrue/locales/ko";
  import { Cron } from "croner";
  import { t, fmtDateTime, fmtRelative } from "../i18n";

  const PRESETS = ["* * * * *", "0 * * * *", "0 0 * * *", "0 9 * * 1-5"];

  let input = $state("0 9 * * 1-5");

  const result = $derived.by(() => {
    const expr = input.trim();
    if (!expr) return null;
    try {
      const desc = cronstrue.toString(expr, { locale: "ko", use24HourTimeFormat: true });
      const next = new Cron(expr).nextRuns(5).map((d) => d.getTime());
      return { desc, next, error: null as string | null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { desc: "", next: [] as number[], error: msg.replace(/^Error:\s*/, "") };
    }
  });
</script>

<div class="tool">
  <div class="t-controls">
    <input
      class="expr"
      type="text"
      bind:value={input}
      placeholder={t.cron.placeholder}
      spellcheck="false"
      aria-label={t.cron.title}
    />
    <div class="t-chiprow" role="group">
      {#each PRESETS as preset (preset)}
        <button
          class="t-chip mono"
          class:active={input.trim() === preset}
          onclick={() => (input = preset)}
        >
          {preset}
        </button>
      {/each}
    </div>
  </div>

  {#if result}
    {#if result.error}
      <p class="t-error">{t.cron.invalid}
{result.error}</p>
    {:else}
      <p class="desc">{result.desc}</p>
      <div class="next">
        <span class="t-label">{t.cron.next}</span>
        {#each result.next as ms (ms)}
          <div class="row">
            <code>{fmtDateTime(ms)}</code>
            <span class="muted">{fmtRelative(ms)}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
  }
  .expr {
    flex: 0 1 260px;
    padding: 8px 12px;
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .expr:focus {
    outline: none;
    border-color: var(--accent);
  }
  .t-chip.mono {
    font-family: var(--font-mono);
  }
  .desc {
    margin: 6px 0 18px;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .next {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 480px;
    padding: 7px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .row code {
    font-family: var(--font-mono);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    font-size: 12.5px;
    color: var(--text-muted);
  }
</style>
