<script lang="ts">
  /**
   * 왼쪽 — 원본 재현. 한글 문서는 페이지마다 SVG를 받아 그대로 얹고, 워드 문서는
   * docx-preview가 컨테이너에 직접 그린다.
   *
   * SVG를 고른 이유는 rhwp가 문서화한 유일한 출력이고 표·수식·도형 배치가 가장 정확해서다.
   * 대신 브라우저 Ctrl+F가 닿지 않으므로 찾기는 FindBar가 따로 맡는다.
   *
   * 페이지는 화면에 들어올 때 그린다 — 100쪽짜리를 한 번에 그리면 열자마자 멈춘다.
   * 인쇄할 때만 전부 그린다(그때는 잘라 내면 안 되므로).
   */
  import { editor } from "./state.svelte";

  let container = $state<HTMLDivElement | null>(null);
  let docxHost = $state<HTMLDivElement | null>(null);

  /** 그릴 페이지 번호들 — 스크롤에 따라 넓어진다. */
  let visible = $state(new Set<number>([0, 1]));

  function observePages(): (() => void) | undefined {
    if (!container || editor.kind === "docx") return;

    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const next = new Set(visible);
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.page);
          if (!next.has(index)) {
            next.add(index);
            changed = true;
          }
        }
        if (changed) visible = next;
      },
      // 한 화면 앞뒤로 미리 그려 스크롤이 빈 종이를 만나지 않게 한다.
      { root: container, rootMargin: "150% 0px" },
    );

    for (const slot of container.querySelectorAll<HTMLElement>("[data-page]")) io.observe(slot);
    return () => io.disconnect();
  }

  // 문서가 바뀌면 처음부터 다시.
  $effect(() => {
    editor.fileName;
    visible = new Set([0, 1]);
    if (container) container.scrollTop = 0;
  });

  // 페이지 슬롯이 새로 생기면 관찰 대상도 다시 잡는다(첫 관찰도 여기서 시작한다).
  $effect(() => {
    editor.pageCount;
    const stop = observePages();
    return () => stop?.();
  });

  $effect(() => {
    if (editor.kind === "docx" && docxHost) void editor.renderDocxInto(docxHost);
  });

  const pages = $derived(Array.from({ length: editor.pageCount }, (_, i) => i));
</script>

<div class="pages" bind:this={container} data-pane="original">
  {#if editor.kind === "docx"}
    <div class="docx-host" bind:this={docxHost}></div>
  {:else}
    {#each pages as index (index)}
      <div class="page" data-page={index}>
        {#if visible.has(index) || editor.printing}
          <!-- rhwp가 낸 SVG를 그대로 얹는다. 그림도 data URI로 안에 박혀 있다. -->
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html editor.pageSvg(index)}
        {:else}
          <div class="placeholder" style:aspect-ratio="1 / 1.414"></div>
        {/if}
        <span class="number">{index + 1}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .pages {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-md);
    /* 종이가 떠 보이도록 바닥을 한 단 낮춘다 */
    background: var(--surface-2);
  }

  .page {
    position: relative;
    width: min(100%, 820px);
    background: white;
    box-shadow: var(--shadow-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  /* rhwp가 낸 SVG는 자기 크기를 갖고 나오므로 폭에 맞춰 줄인다. */
  .page :global(svg) {
    display: block;
    width: 100%;
    height: auto;
  }

  .placeholder {
    width: 100%;
    background: repeating-linear-gradient(
      -45deg,
      var(--surface-2),
      var(--surface-2) 10px,
      var(--surface) 10px,
      var(--surface) 20px
    );
    opacity: 0.5;
  }

  .number {
    position: absolute;
    right: var(--space-2xs);
    bottom: var(--space-2xs);
    padding: 1px var(--space-2xs);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .docx-host {
    width: min(100%, 900px);
  }
  /* docx-preview는 자기 CSS를 함께 넣는다. 우리 쪽은 바탕만 맞춰 준다. */
  .docx-host :global(.docx-wrapper) {
    background: transparent;
    padding: 0;
    gap: var(--space-md);
  }
  .docx-host :global(.docx) {
    box-shadow: var(--shadow-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  @media print {
    .pages {
      overflow: visible;
      padding: 0;
      gap: 0;
      background: white;
    }
    .page {
      width: 100%;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      break-after: page;
    }
    .number {
      display: none;
    }
  }
</style>
