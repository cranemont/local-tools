<script lang="ts">
  /**
   * 조건부 서식 규칙 관리 — 목록·추가·수정·삭제·순서.
   *
   * 목록의 **위가 1순위**다. 한 칸에 여러 규칙이 걸리면 앞 규칙이 정한 속성을 뒤
   * 규칙이 덮지 못하고, "참이면 중지"가 켜진 규칙이 걸리면 뒤는 보지도 않는다.
   * 판정과 합성은 전부 `sheet/condformat.ts`가 한다 — 여기는 규칙의 모양만 만든다.
   */
  import { untrack } from "svelte";
  import Icon from "../Icon.svelte";
  import { formatArea, type Area } from "../sheet/a1";
  import {
    BAR_COLORS,
    COMPARE_OPS,
    compareArity,
    HILITE_PRESETS,
    mixColor,
    newRuleId,
    SCALE_PRESETS,
    scaleStops,
    TEXT_OPS,
    type BlankOp,
    type CompareOp,
    type CondRule,
    type CondStyle,
    type DupOp,
    type RankOp,
    type TextOp,
  } from "../sheet/condformat";
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let { onClose }: { onClose: () => void } = $props();

  const KINDS = ["compare", "text", "blank", "dup", "rank", "scale", "bar"] as const;
  type Kind = (typeof KINDS)[number];

  const rules = $derived(editor.condRules);

  // ── 폼 ────────────────────────────────────────────────────────

  let open = $state(false);
  /** 수정 중인 규칙 id. 새로 만드는 중이면 null. */
  let editingId = $state<string | null>(null);

  let kind = $state<Kind>("compare");
  let cmpOp = $state<CompareOp>("gt");
  let textOp = $state<TextOp>("contains");
  let blankOp = $state<BlankOp>("blank");
  let dupOp = $state<DupOp>("duplicate");
  let rankOp = $state<RankOp>("top");
  let value = $state("");
  let value2 = $state("");
  let count = $state(10);
  let percent = $state(false);
  let preset = $state(0);
  let bold = $state(false);
  let italic = $state(false);
  let strike = $state(false);
  let stopIfTrue = $state(false);
  let palette = $state(0);
  let three = $state(true);
  let barColor = $state(BAR_COLORS[0]);
  let barZero = $state(false);
  let range = $state<Area>(untrack(() => ({ ...editor.selection })));

  /**
   * 미리 준비한 색에 없는 색 — 엑셀 파일에서 온 규칙이 그렇다.
   * 고를 칸을 하나 더 내주지 않으면 **수정 단추를 누른 것만으로 색이 바뀐다.**
   */
  let keptStyle = $state<CondStyle | null>(null);
  let keptColors = $state<[string, string, string] | null>(null);

  let root = $state<HTMLDivElement | null>(null);

  const arity = $derived(compareArity(cmpOp));
  const styled = $derived(kind !== "scale" && kind !== "bar");

  /**
   * 이 규칙이 화면에 무언가를 남기는가. 색도 글꼴 표시도 없는 규칙은 걸어 놓아도
   * 아무 일이 안 일어나 "규칙이 안 먹는다"로 읽힌다. "참이면 중지"만 켠 규칙은
   * 아래 규칙을 막는 일을 하므로 뜻이 있다.
   */
  const marks = $derived(preset !== HILITE_PRESETS.length || bold || italic || strike || stopIfTrue);

  const ready = $derived.by(() => {
    if (styled && !marks) return false;
    if (kind === "compare") return value.trim() !== "" && (arity < 2 || value2.trim() !== "");
    if (kind === "text") return value.trim() !== "";
    if (kind === "rank") return count >= 1;
    return true;
  });

  function reset(): void {
    kind = "compare";
    cmpOp = "gt";
    textOp = "contains";
    blankOp = "blank";
    dupOp = "duplicate";
    rankOp = "top";
    value = "";
    value2 = "";
    count = 10;
    percent = false;
    preset = 0;
    bold = false;
    italic = false;
    strike = false;
    stopIfTrue = false;
    palette = 0;
    three = true;
    barColor = BAR_COLORS[0];
    barZero = false;
    keptStyle = null;
    keptColors = null;
    range = { ...editor.selection };
  }

  /** 눈금 색 세 개를 뽑는다 — 2색 규칙이면 가운데는 두 색을 섞어 채운다. */
  function colorsOf(stops: { color: string }[]): [string, string, string] {
    const first = stops[0].color;
    const last = stops[stops.length - 1].color;
    const mid = stops.length > 2 ? stops[1].color : mixColor(first, last, 0.5);
    return [first, mid, last];
  }

  function startAdd(): void {
    reset();
    editingId = null;
    open = true;
  }

  function startEdit(rule: CondRule): void {
    reset();
    editingId = rule.id;
    kind = rule.kind;
    range = { ...rule.range };
    stopIfTrue = rule.stopIfTrue === true;

    if (rule.kind === "scale") {
      three = rule.stops.length > 2;
      // 세 색을 다 봐야 한다 — 파랑과 회색은 첫 색이 둘 다 흰색이라
      // 첫 색만 재면 회색 눈금을 고쳐 놓고 파랑으로 돌려주게 된다.
      const colors = colorsOf(rule.stops);
      const at = SCALE_PRESETS.findIndex(
        (p) =>
          p.colors[0] === colors[0] &&
          p.colors[2] === colors[2] &&
          (!three || p.colors[1] === colors[1]),
      );
      if (at >= 0) palette = at;
      else {
        keptColors = colors;
        palette = -1;
      }
    } else if (rule.kind === "bar") {
      barColor = rule.color;
      barZero = rule.min.type === "num";
    } else {
      bold = rule.style.bold === true;
      italic = rule.style.italic === true;
      strike = rule.style.strike === true;
      const at = HILITE_PRESETS.findIndex(
        (p) => p.style.fill === rule.style.fill && p.style.color === rule.style.color,
      );
      if (at >= 0) preset = at;
      else if (rule.style.fill || rule.style.color) {
        keptStyle = {
          ...(rule.style.fill ? { fill: rule.style.fill } : {}),
          ...(rule.style.color ? { color: rule.style.color } : {}),
        };
        preset = -1;
      } else preset = HILITE_PRESETS.length;
      if (rule.kind === "compare") {
        cmpOp = rule.op;
        value = rule.value;
        value2 = rule.value2 ?? "";
      } else if (rule.kind === "text") {
        textOp = rule.op;
        value = rule.value;
      } else if (rule.kind === "blank") {
        blankOp = rule.op;
      } else if (rule.kind === "dup") {
        dupOp = rule.op;
      } else {
        rankOp = rule.op;
        count = rule.n;
        percent = rule.percent;
      }
    }
    open = true;
  }

  function pickedStyle(): CondStyle {
    const base = preset === -1 ? (keptStyle ?? {}) : (HILITE_PRESETS[preset]?.style ?? {});
    return {
      ...base,
      ...(bold ? { bold: true } : {}),
      ...(italic ? { italic: true } : {}),
      ...(strike ? { strike: true } : {}),
    };
  }

  function build(): CondRule {
    const id = editingId ?? newRuleId();
    const base = { id, range: { ...range }, ...(stopIfTrue ? { stopIfTrue: true } : {}) };
    const style = pickedStyle();
    switch (kind) {
      case "compare":
        return { ...base, kind, op: cmpOp, value: value.trim(), value2: value2.trim(), style };
      case "text":
        return { ...base, kind, op: textOp, value: value.trim(), style };
      case "blank":
        return { ...base, kind, op: blankOp, style };
      case "dup":
        return { ...base, kind, op: dupOp, style };
      case "rank":
        return { ...base, kind, op: rankOp, n: Math.max(1, Math.floor(count)), percent, style };
      case "scale": {
        const colors = palette === -1 && keptColors ? keptColors : SCALE_PRESETS[palette].colors;
        return { id, range: { ...range }, kind, stops: scaleStops(colors, three) };
      }
      case "bar":
        return {
          id,
          range: { ...range },
          kind,
          color: barColor,
          min: barZero ? { type: "num", value: 0 } : { type: "min" },
          max: { type: "max" },
        };
    }
  }

  function apply(): void {
    if (!ready) return;
    const rule = build();
    if (editingId) editor.replaceCondRule(rule);
    else editor.addCondRule(rule);
    open = false;
    editingId = null;
  }

  // ── 목록 ──────────────────────────────────────────────────────

  function summary(rule: CondRule): string {
    switch (rule.kind) {
      case "compare":
        return compareArity(rule.op) === 2
          ? `${t.cond.op[rule.op]} ${rule.value}~${rule.value2 ?? ""}`
          : `${t.cond.op[rule.op]} ${rule.value}`;
      case "text":
        return `${t.cond.op[rule.op]} ${rule.value}`;
      case "blank":
      case "dup":
        return t.cond.op[rule.op];
      case "rank":
        return `${t.cond.op[rule.op]} ${rule.n}${rule.percent ? "%" : ""}`;
      case "scale":
        return `${t.cond.kinds.scale} · ${rule.stops.length > 2 ? t.cond.three : t.cond.two}`;
      case "bar":
        return t.cond.kinds.bar;
    }
  }

  /** 목록 한 줄의 미리보기 조각 — 규칙이 칠하는 색을 그대로 보여 준다. */
  function chipStyle(rule: CondRule): string {
    if (rule.kind === "scale") {
      return `background:linear-gradient(to right, ${rule.stops.map((s) => s.color).join(",")})`;
    }
    if (rule.kind === "bar") {
      return `background:linear-gradient(to right, ${rule.color} 60%, transparent 60%)`;
    }
    const s = rule.style;
    return [
      s.fill ? `background:${s.fill}` : "",
      s.color ? `color:${s.color}` : "",
      s.bold ? "font-weight:700" : "",
      s.italic ? "font-style:italic" : "",
      s.strike ? "text-decoration:line-through" : "",
    ]
      .filter(Boolean)
      .join(";");
  }

  function onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  }

  function onBackdrop(event: MouseEvent): void {
    if (root && !root.contains(event.target as Node)) onClose();
  }

  // 열자마자 상자가 초점을 가져간다. 안 그러면 초점이 뒤의 도구줄 단추에 남아
  // Esc가 안 먹고, 방향키·Delete가 가려진 그리드로 그대로 간다(App.svelte는
  // window에서 받는다).
  $effect(() => {
    root?.focus();
  });
</script>

<div class="backdrop" onmousedown={onBackdrop} role="presentation">
  <div
    class="dialog"
    bind:this={root}
    onkeydown={onKey}
    role="dialog"
    aria-modal="true"
    aria-label={t.cond.label}
    tabindex="-1"
  >
    <div class="head">
      <span class="title">{t.cond.label}</span>
      <span class="badge" title={t.cond.scopeHint}>{t.cond.scope}</span>
      <span class="badge" title={t.cond.xlsxOnly}>{t.cond.xlsxOnlyShort}</span>
      <span class="target">{formatArea(range)}</span>
    </div>

    <div class="list" role="group" aria-label={t.cond.label}>
      {#each rules as rule, i (rule.id)}
        <div class="rule" class:on={editingId === rule.id}>
          <span class="chip" style={chipStyle(rule)} aria-hidden="true">{t.cond.sample}</span>
          <span class="what">{summary(rule)}</span>
          <span class="where">{formatArea(rule.range)}</span>
          {#if rule.stopIfTrue}
            <span class="badge" title={t.cond.stop}>{t.cond.stopShort}</span>
          {/if}
          <button
            class="icon-btn tool"
            title={t.cond.up}
            aria-label={t.cond.up}
            disabled={i === 0}
            onclick={() => editor.moveCondRule(rule.id, -1)}
          >
            <Icon name="sort-asc" size={14} />
          </button>
          <button
            class="icon-btn tool"
            title={t.cond.down}
            aria-label={t.cond.down}
            disabled={i === rules.length - 1}
            onclick={() => editor.moveCondRule(rule.id, 1)}
          >
            <Icon name="sort-desc" size={14} />
          </button>
          <button
            class="icon-btn tool"
            title={t.cond.edit}
            aria-label={t.cond.edit}
            onclick={() => startEdit(rule)}
          >
            <Icon name="type" size={14} />
          </button>
          <button
            class="icon-btn tool"
            title={t.cond.remove}
            aria-label={t.cond.remove}
            onclick={() => editor.removeCondRule(rule.id)}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      {:else}
        <span class="empty">{t.cond.none}</span>
      {/each}
    </div>

    {#if open}
      <div class="form">
        <label class="field">
          <span class="label">{t.cond.kind}</span>
          <select bind:value={kind}>
            {#each KINDS as id (id)}
              <option value={id}>{t.cond.kinds[id]}</option>
            {/each}
          </select>
        </label>

        {#if kind === "compare"}
          <div class="field">
            <span class="label">{t.cond.kinds.compare}</span>
            <select bind:value={cmpOp} aria-label={t.cond.kinds.compare}>
              {#each COMPARE_OPS as id (id)}
                <option value={id}>{t.cond.op[id]}</option>
              {/each}
            </select>
            <input class="input" bind:value aria-label={t.cond.value} spellcheck="false" />
            {#if arity === 2}
              <input class="input" bind:value={value2} aria-label={t.cond.value2} spellcheck="false" />
            {/if}
          </div>
        {:else if kind === "text"}
          <div class="field">
            <span class="label">{t.cond.kinds.text}</span>
            <select bind:value={textOp} aria-label={t.cond.kinds.text}>
              {#each TEXT_OPS as id (id)}
                <option value={id}>{t.cond.op[id]}</option>
              {/each}
            </select>
            <input class="input" bind:value aria-label={t.cond.value} spellcheck="false" />
          </div>
        {:else if kind === "blank"}
          <label class="field">
            <span class="label">{t.cond.kinds.blank}</span>
            <select bind:value={blankOp}>
              <option value="blank">{t.cond.op.blank}</option>
              <option value="notBlank">{t.cond.op.notBlank}</option>
            </select>
          </label>
        {:else if kind === "dup"}
          <label class="field">
            <span class="label">{t.cond.kinds.dup}</span>
            <select bind:value={dupOp}>
              <option value="duplicate">{t.cond.op.duplicate}</option>
              <option value="unique">{t.cond.op.unique}</option>
            </select>
          </label>
        {:else if kind === "rank"}
          <div class="field">
            <span class="label">{t.cond.kinds.rank}</span>
            <select bind:value={rankOp} aria-label={t.cond.kinds.rank}>
              <option value="top">{t.cond.op.top}</option>
              <option value="bottom">{t.cond.op.bottom}</option>
            </select>
            <input
              class="input num"
              type="number"
              min="1"
              max="1000"
              bind:value={count}
              aria-label={t.cond.count}
            />
            <label class="check">
              <input type="checkbox" bind:checked={percent} />
              <span>{t.cond.percent}</span>
            </label>
          </div>
        {:else if kind === "scale"}
          <div class="field">
            <span class="label">{t.cond.stops}</span>
            <select bind:value={three} aria-label={t.cond.stops}>
              <option value={false}>{t.cond.two}</option>
              <option value={true}>{t.cond.three}</option>
            </select>
          </div>
          <div class="field">
            <span class="label">{t.cond.palette}</span>
            <div class="swatches">
              {#each SCALE_PRESETS as item, i (item.id)}
                <button
                  class="swatch wide"
                  class:picked={palette === i}
                  style="background:linear-gradient(to right, {three
                    ? item.colors.join(',')
                    : `${item.colors[0]},${item.colors[2]}`})"
                  title={item.id}
                  aria-label="{t.cond.palette} {i + 1}"
                  onclick={() => (palette = i)}
                ></button>
              {/each}
              {#if keptColors}
                <button
                  class="swatch wide"
                  class:picked={palette === -1}
                  style="background:linear-gradient(to right, {three
                    ? keptColors.join(',')
                    : `${keptColors[0]},${keptColors[2]}`})"
                  title={t.cond.kept}
                  aria-label={t.cond.kept}
                  onclick={() => (palette = -1)}
                ></button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="field">
            <span class="label">{t.cond.barColor}</span>
            <div class="swatches">
              {#each BAR_COLORS as color (color)}
                <button
                  class="swatch"
                  class:picked={barColor === color}
                  style="background:{color}"
                  title={color}
                  aria-label="{t.cond.barColor} {color}"
                  onclick={() => (barColor = color)}
                ></button>
              {/each}
            </div>
          </div>
          <label class="field">
            <span class="label">{t.cond.barBase}</span>
            <select bind:value={barZero}>
              <option value={false}>{t.cond.barBaseMin}</option>
              <option value={true}>{t.cond.barBaseZero}</option>
            </select>
          </label>
        {/if}

        {#if styled}
          <div class="field">
            <span class="label">{t.cond.style}</span>
            <div class="swatches">
              {#each HILITE_PRESETS as item, i (item.id)}
                <button
                  class="swatch"
                  class:picked={preset === i}
                  style="background:{item.style.fill};color:{item.style.color}"
                  title={item.id}
                  aria-label="{t.cond.style} {i + 1}"
                  onclick={() => (preset = i)}
                >
                  {t.cond.sample}
                </button>
              {/each}
              {#if keptStyle}
                <button
                  class="swatch"
                  class:picked={preset === -1}
                  style="background:{keptStyle.fill ?? 'transparent'};color:{keptStyle.color ??
                    'inherit'}"
                  title={t.cond.kept}
                  aria-label={t.cond.kept}
                  onclick={() => (preset = -1)}
                >
                  {t.cond.sample}
                </button>
              {/if}
              <button
                class="swatch none"
                class:picked={preset === HILITE_PRESETS.length}
                title={t.format.noColor}
                aria-label={t.format.noColor}
                onclick={() => (preset = HILITE_PRESETS.length)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          </div>
          <div class="field marks">
            <span class="label"></span>
            <label class="check">
              <input type="checkbox" bind:checked={bold} />
              <span class="b">{t.format.bold}</span>
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={italic} />
              <span class="i">{t.format.italic}</span>
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={strike} />
              <span class="s">{t.format.strike}</span>
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={stopIfTrue} />
              <span>{t.cond.stop}</span>
            </label>
          </div>
        {/if}

        <div class="field">
          <span class="label">{t.cond.range}</span>
          <span class="target">{formatArea(range)}</span>
          <button class="btn small ghost" onclick={() => (range = { ...editor.selection })}>
            {t.cond.useSelection}
          </button>
        </div>

        <div class="foot">
          <button class="btn small primary" disabled={!ready} onclick={apply}>{t.cond.apply}</button>
          <button class="btn small ghost" onclick={() => (open = false)}>{t.cond.cancel}</button>
        </div>
      </div>
    {/if}

    <div class="foot">
      <button class="btn small" onclick={startAdd}>
        <Icon name="plus" size={14} />
        {t.cond.add}
      </button>
      <button class="btn small ghost" disabled={rules.length === 0} onclick={() => editor.clearCondRules()}>
        {t.cond.clearAll}
      </button>
      <span class="spacer"></span>
      <span class="hint">{t.cond.order}</span>
      <button class="btn small ghost" onclick={onClose}>{t.cond.cancel}</button>
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
    width: min(560px, calc(100vw - var(--space-2xl)));
    max-height: min(80vh, 720px);
    overflow-y: auto;
    scrollbar-width: thin;
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
  .target {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .head .target {
    margin-left: auto;
  }

  .badge {
    padding: 1px var(--space-2xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 216px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .rule {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-3xs) var(--space-2xs);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    color: var(--text);
  }
  .rule:hover {
    background: var(--surface-2);
  }
  .rule.on {
    background: var(--accent-weak);
  }

  .chip {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 20px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs);
  }

  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .empty {
    padding: var(--space-xs) var(--space-2xs);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-top: var(--space-2xs);
    border-top: 1px solid var(--border);
  }

  .field {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .field .label {
    flex: none;
    width: 4.5em;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .field.marks {
    gap: var(--space-md);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    font-size: var(--text-base);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
  }
  .check input {
    accent-color: var(--accent);
  }
  .check .b {
    font-weight: 700;
  }
  .check .i {
    font-style: italic;
  }
  .check .s {
    text-decoration: line-through;
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
  .input.num {
    flex: none;
    width: 5em;
  }
  .input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs);
  }

  .swatch {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    font-size: var(--text-2xs);
    cursor: pointer;
  }
  .swatch.wide {
    width: 56px;
  }
  .swatch.none {
    color: var(--text-muted);
  }
  .swatch.picked {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .swatch:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
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
  .hint {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
