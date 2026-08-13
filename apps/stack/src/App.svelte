<script lang="ts">
  import type { Component } from "svelte";
  import { t } from "./lib/i18n";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Controls from "./lib/graph/Controls.svelte";
  import List from "./lib/graph/List.svelte";
  import Detail from "./lib/graph/Detail.svelte";
  import PipelineView from "./lib/graph/Pipeline.svelte";
  import MechView from "./lib/mech/Mech.svelte";
  import Icon from "./lib/Icon.svelte";
  import { graph } from "./lib/graph/state.svelte";
  import { repoHome } from "./lib/repo";

  // file://로 직접 연 단일 파일엔 돌아갈 홈이 없다
  const homeHref = location.protocol === "file:" ? null : "../";

  // 상단바가 sticky라서, 그 아래에 붙는 다른 sticky 요소(시퀀스 레인 머리·상세 패널)가
  // 실제 높이를 알아야 한다. 글자 크기·줄바꿈에 따라 달라지므로 재서 넘긴다.
  let topbarH = $state(52);

  // Esc는 한 겹씩 벗긴다 — 파이프라인이 열려 있으면 그것부터, 아니면 고정 해제.
  // 걷기 모드에서는 Esc가 포인터 잠금을 푸는 데 쓰이므로 여기선 손대지 않는다.
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (document.pointerLockElement) return;
    if (graph.mechId) graph.closeMech();
    else if (graph.pipelineId) graph.closePipeline();
    else if (graph.pinned) graph.clearPin();
  }


  // 도시(three.js)는 별도 청크다. 첫 화면이라 곧바로 받지만, 셸과 목록은 그걸
  // 기다리지 않고 먼저 뜬다 — WebGL이 없는 환경에서도 목록으로 다 둘러볼 수 있다.
  let CityView = $state<Component | undefined>(undefined);
  let cityFailed = $state(false);

  $effect(() => {
    if (CityView || cityFailed) return;
    import("./lib/city/City.svelte")
      .then((mod) => (CityView = mod.default))
      .catch((err) => {
        console.error("[stack] 도시 뷰를 불러오지 못했어요", err);
        cityFailed = true;
      });
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" style="--topbar-h: {topbarH}px">
  <header class="topbar" bind:clientHeight={topbarH}>
    <svelte:element
      this={homeHref ? "a" : "div"}
      class="brand"
      href={homeHref ?? undefined}
      title={homeHref ? t.home : undefined}
    >
      <svg class="logo" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <rect
          x="1.6"
          y="1.6"
          width="14.8"
          height="14.8"
          rx="4.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        />
        <circle cx="9" cy="9" r="3.2" fill="var(--accent)" />
      </svg>
      <span class="brand-name">{t.brandName}</span>
      <span class="app-name">{t.appName}</span>
    </svelte:element>

    <div class="spacer"></div>


    <ThemeToggle />
  </header>

  <main class="content">
    <section class="intro">
      <h2>{t.intro.title}</h2>
      <p>{t.intro.sub}</p>
    </section>

    <Controls />

    {#if graph.mechId}
      <MechView />
    {:else if graph.pipelineId}
      <PipelineView />
    {:else}
      <div class="grid">
        <div class="map-col">
          {#if CityView}
            <CityView />
          {:else}
            <p class="hint">{cityFailed ? t.city.failed : t.city.loading}</p>
          {/if}
        </div>
        <!-- 오른쪽 칸은 하나다: 고른 게 없으면 목록, 고르면 그 상세 -->
        {#if graph.pinned}
          <Detail />
        {:else}
          <List />
        {/if}
      </div>
    {/if}
  </main>

  <footer class="footer">
    <span>{t.footer.privacy}</span>
    <a href={repoHome} target="_blank" rel="noreferrer noopener">
      {t.footer.source}
      <Icon name="external" size={12} />
    </a>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-lg);
    padding: var(--space-sm) var(--space-xl);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-weight: 600;
    font-size: var(--text-xl);
    letter-spacing: -0.01em;
    color: inherit;
    text-decoration: none;
  }
  .logo {
    display: block;
    color: var(--text);
  }
  a.brand:hover .logo {
    color: var(--accent-ink);
  }
  .brand-name {
    white-space: nowrap;
  }
  .app-name {
    flex: none;
    padding: 2px var(--space-sm);
    border-radius: var(--radius-pill);
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }


  .content {
    flex: 1;
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    padding: var(--space-xl);
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
  }

  .intro h2 {
    margin: 0 0 var(--space-xs);
    font-size: var(--text-6xl);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .intro p {
    margin: 0;
    max-width: 62ch;
    font-size: var(--text-2xl);
    line-height: 1.6;
    color: var(--text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    align-items: start;
    gap: var(--space-lg);
  }
  .map-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* 상세 패널이 지도를 밀어내기 시작하는 폭에서 아래로 내린다 */
  @media (max-width: 1100px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-md);
    padding: var(--space-md) var(--space-xl);
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }
  .footer a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    color: var(--text-muted);
    text-decoration: none;
  }
  .footer a:hover {
    color: var(--accent-ink);
  }

  @media (max-width: 640px) {
    .content {
      padding: var(--space-lg) var(--space-md);
    }
    .topbar {
      padding: var(--space-sm) var(--space-md);
    }
  }
</style>
