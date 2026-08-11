<script lang="ts">
  // 도시 뷰 — 캔버스 하나와 그 위에 뜨는 라벨, 그리고 흐름 재생 컨트롤.
  // 지도 뷰와 같은 상태(graph)를 쓴다. 필터·검색·고정이 두 뷰에 그대로 걸린다.
  import { onMount } from "svelte";
  import { graph } from "../graph/state.svelte";
  import { PIPELINES, PIPELINE_BY_ID } from "../data/pipelines";
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { onThemeChange } from "./palette";
  import type { CityScene } from "./scene";

  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let overlay = $state<HTMLElement | undefined>(undefined);
  let scene = $state<CityScene | undefined>(undefined);
  let failed = $state<string | null>(null);

  let flowId = $state(PIPELINES[0]?.id ?? "");
  let playing = $state(false);
  let stepIndex = $state<number | null>(null);
  let walking = $state(false);

  const flow = $derived(PIPELINE_BY_ID.get(flowId));
  const step = $derived(stepIndex === null ? null : (flow?.steps[stepIndex] ?? null));

  onMount(() => {
    if (!canvas || !overlay) return;
    // WebGL이 없으면 조용히 깨진 화면을 보여 주는 대신 지도로 안내한다.
    const probe = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!probe) {
      failed = t.city.noWebgl;
      return;
    }

    let live: CityScene | undefined;
    let stopTheme: (() => void) | undefined;

    // three.js는 이 뷰를 열 때만 내려받는다 — 지도만 볼 사람에게 물릴 이유가 없다.
    import("./scene")
      .then(({ createCityScene }) => {
        if (!canvas || !overlay) return;
        live = createCityScene(canvas, overlay, {
          onHover: (id) => graph.hover(id),
          onPick: (id) => (id ? graph.pin(id) : graph.clearPin()),
          onStep: (index) => {
            stepIndex = index;
            if (index === null) playing = false;
          },
          onWalkChange: (on) => (walking = on),
        });
        scene = live;
        stopTheme = onThemeChange(() => live?.refreshPalette());
      })
      .catch((err) => {
        // 삼키면 화면엔 "못 불러왔어요"만 남고 원인을 찾을 길이 없다.
        console.error("[stack] 도시 씬을 세우지 못했어요", err);
        failed = t.city.failed;
      });

    return () => {
      stopTheme?.();
      live?.dispose();
      scene = undefined;
    };
  });

  // 필터·검색·강조를 씬에 그대로 밀어 넣는다.
  $effect(() => {
    scene?.setHighlight({
      activeSet: graph.activeSet,
      matchSet: graph.matchSet,
      pinned: graph.pinned,
      networkOnly: graph.networkOnly,
      kinds: graph.kinds,
    });
  });

  // 고정하면 그 건물로 날아간다.
  $effect(() => {
    if (graph.pinned) scene?.focus(graph.pinned);
  });

  function toggleFlow() {
    if (!scene) return;
    if (playing) {
      scene.stop();
      playing = false;
      return;
    }
    // 고정해 둔 건물이 있으면 나머지가 흐려져 경로가 안 보인다 — 재생이 주인공이 되게 비운다.
    graph.clearPin();
    scene.play(flowId);
    playing = true;
  }
</script>

<div class="city">
  <div class="stage">
    <canvas bind:this={canvas} aria-label={t.city.hint}></canvas>
    <div class="labels" bind:this={overlay} aria-hidden="true"></div>

    {#if failed}
      <p class="fallback">{failed}</p>
    {:else if !scene}
      <p class="fallback">{t.city.loading}</p>
    {/if}

    {#if walking}
      <p class="walkbar">{t.city.walking}</p>
    {/if}

    {#if step}
      <div class="stepcard">
        <span class="idx">{t.city.step((stepIndex ?? 0) + 1, flow?.steps.length ?? 0)}</span>
        <strong>{step.label}</strong>
        <p>{step.note}</p>
      </div>
    {/if}
  </div>

  <div class="bar">
    <label class="flow">
      <span class="cap">{t.city.flow}</span>
      <select bind:value={flowId} disabled={!scene}>
        {#each PIPELINES as p (p.id)}
          <option value={p.id}>{p.label}</option>
        {/each}
      </select>
    </label>

    <button class="btn small primary" disabled={!scene} onclick={toggleFlow}>
      <Icon name={playing ? "stop" : "play"} size={14} />
      {playing ? t.city.stop : t.city.play}
    </button>

    <button class="btn small" disabled={!scene} onclick={() => scene?.setWalk(true)}>
      {t.city.walk}
    </button>

    <button class="btn small ghost" disabled={!scene} onclick={() => scene?.resetCamera()}>
      {t.city.reset}
    </button>
  </div>

  <p class="legend">{t.city.legend}</p>
  <p class="legend">{t.city.pipes}</p>
  <p class="legend strong">{t.city.walls}</p>
</div>

<style>
  .city {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }

  .stage {
    position: relative;
    height: min(70dvh, 680px);
    min-height: 380px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* 건물을 짚을 수 있다는 신호 */
    cursor: pointer;
  }

  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .fallback {
    position: absolute;
    inset: 50% 0 auto 0;
    margin: 0;
    translate: 0 -50%;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  .walkbar {
    position: absolute;
    inset: auto 0 var(--space-md) 0;
    margin: 0 auto;
    width: fit-content;
    max-width: calc(100% - var(--space-xl));
    padding: var(--space-xs) var(--space-md);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .stepcard {
    position: absolute;
    inset: var(--space-md) var(--space-md) auto auto;
    width: min(260px, 60%);
    padding: var(--space-md);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-1);
  }
  .stepcard .idx {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .stepcard strong {
    display: block;
    margin-top: var(--space-3xs);
    font-size: var(--text-xl);
  }
  .stepcard p {
    margin: var(--space-2xs) 0 0;
    font-size: var(--text-md);
    line-height: 1.55;
    color: var(--text-muted);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .flow {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .flow .cap {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .flow select {
    padding: var(--space-2xs) var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-base);
  }

  .legend {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .legend.strong {
    color: var(--text);
  }
</style>
