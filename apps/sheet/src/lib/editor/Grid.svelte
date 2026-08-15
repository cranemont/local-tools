<script lang="ts">
  /**
   * 표 본체. 보이는 행·열만 DOM에 올린다.
   *
   * 머리글과 틀 고정은 **네이티브 position: sticky**로 붙인다. 스크롤 위치를 JS로
   * 읽어 좌표를 다시 찍는 방식(수동 sticky)도 되지만, 브라우저가 스크롤을 그리는
   * 시점과 JS가 도는 시점이 달라서 빠르게 굴리면 머리글이 한 프레임씩 떨린다.
   * 그래서 셀을 절대 배치하지 않고 행이 실제 흐름 요소가 되게 두었다 —
   * 그 대가로 가상화는 "안 보이는 만큼 빈 상자로 메우는" 방식이 된다.
   *
   * ★ 자동 필터가 걸리면 **세로 좌표계가 둘로 갈린다.**
   *   순번(i)  — 화면에서 위에서 몇 번째로 그려지는가. 높이·오프셋·가상화가 쓴다.
   *   행 번호(r) — 문서의 좌표. 행 머리글 숫자·커서·선택·복사·수식이 쓴다.
   * `rowOf(i)`가 순번을 행 번호로 옮기고 `ordOf(r)`이 그 반대다. 필터가 없으면
   * 둘이 같아서 `rowList`가 null이고, 그때는 표를 만들지 않는다(백만 줄 대비).
   * 이 둘을 섞으면 "3행을 지웠는데 7행이 사라지는" 종류의 사고가 난다.
   */
  import { untrack } from "svelte";
  import Icon from "../Icon.svelte";
  import { areaContains, cellName } from "../sheet/a1";
  import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, isError } from "../sheet/types";
  import FilterMenu, { MENU_WIDTH } from "./FilterMenu.svelte";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  const HEADER_W = 52;
  const HEADER_H = 26;
  /** 화면 밖으로 미리 그려 두는 여유 — 스크롤 시 빈 칸이 스치는 걸 막는다. */
  const OVERSCAN = 4;

  let scroller = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewportW = $state(800);
  let viewportH = $state(500);

  let editInput = $state<HTMLInputElement | null>(null);
  let dragging = $state(false);
  /** 열 너비 조절 중인 열. */
  let resizing = $state<{ col: number; startX: number; startW: number } | null>(null);
  let resizingRow = $state<{ row: number; startY: number; startH: number } | null>(null);

  const sheet = $derived(editor.sheet);

  // ── 좌표 ──────────────────────────────────────────────────────
  // 크기 지정이 하나도 없으면 곱셈으로 끝낸다(행이 백만이어도 배열을 안 만든다).

  const colOffsets = $derived.by(() => {
    void editor.revision;
    if (sheet.colWidths.size === 0) return null;
    const out = new Float64Array(sheet.cols + 1);
    for (let c = 0; c < sheet.cols; c++) {
      out[c + 1] = out[c] + (sheet.colWidths.get(c) ?? DEFAULT_COL_WIDTH);
    }
    return out;
  });

  /** 걸러지고 남은 행 번호들. null이면 필터가 없다 — 순번이 곧 행 번호다. */
  const rowList = $derived(editor.visibleRows);
  /** 화면에 그려질 줄 수. */
  const rowCount = $derived(rowList ? rowList.length : sheet.rows);

  /** 순번 → 문서의 행 번호. */
  function rowOf(i: number): number {
    if (!rowList) return i;
    return rowList[Math.min(Math.max(i, 0), rowList.length - 1)] ?? 0;
  }

  /** 문서의 행 번호 → 순번. */
  function ordOf(row: number): number {
    return editor.rowOrdinal(row);
  }

  const rowOffsets = $derived.by(() => {
    void editor.revision;
    // 높이 지정이 하나도 없으면 줄 높이가 균일하다 — 필터가 걸려 있어도 곱셈으로 끝난다.
    if (sheet.rowHeights.size === 0) return null;
    const out = new Float64Array(rowCount + 1);
    for (let i = 0; i < rowCount; i++) {
      out[i + 1] = out[i] + (sheet.rowHeights.get(rowOf(i)) ?? DEFAULT_ROW_HEIGHT);
    }
    return out;
  });

  function colW(c: number): number {
    return sheet.colWidths.get(c) ?? DEFAULT_COL_WIDTH;
  }
  /** 문서의 행 번호로 재는 높이 — 높이는 행에 붙어 있지 순번에 붙어 있지 않다. */
  function rowH(row: number): number {
    return sheet.rowHeights.get(row) ?? DEFAULT_ROW_HEIGHT;
  }
  function colX(c: number): number {
    const offsets = colOffsets;
    if (!offsets) return c * DEFAULT_COL_WIDTH;
    return offsets[Math.min(c, sheet.cols)];
  }
  /** 순번 → 세로 좌표. */
  function ordY(i: number): number {
    const offsets = rowOffsets;
    if (!offsets) return Math.min(Math.max(i, 0), rowCount) * DEFAULT_ROW_HEIGHT;
    return offsets[Math.min(Math.max(i, 0), rowCount)];
  }

  const totalW = $derived(colX(sheet.cols));
  const totalH = $derived(ordY(rowCount));

  function colAtX(x: number): number {
    const offsets = colOffsets;
    if (!offsets) return Math.floor(x / DEFAULT_COL_WIDTH);
    let lo = 0;
    let hi = sheet.cols - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 세로 좌표 → 순번. */
  function ordAtY(y: number): number {
    const offsets = rowOffsets;
    if (!offsets) return Math.floor(y / DEFAULT_ROW_HEIGHT);
    let lo = 0;
    let hi = rowCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(lo, 0);
  }

  // ── 보이는 창 ─────────────────────────────────────────────────

  const frozenRows = $derived(Math.min(sheet.frozenRows, 20, rowCount));
  const frozenCols = $derived(Math.min(sheet.frozenCols, 10));

  /** 고정된 행이 차지하는 높이 — 그만큼은 늘 화면 위쪽에 붙어 있다. */
  const frozenH = $derived(ordY(frozenRows));
  const frozenW = $derived(colX(frozenCols));

  const firstOrd = $derived(
    Math.max(frozenRows, ordAtY(Math.max(0, scrollTop - HEADER_H)) - OVERSCAN),
  );
  const lastOrd = $derived(Math.min(rowCount - 1, ordAtY(scrollTop + viewportH) + OVERSCAN));
  const firstCol = $derived(Math.max(frozenCols, colAtX(Math.max(0, scrollLeft)) - OVERSCAN));
  const lastCol = $derived(Math.min(sheet.cols - 1, colAtX(scrollLeft + viewportW) + OVERSCAN));

  /** 그릴 줄들 — 값은 **순번**이다. */
  const bodyOrds = $derived.by(() => {
    const out: number[] = [];
    for (let i = firstOrd; i <= lastOrd; i++) out.push(i);
    return out;
  });

  const bodyCols = $derived.by(() => {
    const out: number[] = [];
    for (let c = firstCol; c <= lastCol; c++) out.push(c);
    return out;
  });

  const frozenOrdList = $derived.by(() => {
    const out: number[] = [];
    for (let i = 0; i < frozenRows; i++) out.push(i);
    return out;
  });

  const frozenColList = $derived.by(() => {
    const out: number[] = [];
    for (let c = 0; c < frozenCols; c++) out.push(c);
    return out;
  });

  /** 왼쪽·위쪽으로 건너뛴 만큼을 빈 상자로 메운다. */
  const padLeft = $derived(colX(firstCol) - frozenW);
  const padRight = $derived(Math.max(0, totalW - colX(lastCol + 1)));
  const padTop = $derived(ordY(firstOrd) - frozenH);
  const padBottom = $derived(Math.max(0, totalH - ordY(lastOrd + 1)));

  // ── 필터 메뉴 ────────────────────────────────────────────────
  // 스크롤 상자 안에 두면 잘리므로 그리드 바깥에 fixed로 띄운다.

  let menu = $state<{ col: number; x: number; y: number } | null>(null);
  /** 방금 어느 단추로 닫혔나 — 같은 단추를 다시 누르면 열지 않고 닫힌 채로 둔다. */
  let closed = { col: -1, at: 0 };

  function closeMenu(): void {
    closed = { col: menu?.col ?? -1, at: performance.now() };
    menu = null;
  }

  function openFilter(event: MouseEvent, col: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (closed.col === col && performance.now() - closed.at < 300) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { col, x: rect.right - MENU_WIDTH, y: rect.bottom + 4 };
  }

  function hasFilter(col: number): boolean {
    return editor.columnFilter(col) !== undefined;
  }

  // ── 셀 그리기 ────────────────────────────────────────────────

  interface Painted {
    text: string;
    cls: string;
    style: string;
    hidden: boolean;
  }

  function paint(row: number, col: number): Painted {
    const merge = editor.mergeCovering(row, col);
    // 병합 영역의 좌상단이 아닌 칸은 그리지 않는다.
    if (merge && (merge.top !== row || merge.left !== col)) {
      return { text: "", cls: "", style: "", hidden: true };
    }

    const cell = editor.cellAt(row, col);
    const s = cell?.s;
    const value = cell?.v ?? null;

    const classes: string[] = [];
    const styles: string[] = [];

    // 기본 정렬: 수·불리언은 오른쪽, 글자는 왼쪽, 오류는 가운데.
    const align =
      s?.align ??
      (isError(value) ? "center" : typeof value === "number" || typeof value === "boolean" ? "right" : "left");
    if (align !== "left") classes.push(`al-${align}`);
    if (s?.valign && s.valign !== "bottom") classes.push(`va-${s.valign}`);
    if (s?.bold) classes.push("b");
    if (s?.italic) classes.push("i");
    if (s?.underline && s?.strike) classes.push("us");
    else if (s?.underline) classes.push("u");
    else if (s?.strike) classes.push("st");
    if (s?.wrap) classes.push("wrap");
    if (isError(value)) classes.push("err");

    if (s?.color) styles.push(`color:${s.color}`);
    if (s?.fill) styles.push(`background:${s.fill}`);
    if (s?.fontSize) styles.push(`font-size:${s.fontSize}px`);
    if (s?.borders) {
      for (const side of s.borders) styles.push(`border-${side}:1px solid var(--border-strong)`);
    }

    if (merge) {
      styles.push(`width:${colX(merge.right + 1) - colX(merge.left)}px`);
      // 병합 높이도 화면 좌표라 순번으로 잰다 — 사이에 걸러진 줄이 있으면 그만큼 짧다.
      styles.push(`height:${ordY(ordOf(merge.bottom + 1)) - ordY(ordOf(merge.top))}px`);
      classes.push("merged");
    }

    return {
      text: editor.displayAt(row, col),
      cls: classes.join(" "),
      style: styles.join(";"),
      hidden: false,
    };
  }

  function isSelected(row: number, col: number): boolean {
    return areaContains(editor.selection, row, col);
  }

  function isCursor(row: number, col: number): boolean {
    return editor.cursor.row === row && editor.cursor.col === col;
  }

  // ── 입력 ─────────────────────────────────────────────────────

  function onScroll(): void {
    if (!scroller) return;
    scrollTop = scroller.scrollTop;
    scrollLeft = scroller.scrollLeft;
    // 메뉴는 fixed라 그리드를 굴려도 열린 자리에 남는다 — 따라다니게 만들기보다 닫는다.
    // (`closed`는 남기지 않는다. 굴린 직후 단추를 눌러도 다시 열려야 한다.)
    if (menu) menu = null;
  }

  function cellMouseDown(event: MouseEvent, row: number, col: number): void {
    if (event.button !== 0) return;
    if (editor.editing) commitFromInput({ row: 0, col: 0 });
    event.preventDefault();
    scroller?.focus();
    if (event.shiftKey) editor.extendTo(row, col);
    else editor.select(row, col);
    dragging = true;
  }

  function cellMouseEnter(row: number, col: number): void {
    if (dragging) editor.extendTo(row, col);
  }

  function endDrag(): void {
    dragging = false;
  }

  function cellDoubleClick(row: number, col: number): void {
    editor.select(row, col);
    editor.beginEdit();
  }

  function colHeaderMouseDown(event: MouseEvent, col: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    scroller?.focus();
    editor.selectCol(col, event.shiftKey);
  }

  function rowHeaderMouseDown(event: MouseEvent, row: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    scroller?.focus();
    editor.selectRow(row, event.shiftKey);
  }

  function startResize(event: MouseEvent, col: number): void {
    event.preventDefault();
    event.stopPropagation();
    resizing = { col, startX: event.clientX, startW: colW(col) };
  }

  function startRowResize(event: MouseEvent, row: number): void {
    event.preventDefault();
    event.stopPropagation();
    resizingRow = { row, startY: event.clientY, startH: rowH(row) };
  }

  /** 손잡이에 초점을 두고 방향키로도 크기를 바꿀 수 있다(마우스 없이 쓰는 경우). */
  const RESIZE_STEP = 8;

  function resizeByKey(event: KeyboardEvent, col: number): void {
    const step = event.shiftKey ? RESIZE_STEP * 3 : RESIZE_STEP;
    if (event.key === "ArrowLeft") editor.setColWidth(col, colW(col) - step);
    else if (event.key === "ArrowRight") editor.setColWidth(col, colW(col) + step);
    else if (event.key === "Enter") editor.autoFitColumn(col);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function resizeRowByKey(event: KeyboardEvent, row: number): void {
    const step = event.shiftKey ? RESIZE_STEP * 3 : RESIZE_STEP;
    if (event.key === "ArrowUp") editor.setRowHeight(row, rowH(row) - step);
    else if (event.key === "ArrowDown") editor.setRowHeight(row, rowH(row) + step);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onWindowMouseMove(event: MouseEvent): void {
    if (resizing) {
      editor.setColWidth(resizing.col, resizing.startW + (event.clientX - resizing.startX));
    } else if (resizingRow) {
      editor.setRowHeight(resizingRow.row, resizingRow.startH + (event.clientY - resizingRow.startY));
    }
  }

  function onWindowMouseUp(): void {
    resizing = null;
    resizingRow = null;
    endDrag();
  }

  // ── 편집 상자 ────────────────────────────────────────────────

  function commitFromInput(move: { row: number; col: number }): void {
    // 편집 상자가 DOM에 없으면 확정하지 않는다. 예전엔 빈 글자로 떨어져서
    // (그 줄이 필터에 걸려 사라진 뒤 다른 칸을 누르면) 보이지도 않는 칸이 지워졌다.
    if (!editInput) {
      editor.cancelEdit();
      scroller?.focus();
      return;
    }
    editor.commitEdit(editInput.value, move);
    scroller?.focus();
  }

  function editKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitFromInput({ row: event.shiftKey ? -1 : 1, col: 0 });
    } else if (event.key === "Tab") {
      event.preventDefault();
      commitFromInput({ row: 0, col: event.shiftKey ? -1 : 1 });
    } else if (event.key === "Escape") {
      event.preventDefault();
      editor.cancelEdit();
      scroller?.focus();
    }
    event.stopPropagation();
  }

  $effect(() => {
    if (editor.editing && editInput) {
      editInput.focus();
      if (!editor.editing.fromTyping) editInput.select();
      else {
        const end = editInput.value.length;
        editInput.setSelectionRange(end, end);
      }
    }
  });

  /**
   * 커서가 화면 밖으로 나가면 따라간다.
   *
   * 의존은 **커서 하나뿐**이어야 한다. 예전엔 본문에서 읽는 rowY·frozenH까지
   * 딸려 들어가서, 셀 하나만 고쳐도(=리비전이 오르면) 보던 위치가 커서 쪽으로
   * 홱 끌려갔다. 나머지 읽기는 untrack으로 감싼다.
   */
  $effect(() => {
    const { row, col } = editor.cursor;
    untrack(() => {
      if (!scroller) return;
      const ord = ordOf(row);
      const top = ordY(ord);
      const bottom = ordY(ord + 1);
      const left = colX(col);
      const right = colX(col + 1);

      const viewTop = scroller.scrollTop + frozenH;
      const viewBottom = scroller.scrollTop + scroller.clientHeight - HEADER_H;
      const viewLeft = scroller.scrollLeft + frozenW;
      const viewRight = scroller.scrollLeft + scroller.clientWidth - HEADER_W;

      if (top < viewTop) scroller.scrollTop = Math.max(0, top - frozenH);
      else if (bottom > viewBottom) scroller.scrollTop = bottom - scroller.clientHeight + HEADER_H;

      if (left < viewLeft) scroller.scrollLeft = Math.max(0, left - frozenW);
      else if (right > viewRight) scroller.scrollLeft = right - scroller.clientWidth + HEADER_W;
    });
  });

  export function focus(): void {
    scroller?.focus();
  }
</script>

<svelte:window onmousemove={onWindowMouseMove} onmouseup={onWindowMouseUp} />

<div
  class="scroller"
  class:resizing={resizing !== null || resizingRow !== null}
  bind:this={scroller}
  bind:clientWidth={viewportW}
  bind:clientHeight={viewportH}
  onscroll={onScroll}
  role="grid"
  aria-label={t.a11y.grid}
  aria-rowcount={rowCount}
  aria-colcount={sheet.cols}
  tabindex="0"
>
  <div class="content" style="width:{HEADER_W + totalW}px">
    <!-- 열 머리글 -->
    <div class="row head" style="height:{HEADER_H}px; top:0">
      <div class="corner" style="width:{HEADER_W}px"></div>
      {#each frozenColList as c (c)}
        {@render colHead(c, true)}
      {/each}
      <div class="pad head-pad" style="width:{padLeft}px"></div>
      {#each bodyCols as c (c)}
        {@render colHead(c, false)}
      {/each}
      <div class="pad head-pad tail" style="width:{padRight}px"></div>
    </div>

    <!-- 고정된 행 -->
    {#each frozenOrdList as i (rowOf(i))}
      <div class="row frozen-row" style="height:{rowH(rowOf(i))}px; top:{HEADER_H + ordY(i)}px">
        {@render rowBody(rowOf(i))}
      </div>
    {/each}

    <div style="height:{padTop}px"></div>

    {#each bodyOrds as i (rowOf(i))}
      <div class="row" style="height:{rowH(rowOf(i))}px">
        {@render rowBody(rowOf(i))}
      </div>
    {/each}

    <div style="height:{padBottom}px"></div>
  </div>
</div>

{#if menu}
  <FilterMenu col={menu.col} x={menu.x} y={menu.y} onClose={closeMenu} />
{/if}

{#snippet colHead(c: number, frozen: boolean)}
  <div
    class="colhead"
    class:frozen-col={frozen}
    class:hot={isSelected(0, c)}
    style="width:{colW(c)}px;{frozen ? ` left:${HEADER_W + colX(c)}px` : ''}"
  >
    <button
      type="button"
      class="headhit"
      onmousedown={(e) => colHeaderMouseDown(e, c)}
      ondblclick={() => editor.autoFitColumn(c)}
      aria-label={t.a11y.colHeader(editor.columnLabel(c))}
    >
      {editor.columnLabel(c)}
    </button>
    <button
      type="button"
      class="filter-btn"
      class:on={hasFilter(c)}
      title={hasFilter(c) ? t.filter.on(editor.columnLabel(c)) : t.filter.column(editor.columnLabel(c))}
      aria-label={hasFilter(c)
        ? t.filter.on(editor.columnLabel(c))
        : t.filter.column(editor.columnLabel(c))}
      aria-haspopup="dialog"
      aria-expanded={menu?.col === c}
      onclick={(e) => openFilter(e, c)}
    >
      <Icon name="filter" size={11} />
    </button>
    <button
      type="button"
      class="col-resize"
      aria-label={t.a11y.colResize(editor.columnLabel(c))}
      onmousedown={(e) => startResize(e, c)}
      onkeydown={(e) => resizeByKey(e, c)}
      ondblclick={() => editor.autoFitColumn(c)}
    ></button>
  </div>
{/snippet}

{#snippet cellBox(r: number, c: number, frozen: boolean)}
  {@const p = paint(r, c)}
  {#if !p.hidden}
    <div
      class="cell {p.cls}"
      class:sel={isSelected(r, c)}
      class:cur={isCursor(r, c)}
      class:frozen-col={frozen}
      style="width:{colW(c)}px;{frozen ? `left:${HEADER_W + colX(c)}px;` : ''}{p.style}"
      role="gridcell"
      tabindex="-1"
      aria-label={cellName(r, c)}
      onmousedown={(e) => cellMouseDown(e, r, c)}
      onmouseenter={() => cellMouseEnter(r, c)}
      ondblclick={() => cellDoubleClick(r, c)}
    >
      {#if editor.editing && editor.editing.row === r && editor.editing.col === c}
        <input
          class="editor"
          bind:this={editInput}
          value={editor.editing.text}
          onkeydown={editKeyDown}
          onblur={() => commitFromInput({ row: 0, col: 0 })}
          onmousedown={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
        />
      {:else}
        <span class="text">{p.text}</span>
      {/if}
    </div>
  {:else}
    <div class="cell covered" style="width:{colW(c)}px" aria-hidden="true"></div>
  {/if}
{/snippet}

{#snippet rowBody(r: number)}
  <div class="rowhead" style="width:{HEADER_W}px" class:hot={isSelected(r, 0)}>
    <button
      type="button"
      class="headhit"
      onmousedown={(e) => rowHeaderMouseDown(e, r)}
      aria-label={t.a11y.rowHeader(r + 1)}
    >
      {r + 1}
    </button>
    <button
      type="button"
      class="row-resize"
      aria-label={t.a11y.rowResize(r + 1)}
      onmousedown={(e) => startRowResize(e, r)}
      onkeydown={(e) => resizeRowByKey(e, r)}
    ></button>
  </div>
  {#each frozenColList as c (c)}
    {@render cellBox(r, c, true)}
  {/each}
  <div style="width:{padLeft}px" class="filler"></div>
  {#each bodyCols as c (c)}
    {@render cellBox(r, c, false)}
  {/each}
  <div style="width:{padRight}px" class="filler tail"></div>
{/snippet}

<style>
  .scroller {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--surface);
    /* 스크롤바를 표의 일부로 칠한다. 기본 스크롤바를 두면 오른쪽·아래에 15px짜리
     * 흰 띠가 생기는데, 셀 테두리가 거기서 뚝 끊겨 "잘못 잡힌 여백"으로 읽힌다.
     * (맥에서 스크롤바를 항상 표시로 둔 사람에게 특히 그렇다.) */
    scrollbar-width: thin;
    scrollbar-color: var(--border-strong) var(--surface-2);
    outline: none;
    /* 셀 경계선을 배경 격자로 그리지 않는다 — 셀마다 실선을 주면
     * 줌 배율에서 선이 두 겹으로 겹쳐 보인다. */
    overscroll-behavior: contain;
  }
  .scroller.resizing {
    cursor: col-resize;
    user-select: none;
  }
  .scroller:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }

  .content {
    position: relative;
    min-width: 100%;
  }

  .row {
    display: flex;
    align-items: stretch;
    width: max-content;
    min-width: 100%;
  }

  /* 머리글·고정 행은 세로 스크롤에서 붙어 있는다. */
  .row.head,
  .row.frozen-row {
    position: sticky;
    z-index: 3;
    background: var(--surface);
  }
  .row.head {
    z-index: 5;
  }
  .row.frozen-row {
    box-shadow: 0 1px 0 var(--border-strong);
  }

  .corner,
  .rowhead,
  .colhead {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    position: relative;
    user-select: none;
  }

  /* 행 머리글과 고정 열은 가로 스크롤에서 붙어 있는다. */
  .corner,
  .rowhead {
    position: sticky;
    left: 0;
    z-index: 4;
  }
  .colhead.frozen-col,
  .cell.frozen-col {
    position: sticky;
    z-index: 2;
  }
  .colhead.frozen-col {
    z-index: 6;
  }
  .cell.frozen-col {
    background: var(--surface);
  }

  .colhead.hot,
  .rowhead.hot {
    background: var(--accent-weak);
    color: var(--accent-ink);
  }

  .headhit {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    cursor: cell;
  }
  .headhit:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }

  .col-resize,
  .row-resize {
    all: unset;
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }
  .row-resize {
    left: 0;
    bottom: -3px;
    height: 6px;
    width: 100%;
    cursor: row-resize;
    z-index: 1;
  }

  .col-resize:focus-visible,
  .row-resize:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -1px;
  }

  /* 열 머리글의 필터 단추 — 너비 조절 손잡이(오른쪽 6px)를 피해 그 안쪽에 앉는다. */
  .filter-btn {
    all: unset;
    position: absolute;
    top: 50%;
    right: 5px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    opacity: 0.5;
    cursor: pointer;
    z-index: 2;
  }
  .colhead:hover .filter-btn,
  .filter-btn:focus-visible {
    opacity: 1;
  }
  .filter-btn:hover {
    background: var(--surface);
    color: var(--text);
    opacity: 1;
  }
  .filter-btn.on {
    color: var(--accent-ink);
    opacity: 1;
  }
  .filter-btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .cell {
    flex: none;
    display: flex;
    align-items: flex-end;
    padding: 0 var(--space-xs);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-lg);
    line-height: 1.35;
    color: var(--text);
    overflow: hidden;
    white-space: nowrap;
    cursor: cell;
    /* 셀 안 글자는 넘치면 잘린다 — 엑셀처럼 옆 칸을 침범하지 않는다.
     * (침범 렌더는 선택 영역과 겹칠 때 어느 칸을 고른 건지 알 수 없게 만든다.) */
  }
  .cell.covered {
    border-right-color: transparent;
    border-bottom-color: transparent;
  }
  .cell.merged {
    z-index: 1;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  .cell.al-right {
    justify-content: flex-end;
    text-align: right;
  }
  .cell.al-center {
    justify-content: center;
    text-align: center;
  }
  .cell.va-top {
    align-items: flex-start;
  }
  .cell.va-middle {
    align-items: center;
  }
  .cell.wrap {
    white-space: normal;
    align-items: flex-start;
  }
  .cell.wrap .text {
    overflow: hidden;
  }
  .cell.b {
    font-weight: 700;
  }
  .cell.i {
    font-style: italic;
  }
  .cell.u {
    text-decoration: underline;
  }
  .cell.st {
    text-decoration: line-through;
  }
  .cell.us {
    text-decoration: underline line-through;
  }
  .cell.err {
    color: var(--danger);
    font-size: var(--text-md);
  }

  .cell.sel {
    background: var(--accent-weak);
  }
  .cell.cur {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    background: var(--surface);
    z-index: 2;
  }
  .cell.frozen-col.sel {
    background: var(--accent-weak);
  }

  .filler {
    flex: none;
    border-bottom: 1px solid var(--border);
  }

  /* 마지막 열 오른쪽에 남는 자리. 넓은 화면에서는 시트 너비가 창보다 좁을 수 있는데,
   * 그때 행이 중간에서 끝나 버리면 표가 잘린 것처럼 보인다 — 남는 폭을 이 칸이 먹어
   * 행 밑줄이 오른쪽 끝까지 이어지게 한다. */
  .tail {
    flex: 1 0 auto;
  }

  .pad {
    flex: none;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .head-pad {
    border-right: 1px solid transparent;
  }

  .editor {
    all: unset;
    width: 100%;
    height: 100%;
    font-family: inherit;
    font-size: var(--text-lg);
    color: var(--text);
    background: var(--surface);
    caret-color: var(--accent);
  }
</style>
