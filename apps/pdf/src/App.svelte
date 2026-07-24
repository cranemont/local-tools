<script lang="ts">
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
</script>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo" aria-hidden="true"></span>
      <span class="brand-name">{t.brandName}</span>
      <span class="app-name">{t.appName}</span>
    </div>

    <div class="tabs" role="tablist" aria-label={t.appName}>
      {#each tabs as tab (tab.id)}
        <button
          role="tab"
          class="tab"
          class:active={active === tab.id}
          aria-selected={active === tab.id}
          onclick={() => (active = tab.id)}
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
    {#if active === "edit"}
      <Canvas />
    {:else if active === "toImage"}
      <ToImage />
    {:else if active === "password"}
      <Password />
    {/if}
  </main>

  <footer class="footer">
    <span class="privacy">🔒 {t.privacyNote}</span>
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

  .tabs {
    display: flex;
    gap: 4px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 13px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13.5px;
    font-weight: 600;
  }
  .tab:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .tab.active {
    background: var(--accent-weak);
    color: var(--accent);
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

  .footer {
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
</style>
