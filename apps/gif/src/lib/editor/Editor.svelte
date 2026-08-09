<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import Preview from "./Preview.svelte";
  import Filmstrip from "./Filmstrip.svelte";
  import Panel from "./Panel.svelte";

  let dragOver = $state(false);
  let fileInput: HTMLInputElement;

  function pick() {
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) editor.addFiles(input.files);
    input.value = "";
  }

  // ── 외부 파일 드롭 ────────────────────────────────
  function onZoneDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragOver = true;
  }
  function onZoneDragLeave() {
    dragOver = false;
  }
  function onZoneDrop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    dragOver = false;
    editor.addFiles(e.dataTransfer.files);
  }
</script>

<div
  class="editor"
  class:dragover={dragOver}
  ondragover={onZoneDragOver}
  ondragleave={onZoneDragLeave}
  ondrop={onZoneDrop}
  role="region"
  aria-label={t.appName}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/gif,image/png,image/jpeg,image/webp"
    multiple
    hidden
    onchange={onInputChange}
  />

  {#if editor.frames.length === 0}
    <button type="button" class="dropzone" onclick={pick}>
      <span class="dz-icon"><Icon name="film" size={30} /></span>
      <p class="dz-title">{t.editor.dropHint}</p>
      <p class="dz-sub">{t.editor.dropSub}</p>
    </button>
  {:else}
    <div class="toolbar">
      <button type="button" class="btn" onclick={pick}>
        <Icon name="plus" size={15} /> {t.editor.addFiles}
      </button>

      <span class="sep"></span>

      <button type="button" class="btn ghost" onclick={() => editor.selectAll()}>
        {t.frames.selectAll}
      </button>
      <button
        type="button"
        class="btn ghost"
        onclick={() => editor.selectNone()}
        disabled={editor.selectedCount === 0}
      >
        {t.frames.selectNone}
      </button>
      <button
        type="button"
        class="btn ghost"
        onclick={() => editor.duplicateSelected()}
        disabled={editor.selectedCount === 0}
      >
        <Icon name="copy" size={15} /> {t.frames.duplicateSelected}
      </button>
      <button
        type="button"
        class="btn ghost"
        onclick={() => editor.keepSelected()}
        disabled={editor.selectedCount === 0}
      >
        <Icon name="scissors" size={15} /> {t.frames.keepSelected}
      </button>
      <button
        type="button"
        class="btn ghost danger"
        onclick={() => editor.deleteSelected()}
        disabled={editor.selectedCount === 0}
      >
        <Icon name="trash" size={15} /> {t.frames.deleteSelected}
      </button>
      <button type="button" class="btn ghost" onclick={() => editor.reverse()}>
        <Icon name="reverse" size={15} /> {t.frames.reverse}
      </button>

      <span class="spacer"></span>

      <span class="count">
        {t.editor.frameCount(editor.frames.length)}{#if editor.selectedCount > 0}
          · {t.editor.selectedCount(editor.selectedCount)}{/if}
      </span>

      <button type="button" class="btn ghost danger" onclick={() => editor.clearAll()}>
        <Icon name="x" size={15} /> {t.editor.clearAll}
      </button>
    </div>

    {#if editor.banner}
      <div class="banner">
        <span class="banner-msg">{t.banner.large(editor.banner.w, editor.banner.h)}</span>
        <button type="button" class="btn" onclick={() => editor.applyBannerShrink(50)}>
          {t.banner.shrinkTo(50)}
        </button>
        <button type="button" class="btn ghost" onclick={() => editor.dismissBanner()}>
          {t.banner.dismiss}
        </button>
      </div>
    {/if}

    <div class="workspace">
      <div class="stage">
        <Preview />
        <Filmstrip />
      </div>
      <Panel />
    </div>
  {/if}

  {#if editor.error}
    <div class="error" role="alert">{editor.error}</div>
  {/if}

  {#if editor.busy}
    <div class="overlay">
      <div class="spinner" aria-hidden="true"></div>
      <p>{editor.busyMsg}</p>
    </div>
  {/if}
</div>

<style>
  .editor {
    position: relative;
    flex: 1;
    /* 필름스트립(nowrap)의 min-content가 뷰포트를 밀어내지 않도록 */
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-radius: var(--radius-lg);
    transition: box-shadow 0.12s ease;
  }
  .editor.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  /* 빈 상태 드롭존 */
  .dropzone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
    padding: 40px;
  }
  .dropzone:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: var(--accent-weak);
  }
  .dz-icon {
    width: 56px;
    height: 56px;
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

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 2px 4px;
  }
  .spacer {
    flex: 1;
  }
  .count {
    font-size: 12.5px;
    color: var(--text-muted);
    margin-right: 4px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }
  .btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-muted);
    font-weight: 500;
  }
  .btn.ghost:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
    border-color: transparent;
  }
  .btn.ghost.danger:hover:not(:disabled) {
    color: var(--danger);
  }

  /* 리사이즈 제안 배너 */
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: var(--radius-md);
    background: var(--accent-weak);
    font-size: 13px;
  }
  .banner-msg {
    flex: 1;
    color: var(--text);
  }

  /* 작업 공간 */
  .workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 14px;
  }
  .stage {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .error {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: 13px;
  }

  /* 로딩 오버레이 */
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
    z-index: 5;
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
