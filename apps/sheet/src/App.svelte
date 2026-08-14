<script lang="ts">
  import Icon from "./lib/Icon.svelte";
  import ThemeToggle from "./lib/ThemeToggle.svelte";
  import Dropdown from "./lib/editor/Dropdown.svelte";
  import FindBar from "./lib/editor/FindBar.svelte";
  import FormulaBar from "./lib/editor/FormulaBar.svelte";
  import Grid from "./lib/editor/Grid.svelte";
  import SheetTabs from "./lib/editor/SheetTabs.svelte";
  import StatusBar from "./lib/editor/StatusBar.svelte";
  import Toolbar from "./lib/editor/Toolbar.svelte";
  import { editor } from "./lib/editor/state.svelte";
  import { captureInstallPrompt, isInstalled, onFileLaunch } from "./lib/launch";
  import { t } from "./lib/i18n";

  const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.json";

  let fileInput = $state<HTMLInputElement | null>(null);
  let grid = $state<ReturnType<typeof Grid> | null>(null);
  let dragDepth = $state(0);
  let showFind = $state(false);
  let install = $state<(() => Promise<boolean>) | null>(null);
  let installDismissed = $state(false);

  onFileLaunch((file) => void editor.openFile(file));
  captureInstallPrompt((show) => {
    if (!isInstalled()) install = show;
  });

  function pick(): void {
    fileInput?.click();
  }

  function onPicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void editor.openFile(file);
    input.value = "";
  }

  function onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth++;
  }

  function onDragLeave(): void {
    dragDepth = Math.max(0, dragDepth - 1);
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragDepth = 0;
    const file = event.dataTransfer?.files?.[0];
    if (file) void editor.openFile(file);
  }

  function closeFile(): void {
    if (editor.dirty && !confirm(`${t.file.unsavedTitle}\n${t.file.unsavedBody}`)) return;
    editor.closeBook();
  }

  /** 편집분은 오직 메모리에만 있다 — 새로고침·창 닫기 전에 브라우저가 한 번 묻게 한다. */
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!editor.dirty) return;
    event.preventDefault();
  }

  /** 로고(홈 링크)도 페이지를 떠난다. 닫기 버튼과 같은 확인을 받는다. */
  function onLeave(event: MouseEvent): void {
    if (!editor.dirty) return;
    if (!confirm(`${t.file.unsavedTitle}\n${t.file.unsavedBody}`)) event.preventDefault();
  }

  /** 표 전체 단축키. 편집 중이거나 입력란에 있을 때는 브라우저 기본 동작에 양보한다. */
  function onKeyDown(event: KeyboardEvent): void {
    if (!editor.hasFile) return;

    const target = event.target as HTMLElement | null;
    // 선택 상자도 방향키·글자키를 자기 것으로 쓴다(정렬 기준 고르기) — 여기서 가로채면
    // 목록이 안 넘어가고 커서만 움직인다.
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true;

    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === "f") {
      event.preventDefault();
      showFind = true;
      return;
    }
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
      return;
    }

    if (typing) return;

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
    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void editor.copy();
      return;
    }
    if (mod && event.key.toLowerCase() === "x") {
      event.preventDefault();
      void editor.cut();
      return;
    }
    if (mod && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void editor.paste();
      return;
    }
    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      editor.selectAll();
      return;
    }
    if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      editor.fillDown();
      return;
    }
    if (mod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      editor.toggleFormat("bold");
      return;
    }
    if (mod && event.key.toLowerCase() === "i") {
      event.preventDefault();
      editor.toggleFormat("italic");
      return;
    }
    if (mod && event.key.toLowerCase() === "u") {
      event.preventDefault();
      editor.toggleFormat("underline");
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        if (mod) editor.jump(-1, 0, event.shiftKey);
        else editor.move(-1, 0, event.shiftKey);
        return;
      case "ArrowDown":
        event.preventDefault();
        if (mod) editor.jump(1, 0, event.shiftKey);
        else editor.move(1, 0, event.shiftKey);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (mod) editor.jump(0, -1, event.shiftKey);
        else editor.move(0, -1, event.shiftKey);
        return;
      case "ArrowRight":
        event.preventDefault();
        if (mod) editor.jump(0, 1, event.shiftKey);
        else editor.move(0, 1, event.shiftKey);
        return;
      case "Tab":
        event.preventDefault();
        editor.move(0, event.shiftKey ? -1 : 1);
        return;
      case "Enter":
        event.preventDefault();
        editor.beginEdit();
        return;
      case "F2":
        event.preventDefault();
        editor.beginEdit();
        return;
      case "Backspace":
      case "Delete":
        event.preventDefault();
        editor.clearSelection();
        return;
      case "Home":
        event.preventDefault();
        editor.select(editor.cursor.row, 0, event.shiftKey);
        return;
      case "PageDown":
        event.preventDefault();
        editor.move(24, 0, event.shiftKey);
        return;
      case "PageUp":
        event.preventDefault();
        editor.move(-24, 0, event.shiftKey);
        return;
      case "Escape":
        event.preventDefault();
        showFind = false;
        return;
    }

    // 글자 하나를 치면 바로 편집이 시작된다(엑셀과 같은 감각).
    if (!mod && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      editor.beginEdit(event.key);
    }
  }

  function save(): void {
    if (editor.book.origin === "xlsx") void editor.saveXlsx();
    else editor.saveCsv();
  }

  async function doInstall(): Promise<void> {
    const show = install;
    if (!show) return;
    await show();
    install = null;
  }
</script>

<svelte:window onkeydown={onKeyDown} onbeforeunload={onBeforeUnload} />

<svelte:body ondragenter={onDragEnter} ondragleave={onDragLeave} ondragover={(e) => e.preventDefault()} ondrop={onDrop} />

<div class="app">
  <header class="bar">
    <a class="brand" href="../" onclick={onLeave}>
      <Icon name="table" size={17} />
      <span class="name">{t.brandName}</span>
      <span class="tool">{t.appName}</span>
    </a>

    {#if editor.hasFile}
      <span class="filename" title={editor.filename}>
        {editor.filename}{editor.dirty ? " •" : ""}
      </span>
    {/if}

    <span class="spacer"></span>

    {#if editor.hasFile}
      <Dropdown title={t.save.label} label={t.save.label} icon="download" wide>
        {#snippet children(close)}
          <button class="item" onclick={() => { editor.saveCsv(","); close(); }}>
            {t.save.csv}<span class="trail">.csv</span>
          </button>
          <button class="item" onclick={() => { editor.saveCsv("\t"); close(); }}>
            {t.save.tsv}<span class="trail">.tsv</span>
          </button>
          <button class="item" onclick={() => { void editor.saveXlsx(); close(); }}>
            {t.save.xlsx}<span class="trail">.xlsx</span>
          </button>
          <button class="item" onclick={() => { editor.saveJson(); close(); }}>
            {t.save.json}<span class="trail">.json</span>
          </button>
          <span class="sep"></span>
          <button class="item" onclick={() => { void editor.copyAs("markdown"); close(); }}>
            {t.save.markdown}
          </button>
          <button class="item" onclick={() => { void editor.copyAs("html"); close(); }}>
            {t.save.html}
          </button>
          <span class="sep"></span>
          <span class="group-label">{t.save.options}</span>
          <label class="item check">
            <input type="checkbox" bind:checked={editor.csvOptions.bom} />
            {t.save.bom}
          </label>
          <label class="item check">
            <input type="checkbox" bind:checked={editor.csvOptions.formulas} />
            {t.save.formulas}
          </label>
          <label class="item check">
            <input type="checkbox" bind:checked={editor.exportHeader} />
            {t.save.header}
          </label>
        {/snippet}
      </Dropdown>

      <button class="btn small ghost" onclick={pick}>{t.drop.open}</button>
      <button class="btn small ghost" onclick={closeFile}>{t.file.close}</button>
    {/if}

    <ThemeToggle />
  </header>

  {#if install && !installDismissed}
    <div class="install">
      <span>{t.install.hint}</span>
      <button class="btn small primary" onclick={doInstall}>{t.install.action}</button>
      <button class="btn small ghost" onclick={() => (installDismissed = true)}>
        {t.install.dismiss}
      </button>
    </div>
  {/if}

  {#if editor.error}
    <div class="error" role="alert">
      {editor.error}
      <button class="icon-btn" onclick={() => (editor.error = "")}>
        <Icon name="x" size={13} />
        <span class="sr-only">{t.file.close}</span>
      </button>
    </div>
  {/if}

  {#if !editor.hasFile}
    <main class="empty">
      <button class="dropzone" onclick={pick}>
        <Icon name="sheet" size={40} />
        <span class="hint">{t.drop.hint}</span>
        <span class="sub">{t.drop.sub}</span>
      </button>
      <button class="btn" onclick={() => editor.newBook()}>{t.drop.blank}</button>
    </main>
  {:else}
    <Toolbar onFind={() => (showFind = true)} />
    {#if showFind}
      <FindBar onClose={() => { showFind = false; grid?.focus(); }} />
    {/if}
    <FormulaBar onDone={() => grid?.focus()} />
    <main class="sheet">
      <Grid bind:this={grid} />
    </main>
    <SheetTabs />
    <StatusBar />
  {/if}

  {#if editor.busy}
    <div class="busy" role="status">
      <span class="spinner"></span>
      <span>{editor.busyMsg}</span>
    </div>
  {/if}

  {#if dragDepth > 0}
    <div class="overlay">
      <span>{t.drop.overlay}</span>
    </div>
  {/if}
</div>

<input
  class="sr-only"
  type="file"
  accept={ACCEPT}
  bind:this={fileInput}
  onchange={onPicked}
  tabindex="-1"
/>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    /* 세로로는 절대 넘치지 않는다 — 넘치면 시트 탭과 상태줄이 화면 밖으로 밀려
     * 잘린 채로 보인다(설치 안내 띠가 떴을 때 실제로 그랬다). */
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--text);
    text-decoration: none;
  }
  .brand .name {
    font-weight: 700;
    font-size: var(--text-xl);
  }
  .brand .tool {
    color: var(--text-muted);
    font-size: var(--text-xl);
  }
  .brand:hover .tool {
    color: var(--accent-ink);
  }

  .filename {
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: var(--space-md);
    border-left: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  .spacer {
    flex: 1;
  }

  .install {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    background: var(--accent-weak);
    color: var(--accent-ink);
    font-size: var(--text-base);
  }

  .error {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: var(--text-base);
  }
  .error .icon-btn {
    margin-left: auto;
    color: inherit;
    border-color: currentColor;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-lg);
    padding: var(--space-2xl);
  }

  .dropzone {
    all: unset;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    width: min(520px, 100%);
    padding: var(--space-5xl) var(--space-2xl);
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    color: var(--text-muted);
    text-align: center;
    cursor: pointer;
    transition: border-color var(--dur-short) var(--ease-out);
  }
  .dropzone:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .dropzone:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .dropzone .hint {
    font-size: var(--text-2xl);
    color: var(--text);
  }
  .dropzone .sub {
    font-size: var(--text-base);
  }

  /* 표만 늘었다 줄었다 한다. 그리드는 이 상자에 절대 배치로 갇혀서,
   * 안쪽 내용이 아무리 커도 바깥 높이를 밀지 못한다. */
  .sheet {
    position: relative;
    flex: 1;
    min-height: 120px;
  }

  .bar,
  .install,
  .error {
    flex: none;
  }

  .busy {
    position: fixed;
    inset: auto var(--space-lg) var(--space-3xl) auto;
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-lg);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    box-shadow: var(--shadow-2);
    font-size: var(--text-base);
  }
  .busy .spinner {
    width: 18px;
    height: 18px;
    border-width: 2px;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    border: 3px dashed var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-4xl);
    pointer-events: none;
  }

  /* 저장 메뉴 안의 체크 항목 — Dropdown이 :global로 .item을 꾸민다. */
  :global(.item.check) {
    cursor: pointer;
  }
  :global(.item.check input) {
    accent-color: var(--accent);
  }
</style>
