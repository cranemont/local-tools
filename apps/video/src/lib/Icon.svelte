<script lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox).
  // 모든 크로미엄에서 픽셀 단위로 동일하게 보인다.
  type IconName =
    | "system"
    | "sun"
    | "moon"
    | "check"
    | "plus"
    | "download"
    | "x"
    | "trash"
    | "copy"
    | "play"
    | "pause"
    | "stepBack"
    | "stepForward"
    | "arrowUp"
    | "arrowDown"
    | "rotate"
    | "flipH"
    | "flipV"
    | "crop"
    | "reverse"
    | "scissors"
    | "film"
    | "image"
    | "audio";

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
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "download"}
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  {:else if name === "x"}
    <path d="M18 6 6 18M6 6l12 12" />
  {:else if name === "trash"}
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    <path d="M9 7V4h6v3" />
  {:else if name === "copy"}
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  {:else if name === "play"}
    <path d="m7 4 13 8-13 8Z" />
  {:else if name === "pause"}
    <path d="M8 5v14M16 5v14" />
  {:else if name === "stepBack"}
    <path d="M19 20 9 12l10-8v16Z" />
    <path d="M5 19V5" />
  {:else if name === "stepForward"}
    <path d="m5 4 10 8-10 8V4Z" />
    <path d="M19 5v14" />
  {:else if name === "arrowUp"}
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  {:else if name === "arrowDown"}
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  {:else if name === "rotate"}
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v5h-5" />
  {:else if name === "flipH"}
    <path d="M12 3v18" />
    <path d="M8 8 4 12l4 4" />
    <path d="m16 8 4 4-4 4" />
  {:else if name === "flipV"}
    <path d="M3 12h18" />
    <path d="M8 8l4-4 4 4" />
    <path d="m8 16 4 4 4-4" />
  {:else if name === "crop"}
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  {:else if name === "reverse"}
    <path d="m16 3 4 4-4 4" />
    <path d="M20 7H4" />
    <path d="m8 21-4-4 4-4" />
    <path d="M4 17h16" />
  {:else if name === "scissors"}
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  {:else if name === "film"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  {:else if name === "image"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L5 20" />
  {:else if name === "audio"}
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
