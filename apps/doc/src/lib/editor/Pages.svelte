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
  /** 찾은 자리들 — 캐럿과 같은 변환을 지나 스크롤 상자 안 좌표가 된다. */
  let hitBoxes = $state<
    { left: number; top: number; width: number; height: number; current: boolean }[]
  >([]);

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
    placeHits();
  }

  /** 문서 좌표 → 스크롤 상자 안 좌표. 캐럿·입력칸·찾기 표시가 모두 이 변환을 쓴다. */
  function pointOf(page: number, x: number, y: number): { left: number; top: number } | null {
    if (!container) return null;
    const pageEl = container.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!pageEl) return null;
    const pageBox = pageEl.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    return {
      left: pageBox.left - box.left + container.scrollLeft + x * scale,
      top: pageBox.top - box.top + container.scrollTop + y * scale,
    };
  }

  function placeCaretBox(): void {
    const rect = editor.caretRect;
    const at = rect ? pointOf(rect.page, rect.x, rect.y) : null;
    caretBox = at && rect ? { ...at, height: Math.max(12, rect.height * scale) } : null;
  }

  /** 찾은 자리를 칠한다 — 아직 안 그린 쪽은 자리를 잴 수 없으니 건너뛴다. */
  function placeHits(): void {
    const boxes: typeof hitBoxes = [];
    for (const { rect, current } of editor.highlights) {
      const at = pointOf(rect.page, rect.x, rect.y);
      if (!at) continue;
      boxes.push({
        ...at,
        width: Math.max(2, rect.width * scale),
        height: Math.max(6, rect.height * scale),
        current,
      });
    }
    hitBoxes = boxes;
  }

  // 캐럿이 옮겨 가거나 쪽이 다시 그려지면(배율이 바뀌면) 자리를 다시 잡는다.
  $effect(() => {
    editor.caretRect;
    editor.revision;
    editor.pageCount;
    editor.zoom;
    editor.highlights;
    visible;
    requestAnimationFrame(() => {
      measure();
    });
  });

  /**
   * 지금 보고 있는 쪽. 화면 위쪽 1/4을 기준선으로 삼아 그 선을 지난 마지막 쪽이다 —
   * IntersectionObserver는 "앞뒤로 미리 그리기"용이라 한 화면 반경을 알려 줄 뿐이다.
   */
  let tracking = false;

  function onScroll(): void {
    if (tracking || editor.kind === "docx") return;
    tracking = true;
    requestAnimationFrame(() => {
      tracking = false;
      trackPage();
    });
  }

  function trackPage(): void {
    if (!container) return;
    // 상자 안 좌표로만 센다 — 쪽마다 getBoundingClientRect를 부르면 긴 문서에서 스크롤이 끈다
    // (offsetTop은 `.pages`가 position: relative라 곧 이 상자 안 좌표다).
    const line = container.scrollTop + container.clientHeight * 0.25;
    let found = 0;
    for (const el of container.querySelectorAll<HTMLElement>("[data-page]")) {
      if (el.offsetTop > line) break;
      found = Number(el.dataset.page);
    }
    editor.currentPage = found;
  }

  /**
   * Ctrl+휠 확대·축소. 브라우저 전체 확대와 달리 문서만 커진다.
   * 기본 동작(페이지 확대)을 막아야 해서 passive가 아닌 리스너로 직접 단다.
   */
  $effect(() => {
    const box = container;
    if (!box) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY < 0) editor.zoomIn();
      else editor.zoomOut();
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
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
  style:--zoom={editor.zoom}
  role={editor.editing ? "textbox" : undefined}
  aria-multiline={editor.editing ? "true" : undefined}
  aria-label={editor.editing ? t.edit.placeCaret : undefined}
  onpointerdown={onPointerDown}
  onscroll={onScroll}
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

    <!-- 찾은 자리 — 쪽까지만 데려다 놓지 않고 어디인지 칠한다. -->
    {#each hitBoxes as box, index (index)}
      <div
        class="hit"
        class:current={box.current}
        style:left="{box.left}px"
        style:top="{box.top}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
      ></div>
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
    /* 문서 끝까지 스크롤했을 때 페이지 전체가 딸려 올라가지 않게 한다.
     * 이게 없으면 도구 아래 설명(section#intro)으로 스크롤이 넘어가면서
     * 편집 화면이 위로 밀려 "잘린" 것처럼 보인다. */
    overscroll-behavior: contain;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    /* 종이가 떠 보이도록 바닥을 한 단 낮춘다 */
    background: var(--surface-2);
  }

  .page {
    position: relative;
    /* 세로 flex 안에서 절대 줄어들면 안 된다.
     * 이게 없으면 쪽이 많을수록(52쪽 문서 기준 3px) 컨테이너 높이에 맞춰 짓눌린다 —
     * 아래 overflow: hidden이 flex 항목의 자동 최소 크기(min-height: auto)를 꺼버려서
     * 쪽이 적을 땐 멀쩡하다가 여러 쪽 문서에서만 터졌다. */
    flex-shrink: 0;
    /* 배율은 **실제 폭**으로 건다(transform이 아니다). transform으로 걸면 자리를 차지하는
     * 크기는 그대로라 가상 스크롤 높이와 스크롤 위치가 배율만큼 어긋난다. */
    width: calc(min(100%, 820px) * var(--zoom, 1));
    /* 가운데 정렬은 auto 여백으로 한다 — align-items: center로 하면 창보다 넓게 확대했을 때
     * 왼쪽이 잘려 나가 스크롤해도 못 본다. */
    margin-inline: auto;
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

  /* 찾은 자리. 종이는 테마와 무관하게 흰색이라 반투명 강조색이 그 위에서 그대로 읽힌다. */
  .hit {
    position: absolute;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    pointer-events: none;
  }
  .hit.current {
    background: color-mix(in srgb, var(--accent) 60%, transparent);
    outline: 1px solid var(--accent-ink);
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
    margin-inline: auto;
    /* 워드 쪽은 우리가 그린 SVG가 아니라 docx-preview의 HTML이라 폭을 곱할 수 없다.
     * `zoom`은 transform과 달리 자리 차지하는 크기까지 바꾸므로 스크롤이 어긋나지 않는다. */
    zoom: var(--zoom, 1);
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
      /* 인쇄는 배율을 따르지 않는다 — 종이 크기는 인쇄 대화상자가 정한다. */
      width: 100%;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      break-after: page;
    }
    .docx-host {
      zoom: 1;
    }
    .number,
    .caret,
    .ime,
    .hit {
      display: none;
    }
  }
</style>
