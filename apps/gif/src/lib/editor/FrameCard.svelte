<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor, MIN_DELAY_MS, MAX_DELAY_MS } from "./state.svelte";
  import type { Frame } from "../gif/types";

  let { frame, index }: { frame: Frame; index: number } = $props();

  const isCurrent = $derived(index === editor.current);

  /** 그냥 클릭은 이 프레임 보기, Shift·Ctrl은 선택 조작으로 간다. */
  function activate(e: MouseEvent) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      editor.toggleSelect(frame.id, e.shiftKey);
      return;
    }
    editor.playing = false;
    editor.current = index;
  }

  function onDelayChange(e: Event) {
    const el = e.target as HTMLInputElement;
    editor.setFrameDelay(frame.id, Number(el.value));
    // 하한·상한에 걸린 값은 반영되지 않는다 — 칸을 실제 딜레이로 되돌린다.
    el.value = String(frame.delayMs);
  }
</script>

<div class="card" class:selected={frame.selected} class:current={isCurrent}>
  <button
    type="button"
    class="thumb"
    onclick={activate}
    title={t.frames.activate}
  >
    <img src={frame.thumb} alt={`#${index + 1}`} draggable="false" />
  </button>

  <button
    type="button"
    class="check"
    class:on={frame.selected}
    title={t.frames.select}
    aria-pressed={frame.selected}
    onclick={(e) => editor.toggleSelect(frame.id, e.shiftKey)}
  >
    {#if frame.selected}<Icon name="check" size={12} />{/if}
  </button>

  <div class="controls">
    <button
      type="button"
      onclick={() => editor.duplicateOne(frame.id)}
      title={t.frames.duplicate}
    >
      <Icon name="copy" size={13} />
    </button>
    <button
      type="button"
      class="danger"
      onclick={() => editor.deleteOne(frame.id)}
      title={t.frames.delete}
    >
      <Icon name="trash" size={13} />
    </button>
  </div>

  <div class="meta">
    <span class="idx">{index + 1}</span>
    <input
      class="delay"
      type="number"
      min={MIN_DELAY_MS}
      max={MAX_DELAY_MS}
      step="10"
      value={frame.delayMs}
      onchange={onDelayChange}
      draggable="false"
      aria-label={t.frames.delayInput(index + 1)}
      title={t.frames.delayInput(index + 1)}
    />
    <span class="unit">{t.frames.delayUnit}</span>
  </div>
</div>

<style>
  .card {
    position: relative;
    width: 88px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    user-select: none;
  }

  .thumb {
    position: relative;
    width: 88px;
    height: 66px;
    padding: 4px;
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition:
      border-color var(--dur-short) var(--ease-out),
      box-shadow var(--dur-short) var(--ease-out);
  }
  .thumb:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    pointer-events: none;
  }
  .card.current .thumb {
    border-color: var(--accent);
  }
  .card.selected .thumb {
    box-shadow: 0 0 0 2px var(--accent-weak);
  }

  .check {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: transparent;
    padding: 0;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }

  .controls {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 3px;
    opacity: 0;
    transition: opacity var(--dur-short) var(--ease-out);
  }
  .card:hover .controls,
  .card:focus-within .controls {
    opacity: 1;
  }

  /* 터치 기기엔 hover도 focus-within도 없다 — 컨트롤을 항상 노출한다.
   * 이게 없으면 폰·태블릿에서 회전·삭제에 아예 닿을 수 없다. */
  @media (hover: none) {
    .controls {
      opacity: 1;
    }
  }
  .controls button {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-1);
    padding: 0;
  }
  .controls button:hover {
    color: var(--text);
  }
  .controls button.danger:hover {
    color: var(--accent-contrast);
    background: var(--danger);
    border-color: var(--danger);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    padding: 0 2px;
  }
  .card.current .idx {
    color: var(--accent-ink);
    font-weight: 700;
  }
  .idx {
    flex: 1;
  }
  /* 카드 폭이 88px이라 딜레이 입력은 숫자 네 자리만 들어가면 된다. */
  .delay {
    width: 42px;
    padding: 1px 3px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-2xs);
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .delay:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* 스피너를 두면 42px 안에서 숫자가 잘린다 — 키보드 ↑↓는 그대로 동작한다. */
  .delay::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }
  .unit {
    font-variant-numeric: tabular-nums;
  }
</style>
