<script lang="ts">
  import { t } from "../i18n";

  let input = $state("");

  const stats = $derived.by(() => {
    const cps = [...input];
    return {
      withSpace: cps.length,
      withoutSpace: [...input.replace(/\s/g, "")].length,
      words: (input.match(/\S+/g) ?? []).length,
      lines: input ? input.split("\n").length : 0,
      utf8: new TextEncoder().encode(input).length,
      // 취업 사이트식: ASCII 1byte, 그 외(한글·전각) 2byte
      twoByte: cps.reduce((n, ch) => n + (ch.codePointAt(0)! > 0x7f ? 2 : 1), 0),
    };
  });

  const cards = $derived([
    { label: t.chars.withSpace, value: stats.withSpace },
    { label: t.chars.withoutSpace, value: stats.withoutSpace },
    { label: t.chars.words, value: stats.words },
    { label: t.chars.lines, value: stats.lines },
    { label: t.chars.utf8, value: stats.utf8 },
    { label: t.chars.twoByte, value: stats.twoByte },
  ]);
</script>

<div class="tool">
  <div class="cards">
    {#each cards as card (card.label)}
      <div class="card">
        <span class="num">{card.value.toLocaleString("ko-KR")}</span>
        <span class="label">{card.label}</span>
      </div>
    {/each}
  </div>

  <textarea
    class="t-textarea main"
    bind:value={input}
    placeholder={t.chars.placeholder}
    spellcheck="false"
  ></textarea>

  <p class="t-note">{t.chars.twoByteNote}</p>
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .num {
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .label {
    font-size: 12px;
    color: var(--text-muted);
  }
  .main {
    font-family: var(--font-sans);
    min-height: 300px;
  }
</style>
