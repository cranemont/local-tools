<script lang="ts">
  // 라인 SVG 아이콘 세트 (currentColor, 24x24 viewBox).
  // 모든 크로미엄에서 픽셀 단위로 동일하게 보인다.
  type IconName =
    | "system"
    | "sun"
    | "moon"
    | "plus"
    | "download"
    | "x"
    | "trash"
    | "image"
    | "crop"
    | "rotate"
    | "rotate-ccw"
    | "flip-x"
    | "flip-y"
    | "link"
    | "link-off"
    | "undo"
    | "redo";

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
  {:else if name === "image"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L5 20" />
  {:else if name === "crop"}
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  {:else if name === "rotate"}
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v5h-5" />
  {:else if name === "rotate-ccw"}
    <path d="M3 12a9 9 0 1 0 2.64-6.36" />
    <path d="M3 3v5h5" />
  {:else if name === "flip-x"}
    <path d="M12 3v18" />
    <path d="M9 7 4 12l5 5V7Z" />
    <path d="M15 7l5 5-5 5V7Z" />
  {:else if name === "flip-y"}
    <path d="M3 12h18" />
    <path d="M7 9 12 4l5 5H7Z" />
    <path d="M7 15h10l-5 5-5-5Z" />
  {:else if name === "link"}
    <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
  {:else if name === "link-off"}
    <path d="M9 17H8a5 5 0 0 1 0-10h1" />
    <path d="M15 7h1a5 5 0 0 1 0 10h-1" />
    <path d="M8 12h2M14 12h2" />
  {:else if name === "undo"}
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  {:else if name === "redo"}
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
