<script lang="ts">
  import { t, fmtDateTime, fmtRelative } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  let input = $state("");
  let nowMs = $state(Date.now());

  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(id);
  });

  // 숫자면 Unix 시각(초/밀리초 자동 판별), 아니면 날짜 문자열로 해석
  function parseInput(raw: string): number | null {
    const s = raw.trim();
    if (!s) return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return Math.abs(n) >= 1e11 ? n : n * 1000;
    }
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : ms;
  }

  const parsed = $derived(parseInput(input));

  function rowsFor(ms: number) {
    return [
      { label: t.time.local, value: fmtDateTime(ms) },
      { label: t.time.iso, value: new Date(ms).toISOString() },
      { label: t.time.unixS, value: String(Math.floor(ms / 1000)) },
      { label: t.time.unixMs, value: String(Math.round(ms)) },
      { label: t.time.relative, value: fmtRelative(ms) },
    ];
  }

  const nowRows = $derived([
    { label: t.time.unixS, value: String(Math.floor(nowMs / 1000)) },
    { label: t.time.unixMs, value: String(nowMs) },
    { label: t.time.iso, value: new Date(nowMs).toISOString() },
    { label: t.time.local, value: fmtDateTime(nowMs) },
  ]);
</script>

<div class="tool">
  <section class="block">
    <span class="t-label">{t.time.now}</span>
    <div class="rows">
      {#each nowRows as row (row.label)}
        <div class="row">
          <span class="label">{row.label}</span>
          <code class="value">{row.value}</code>
          <CopyButton text={row.value} />
        </div>
      {/each}
    </div>
  </section>

  <section class="block">
    <label class="t-label" for="ts-input">{t.time.inputLabel}</label>
    <input
      id="ts-input"
      class="input"
      type="text"
      bind:value={input}
      placeholder={t.time.placeholder}
      spellcheck="false"
    />
    {#if input.trim() && parsed === null}
      <p class="t-error">{t.time.invalid}</p>
    {:else if parsed !== null}
      <div class="rows">
        {#each rowsFor(parsed) as row (row.label)}
          <div class="row">
            <span class="label">{row.label}</span>
            <code class="value">{row.value}</code>
            <CopyButton text={row.value} />
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .input {
    max-width: 460px;
    padding: 9px 12px;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 130px 1fr auto;
    align-items: center;
    gap: 10px;
    max-width: 640px;
    padding: 7px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .label {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-muted);
  }
  .value {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-variant-numeric: tabular-nums;
    word-break: break-all;
  }
</style>
