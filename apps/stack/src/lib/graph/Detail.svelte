<script lang="ts">
  // 고정한 노드의 상세 — 설명, 반대편 연결 목록, 소스 링크, 파이프라인 입구.
  // hover가 아니라 클릭(pin)에만 반응한다. 읽는 동안 내용이 바뀌면 읽을 수가 없다.
  import { graph } from "./state.svelte";
  import {
    APPS,
    FEATURE_BY_ID,
    KIND_LABEL,
    TECH_BY_ID,
    USERS_OF_TECH,
    type Feature,
  } from "../data/stack";
  import { mechanismsFor } from "../mech/mechanisms";
  import { t } from "../i18n";
  import { repoBlob } from "../repo";
  import Icon from "../Icon.svelte";

  const detail = $derived(graph.detail);

  const appLabel = (id: string) => APPS.find((app) => app.id === id)?.label ?? id;

  let el = $state<HTMLElement | undefined>(undefined);
  const mq = typeof matchMedia === "function" ? matchMedia("(max-width: 1100px)") : null;
  const smooth = !(
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // 좁은 화면에선 패널이 지도 아래로 내려간다 — 지도가 1000px이 넘어서 눌러도 아무 일도
  // 안 일어난 것처럼 보인다. 고정하는 순간 패널로 데려간다.
  $effect(() => {
    if (!graph.pinned || !mq?.matches) return;
    el?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  });

  /** 이 기능이 인터넷을 타는 이유들 — 없으면 완전 오프라인 */
  function networkReasons(feat: Feature): { label: string; why: string }[] {
    return feat.techs
      .map((id) => TECH_BY_ID.get(id))
      .filter((tech) => tech?.network)
      .map((tech) => ({ label: tech!.label, why: tech!.network! }));
  }
</script>

<aside class="detail" bind:this={el} aria-label={t.detail.panelLabel}>
  {#if !detail}
    <div class="empty">
      <Icon name="route" size={22} />
      <p class="title">{t.detail.emptyTitle}</p>
      <p class="body">{t.detail.emptyBody}</p>
      <p class="body muted">{t.detail.emptyHintTech}</p>
    </div>
  {:else if detail.type === "feature"}
    {@const feat = detail.feature}
    {@const reasons = networkReasons(feat)}
    <header>
      <span class="badge">{appLabel(feat.app)}</span>
      <h2>{feat.label}</h2>
      <button class="icon-btn" title={t.detail.close} onclick={() => graph.clearPin()}>
        <Icon name="x" size={15} />
        <span class="sr-only">{t.detail.close}</span>
      </button>
    </header>

    <p class="note">{feat.note}</p>

    {#if reasons.length === 0}
      <p class="offline">{t.detail.offlineNote}</p>
    {:else}
      <ul class="netlist">
        {#each reasons as reason (reason.label)}
          <li>
            <Icon name="globe" size={13} />
            <span class="mono">{reason.label}</span>
            <span class="why">{reason.why}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      {#if feat.pipeline}
        <button class="btn primary small" onclick={() => graph.openPipeline(feat.pipeline!)}>
          <Icon name="route" size={15} />
          {t.detail.openPipeline}
        </button>
      {/if}
      {#each mechanismsFor(feat.id) as mech (mech.id)}
        <button class="btn small mech" onclick={() => graph.openMech(mech.id)}>
          <Icon name="eye" size={15} />
          {mech.title}
        </button>
      {/each}
    </div>

    <section>
      <h3>{t.detail.uses}<span class="n">{feat.techs.length}</span></h3>
      <ul class="chips">
        {#each feat.techs as techId (techId)}
          {@const tech = TECH_BY_ID.get(techId)}
          {#if tech}
            <li>
              <button
                class="chip k-{tech.kind}"
                onmouseenter={() => graph.hover(techId)}
                onmouseleave={() => graph.hover(null)}
                onclick={() => graph.pin(techId)}
              >
                <span class="swatch"></span>
                <span class="mono">{tech.label}</span>
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    </section>

    <section>
      <h3>{t.detail.source}</h3>
      <ul class="srcs">
        {#each feat.src as path (path)}
          <li>
            <a href={repoBlob(path)} target="_blank" rel="noreferrer noopener">
              <span class="path">{path}</span>
              <Icon name="external" size={13} />
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    {@const tech = detail.tech}
    {@const users = USERS_OF_TECH.get(tech.id) ?? []}
    <header class="k-{tech.kind}">
      <span class="badge lane"><span class="swatch"></span>{KIND_LABEL[tech.kind]}</span>
      <h2 class="mono">{tech.label}</h2>
      <button class="icon-btn" title={t.detail.close} onclick={() => graph.clearPin()}>
        <Icon name="x" size={15} />
        <span class="sr-only">{t.detail.close}</span>
      </button>
    </header>

    <p class="note">{tech.note}</p>

    {#if tech.network}
      <ul class="netlist">
        <li>
          <Icon name="globe" size={13} />
          <span class="why">{tech.network}</span>
        </li>
      </ul>
    {:else}
      <p class="offline">{t.detail.offline}</p>
    {/if}

    {#if tech.net}
      <!-- 통로를 층으로 쌓아 보여 준다 — 도시의 계층 기둥과 같은 순서(아래가 전송). -->
      <section class="stack">
        <h3>{t.detail.netStack}<span class="n">{tech.net.layers.length}</span></h3>
        <ol>
          {#each [...tech.net.layers].reverse() as layer (layer.label)}
            <li>
              <span class="mono lname">{layer.label}</span>
              <span class="lnote">{layer.note}</span>
            </li>
          {/each}
        </ol>
        <p class="carries">{tech.net.carries}</p>
      </section>

      <section>
        <h3>{t.detail.netHosts}<span class="n">{tech.net.hosts.length}</span></h3>
        <ul class="hosts">
          {#each tech.net.hosts as host (host)}
            <li class="mono">{host}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if mechanismsFor(tech.id).length > 0}
      <div class="actions">
        {#each mechanismsFor(tech.id) as mech (mech.id)}
          <button class="btn small mech" onclick={() => graph.openMech(mech.id)}>
            <Icon name="eye" size={15} />
            {mech.title}
          </button>
        {/each}
      </div>
    {/if}

    <section>
      <h3>{t.detail.usedBy}<span class="n">{users.length}</span></h3>
      <ul class="chips">
        {#each users as featId (featId)}
          {@const feat = FEATURE_BY_ID.get(featId)}
          {#if feat}
            <li>
              <button
                class="chip"
                onmouseenter={() => graph.hover(featId)}
                onmouseleave={() => graph.hover(null)}
                onclick={() => graph.pin(featId)}
              >
                <span class="badge tiny">{appLabel(feat.app)}</span>
                {feat.label}
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    </section>

    <section>
      <h3>{t.detail.source}</h3>
      <ul class="srcs">
        {#each tech.src as path (path)}
          <li>
            <a href={repoBlob(path)} target="_blank" rel="noreferrer noopener">
              <span class="path">{path}</span>
              <Icon name="external" size={13} />
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    /* 지도를 스크롤해도 패널은 따라온다 — 선을 눈으로 좇다 놓치지 않게 */
    position: sticky;
    top: calc(var(--topbar-h, 52px) + var(--space-md));
    max-height: calc(100dvh - var(--topbar-h, 52px) - var(--space-4xl));
    overflow: auto;
  }

  header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: var(--space-sm);
  }
  header h2 {
    grid-column: 1;
    margin: 0;
    font-size: var(--text-4xl);
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  header .icon-btn {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .badge {
    grid-column: 1;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: 2px var(--space-sm);
    border-radius: var(--radius-pill);
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-size: var(--text-2xs);
    font-weight: 600;
  }
  .badge.lane {
    background: color-mix(in srgb, var(--k) 14%, transparent);
    color: var(--k-ink);
  }
  .badge.tiny {
    padding: 1px var(--space-xs);
    font-size: var(--text-2xs);
  }
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--k, var(--accent));
  }

  .note {
    margin: 0;
    font-size: var(--text-lg);
    line-height: 1.65;
    color: var(--text);
  }

  .offline {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--success);
  }

  .netlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    list-style: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--cat-4) 10%, transparent);
    font-size: var(--text-sm);
  }
  .netlist li {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--cat-4-ink);
  }
  .netlist .why {
    color: var(--text-muted);
  }

  /* 프로토콜 계층 — 위가 앱, 아래가 전송. 도시의 기둥과 읽는 방향을 맞춘다. */
  .stack ol {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--border);
  }
  .stack li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-xs) var(--space-sm);
    background: var(--surface);
  }
  .stack .lname {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text);
  }
  .stack .lnote {
    font-size: var(--text-xs);
    line-height: 1.55;
    color: var(--text-muted);
  }
  .carries {
    margin: var(--space-xs) 0 0;
    font-size: var(--text-sm);
    color: var(--cat-4-ink);
  }

  .hosts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hosts li {
    font-size: var(--text-xs);
    color: var(--text-muted);
    word-break: break-all;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-xs);
  }
  /* 기계 버튼은 제목이 길다 — 줄바꿈을 허용하고 왼쪽으로 붙인다 */
  .actions .mech {
    justify-content: flex-start;
    text-align: left;
    white-space: normal;
    line-height: 1.4;
    border-color: var(--cat-3);
    color: var(--cat-3-ink);
  }

  section h3 {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    margin: 0 0 var(--space-sm);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  section h3 .n {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .chips,
  .srcs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .srcs {
    flex-direction: column;
    gap: var(--space-2xs);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-sm);
    transition: border-color var(--dur-short) var(--ease-out);
  }
  .chip:hover {
    border-color: var(--k, var(--accent));
  }
  .chip:active {
    transform: translateY(1px);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    word-break: break-all;
  }
  header h2.mono {
    font-size: var(--text-3xl);
  }

  .srcs a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--text-muted);
    text-decoration: none;
    font-size: var(--text-xs);
  }
  .srcs a:hover {
    color: var(--accent-ink);
  }
  .path {
    font-family: var(--font-mono);
    word-break: break-all;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-xs);
    color: var(--text-muted);
  }
  .empty .title {
    margin: var(--space-xs) 0 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text);
  }
  .empty .body {
    margin: 0;
    font-size: var(--text-base);
    line-height: 1.6;
  }
  .empty .body.muted {
    opacity: 0.75;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip:active {
      transform: none;
    }
  }
</style>
