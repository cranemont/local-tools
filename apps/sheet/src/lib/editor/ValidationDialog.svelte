<script lang="ts">
  /**
   * 입력 규칙 편집기 — 고른 범위 하나에 규칙을 건다.
   *
   * 열 때 커서 칸의 규칙을 한 번만 읽는다(`untrack`). 여기서 문서를 구독하면
   * 남의 편집에 입력란이 되돌아간다 — 필터 메뉴와 같은 이유다.
   *
   * 화면이 정하는 것은 규칙의 모양뿐이고, 판정은 `sheet/validation.ts`가 한다.
   */
  import { untrack } from "svelte";
  import {
    COMPARE_OPS,
    compareArity,
    defaultRule,
    looksLikeRange,
    parseListItems,
    usesCompare,
    VALIDATION_KINDS,
    type CompareOp,
    type ValidationKind,
    type ValidationRule,
    type ViolationAction,
  } from "../sheet/validation";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let { onClose }: { onClose: () => void } = $props();

  const started = untrack(
    () => editor.validationAt(editor.cursor.row, editor.cursor.col) ?? defaultRule(),
  );
  const target = untrack(() => editor.selectionLabel);

  let kind = $state<ValidationKind>(started.kind);
  let source = $state(started.source ?? "");
  let op = $state<CompareOp>(started.op ?? "between");
  let value = $state(started.value ?? "");
  let value2 = $state(started.value2 ?? "");
  let formula = $state(started.formula ?? "");
  let allowBlank = $state(started.allowBlank);
  let action = $state<ViolationAction>(started.action);

  let root = $state<HTMLDivElement | null>(null);
  let firstField = $state<HTMLSelectElement | null>(null);

  const asRange = $derived(looksLikeRange(source));
  const items = $derived(asRange ? [] : parseListItems(source));
  const arity = $derived(compareArity(op));

  const ready = $derived.by(() => {
    if (kind === "list") return asRange || items.length > 0;
    if (kind === "custom") return formula.trim() !== "";
    return value.trim() !== "" && (arity < 2 || value2.trim() !== "");
  });

  function build(): ValidationRule {
    const rule = defaultRule(kind);
    rule.allowBlank = allowBlank;
    rule.action = action;
    if (kind === "list") {
      rule.source = source.trim();
    } else if (kind === "custom") {
      rule.formula = formula.trim().replace(/^=/, "");
    } else {
      rule.op = op;
      rule.value = value.trim();
      rule.value2 = arity === 2 ? value2.trim() : "";
    }
    return rule;
  }

  function apply(): void {
    if (!ready) return;
    editor.setValidation(build());
    onClose();
  }

  function clear(): void {
    editor.setValidation(null);
    onClose();
  }

  function onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) apply();
  }

  function onBackdrop(event: MouseEvent): void {
    if (root && !root.contains(event.target as Node)) onClose();
  }

  $effect(() => {
    firstField?.focus();
  });
</script>

<div class="backdrop" onmousedown={onBackdrop} role="presentation">
  <div
    class="dialog"
    bind:this={root}
    onkeydown={onKey}
    role="dialog"
    aria-modal="true"
    aria-label={t.validation.title}
    tabindex="-1"
  >
    <div class="head">
      <span class="title">{t.validation.title}</span>
      <!-- 규칙은 xlsx에만 담긴다 — CSV로 저장하면 사라진다는 것을 걸 때 알려 준다
           (조건부 서식 대화상자에도 같은 배지가 있다). -->
      <span class="badge" title={t.validation.xlsxOnly}>{t.validation.xlsxOnlyShort}</span>
      <span class="target" aria-label={t.validation.range}>{target}</span>
    </div>

    <label class="field">
      <span class="label">{t.validation.kind}</span>
      <select bind:value={kind} bind:this={firstField}>
        {#each VALIDATION_KINDS as id (id)}
          <option value={id}>{t.validation.kinds[id]}</option>
        {/each}
      </select>
    </label>

    {#if kind === "list"}
      <label class="field">
        <span class="label">{t.validation.source}</span>
        <input
          class="input"
          bind:value={source}
          placeholder={t.validation.sourcePlaceholder}
          title={t.validation.sourceHint}
          spellcheck="false"
        />
      </label>
      <span class="note">
        {asRange
          ? t.validation.fromRange
          : items.length > 0
            ? t.validation.items(items.length)
            : t.validation.itemsNone}
      </span>
    {:else if kind === "custom"}
      <label class="field">
        <span class="label">{t.validation.formula}</span>
        <input
          class="input mono"
          bind:value={formula}
          placeholder="=A1>0"
          title={t.validation.formulaHint}
          spellcheck="false"
        />
      </label>
    {:else if usesCompare(kind)}
      <label class="field">
        <span class="label">{t.validation.compare}</span>
        <select bind:value={op}>
          {#each COMPARE_OPS as id (id)}
            <option value={id}>{t.validation.op[id]}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label">{t.validation.value}</span>
        <input class="input" bind:value spellcheck="false" />
      </label>
      {#if arity === 2}
        <label class="field">
          <span class="label">{t.validation.value2}</span>
          <input class="input" bind:value={value2} spellcheck="false" />
        </label>
      {/if}
    {/if}

    <label class="field check">
      <input type="checkbox" bind:checked={allowBlank} />
      <span>{t.validation.allowBlank}</span>
    </label>

    <label class="field">
      <span class="label">{t.validation.action}</span>
      <select bind:value={action}>
        <option value="reject">{t.validation.actions.reject}</option>
        <option value="warn">{t.validation.actions.warn}</option>
      </select>
    </label>

    <div class="foot">
      <button class="btn small primary" disabled={!ready} onclick={apply}>
        {t.validation.apply}
      </button>
      <button class="btn small ghost" onclick={clear}>{t.validation.clear}</button>
      <span class="spacer"></span>
      <button class="btn small ghost" onclick={onClose}>{t.validation.cancel}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 60%, transparent);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    width: min(360px, calc(100vw - var(--space-2xl)));
    padding: var(--space-md);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-2);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    padding-bottom: var(--space-2xs);
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-size: var(--text-xl);
    color: var(--text);
  }
  .badge {
    padding: 1px var(--space-2xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .target {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .field {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .field .label {
    flex: none;
    width: 5.5em;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .field.check {
    gap: var(--space-xs);
    font-size: var(--text-base);
    color: var(--text);
    cursor: pointer;
  }
  .field.check input {
    accent-color: var(--accent);
  }

  .input,
  select {
    min-width: 0;
    flex: 1;
    height: 28px;
    padding: 0 var(--space-2xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-base);
  }
  .input.mono {
    font-family: var(--font-mono);
  }
  .input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .note {
    padding-left: calc(5.5em + var(--space-sm));
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding-top: var(--space-2xs);
    border-top: 1px solid var(--border);
  }
  .foot .spacer {
    flex: 1;
  }
</style>
