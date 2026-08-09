<script module lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox).
  export type IconName =
    | "system"
    | "sun"
    | "moon"
    | "check"
    | "copy"
    | "x"
    | "search"
    | "swap"
    | "braces"
    | "diff"
    | "code"
    | "type";
</script>

<script lang="ts">
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
  {:else if name === "check"}
    <path d="M20 6 9 17l-5-5" />
  {:else if name === "copy"}
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  {:else if name === "x"}
    <path d="M18 6 6 18M6 6l12 12" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4-4" />
  {:else if name === "swap"}
    <path d="M8 3 4 7l4 4" />
    <path d="M4 7h16" />
    <path d="m16 21 4-4-4-4" />
    <path d="M20 17H4" />
  {:else if name === "braces"}
    <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
    <path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
  {:else if name === "diff"}
    <path d="M12 3v14" />
    <path d="M5 10h14" />
    <path d="M5 21h14" />
  {:else if name === "code"}
    <path d="m8 6-6 6 6 6" />
    <path d="m16 6 6 6-6 6" />
  {:else if name === "type"}
    <path d="M4 7V5h16v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
