<script lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox). 이모지는 쓰지 않는다.
  export type IconName =
    | "system"
    | "sun"
    | "moon"
    | "search"
    | "x"
    | "chevron"
    | "external"
    | "play"
    | "stop"
    | "globe"
    | "back"
    | "lock"
    | "eye"
    | "route";

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
  {:else if name === "search"}
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.9-3.9" />
  {:else if name === "x"}
    <path d="M18 6 6 18M6 6l12 12" />
  {:else if name === "chevron"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "external"}
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  {:else if name === "play"}
    <path d="M7 4.5v15l13-7.5Z" />
  {:else if name === "stop"}
    <rect x="6" y="6" width="12" height="12" rx="2" />
  {:else if name === "globe"}
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
  {:else if name === "lock"}
    <rect x="4" y="10.5" width="16" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  {:else if name === "eye"}
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
    <circle cx="12" cy="12" r="2.6" />
  {:else if name === "back"}
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  {:else if name === "route"}
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="5" r="2.5" />
    <path d="M6 16.5V9a4 4 0 0 1 4-4h5.5" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
