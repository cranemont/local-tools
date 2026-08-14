<script module lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox). 이모지는 쓰지 않는다.
  export type IconName =
    | "system"
    | "sun"
    | "moon"
    | "download"
    | "copy"
    | "print"
    | "search"
    | "x"
    | "lock"
    | "doc"
    | "hangul"
    | "refresh"
    | "alert"
    | "install"
    | "link"
    | "pencil"
    | "undo"
    | "redo"
    | "chevron-up"
    | "chevron-down"
    | "list"
    | "zoom-in"
    | "zoom-out";
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
  {:else if name === "download"}
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  {:else if name === "copy"}
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  {:else if name === "print"}
    <path d="M7 9V3h10v6" />
    <path d="M5 9h14a2 2 0 0 1 2 2v5h-4" />
    <path d="M7 16H3v-5a2 2 0 0 1 2-2" />
    <rect x="7" y="14" width="10" height="7" rx="1" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.5-3.5" />
  {:else if name === "x"}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === "lock"}
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  {:else if name === "doc"}
    <path d="M8 3h7l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M15 3v4h4" />
    <path d="M9 13h6M9 17h4" />
  {:else if name === "hangul"}
    <!-- ㅎ — 한글 문서를 가리키는 표식. 글자를 그대로 쓰면 폰트에 휘둘려 선으로 그렸다. -->
    <path d="M9 4h6M12 4v3" />
    <path d="M6 9h12" />
    <circle cx="12" cy="15.5" r="4.5" />
  {:else if name === "refresh"}
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 4v5h-5" />
  {:else if name === "alert"}
    <path d="M12 4 2.7 20h18.6L12 4Z" />
    <path d="M12 10v4M12 17.5v.5" />
  {:else if name === "install"}
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M12 8v7M9 12l3 3 3-3" />
  {:else if name === "link"}
    <path d="M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.5 6" />
    <path d="M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5" />
  {:else if name === "pencil"}
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14.5 6.5 3 3" />
  {:else if name === "undo"}
    <path d="M9 8H5V4" />
    <path d="M5 8a8 8 0 1 1 0 8" />
  {:else if name === "redo"}
    <path d="M15 8h4V4" />
    <path d="M19 8a8 8 0 1 0 0 8" />
  {:else if name === "chevron-up"}
    <path d="m6 15 6-6 6 6" />
  {:else if name === "chevron-down"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "list"}
    <!-- 줄이 짧아지는 모양 — 목차(제목 수준)를 가리킨다 -->
    <path d="M4 6h16M4 12h11M4 18h7" />
  {:else if name === "zoom-in"}
    <circle cx="11" cy="11" r="6" />
    <path d="M11 8.5v5M8.5 11h5" />
    <path d="m20 20-3.5-3.5" />
  {:else if name === "zoom-out"}
    <circle cx="11" cy="11" r="6" />
    <path d="M8.5 11h5" />
    <path d="m20 20-3.5-3.5" />
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
