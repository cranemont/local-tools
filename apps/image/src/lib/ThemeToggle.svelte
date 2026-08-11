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
    padding: var(--space-3xs);
    gap: var(--space-3xs);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
  }
  /* 주의: `.opt:active`는 눌림, `.opt.active`는 선택됨 — 다른 상태다. */
  .opt {
    position: relative;
    border: 0;
    background: transparent;
    border-radius: var(--radius-pill);
    width: 30px;
    height: 26px;
    font-size: var(--text-base);
    line-height: 1;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      color var(--dur-short) var(--ease-out),
      background-color var(--dur-short) var(--ease-out);
  }
  .opt:hover {
    color: var(--text);
  }
  .opt:active {
    transform: translateY(1px);
  }
  /* 선택 표시의 융기는 밝기로 낸다 — 다크에서 그림자는 보이지 않는다. */
  .opt.active {
    background: var(--surface-raised);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }
  /* 히트 영역만 넓힌다 — 실제 크기를 키우면 좁은 상단바가 넘친다 */
  @media (pointer: coarse) {
    .opt::after {
      content: "";
      position: absolute;
      inset: 50% auto auto 50%;
      translate: -50% -50%;
      width: var(--tap-min);
      height: var(--tap-min);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .opt:active {
      transform: none;
    }
  }
</style>
