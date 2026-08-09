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
    | "type"
    | "rotate"
    | "key"
    | "hash"
    | "fingerprint"
    | "clock"
    | "timer"
    | "regex"
    | "palette";
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
  {:else if name === "rotate"}
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v5h-5" />
  {:else if name === "key"}
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 9.8-9.8" />
    <path d="m15 8 3 3" />
  {:else if name === "hash"}
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  {:else if name === "fingerprint"}
    <path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M21.8 16c.2-2 .13-5.35 0-6" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M8.65 22c.21-.66.45-1.32.57-2" />
  {:else if name === "clock"}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  {:else if name === "timer"}
    <path d="M10 2h4" />
    <circle cx="12" cy="14" r="8" />
    <path d="M12 14l3-3" />
  {:else if name === "regex"}
    <path d="M17 3v8" />
    <path d="m13.5 5 7 4" />
    <path d="m13.5 9 7-4" />
    <rect x="4" y="15" width="5" height="5" rx="1" />
  {:else if name === "palette"}
    <path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.3 3.5-3 3.5h-2.5a2 2 0 0 0-2 2v1c0 1.9-1 3.5-2.5 3.5Z" />
    <circle cx="7.5" cy="11.5" r="0.5" />
    <circle cx="11" cy="7.5" r="0.5" />
    <circle cx="15.5" cy="9.5" r="0.5" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
