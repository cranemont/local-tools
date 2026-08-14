<script lang="ts">
  import { t } from "../i18n";
  import { persisted } from "../persist.svelte";
  import Icon from "../Icon.svelte";
  import CopyButton from "../CopyButton.svelte";

  type Mode = "base64" | "base64url" | "url";
  type Dir = "encode" | "decode";

  const MODES: { id: Mode; label: string }[] = [
    { id: "base64", label: t.encode.modeB64 },
    { id: "base64url", label: t.encode.modeB64Url },
    { id: "url", label: t.encode.modeUrl },
  ];

  const mode = persisted<Mode>("encode.mode", "base64");
  const dir = persisted<Dir>("encode.dir", "encode");
  const input = persisted("encode.input", "");

  function b64encode(s: string, urlSafe: boolean): string {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const out = btoa(bin);
    return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
  }

  function b64decode(s: string, urlSafe: boolean): string {
    let v = s.trim();
    if (urlSafe) v = v.replace(/-/g, "+").replace(/_/g, "/");
    if (v.length % 4) v += "=".repeat(4 - (v.length % 4));
    const bin = atob(v);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function run(src: string, m: Mode, d: Dir): string {
    if (!src) return "";
    if (m === "url") return d === "encode" ? encodeURIComponent(src) : decodeURIComponent(src);
    const urlSafe = m === "base64url";
    return d === "encode" ? b64encode(src, urlSafe) : b64decode(src, urlSafe);
  }

  const result = $derived.by(() => {
    try {
      return { text: run(input.current, mode.current, dir.current), error: null as string | null };
    } catch {
      return { text: "", error: t.encode.invalid };
    }
  });

  function swap() {
    if (!result.text) return;
    input.current = result.text;
    dir.current = dir.current === "encode" ? "decode" : "encode";
  }
</script>

<div class="tool">
  <div class="t-controls">
    <div class="t-chiprow" role="group">
      {#each MODES as m (m.id)}
        <button
          class="t-chip"
          class:active={mode.current === m.id}
          aria-pressed={mode.current === m.id}
          onclick={() => (mode.current = m.id)}
        >
          {m.label}
        </button>
      {/each}
    </div>
    <div class="t-chiprow" role="group">
      <button
        class="t-chip"
        class:active={dir.current === "encode"}
        aria-pressed={dir.current === "encode"}
        onclick={() => (dir.current = "encode")}
      >
        {t.common.encode}
      </button>
      <button
        class="t-chip"
        class:active={dir.current === "decode"}
        aria-pressed={dir.current === "decode"}
        onclick={() => (dir.current = "decode")}
      >
        {t.common.decode}
      </button>
    </div>
    <button class="swap" onclick={swap} disabled={!result.text} title={t.common.swap}>
      <Icon name="swap" size={14} />
      <span>{t.common.swap}</span>
    </button>
  </div>

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.common.input}</span></div>
      <textarea class="t-textarea" bind:value={input.current} spellcheck="false"></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head">
        <span class="t-label">{t.common.output}</span>
        <CopyButton text={result.text} />
      </div>
      <textarea class="t-textarea" readonly value={result.text} spellcheck="false"></textarea>
    </div>
  </div>

  {#if result.error && input.current}
    <p class="t-error">{result.error}</p>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .swap {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .swap:hover:enabled {
    color: var(--text);
    background: var(--surface-2);
  }
  .swap:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
