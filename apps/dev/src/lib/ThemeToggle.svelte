<script lang="ts">
  import { t } from "./i18n";
  import Icon from "./Icon.svelte";

  type Theme = "system" | "light" | "dark";
  type ThemeIcon = "system" | "sun" | "moon";

  const options: { id: Theme; label: string; icon: ThemeIcon }[] = [
    { id: "system", label: t.theme.system, icon: "system" },
    { id: "light", label: t.theme.light, icon: "sun" },
    { id: "dark", label: t.theme.dark, icon: "moon" },
  ];

  function read(): Theme {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  }

  function apply(v: Theme) {
    const root = document.documentElement;
    if (v === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", v);
  }

  const initial = read();
  let theme = $state<Theme>(initial);
  apply(initial);

  function set(v: Theme) {
    theme = v;
    localStorage.setItem("theme", v);
    apply(v);
  }
</script>

<div class="toggle" role="group" aria-label={t.theme.label}>
  {#each options as opt (opt.id)}
    <button
      class="opt"
      class:active={theme === opt.id}
      aria-pressed={theme === opt.id}
      title={opt.label}
      onclick={() => set(opt.id)}
    >
      <Icon name={opt.icon} size={15} />
      <span class="sr-only">{opt.label}</span>
    </button>
  {/each}
</div>

<style>
  .toggle {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .opt {
    border: 0;
    background: transparent;
    border-radius: 999px;
    width: 30px;
    height: 26px;
    font-size: 13px;
    line-height: 1;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .opt.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
