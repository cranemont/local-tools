<script lang="ts">
  // 기계 한 대를 펼쳐 보는 뷰 — 제목과 결론, 도식, 그리고 이게 도는 곳들.
  import { graph } from "../graph/state.svelte";
  import { MECH_BY_ID } from "./mechanisms";
  import { FEATURE_BY_ID, TECH_BY_ID, APPS } from "../data/stack";
  import { t } from "../i18n";
  import { repoBlob } from "../repo";
  import Icon from "../Icon.svelte";
  import Sequence from "./Sequence.svelte";
  import Flow from "./Flow.svelte";
  import Bytes from "./Bytes.svelte";

  const mech = $derived(graph.mechId ? MECH_BY_ID.get(graph.mechId) : undefined);
  const appLabel = (id: string) => APPS.find((app) => app.id === id)?.label ?? id;

  /** 기능·기술 어느 쪽이든 눌러서 지도·도시로 되돌아갈 수 있게 한다 */
  function jump(id: string) {
    graph.closeMech();
    graph.pin(id);
  }
</script>

{#if mech}
  <section class="mech">
    <header>
      <button class="btn small ghost" onclick={() => graph.closeMech()}>
        <Icon name="back" size={15} />
        {t.mech.back}
      </button>
      <div class="title">
        <h2>{mech.title}</h2>
        <p>{mech.subtitle}</p>
      </div>
    </header>

    <div class="canvas">
      {#if mech.kind === "sequence" && mech.sequence}
        <Sequence spec={mech.sequence} />
      {:else if mech.kind === "flow" && mech.flow}
        <Flow spec={mech.flow} />
      {:else if mech.kind === "bytes" && mech.bytes}
        <Bytes spec={mech.bytes} />
      {/if}
    </div>

    <footer>
      <section>
        <h3>{t.mech.usedIn}</h3>
        <ul class="chips">
          {#each mech.features as id (id)}
            {@const feat = FEATURE_BY_ID.get(id)}
            {#if feat}
              <li>
                <button class="chip" onclick={() => jump(id)}>
                  <span class="badge">{appLabel(feat.app)}</span>{feat.label}
                </button>
              </li>
            {/if}
          {/each}
          {#each mech.techs as id (id)}
            {@const tech = TECH_BY_ID.get(id)}
            {#if tech}
              <li>
                <button class="chip k-{tech.kind}" onclick={() => jump(id)}>
                  <span class="swatch"></span><span class="mono">{tech.label}</span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
      </section>

      <section>
        <h3>{t.mech.source}</h3>
        <ul class="srcs">
          {#each mech.src as path (path)}
            <li>
              <a href={repoBlob(path)} target="_blank" rel="noreferrer noopener">
                <span class="path">{path}</span>
                <Icon name="external" size={13} />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    </footer>
  </section>
{/if}

<style>
  .mech {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
    padding: var(--space-xl);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    min-width: 0;
  }

  header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-md);
  }
  .title h2 {
    margin: 0 0 var(--space-xs);
    font-size: var(--text-6xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }
  .title p {
    margin: 0;
    max-width: 68ch;
    font-size: var(--text-2xl);
    line-height: 1.7;
    color: var(--text-muted);
  }

  .canvas {
    min-width: 0;
  }

  footer {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-xl);
    padding-top: var(--space-lg);
    border-top: 1px solid var(--border);
  }
  @media (max-width: 720px) {
    footer {
      grid-template-columns: 1fr;
    }
    .mech {
      padding: var(--space-lg) var(--space-md);
    }
  }

  h3 {
    margin: 0 0 var(--space-sm);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
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
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--k, var(--accent));
  }
  .badge {
    padding: 1px var(--space-xs);
    border-radius: var(--radius-pill);
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-size: var(--text-2xs);
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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
</style>
