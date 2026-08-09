<script lang="ts">
  import { t } from "../i18n";

  const FLAGS = ["g", "i", "m", "s", "u"] as const;
  const MAX_MATCHES = 1000;

  let pattern = $state("");
  let flags = $state<string[]>(["g"]);
  let text = $state("");

  interface Segment {
    text: string;
    hit: boolean;
  }

  const result = $derived.by(() => {
    if (!pattern) return { segments: null, matches: [] as RegExpExecArray[], error: null };
    try {
      const flagStr = flags.includes("g") ? flags.join("") : flags.join("") + "g";
      const re = new RegExp(pattern, flagStr);
      const matches: RegExpExecArray[] = [];
      const segments: Segment[] = [];
      let last = 0;
      for (const m of text.matchAll(re)) {
        if (matches.length >= MAX_MATCHES) break;
        if (m.index > last) segments.push({ text: text.slice(last, m.index), hit: false });
        segments.push({ text: m[0], hit: true });
        matches.push(m);
        last = m.index + m[0].length;
      }
      if (last < text.length) segments.push({ text: text.slice(last), hit: false });
      return { segments, matches, error: null };
    } catch (e) {
      return {
        segments: null,
        matches: [] as RegExpExecArray[],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  function toggleFlag(f: string) {
    flags = flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f];
  }
</script>

<div class="tool">
  <div class="pattern-row">
    <span class="slash">/</span>
    <input
      class="pattern"
      type="text"
      bind:value={pattern}
      placeholder={t.regex.patternPlaceholder}
      spellcheck="false"
      aria-label={t.regex.pattern}
    />
    <span class="slash">/{flags.join("")}</span>
    <div class="t-chiprow" role="group" aria-label="flags">
      {#each FLAGS as f (f)}
        <button
          class="t-chip mono"
          class:active={flags.includes(f)}
          aria-pressed={flags.includes(f)}
          onclick={() => toggleFlag(f)}
        >
          {f}
        </button>
      {/each}
    </div>
    {#if pattern && !result.error}
      <span class="count" class:none={!result.matches.length}>
        {result.matches.length ? t.regex.matches(result.matches.length) : t.regex.noMatch}
      </span>
    {/if}
  </div>

  {#if result.error}
    <p class="t-error">{result.error}</p>
  {/if}

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.regex.text}</span></div>
      <textarea class="t-textarea" bind:value={text} spellcheck="false"></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.common.output}</span></div>
      {#if result.segments && text}
        <pre class="highlight">{#each result.segments as seg, i (i)}<span
            class:hit={seg.hit}>{seg.text}</span>{/each}</pre>
      {:else}
        <pre class="highlight empty"></pre>
      {/if}
    </div>
  </div>

  {#if result.matches.length}
    <div class="matches">
      {#each result.matches.slice(0, 100) as m, i (i)}
        <div class="match">
          <span class="idx">{m.index}</span>
          <code class="whole">{m[0]}</code>
          {#each m.slice(1) as g, gi (gi)}
            <span class="grp"><em>{t.regex.group(gi + 1)}</em><code>{g ?? "—"}</code></span>
          {/each}
        </div>
      {/each}
      {#if result.matches.length >= MAX_MATCHES}
        <p class="t-note">{t.regex.capped}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .pattern-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .slash {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--text-muted);
  }
  .pattern {
    flex: 1;
    min-width: 200px;
    max-width: 520px;
    padding: 8px 12px;
    font-family: var(--font-mono);
    font-size: 13.5px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .pattern:focus {
    outline: none;
    border-color: var(--accent);
  }
  .t-chip.mono {
    font-family: var(--font-mono);
    padding: 5px 9px;
  }
  .count {
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
  }
  .count.none {
    color: var(--text-muted);
  }
  .highlight {
    margin: 0;
    padding: 12px;
    flex: 1;
    min-height: 240px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: auto;
  }
  .hit {
    background: var(--accent-weak);
    outline: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 2px;
  }
  .matches {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    max-height: 30vh;
    overflow: auto;
  }
  .match {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    font-size: 12.5px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .idx {
    font-family: var(--font-mono);
    color: var(--text-muted);
    min-width: 34px;
  }
  .whole {
    font-family: var(--font-mono);
    background: var(--accent-weak);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .grp {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .grp em {
    font-style: normal;
    font-size: 11px;
    color: var(--text-muted);
  }
  .grp code {
    font-family: var(--font-mono);
    background: var(--surface-2);
    padding: 1px 6px;
    border-radius: 4px;
  }
</style>
