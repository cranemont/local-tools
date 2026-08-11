<script lang="ts">
  // 목록 패널 — 검색·필터에 걸린 것들을 이름으로 훑는 곳.
  //
  // 도시는 "어디에 있나"를 잘 보여주지만 "무엇 무엇이 걸렸나"는 눈으로 찾아야 한다.
  // 그 빈자리를 메우는 패널이고, WebGL이 없는 환경에서는 이쪽이 유일한 통로가 된다.
  import { graph } from "./state.svelte";
  import { APPS, KIND_LABEL, KIND_ORDER, type AppId, type TechKind } from "../data/stack";
  import { FEATURES_WITH_MECH } from "../mech/mechanisms";
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";

  const appLabel = (id: AppId) => APPS.find((app) => app.id === id)?.label ?? id;

  /** 앱별로 묶은 기능 — 빈 앱은 아예 내보내지 않는다 */
  const featureGroups = $derived(
    APPS.map((app) => ({
      app,
      items: graph.matchedFeatures.filter((feat) => feat.app === app.id),
    })).filter((group) => group.items.length > 0),
  );

  /** 성격별로 묶은 기술 */
  const techGroups = $derived(
    KIND_ORDER.map((kind: TechKind) => ({
      kind,
      items: graph.matchedTechs.filter((tech) => tech.kind === kind),
    })).filter((group) => group.items.length > 0),
  );

  const total = $derived(graph.matchedFeatures.length + graph.matchedTechs.length);
</script>

<aside class="list" aria-label={t.list.label}>
  <header>
    <h2>{t.list.label}</h2>
    <span class="count">{t.list.count(total)}</span>
  </header>

  {#if total === 0}
    <p class="empty">{t.list.empty}</p>
  {:else}
    <div class="scroll">
      {#each featureGroups as group (group.app.id)}
        <section>
          <h3>{appLabel(group.app.id)}<span class="n">{group.items.length}</span></h3>
          <ul>
            {#each group.items as feat (feat.id)}
              <li>
                <button
                  class="row"
                  class:on={graph.pinned === feat.id}
                  onmouseenter={() => graph.hover(feat.id)}
                  onmouseleave={() => graph.hover(null)}
                  onfocus={() => graph.hover(feat.id)}
                  onblur={() => graph.hover(null)}
                  onclick={() => graph.pin(feat.id)}
                >
                  <span class="name">{feat.label}</span>
                  {#if FEATURES_WITH_MECH.has(feat.id)}
                    <Icon name="eye" size={13} />
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}

      {#each techGroups as group (group.kind)}
        <section class="k-{group.kind}">
          <h3>
            <span class="swatch"></span>{KIND_LABEL[group.kind]}<span class="n">
              {group.items.length}
            </span>
          </h3>
          <ul>
            {#each group.items as tech (tech.id)}
              <li>
                <button
                  class="row mono"
                  class:on={graph.pinned === tech.id}
                  onmouseenter={() => graph.hover(tech.id)}
                  onmouseleave={() => graph.hover(null)}
                  onfocus={() => graph.hover(tech.id)}
                  onblur={() => graph.hover(null)}
                  onclick={() => graph.pin(tech.id)}
                >
                  <span class="name">{tech.label}</span>
                  {#if tech.network}
                    <Icon name="globe" size={13} />
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}

  <p class="hint">{t.list.hint}</p>
</aside>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg) var(--space-md);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    position: sticky;
    top: calc(var(--topbar-h, 52px) + var(--space-md));
    max-height: calc(100dvh - var(--topbar-h, 52px) - var(--space-4xl));
    min-height: 0;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  header h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
  }
  .count {
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* 스크롤바가 글자에 붙지 않게 */
    padding-right: var(--space-2xs);
    margin-right: calc(var(--space-2xs) * -1);
  }

  section + section {
    margin-top: var(--space-md);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    margin: 0 0 var(--space-2xs);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--text-muted);
    position: sticky;
    top: 0;
    background: var(--surface);
    padding: var(--space-2xs) 0;
  }
  h3 .n {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--k, var(--accent));
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    width: 100%;
    padding: var(--space-2xs) var(--space-xs);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: var(--text-base);
    text-align: left;
    line-height: 1.5;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .row.mono .name {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .row .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row:hover {
    background: var(--surface-2);
  }
  /* 고정된 항목 — 도시에서 켜져 있는 그것 */
  .row.on {
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-weight: 600;
  }

  .empty {
    margin: var(--space-lg) 0;
    text-align: center;
    font-size: var(--text-base);
    color: var(--text-muted);
  }

  .hint {
    margin: 0;
    padding-top: var(--space-2xs);
    border-top: 1px solid var(--border);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
