<script lang="ts">
  import Icon from "../Icon.svelte";
  import { fmtTime, t } from "../i18n";
  import { downloadBlob, formatBytes } from "../video/save";
  import {
    extractAudio,
    losslessCompatible,
    transcodeMp4,
    type PresetId,
  } from "../video/transcode";
  import {
    editor,
    MAX_TARGET_MB,
    MIN_TARGET_MB,
    RESOLUTION_CHIPS,
  } from "./state.svelte";

  const PRESET_LABELS: Record<PresetId, string> = {
    small: t.panel.presetSmall,
    balanced: t.panel.presetBalanced,
    high: t.panel.presetHigh,
  };

  let filename = $state("video");
  let result = $state<{
    blob: Blob;
    revision: number;
    audioDropped: boolean;
    fmt: string;
    ext: string;
  } | null>(null);
  let status = $state("");

  const stale = $derived(result !== null && result.revision !== editor.revision);
  const FORMAT_LABELS = { mp4: "MP4", webm: "WebM" } as const;
  const fmtLabel = $derived(FORMAT_LABELS[editor.exportFormat]);
  /** 무손실인데 원본 코덱을 선택한 형식에 복사로 못 담는 경우. */
  const losslessRecode = $derived(
    editor.cutMode === "lossless" &&
      editor.meta !== null &&
      !losslessCompatible(editor.meta.videoCodec, editor.exportFormat),
  );

  /** 정확 컷에서 실제로 내보낼 크기 (프리뷰용). */
  const outDims = $derived.by(() => {
    const m = editor.meta;
    if (!m) return null;
    const h = editor.resHeight;
    if (editor.cutMode !== "exact" || !h || h >= m.height)
      return { w: m.width, h: m.height };
    const w = Math.max(2, Math.round(((m.width / m.height) * h) / 2) * 2);
    return { w, h };
  });

  /** 원본보다 작은 해상도 칩만 노출. */
  const resChips = $derived(
    RESOLUTION_CHIPS.filter((h) => (editor.meta ? h < editor.meta.height : false)),
  );

  // 파일이 바뀌면 파일명 기본값·이전 결과를 갱신
  $effect(() => {
    const f = editor.file;
    if (!f) return;
    filename = f.name.replace(/\.[^.]+$/, "") || "video";
    result = null;
    status = "";
  });

  function cleanName(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || "video";
  }

  // ── 인코딩 → 용량 확인 → 저장 ─────────────────────
  async function make() {
    if (!editor.file || !editor.meta || editor.busy) return;
    editor.videoEl?.pause();
    editor.error = "";
    status = "";
    editor.busy = true;
    editor.progress = 0;
    editor.busyMsg = t.panel.encoding(0);
    const revision = editor.revision;
    try {
      const exact = editor.cutMode === "exact";
      const res = await transcodeMp4(editor.file, {
        trim: editor.isTrimmed
          ? { start: editor.trimStart, end: editor.trimEnd }
          : null,
        mode: editor.cutMode,
        container: editor.exportFormat,
        mute: editor.muteAudio,
        preset: editor.preset,
        height: exact ? editor.resHeight : null,
        targetBytes:
          exact && editor.targetEnabled ? editor.targetMB * 1024 * 1024 : null,
        clipDurationS: editor.isTrimmed ? editor.rangeLength : editor.duration,
        sourceWidth: editor.meta.width,
        sourceHeight: editor.meta.height,
        hasAudio: editor.meta.hasAudio,
        onProgress: (p) => {
          editor.progress = p;
          editor.busyMsg = t.panel.encoding(Math.round(p * 100));
        },
        registerCancel: (cancel) => (editor.cancelCurrent = cancel),
      });
      if (res.blob) {
        result = {
          blob: res.blob,
          revision,
          audioDropped: res.audioDropped,
          fmt: fmtLabel,
          ext: editor.exportFormat,
        };
      } else {
        status = t.panel.canceled;
      }
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
      editor.progress = null;
      editor.cancelCurrent = null;
    }
  }

  function saveResult() {
    if (!result) return;
    downloadBlob(result.blob, `${cleanName()}.${result.ext}`);
  }

  // ── 소리만 저장 — 추출 즉시 다운로드 ──────────────
  async function extract() {
    if (!editor.file || !editor.meta || editor.busy) return;
    editor.videoEl?.pause();
    editor.error = "";
    status = "";
    editor.busy = true;
    editor.progress = 0;
    editor.busyMsg = t.panel.extracting;
    try {
      const res = await extractAudio(editor.file, {
        trim: editor.isTrimmed
          ? { start: editor.trimStart, end: editor.trimEnd }
          : null,
        audioCodec: editor.meta.audioCodec,
        onProgress: (p) => (editor.progress = p),
        registerCancel: (cancel) => (editor.cancelCurrent = cancel),
      });
      if (res.blob) {
        downloadBlob(res.blob, `${cleanName()}.${res.ext}`);
        status = t.panel.savedAudio(res.ext.toUpperCase(), formatBytes(res.blob.size));
      } else {
        status = t.panel.canceled;
      }
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
      editor.progress = null;
      editor.cancelCurrent = null;
    }
  }

  function onStartChange(e: Event) {
    editor.setTrimStart(Number((e.target as HTMLInputElement).value));
  }
  function onEndChange(e: Event) {
    editor.setTrimEnd(Number((e.target as HTMLInputElement).value));
  }
  function onTargetMBChange(e: Event) {
    editor.setTargetMB(Number((e.target as HTMLInputElement).value));
  }
</script>

<aside class="panel">
  <!-- 정보 -->
  <section class="sec">
    <h3>{t.panel.info}</h3>
    {#if editor.meta && editor.file}
      <p class="info">
        {t.panel.resolution(editor.meta.width, editor.meta.height)} ·
        {fmtTime(editor.duration)} · {formatBytes(editor.file.size)}
      </p>
    {/if}
  </section>

  <!-- 구간 -->
  <section class="sec">
    <h3>{t.panel.trim}</h3>
    <div class="row">
      <label class="lbl" for="trim-start">{t.panel.trimStart}</label>
      <input
        id="trim-start"
        class="num"
        type="number"
        min="0"
        max={editor.duration}
        step="0.1"
        value={Number(editor.trimStart.toFixed(1))}
        onchange={onStartChange}
      />
    </div>
    <div class="row">
      <label class="lbl" for="trim-end">{t.panel.trimEnd}</label>
      <input
        id="trim-end"
        class="num"
        type="number"
        min="0"
        max={editor.duration}
        step="0.1"
        value={Number(editor.trimEnd.toFixed(1))}
        onchange={onEndChange}
      />
    </div>
    <div class="row">
      <span class="info">{t.panel.trimLength(fmtTime(editor.rangeLength))}</span>
      {#if editor.isTrimmed}
        <button type="button" class="btn small ghost" onclick={() => editor.resetTrim()}>
          {t.panel.trimReset}
        </button>
      {/if}
    </div>
  </section>

  <!-- 컷 방식 -->
  <section class="sec">
    <h3>{t.panel.cutMode}</h3>
    <div class="chips">
      <button
        type="button"
        class="chip"
        class:active={editor.cutMode === "exact"}
        onclick={() => editor.setCutMode("exact")}
      >
        {t.panel.cutExact}
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.cutMode === "lossless"}
        onclick={() => editor.setCutMode("lossless")}
      >
        {t.panel.cutLossless}
      </button>
    </div>
    {#if editor.cutMode === "lossless"}
      <p class="info">{t.panel.losslessNote}</p>
    {/if}
  </section>

  {#if editor.cutMode === "exact"}
    <!-- 화질 -->
    <section class="sec">
      <h3>{t.panel.quality}</h3>
      <div class="chips">
        {#each Object.entries(PRESET_LABELS) as [id, label] (id)}
          <button
            type="button"
            class="chip"
            class:active={editor.preset === id && !editor.targetEnabled}
            onclick={() => {
              editor.setTargetEnabled(false);
              editor.setPreset(id as PresetId);
            }}
          >
            {label}
          </button>
        {/each}
      </div>
      <label class="row checkrow">
        <input
          type="checkbox"
          checked={editor.targetEnabled}
          onchange={(e) => editor.setTargetEnabled((e.target as HTMLInputElement).checked)}
        />
        <span class="lbl">{t.panel.targetSize}</span>
        <input
          class="num"
          type="number"
          min={MIN_TARGET_MB}
          max={MAX_TARGET_MB}
          step="1"
          value={editor.targetMB}
          disabled={!editor.targetEnabled}
          onchange={onTargetMBChange}
          aria-label={t.panel.targetSize}
        />
      </label>
      {#if editor.targetEnabled}
        <p class="info">{t.panel.targetNote}</p>
      {/if}
    </section>

    <!-- 크기 -->
    <section class="sec">
      <h3>{t.panel.size}</h3>
      <div class="chips">
        <button
          type="button"
          class="chip"
          class:active={editor.resHeight === null}
          onclick={() => editor.setResHeight(null)}
        >
          {t.panel.resOriginal}
        </button>
        {#each resChips as h (h)}
          <button
            type="button"
            class="chip"
            class:active={editor.resHeight === h}
            onclick={() => editor.setResHeight(h)}
          >
            {t.panel.resChip(h)}
          </button>
        {/each}
      </div>
      {#if outDims}
        <p class="info">{t.panel.outputSize(outDims.w, outDims.h)}</p>
      {/if}
    </section>
  {/if}

  <!-- 내보내기 -->
  <section class="sec">
    <h3>{t.panel.export}</h3>
    <div class="chips" role="group" aria-label={t.panel.format}>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "mp4"}
        onclick={() => editor.setExportFormat("mp4")}
      >
        MP4
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "webm"}
        onclick={() => editor.setExportFormat("webm")}
      >
        WebM
      </button>
    </div>
    {#if losslessRecode}
      <p class="info">{t.panel.losslessRecode}</p>
    {/if}
    {#if editor.meta?.hasAudio}
      <label class="row checkrow">
        <input
          type="checkbox"
          checked={editor.muteAudio}
          onchange={(e) => editor.setMuteAudio((e.target as HTMLInputElement).checked)}
        />
        <span class="lbl">{t.panel.mute}</span>
      </label>
    {/if}
    <span class="namefield">
      <input
        class="fname"
        bind:value={filename}
        aria-label={t.panel.fileName}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="ext">.{editor.exportFormat}</span>
    </span>

    <button
      type="button"
      class="btn primary"
      onclick={make}
      disabled={editor.busy || !editor.file}
    >
      <Icon name="film" size={15} />
      {result ? t.panel.reEncode : t.panel.encodeAction(fmtLabel)}
    </button>

    {#if result}
      <div class="result" class:stale>
        <p class="result-size">
          {t.panel.resultReady(result.fmt, formatBytes(result.blob.size))}
        </p>
        {#if result.audioDropped}
          <p class="result-note">{t.panel.audioDropped}</p>
        {/if}
        {#if stale}
          <p class="result-note">{t.panel.resultStale}</p>
        {/if}
        <button type="button" class="btn primary" onclick={saveResult} disabled={stale}>
          <Icon name="download" size={15} /> {t.panel.download}
        </button>
      </div>
    {/if}

    {#if editor.meta?.hasAudio}
      <button
        type="button"
        class="btn"
        onclick={extract}
        disabled={editor.busy || !editor.file}
      >
        <Icon name="audio" size={15} /> {t.panel.extractAudio}
      </button>
    {/if}

    {#if status}
      <p class="status">{status}</p>
    {/if}
  </section>
</aside>

<style>
  .panel {
    width: 264px;
    flex: none;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sec {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .sec h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .info {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex: 1;
  }

  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }
  .chip:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }
  .chip.active {
    background: var(--accent-weak);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
  }

  .checkrow {
    cursor: pointer;
  }
  .checkrow input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .lbl {
    font-size: 12.5px;
    color: var(--text-muted);
    flex: 1;
  }
  .num {
    width: 88px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .num:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }
  .btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.small {
    padding: 6px 10px;
    font-size: 12.5px;
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-muted);
    font-weight: 500;
  }
  .btn.ghost:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
    border-color: transparent;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
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
    font-size: 13px;
    padding: 7px 8px;
    flex: 1;
    min-width: 0;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--accent-weak);
  }
  .result.stale {
    border-color: var(--border);
    background: var(--surface-2);
  }
  .result-size {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }
  .result-note {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .status {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-muted);
  }
</style>
