<script lang="ts">
  import { diffLines, diffWordsWithSpace } from "diff";
  import { t } from "../i18n";
  import { persisted } from "../persist.svelte";

  type View = "split" | "inline";

  const left = persisted("diff.left", "");
  const right = persisted("diff.right", "");
  const ignoreWs = persisted("diff.ignoreWs", false);
  const view = persisted<View>("diff.view", "split");
  const wrap = persisted("diff.wrap", true);

  /** 줄 안 강조는 짝지어진 줄에만 — 너무 긴 줄은 단어 diff 비용이 급해진다. */
  const WORD_LIMIT = 2000;
  const MAX_ROWS = 4000;

  interface Seg {
    text: string;
    mark: boolean;
  }
  interface Row {
    kind: "same" | "add" | "del" | "mod";
    ln: number | null; // 원본 줄 번호
    rn: number | null; // 변경 줄 번호
    left: Seg[];
    right: Seg[];
  }

  const plain = (s: string): Seg[] => (s ? [{ text: s, mark: false }] : []);

  /** 한 줄씩 맞대어 바뀐 단어만 표시한다 — 글자 하나 때문에 줄 전체가 물들지 않게. */
  function wordPair(a: string, b: string): { left: Seg[]; right: Seg[] } {
    if (!a || !b || a.length > WORD_LIMIT || b.length > WORD_LIMIT)
      return { left: [{ text: a, mark: true }], right: [{ text: b, mark: true }] };
    const l: Seg[] = [];
    const r: Seg[] = [];
    for (const part of diffWordsWithSpace(a, b)) {
      if (part.added) r.push({ text: part.value, mark: true });
      else if (part.removed) l.push({ text: part.value, mark: true });
      else {
        l.push({ text: part.value, mark: false });
        r.push({ text: part.value, mark: false });
      }
    }
    return { left: l, right: r };
  }

  /** 마지막 줄의 개행은 줄 하나로 세지 않는다 */
  function toLines(value: string): string[] {
    const lines = value.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  const diff = $derived.by(() => {
    if (!left.current && !right.current)
      return { rows: [] as Row[], added: 0, removed: 0, capped: false };
    const parts = diffLines(left.current, right.current, { ignoreWhitespace: ignoreWs.current });
    const rows: Row[] = [];
    let ln = 1;
    let rn = 1;
    let added = 0;
    let removed = 0;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part.added && !part.removed) {
        for (const line of toLines(part.value))
          rows.push({ kind: "same", ln: ln++, rn: rn++, left: plain(line), right: plain(line) });
        continue;
      }
      // 삭제 덩어리 바로 뒤의 추가 덩어리는 '고쳐 쓴 줄'이다 — 짝지어 본다.
      let dels: string[] = [];
      let adds: string[] = [];
      if (part.removed) {
        dels = toLines(part.value);
        const next = parts[i + 1];
        if (next?.added) {
          adds = toLines(next.value);
          i++; // 짝지은 추가 덩어리는 여기서 소비한다
        }
      } else {
        adds = toLines(part.value);
      }
      removed += dels.length;
      added += adds.length;
      const pairs = Math.min(dels.length, adds.length);
      for (let k = 0; k < pairs; k++) {
        const { left: l, right: r } = wordPair(dels[k], adds[k]);
        rows.push({ kind: "mod", ln: ln++, rn: rn++, left: l, right: r });
      }
      for (let k = pairs; k < dels.length; k++)
        rows.push({ kind: "del", ln: ln++, rn: null, left: [{ text: dels[k], mark: true }], right: [] });
      for (let k = pairs; k < adds.length; k++)
        rows.push({ kind: "add", ln: null, rn: rn++, left: [], right: [{ text: adds[k], mark: true }] });
    }

    const capped = rows.length > MAX_ROWS;
    return { rows: capped ? rows.slice(0, MAX_ROWS) : rows, added, removed, capped };
  });

  // 한 줄로 보기에서는 고쳐 쓴 줄이 삭제·추가 두 줄로 풀린다.
  const flat = $derived.by(() => {
    const out: { kind: Row["kind"]; ln: number | null; rn: number | null; segs: Seg[] }[] = [];
    for (const row of diff.rows) {
      if (row.kind === "mod") {
        out.push({ kind: "del", ln: row.ln, rn: null, segs: row.left });
        out.push({ kind: "add", ln: null, rn: row.rn, segs: row.right });
      } else if (row.kind === "add") out.push({ kind: "add", ln: null, rn: row.rn, segs: row.right });
      else if (row.kind === "del") out.push({ kind: "del", ln: row.ln, rn: null, segs: row.left });
      else out.push({ kind: "same", ln: row.ln, rn: row.rn, segs: row.left });
    }
    return out;
  });
</script>

<div class="tool">
  <div class="t-controls">
    <div class="t-chiprow" role="group" aria-label={t.diff.title}>
      <button
        class="t-chip"
        class:active={view.current === "split"}
        aria-pressed={view.current === "split"}
        onclick={() => (view.current = "split")}
      >
        {t.diff.viewSplit}
      </button>
      <button
        class="t-chip"
        class:active={view.current === "inline"}
        aria-pressed={view.current === "inline"}
        onclick={() => (view.current = "inline")}
      >
        {t.diff.viewInline}
      </button>
    </div>
    <label class="t-checkrow">
      <input type="checkbox" bind:checked={ignoreWs.current} />
      {t.diff.ignoreWs}
    </label>
    <label class="t-checkrow">
      <input type="checkbox" bind:checked={wrap.current} />
      {t.diff.wrap}
    </label>
    {#if diff.rows.length}
      <span class="counts" class:same={diff.added === 0 && diff.removed === 0}>
        {diff.added === 0 && diff.removed === 0
          ? t.diff.same
          : t.diff.counts(diff.added, diff.removed)}
      </span>
    {/if}
  </div>

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.diff.left}</span></div>
      <textarea class="t-textarea" bind:value={left.current} spellcheck="false"></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.diff.right}</span></div>
      <textarea class="t-textarea" bind:value={right.current} spellcheck="false"></textarea>
    </div>
  </div>

  {#if diff.rows.length}
    <div class="result" class:wrap={wrap.current}>
      {#if view.current === "split"}
        <div class="grid split">
          {#each diff.rows as row, i (i)}
            <span class="num">{row.ln ?? ""}</span>
            <span class="cell" class:del={row.kind === "del" || row.kind === "mod"}
              >{#each row.left as seg, si (si)}<span class:mark={seg.mark}>{seg.text}</span
                >{/each}</span
            >
            <span class="num">{row.rn ?? ""}</span>
            <span class="cell" class:add={row.kind === "add" || row.kind === "mod"}
              >{#each row.right as seg, si (si)}<span class:mark={seg.mark}>{seg.text}</span
                >{/each}</span
            >
          {/each}
        </div>
      {:else}
        <div class="grid inline">
          {#each flat as row, i (i)}
            <span class="num">{row.ln ?? ""}</span>
            <span class="num">{row.rn ?? ""}</span>
            <span class="cell" class:add={row.kind === "add"} class:del={row.kind === "del"}
              >{#each row.segs as seg, si (si)}<span class:mark={seg.mark}>{seg.text}</span
                >{/each}</span
            >
          {/each}
        </div>
      {/if}
    </div>
    {#if diff.capped}
      <p class="t-note">{t.diff.capped(MAX_ROWS)}</p>
    {/if}
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .counts {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--accent-ink);
  }
  .counts.same {
    color: var(--text-muted);
  }

  .result {
    margin-top: var(--space-md);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: auto;
  }

  .grid {
    display: grid;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1.55;
    /* 줄바꿈을 끄면 한 줄이 그대로 뻗고 상자가 가로로 구른다 */
    white-space: pre;
    min-width: max-content;
  }
  .split {
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
  }
  .inline {
    grid-template-columns: auto auto minmax(0, 1fr);
  }
  .result.wrap .grid {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    min-width: 0;
  }

  .num {
    padding: 0 var(--space-xs);
    text-align: right;
    color: var(--text-muted);
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    user-select: none;
    white-space: pre;
  }

  .cell {
    padding: 0 var(--space-sm);
    min-width: 0;
  }
  .cell.add {
    background: color-mix(in oklab, var(--success) 12%, transparent);
  }
  .cell.del {
    background: color-mix(in oklab, var(--danger) 10%, transparent);
  }
  .cell.add .mark {
    background: color-mix(in oklab, var(--success) 30%, transparent);
    border-radius: 2px;
  }
  .cell.del .mark {
    background: color-mix(in oklab, var(--danger) 26%, transparent);
    border-radius: 2px;
  }
</style>
