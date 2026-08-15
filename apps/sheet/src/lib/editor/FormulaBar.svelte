<script lang="ts">
  /** 셀 주소 상자 + 수식 입력줄.
   *
   * 그리드 안 편집과 같은 버퍼(editor.editing)를 쓴다 — 한쪽에서 치면 다른 쪽도
   * 따라오게 하려는 것. 그래서 여기서 타자를 시작하면 그리드 셀도 편집 상태가 된다. */
  import { parseArea } from "../sheet/a1";
  import { formulaError } from "../formula/engine";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let { onDone }: { onDone: () => void } = $props();

  let input = $state<HTMLInputElement | null>(null);
  let refInput = $state<HTMLInputElement | null>(null);

  /** 편집 중이면 버퍼, 아니면 커서 셀의 원문. */
  const shown = $derived(
    editor.editing ? editor.editing.text : editor.editTextAt(editor.cursor.row, editor.cursor.col),
  );

  const problem = $derived.by(() => {
    const text = editor.editing?.text ?? "";
    if (!text.startsWith("=") || text.length < 2) return null;
    return formulaError(text.slice(1));
  });

  function onInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (!editor.editing) {
      editor.beginEdit(value);
    } else {
      editor.editing = { ...editor.editing, text: value };
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      // 규칙에 걸려 되돌아가면 편집 상태를 그대로 둔다 — 친 글자가 남아 있어야
      // 고쳐 칠 수 있다. 그때는 그리드로 초점을 넘기지 않는다.
      editor.commitEdit(input?.value ?? "", { row: 1, col: 0 }, true);
      if (!editor.editing) onDone();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editor.cancelEdit();
      onDone();
    }
    event.stopPropagation();
  }

  function gotoRef(event: KeyboardEvent): void {
    if (event.key !== "Enter") {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    const area = parseArea((refInput?.value ?? "").trim());
    if (area) {
      editor.select(area.top, area.left);
      editor.extendTo(area.bottom, area.right);
    }
    refInput?.blur();
    onDone();
  }
</script>

<div class="bar">
  <input
    class="ref"
    bind:this={refInput}
    value={editor.selectionLabel}
    onkeydown={gotoRef}
    onfocus={(e) => e.currentTarget.select()}
    aria-label="셀 주소"
    spellcheck="false"
  />
  <span class="fx" aria-hidden="true">fx</span>
  <input
    class="formula"
    class:bad={problem !== null}
    bind:this={input}
    value={shown}
    oninput={onInput}
    onkeydown={onKeyDown}
    placeholder={t.formulaBar.placeholder}
    aria-label={t.formulaBar.placeholder}
    spellcheck="false"
    autocomplete="off"
  />
  {#if problem}
    <span class="hint" role="status">{t.formulaBar.error(problem)}</span>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-2xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .ref {
    flex: none;
    width: 104px;
    padding: var(--space-2xs) var(--space-xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    text-align: center;
  }

  .fx {
    flex: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    font-style: italic;
  }

  .formula {
    flex: 1;
    min-width: 0;
    padding: var(--space-2xs) var(--space-xs);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-lg);
  }
  .formula:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -1px;
  }
  .formula.bad {
    border-color: var(--danger);
  }

  .hint {
    flex: none;
    color: var(--danger);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  @media (max-width: 720px) {
    .hint {
      display: none;
    }
  }
</style>
