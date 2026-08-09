<script lang="ts">
  import { t } from "./lib/i18n";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Editor from "./lib/editor/Editor.svelte";
</script>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo" aria-hidden="true"></span>
      <span class="brand-name">{t.brandName}</span>
      <span class="app-name">{t.appName}</span>
    </div>

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
    gap: 9px;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.01em;
  }
  .logo {
    width: 18px;
    height: 18px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--brand-400), var(--brand-600));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
  .app-name {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--accent-weak);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
  }

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-height: 0;
    padding: 18px;
    display: flex;
    overflow: hidden;
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
