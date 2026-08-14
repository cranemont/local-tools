<script lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox).
  // 모든 크로미엄에서 픽셀 단위로 동일하게 보인다.
  type IconName =
    | "merge"
    | "image"
    | "lock"
    | "system"
    | "sun"
    | "moon"
    | "check"
    | "rotate"
    | "trash"
    | "plus"
    | "download"
    | "split"
    | "x";

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
  {#if name === "merge"}
    <rect x="8" y="8" width="12" height="13" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
  {:else if name === "image"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L5 20" />
  {:else if name === "lock"}
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  {:else if name === "system"}
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  {:else if name === "sun"}
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
    />
  {:else if name === "moon"}
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  {:else if name === "check"}
    <path d="M20 6 9 17l-5-5" />
  {:else if name === "rotate"}
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v5h-5" />
  {:else if name === "trash"}
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    <path d="M9 7V4h6v3" />
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "download"}
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  {:else if name === "split"}
    <path d="M12 3v18" stroke-dasharray="3 3" />
    <rect x="3" y="6" width="6" height="12" rx="1.5" />
    <rect x="15" y="6" width="6" height="12" rx="1.5" />
  {:else if name === "x"}
    <path d="M18 6 6 18M6 6l12 12" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
