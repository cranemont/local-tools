<script lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox).
  type IconName =
    | "system"
    | "sun"
    | "moon"
    | "x"
    | "play"
    | "database"
    | "trash"
    | "check"
    | "grid"
    | "shuffle"
    | "list"
    | "alert"
    | "info"
    | "gavel"
    | "scatter";

  let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "system"}
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  {:else if name === "sun"}
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
    />
  {:else if name === "moon"}
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  {:else if name === "x"}
    <path d="M18 6 6 18M6 6l12 12" />
  {:else if name === "play"}
    <path d="M7 4.5v15l13-7.5Z" />
  {:else if name === "database"}
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  {:else if name === "trash"}
    <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" />
  {:else if name === "check"}
    <path d="M20 6 9 17l-5-5" />
  {:else if name === "grid"}
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  {:else if name === "shuffle"}
    <path d="M3 6h4l10 12h4M3 18h4l3-3.6M14 8.4 17 6h4" />
    <path d="M18 3l3 3-3 3M18 15l3 3-3 3" />
  {:else if name === "list"}
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  {:else if name === "alert"}
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 9v5M12 17.5h.01" />
  {:else if name === "info"}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  {:else if name === "gavel"}
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M8 11.5l2.5 2.5L16 8.5" />
  {:else if name === "scatter"}
    <path d="M4 4v16h16" />
    <circle cx="9" cy="14" r="1.6" />
    <circle cx="13.5" cy="9.5" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
