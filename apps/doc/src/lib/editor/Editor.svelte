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
  let dragging = $state(false);
  let narrow = $state(false);

  // 좁은 화면에서 두 판을 우겨넣으면 둘 다 못 읽는다 — 한 판만 남긴다.
  $effect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const apply = (): void => {
      narrow = query.matches;
      if (query.matches && view === "both") view = "original";
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  });

  const effectiveView = $derived<PaneView>(narrow && view === "both" ? "original" : view);

  function openFile(file: File): void {
    void editor.open(file);
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) openFile(file);
  }

  function onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragging = true;
  }

  /**
   * 스크롤 맞춤 — 비율 근사다. 문단 단위로 정확히 잇는 것은 엔진의 문단 인덱스와
   * 마크다운 출력 위치를 엮어야 해서 비싸고, 표가 끼면 어차피 어긋난다.
   * 그래서 "대충 같은 데를 보고 있다"까지만 한다. 끄고 볼 수도 있게 두었다.
   */
  let syncing = false;
  function onScroll(event: Event): void {
    if (!sync || effectiveView !== "both" || syncing) return;
    const from = event.currentTarget as HTMLElement;
    const other = from.dataset.pane === "original" ? markdownEl : pagesEl;
    if (!other) return;

    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    syncing = true;
    other.scrollTop = ratio * Math.max(0, other.scrollHeight - other.clientHeight);
    requestAnimationFrame(() => {
      syncing = false;
    });
  }

  let root = $state<HTMLDivElement | null>(null);
  let pagesEl = $state<HTMLElement | null>(null);
  let markdownEl = $state<HTMLElement | null>(null);

  // 자식이 만든 스크롤 상자를 잡아 둔다(두 판 모두 자기 컴포넌트 안에 있다).
  $effect(() => {
    editor.stage;
    effectiveView;
    pagesEl = root?.querySelector<HTMLElement>('[data-pane="original"]') ?? null;
    markdownEl = root?.querySelector<HTMLElement>('[data-pane="markdown"]') ?? null;
  });

  // 저장 알림은 잠깐만 띄운다.
  $effect(() => {
    if (!editor.flash) return;
    const timer = setTimeout(() => (editor.flash = null), 4000);
    return () => clearTimeout(timer);
  });
</script>

<svelte:window
  ondragover={onDragOver}
  ondrop={onDrop}
  ondragleave={() => (dragging = false)}
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
      setView={(next) => (view = next)}
      {sync}
      toggleSync={() => (sync = !sync)}
      toggleFind={() => (finding = !finding)}
    />
    {#if finding && editor.kind !== "docx"}
      <FindBar close={() => (finding = false)} />
    {/if}

    <div class="panes" class:split={effectiveView === "both"} onscrollcapture={onScroll}>
      {#if effectiveView !== "markdown"}
        <Pages />
      {/if}
      {#if effectiveView !== "original"}
        <MarkdownPane />
      {/if}
    </div>
  {/if}

  {#if dragging}
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
  /* 두 판을 정확히 반씩 — 어느 쪽도 "곁다리"로 보이지 않게 한다. */
  .panes.split > :global(*) {
    width: 50%;
    min-width: 0;
  }
  .panes.split > :global(* + *) {
    border-left: 1px solid var(--border);
  }
  .panes > :global(*) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
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

  @media print {
    .panes.split > :global(*) {
      width: 100%;
      border-left: 0;
    }
    .toast,
    .overlay {
      display: none;
    }
  }
</style>
