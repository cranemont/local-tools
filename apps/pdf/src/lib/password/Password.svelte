<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import {
    decryptArgs,
    encryptArgs,
    ensureQpdfReady,
    runQpdf,
  } from "../pdf/qpdfLoader";
  import { saveBytes } from "../pdf/save";

  type Mode = "encrypt" | "decrypt";

  let mode = $state<Mode>("encrypt");
  let file = $state<{ name: string; bytes: Uint8Array } | null>(null);
  let password = $state("");
  let busy = $state(false);
  let busyMsg = $state("");
  let error = $state("");
  let status = $state("");
  let dragOver = $state(false);
  let fileInput: HTMLInputElement;
  let outName = $state("");

  const defaultBase = $derived(
    file
      ? `${stripExt(file.name)}-${mode === "encrypt" ? "encrypted" : "decrypted"}`
      : "",
  );

  const modes: { id: Mode; label: string }[] = [
    { id: "encrypt", label: t.pw.encrypt },
    { id: "decrypt", label: t.pw.decrypt },
  ];

  async function setFile(f: File) {
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      error = "PDF 파일만 선택할 수 있어요.";
      return;
    }
    file = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    outName = "";
    error = "";
    status = "";
  }

  function pick() {
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) setFile(input.files[0]);
    input.value = "";
  }
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragOver = true;
  }
  function onDragLeave() {
    dragOver = false;
  }
  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.files[0]) return;
    e.preventDefault();
    dragOver = false;
    setFile(e.dataTransfer.files[0]);
  }

  function stripExt(name: string): string {
    return name.replace(/\.[^./\\]+$/, "");
  }

  async function run() {
    if (!file) return;
    if (!password) {
      error = t.pw.needPw;
      return;
    }
    busy = true;
    error = "";
    status = "";
    try {
      busyMsg = t.pw.preparing;
      await ensureQpdfReady();
      busyMsg = t.pw.processing;

      const out =
        mode === "encrypt"
          ? await runQpdf(file.bytes, encryptArgs(password))
          : await runQpdf(file.bytes, decryptArgs(password), t.pw.wrongPw);

      const clean = outName.replace(/[\\/:*?"<>|]/g, "").trim();
      await saveBytes(out, `${clean || defaultBase}.pdf`);
      status = mode === "encrypt" ? t.pw.doneSet : t.pw.doneRemove;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }
</script>

<div
  class="tool"
  class:dragover={dragOver}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="region"
  aria-label={t.tabs.password}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="application/pdf"
    hidden
    onchange={onInputChange}
  />

  <div class="panel">
    <div class="seg" role="group" aria-label={t.tabs.password}>
      {#each modes as m (m.id)}
        <button
          type="button"
          class="segbtn"
          class:active={mode === m.id}
          aria-pressed={mode === m.id}
          onclick={() => {
            mode = m.id;
            file = null;
            password = "";
            outName = "";
            status = "";
            error = "";
          }}
        >
          {m.label}
        </button>
      {/each}
    </div>

    {#if !file}
      <button type="button" class="dropzone" onclick={pick}>
        <span class="dz-icon"><Icon name="lock" size={28} /></span>
        <p class="dz-title">{t.pw.dropHint}</p>
        <p class="dz-sub">{t.pw.dropSub}</p>
      </button>
    {:else}
      <div class="filechip">
        <Icon name="merge" size={16} />
        <span class="fname" title={file.name}>{file.name}</span>
        <button type="button" class="link" onclick={pick}>{t.pw.change}</button>
      </div>

      <label class="field">
        <span class="flabel">{t.pw.passwordLabel}</span>
        <input
          type="password"
          bind:value={password}
          placeholder={mode === "encrypt"
            ? t.pw.passwordPlaceholderSet
            : t.pw.passwordPlaceholderRemove}
          onkeydown={(e) => {
            if (e.key === "Enter") run();
          }}
        />
      </label>

      <label class="field">
        <span class="flabel">{t.pw.fileName}</span>
        <input
          type="text"
          bind:value={outName}
          placeholder={defaultBase}
          spellcheck="false"
          autocomplete="off"
        />
      </label>

      <button type="button" class="btn primary run" onclick={run} disabled={busy}>
        <Icon name="lock" size={15} />
        {mode === "encrypt" ? t.pw.runSet : t.pw.runRemove}
      </button>

      {#if status}<p class="ok">{status}</p>{/if}
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <p class="note">{t.pw.note}</p>
  </div>

  {#if busy}
    <div class="overlay">
      <div class="spinner" aria-hidden="true"></div>
      <p>{busyMsg}</p>
    </div>
  {/if}
</div>

<style>
  .tool {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    border-radius: var(--radius-lg);
    transition: box-shadow 0.12s ease;
    overflow: auto;
  }
  .tool.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  .panel {
    width: 100%;
    max-width: 460px;
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .seg {
    align-self: center;
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .segbtn {
    border: 0;
    background: transparent;
    border-radius: 999px;
    padding: 7px 20px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .segbtn.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 200px;
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
    padding: 32px;
  }
  .dropzone:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: var(--accent-weak);
  }
  .dz-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .dz-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .dz-sub {
    margin: 0;
    font-size: 13px;
  }

  .filechip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: 13.5px;
  }
  .fname {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flabel {
    font-size: 12.5px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
  }
  .field input:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    font-weight: 700;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .ok {
    margin: 0;
    font-size: 13px;
    color: var(--accent);
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: 13px;
  }
  .note {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-muted);
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(2px);
    border-radius: var(--radius-lg);
    color: var(--text-muted);
    font-size: 13.5px;
    text-align: center;
    padding: 20px;
  }
  .spinner {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
