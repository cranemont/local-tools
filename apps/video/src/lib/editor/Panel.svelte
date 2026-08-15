<script lang="ts">
  import type { AudioCodec } from "mediabunny";
  import Icon from "../Icon.svelte";
  import { fmtTime, t } from "../i18n";
  import { concatSegments, containerAcceptsAudio } from "../video/concat";
  import { probeVideo, type VideoMeta } from "../video/probe";
  import { downloadBlob, formatBytes } from "../video/save";
  import {
    checkLosslessConcat,
    hasOverlap,
    isOutOfOrder,
    overallProgress,
    segmentLength,
    segmentWeights,
    totalLength,
    type Segment,
  } from "../video/segments";
  import {
    audioFormatCodec,
    AUDIO_FORMAT_IDS,
    combineRotation,
    encodableAudioCodecs,
    extractAudio,
    isLosslessAudioCodec,
    losslessCompatible,
    rotatedSize,
    rotationBreaksCopy,
    transcodeMp4,
    trimStartBreaksCopy,
    type AudioFormatId,
    type PresetId,
    type TranscodeOptions,
  } from "../video/transcode";
  import {
    editor,
    MAX_BITRATE_KBPS,
    MAX_FPS,
    MAX_TARGET_MB,
    MIN_BITRATE_KBPS,
    MIN_FPS,
    MIN_TARGET_MB,
    RESOLUTION_CHIPS,
  } from "./state.svelte";

  const PRESET_LABELS: Record<PresetId, string> = {
    small: t.panel.presetSmall,
    balanced: t.panel.presetBalanced,
    high: t.panel.presetHigh,
  };
  const AUDIO_FORMAT_LABELS: Record<AudioFormatId, string> = {
    auto: t.panel.audioAuto,
    m4a: "M4A",
    mp3: "MP3",
    ogg: "OGG",
    wav: "WAV",
    flac: "FLAC",
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
  /** 소리만 저장의 결과 — 내보내기 결과와 다른 자리에 뜬다. */
  let audioStatus = $state("");

  const stale = $derived(result !== null && result.revision !== editor.revision);
  const FORMAT_LABELS = { mp4: "MP4", webm: "WebM" } as const;
  const fmtLabel = $derived(FORMAT_LABELS[editor.exportFormat]);

  /** 회전을 반영한 원본 크기 — 리사이즈·칩 판정의 기준. */
  const srcDims = $derived.by(() => {
    const m = editor.meta;
    return m ? rotatedSize(m.width, m.height, editor.rotate) : null;
  });

  /** 정확 컷에서 실제로 내보낼 크기 (프리뷰용). */
  const outDims = $derived.by(() => {
    const s = srcDims;
    if (!s) return null;
    const h = editor.resHeight;
    if (editor.cutMode !== "exact" || !h || h >= s.h) return { w: s.w, h: s.h };
    const w = Math.max(2, Math.round(((s.w / s.h) * h) / 2) * 2);
    return { w, h };
  });

  // ── 구간 목록 ─────────────────────────────────────
  /** 내보내기가 실제로 쓰는 목록 — 경계 clamp·최소 길이 미만 제거를 거친 값. */
  const exportSegs = $derived(editor.exportSegments());
  const joining = $derived(exportSegs.length > 1 && editor.exportMode === "join");
  const overlapping = $derived(hasOverlap(editor.segments));
  const reordered = $derived(isOutOfOrder(editor.segments));

  // ── "무손실"이라 적어 놓고 실제로는 굽는 경우 ─────
  // 조건이 참일 때만 배지로 뜬다. 화면과 산출물이 어긋나지 않게 하는 것이 전부다.
  /** 원본 코덱을 고른 컨테이너에 못 담아 재인코딩되는가. */
  const videoCodecFits = $derived(
    editor.meta !== null &&
      losslessCompatible(editor.meta.videoCodec, editor.exportFormat),
  );
  /**
   * 파일에 적힌 회전 + 사용자가 더한 회전. 복사 판정은 이 합을 본다 — 세로로 찍은 영상은
   * 회전을 안 걸어도 90이 적혀 있고, 그 값도 WebM에서는 픽셀에 구워야 한다.
   */
  const totalRotate = $derived(
    combineRotation(editor.meta?.rotation ?? 0, editor.rotate),
  );
  /** 회전이 패킷 복사를 깨는가 (WebM은 회전 메타데이터를 안 쓴다). */
  const rotateBreaksCopy = $derived(
    editor.cutMode === "lossless" &&
      rotationBreaksCopy(totalRotate, editor.exportFormat),
  );
  /** 이어붙이기를 패킷 복사로 끝낼 수 있는가. */
  const losslessCheck = $derived(
    checkLosslessConcat({
      segments: exportSegs,
      keyframes: editor.keyframes,
      videoCodecFits,
      audioCodecFits:
        editor.muteAudio ||
        containerAcceptsAudio(editor.meta?.audioCodec ?? null, editor.exportFormat),
      rotationBreaksCopy: rotationBreaksCopy(totalRotate, editor.exportFormat),
    }),
  );
  /** 이어붙이기가 복사로 끝나는가 — 엔진 분기와 배지가 같은 값을 본다. */
  const joinCopies = $derived(
    joining && editor.cutMode === "lossless" && losslessCheck.copies,
  );
  /**
   * "무손실"인데 재인코딩되는 이유. null이면 배지를 띄우지 않는다.
   * 이어붙이기는 concat.ts가 패킷을 직접 옮기므로 키프레임만 맞으면 복사가 된다.
   * 나머지 경로는 mediabunny Conversion이 맡는데, 시작을 자른 순간 복사가 꺼진다.
   */
  const recodeWhy = $derived.by(() => {
    if (editor.cutMode !== "lossless" || !editor.meta) return null;
    if (!videoCodecFits) return t.panel.badgeRecodeWhy;
    if (rotateBreaksCopy) return t.panel.badgeRotateRecodeWhy;
    if (joining) {
      if (losslessCheck.copies) return null;
      if (editor.keyframes.length === 0) return t.panel.badgeKeyframeScanWhy;
      if (losslessCheck.misaligned.length > 0) return t.panel.badgeKeyframeWhy;
      // 남는 조건은 소리뿐이다 — 컨테이너가 원본 오디오 코덱을 못 담는다.
      return t.panel.badgeAudioRecodeWhy;
    }
    return exportSegs.some((s) => trimStartBreaksCopy(s.start))
      ? t.panel.badgeTrimRecodeWhy
      : null;
  });

  /** 원본보다 작은 해상도 칩만 노출. */
  const resChips = $derived(
    RESOLUTION_CHIPS.filter((h) => (srcDims ? h < srcDims.h : false)),
  );

  const fpsPlaceholder = $derived(
    editor.meta?.fps ? t.panel.sourceFps(Math.round(editor.meta.fps)) : t.panel.auto,
  );

  // ── 소리 형식 — 브라우저가 인코딩할 수 있는 것만 고르게 한다 ──
  let encodableAudio = $state<Set<AudioCodec> | null>(null);
  $effect(() => {
    void encodableAudioCodecs().then((set) => (encodableAudio = set));
  });

  const audioFormats = $derived.by(() => {
    const src = editor.meta?.audioCodec ?? null;
    const enc = encodableAudio;
    return AUDIO_FORMAT_IDS.filter((id) => {
      if (id === "auto") return true;
      const codec = audioFormatCodec(id, src);
      // 원본과 같은 코덱이면 인코더 없이 복사만으로도 담긴다.
      return codec === src || (enc === null || enc.has(codec));
    });
  });
  $effect(() => {
    if (!audioFormats.includes(editor.audioFormat)) editor.setAudioFormat("auto");
  });

  const audioOutCodec = $derived(
    audioFormatCodec(editor.audioFormat, editor.meta?.audioCodec ?? null),
  );
  /** 재인코딩이 가능한 코덱일 때만 비트레이트·채널을 만질 수 있다. */
  const audioCanTweak = $derived(encodableAudio?.has(audioOutCodec) ?? false);
  const audioBitrateShown = $derived(
    audioCanTweak && !isLosslessAudioCodec(audioOutCodec),
  );

  // 파일이 바뀌면 파일명 기본값·이전 결과를 갱신
  $effect(() => {
    const f = editor.file;
    if (!f) return;
    filename = f.name.replace(/\.[^.]+$/, "") || "video";
    result = null;
    status = "";
    audioStatus = "";
  });

  function cleanName(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || "video";
  }

  /** 화면의 설정을 한 파일분 트랜스코드 옵션으로. 진행률·취소 훅은 호출부가 붙인다. */
  function buildOptions(
    meta: VideoMeta,
    trim: { start: number; end: number } | null,
    clipDurationS: number,
  ): Omit<TranscodeOptions, "onProgress" | "registerCancel"> {
    const exact = editor.cutMode === "exact";
    return {
      trim,
      mode: editor.cutMode,
      container: editor.exportFormat,
      mute: editor.muteAudio,
      preset: editor.preset,
      height: exact ? editor.resHeight : null,
      targetBytes: exact && editor.targetEnabled ? editor.targetMB * 1024 * 1024 : null,
      bitrateKbps: exact ? editor.bitrateKbps : null,
      fps: exact ? editor.fps : null,
      rotate: editor.rotate,
      flipH: exact && editor.flipH,
      flipV: exact && editor.flipV,
      clipDurationS,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      hasAudio: meta.hasAudio,
    };
  }

  function stemOf(file: File): string {
    return file.name.replace(/\.[^.]+$/, "") || "video";
  }

  /** 진행률 표시 한 곳 — 오버레이 막대와 글자가 같은 값을 본다. */
  function report(p: number) {
    editor.progress = p;
    editor.busyMsg = t.panel.encoding(Math.round(p * 100));
  }

  // ── 인코딩 → 용량 확인 → 저장 ─────────────────────
  async function make() {
    if (!editor.file || !editor.meta || editor.busy) return;
    if (editor.isBatch) return void makeBatch();
    const segs = exportSegs;
    if (segs.length === 0) return;
    if (segs.length > 1 && editor.exportMode === "each") return void makeEach(segs);
    editor.videoEl?.pause();
    editor.error = "";
    status = "";
    editor.busy = true;
    editor.progress = 0;
    editor.busyMsg = t.panel.encoding(0);
    const revision = editor.revision;
    const meta = editor.meta;
    const total = totalLength(segs);
    try {
      const res =
        segs.length > 1
          ? await concatSegments({
              file: editor.file,
              segments: segs,
              container: editor.exportFormat,
              mute: editor.muteAudio,
              copy: joinCopies,
              rotate: editor.rotate,
              // 이어붙일 조각은 언제나 같은 설정으로 다시 인코딩한다 — 조각마다 코덱
              // 파라미터가 달라지면 2단계 remux가 거부한다. 복사 경로는 concat.ts가 따로 간다.
              transcodeOptions: (seg) => ({
                ...buildOptions(meta, { start: seg.start, end: seg.end }, total),
                mode: "exact",
              }),
              onProgress: report,
              registerCancel: (cancel) => (editor.cancelCurrent = cancel),
            })
          : await transcodeMp4(editor.file, {
              ...buildOptions(
                meta,
                editor.isTrimmed ? { start: segs[0].start, end: segs[0].end } : null,
                editor.isTrimmed ? segmentLength(segs[0]) : editor.duration,
              ),
              onProgress: report,
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

  // ── 구간마다 한 파일 — 만드는 대로 하나씩 내려받는다 ──
  // ZIP으로 묶지 않는 이유는 apps/video에 fflate가 없어서다(새 의존성은 apps/stack의
  // 서드파티 목록 검사와 함께 움직여야 한다). 크롬은 첫 파일 뒤에 "여러 파일 다운로드"를
  // 한 번 묻고, 허용하면 나머지가 이어서 내려온다.
  async function makeEach(segs: Segment[]) {
    if (!editor.file || !editor.meta) return;
    editor.videoEl?.pause();
    editor.error = "";
    status = "";
    result = null;
    editor.busy = true;
    editor.progress = 0;
    const meta = editor.meta;
    const weights = segmentWeights(segs);
    let done = 0;
    let aborted = false;
    try {
      for (let i = 0; i < segs.length; i++) {
        if (aborted) break;
        editor.busyMsg = t.panel.batchProgress(i + 1, segs.length);
        const res = await transcodeMp4(editor.file, {
          // 파일이 구간마다 하나씩 나오므로 타깃 용량·비트레이트는 그 구간 길이로 역산한다.
          // 합계 길이를 넘기면 파일마다 타깃의 (구간 길이/합계)만큼만 나온다.
          ...buildOptions(
            meta,
            { start: segs[i].start, end: segs[i].end },
            segmentLength(segs[i]),
          ),
          onProgress: (p) => (editor.progress = overallProgress(weights, i, p)),
          registerCancel: (cancel) =>
            (editor.cancelCurrent = () => {
              aborted = true;
              cancel();
            }),
        });
        if (!res.blob) break;
        downloadBlob(res.blob, `${cleanName()}-${i + 1}.${editor.exportFormat}`);
        done++;
      }
      const parts = done > 0 ? [t.panel.batchDone(done)] : [];
      if (done < segs.length) parts.push(t.panel.canceled);
      status = parts.join(" · ");
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
      editor.progress = null;
      editor.cancelCurrent = null;
    }
  }

  // ── 큐 — 같은 설정으로 차례로 만들어 각각 저장 ────
  // 구간은 파일마다 뜻이 달라 쓰지 않는다(화면에도 그렇게 적는다).
  async function makeBatch() {
    const files = editor.batch;
    if (files.length === 0) return;
    editor.videoEl?.pause();
    editor.error = "";
    status = "";
    result = null;
    editor.busy = true;
    editor.progress = 0;
    let aborted = false;
    let done = 0;
    const failed: string[] = [];
    try {
      for (const file of files) {
        if (aborted) break;
        editor.busyMsg = t.panel.batchProgress(done + 1, files.length);
        try {
          const meta =
            file === editor.file && editor.meta ? editor.meta : await probeVideo(file);
          const res = await transcodeMp4(file, {
            ...buildOptions(meta, null, meta.durationS),
            onProgress: (p) => (editor.progress = (done + p) / files.length),
            registerCancel: (cancel) =>
              (editor.cancelCurrent = () => {
                aborted = true; // 남은 파일까지 멈춘다
                cancel();
              }),
          });
          if (!res.blob) {
            aborted = true;
            break;
          }
          downloadBlob(res.blob, `${stemOf(file)}.${editor.exportFormat}`);
          done++;
          editor.progress = done / files.length;
        } catch {
          failed.push(file.name); // 한 파일이 안 되어도 나머지는 계속
        }
      }
      const parts = done > 0 ? [t.panel.batchDone(done)] : [];
      if (aborted && done < files.length) parts.push(t.panel.canceled);
      for (const name of failed) parts.push(t.panel.batchFailed(name));
      status = parts.join(" · ");
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
    audioStatus = "";
    editor.busy = true;
    editor.progress = 0;
    editor.busyMsg = t.panel.extracting;
    try {
      const res = await extractAudio(editor.file, {
        trim: editor.isTrimmed
          ? { start: editor.trimStart, end: editor.trimEnd }
          : null,
        audioCodec: editor.meta.audioCodec,
        format: editor.audioFormat,
        bitrateKbps: audioBitrateShown ? editor.audioBitrateKbps : null,
        mono: audioCanTweak && editor.audioMono,
        onProgress: (p) => (editor.progress = p),
        registerCancel: (cancel) => (editor.cancelCurrent = cancel),
      });
      if (res.blob) {
        downloadBlob(res.blob, `${cleanName()}.${res.ext}`);
        audioStatus = t.panel.savedAudio(
          res.ext.toUpperCase(),
          formatBytes(res.blob.size),
        );
      } else {
        audioStatus = t.panel.canceled;
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
  /** 빈 칸이면 null(자동)로 읽는다. */
  function numOrNull(e: Event): number | null {
    const v = (e.target as HTMLInputElement).value.trim();
    return v === "" ? null : Number(v);
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
    <div class="head">
      <h3>{t.panel.trim}</h3>
      {#if editor.isBatch}
        <span class="badge warn" title={t.panel.badgeQueueFullWhy}>
          {t.panel.badgeQueueFull}
        </span>
      {/if}
    </div>
    <!-- 목록 순서가 곧 이어붙이는 순서다. 위/아래 버튼이 그 순서를 바꾼다. -->
    <ul class="seglist">
      {#each editor.segments as seg, i (seg.id)}
        <li class="segrow" class:active={i === editor.activeIndex}>
          <button
            type="button"
            class="segpick"
            aria-label={t.panel.segmentPick(i + 1)}
            aria-pressed={i === editor.activeIndex}
            onclick={() => editor.selectSegment(i)}
          >
            <span class="ord">{i + 1}</span>
            <span class="segtime">{fmtTime(seg.start)}–{fmtTime(seg.end)}</span>
          </button>
          {#if editor.isMultiSegment}
            <button
              type="button"
              class="icon-btn tool"
              aria-label={t.panel.segmentUp}
              title={t.panel.segmentUp}
              disabled={i === 0}
              onclick={() => editor.moveSegmentBy(i, -1)}
            >
              <Icon name="arrowUp" size={13} />
            </button>
            <button
              type="button"
              class="icon-btn tool"
              aria-label={t.panel.segmentDown}
              title={t.panel.segmentDown}
              disabled={i === editor.segments.length - 1}
              onclick={() => editor.moveSegmentBy(i, 1)}
            >
              <Icon name="arrowDown" size={13} />
            </button>
            <button
              type="button"
              class="icon-btn tool"
              aria-label={t.panel.segmentRemove}
              title={t.panel.segmentRemove}
              onclick={() => editor.removeSegment(i)}
            >
              <Icon name="trash" size={13} />
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="chiprow">
      <button
        type="button"
        class="btn small ghost"
        onclick={() => editor.addSegment()}
        disabled={editor.duration <= 0}
      >
        <Icon name="plus" size={13} /> {t.panel.segmentAdd}
      </button>
      {#if editor.isTrimmed}
        <!-- 구간이 여럿일 땐 목록까지 지운다 — 되돌리기가 없으니 title로 미리 적는다. -->
        <button
          type="button"
          class="btn small ghost"
          title={editor.isMultiSegment ? t.panel.trimResetWhy : undefined}
          onclick={() => editor.resetTrim()}
        >
          {t.panel.trimReset}
        </button>
      {/if}
      {#if overlapping}
        <span class="badge" title={t.panel.badgeOverlapWhy}>{t.panel.badgeOverlap}</span>
      {/if}
      {#if reordered}
        <span class="badge" title={t.panel.badgeReorderedWhy}>
          {t.panel.badgeReordered}
        </span>
      {/if}
    </div>

    <div class="row">
      <label class="lbl" for="trim-start">{t.panel.trimStart}</label>
      <input
        id="trim-start"
        class="num"
        type="number"
        min="0"
        max={editor.duration}
        step="0.1"
        title={t.panel.trimStartKey}
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
        title={t.panel.trimEndKey}
        value={Number(editor.trimEnd.toFixed(1))}
        onchange={onEndChange}
      />
    </div>
    <div class="row">
      <span class="info">
        {#if editor.isMultiSegment}
          {t.panel.segmentTotal(editor.segments.length, fmtTime(editor.segmentsTotal))}
        {:else}
          {t.panel.trimLength(fmtTime(editor.rangeLength))}
        {/if}
      </span>
    </div>

    {#if editor.isMultiSegment}
      <div class="chips" role="group" aria-label={t.panel.exportOrder}>
        <button
          type="button"
          class="chip"
          class:active={editor.exportMode === "join"}
          onclick={() => editor.setExportMode("join")}
        >
          {t.panel.exportJoin}
        </button>
        <button
          type="button"
          class="chip"
          class:active={editor.exportMode === "each"}
          onclick={() => editor.setExportMode("each")}
        >
          {t.panel.exportEach}
        </button>
      </div>
    {/if}
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
  </section>

  <!-- 회전·반전 -->
  <section class="sec">
    <div class="head">
      <h3>{t.panel.transform}</h3>
      {#if rotateBreaksCopy}
        <span class="badge warn" title={t.panel.badgeRotateRecodeWhy}>
          {t.panel.badgeRotateRecode}
        </span>
      {/if}
    </div>
    <div class="chips">
      <button
        type="button"
        class="chip"
        class:active={editor.rotate !== 0}
        aria-label={t.panel.rotateCw}
        title={t.panel.rotateCw}
        onclick={() => editor.rotateBy90()}
      >
        <Icon name="rotate" size={14} />
        {editor.rotate === 0 ? t.panel.rotateNone : t.panel.rotateState(editor.rotate)}
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.flipH}
        aria-pressed={editor.flipH}
        disabled={editor.cutMode !== "exact"}
        onclick={() => editor.setFlip("h", !editor.flipH)}
      >
        <Icon name="flipH" size={14} />
        {t.panel.flipH}
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.flipV}
        aria-pressed={editor.flipV}
        disabled={editor.cutMode !== "exact"}
        onclick={() => editor.setFlip("v", !editor.flipV)}
      >
        <Icon name="flipV" size={14} />
        {t.panel.flipV}
      </button>
      {#if editor.cutMode !== "exact"}
        <span class="badge" title={t.panel.badgeExactOnlyWhy}>
          {t.panel.badgeExactOnly}
        </span>
      {/if}
    </div>
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
            class:active={editor.preset === id &&
              !editor.targetEnabled &&
              editor.bitrateKbps === null}
            onclick={() => {
              editor.setTargetEnabled(false);
              editor.setBitrateKbps(null); // 프리셋을 고르면 지정 비트레이트를 놓는다
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
        {#if editor.targetEnabled}
          <span class="badge" title={t.panel.badgeApproxWhy}>{t.panel.badgeApprox}</span>
        {/if}
      </label>
      <div class="row">
        <label class="lbl" for="v-bitrate">{t.panel.bitrate}</label>
        <input
          id="v-bitrate"
          class="num"
          type="number"
          min={MIN_BITRATE_KBPS}
          max={MAX_BITRATE_KBPS}
          step="100"
          placeholder={t.panel.auto}
          value={editor.bitrateKbps ?? ""}
          onchange={(e) => editor.setBitrateKbps(numOrNull(e))}
        />
      </div>
      <div class="row">
        <label class="lbl" for="v-fps">{t.panel.fps}</label>
        <input
          id="v-fps"
          class="num"
          type="number"
          min={MIN_FPS}
          max={MAX_FPS}
          step="1"
          placeholder={fpsPlaceholder}
          value={editor.fps ?? ""}
          onchange={(e) => editor.setFps(numOrNull(e))}
        />
      </div>
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
    <div class="chiprow">
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
      {#if recodeWhy}
        <span class="badge warn" title={recodeWhy}>{t.panel.badgeRecode}</span>
      {/if}
    </div>
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
    {#if !editor.isBatch}
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
    {/if}

    <button
      type="button"
      class="btn primary"
      onclick={make}
      disabled={editor.busy || !editor.file || (!editor.isBatch && exportSegs.length === 0)}
    >
      <Icon name="film" size={15} />
      {#if editor.isBatch}
        {t.panel.batchAction(editor.batch.length, fmtLabel)}
      {:else if exportSegs.length > 1}
        {editor.exportMode === "each"
          ? t.panel.eachAction(exportSegs.length, fmtLabel)
          : t.panel.joinAction(exportSegs.length, fmtLabel)}
      {:else}
        {result ? t.panel.reEncode : t.panel.encodeAction(fmtLabel)}
      {/if}
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

    {#if status}
      <p class="status">{status}</p>
    {/if}
  </section>

  <!-- 소리만 저장 -->
  {#if editor.meta?.hasAudio}
    <section class="sec">
      <div class="head">
        <h3>{t.panel.audio}</h3>
        {#if editor.isMultiSegment}
          <span class="badge" title={t.panel.badgeAudioOneWhy}>
            {t.panel.badgeAudioOne}
          </span>
        {/if}
      </div>
      <div class="chips" role="group" aria-label={t.panel.audioFormat}>
        {#each audioFormats as id (id)}
          <button
            type="button"
            class="chip"
            class:active={editor.audioFormat === id}
            onclick={() => editor.setAudioFormat(id)}
          >
            {AUDIO_FORMAT_LABELS[id]}
          </button>
        {/each}
      </div>
      {#if audioBitrateShown}
        <div class="row">
          <label class="lbl" for="a-bitrate">{t.panel.bitrate}</label>
          <input
            id="a-bitrate"
            class="num"
            type="number"
            min={MIN_BITRATE_KBPS}
            max={MAX_BITRATE_KBPS}
            step="16"
            placeholder={t.panel.auto}
            value={editor.audioBitrateKbps ?? ""}
            onchange={(e) => editor.setAudioBitrateKbps(numOrNull(e))}
          />
        </div>
      {/if}
      {#if audioCanTweak}
        <label class="row checkrow">
          <input
            type="checkbox"
            checked={editor.audioMono}
            onchange={(e) => editor.setAudioMono((e.target as HTMLInputElement).checked)}
          />
          <span class="lbl">{t.panel.audioMono}</span>
        </label>
      {/if}
      <button
        type="button"
        class="btn"
        onclick={extract}
        disabled={editor.busy || !editor.file || editor.isBatch}
      >
        <Icon name="audio" size={15} /> {t.panel.extractAudio}
      </button>
      {#if audioStatus}
        <p class="status">{audioStatus}</p>
      {/if}
    </section>
  {/if}
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
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  /* 제목 줄 — 배지는 오른쪽 끝에 붙어 아래를 밀지 않는다. */
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .info {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex: 1;
  }

  /* 구간 목록 — 위에서 아래가 곧 이어붙이는 순서다. */
  .seglist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
  }
  .segrow {
    display: flex;
    align-items: center;
    gap: var(--space-3xs);
    border-radius: var(--radius-sm);
  }
  .segrow.active {
    background: var(--accent-weak);
  }
  .segpick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-3xs) var(--space-2xs);
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    border-radius: var(--radius-sm);
  }
  .segrow.active .segpick {
    color: var(--text);
  }
  .ord {
    flex: none;
    min-width: 16px;
    padding: 0 var(--space-3xs);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-muted);
    font-weight: 700;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .segrow.active .ord {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .segtime {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    align-items: center;
  }
  /* 칩 무리 + 그 무리에 붙는 배지 (칩만 role=group 안에 두려고 한 겹 감쌌다). */
  .chiprow {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-wrap: wrap;
  }

  /* 조건이 참일 때만 나타나는 짧은 경고. 자세한 사정은 title에만 있다. */
  .badge {
    flex: none;
    padding: var(--space-3xs) var(--space-xs);
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    cursor: help;
  }
  .badge.warn {
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .chip:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }
  .chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .chip.active {
    background: var(--accent-weak);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent-ink);
  }

  .checkrow {
    cursor: pointer;
  }
  .checkrow input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .lbl {
    font-size: var(--text-md);
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
    font-size: var(--text-base);
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .num:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
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
    flex: 1;
    min-width: 0;
    font-family: inherit;
  }
  .fname:focus {
    outline: none;
  }
  .ext {
    font-size: var(--text-md);
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
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text);
  }
  .result-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .status {
    margin: 0;
    font-size: var(--text-md);
    color: var(--text-muted);
  }

  @media (max-width: 760px) {
    .panel {
      width: auto;
      overflow-y: visible;
    }
  }
</style>
