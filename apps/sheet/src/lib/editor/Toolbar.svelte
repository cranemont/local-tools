<script lang="ts">
  /** 서식·편집 도구줄. 상태 표시는 전부 커서 셀의 서식을 따른다.
   *
   * 그림만으로는 못 알아보는 동작에는 글자를 붙였다(정렬·병합·틀 고정·찾기…).
   * 굵게/기울임/밑줄/취소선은 아이콘 대신 **글자 자신이 그 서식으로 그려진다** —
   * 손으로 그린 B 모양보다 그게 훨씬 빨리 읽힌다.
   */
  import Icon from "../Icon.svelte";
  import { DELIMITERS, ENCODINGS, type Delimiter } from "../sheet/csv";
  import { FORMAT_PRESETS } from "../sheet/numfmt";
  import type { BorderSide } from "../sheet/types";
  import Dropdown from "./Dropdown.svelte";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let { onFind }: { onFind: () => void } = $props();

  const style = $derived(editor.cursorStyle);

  // ── 정렬 ──────────────────────────────────────────────────────
  // 기준을 세 줄까지 받는다. 앞 줄이 같을 때만 다음 줄을 본다.
  const SORT_SLOTS = [0, 1, 2];
  let sortCols = $state<number[]>([-1, -1, -1]);
  let sortAsc = $state<boolean[]>([true, true, true]);
  /** 머리글 체크는 추정값에서 시작하고, 손으로 고치면 그 값이 이긴다. */
  let sortHeaderPick = $state<boolean | null>(null);

  const sortHeader = $derived(sortHeaderPick ?? editor.headerRowsGuess > 0);
  const sortColumns = $derived(editor.sortableColumns(sortHeader ? 1 : 0));

  /**
   * 고른 기준 중 지금 표에 실제로 있는 것만 남긴다 — 고른 값은 파일을 바꿔도
   * 그대로 남아 있어서, 좁은 표를 열면 사라진 열을 가리킨 채로 있을 수 있다.
   * 그대로 두면 버튼은 눌리는데 아무 일도 안 일어난다.
   */
  const sortKeys = $derived(
    SORT_SLOTS.filter((i) => sortColumns.some((column) => column.col === sortCols[i])).map((i) => ({
      col: sortCols[i],
      asc: sortAsc[i],
    })),
  );

  function runSort(close: () => void): void {
    if (sortKeys.length === 0) return;
    editor.sortRows(sortKeys, sortHeader ? 1 : 0);
    close();
  }

  // ── 다시 읽기 ─────────────────────────────────────────────────

  function reread(options: { encoding?: string; delimiter?: Delimiter }): void {
    if (editor.dirty && !confirm(`${t.file.unsavedTitle}\n${t.file.rereadWarn}`)) return;
    editor.reread(options);
  }

  const MARKS = [
    { key: "bold", glyph: "B", label: t.format.bold },
    { key: "italic", glyph: "I", label: t.format.italic },
    { key: "underline", glyph: "U", label: t.format.underline },
    { key: "strike", glyph: "S", label: t.format.strike },
  ] as const;

  const ALIGNS = [
    { id: "left", icon: "align-left", label: t.format.alignLeft },
    { id: "center", icon: "align-center", label: t.format.alignCenter },
    { id: "right", icon: "align-right", label: t.format.alignRight },
  ] as const;

  const BORDER_PRESETS: { id: string; label: string; sides: BorderSide[] | undefined }[] = [
    { id: "all", label: "모든 테두리", sides: ["top", "right", "bottom", "left"] },
    { id: "bottom", label: "아래쪽만", sides: ["bottom"] },
    { id: "top", label: "위쪽만", sides: ["top"] },
    { id: "none", label: "없음", sides: undefined },
  ];

  const FILL_SWATCHES = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#e5e7eb"];
  const TEXT_SWATCHES = ["#b91c1c", "#a16207", "#15803d", "#1d4ed8", "#6d28d9", "#111827"];

  const currentFormat = $derived(
    FORMAT_PRESETS.find((p) => p.code === (style.numFmt ?? "General"))?.label ?? "사용자 지정",
  );

  const frozen = $derived(editor.sheet.frozenRows > 0 || editor.sheet.frozenCols > 0);
</script>

<div class="toolbar" role="toolbar" aria-label={t.format.title}>
  <div class="group">
    <button
      class="icon-btn tool"
      title="{t.edit.undo} (Ctrl+Z)"
      disabled={!editor.canUndo}
      onclick={() => editor.undo()}
    >
      <Icon name="undo" size={16} />
      <span class="sr-only">{t.edit.undo}</span>
    </button>
    <button
      class="icon-btn tool"
      title="{t.edit.redo} (Ctrl+Shift+Z)"
      disabled={!editor.canRedo}
      onclick={() => editor.redo()}
    >
      <Icon name="redo" size={16} />
      <span class="sr-only">{t.edit.redo}</span>
    </button>
  </div>

  <span class="divider" aria-hidden="true"></span>

  <div class="group">
    {#each MARKS as mark (mark.key)}
      <button
        class="icon-btn tool"
        class:active={style[mark.key] === true}
        title={mark.label}
        aria-pressed={style[mark.key] === true}
        onclick={() => editor.toggleFormat(mark.key)}
      >
        <span class="glyph {mark.key}" aria-hidden="true">{mark.glyph}</span>
        <span class="sr-only">{mark.label}</span>
      </button>
    {/each}
  </div>

  <span class="divider" aria-hidden="true"></span>

  <div class="group">
    {#each ALIGNS as opt (opt.id)}
      <button
        class="icon-btn tool"
        class:active={style.align === opt.id}
        title={opt.label}
        aria-pressed={style.align === opt.id}
        onclick={() => editor.applyFormat({ align: style.align === opt.id ? undefined : opt.id })}
      >
        <Icon name={opt.icon} size={16} />
        <span class="sr-only">{opt.label}</span>
      </button>
    {/each}
    <button
      class="icon-btn tool"
      class:active={style.wrap === true}
      title={t.format.wrap}
      aria-pressed={style.wrap === true}
      onclick={() => editor.toggleFormat("wrap")}
    >
      <Icon name="wrap" size={16} />
      <span class="sr-only">{t.format.wrap}</span>
    </button>
  </div>

  <span class="divider" aria-hidden="true"></span>

  <Dropdown title={t.format.color} label={t.format.color} icon="type">
    {#snippet children(close)}
      <div class="swatches">
        {#each TEXT_SWATCHES as color (color)}
          <button
            class="swatch"
            style="background:{color}"
            title={color}
            onclick={() => {
              editor.applyFormat({ color });
              close();
            }}
            aria-label="글자색 {color}"
          ></button>
        {/each}
      </div>
      <button
        class="item"
        onclick={() => {
          editor.applyFormat({ color: undefined });
          close();
        }}
      >
        {t.format.noColor}
      </button>
    {/snippet}
  </Dropdown>

  <Dropdown title={t.format.fill} label={t.format.fill} icon="paint">
    {#snippet children(close)}
      <div class="swatches">
        {#each FILL_SWATCHES as color (color)}
          <button
            class="swatch"
            style="background:{color}"
            title={color}
            onclick={() => {
              editor.applyFormat({ fill: color });
              close();
            }}
            aria-label="채우기색 {color}"
          ></button>
        {/each}
      </div>
      <button
        class="item"
        onclick={() => {
          editor.applyFormat({ fill: undefined });
          close();
        }}
      >
        {t.format.noColor}
      </button>
    {/snippet}
  </Dropdown>

  <Dropdown title={t.format.borders} label={t.format.borders} icon="borders">
    {#snippet children(close)}
      {#each BORDER_PRESETS as preset (preset.id)}
        <button
          class="item"
          onclick={() => {
            editor.applyFormat({ borders: preset.sides });
            close();
          }}
        >
          {preset.label}
        </button>
      {/each}
    {/snippet}
  </Dropdown>

  <span class="divider" aria-hidden="true"></span>

  <Dropdown title={t.format.numberFormat} label={currentFormat} icon="hash" wide>
    {#snippet children(close)}
      <span class="group-label">{t.format.numberFormat}</span>
      {#each FORMAT_PRESETS as preset (preset.id)}
        <button
          class="item"
          class:on={(style.numFmt ?? "General") === preset.code}
          onclick={() => {
            editor.setNumberFormat(preset.code);
            close();
          }}
        >
          {preset.label}
          <span class="trail">{preset.code === "General" ? "" : preset.code}</span>
        </button>
      {/each}
      <span class="sep"></span>
      <button
        class="item"
        onclick={() => {
          editor.clearSelectionFormat();
          close();
        }}
      >
        {t.format.clearFormat}
      </button>
    {/snippet}
  </Dropdown>

  <span class="divider" aria-hidden="true"></span>

  <Dropdown title={t.edit.sort} label={t.edit.sort} icon="sort-asc" wide>
    {#snippet children(close)}
      <button
        class="item"
        onclick={() => {
          editor.sortBySelection(true);
          close();
        }}
      >
        <Icon name="sort-asc" size={15} />
        {t.edit.sortAsc}
        <span class="trail">{t.edit.sortQuick}</span>
      </button>
      <button
        class="item"
        onclick={() => {
          editor.sortBySelection(false);
          close();
        }}
      >
        <Icon name="sort-desc" size={15} />
        {t.edit.sortDesc}
        <span class="trail">{t.edit.sortQuick}</span>
      </button>

      <span class="sep"></span>
      <span class="group-label">{t.edit.sort}</span>

      {#each SORT_SLOTS as slot (slot)}
        <div class="sortkey">
          <span class="rank">{t.edit.sortKey(slot + 1)}</span>
          <select bind:value={sortCols[slot]} aria-label="{t.edit.sortKey(slot + 1)} {t.edit.sort}">
            <option value={-1}>{t.edit.sortKeyNone}</option>
            {#each sortColumns as column (column.col)}
              <option value={column.col}>{column.label}</option>
            {/each}
          </select>
          <select
            bind:value={sortAsc[slot]}
            disabled={sortCols[slot] < 0}
            aria-label="{t.edit.sortKey(slot + 1)} {t.edit.sortDirection}"
          >
            <option value={true}>{t.edit.sortAsc}</option>
            <option value={false}>{t.edit.sortDesc}</option>
          </select>
        </div>
      {/each}

      <label class="item check">
        <input
          type="checkbox"
          checked={sortHeader}
          onchange={(e) => (sortHeaderPick = e.currentTarget.checked)}
        />
        {t.edit.sortHeader}
      </label>
      <button
        class="btn small primary sort-run"
        disabled={sortKeys.length === 0}
        onclick={() => runSort(close)}
      >
        {t.edit.sortRun}
      </button>
    {/snippet}
  </Dropdown>

  <Dropdown title={t.edit.rowsCols} label={t.edit.rowsCols} icon="table">
    {#snippet children(close)}
      <button class="item" onclick={() => { editor.insertRowsAt(); close(); }}>
        {t.edit.insertRow}
      </button>
      <button class="item" onclick={() => { editor.deleteRowsAt(); close(); }}>
        {t.edit.deleteRow}
      </button>
      <span class="sep"></span>
      <button class="item" onclick={() => { editor.insertColsAt(); close(); }}>
        {t.edit.insertCol}
      </button>
      <button class="item" onclick={() => { editor.deleteColsAt(); close(); }}>
        {t.edit.deleteCol}
      </button>
      <span class="sep"></span>
      <button
        class="item"
        title={t.edit.asTextHint}
        onclick={() => { editor.forceSelectionText(); close(); }}
      >
        {t.edit.asText}
      </button>
    {/snippet}
  </Dropdown>

  <button class="btn small ghost labeled" title={t.edit.mergeHint} onclick={() => editor.toggleMerge()}>
    <Icon name="merge" size={16} />
    {t.edit.merge}
  </button>

  <button
    class="btn small ghost labeled"
    class:active={frozen}
    title={t.edit.freezeHint}
    aria-pressed={frozen}
    onclick={() => editor.freezeHere()}
  >
    <Icon name="freeze" size={16} />
    {frozen ? t.edit.unfreeze : t.edit.freeze}
  </button>

  <span class="divider" aria-hidden="true"></span>

  <button class="btn small ghost labeled" title="{t.find.label} (Ctrl+F)" onclick={onFind}>
    <Icon name="search" size={16} />
    {t.find.label}
  </button>

  {#if editor.canReread}
    <Dropdown title={t.file.rereadHint} label={t.file.reread} icon="refresh" wide>
      {#snippet children(close)}
        <span class="group-label">{t.file.encoding}</span>
        {#each ENCODINGS as enc (enc.id)}
          <button
            class="item"
            class:on={editor.encodingChoice === enc.id}
            onclick={() => {
              reread({ encoding: enc.id });
              close();
            }}
          >
            {enc.label}
            {#if enc.id === "auto" && editor.encodingChoice === "auto"}
              <span class="trail">{t.file.detected(editor.encoding)}</span>
            {/if}
          </button>
        {/each}
        <span class="sep"></span>
        <span class="group-label">{t.file.delimiter}</span>
        {#each DELIMITERS as d (d.id)}
          <button
            class="item"
            class:on={editor.delimiter === d.id}
            onclick={() => {
              reread({ delimiter: d.id });
              close();
            }}
          >
            {d.label}
          </button>
        {/each}
      {/snippet}
    </Dropdown>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3xs);
    padding: var(--space-2xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .group {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3xs);
  }

  .divider {
    width: 1px;
    height: 18px;
    margin: 0 var(--space-2xs);
    background: var(--border);
  }

  /* 글자 자체가 그 서식으로 그려지는 버튼 — B는 굵게, I는 기울임… */
  .glyph {
    font-size: var(--text-xl);
    line-height: 1;
    font-family: Georgia, "Times New Roman", serif;
  }
  .glyph.bold {
    font-weight: 800;
  }
  .glyph.italic {
    font-style: italic;
  }
  .glyph.underline {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .glyph.strike {
    text-decoration: line-through;
  }

  /* 글자를 단 도구줄 버튼 — 여백을 좁혀 아이콘 버튼과 높이를 맞춘다. */
  .labeled {
    height: 28px;
    padding: 0 var(--space-sm);
    gap: var(--space-2xs);
    color: var(--text);
    font-weight: 500;
  }

  /* 정렬 기준 한 줄 — 메뉴 안에 들어가는 유일한 입력 묶음이라
   * 항목(.item)과 같은 좌우 여백에 맞춰 둔다. */
  .sortkey {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-3xs) var(--space-sm);
  }
  .sortkey .rank {
    flex: none;
    width: 3.5em;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .sortkey select {
    min-width: 0;
    height: 26px;
    padding: 0 var(--space-2xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-sm);
  }
  .sortkey select:first-of-type {
    flex: 1;
  }
  .sortkey select:disabled {
    opacity: 0.45;
  }
  .sortkey select:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .sort-run {
    margin: var(--space-2xs) var(--space-sm);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-sm) var(--space-xs);
  }

  .swatch {
    all: unset;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    cursor: pointer;
  }
  .swatch:hover {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .swatch:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
</style>
