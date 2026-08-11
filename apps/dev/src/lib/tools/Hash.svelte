<script lang="ts">
  import { t } from "../i18n";
  import CopyButton from "../CopyButton.svelte";
  import { md5Hex, bytesToHex } from "./md5";

  type Mode = "text" | "file";
  const SHA_ALGOS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

  let mode = $state<Mode>("text");
  let input = $state("");
  let file = $state<File | null>(null);
  let rows = $state<{ label: string; value: string }[]>([]);
  let computing = $state(false);
  let dragOver = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let seq = 0;

  async function compute(bytes: Uint8Array) {
    const id = ++seq;
    computing = true;
    const next = [{ label: "MD5", value: md5Hex(bytes) }];
    for (const algo of SHA_ALGOS) {
      const digest = await crypto.subtle.digest(algo, bytes as BufferSource);
      next.push({ label: algo, value: bytesToHex(new Uint8Array(digest)) });
    }
    if (id !== seq) return; // 계산 중 입력이 바뀜
    rows = next;
    computing = false;
  }

  $effect(() => {
    if (mode !== "text") return;
    void compute(new TextEncoder().encode(input));
  });

  async function pickFile(f: File) {
    file = f;
    rows = [];
    void compute(new Uint8Array(await f.arrayBuffer()));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void pickFile(f);
  }

  function onFileChange(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) void pickFile(f);
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="tool">
  <div class="t-controls">
    <div class="t-chiprow" role="group">
      <button
        class="t-chip"
        class:active={mode === "text"}
        aria-pressed={mode === "text"}
        onclick={() => (mode = "text")}
      >
        {t.hash.modeText}
      </button>
      <button
        class="t-chip"
        class:active={mode === "file"}
        aria-pressed={mode === "file"}
        onclick={() => (mode = "file")}
      >
        {t.hash.modeFile}
      </button>
    </div>
  </div>

  {#if mode === "text"}
    <textarea
      class="t-textarea text"
      bind:value={input}
      placeholder={t.hash.textPlaceholder}
      spellcheck="false"
    ></textarea>
  {:else}
    <input type="file" bind:this={fileInput} onchange={onFileChange} hidden />
    <button
      class="drop"
      class:over={dragOver}
      onclick={() => fileInput?.click()}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={onDrop}
    >
      {#if file}
        <span class="file">{file.name}</span>
        <span class="meta">{formatBytes(file.size)} · {t.hash.changeFile}</span>
      {:else}
        <span>{t.hash.dropHint}</span>
      {/if}
    </button>
  {/if}

  {#if computing}
    <p class="t-note">{t.hash.computing}</p>
  {:else if rows.length && (mode === "text" || file)}
    <div class="rows">
      {#each rows as row (row.label)}
        <div class="row">
          <span class="algo">{row.label}</span>
          <code class="value">{row.value}</code>
          <CopyButton text={row.value} />
        </div>
      {/each}
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
  .text {
    min-height: 140px;
    flex: none;
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 36px 20px;
    font-family: inherit;
    font-size: var(--text-lg);
    color: var(--text-muted);
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .drop:hover,
  .drop.over {
    border-color: var(--accent);
    color: var(--text);
    background: var(--accent-weak);
  }
  .file {
    font-weight: 600;
    color: var(--text);
  }
  .meta {
    font-size: var(--text-md);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 14px;
  }
  .row {
    display: grid;
    grid-template-columns: 76px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .algo {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-muted);
  }
  .value {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    word-break: break-all;
  }
</style>
