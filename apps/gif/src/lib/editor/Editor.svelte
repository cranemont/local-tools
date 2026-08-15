<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import Preview from "./Preview.svelte";
  import Filmstrip from "./Filmstrip.svelte";
  import Panel from "./Panel.svelte";
  import ImportDialog from "./ImportDialog.svelte";

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
  // 입력란 안에서는 브라우저 기본 동작(되돌리기·캐럿 이동)이 이겨야 하므로 비켜 준다.
  function typingIn(el: EventTarget | null): boolean {
    const node = el as HTMLElement | null;
    if (!node) return false;
    return node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
  }

  function onKeydown(e: KeyboardEvent) {
    if (typingIn(e.target) || editor.busy || editor.videoDialog) return;
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
    if (mod && key === "a") {
      e.preventDefault();
      editor.selectAll();
      return;
    }
    if (!editor.frames.length) return;

    if (e.key === "Escape") {
      if (editor.cropMode) {
        e.preventDefault();
        editor.cropMode = false;
      } else if (editor.redactMode) {
        e.preventDefault();
        editor.redactMode = false;
      } else if (editor.selectedCount) {
        e.preventDefault();
        editor.selectNone();
      }
      return;
    }
    if (editor.cropMode) return;

    if (e.key === " ") {
      // 버튼에 포커스가 있으면 그 버튼을 누르는 게 맞다.
      if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      editor.togglePlay();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      e.preventDefault();
      if (e.altKey) editor.moveCurrent(delta);
      else if (e.shiftKey) {
        const from = editor.current;
        editor.step(delta);
        editor.selectRange(from, editor.current, true);
      } else editor.step(delta);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (editor.selectedCount) editor.deleteSelected();
      else {
        const id = editor.frames[Math.min(editor.current, editor.frames.length - 1)]?.id;
        if (id) editor.deleteOne(id);
      }
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
    accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv"
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
    {#if editor.canUndo}
      <!-- '모두 비우기'를 잘못 눌렀을 때 돌아오는 유일한 통로 — 툴바가 없는 화면이다. -->
      <div class="toolbar">
        <button
          type="button"
          class="btn"
          title="{t.editor.undo} ({t.keys.undo})"
          onclick={() => editor.undo()}
        >
          <Icon name="undo" size={15} /> {t.editor.undo}
        </button>
      </div>
    {/if}
  {:else}
    <div class="toolbar">
      <button type="button" class="btn" onclick={pick}>
        <Icon name="plus" size={15} /> {t.editor.addFiles}
      </button>

      <button
        type="button"
        class="btn"
        disabled={!editor.canUndo}
        title="{t.editor.undo} ({t.keys.undo})"
        onclick={() => editor.undo()}
      >
        <Icon name="undo" size={15} /> {t.editor.undo}
      </button>
      <button
        type="button"
        class="icon-btn"
        disabled={!editor.canRedo}
        aria-label={t.editor.redo}
        title="{t.editor.redo} ({t.keys.redo})"
        onclick={() => editor.redo()}
      >
        <Icon name="redo" size={15} />
      </button>

      <span class="sep"></span>

      <button
        type="button"
        class="btn ghost"
        title="{t.frames.selectAll} ({t.keys.selectAll})"
        onclick={() => editor.selectAll()}
      >
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
        title="{t.frames.deleteSelected} ({t.keys.del})"
      >
        <Icon name="trash" size={15} /> {t.frames.deleteSelected}
      </button>
      <button
        type="button"
        class="btn ghost"
        onclick={() => editor.reverse()}
      >
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
      {#if editor.busyCancel}
        <button type="button" class="btn" onclick={() => editor.busyCancel?.()}>
          <Icon name="x" size={15} /> {t.editor.cancel}
        </button>
      {/if}
    </div>
  {/if}

  <ImportDialog />
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
    font-size: var(--text-md);
    color: var(--text-muted);
    margin-right: 4px;
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
    font-size: var(--text-base);
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
