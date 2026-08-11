<script lang="ts">
  // 흐름도 — 단계와 분기. 특히 "여기서 멈춘다"를 보여주는 게 목적이다.
  //
  // 노드는 CSS 격자에 놓고, 연결선은 렌더된 뒤 실제 위치를 재서 SVG로 그린다.
  // 좌표를 손으로 잡지 않는 이유: 설명 길이에 따라 상자 높이가 달라지는데
  // 그때마다 선이 어긋나면 도식이 거짓말을 하게 된다.
  import type { FlowSpec } from "./mechanisms";

  let { spec }: { spec: FlowSpec } = $props();

  const cols = $derived(Math.max(...spec.nodes.map((n) => n.col)) + 1);
  const rows = $derived(Math.max(...spec.nodes.map((n) => n.row)) + 1);

  let host = $state<HTMLElement | undefined>(undefined);
  let boxes = $state<Record<string, HTMLElement | undefined>>({});
  let size = $state({ w: 0, h: 0 });
  let paths = $state<{ id: string; d: string; kind: string; label?: string; lx: number; ly: number }[]>(
    [],
  );

  function measure() {
    if (!host) return;
    const base = host.getBoundingClientRect();
    size = { w: base.width, h: base.height };

    const rect = (id: string) => {
      const el = boxes[id];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - base.left,
        right: r.right - base.left,
        top: r.top - base.top,
        bottom: r.bottom - base.top,
        cx: r.left - base.left + r.width / 2,
        cy: r.top - base.top + r.height / 2,
      };
    };

    const next: typeof paths = [];
    for (const edge of spec.edges) {
      const a = rect(edge.from);
      const b = rect(edge.to);
      if (!a || !b) continue;

      let d: string;
      let lx: number;
      let ly: number;

      if (Math.abs(a.cy - b.cy) < 4) {
        // 같은 줄 — 곧게
        d = `M${a.right} ${a.cy}H${b.left}`;
        lx = (a.right + b.left) / 2;
        ly = a.cy - 8;
      } else if (a.right <= b.left + 1) {
        // 오른쪽 아래/위 — 중간에서 한 번 꺾는다
        const mid = (a.right + b.left) / 2;
        const r = Math.min(10, Math.abs(b.cy - a.cy) / 2, (b.left - a.right) / 2);
        const dir = b.cy > a.cy ? 1 : -1;
        d =
          `M${a.right} ${a.cy}H${mid - r}` +
          `Q${mid} ${a.cy} ${mid} ${a.cy + r * dir}` +
          `V${b.cy - r * dir}` +
          `Q${mid} ${b.cy} ${mid + r} ${b.cy}` +
          `H${b.left}`;
        lx = mid;
        ly = (a.cy + b.cy) / 2;
      } else {
        // 같은 칸에서 아래로
        d = `M${a.cx} ${a.bottom}V${b.top}`;
        lx = a.cx;
        ly = (a.bottom + b.top) / 2;
      }

      next.push({ id: `${edge.from}~${edge.to}`, d, kind: edge.kind ?? "plain", label: edge.label, lx, ly });
    }
    paths = next;
  }

  $effect(() => {
    // spec이 바뀌면 상자가 통째로 달라진다 — 다시 재야 선이 따라간다
    spec.nodes;
    if (!host) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const el of Object.values(boxes)) if (el) observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<div class="scroll">
  <div
    class="flow"
    bind:this={host}
    style="--cols: {cols}; --rows: {rows}"
  >
    <svg class="wires" width={size.w} height={size.h} aria-hidden="true">
      <defs>
        <marker id="fl-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0 0 L7 3.5 L0 7 z" fill="context-stroke" />
        </marker>
      </defs>
      {#each paths as path (path.id)}
        <path class="wire {path.kind}" d={path.d} marker-end="url(#fl-head)" />
      {/each}
    </svg>

    {#each spec.nodes as node (node.id)}
      <div
        class="node {node.kind ?? 'step'}"
        bind:this={boxes[node.id]}
        style="grid-column: {node.col + 1}; grid-row: {node.row + 1};"
      >
        <p class="label">{node.label}</p>
        {#if node.note}<p class="note">{node.note}</p>{/if}
      </div>
    {/each}

    {#each paths.filter((p) => p.label) as path (path.id + "-label")}
      <span class="wire-label {path.kind}" style="left: {path.lx}px; top: {path.ly}px;">
        {path.label}
      </span>
    {/each}
  </div>
</div>

<style>
  .scroll {
    overflow-x: auto;
    padding-bottom: var(--space-xs);
  }

  .flow {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(160px, 1fr));
    grid-auto-rows: min-content;
    align-items: center;
    gap: var(--space-2xl) var(--space-4xl);
    min-width: min-content;
    padding: var(--space-sm) 0;
  }

  .wires {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .wire {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1.8;
  }
  .wire.ok {
    stroke: var(--success);
  }
  .wire.fail {
    stroke: var(--danger);
  }

  .wire-label {
    position: absolute;
    translate: -50% -50%;
    padding: 1px var(--space-xs);
    border-radius: var(--radius-pill);
    background: var(--surface);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .wire-label.ok {
    color: var(--success);
  }
  .wire-label.fail {
    color: var(--danger);
  }

  .node {
    position: relative;
    padding: var(--space-md);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .node .label {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 1.45;
  }
  .node .note {
    margin: var(--space-2xs) 0 0;
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--text-muted);
  }

  .node.input {
    border-style: dashed;
  }
  /* 판단이 갈리는 지점 — 모서리를 깎아 다르게 보이게 한다 */
  .node.gate {
    border-color: var(--accent);
    background: var(--accent-weak);
    border-radius: var(--radius-lg);
  }
  .node.output {
    border-color: var(--success);
  }
  .node.reject {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }
  .node.reject .label {
    color: var(--danger);
  }
</style>
