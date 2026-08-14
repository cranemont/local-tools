<script lang="ts">
  /**
   * 왼쪽 목차. 한글 문서는 문단을 걸을 때 함께 나온 제목들(개요 수준·스타일 이름)이고,
   * 워드 문서는 변환된 마크다운의 `#` 줄이다 — 어느 쪽이든 **저장될 결과물과 같은 목록**이다.
   *
   * 누르면 그 자리로 간다. 한글은 쪽·세로 위치를 엔진에 물어보고, 워드는 쪽이 없으므로
   * 재현 판에서 같은 글이 있는 문단을 찾아간다.
   */
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";
  import type { OutlineItem } from "../doc/hwp";
  import { scrollToElement, scrollToPage } from "./scroll";

  let { close }: { close: () => void } = $props();

  function goto(item: OutlineItem): void {
    const at = editor.placeOfOutline(item);
    if (at) {
      scrollToPage(at.page, at.y);
      return;
    }

    const host = document.querySelector<HTMLElement>('[data-pane="original"]');
    if (!host) return;
    const wanted = item.text.replace(/\s+/g, " ").trim();
    for (const el of host.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6")) {
      if ((el.textContent ?? "").replace(/\s+/g, " ").trim() === wanted) {
        scrollToElement(el);
        return;
      }
    }
  }
</script>

<nav class="outline" aria-label={t.view.outline}>
  <div class="head">
    <span class="title">{t.view.outline}</span>
    <button class="icon-btn tool" onclick={close} title={t.view.outlineClose}>
      <Icon name="x" size={15} />
      <span class="sr-only">{t.view.outlineClose}</span>
    </button>
  </div>

  {#if editor.outline.length === 0}
    <p class="empty">{t.view.outlineEmpty}</p>
  {:else}
    <ul>
      {#each editor.outline as item, index (index)}
        <li>
          <button
            class="item"
            style:padding-left="calc(var(--space-sm) * {item.level})"
            onclick={() => goto(item)}
          >
            {item.text}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .outline {
    flex: none;
    width: 240px;
    min-height: 0;
    overflow: auto;
    /* 목록 끝까지 내려도 화면이 위로 밀리지 않게(두 판과 같은 이유). */
    overscroll-behavior: contain;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .head {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-2xs) var(--space-2xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    z-index: var(--z-sticky);
  }
  .title {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  ul {
    margin: 0;
    padding: var(--space-2xs) 0;
    list-style: none;
  }

  .item {
    display: block;
    width: 100%;
    padding: var(--space-3xs) var(--space-sm);
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .empty {
    margin: 0;
    padding: var(--space-sm);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  @media print {
    .outline {
      display: none;
    }
  }
</style>
