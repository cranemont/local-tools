<script lang="ts">
  import { t } from "../i18n";
  import { groupLabel, type ProbeKind } from "../corpus/samples";
  import { lab } from "./state.svelte";
  import type { SlotView } from "./state.svelte";
  import { themeColor, onThemeChange, lerpRgb, type Rgb } from "./paint";

  let { view, slot }: { view: SlotView; slot: "A" | "B" } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let box = $state<HTMLDivElement | null>(null);
  let side = $state(420);
  let hover = $state<{ i: number; j: number } | null>(null);
  /** 테마가 바뀌면 증가시켜 다시 그리게 하는 카운터 */
  let themeTick = $state(0);

  const items = $derived(lab.items);
  const n = $derived(view.count);
  const lexical = $derived(view.run.kind === "lexical");
  const legend = $derived(lexical ? t.matrix.legendLexical : t.matrix.legend);

  /**
   * 표시 구간을 데이터에 맞춘다.
   *
   * 다국어 임베딩의 코사인은 0.5~1.0 같은 좁은 띠에 몰려 있어서 0~1로 칠하면
   * 화면이 통째로 뿌옇다. 대신 실제 범위로 늘리고 **그 숫자를 범례에 적는다** —
   * 늘렸다는 사실을 감추면 그림이 과장이 된다.
   */
  const domain = $derived.by(() => {
    const off: number[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) off.push(view.matrix[i * n + j]);
    if (!off.length) return { lo: 0, hi: 1 };
    off.sort((a, b) => a - b);
    const at = (q: number) => off[Math.min(off.length - 1, Math.max(0, Math.round(q * (off.length - 1))))];
    const lo = at(0.02);
    const hi = at(0.995);
    return hi - lo < 1e-4 ? { lo: lo - 0.05, hi: lo + 0.05 } : { lo, hi };
  });

  /** 프로브 묶음이 바뀌는 지점 — 여기에 가는 선을 긋는다 */
  const boundaries = $derived.by(() => {
    const out: { at: number; kind: ProbeKind }[] = [];
    let prev: ProbeKind | null = null;
    items.forEach((item, i) => {
      if (item.kind && item.kind !== prev) out.push({ at: i, kind: item.kind });
      prev = item.kind;
    });
    return out;
  });

  $effect(() => onThemeChange(() => themeTick++));

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([entry]) => {
      side = Math.max(200, Math.floor(entry.contentRect.width));
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  $effect(() => {
    const el = canvas;
    // 아래 값들이 바뀌면 다시 그린다
    const m = view.matrix;
    const { lo, hi } = domain;
    themeTick;
    if (!el || !n) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.max(1, Math.floor(side / n));
    const size = px * n;
    el.width = size * dpr;
    el.height = size * dpr;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;

    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const low: Rgb = themeColor("--surface-2");
    const high: Rgb = themeColor(slot === "A" ? "--cat-1" : "--cat-3");
    const line: Rgb = themeColor("--border-strong");

    const span = hi - lo;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const raw = m[i * n + j];
        const tNorm = span > 0 ? Math.min(1, Math.max(0, (raw - lo) / span)) : 0;
        const [r, g, b] = lerpRgb(low, high, tNorm);
        ctx.fillStyle = `rgb(${r} ${g} ${b})`;
        ctx.fillRect(j * px, i * px, px, px);
      }
    }

    // 묶음 경계 — 짝끼리 뜨는 밝은 사각형이 어느 현상의 것인지 알 수 있게
    ctx.strokeStyle = `rgb(${line[0]} ${line[1]} ${line[2]} / 0.55)`;
    ctx.lineWidth = 1;
    for (const b of boundaries) {
      if (b.at === 0) continue;
      const at = b.at * px + 0.5;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, size);
      ctx.moveTo(0, at);
      ctx.lineTo(size, at);
      ctx.stroke();
    }
  });

  /**
   * 포인터 리스너는 마크업이 아니라 여기서 붙인다 — 캔버스는 그림이라
   * 인라인 핸들러를 달면 a11y 검사가 "상호작용 요소가 아니다"라고 막는다.
   * 키보드로 같은 일을 하는 통로는 이웃 목록 뷰다(거긴 전부 버튼이다).
   */
  $effect(() => {
    const el = canvas;
    const count = n;
    if (!el || !count) return;

    const at = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const px = rect.width / count;
      const j = Math.floor((e.clientX - rect.left) / px);
      const i = Math.floor((e.clientY - rect.top) / px);
      return i >= 0 && i < count && j >= 0 && j < count ? { i, j } : null;
    };

    const move = (e: MouseEvent) => (hover = at(e));
    const leave = () => (hover = null);
    const click = (e: MouseEvent) => {
      const cell = at(e);
      if (cell) lab.focus = cell.i;
    };

    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", leave);
      el.removeEventListener("click", click);
    };
  });
</script>

<div class="wrap">
  <div class="canvas-box" bind:this={box}>
    <canvas bind:this={canvas} aria-label={legend}></canvas>
  </div>

  <div class="side">
    <div class="legend">
      <span class="legend-title">{legend}</span>
      <div class="ramp" data-slot={slot}></div>
      <div class="ends">
        <span>{domain.lo.toFixed(3)}</span>
        <span>{domain.hi.toFixed(3)}</span>
      </div>
      {#if lexical}
        <p class="note">{t.matrix.diagLexical}</p>
      {/if}
    </div>

    {#if lab.source === "probe"}
      <ul class="groups">
        {#each boundaries as b (b.kind)}
          <li>{groupLabel(b.kind)}</li>
        {/each}
      </ul>
    {/if}

    <div class="readout" aria-live="polite">
      {#if hover}
        {@const a = items[hover.i]}
        {@const c = items[hover.j]}
        <p class="score">{view.matrix[hover.i * n + hover.j].toFixed(4)}</p>
        <p class="txt">{a?.text}</p>
        <p class="txt muted">{c?.text}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .wrap {
    display: flex;
    gap: var(--space-xl);
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .canvas-box {
    flex: 1 1 320px;
    min-width: 260px;
    max-width: 620px;
  }
  canvas {
    display: block;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: crosshair;
  }

  .side {
    flex: 1 1 220px;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .legend {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .legend-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .ramp {
    height: 10px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
  }
  .ramp[data-slot="A"] {
    background: linear-gradient(to right, var(--surface-2), var(--cat-1));
  }
  .ramp[data-slot="B"] {
    background: linear-gradient(to right, var(--surface-2), var(--cat-3));
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .groups li {
    padding: 2px var(--space-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    background: var(--surface-2);
    border-radius: var(--radius-pill);
  }

  .readout {
    min-height: 84px;
    padding: var(--space-sm);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }
  .readout p {
    margin: 0 0 var(--space-2xs);
  }
  .score {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 600;
  }
  .txt {
    font-size: var(--text-base);
    line-height: 1.5;
  }
  .txt.muted,
  .note {
    color: var(--text-muted);
  }
  .note {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
  }
</style>
