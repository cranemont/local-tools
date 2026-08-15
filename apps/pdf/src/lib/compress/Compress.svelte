<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import {
    alreadyUnderTarget,
    attemptBudget,
    chooseSmaller,
    formatBytes,
    rasterStepAt,
    rasterSteps,
    searchTarget,
    sizeReport,
    targetBytesFromMb,
    type RasterStep,
    type SizeReport,
  } from "../pdf/compress";
  import { PdfPasswordError } from "../pdf/engine";
  import { probePdf, type PdfProbe } from "../pdf/extract";
  import {
    ensureQpdfReady,
    isPasswordError,
    recompressArgs,
    runQpdf,
  } from "../pdf/qpdfLoader";
  import { repackAsImages } from "../pdf/repack";
  import { saveBytes } from "../pdf/save";
  import { unlockPdf } from "../pdf/unlock.svelte";

  /**
   * 두 길을 칩으로 갈라 놓는다.
   *  - repack: qpdf가 구조를 다시 쓴다. 글자·글꼴이 남고, 엔진을 받느라 인터넷이 필요하다.
   *  - raster: 쪽을 그림으로 다시 그린다. 오프라인이고 많이 줄지만 글자가 사라진다.
   * 자동으로 고르지 않는 이유는 raster가 되돌릴 수 없어서다 — 글자를 잃는 선택은
   * 사용자가 눌러야 한다. 자동 판정은 경고에만 쓴다(글자 레이어 유무 → 배지).
   */
  type Way = "repack" | "raster";
  /** 그림을 얼마나 다시 압축할지. keep이면 --optimize-images를 아예 안 붙인다. */
  type Images = "keep" | "normal" | "strong";

  /**
   * 일하는 동안을 부모(탭 셸)에게 알린다. 모드 칩은 이 패널 밖에 있어서 진행
   * 오버레이가 덮지 못한다 — 알려 주지 않으면 렌더 도중에 칩을 눌러 나갈 수 있고,
   * 그러면 이 컴포넌트가 사라진 뒤에도 남은 작업이 파일을 내려받는다.
   */
  let { onBusy }: { onBusy?: (busy: boolean) => void } = $props();

  const JPEG_QUALITY: Record<Images, number | null> = {
    keep: null,
    normal: 75,
    strong: 40,
  };

  let file = $state<{ name: string; bytes: Uint8Array } | null>(null);
  let probe = $state<PdfProbe | null>(null);
  let way = $state<Way>("repack");
  let images = $state<Images>("normal");
  let dpi = $state(144);
  let quality = $state(70);
  /** 비우면 목표를 안 쓴다 — 고른 설정으로 한 번만 그린다. */
  let targetMb = $state("");
  let outName = $state("");
  /** 진행 오버레이를 띄울지. */
  let busy = $state(false);
  /**
   * 파일 교체·실행을 막는 잠금. `busy`와 따로 두는 이유는 비밀번호 창이 떠 있는
   * 동안에는 오버레이를 걷어야 하는데(가려서 못 누른다) 그 사이에 다른 파일이
   * 들어오면 앞의 작업이 뒤 파일의 이름으로 저장되기 때문이다.
   */
  let working = $state(false);
  let busyMsg = $state("");
  let error = $state("");
  let status = $state("");
  let report = $state<SizeReport | null>(null);
  /** 목표를 줬는데 사다리 끝까지 가도 못 맞췄다. */
  let missed = $state(false);
  let dragOver = $state(false);
  let fileInput: HTMLInputElement;

  const ways: { id: Way; label: string; hint: string }[] = [
    { id: "repack", label: t.shrink.wayRepack, hint: t.shrink.wayRepackHint },
    { id: "raster", label: t.shrink.wayRaster, hint: t.shrink.wayRasterHint },
  ];
  const imageModes: { id: Images; label: string }[] = [
    { id: "keep", label: t.shrink.imagesKeep },
    { id: "normal", label: t.shrink.imagesNormal },
    { id: "strong", label: t.shrink.imagesStrong },
  ];
  const dpis = [96, 144, 200];
  const qualities = [85, 70, 55];

  const defaultBase = $derived(file ? `${stripExt(file.name)}-small` : "");
  const isRaster = $derived(way === "raster");

  $effect(() => onBusy?.(working));

  function stripExt(name: string): string {
    return name.replace(/\.[^./\\]+$/, "");
  }

  async function setFile(f: File) {
    // 일하는 중에는 파일을 바꾸지 않는다 — 바꾸면 앞 문서의 결과가 뒤 문서의
    // 이름으로 저장되고 화면의 용량 줄도 둘이 섞인다.
    if (working) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      error = t.shrink.onlyPdf;
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    file = { name: f.name, bytes };
    probe = null;
    report = null;
    missed = false;
    outName = "";
    error = "";
    status = "";

    working = true;
    busy = true;
    busyMsg = t.shrink.checking;
    try {
      probe = await probeWithUnlock(f.name, bytes);
      if (!probe) file = null;
    } catch {
      // pdf.js가 던지는 말은 영어다("Invalid PDF structure.") — 화면에는 i18n 문구만 낸다.
      file = null;
      error = t.shrink.openFailed;
    } finally {
      working = false;
      busy = false;
      busyMsg = "";
    }
  }

  /**
   * 문서를 열어 쪽 수와 글자 유무를 잰다. 암호가 걸려 있으면 여기서 한 번 풀어
   * 평문 바이트로 갈아 끼운다 — 그러면 두 압축 경로가 암호를 몰라도 된다.
   */
  async function probeWithUnlock(
    name: string,
    bytes: Uint8Array,
  ): Promise<PdfProbe | null> {
    try {
      return await probePdf(name, bytes);
    } catch (err) {
      if (!(err instanceof PdfPasswordError)) throw err;
      // 비밀번호 창이 떠 있는 동안에는 진행 오버레이를 걷는다.
      busy = false;
      const unlocked = await unlockPdf(err.fileName, err.bytes, (msg) => {
        busy = msg !== "";
        busyMsg = msg;
      });
      busy = true;
      busyMsg = t.shrink.checking;
      if (!unlocked) {
        error = t.shrink.canceled;
        return null;
      }
      file = { name, bytes: unlocked };
      return await probePdf(name, unlocked);
    }
  }

  function pick() {
    if (working) return;
    fileInput.click();
  }
  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) setFile(input.files[0]);
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
    if (!e.dataTransfer?.files[0]) return;
    e.preventDefault();
    dragOver = false;
    setFile(e.dataTransfer.files[0]);
  }

  async function run() {
    const doc = file;
    if (!doc || !probe || working) return;
    // 저장 이름은 시작한 문서에서 정한다 — 끝날 때 `file`을 읽으면 도중에 바뀐
    // 파일 이름이 붙는다(앞 문서의 결과가 뒤 문서의 이름으로 저장됐다).
    const base = `${stripExt(doc.name)}-small`;
    working = true;
    busy = true;
    error = "";
    status = "";
    report = null;
    missed = false;
    try {
      const made = isRaster ? await runRaster(doc) : await runRepack(doc);
      if (!made) return; // 이미 목표 아래이거나, 짚어 본 것이 없다
      const choice = chooseSmaller(
        { bytes: doc.bytes.length, data: doc.bytes },
        made,
      );
      report = choice.report;
      const clean = outName.replace(/[\\/:*?"<>|]/g, "").trim();
      saveBytes(choice.data, `${clean || base}.pdf`);
      status = choice.keptOriginal ? t.shrink.noGain : t.shrink.done;
    } catch (err) {
      // 암호는 파일을 떨어뜨릴 때 이미 풀지만, 소유자 권한만 걸린 문서는 pdf.js가
      // 열어 주고 qpdf가 거부한다 — 그때 다음 할 일을 말해 준다.
      if (isPasswordError(err)) error = t.shrink.encrypted;
      else error = err instanceof Error ? err.message : String(err);
    } finally {
      working = false;
      busy = false;
      busyMsg = "";
    }
  }

  async function runRepack(doc: { name: string; bytes: Uint8Array }) {
    busyMsg = t.shrink.preparing;
    await ensureQpdfReady();
    busyMsg = t.shrink.processing;
    const out = await runQpdf(
      doc.bytes,
      recompressArgs(JPEG_QUALITY[images]),
      t.shrink.failed,
    );
    return { bytes: out.length, data: out };
  }

  /**
   * 목표 용량을 주면 사다리를 짚어 가며 그 아래로 내려간다. 한 번의 시도가 문서 전체
   * 렌더라서 시도 횟수는 쪽 수로 깎는다(compress.ts의 attemptBudget).
   */
  async function runRaster(doc: { name: string; bytes: Uint8Array }) {
    const cap: RasterStep = { dpi, quality };
    const target = targetBytesFromMb(targetMb);

    if (target === null) {
      const out = await render(doc, cap, 0, 0);
      return { bytes: out.length, data: out };
    }
    if (alreadyUnderTarget(doc.bytes.length, target)) {
      report = sizeReport(doc.bytes.length, doc.bytes.length);
      status = t.shrink.underTarget;
      return null;
    }

    const max = attemptBudget(probe?.pageCount ?? 1);
    let tried = 0;
    const hit = await searchTarget(
      { targetBytes: target, min: 0, max: rasterSteps(cap) - 1, maxAttempts: max },
      async (value) => {
        tried += 1;
        const out = await render(doc, rasterStepAt(value, cap), tried, max);
        return { bytes: out.length, result: out };
      },
    );
    if (!hit) return null;
    missed = !hit.met;
    return { bytes: hit.bytes, data: hit.result };
  }

  function render(
    doc: { name: string; bytes: Uint8Array },
    step: RasterStep,
    n: number,
    max: number,
  ): Promise<Uint8Array> {
    return repackAsImages(doc.name, doc.bytes, step, (i, total) => {
      busyMsg =
        max > 1
          ? t.shrink.renderingTry(i, total, n, max)
          : t.shrink.rendering(i, total);
    });
  }

  /** 설정을 바꾸면 앞서 보여 준 결과는 그 설정의 것이 아니다 — 지운다. */
  function reset() {
    report = null;
    missed = false;
    status = "";
  }
</script>

<div
  class="tool"
  class:dragover={dragOver}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="region"
  aria-label={t.shrink.mode}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="application/pdf"
    hidden
    onchange={onInputChange}
  />

  <div class="panel">
    {#if !file}
      <button type="button" class="dropzone" onclick={pick}>
        <span class="dz-icon"><Icon name="shrink" size={28} /></span>
        <p class="dz-title">{t.shrink.dropHint}</p>
        <p class="dz-sub">{t.shrink.dropSub}</p>
      </button>
    {:else}
      <div class="filechip">
        <Icon name="merge" size={16} />
        <span class="fname" title={file.name}>{file.name}</span>
        <span class="fsize">{formatBytes(file.bytes.length)}</span>
        <button type="button" class="link" onclick={pick} disabled={working}>
          {t.shrink.change}
        </button>
      </div>

      <div class="row">
        <span class="rlabel">{t.shrink.way}</span>
        <div class="seg" role="group" aria-label={t.shrink.way}>
          {#each ways as w (w.id)}
            <button
              type="button"
              class="segbtn"
              class:active={way === w.id}
              aria-pressed={way === w.id}
              title={w.hint}
              onclick={() => {
                way = w.id;
                reset();
              }}
            >
              {w.label}
            </button>
          {/each}
        </div>
        {#if !isRaster}
          <span class="badge" title={t.shrink.netDetail}>{t.shrink.netBadge}</span>
        {:else if probe?.hasText}
          <span class="badge warn" title={t.shrink.textDetail}>
            {t.shrink.textBadge}
          </span>
        {:else if probe}
          <span class="badge" title={t.shrink.scanDetail}>{t.shrink.scanBadge}</span>
        {/if}
      </div>

      {#if !isRaster}
        <div class="row">
          <span class="rlabel">{t.shrink.images}</span>
          <div class="seg" role="group" aria-label={t.shrink.images}>
            {#each imageModes as m (m.id)}
              <button
                type="button"
                class="segbtn"
                class:active={images === m.id}
                aria-pressed={images === m.id}
                onclick={() => {
                  images = m.id;
                  reset();
                }}
              >
                {m.label}
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="row">
          <span class="rlabel">{t.shrink.resolution}</span>
          <div class="seg" role="group" aria-label={t.shrink.resolution}>
            {#each dpis as d (d)}
              <button
                type="button"
                class="segbtn"
                class:active={dpi === d}
                aria-pressed={dpi === d}
                onclick={() => {
                  dpi = d;
                  reset();
                }}
              >
                {t.shrink.dpi(d)}
              </button>
            {/each}
          </div>
        </div>
        <div class="row">
          <span class="rlabel">{t.shrink.quality}</span>
          <div class="seg" role="group" aria-label={t.shrink.quality}>
            {#each qualities as q (q)}
              <button
                type="button"
                class="segbtn"
                class:active={quality === q}
                aria-pressed={quality === q}
                onclick={() => {
                  quality = q;
                  reset();
                }}
              >
                {q}
              </button>
            {/each}
          </div>
        </div>
        <div class="row">
          <span class="rlabel" id="shrink-target">{t.shrink.target}</span>
          <input
            class="target"
            bind:value={targetMb}
            placeholder={t.shrink.targetPlaceholder}
            aria-labelledby="shrink-target"
            inputmode="decimal"
            spellcheck="false"
            autocomplete="off"
            onchange={reset}
          />
          {#if missed}
            <span class="badge warn" role="status" title={t.shrink.missedDetail}>
              {t.shrink.missedBadge}
            </span>
          {/if}
        </div>
      {/if}

      <label class="field">
        <span class="flabel">{t.shrink.fileName}</span>
        <input
          type="text"
          bind:value={outName}
          placeholder={defaultBase}
          spellcheck="false"
          autocomplete="off"
        />
      </label>

      <button
        type="button"
        class="btn primary large run"
        onclick={run}
        disabled={working || !probe}
      >
        <Icon name="shrink" size={15} />
        {t.shrink.run}
      </button>

      {#if report}
        <p class="result">
          {report.percent === null
            ? t.shrink.resultSame(formatBytes(report.originalBytes))
            : t.shrink.result(
                formatBytes(report.originalBytes),
                formatBytes(report.resultBytes),
                report.percent,
              )}
        </p>
      {/if}
      {#if status}<p class="ok">{status}</p>{/if}
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>

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
    align-items: flex-start;
    justify-content: center;
    border-radius: var(--radius-lg);
    transition: box-shadow var(--dur-short) var(--ease-out);
    overflow: auto;
  }
  .tool.dragover {
    box-shadow: 0 0 0 3px var(--accent) inset;
  }

  .panel {
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 200px;
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
    padding: 32px;
  }
  .dropzone:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: var(--accent-weak);
  }
  .dz-icon {
    width: 52px;
    height: 52px;
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

  .filechip {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-lg);
  }
  .fname {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fsize {
    flex: none;
    font-size: var(--text-md);
    color: var(--text-muted);
  }
  .link {
    flex: none;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .rlabel {
    flex: none;
    width: 4.5rem;
    font-size: var(--text-md);
    color: var(--text-muted);
    font-weight: 600;
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
    padding: 5px 14px;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-muted);
  }
  .segbtn.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }

  .target {
    width: 5.5rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-md);
    font-family: inherit;
    padding: var(--space-2xs) var(--space-xs);
  }
  .target:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  /* 조건부 경고만 여기 붙는다 — 해설 문단 대신 배지 하나와 title이다. */
  .badge {
    flex: none;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: var(--space-2xs) var(--space-xs);
  }
  .badge.warn {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flabel {
    font-size: var(--text-md);
    color: var(--text-muted);
    font-weight: 600;
  }
  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-xl);
    font-family: inherit;
  }
  .field input:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .result {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .ok {
    margin: 0;
    font-size: var(--text-base);
    color: var(--accent-ink);
  }
  .error {
    margin: 0;
    padding: 10px 12px;
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
    text-align: center;
    padding: 20px;
  }
</style>
