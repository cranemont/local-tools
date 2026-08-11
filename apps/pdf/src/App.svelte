<script lang="ts">
  import { tick } from "svelte";
  import { t } from "./lib/i18n";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Icon from "./lib/Icon.svelte";
  import Canvas from "./lib/canvas/Canvas.svelte";
  import ToImage from "./lib/toimage/ToImage.svelte";
  import Password from "./lib/password/Password.svelte";

  type TabId = "edit" | "toImage" | "password";
  type TabIcon = "merge" | "image" | "lock";

  const tabs: { id: TabId; label: string; icon: TabIcon }[] = [
    { id: "edit", label: t.tabs.edit, icon: "merge" },
    { id: "toImage", label: t.tabs.toImage, icon: "image" },
    { id: "password", label: t.tabs.password, icon: "lock" },
  ];

  let active = $state<TabId>("edit");

  // WAI-ARIA 탭 패턴: 탭 목록 안에서는 화살표/Home/End로 이동하고,
  // Tab 키는 탭 목록을 통째로 건너뛴다(roving tabindex).
  async function onTabKeydown(e: KeyboardEvent) {
    const i = tabs.findIndex((tab) => tab.id === active);
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    active = tabs[next].id;
    await tick();
    document.getElementById(`tab-${active}`)?.focus();
  }

  // file://로 직접 연 단일 파일엔 돌아갈 홈이 없다
  const homeHref = location.protocol === "file:" ? null : "../";
</script>

<div class="app">
  <header class="topbar">
    <svelte:element
      this={homeHref ? "a" : "div"}
      class="brand"
      href={homeHref ?? undefined}
      title={homeHref ? t.home : undefined}
    >
      <svg class="logo" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <rect x="1.6" y="1.6" width="14.8" height="14.8" rx="4.8" fill="none" stroke="currentColor" stroke-width="1.6" />
        <circle cx="9" cy="9" r="3.2" fill="var(--accent)" />
      </svg>
      <span class="brand-name">{t.brandName}</span>
      <span class="app-name">{t.appName}</span>
    </svelte:element>

    <div class="tabs" role="tablist" aria-label={t.appName}>
      {#each tabs as tab (tab.id)}
        <button
          role="tab"
          id="tab-{tab.id}"
          class="tab"
          class:active={active === tab.id}
          aria-selected={active === tab.id}
          aria-controls="panel-{tab.id}"
          tabindex={active === tab.id ? 0 : -1}
          onclick={() => (active = tab.id)}
          onkeydown={onTabKeydown}
        >
          <Icon name={tab.icon} size={16} />
          <span>{tab.label}</span>
        </button>
      {/each}
    </div>

    <div class="spacer"></div>
    <ThemeToggle />
  </header>

  <main class="content">
    <!-- main 랜드마크는 유지하고, tabpanel 롤은 안쪽 래퍼가 갖는다 -->
    <div class="panel" role="tabpanel" id="panel-{active}" aria-labelledby="tab-{active}">
      {#if active === "edit"}
        <Canvas />
      {:else if active === "toImage"}
        <ToImage />
      {:else if active === "password"}
        <Password />
      {/if}
    </div>
  </main>

  <footer class="footer">
    <span class="privacy">{t.privacyNote}</span>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100dvh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 18px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
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
  /* 워드마크는 하이픈에서 꺾이지 않는다 — 배지가 넓은 앱(VIDEO)에서 320px일 때
   * "local-" / "tools" 두 줄로 갈라졌다. */
  .brand-name {
    white-space: nowrap;
  }
  .app-name {
    flex: none;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .tabs {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    /* 탭 라벨은 어떤 폭에서도 한 줄이다 — 두 줄로 감기면 눌림 영역이 망가진 것처럼 보인다 */
    white-space: nowrap;
    padding: 7px 13px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .tab:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .tab.active {
    background: var(--accent-weak);
    color: var(--accent-ink);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-height: 0;
    padding: 24px;
    display: flex;
    overflow: hidden;
  }
  .panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .footer {
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }

  /* 브랜드 + 탭 3개 + 토글이 한 줄에 안 들어가는 폭 — 탭을 둘째 줄로 내린다.
   * (body의 overflow-x: clip 때문에 넘치면 스크롤이 아니라 잘려 나간다) */
  @media (max-width: 640px) {
    .topbar {
      flex-wrap: wrap;
      gap: var(--space-sm) var(--space-md);
      padding: var(--space-sm) var(--space-md);
    }
    .tabs {
      order: 3;
      width: 100%;
      justify-content: space-between;
    }
    .tab {
      padding-inline: var(--space-sm);
    }
    .content {
      padding: var(--space-md);
    }
  }
</style>
