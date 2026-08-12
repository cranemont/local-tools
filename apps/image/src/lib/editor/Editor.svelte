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

  // ── 단축키 ────────────────────────────────────────
  // 입력란 안에서는 브라우저 기본 되돌리기가 이겨야 하므로 비켜 준다.
  function typingIn(el: EventTarget | null): boolean {
    const node = el as HTMLElement | null;
    if (!node) return false;
    return node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
  }

  function onKeydown(e: KeyboardEvent) {
    if (typingIn(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      editor.redo();
      return;
    }
    if (!editor.cropMode) return;
    if (e.key === "Escape") {
      e.preventDefault();
      editor.cancelCrop();
    } else if (e.key === "Enter") {
      e.preventDefault();
      editor.applyCropDraft();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

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
    accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.svg,.heic,.heif"
    multiple
    hidden
    onchange={onInputChange}
  />

  {#if editor.items.length === 0}
    <button type="button" class="dropzone" onclick={pick}>
      <span class="dz-icon"><Icon name="image" size={30} /></span>
      <p class="dz-title">{t.editor.dropHint}</p>
      <p class="dz-sub">{t.editor.dropSub}</p>
    </button>
  {:else}
    <div class="toolbar">
      <button type="button" class="btn" onclick={pick}>
        <Icon name="plus" size={15} /> {t.editor.addFiles}
      </button>

      <button
        type="button"
        class="btn"
        disabled={!editor.canUndo}
        title="{t.editor.undo} (Ctrl+Z)"
        onclick={() => editor.undo()}
      >
        <Icon name="undo" size={15} /> {t.editor.undo}
      </button>
      <button
        type="button"
        class="icon-btn"
        disabled={!editor.canRedo}
        aria-label={t.editor.redo}
        title="{t.editor.redo} (Ctrl+Shift+Z)"
        onclick={() => editor.redo()}
      >
        <Icon name="redo" size={15} />
      </button>

      <span class="spacer"></span>

      <span class="count">{t.editor.imageCount(editor.items.length)}</span>

      <button type="button" class="btn ghost danger" onclick={() => editor.clearAll()}>
        <Icon name="x" size={15} /> {t.editor.clearAll}
      </button>
    </div>

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
    transition: box-shadow var(--dur-short) var(--ease-out);
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

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .count {
    font-size: var(--text-md);
    color: var(--text-muted);
    margin-right: 4px;
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
    font-size: var(--text-base);
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
    font-size: var(--text-lg);
    z-index: var(--z-raised);
  }

  /* 264px 패널 + 미리보기가 한 줄에 들어가지 않는 폭에서는 세로로 쌓는다.
   * (이 규칙이 없을 때 375px에서 stage에 약 61px만 남았다) */
  @media (max-width: 760px) {
    .workspace {
      flex-direction: column;
    }
    .stage {
      min-height: 46dvh;
    }
  }
</style>
