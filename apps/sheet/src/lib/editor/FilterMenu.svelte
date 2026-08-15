<script module lang="ts">
  /**
   * 메뉴 폭. 여는 쪽(Grid)이 단추 오른쪽에 맞춰 x를 잡을 때 같은 값을 써야 한다 —
   * 예전엔 Grid가 244, 여기가 268이라 메뉴가 단추보다 24px 왼쪽에서 열렸다.
   */
  export const MENU_WIDTH = 268;
</script>

<script lang="ts">
  /**
   * 열 하나의 필터 메뉴.
   *
   * 그리드 바깥에 `position: fixed`로 뜬다 — 머리글 안에 두면 스크롤 상자(overflow:auto)에
   * 잘려서 목록의 절반이 안 보인다. 자리는 누른 단추의 화면 좌표로 잡고, 화면 밖으로
   * 나가면 안쪽으로 당긴다.
   *
   * 체크박스는 **초안**이다. 적용을 눌러야 필터가 걸린다 — 한 칸씩 누를 때마다 표
   * 전체가 다시 그려지면 스무 개를 고르는 동안 스무 번 다시 그린다.
   */
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import Icon from "../Icon.svelte";
  import { CONDITION_OPS, opArity, type ColumnFilter, type ConditionOp } from "../sheet/filter";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let {
    col,
    x,
    y,
    onClose,
  }: { col: number; x: number; y: number; onClose: () => void } = $props();

  /** 목록에 한 번에 그리는 최대 줄 수 — 고유값이 만 개인 열도 있다. */
  const LIST_MAX = 300;

  const label = $derived(editor.columnLabel(col));
  const current = $derived(editor.columnFilter(col));
  const values = $derived(editor.filterValues(col));

  let query = $state("");
  let root = $state<HTMLDivElement | null>(null);
  let searchField = $state<HTMLInputElement | null>(null);

  /** 초안 — 체크된 표시 문자열들. */
  const picked = new SvelteSet<string>();
  let ready = false;

  // 처음 열릴 때만 현재 필터에서 초안을 뜬다(조건 필터면 전부 켠 상태로 시작).
  $effect(() => {
    if (ready) return;
    ready = true;
    const filter = editor.columnFilter(col);
    for (const value of editor.filterValues(col)) {
      if (filter?.kind === "values" ? filter.picked.has(value.text) : true) picked.add(value.text);
    }
  });

  const shown = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const hit = needle
      ? values.filter((value) => value.text.toLowerCase().includes(needle))
      : values;
    return { list: hit.slice(0, LIST_MAX), rest: Math.max(0, hit.length - LIST_MAX) };
  });

  const allShown = $derived(shown.list.length > 0 && shown.list.every((v) => picked.has(v.text)));

  function toggleAll(): void {
    const on = !allShown;
    for (const value of shown.list) {
      if (on) picked.add(value.text);
      else picked.delete(value.text);
    }
  }

  function toggle(text: string): void {
    if (picked.has(text)) picked.delete(text);
    else picked.add(text);
  }

  function applyValues(): void {
    // 전부 고른 것은 "거르지 않는다"와 같다.
    if (picked.size === values.length) editor.setColumnFilter(col, null);
    else editor.setColumnFilter(col, { kind: "values", picked: new Set(picked) });
    onClose();
  }

  // ── 조건 ──────────────────────────────────────────────────────

  // 열 때 한 번만 읽는다 — 여기서 문서를 구독하면 남의 편집에 입력란이 되돌아간다.
  const opening = untrack(() => editor.columnFilter(col));
  const started = opening?.kind === "condition" ? opening : null;

  let op = $state<ConditionOp>(started?.op ?? "contains");
  let value = $state(started?.value ?? "");
  let value2 = $state(started?.value2 ?? "");

  const arity = $derived(opArity(op));
  const conditionReady = $derived(
    arity === 0 || (value.trim() !== "" && (arity < 2 || value2.trim() !== "")),
  );

  function applyCondition(): void {
    if (!conditionReady) return;
    const filter: ColumnFilter = { kind: "condition", op, value, value2 };
    editor.setColumnFilter(col, filter);
    onClose();
  }

  function clear(): void {
    editor.setColumnFilter(col, null);
    onClose();
  }

  function sort(asc: boolean): void {
    editor.sortByColumn(col, asc);
    onClose();
  }

  // ── 자리·닫기 ─────────────────────────────────────────────────

  const place = $derived.by(() => {
    const width = MENU_WIDTH;
    const height = 420;
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
    return `left:${left}px; top:${top}px; width:${width}px`;
  });

  function onWindowDown(event: MouseEvent): void {
    if (root && !root.contains(event.target as Node)) onClose();
  }

  function onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  }

  $effect(() => {
    searchField?.focus();
  });
</script>

<svelte:window onmousedown={onWindowDown} />

<div
  class="menu"
  style={place}
  bind:this={root}
  onkeydown={onKey}
  role="dialog"
  tabindex="-1"
  aria-label={t.filter.column(label)}
>
  <div class="row sorts">
    <button class="btn small ghost" onclick={() => sort(true)}>
      <Icon name="sort-asc" size={15} />
      {t.edit.sortAsc}
    </button>
    <button class="btn small ghost" onclick={() => sort(false)}>
      <Icon name="sort-desc" size={15} />
      {t.edit.sortDesc}
    </button>
  </div>

  <input
    class="field"
    bind:this={searchField}
    bind:value={query}
    placeholder={t.filter.search}
    aria-label={t.filter.search}
    spellcheck="false"
  />

  <div class="list" role="group" aria-label={t.filter.column(label)}>
    {#if shown.list.length === 0}
      <span class="empty">{t.filter.none}</span>
    {:else}
      <label class="check all">
        <input type="checkbox" checked={allShown} onchange={toggleAll} />
        <span class="text">{t.filter.all}</span>
      </label>
      {#each shown.list as item (item.text)}
        <label class="check">
          <input
            type="checkbox"
            checked={picked.has(item.text)}
            onchange={() => toggle(item.text)}
          />
          <span class="text" class:blank={item.blank}>
            {item.blank ? t.filter.blank : item.text}
          </span>
          <span class="count">{item.count}</span>
        </label>
      {/each}
      {#if shown.rest > 0}
        <span class="empty">{t.filter.more(shown.rest)}</span>
      {/if}
    {/if}
  </div>

  <div class="row apply">
    <button class="btn small primary" disabled={picked.size === 0} onclick={applyValues}>
      {t.filter.apply}
    </button>
    <button class="btn small ghost" disabled={!current} onclick={clear}>{t.filter.clear}</button>
  </div>

  <div class="section">
    <span class="group-label">{t.filter.condition}</span>
    <div class="row">
      <select bind:value={op} aria-label={t.filter.condition}>
        {#each CONDITION_OPS as id (id)}
          <option value={id}>{t.filter.op[id]}</option>
        {/each}
      </select>
      {#if arity > 0}
        <input class="field" bind:value aria-label={t.filter.value} spellcheck="false" />
      {/if}
    </div>
    {#if arity === 2}
      <div class="row">
        <input class="field" bind:value={value2} aria-label={t.filter.value2} spellcheck="false" />
      </div>
    {/if}
    <div class="row">
      <button class="btn small" disabled={!conditionReady} onclick={applyCondition}>
        {t.filter.apply}
      </button>
    </div>
  </div>
</div>

<style>
  .menu {
    position: fixed;
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    padding: var(--space-2xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: 0 var(--space-2xs);
  }
  .row.sorts .btn,
  .row.apply .btn {
    flex: 1;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    padding-top: var(--space-2xs);
    border-top: 1px solid var(--border);
  }

  .group-label {
    padding: 0 var(--space-2xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .field,
  select {
    min-width: 0;
    flex: 1;
    height: 26px;
    padding: 0 var(--space-2xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-sm);
  }
  .field:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .list {
    display: flex;
    flex-direction: column;
    max-height: 208px;
    overflow-y: auto;
    scrollbar-width: thin;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-3xs);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-3xs) var(--space-2xs);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    color: var(--text);
    cursor: pointer;
  }
  .check:hover {
    background: var(--surface-2);
  }
  .check.all {
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    margin-bottom: var(--space-3xs);
  }
  .check input {
    accent-color: var(--accent);
  }
  .check .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check .text.blank {
    color: var(--text-muted);
  }
  .check .count {
    margin-left: auto;
    padding-left: var(--space-xs);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    padding: var(--space-xs) var(--space-2xs);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
