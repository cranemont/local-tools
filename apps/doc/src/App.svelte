<script lang="ts">
  import { t } from "./lib/i18n";
  import Icon from "./lib/Icon.svelte";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Editor from "./lib/editor/Editor.svelte";
  import { editor } from "./lib/editor/state.svelte";
  import { captureInstallPrompt, isInstalled, onFileLaunch } from "./lib/launch";

  // file://로 직접 연 단일 파일엔 돌아갈 홈이 없다
  const homeHref = location.protocol === "file:" ? null : "../";

  let install = $state<(() => Promise<boolean>) | null>(null);
  const installed = isInstalled();

  captureInstallPrompt((show) => {
    install = show;
  });

  // 설치된 앱에서 .hwp 더블클릭으로 들어온 경우. 여러 개를 골라 열면 일괄 변환으로 간다.
  onFileLaunch((files) => editor.openFiles(files));

  // 엔진은 앱이 뜨자마자 배경에서 받아 둔다(데이터 절약 모드면 미룬다).
  editor.start();

  async function promptInstall(): Promise<void> {
    const show = install;
    if (!show) return;
    await show();
    install = null;
  }
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

    {#if editor.engine === "loading"}
      <span class="engine">
        <span class="spinner" aria-hidden="true"></span>
        {t.engine.loading}
      </span>
    {:else if editor.engine === "failed"}
      <button class="btn small danger" onclick={() => void editor.retryEngineLoad()}>
        <Icon name="refresh" size={15} />
        {t.engine.retry}
      </button>
    {:else if editor.engine === "broken"}
      <button class="btn small danger" onclick={() => location.reload()} title={t.engine.broken}>
        <Icon name="refresh" size={15} />
        {t.engine.reload}
      </button>
    {/if}

    {#if install && !installed}
      <button class="btn small" onclick={() => void promptInstall()} title={t.install.hint}>
        <Icon name="install" size={15} />
        {t.install.label}
      </button>
    {/if}

    <ThemeToggle />
  </header>

  <main class="content">
    <Editor />
  </main>
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
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
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
    padding: 2px var(--space-2xs);
    border-radius: var(--radius-pill);
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  /* 엔진 상태 — 이 앱에서 유일하게 네트워크를 타는 부분이라 감추지 않는다. */
  .engine {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 640px) {
    .engine {
      display: none;
    }
  }

  /* 인쇄에는 도구의 껍데기가 낄 자리가 없다 — 원본 페이지만 남긴다. */
  @media print {
    .topbar {
      display: none;
    }
    .app {
      min-height: 0;
    }
  }
</style>
