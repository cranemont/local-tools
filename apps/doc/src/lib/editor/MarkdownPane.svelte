<script lang="ts">
  /**
   * 오른쪽 — 변환 결과. **저장될 것을 그대로 보여 준다**(렌더링한 미리보기가 아니라
   * 마크다운 원문). 0.x 엔진을 쓰는 도구라, 무엇이 나오는지 사용자가 눈으로 검증할 수
   * 있는 게 중요하다. 여기 보이는 글자가 저장 버튼이 내려 주는 글자다.
   *
   * 텍스트라 브라우저 기본 찾기(Ctrl+F)가 그대로 먹는다 — 왼쪽과 달리 별도 찾기가 필요 없다.
   */
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
</script>

<div class="markdown" data-pane="markdown">
  {#if editor.notes.length > 0}
    <div class="notes">
      <span class="notes-title">{t.notes.title}</span>
      <ul>
        {#each editor.notes as note (note)}
          <li>{note}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if editor.markdown.trim()}
    <pre class="source">{editor.markdown}</pre>
  {:else}
    <p class="empty">{t.panes.empty}</p>
  {/if}
</div>

<style>
  .markdown {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-md);
    background: var(--surface);
  }

  .source {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }

  /* 옮기며 잃은 것 — 조용히 사라지지 않게 결과물 바로 위에 둔다. */
  .notes {
    margin-bottom: var(--space-md);
    padding: var(--space-xs) var(--space-sm);
    border-left: 3px solid var(--accent);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .notes-title {
    font-weight: 600;
    color: var(--text);
  }
  .notes ul {
    margin: var(--space-3xs) 0 0;
    padding-left: var(--space-md);
  }

  .empty {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  @media print {
    .markdown {
      display: none;
    }
  }
</style>
