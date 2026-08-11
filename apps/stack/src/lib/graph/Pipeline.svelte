<script lang="ts">
  // 드릴다운 — 고른 기능에서 데이터가 실제로 거치는 단계들.
  // 재생을 누르면 단계가 차례로 켜진다. 모션 축소 설정이면 이동 없이 켜지기만 한다.
  import { graph } from "./state.svelte";
  import { PIPELINE_BY_ID } from "../data/pipelines";
  import { TECH_BY_ID } from "../data/stack";
  import { t } from "../i18n";
  import { repoBlob } from "../repo";
  import Icon from "../Icon.svelte";

  const STEP_MS = 900;

  const pipeline = $derived(graph.pipelineId ? PIPELINE_BY_ID.get(graph.pipelineId) : undefined);

  let playing = $state(false);
  let step = $state(-1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cards = $state<(HTMLElement | undefined)[]>([]);
  let flowEl = $state<HTMLElement | undefined>(undefined);

  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 흐름이 한 줄이라 단계가 뒤로 갈수록 화면 밖으로 나간다 — 재생은 활성 단계를 따라간다.
  // block: "nearest"라야 가로 상자만 밀리고 페이지가 같이 튀지 않는다.
  $effect(() => {
    if (!playing) return;
    cards[step]?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  });

  function stop() {
    clearTimeout(timer);
    timer = undefined;
    playing = false;
    step = -1;
  }

  function advance(total: number) {
    step += 1;
    if (step >= total) {
      // 마지막 단계를 잠깐 보여 주고 끝낸다 — 즉시 꺼지면 결과를 못 본다.
      timer = setTimeout(() => {
        playing = false;
        step = -1;
      }, STEP_MS);
      return;
    }
    timer = setTimeout(() => advance(total), STEP_MS);
  }

  function play(total: number) {
    clearTimeout(timer);
    // 중간까지 밀어 놓고 다시 누르면 시작 단계가 화면 밖이다 — 처음으로 되감고 시작한다.
    flowEl?.scrollTo({ left: 0, behavior: "auto" });
    playing = true;
    step = -1;
    advance(total);
  }

  function back() {
    stop();
    graph.closePipeline();
  }

  // 뷰를 벗어날 때 타이머가 살아 있으면 상태가 계속 흔들린다.
  $effect(() => () => clearTimeout(timer));
</script>

{#if pipeline}
  <section class="pipeline">
    <header>
      <button class="btn small ghost" onclick={back}>
        <Icon name="back" size={15} />
        {t.pipeline.back}
      </button>
      <h2>{pipeline.label}</h2>
      <button
        class="btn small primary"
        onclick={() => (playing ? stop() : play(pipeline.steps.length))}
      >
        <Icon name={playing ? "stop" : "play"} size={14} />
        {playing ? t.pipeline.stop : t.pipeline.play}
      </button>
    </header>

    {#if reduced}
      <p class="rm-note">{t.pipeline.reducedMotion}</p>
    {/if}

    <div class="flow" bind:this={flowEl}>
      <div class="port">
        <span class="cap">{t.pipeline.input}</span>
        <span class="mono">{pipeline.input}</span>
      </div>

      {#each pipeline.steps as s, i (s.label + i)}
        {@const tech = s.tech ? TECH_BY_ID.get(s.tech) : undefined}
        <div class="arrow" class:lit={playing && step >= i} aria-hidden="true">
          <span class="line"></span>
          {#if playing && step === i}<span class="packet"></span>{/if}
        </div>
        <article
          bind:this={cards[i]}
          class="card {tech ? `k-${tech.kind}` : ''}"
          class:lit={playing && step === i}
          class:done={playing && step > i}
        >
          <div class="top">
            <span class="idx">{i + 1}</span>
            <h3>{s.label}</h3>
          </div>
          {#if tech}
            <span class="badge"><span class="swatch"></span><span class="mono">{tech.label}</span></span>
          {/if}
          <p class="note">{s.note}</p>
          {#if s.src}
            <a class="src" href={repoBlob(s.src)} target="_blank" rel="noreferrer noopener">
              <span class="path">{s.src}</span>
              <Icon name="external" size={12} />
            </a>
          {/if}
        </article>
      {/each}

      <div class="arrow" class:lit={playing && step >= pipeline.steps.length - 1} aria-hidden="true">
        <span class="line"></span>
      </div>
      <div class="port out">
        <span class="cap">{t.pipeline.output}</span>
        <span class="mono">{pipeline.output}</span>
      </div>
    </div>
  </section>
{/if}

<style>
  .pipeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    padding: var(--space-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-md);
  }
  header h2 {
    flex: 1;
    margin: 0;
    font-size: var(--text-5xl);
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .rm-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* 흐름은 한 줄이어야 뜻이 산다 — 줄바꿈되면 출력이 입력 밑으로 내려가 순서가 깨진다.
   * 넘치면 이 상자 안에서만 가로로 밀린다. */
  .flow {
    display: flex;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: var(--space-xs);
    overflow-x: auto;
    padding-bottom: var(--space-xs);
  }

  /* ── 입·출력 ──────────────────────────────────────────── */
  .port {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2xs);
    padding: var(--space-md);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    flex: 0 0 130px;
  }
  .port .cap {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .port.out {
    border-style: solid;
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  /* ── 연결 화살표 ──────────────────────────────────────── */
  .arrow {
    position: relative;
    align-self: center;
    flex: 0 0 26px;
    height: 14px;
  }
  .line {
    position: absolute;
    inset: 50% 0 auto 0;
    height: 2px;
    border-radius: 2px;
    background: var(--border-strong);
    transition: background-color var(--dur-mid) var(--ease-out);
  }
  .arrow.lit .line {
    background: var(--accent);
  }
  .packet {
    position: absolute;
    top: 50%;
    left: 0;
    width: 7px;
    height: 7px;
    margin-top: -3.5px;
    border-radius: 50%;
    background: var(--accent);
    animation: travel 900ms var(--ease-in-out);
  }
  @keyframes travel {
    from {
      left: 0;
      opacity: 0.2;
    }
    to {
      left: calc(100% - 7px);
      opacity: 1;
    }
  }

  /* ── 단계 카드 ────────────────────────────────────────── */
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    flex: 0 0 205px;
    padding: var(--space-md);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    transition:
      border-color var(--dur-mid) var(--ease-out),
      background-color var(--dur-mid) var(--ease-out);
  }
  .card.lit {
    border-color: var(--k, var(--accent));
    background: color-mix(in srgb, var(--k, var(--accent)) 8%, transparent);
  }
  .card.done {
    border-color: var(--border-strong);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .idx {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .card.lit .idx {
    background: var(--k, var(--accent));
    color: var(--accent-contrast);
  }
  .card h3 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    align-self: flex-start;
    padding: 2px var(--space-sm);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--k, var(--accent)) 14%, transparent);
    color: var(--k-ink, var(--accent-ink));
  }
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--k, var(--accent));
  }

  .card .note {
    margin: 0;
    font-size: var(--text-md);
    line-height: 1.6;
    color: var(--text-muted);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .src {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    margin-top: auto;
    color: var(--text-muted);
    text-decoration: none;
    font-size: var(--text-2xs);
  }
  .src:hover {
    color: var(--accent-ink);
  }
  .path {
    font-family: var(--font-mono);
    word-break: break-all;
  }

  /* 좁은 화면에선 세로로 흐른다 — 화살표도 같이 눕는다 */
  @media (max-width: 640px) {
    .flow {
      flex-direction: column;
      overflow-x: visible;
    }
    .card,
    .port {
      flex: 0 0 auto;
    }
    .arrow {
      align-self: center;
      flex: 0 0 22px;
      width: 14px;
      height: 22px;
    }
    .line {
      inset: 0 auto 0 50%;
      width: 2px;
      height: auto;
      margin-left: -1px;
    }
    .packet {
      top: 0;
      left: 50%;
      margin: 0 0 0 -3.5px;
      animation-name: travel-y;
    }
    @keyframes travel-y {
      from {
        top: 0;
        opacity: 0.2;
      }
      to {
        top: calc(100% - 7px);
        opacity: 1;
      }
    }
  }
</style>
