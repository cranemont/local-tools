<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { PdfPasswordError } from "../pdf/engine";
  import { extractPdfText, type ExtractedDoc } from "../pdf/extract";
  import {
    isRangeSyntaxValid,
    RangeSpecError,
    type RangeProblem,
  } from "../pdf/range";
  import {
    formatExt,
    rasterizePdf,
    type RasterFormat,
    type RasterPage,
  } from "../pdf/rasterize";
  import { downloadBlob, saveZip } from "../pdf/save";
  import { unlockPdf } from "../pdf/unlock.svelte";
  import { uniqueNames } from "../pdf/zipnames";

  interface Doc {
    name: string;
    bytes: Uint8Array;
  }
  const docs: Doc[] = [];

  /**
   * 이 탭의 출력 형식. 텍스트는 그림이 아니라 쪽의 텍스트 레이어를 꺼내는 것이라
   * 해상도가 없고 저장 단위도 다르다(쪽마다 한 장 → 문서마다 한 장).
   */
  type OutFormat = RasterFormat | "txt";

  let pages = $state<RasterPage[]>([]);
  let texts = $state<ExtractedDoc[]>([]);
  /** 불러온 문서 수 — 대상 쪽이 하나도 안 걸려 장이 0개일 때도 도구 막대를 지킨다. */
  let docCount = $state(0);
  let format = $state<OutFormat>("png");
  let dpi = $state(144);
  /** "1-5, 8, 12-" 표기. 비우면 전 쪽 — 문서마다 그 쪽수에 맞춰 해석된다. */
  let pageSpec = $state("");
  let busy = $state(false);
  let busyMsg = $state("");
  let error = $state("");
  let status = $state("");
  let dragOver = $state(false);
  let fileInput: HTMLInputElement;
  let zipName = $state<string>(t.toImg.defaultName);
  /**
   * 대상 쪽 표기를 쓸 수 없는 이유. 쪽 수는 문서를 열어야 알 수 있어서 변환 중에도 난다.
   * 입력란 옆 배지로만 알린다 — 상시 노출되는 해설이 아니라 조건부 경고다.
   */
  let rangeProblem = $state<RangeProblem | null>(null);

  const formats: { label: string; value: OutFormat }[] = [
    { label: "PNG", value: "png" },
    { label: "JPG", value: "jpeg" },
    { label: "WebP", value: "webp" },
    { label: "TXT", value: "txt" },
  ];
  // 예전의 배율 1.5·2·3을 dpi로 그대로 옮긴 값(72dpi가 배율 1).
  const dpis = [108, 144, 216];

  const isText = $derived(format === "txt");
  const ext = $derived(format === "txt" ? "txt" : formatExt(format));
  /** 저장될 파일 개수 — 이미지는 쪽마다, 텍스트는 문서마다 한 개다. */
  const outCount = $derived(isText ? texts.length : pages.length);
  const defaultName = $derived(
    isText ? t.toText.defaultName : t.toImg.defaultName,
  );
  const textPageCount = $derived(
    texts.reduce((n, d) => n + d.pages.length, 0),
  );
  const emptyPageCount = $derived(texts.reduce((n, d) => n + d.emptyPages, 0));
  /** 꺼낸 쪽이 전부 비었다 — 스캔 PDF다. 이때는 빈 파일을 내주지 않는다. */
  const allEmpty = $derived(textPageCount > 0 && emptyPageCount === textPageCount);
  const emptyBadge = $derived(
    !isText || emptyPageCount === 0
      ? ""
      : allEmpty
        ? t.toText.noTextBadge
        : t.toText.emptyBadge(emptyPageCount),
  );
  const emptyDetail = $derived(
    allEmpty ? t.toText.noTextDetail : t.toText.emptyDetail,
  );
  const countLabel = $derived(
    isText ? t.toText.pageCount(textPageCount) : t.toImg.pageCount(pages.length),
  );

  const rangeBadge = $derived(
    rangeProblem ? t.errors.rangeBadge[rangeProblem] : "",
  );
  const rangeDetail = $derived(
    rangeProblem === "noPages" ? t.errors.rangeNoPages : t.errors.rangeInvalid,
  );

  function revokeAll() {
    for (const p of pages) URL.revokeObjectURL(p.url);
  }

  async function convertAll() {
    revokeAll();
    pages = [];
    texts = [];
    error = "";
    status = "";
    rangeProblem = null;
    busy = true;
    // 변환 한 번 동안 형식은 고정이다 — 도중에 칩을 눌러도 이 회차는 원래 형식으로 끝난다.
    const fmt = format;
    // 화면에 오르기 전까지는 이 목록만이 object URL의 주인이다 — 중간에 엎어지면
    // 여기서 거둬야 한다. 파일 여러 개를 한 번에 변환할 때 뒤쪽 문서가 대상 쪽을
    // 거부하면 앞쪽 문서의 미리보기가 통째로 버려지는데, 그때 새는 자리였다.
    const allPages: RasterPage[] = [];
    const allTexts: ExtractedDoc[] = [];
    try {
      for (const doc of docs) {
        if (fmt === "txt") {
          const out = await extractDoc(doc);
          if (out) allTexts.push(out);
        } else {
          allPages.push(...(await renderDoc(doc, fmt)));
        }
      }
      pages = allPages;
      texts = allTexts;
    } catch (err) {
      for (const p of allPages) URL.revokeObjectURL(p.url);
      // 대상 쪽 표기가 이 문서에 안 맞으면 한 장도 내지 않는다(편집 탭과 같은 규칙).
      // 이유는 입력란 옆 배지로 — 다른 실패와 섞이면 어디를 고쳐야 하는지 안 보인다.
      if (err instanceof RangeSpecError) rangeProblem = err.problem;
      else error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  /**
   * 문서 하나를 변환한다 — 암호가 걸려 있으면 비밀번호를 물어 풀고 다시 시도한다.
   * 이미지든 텍스트든 이 흐름은 같아서 한 곳에 둔다(취소하면 fallback을 돌려준다).
   */
  async function withUnlock<T>(
    doc: Doc,
    run: (bytes: Uint8Array) => Promise<T>,
    canceled: T,
  ): Promise<T> {
    try {
      return await run(doc.bytes);
    } catch (err) {
      if (!(err instanceof PdfPasswordError)) throw err;
      // 비밀번호 창이 떠 있는 동안에는 진행 오버레이를 걷는다.
      busy = false;
      const unlocked = await unlockPdf(err.fileName, err.bytes, (msg) => {
        busy = msg !== "";
        busyMsg = msg;
      });
      busy = true;
      if (!unlocked) {
        error = t.unlock.canceled(doc.name);
        return canceled;
      }
      // 푼 바이트로 갈아 끼운다 — 형식·해상도를 바꿔 다시 변환할 때 또 묻지 않게.
      doc.bytes = unlocked;
      return await run(doc.bytes);
    }
  }

  function renderDoc(doc: Doc, raster: RasterFormat): Promise<RasterPage[]> {
    const options = { dpi, format: raster, pageSpec };
    return withUnlock(
      doc,
      (bytes) =>
        rasterizePdf(doc.name, bytes, options, (i, total) => {
          busyMsg = t.toImg.rendering(i, total, doc.name);
        }),
      [],
    );
  }

  function extractDoc(doc: Doc): Promise<ExtractedDoc | null> {
    return withUnlock<ExtractedDoc | null>(
      doc,
      (bytes) =>
        extractPdfText(doc.name, bytes, { pageSpec }, (i, total) => {
          busyMsg = t.toText.extracting(i, total, doc.name);
        }),
      null,
    );
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!arr.length) {
      error = t.toImg.onlyPdf;
      return;
    }
    for (const f of arr) {
      docs.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    docCount = docs.length;
    await convertAll();
  }

  function pick() {
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) addFiles(input.files);
    input.value = "";
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragOver = true;
  }
  function onDragLeave() {
    dragOver = false;
  }
  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer.files);
  }

  function setDpi(v: number) {
    if (v === dpi) return;
    dpi = v;
    if (docs.length) convertAll();
  }
  function setFormat(v: OutFormat) {
    if (v === format) return;
    // 기본 이름을 그대로 둔 사람에게는 형식에 맞는 기본 이름을 준다(손댄 이름은 지킨다).
    if (zipName === defaultName) {
      zipName = v === "txt" ? t.toText.defaultName : t.toImg.defaultName;
    }
    format = v;
    if (docs.length) convertAll();
  }
  /** 대상 쪽 표기가 바뀌었을 때(Enter·포커스 아웃) 다시 변환한다. */
  function applyPageSpec() {
    const spec = pageSpec.trim();
    // 먼저 지운다 — 표기가 틀려 여기서 돌아서도 앞서 뜬 다른 오류가 남아 있으면
    // 배지와 배너가 서로 다른 실패를 가리켜 어디를 고쳐야 하는지 흐려진다.
    error = "";
    // 여기서는 쪽 수를 모른다 — 문법만 먼저 걸러 내고, 문서 밖인지는 변환하며 가린다.
    if (spec && !isRangeSyntaxValid(spec)) {
      rangeProblem = "syntax";
      return;
    }
    rangeProblem = null;
    if (docs.length) convertAll();
  }

  async function saveAll() {
    if (outCount === 0) return;
    error = "";
    status = "";
    const base = zipName.replace(/[\\/:*?"<>|]/g, "").trim() || defaultName;
    if (isText) {
      saveTexts(base);
      return;
    }

    // 1장이면 그냥 이미지 다운로드, 여러 장이면 ZIP 하나로 묶는다.
    if (pages.length === 1) {
      downloadBlob(pages[0].blob, `${base}.${ext}`);
      status = t.toImg.savedDl(1);
      return;
    }

    busy = true;
    busyMsg = t.toImg.zipping;
    try {
      // 이름이 같은 PDF 두 개를 함께 넣으면 쪽 이름까지 같아진다 — 비켜 두지 않으면
      // 뒤엣것이 앞엣것을 덮어써서 "N장 저장됨"과 ZIP 속 장 수가 어긋난다.
      const names = uniqueNames(pages.map((p) => p.name));
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < pages.length; i++) {
        files[names[i]] = new Uint8Array(await pages[i].blob.arrayBuffer());
      }
      saveZip(files, `${base}.zip`);
      status = t.toImg.savedZip(pages.length);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  /** 텍스트는 문서마다 .txt 한 장이다 — 쪽마다 한 장이면 200쪽짜리가 200개가 된다. */
  function saveTexts(base: string) {
    if (texts.length === 1) {
      const doc = texts[0];
      const blob = new Blob([doc.text], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, `${base}.txt`);
      status = t.toText.savedDl(doc.pages.length);
      return;
    }
    busy = true;
    busyMsg = t.toImg.zipping;
    try {
      const encoder = new TextEncoder();
      // 문서마다 파일 한 개라 이름이 곧 원본 이름이다 — 같은 이름이 둘이면 그대로
      // 넣었을 때 한 개가 조용히 사라진다(상태 줄은 "파일 2개"라고 적혀 있다).
      const names = uniqueNames(texts.map((d) => d.fileName));
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < texts.length; i++) {
        files[names[i]] = encoder.encode(texts[i].text);
      }
      saveZip(files, `${base}.zip`);
      status = t.toText.savedZip(texts.length);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      busyMsg = "";
    }
  }

  function clearAll() {
    revokeAll();
    pages = [];
    texts = [];
    docs.length = 0;
    docCount = 0;
    error = "";
    status = "";
    rangeProblem = null;
  }
</script>

<div
  class="tool"
  class:dragover={dragOver}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="region"
  aria-label={t.tabs.toImage}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="application/pdf"
    multiple
    hidden
    onchange={onInputChange}
  />

  {#if docCount === 0 && !busy}
    <button type="button" class="dropzone" onclick={pick}>
      <span class="dz-icon"><Icon name="image" size={30} /></span>
      <p class="dz-title">{t.toImg.dropHint}</p>
      <p class="dz-sub">{t.toImg.dropSub}</p>
    </button>
  {:else}
    <div class="toolbar">
      <button type="button" class="btn" onclick={pick}>
        <Icon name="plus" size={15} /> {t.toImg.addPdf}
      </button>
      <span class="sep"></span>
      <span class="qlabel">{t.toImg.format}</span>
      <div class="seg" role="group" aria-label={t.toImg.format}>
        {#each formats as f (f.value)}
          <button
            type="button"
            class="segbtn"
            class:active={format === f.value}
            aria-pressed={format === f.value}
            onclick={() => setFormat(f.value)}
          >
            {f.label}
          </button>
        {/each}
      </div>

      <!-- 텍스트는 그리는 것이 아니라 꺼내는 것이라 해상도가 없다 -->
      {#if !isText}
        <span class="qlabel">{t.toImg.resolution}</span>
        <div class="seg" role="group" aria-label={t.toImg.resolution}>
          {#each dpis as d (d)}
            <button
              type="button"
              class="segbtn"
              class:active={dpi === d}
              aria-pressed={dpi === d}
              onclick={() => setDpi(d)}
            >
              {t.toImg.dpi(d)}
            </button>
          {/each}
        </div>
      {/if}

      <span class="qlabel" id="toimg-pages">{t.toImg.pages}</span>
      <input
        class="range"
        bind:value={pageSpec}
        placeholder={t.toImg.pagesPlaceholder}
        aria-labelledby="toimg-pages"
        aria-invalid={rangeProblem !== null}
        spellcheck="false"
        autocomplete="off"
        onchange={applyPageSpec}
        onkeydown={(e) => {
          if (e.key === "Enter") applyPageSpec();
        }}
      />
      {#if rangeProblem}
        <span class="badge" role="alert" title={rangeDetail}>{rangeBadge}</span>
      {/if}

      <span class="spacer"></span>

      {#if emptyBadge}
        <span class="badge" role="status" title={emptyDetail}>{emptyBadge}</span>
      {/if}
      {#if status}<span class="status">{status}</span>{/if}
      <span class="count">{countLabel}</span>
      <span class="namefield">
        <input
          class="fname"
          bind:value={zipName}
          aria-label={t.toImg.fileName}
          spellcheck="false"
          autocomplete="off"
        />
        <span class="ext">{outCount > 1 ? ".zip" : `.${ext}`}</span>
      </span>
      <button
        type="button"
        class="btn primary"
        onclick={saveAll}
        disabled={outCount === 0 || allEmpty}
        title={allEmpty ? t.toText.noTextDetail : undefined}
      >
        <Icon name="download" size={15} />
        {outCount > 1 ? t.toImg.saveZip : t.toImg.download}
      </button>
    </div>

    {#if isText}
      <div class="textview">
        {#each texts as doc, di (di)}
          {#each doc.pages as p (p.pageIndex)}
            <section class="tpage">
              <div class="tprow">
                <span class="tpname" title={doc.name}>{doc.name}</span>
                <span class="tpno">{t.toText.pageNo(p.pageIndex + 1)}</span>
                {#if p.empty}<span class="badge" title={t.toText.noTextDetail}
                    >{t.toText.pageEmpty}</span
                  >{/if}
              </div>
              {#if p.text}<pre class="tptext">{p.text}</pre>{/if}
            </section>
          {/each}
        {/each}
      </div>
    {:else}
      <div class="grid">
        {#each pages as p (p.id)}
          <div class="card">
            <div class="thumb">
              <img src={p.url} alt={p.name} />
            </div>
            <div class="row">
              <span class="label" title={p.name}>{p.name}</span>
              <button
                type="button"
                class="dl"
                title={t.toImg.download}
                onclick={() => downloadBlob(p.blob, p.name)}
              >
                <Icon name="download" size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="footer-row">
      <button type="button" class="btn ghost danger" onclick={clearAll}>
        <Icon name="x" size={15} /> {t.toImg.clear}
      </button>
    </div>
  {/if}

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  {#if busy}
    <div class="overlay">
      <div class="spinner" aria-hidden="true"></div>
      <p>{busyMsg}</p>
    </div>
  {/if}
</div>

<style>
  .tool {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-radius: var(--radius-lg);
    transition: box-shadow var(--dur-short) var(--ease-out);
  }
  .tool.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  .dropzone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
    padding: 40px;
  }
  .dropzone:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: var(--accent-weak);
  }
  .dz-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-weak);
    color: var(--accent-ink);
  }
  .dz-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--text);
  }
  .dz-sub {
    margin: 0;
    font-size: var(--text-base);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 2px 4px;
  }
  .spacer {
    flex: 1;
  }
  .qlabel {
    font-size: var(--text-md);
    color: var(--text-muted);
  }
  .range {
    width: 120px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-md);
    font-family: inherit;
    padding: var(--space-2xs) var(--space-xs);
  }
  .range:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  .range[aria-invalid="true"] {
    border-color: var(--danger);
  }
  /* 조건부 경고 — 입력란 옆에 붙고 줄바꿈하지 않는다(자세한 사정은 title). */
  .badge {
    flex: none;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--danger);
    border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border-radius: var(--radius-sm);
    padding: var(--space-2xs) var(--space-xs);
  }
  .status {
    font-size: var(--text-md);
    color: var(--accent-ink);
    margin-right: 4px;
  }
  .count {
    font-size: var(--text-md);
    color: var(--text-muted);
    margin-right: 4px;
  }

  .namefield {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    padding-right: 8px;
  }
  .namefield:focus-within {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .fname {
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: var(--text-base);
    padding: 7px 8px;
    width: 110px;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: var(--text-md);
    color: var(--text-muted);
  }

  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .segbtn {
    border: 0;
    background: transparent;
    border-radius: 999px;
    padding: 5px 12px;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-muted);
  }
  .segbtn.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }


  .grid {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* 안쪽 스크롤이 끝에 닿아도 페이지 전체가 딸려 올라가지 않게 한다.
     * 도구 아래 설명(section#intro)으로 스크롤이 넘어가면 화면이 잘린 것처럼 보인다. */
    overscroll-behavior: contain;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
    align-content: start;
    padding: 4px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .thumb {
    aspect-ratio: 3 / 4;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    box-shadow: var(--shadow-1);
    background: #fff;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .label {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dl {
    width: 26px;
    height: 26px;
    flex: none;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dl:hover {
    color: var(--accent-ink);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  /* 텍스트 판 — 이미지 격자와 같은 자리에 들어가고, 스크롤도 안쪽에서 멈춘다. */
  .textview {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-2xs);
  }
  .tpage {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
  }
  .tprow {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .tpname {
    flex: 1;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tpno {
    flex: none;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .tptext {
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    max-height: 320px;
    overflow: auto;
    overscroll-behavior: contain;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .footer-row {
    display: flex;
    justify-content: flex-end;
  }

  .error {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: var(--text-base);
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(2px);
    border-radius: var(--radius-lg);
    color: var(--text-muted);
    font-size: var(--text-lg);
  }
</style>
