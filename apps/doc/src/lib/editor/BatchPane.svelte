<script lang="ts">
  /** 여러 개를 놓았을 때의 화면 — 목록 하나와 진행률 하나.
   *
   * 각 줄이 답하는 것은 둘이다: 이 파일이 지금 어디까지 왔는가, ZIP 안 어디에 앉는가.
   * 실패·건너뜀·못 함의 이유는 배지의 title로만 붙인다(문단으로 늘어놓지 않는다).
   */
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";
  import PasswordDialog from "./PasswordDialog.svelte";
  import { isRunning, progressOf } from "../doc/batch";

  const progress = $derived(progressOf(editor.batch));
  const running = $derived(isRunning(editor.batch));
  const canSave = $derived(progress.done > 0 && editor.busy === null);
</script>

<div class="batch">
  <div class="bar">
    <Icon name="doc" size={16} />
    <span class="title">{t.batch.title}</span>
    <span class="count">{t.batch.progress(progress.finished, progress.total)}</span>
    <div
      class="meter"
      role="progressbar"
      aria-label={t.batch.title}
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.finished}
    >
      <div class="fill" style="width: {progress.percent}%"></div>
    </div>

    <div class="spacer"></div>

    {#if editor.batchHalt === "panic"}
      <span class="halted">{t.batch.halted}</span>
      <button class="btn small danger" onclick={() => location.reload()}>
        <Icon name="refresh" size={15} />
        {t.engine.reload}
      </button>
    {:else if editor.batchHalt === "stopped"}
      <span class="halted">{t.batch.stopped}</span>
    {/if}

    {#if running}
      <button class="btn small" onclick={() => editor.stopBatch()}>{t.batch.stop}</button>
    {/if}

    <button
      class="btn small primary"
      onclick={() => void editor.saveBatchZip()}
      disabled={!canSave}
      title={progress.done === 0 ? t.batch.nothing : undefined}
    >
      <Icon name="download" size={15} />
      {t.batch.saveZip}
    </button>

    <button class="icon-btn tool" onclick={() => editor.close()} title={t.file.close}>
      <Icon name="x" size={16} />
      <span class="sr-only">{t.file.close}</span>
    </button>
  </div>

  <ul class="list">
    {#each editor.batch as item (item.id)}
      <li class="row">
        <span class="name" title={item.name}>{item.name}</span>
        <span class="path" title={item.path}>{item.path}</span>
        <span class="badge" data-status={item.status} title={item.reason ?? undefined}>
          {#if item.status === "running"}<span class="spinner" aria-hidden="true"></span>{/if}
          {t.batch.status[item.status]}
        </span>
      </li>
    {/each}
  </ul>
</div>

{#if editor.batchAsk}
  <div class="scrim">
    <PasswordDialog
      wrong={editor.batchAsk.wrong}
      fileName={editor.batchAsk.name}
      cancelLabel={t.batch.skip}
      submit={(password) => editor.answerBatchPassword(password)}
      cancel={() => editor.answerBatchPassword(null)}
    />
  </div>
{/if}

<style>
  .batch {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-wrap: wrap;
  }
  .bar :global(.icon) {
    color: var(--accent-ink);
  }
  .title {
    font-weight: 600;
  }
  .count {
    margin-left: var(--space-2xs);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .meter {
    width: 140px;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--dur-mid) var(--ease-out);
  }

  .spacer {
    flex: 1;
  }

  /* 멈춘 이유는 한 줄이다 — 새로고침 버튼 바로 옆에 둔다. */
  .halted {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: var(--space-sm) 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-2xs) var(--space-md);
    border-bottom: 1px solid var(--border);
  }
  .name {
    flex: 1 1 40%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-base);
  }
  .path {
    flex: 1 1 40%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3xs);
    min-width: 7ch;
    justify-content: center;
    padding: var(--space-3xs) var(--space-xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .badge[data-status="running"] {
    border-color: var(--accent);
    color: var(--accent-ink);
    background: var(--accent-weak);
  }
  .badge[data-status="done"] {
    color: var(--success);
  }
  .badge[data-status="failed"] {
    color: var(--danger);
  }
  /* '못 함'은 실패가 아니다 — 손대지도 못했다는 뜻이라 테두리를 점선으로 갈라 둔다. */
  .badge[data-status="halted"] {
    border-style: dashed;
  }

  .scrim {
    position: absolute;
    inset: 0;
    display: flex;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    z-index: var(--z-modal);
  }

  @media (max-width: 640px) {
    .path {
      display: none;
    }
    .meter {
      width: 80px;
    }
  }
</style>
