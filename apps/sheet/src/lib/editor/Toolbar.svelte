<script lang="ts">
  /** 서식·편집 도구줄. 상태 표시는 전부 커서 셀의 서식을 따른다.
   *
   * 그림만으로는 못 알아보는 동작에는 글자를 붙였다(정렬·병합·틀 고정·찾기…).
   * 굵게/기울임/밑줄/취소선은 아이콘 대신 **글자 자신이 그 서식으로 그려진다** —
   * 손으로 그린 B 모양보다 그게 훨씬 빨리 읽힌다.
   */
  import Icon from "../Icon.svelte";
  import { FORMAT_PRESETS } from "../sheet/numfmt";
  import type { BorderSide } from "../sheet/types";
  import Dropdown from "./Dropdown.svelte";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let { onFind }: { onFind: () => void } = $props();

  const style = $derived(editor.cursorStyle);

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

  <Dropdown title={t.edit.sort} label={t.edit.sort} icon="sort-asc">
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
      </button>
      <span class="sep"></span>
      <span class="group-label">{t.edit.sortHint}</span>
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
