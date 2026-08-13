<script lang="ts">
  // 이 앱이 향해 온 그림 하나 — "무엇을 써야 하나"에 대한 직접적인 답.
  //
  // 오차막대가 핵심이다. 막대가 세로로 겹치는 점끼리는 이 코퍼스로 구별되지 않는다.
  // 그게 보이지 않으면 프론티어는 노이즈를 골라 이은 선이 된다.

  import { t } from "../i18n";
  import { MODELS, modelById } from "../embed/registry";
  import { formatBytes } from "../embed/cache";
  import { frontier, pointKey, type ResultPoint } from "../embed/results";
  import { lab } from "./state.svelte";

  const PAD = { top: 30, right: 20, bottom: 42, left: 54 };
  /** 같은 용량에 겹쳐 선 점들을 좌우로 벌리는 간격(px) */
  const DODGE = 10;
  /** bytes = 0(BM25)을 로그 축에 올릴 수 없어 왼쪽에 따로 낸 자리 */
  const FREE_LANE = 62;
  const HEIGHT = 320;

  let box = $state<HTMLDivElement | null>(null);
  let width = $state(680);

  const points = $derived(lab.computePoints());
  const front = $derived(frontier(points));
  const metric = $derived(lab.metricKind);
  const yLabel = $derived(metric === "ndcg" ? t.pareto.yNdcg(lab.topK) : t.pareto.yPair);

  /** 모델마다 색 하나 — 같은 모델의 정밀도·차원 변형이 한 계열로 보이게. */
  const colorOf = (modelId: string) =>
    `var(--cat-${(MODELS.findIndex((m) => m.id === modelId) % 5) + 1})`;

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([entry]) => {
      width = Math.max(320, Math.floor(entry.contentRect.width));
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  const paid = $derived(points.filter((p) => p.bytes > 0));
  const plotLeft = $derived(PAD.left + (points.some((p) => p.bytes === 0) ? FREE_LANE : 0));
  const plotRight = $derived(width - PAD.right);
  const plotTop = PAD.top;
  const plotBottom = HEIGHT - PAD.bottom;

  const xDomain = $derived.by(() => {
    if (!paid.length) return { lo: 8, hi: 9 };
    const logs = paid.map((p) => Math.log10(p.bytes));
    const lo = Math.min(...logs);
    const hi = Math.max(...logs);
    return hi - lo < 0.2 ? { lo: lo - 0.3, hi: hi + 0.3 } : { lo, hi };
  });

  /** y는 데이터에 맞춰 당긴다 — 0~1 고정이면 차이가 안 보인다. 대신 눈금에 실제 값을 적는다. */
  const yDomain = $derived.by(() => {
    if (!points.length) return { lo: 0, hi: 1 };
    const lo = Math.min(...points.map((p) => p.lo));
    const hi = Math.max(...points.map((p) => p.hi));
    const pad = Math.max(0.02, (hi - lo) * 0.12);
    return { lo: Math.max(0, lo - pad), hi: Math.min(1, hi + pad) };
  });

  function baseX(p: ResultPoint): number {
    if (p.bytes === 0) return PAD.left + FREE_LANE / 2;
    const { lo, hi } = xDomain;
    const span = hi - lo || 1;
    return plotLeft + ((Math.log10(p.bytes) - lo) / span) * (plotRight - plotLeft);
  }

  /**
   * 같은 용량의 조합들은 x가 완전히 같아 점이 포개진다(절단만 다른 세 점이 대표적 —
   * 자른다고 다운로드가 줄지는 않으니 당연히 같은 자리다). 그대로 두면 셋 중 하나만
   * 보이므로 그룹 안에서 좌우로 벌린다. 축 값이 아니라 **표시상의 어긋남**이다.
   */
  const dodged = $derived.by(() => {
    const groups = new Map<number, ResultPoint[]>();
    for (const p of points) {
      const x = Math.round(baseX(p));
      const list = groups.get(x);
      if (list) list.push(p);
      else groups.set(x, [p]);
    }
    const out = new Map<string, number>();
    for (const [x, list] of groups) {
      list.sort((a, b) => a.dim - b.dim);
      list.forEach((p, i) => out.set(pointKey(p), x + (i - (list.length - 1) / 2) * DODGE));
    }
    return out;
  });

  const xOf = (p: ResultPoint): number => dodged.get(pointKey(p)) ?? baseX(p);

  function yOf(value: number): number {
    const { lo, hi } = yDomain;
    const span = hi - lo || 1;
    return plotBottom - ((value - lo) / span) * (plotBottom - plotTop);
  }

  const yTicks = $derived.by(() => {
    const { lo, hi } = yDomain;
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push(lo + ((hi - lo) * i) / 4);
    return out;
  });

  const xTicks = $derived.by(() => {
    if (!paid.length) return [];
    const { lo, hi } = xDomain;
    const out: number[] = [];
    for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) out.push(e);
    return out.length ? out : [lo, hi];
  });

  /** 프론티어를 계단으로 잇는다 — 사선으로 이으면 없는 중간 조합이 있는 것처럼 보인다. */
  const frontPath = $derived.by(() => {
    const on = points.filter((p) => front.has(pointKey(p))).sort((a, b) => a.bytes - b.bytes);
    if (on.length < 2) return "";
    let d = `M ${xOf(on[0])} ${yOf(on[0].value)}`;
    for (let i = 1; i < on.length; i++) {
      d += ` H ${xOf(on[i])} V ${yOf(on[i].value)}`;
    }
    return d;
  });

  const label = (p: ResultPoint) => {
    const spec = modelById(p.modelId);
    if (p.dim === 0) return spec.label;
    return `${spec.label} · ${p.dtype} · ${p.dim}d`;
  };

  function reset() {
    if (confirm(t.pareto.confirmReset)) lab.resetPoints();
  }
</script>

<div class="pareto" bind:this={box}>
  <p class="help">{t.pareto.help}</p>

  {#if !points.length}
    <p class="empty">{t.pareto.empty}</p>
  {:else}
    <svg {width} height={HEIGHT} role="img" aria-label={t.pareto.title}>
      <!-- y 눈금 -->
      {#each yTicks as v (v)}
        <line class="grid" x1={PAD.left} x2={plotRight} y1={yOf(v)} y2={yOf(v)} />
        <text class="tick" x={PAD.left - 8} y={yOf(v)} text-anchor="end" dominant-baseline="middle">
          {v.toFixed(2)}
        </text>
      {/each}

      <!-- x 눈금 (로그) -->
      {#each xTicks as e (e)}
        {@const x = plotLeft + ((e - xDomain.lo) / (xDomain.hi - xDomain.lo || 1)) * (plotRight - plotLeft)}
        <text class="tick" {x} y={plotBottom + 16} text-anchor="middle">{formatBytes(10 ** e)}</text>
      {/each}

      <!-- 공짜 구역 표시 -->
      {#if points.some((p) => p.bytes === 0)}
        <line class="break" x1={plotLeft - 6} x2={plotLeft - 6} y1={plotTop} y2={plotBottom} />
        <text class="tick" x={PAD.left + FREE_LANE / 2} y={plotBottom + 16} text-anchor="middle">
          0
        </text>
      {/if}

      <!-- 프론티어 계단 -->
      {#if frontPath}
        <path class="front" d={frontPath} />
      {/if}

      <!-- 점 + 오차막대 -->
      {#each points as p (pointKey(p))}
        {@const x = xOf(p)}
        {@const on = front.has(pointKey(p))}
        <g class="pt" class:dim={!on} style:color={colorOf(p.modelId)}>
          <line class="bar" x1={x} x2={x} y1={yOf(p.hi)} y2={yOf(p.lo)} />
          <circle cx={x} cy={yOf(p.value)} r={on ? 5 : 3.5}>
            <title>{label(p)} — {p.value.toFixed(3)} [{p.lo.toFixed(2)}, {p.hi.toFixed(2)}] · {formatBytes(p.bytes)} · n={p.n}</title>
          </circle>
          {#if on}
            <text class="plabel" {x} y={yOf(p.hi) - 7} text-anchor="middle">{label(p)}</text>
          {/if}
        </g>
      {/each}

      <text class="axis" x={PAD.left - 8} y={12} text-anchor="start">{yLabel}</text>
      <text class="axis" x={plotRight} y={HEIGHT - 6} text-anchor="end">{t.pareto.x}</text>
    </svg>

    <p class="note">{t.pareto.errorBars}</p>

    <footer>
      <span class="counts">{t.pareto.stored(points.length)}</span>
      <button class="btn small ghost danger" onclick={reset}>{t.pareto.reset}</button>
    </footer>
  {/if}
</div>

<style>
  .pareto {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }
  .help,
  .note,
  .empty,
  .counts {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .break {
    stroke: var(--border-strong);
    stroke-width: 1;
    stroke-dasharray: 3 4;
  }
  .tick {
    fill: var(--text-muted);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
  }
  .axis {
    fill: var(--text-muted);
    font-size: var(--text-2xs);
  }

  .front {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }

  .pt {
    color: var(--accent);
  }
  .pt circle {
    fill: currentColor;
  }
  .pt .bar {
    stroke: currentColor;
    stroke-width: 1.5;
    opacity: 0.5;
  }
  /* 지배당한 조합 — 지우지 않고 흐리게 둔다. "왜 저건 안 쓰나"가 보여야 한다. */
  .pt.dim {
    opacity: 0.38;
  }
  .plabel {
    fill: var(--text);
    font-size: var(--text-2xs);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
  }
</style>
