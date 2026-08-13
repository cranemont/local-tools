<script lang="ts">
  import { t } from "./lib/i18n";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Editor from "./lib/editor/Editor.svelte";
  import { NETWORK_HOSTS } from "./lib/embed/runtime";

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
        <circle cx="6.4" cy="7" r="1.5" fill="var(--accent)" />
        <circle cx="11.4" cy="5.8" r="1.1" fill="var(--accent)" opacity="0.6" />
        <circle cx="11.8" cy="11.4" r="1.6" fill="var(--accent)" />
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
    <span class="hosts">
      {t.net.title}:
      {#each NETWORK_HOSTS as host, i (host)}<code>{host}</code>{#if i < NETWORK_HOSTS.length - 1}<span
            class="sep">·</span
          >{/if}{/each}
    </span>
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
    flex: none;
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

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-height: 0;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs) var(--space-lg);
    flex: none;
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }
  .hosts code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .sep {
    margin: 0 var(--space-2xs);
  }
</style>
