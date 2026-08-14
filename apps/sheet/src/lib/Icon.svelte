<script module lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox).
  // 모든 크로미엄에서 픽셀 단위로 동일하게 보인다.
  // 이름 목록은 모듈 스코프에 둔다 — 아이콘을 prop으로 받는 컴포넌트(Dropdown)가
  // 타입을 가져다 써야 해서다.
  export type IconName =
    | "system"
    | "sun"
    | "moon"
    | "plus"
    | "download"
    | "x"
    | "trash"
    | "undo"
    | "redo"
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "align-left"
    | "align-center"
    | "align-right"
    | "wrap"
    | "borders"
    | "merge"
    | "freeze"
    | "sort-asc"
    | "sort-desc"
    | "search"
    | "table"
    | "sheet"
    | "copy"
    | "paint"
    | "type"
    | "chevron-down"
    | "hash"
    | "check"
    | "refresh";
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
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "download"}
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  {:else if name === "x"}
    <path d="M6 6l12 12M18 6L6 18" />
  {:else if name === "trash"}
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
  {:else if name === "undo"}
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h9a7 7 0 0 1 0 14H8" />
  {:else if name === "redo"}
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9h-9a7 7 0 0 0 0 14h5" />
  {:else if name === "bold"}
    <path d="M7 4h6a4 4 0 0 1 0 8H7Zm0 8h7a4 4 0 0 1 0 8H7Z" />
  {:else if name === "italic"}
    <path d="M15 4h-5M14 20H9M14 4l-4 16" />
  {:else if name === "underline"}
    <path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" />
  {:else if name === "strike"}
    <path d="M4 12h16M8 6.5A4 4 0 0 1 12 4c2.5 0 4 1.4 4 3M8 15c0 2 1.7 3.5 4 3.5s4-1.3 4-3.2" />
  {:else if name === "align-left"}
    <path d="M4 6h16M4 12h10M4 18h13" />
  {:else if name === "align-center"}
    <path d="M4 6h16M7 12h10M6 18h12" />
  {:else if name === "align-right"}
    <path d="M4 6h16M10 12h10M7 18h13" />
  {:else if name === "wrap"}
    <path d="M4 6h16M4 12h12a3 3 0 0 1 0 6h-3" />
    <path d="m14 15-2 3 2 3" />
  {:else if name === "borders"}
    <rect x="3" y="3" width="18" height="18" rx="1.5" />
    <path d="M12 3v18M3 12h18" stroke-dasharray="2 3" />
  {:else if name === "merge"}
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M12 5v3M12 16v3" />
    <path d="M8 12h8M13 9.5 15.5 12 13 14.5" />
  {:else if name === "freeze"}
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18" stroke-width="2.25" />
    <path d="M9 9v11" />
  {:else if name === "sort-asc"}
    <path d="M7 20V4M4 7l3-3 3 3" />
    <path d="M13 6h8M13 12h6M13 18h4" />
  {:else if name === "sort-desc"}
    <path d="M7 4v16M4 17l3 3 3-3" />
    <path d="M13 6h4M13 12h6M13 18h8" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.5-3.5" />
  {:else if name === "table"}
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18M3 14.5h18M9 9v11M15 9v11" />
  {:else if name === "sheet"}
    <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M15 3v4h4" />
    <path d="M8 12h8M8 16h8M12 12v4" />
  {:else if name === "copy"}
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  {:else if name === "paint"}
    <path d="M4 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3" />
    <rect x="4" y="8" width="12" height="5" rx="1" />
    <path d="M16 10.5h3a1 1 0 0 1 1 1V15a2 2 0 0 1-2 2h-2" />
    <path d="M11 17v3M9 20h4" />
  {:else if name === "type"}
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  {:else if name === "chevron-down"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "hash"}
    <path d="M10 3 8 21M16 3l-2 18M3.5 8.5h17M3 15.5h17" />
  {:else if name === "check"}
    <path d="m5 13 4 4 10-10" />
  {:else if name === "refresh"}
    <path d="M20 11a8 8 0 0 0-13.7-5.3L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 13.7 5.3L20 16" />
    <path d="M20 20v-4h-4" />
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
