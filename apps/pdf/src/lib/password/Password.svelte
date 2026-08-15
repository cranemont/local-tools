<script lang="ts">
  import Compress from "../compress/Compress.svelte";
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import {
    decryptArgs,
    encryptArgs,
    ensureQpdfReady,
    runQpdf,
  } from "../pdf/qpdfLoader";
  import { saveBytes } from "../pdf/save";

  /**
   * 이 탭은 "PDF 한 개가 들어가 PDF 한 개가 나오는" 자리다. 용량 줄이기가 여기 붙은
   * 이유가 그것이다 — 편집 탭은 여러 문서를 합치므로 "원본 4.1MB → 결과 1.2MB"를
   * 적을 원본이 없고, 이미지 탭은 산출물이 PDF가 아니다. 압축의 한쪽 길(qpdf)은
   * 암호와 같은 엔진을 쓰고 같은 이유로 인터넷이 필요하다.
   */
  type Mode = "shrink" | "encrypt" | "decrypt";

  let mode = $state<Mode>("shrink");
  /**
   * 용량 줄이기가 일하는 중인가. 모드 칩은 아래 패널 밖에 있어서 진행 오버레이가
   * 덮지 못한다 — 잠그지 않으면 렌더 도중에 칩을 눌러 나갈 수 있고, 그 뒤에도
   * 남은 작업이 파일을 내려받는다(직접 재현했다).
   */
  let childBusy = $state(false);
  let file = $state<{ name: string; bytes: Uint8Array } | null>(null);
  let password = $state("");
  let busy = $state(false);
  let busyMsg = $state("");
  let error = $state("");
  let status = $state("");
  let dragOver = $state(false);
  // 모드 칩 아래에서만 살아 있는 요소라 $state로 잡는다(칩을 옮기면 새로 붙는다).
  let fileInput = $state<HTMLInputElement | null>(null);
  let outName = $state("");

  const defaultBase = $derived(
    file
      ? `${stripExt(file.name)}-${mode === "encrypt" ? "encrypted" : "decrypted"}`
      : "",
  );

  const modes: { id: Mode; label: string }[] = [
    { id: "shrink", label: t.shrink.mode },
    { id: "encrypt", label: t.pw.encrypt },
    { id: "decrypt", label: t.pw.decrypt },
  ];

  async function setFile(f: File) {
    // 진행 중에는 파일을 바꾸지 않는다 — 오버레이는 드롭을 못 막는다(이벤트가
    // 위로 올라와 .tool의 ondrop에 닿는다). 바꾸면 앞 파일의 결과가 뒤 파일의
    // 이름으로 저장된다.
    if (busy) return;
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
    fileInput?.click();
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

<div class="tab">
  <div class="modes">
    <div class="seg" role="group" aria-label={t.tabs.password}>
      {#each modes as m (m.id)}
        <button
          type="button"
          class="segbtn"
          class:active={mode === m.id}
          aria-pressed={mode === m.id}
          disabled={busy || childBusy}
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
  </div>

  {#if mode === "shrink"}
    <Compress onBusy={(b) => (childBusy = b)} />
  {:else}
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

          <button
            type="button"
            class="btn primary large run"
            onclick={run}
            disabled={busy}
          >
            <Icon name="lock" size={15} />
            {mode === "encrypt" ? t.pw.runSet : t.pw.runRemove}
          </button>

          {#if status}<p class="ok">{status}</p>{/if}
        {/if}

        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </div>

      {#if busy}
        <div class="overlay">
          <div class="spinner" aria-hidden="true"></div>
          <p>{busyMsg}</p>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* 탭 셸 — 모드 칩 한 줄과 그 아래 한 패널. */
  .tab {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .modes {
    display: flex;
    justify-content: center;
  }

  .tool {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    border-radius: var(--radius-lg);
    transition: box-shadow var(--dur-short) var(--ease-out);
    overflow: auto;
  }
  .tool.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  .panel {
    width: 100%;
    max-width: 460px;
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
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-muted);
  }
  .segbtn.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }
  /* base.css의 .btn:disabled와 같은 값 — 앱마다 갈리지 않게 맞춘다. */
  .segbtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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
    color: var(--accent-ink);
  }
  .dz-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--text);
  }
  .dz-sub {
    margin: 0;
    font-size: var(--text-base);
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
    font-size: var(--text-lg);
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
    color: var(--accent-ink);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flabel {
    font-size: var(--text-md);
    color: var(--text-muted);
    font-weight: 600;
  }
  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-xl);
    font-family: inherit;
  }
  .field input:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }


  .ok {
    margin: 0;
    font-size: var(--text-base);
    color: var(--accent-ink);
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: var(--text-base);
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
    font-size: var(--text-lg);
    text-align: center;
    padding: 20px;
  }
</style>
