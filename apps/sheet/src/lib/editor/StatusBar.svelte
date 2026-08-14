<script lang="ts">
  /** 아래 상태줄 — 선택 영역 요약. 엑셀에서 제일 자주 쓰는 "골라서 합계 보기". */
  import { formatValue } from "../sheet/numfmt";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  const s = $derived(editor.summary);
  const many = $derived(s.rows > 1 || s.cols > 1);
</script>

<div class="status" role="status">
  <span class="cell-ref">{editor.selectionLabel}</span>

  {#if many}
    <span class="item">{t.status.selected(s.rows, s.cols)}</span>
  {/if}

  {#if s.numbers > 0}
    <span class="item"><b>{t.status.sum}</b> {formatValue(s.sum, "#,##0.####")}</span>
    <span class="item"><b>{t.status.average}</b> {formatValue(s.average, "#,##0.####")}</span>
    <span class="item"><b>{t.status.min}</b> {formatValue(s.min, "#,##0.####")}</span>
    <span class="item"><b>{t.status.max}</b> {formatValue(s.max, "#,##0.####")}</span>
    <span class="item"><b>{t.status.countNumbers}</b> {s.numbers}</span>
  {/if}
  {#if s.count > 0}
    <span class="item"><b>{t.status.count}</b> {s.count}</span>
  {/if}

  <span class="spacer"></span>

  {#if editor.notice}
    <span class="notice">{editor.notice}</span>
  {/if}
  {#if editor.dirty}
    <span class="item muted">{t.status.unsaved}</span>
  {/if}
  {#if editor.preservedCount > 0}
    <span class="item muted" title={t.status.preservedHint}>
      {t.status.preserved(editor.preservedCount)}
    </span>
  {/if}
  {#if editor.encoding}
    <span class="item muted">{editor.encoding}</span>
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    /* 화면 맨 아래 줄이라 위아래로 숨 쉴 자리를 준다 — 예전엔 4px이라
     * 글자가 창 모서리에 눌린 것처럼 보였다. */
    padding: var(--space-xs) var(--space-md);
    min-height: 30px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    font-size: var(--text-sm);
    color: var(--text-muted);
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
  }

  .cell-ref {
    font-family: var(--font-mono);
    color: var(--text);
  }

  .item {
    font-variant-numeric: tabular-nums;
  }
  .item b {
    font-weight: 500;
    color: var(--text-muted);
  }
  .item.muted {
    color: var(--text-muted);
  }

  .notice {
    color: var(--accent-ink);
  }

  .spacer {
    flex: 1;
    min-width: var(--space-lg);
  }
</style>
