<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import Panel from "./Panel.svelte";
  import Player from "./Player.svelte";
  import Timeline from "./Timeline.svelte";
  import { editor } from "./state.svelte";

  let dragOver = $state(false);
  let fileInput: HTMLInputElement;

  function pick() {
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void editor.openFile(file);
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
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    dragOver = false;
    void editor.openFile(file);
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
    accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv"
    hidden
    onchange={onInputChange}
  />

  {#if !editor.file}
    <button type="button" class="dropzone" onclick={pick}>
      <span class="dz-icon"><Icon name="film" size={30} /></span>
      <p class="dz-title">{t.editor.dropHint}</p>
      <p class="dz-sub">{t.editor.dropSub}</p>
    </button>
  {:else}
    <div class="toolbar">
      <span class="fileinfo" title={editor.file.name}>{editor.file.name}</span>
      <span class="spacer"></span>
      <button type="button" class="btn ghost" onclick={pick}>
        <Icon name="plus" size={15} /> {t.editor.changeFile}
      </button>
      <button type="button" class="btn ghost danger" onclick={() => editor.clear()}>
        <Icon name="x" size={15} /> {t.editor.clear}
      </button>
    </div>

    <div class="workspace">
      <div class="stage">
        <Player />
        <Timeline />
      </div>
      <Panel />
    </div>
  {/if}

  {#if editor.error}
    <div class="error" role="alert">{editor.error}</div>
  {/if}

  {#if editor.busy}
    <div class="overlay">
      {#if editor.progress !== null}
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(editor.progress * 100)}>
          <div class="progress-fill" style="scale: {editor.progress} 1"></div>
        </div>
      {:else}
        <div class="spinner" aria-hidden="true"></div>
      {/if}
      <p>{editor.busyMsg}</p>
      {#if editor.cancelCurrent}
        <button type="button" class="btn" onclick={() => editor.cancelCurrent?.()}>
          {t.panel.cancel}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor {
    position: relative;
    flex: 1;
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
  }
  .fileinfo {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
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

  /* 진행 오버레이 */
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
  .overlay p {
    margin: 0;
  }
  .progress {
    width: 220px;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .progress-fill {
    /* width가 아니라 transform을 애니메이션한다 — 레이아웃 속성은 매 프레임 리플로를 부른다 */
    width: 100%;
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    transition: scale var(--dur-short) linear;
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
