<script lang="ts">
  import { t } from "./lib/i18n";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Icon from "./lib/Icon.svelte";
  import { TOOLS, type ToolDef } from "./lib/tools/registry";

  // file://로 직접 연 단일 파일엔 돌아갈 홈이 없다
  const homeHref = location.protocol === "file:" ? null : "../";
  const STORAGE_KEY = "dev.tool";

  function findTool(id: string | null): ToolDef | undefined {
    return TOOLS.find((tool) => tool.id === id);
  }

  function initialTool(): ToolDef {
    return (
      findTool(location.hash.slice(1)) ?? findTool(localStorage.getItem(STORAGE_KEY)) ?? TOOLS[0]
    );
  }

  let active = $state<ToolDef>(initialTool());
  let query = $state("");
  let searchEl = $state<HTMLInputElement | null>(null);

  function select(tool: ToolDef) {
    active = tool;
    localStorage.setItem(STORAGE_KEY, tool.id);
    // 도구 전환이 히스토리를 쌓지 않게 replaceState — 뒤로가기는 앱 밖으로.
    history.replaceState(null, "", `#${tool.id}`);
  }

  function onHashChange() {
    const tool = findTool(location.hash.slice(1));
    if (tool) active = tool;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"))
      return;
    e.preventDefault();
    searchEl?.focus();
  }

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOOLS;
    return TOOLS.filter((tool) => `${tool.title} ${tool.keywords}`.toLowerCase().includes(q));
  });

  const groups = $derived.by(() => {
    const map = new Map<string, ToolDef[]>();
    for (const tool of filtered) {
      const arr = map.get(tool.group);
      if (arr) arr.push(tool);
      else map.set(tool.group, [tool]);
    }
    return [...map.entries()];
  });
</script>

<svelte:window onhashchange={onHashChange} onkeydown={onKeydown} />

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

  <div class="body">
    <aside class="side">
      <div class="search">
        <Icon name="search" size={14} />
        <input
          bind:this={searchEl}
          bind:value={query}
          type="search"
          placeholder={t.sidebar.search}
          aria-label={t.sidebar.search}
        />
      </div>
      <nav class="nav" aria-label={t.appName}>
        {#each groups as [name, tools] (name)}
          <p class="group">{name}</p>
          {#each tools as tool (tool.id)}
            <button
              class="item"
              class:active={tool.id === active.id}
              aria-current={tool.id === active.id ? "page" : undefined}
              onclick={() => select(tool)}
            >
              <Icon name={tool.icon} size={15} />
              <span>{tool.title}</span>
            </button>
          {/each}
        {/each}
        {#if !filtered.length}
          <p class="empty">{t.sidebar.empty}</p>
        {/if}
      </nav>
    </aside>

    <main class="content">
      <div class="tool-head">
        <h1>{active.title}</h1>
        <p>{active.desc}</p>
      </div>
      {#key active.id}
        <active.component />
      {/key}
    </main>
  </div>

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

  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 224px 1fr;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 10px;
    border-right: 1px solid var(--border);
    background: var(--surface);
    overflow-y: auto;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-family: inherit;
    font-size: 13px;
    color: var(--text);
    outline: none;
  }
  .search input::placeholder {
    color: var(--text-muted);
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .group {
    margin: 10px 6px 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .group:first-child {
    margin-top: 2px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 13.5px;
    font-weight: 600;
    text-align: left;
  }
  .item:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .item.active {
    background: var(--accent-weak);
    color: var(--accent);
  }

  .empty {
    margin: 10px 6px;
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 20px 24px 24px;
    overflow-y: auto;
  }

  .tool-head {
    margin-bottom: 14px;
  }
  .tool-head h1 {
    margin: 0;
    font-size: 17px;
    letter-spacing: -0.01em;
  }
  .tool-head p {
    margin: 3px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .footer {
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }

  @media (max-width: 760px) {
    .body {
      grid-template-columns: 1fr;
    }
    .side {
      flex-direction: row;
      align-items: center;
      border-right: 0;
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
      overflow-y: hidden;
      padding: 10px 12px;
    }
    .search {
      flex: none;
      width: 150px;
    }
    .nav {
      flex-direction: row;
      align-items: center;
    }
    .group {
      display: none;
    }
    .item span {
      white-space: nowrap;
    }
  }
</style>
