<script lang="ts">
  import { parse, oklch, formatHex, formatRgb, formatHsl, displayable, clampChroma } from "culori";
  import type { Color } from "culori";
  import { t } from "../i18n";
  import { persisted } from "../persist.svelte";
  import CopyButton from "../CopyButton.svelte";

  const input = persisted("color.input", "oklch(0.62 0.158 240)");

  const round = (n: number, d: number) => {
    const p = 10 ** d;
    return Math.round(n * p) / p;
  };

  function fmtOklch(c: Color): string {
    const o = oklch(c);
    if (!o) return "";
    const alpha = o.alpha !== undefined && o.alpha < 1 ? ` / ${round(o.alpha, 3)}` : "";
    return `oklch(${round(o.l, 4)} ${round(o.c, 4)} ${round(o.h ?? 0, 2)}${alpha})`;
  }

  const result = $derived.by(() => {
    const s = input.current.trim();
    if (!s) return null;
    const color = parse(s);
    if (!color) return { error: t.color.invalid, rows: [], swatch: "", outOfGamut: false };
    const inGamut = displayable(color);
    const safe = inGamut ? color : clampChroma(color, "oklch");
    const rows = [
      { label: "HEX", value: formatHex(safe) ?? "" },
      { label: "RGB", value: formatRgb(safe) ?? "" },
      { label: "HSL", value: formatHsl(safe) ?? "" },
      { label: "OKLCH", value: fmtOklch(color) },
    ];
    return { error: null, rows, swatch: formatHex(safe) ?? "", outOfGamut: !inGamut };
  });
</script>

<div class="tool">
  <div class="input-row">
    <input
      class="color-input"
      type="text"
      bind:value={input.current}
      placeholder={t.color.placeholder}
      spellcheck="false"
      aria-label={t.color.title}
    />
    {#if result && !result.error}
      <span class="swatch" style:background={result.swatch}></span>
    {/if}
  </div>

  {#if result?.error}
    <p class="t-error">{result.error}</p>
  {:else if result}
    <div class="rows">
      {#each result.rows as row (row.label)}
        <div class="row">
          <span class="label">{row.label}</span>
          <code class="value">{row.value}</code>
          <CopyButton text={row.value} />
        </div>
      {/each}
    </div>
    {#if result.outOfGamut}
      <p class="t-note">{t.color.gamutNote}</p>
    {/if}
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .color-input {
    flex: 0 1 380px;
    padding: 9px 12px;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .color-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .swatch {
    width: 38px;
    height: 38px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    flex: none;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 76px 1fr auto;
    align-items: center;
    gap: 10px;
    max-width: 560px;
    padding: 7px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .label {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-muted);
  }
  .value {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    word-break: break-all;
  }
</style>
