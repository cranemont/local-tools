<script lang="ts">
  /** 셸 — 단계(비었음·여는 중·잠김·오류·준비됨)를 갈아 끼우고, 준비되면 좌우 두 판을 편다.
   *
   * 좌우 분할이 이 도구의 핵심이다: 왼쪽에 원본, 오른쪽에 저장될 마크다운을 동시에 놓아
   * **변환 품질을 사용자가 눈으로 검증**할 수 있게 한다. 좁은 화면에서는 한 판만 남긴다.
   */
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";
  import Dropzone from "./Dropzone.svelte";
  import Toolbar from "./Toolbar.svelte";
  import Pages from "./Pages.svelte";
  import MarkdownPane from "./MarkdownPane.svelte";
  import FindBar from "./FindBar.svelte";
  import PasswordDialog from "./PasswordDialog.svelte";
  import type { PaneView } from "./view";

  let view = $state<PaneView>("both");
  let sync = $state(true);
  let finding = $state(false);
  let findNonce = $state(0);
  let narrow = $state(false);

  // 드래그는 자식 위를 지날 때마다 leave/enter가 번갈아 나므로 깊이를 센다
  // (0이 될 때만 겹판이 사라진다 — 시트와 같은 방식).
  let dragDepth = $state(0);

  // 좁은 화면에서 두 판을 우겨넣으면 둘 다 못 읽는다 — 한 판만 남긴다.
  // 고른 view 자체는 건드리지 않는다. 창을 넓히면 보던 배치로 그대로 돌아온다.
  $effect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const apply = (): void => {
      narrow = query.matches;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  });

  const effectiveView = $derived<PaneView>(narrow && view === "both" ? "original" : view);

  /** 인쇄는 원본만 내보낸다 — 마크다운만 보고 있어도 그 순간엔 원본 판을 살려 둔다. */
  const showOriginal = $derived(effectiveView !== "markdown" || editor.printing);
  const showMarkdown = $derived(effectiveView !== "original");
  /** 찾기는 원본(그림)을 위한 것이다 — 마크다운만 보고 있으면 브라우저 찾기가 맞다. */
  const canFind = $derived(editor.kind !== "docx" && effectiveView !== "markdown");

  function openFile(file: File): void {
    void editor.open(file);
  }

  function onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth++;
  }

  function onDragLeave(): void {
    dragDepth = Math.max(0, dragDepth - 1);
  }

  function onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragDepth = 0;
    const file = event.dataTransfer?.files?.[0];
    if (file) openFile(file);
  }

  /** 왼쪽은 그림이라 브라우저 Ctrl+F가 닿지 않는다 — 그 화면에서만 우리 찾기를 연다. */
  function onKeydown(event: KeyboardEvent): void {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
    if (editor.stage !== "ready" || !canFind) return;
    event.preventDefault();
    finding = true;
    findNonce++; // 이미 열려 있어도 입력란으로 돌아가게
  }

  /**
   * 스크롤 맞춤 — 비율 근사다. 문단 단위로 정확히 잇는 것은 엔진의 문단 인덱스와
   * 마크다운 출력 위치를 엮어야 해서 비싸고, 표가 끼면 어차피 어긋난다.
   * 그래서 "대충 같은 데를 보고 있다"까지만 한다. 끄고 볼 수도 있게 두었다.
   *
   * 스크롤은 위로 올라오지 않으므로(bubbles: false) 캡처로 받는다. 그래서 판을 알아내는
   * 기준은 **target**이다 — currentTarget은 언제나 여기 이 상자다.
   */
  let root = $state<HTMLDivElement | null>(null);
  let syncing = false;

  function onScroll(event: Event): void {
    if (!sync || effectiveView !== "both" || syncing) return;

    const from = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-pane]");
    if (!from) return;
    const other = root?.querySelector<HTMLElement>(
      from.dataset.pane === "original" ? '[data-pane="markdown"]' : '[data-pane="original"]',
    );
    if (!other || other === from) return;

    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    syncing = true;
    other.scrollTop = ratio * Math.max(0, other.scrollHeight - other.clientHeight);
    requestAnimationFrame(() => {
      syncing = false;
    });
  }

  // 저장 알림은 잠깐만 띄운다.
  $effect(() => {
    if (!editor.flash) return;
    const timer = setTimeout(() => (editor.flash = null), 4000);
    return () => clearTimeout(timer);
  });
</script>

<svelte:window
  onkeydown={onKeydown}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondrop={onDrop}
  ondragleave={onDragLeave}
/>

<div class="editor" bind:this={root}>
  {#if editor.stage === "empty"}
    <Dropzone open={openFile} />
  {:else if editor.stage === "opening"}
    <div class="center">
      <span class="spinner" aria-hidden="true"></span>
      <p>{editor.engine === "loading" ? t.engine.loading : t.file.opening}</p>
      {#if editor.engine === "loading"}
        <p class="sub">{t.engine.loadingHint}</p>
      {/if}
    </div>
  {:else if editor.stage === "locked"}
    <PasswordDialog />
  {:else if editor.stage === "error"}
    <div class="center">
      <Icon name="alert" size={32} />
      <h2>{t.error.title}</h2>
      <p class="sub">{editor.error}</p>
      {#if editor.engine === "failed"}
        <button class="btn" onclick={() => void editor.retryEngineLoad()}>
          <Icon name="refresh" size={15} />
          {t.engine.retry}
        </button>
      {:else if editor.engine === "broken"}
        <button class="btn" onclick={() => location.reload()}>
          <Icon name="refresh" size={15} />
          {t.engine.reload}
        </button>
      {/if}
      <button class="btn primary" onclick={() => editor.close()}>{t.error.again}</button>
    </div>
  {:else}
    <Toolbar
      view={effectiveView}
      {narrow}
      setView={(next) => (view = next)}
      {sync}
      toggleSync={() => (sync = !sync)}
      {canFind}
      toggleFind={() => {
        finding = !finding;
        if (finding) findNonce++;
      }}
    />
    {#if finding && canFind}
      <FindBar focus={findNonce} close={() => (finding = false)} />
    {/if}

    <!-- 두 판은 언제나 DOM에 둔다 — 인쇄가 마크다운 화면에서도 원본을 내보내야 하고,
         판을 오갈 때마다 다시 그리지 않아도 된다. 감출 때는 CSS로만 감춘다. -->
    <div class="panes" class:split={effectiveView === "both"} onscrollcapture={onScroll}>
      <div class="pane" class:hidden={!showOriginal}>
        <Pages />
      </div>
      <div class="pane md" class:hidden={!showMarkdown}>
        <MarkdownPane />
      </div>
    </div>
  {/if}

  {#if dragDepth > 0}
    <div class="overlay">{t.drop.overlay}</div>
  {/if}

  {#if editor.busy}
    <div class="toast" role="status">
      <span class="spinner" aria-hidden="true"></span>
      {editor.busy}
    </div>
  {:else if editor.flash}
    <div class="toast" role="status">{editor.flash}</div>
  {/if}
</div>

<style>
  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  /* 두 판을 정확히 반씩 — 어느 쪽도 "곁다리"로 보이지 않게 한다. */
  .panes.split .pane {
    width: 50%;
  }
  .panes.split .pane + .pane {
    border-left: 1px solid var(--border);
  }
  .pane.hidden {
    display: none;
  }

  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2xs);
    padding: var(--space-lg);
    text-align: center;
    color: var(--text-muted);
  }
  .center h2 {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--text);
  }
  .center p {
    margin: 0;
  }
  .sub {
    font-size: var(--text-sm);
    max-width: 46ch;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    border: 2px dashed var(--accent);
    border-radius: var(--radius-md);
    color: var(--accent-ink);
    font-size: var(--text-lg);
    z-index: var(--z-overlay);
    pointer-events: none;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: var(--space-md);
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-sm);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-2);
    font-size: var(--text-sm);
    z-index: var(--z-toast);
  }

  /* 인쇄에는 원본만 남긴다 — 마크다운 판은 통째로 빠진다. */
  @media print {
    .pane.md {
      display: none;
    }
    .panes.split .pane {
      width: 100%;
      border-left: 0;
    }
    .toast,
    .overlay {
      display: none;
    }
  }
</style>
