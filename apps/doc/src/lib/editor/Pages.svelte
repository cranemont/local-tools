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
   *
   * **편집 모드**에서는 이 판이 곧 편집기다. 그림 위를 누르면 rhwp의 `hitTest`가 그 점의
   * 문서 위치를 돌려주고(0.3ms), 캐럿은 그 위에 덧그린 상자다 — SVG 안에 넣지 않는다.
   * 페이지를 다시 그릴 때마다 캐럿까지 다시 만들 이유가 없기 때문이다.
   * 글자는 캐럿 자리에 겹쳐 둔 투명한 입력칸이 받는다 — 한글 조합(IME)을 브라우저가
   * 제자리에서 처리하게 하려면 진짜 입력 요소가 거기 있어야 한다.
   */
  import { editor } from "./state.svelte";
  import { t } from "../i18n";

  let container = $state<HTMLDivElement | null>(null);
  let docxHost = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLTextAreaElement | null>(null);

  /** 그릴 페이지 번호들 — 스크롤에 따라 넓어진다. */
  let visible = $state(new Set<number>([0, 1]));

  /** SVG 표시 배율 — 문서 좌표(SVG 사용자 단위)와 화면 픽셀을 잇는 유일한 수다. */
  let scale = $state(1);
  /** 캐럿을 놓을 자리(스크롤 상자 안쪽 좌표). */
  let caretBox = $state<{ left: number; top: number; height: number } | null>(null);

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

  /** 배율은 창 크기에 딸려 바뀐다 — 페이지 상자를 지켜보다 다시 잰다. */
  $effect(() => {
    if (!container) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  });

  function measure(): void {
    const svg = container?.querySelector<SVGSVGElement>(".page svg");
    const width = svg?.viewBox?.baseVal?.width ?? 0;
    if (svg && width > 0) scale = svg.getBoundingClientRect().width / width;
    placeCaretBox();
  }

  /** 문서 좌표 → 스크롤 상자 안 좌표. 캐럿과 입력칸이 이 값을 쓴다. */
  function placeCaretBox(): void {
    const rect = editor.caretRect;
    if (!container || !rect) {
      caretBox = null;
      return;
    }
    const pageEl = container.querySelector<HTMLElement>(`[data-page="${rect.page}"]`);
    if (!pageEl) {
      caretBox = null;
      return;
    }
    const pageBox = pageEl.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    caretBox = {
      left: pageBox.left - box.left + container.scrollLeft + rect.x * scale,
      top: pageBox.top - box.top + container.scrollTop + rect.y * scale,
      height: Math.max(12, rect.height * scale),
    };
  }

  // 캐럿이 옮겨 가거나 쪽이 다시 그려지면 자리를 다시 잡는다.
  $effect(() => {
    editor.caretRect;
    editor.revision;
    editor.pageCount;
    visible;
    requestAnimationFrame(() => {
      measure();
    });
  });

  function onPointerDown(event: PointerEvent): void {
    if (!editor.editing) return;
    const pageEl = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-page]");
    const svg = pageEl?.querySelector("svg");
    if (!pageEl || !svg) return;
    const index = Number(pageEl.dataset.page);

    const box = svg.getBoundingClientRect();
    const view = svg.viewBox.baseVal;
    if (!view.width || !box.width) return;

    editor.placeCaret(
      index,
      ((event.clientX - box.left) / box.width) * view.width,
      ((event.clientY - box.top) / box.height) * view.height,
    );
    input?.focus();
  }

  /** 글자 입력 — 조합 중(한글)에는 브라우저에 맡기고, 확정된 것만 문서에 넣는다. */
  function onBeforeInput(event: InputEvent): void {
    if (event.isComposing) return;
    if (event.inputType === "insertText" && event.data) {
      event.preventDefault();
      editor.type(event.data);
    } else if (event.inputType.startsWith("insert")) {
      event.preventDefault(); // 붙여넣기·줄바꿈은 아직 다루지 않는다
    }
  }

  function onCompositionEnd(event: CompositionEvent): void {
    if (event.data) editor.type(event.data);
    if (input) input.value = "";
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      editor.redo();
      return;
    }
    if (mod) return; // 나머지 단축키는 위(셸)에 맡긴다

    switch (event.key) {
      case "Backspace":
        event.preventDefault();
        editor.backspace();
        return;
      case "Delete":
        event.preventDefault();
        editor.deleteForward();
        return;
      case "Enter":
        event.preventDefault();
        editor.newParagraph();
        return;
      case "ArrowLeft":
        event.preventDefault();
        editor.moveCaret(-1);
        return;
      case "ArrowRight":
        event.preventDefault();
        editor.moveCaret(1);
        return;
    }
  }

  const pages = $derived(Array.from({ length: editor.pageCount }, (_, i) => i));
</script>

<!-- 편집 중에는 이 상자가 곧 글 쓰는 자리다 — 보조기술에도 그렇게 알린다. -->
<div
  class="pages"
  class:editing={editor.editing}
  bind:this={container}
  data-pane="original"
  role={editor.editing ? "textbox" : undefined}
  aria-multiline={editor.editing ? "true" : undefined}
  aria-label={editor.editing ? t.edit.placeCaret : undefined}
  onpointerdown={onPointerDown}
>
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

    {#if editor.editing && caretBox}
      <div
        class="caret"
        style:left="{caretBox.left}px"
        style:top="{caretBox.top}px"
        style:height="{caretBox.height}px"
      ></div>
      <!-- 조합 중인 글자는 이 칸 안에서 보인다 — 그래서 자리를 캐럿에 정확히 맞춘다. -->
      <textarea
        bind:this={input}
        class="ime"
        style:left="{caretBox.left}px"
        style:top="{caretBox.top}px"
        style:height="{caretBox.height}px"
        style:font-size="{caretBox.height * 0.82}px"
        rows="1"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label={t.edit.placeCaret}
        onbeforeinput={onBeforeInput}
        oncompositionend={onCompositionEnd}
        onkeydown={onKeyDown}
      ></textarea>
    {/if}
  {/if}
</div>

<style>
  .pages {
    position: relative;
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
  /* 편집 중에는 글자를 고를 수 있다는 뜻으로 커서를 바꾼다. */
  .pages.editing .page {
    cursor: text;
  }
  .pages.editing .page :global(svg) {
    user-select: none;
  }

  .caret {
    position: absolute;
    width: 2px;
    background: var(--accent-ink);
    pointer-events: none;
    animation: blink 1.06s steps(1, end) infinite;
    z-index: var(--z-sticky);
  }
  @keyframes blink {
    0%,
    49% {
      opacity: 1;
    }
    50%,
    100% {
      opacity: 0;
    }
  }

  /* 실제로 키를 받는 칸. 조합 중인 글자만 보이면 되므로 테두리·바탕은 없앤다. */
  .ime {
    position: absolute;
    width: 12ch;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    line-height: 1;
    resize: none;
    overflow: hidden;
    caret-color: transparent; /* 캐럿은 우리가 그린다 */
    z-index: var(--z-sticky);
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
    .number,
    .caret,
    .ime {
      display: none;
    }
  }
</style>
