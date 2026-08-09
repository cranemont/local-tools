<script lang="ts">
  import { t } from "./lib/i18n";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Editor from "./lib/editor/Editor.svelte";

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

    <div class="spacer"></div>
    <ThemeToggle />
  </header>

  <main class="content">
    <Editor />
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
    z-index: 10;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14.5px;
    letter-spacing: -0.01em;
    color: inherit;
    text-decoration: none;
  }
  .logo {
    display: block;
    color: var(--text);
  }
  a.brand:hover .logo {
    color: var(--accent);
  }
  .app-name {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-weak);
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-height: 0;
    padding: 18px;
    display: flex;
    justify-content: center;
    overflow: auto;
  }

  .footer {
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
</style>
