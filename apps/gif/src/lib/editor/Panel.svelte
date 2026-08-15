<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { zipSync } from "fflate";
  import {
    editor,
    SPEED_CHIPS,
    SCALE_CHIPS,
    MIN_DELAY_MS,
    MAX_DELAY_MS,
    GIF_COLOR_CHOICES,
    QUALITY_PRESETS,
    type DelayMode,
    type ExportFormat,
    type PresetId,
  } from "./state.svelte";
  import { formatMinDelayMs, isDelayFloored } from "../gif/timing";
  import { unseenOverlayCount } from "../gif/overlay";
  import type {
    OverlayAlign,
    OverlayPatch,
    OverlayScope,
    OverlayVAlign,
  } from "../gif/overlay";
  import {
    BLUR_MAX_RADIUS,
    BLUR_MIN_RADIUS,
    MOSAIC_MAX_BLOCK,
    MOSAIC_MIN_BLOCK,
    unseenRegionCount,
  } from "../gif/redact";
  import type { RedactMode, RedactPatch } from "../gif/redact";
  import { snapshotPlan, type RenderPlan } from "../gif/plan";
  import { encodeGif, isAbortError } from "../gif/encode";
  import { encodeWebp } from "../gif/webp";
  import { encodeMp4 } from "../gif/mp4";
  import { extractPngFrames } from "../gif/extract";
  import { downloadBlob, formatBytes } from "../gif/save";

  const PRESET_LABELS: Record<PresetId, string> = {
    small: t.panel.presetSmall,
    balanced: t.panel.presetBalanced,
    high: t.panel.presetHigh,
  };

  const DELAY_MODE_LABELS: Record<DelayMode, string> = {
    set: t.panel.delayModeSet,
    add: t.panel.delayModeAdd,
    scale: t.panel.delayModeScale,
  };
  const DELAY_VALUE_LABELS: Record<DelayMode, string> = {
    set: t.panel.delayValueSet,
    add: t.panel.delayValueAdd,
    scale: t.panel.delayValueScale,
  };
  const DELAY_MODES: DelayMode[] = ["set", "add", "scale"];

  const V_ALIGNS: { id: OverlayVAlign; label: string }[] = [
    { id: "top", label: t.panel.textVTop },
    { id: "middle", label: t.panel.textVMiddle },
    { id: "bottom", label: t.panel.textVBottom },
  ];
  const ALIGNS: { id: OverlayAlign; label: string }[] = [
    { id: "left", label: t.panel.textAlignLeft },
    { id: "center", label: t.panel.textAlignCenter },
    { id: "right", label: t.panel.textAlignRight },
  ];
  // 텍스트와 가리기 영역이 **같은 목록**을 쓴다 — 프레임 범위 규약이 하나이므로 칩도 하나다.
  const SCOPES: { id: OverlayScope; label: string }[] = [
    { id: "all", label: t.panel.textScopeAll },
    { id: "selected", label: t.panel.textScopeSelected },
    { id: "range", label: t.panel.textScopeRange },
  ];
  const REDACT_MODES: { id: RedactMode; label: string }[] = [
    { id: "mosaic", label: t.panel.redactMosaic },
    { id: "blur", label: t.panel.redactBlur },
  ];
  const REDACT_MODE_LABELS: Record<RedactMode, string> = {
    mosaic: t.panel.redactMosaic,
    blur: t.panel.redactBlur,
  };

  let filename = $state("animation");
  let delayMode = $state<DelayMode>("set");
  let delayInput = $state(100);
  let rangeFrom = $state(1);
  let rangeTo = $state(1);
  /** 만들어 둔 결과는 **자기 형식을 들고 있다** — 다 만든 뒤 형식 칩을 바꿔도
   *  파일 이름의 확장자와 배지가 실제로 만든 것을 가리킨다. */
  let result = $state<{ blob: Blob; revision: number; fmt: ExportFormat } | null>(null);
  let status = $state("");
  /** 지금 도는 인코딩·추출을 멈추는 손잡이. */
  let aborter: AbortController | null = null;

  const stale = $derived(result !== null && result.revision !== editor.revision);
  const FORMAT_LABELS = { gif: "GIF", webp: "WebP", mp4: "MP4" } as const;
  const fmtLabel = $derived(FORMAT_LABELS[editor.exportFormat]);
  const ext = $derived(editor.exportFormat);

  const currentFrame = $derived(
    editor.frames[Math.min(editor.current, Math.max(0, editor.frames.length - 1))],
  );

  // 지금 배속·형식으로는 입력한 딜레이가 그대로 나가지 않는 프레임 — 있을 때만 배지를 띄운다.
  const minDelay = $derived(formatMinDelayMs(editor.exportFormat));
  const flooredCount = $derived(
    editor.frames.filter((f) =>
      isDelayFloored(f.delayMs, editor.speed, editor.exportFormat),
    ).length,
  );
  // 덮어쓰기 값은 지금 보고 있는 프레임의 실제 딜레이를 따라간다(가감·비율은 그대로 둔다).
  $effect(() => {
    const ms = currentFrame?.delayMs ?? 100;
    untrack(() => {
      if (delayMode === "set") delayInput = ms;
    });
  });

  // 손대기 전까지 구간은 전체를 가리키고, 그 뒤로는 프레임 수 안으로만 잡아 둔다.
  let rangeTouched = false;
  $effect(() => {
    const n = Math.max(1, editor.frames.length);
    untrack(() => {
      if (!rangeTouched) {
        rangeFrom = 1;
        rangeTo = n;
        return;
      }
      rangeFrom = Math.min(Math.max(1, rangeFrom), n);
      rangeTo = Math.min(Math.max(rangeTo, rangeFrom), n);
    });
  });

  function setDelayMode(mode: DelayMode) {
    delayMode = mode;
    delayInput = mode === "set" ? (currentFrame?.delayMs ?? 100) : mode === "add" ? 10 : 100;
  }

  function cleanName(fallback: string): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || fallback;
  }

  /** 지금 상태를 굳혀 이번 인코딩이 끝까지 볼 계획을 만든다.
   *  인코딩은 프레임마다 await로 멈추므로, 살아 있는 상태를 그대로 넘기면 그 틈의 편집이
   *  뒤쪽 프레임에만 들어가 결과 파일 하나가 자기 안에서 앞뒤로 갈린다(plan.ts 참고). */
  function plan(): RenderPlan {
    return snapshotPlan({
      frames: editor.frames,
      sources: editor.sources,
      transform: editor.transform,
      overlays: editor.overlays,
      baseW: editor.base.w,
      baseH: editor.base.h,
      signal: aborter?.signal,
    });
  }

  /** 긴 작업 시작 — 오버레이의 취소 버튼이 여기서 만든 신호를 끊는다. */
  function beginBusy() {
    aborter = new AbortController();
    editor.busy = true;
    editor.busyCancel = () => aborter?.abort();
  }
  function endBusy() {
    editor.busy = false;
    editor.busyMsg = "";
    editor.busyCancel = null;
    aborter = null;
  }

  // ── 인코딩 → 용량 확인 → 저장 ─────────────────────
  async function make() {
    if (!editor.frames.length || editor.busy) return;
    editor.playing = false;
    editor.error = "";
    status = "";
    beginBusy();
    // 이 아래로는 살아 있는 상태를 읽지 않는다 — 형식·화질·배속까지 여기서 값으로 굳힌다.
    const frozen = plan();
    const revision = editor.revision;
    const fmt = editor.exportFormat;
    editor.busyMsg = t.panel.encoding(0, frozen.frames.length);
    const onProgress = (done: number, total: number) =>
      (editor.busyMsg = t.panel.encoding(done, total));
    try {
      let blob: Blob;
      if (fmt === "gif") {
        blob = await encodeGif({
          ...frozen,
          speed: editor.speed,
          repeat: editor.repeat,
          maxColors: editor.gifColors,
          dither: editor.gifDither,
          diff: editor.gifDiff,
          onProgress,
        });
      } else if (fmt === "webp") {
        blob = await encodeWebp({
          ...frozen,
          speed: editor.speed,
          loop: editor.webpLoop,
          quality: editor.webpQuality,
          onProgress,
        });
      } else {
        blob = await encodeMp4({
          ...frozen,
          speed: editor.speed,
          quality: editor.mp4Quality,
          onProgress,
        });
      }
      result = { blob, revision, fmt };
    } catch (err) {
      if (isAbortError(err)) status = t.panel.canceled;
      else editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      endBusy();
    }
  }

  function saveResult() {
    if (!result) return;
    downloadBlob(result.blob, `${cleanName("animation")}.${result.fmt}`);
  }

  // ── 프레임 PNG 추출 (여러 장이면 ZIP 한 개) ────────
  async function extract() {
    if (!editor.frames.length || editor.busy) return;
    editor.playing = false;
    editor.error = "";
    status = "";
    beginBusy();
    try {
      const pngs = await extractPngFrames(plan(), (done, total) => {
        editor.busyMsg = t.panel.extracting(done, total);
      });
      if (pngs.length === 1) {
        downloadBlob(
          new Blob([pngs[0].bytes], { type: "image/png" }),
          `${cleanName("frames")}.png`,
        );
        status = t.panel.savedPng;
      } else {
        editor.busyMsg = t.panel.zipping;
        const files: Record<string, Uint8Array> = {};
        for (const p of pngs) files[p.name] = p.bytes;
        // PNG는 이미 압축돼 있으므로 저장(무압축) 모드로 빠르게 묶음.
        const zipped = zipSync(files, { level: 0 });
        const buf = new Uint8Array(zipped.byteLength);
        buf.set(zipped);
        downloadBlob(
          new Blob([buf], { type: "application/zip" }),
          `${cleanName("frames")}.zip`,
        );
        status = t.panel.savedZip(pngs.length);
      }
    } catch (err) {
      if (isAbortError(err)) status = t.panel.canceled;
      else editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      endBusy();
    }
  }

  // ── 입력 핸들러 ───────────────────────────────────
  function onDelayInput(e: Event) {
    delayInput = Number((e.target as HTMLInputElement).value);
  }
  /** 번호 입력은 1..프레임 수로 가둔다. 클램프한 값은 칸에 되써 준다 —
   *  값이 그대로 남으면 화면에 보이는 번호와 실제로 자르는 구간이 갈린다. */
  function takeFrameNo(e: Event): number {
    rangeTouched = true;
    const el = e.target as HTMLInputElement;
    const n = Math.max(1, editor.frames.length);
    const v = Math.min(Math.max(1, Math.round(Number(el.value)) || 1), n);
    el.value = String(v);
    return v;
  }
  function onRangeFrom(e: Event) {
    rangeFrom = takeFrameNo(e);
  }
  function onRangeTo(e: Event) {
    rangeTo = takeFrameNo(e);
  }
  function onWidthChange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < 8) return;
    editor.setScale(v / editor.unscaledOutput.w);
  }
  function onLoopCountChange(e: Event) {
    editor.setLoopCount(Number((e.target as HTMLInputElement).value));
  }
  function onColorsChange(e: Event) {
    editor.setGifColors(Number((e.target as HTMLSelectElement).value));
  }
  function onDitherChange(e: Event) {
    editor.setGifDither((e.target as HTMLInputElement).checked);
  }
  function onDiffChange(e: Event) {
    editor.setGifDiff((e.target as HTMLInputElement).checked);
  }
  function onWebpQualityChange(e: Event) {
    editor.setWebpQuality(Number((e.target as HTMLInputElement).value));
  }
  function toggleCropMode() {
    editor.playing = false;
    editor.cropMode = !editor.cropMode;
    // 두 모드가 같은 드래그를 쓰므로 하나만 켜 둔다.
    if (editor.cropMode) editor.redactMode = false;
  }

  // ── 텍스트 오버레이 ───────────────────────────────
  const active = $derived(editor.activeOverlay);
  /** 어디에도 안 그려지는 글자의 수 — 편집 중인 것만이 아니라 목록 전체를 센다. */
  const unseenCount = $derived(
    unseenOverlayCount(editor.overlays, editor.frames.length, editor.selectedCount),
  );

  type OverlayNumberKey = "fontSize" | "strokeWidth" | "dx" | "dy" | "from" | "to";

  function patchActive(patch: OverlayPatch) {
    if (active) editor.updateOverlay(active.id, patch);
  }
  function onOverlayText(e: Event) {
    patchActive({ text: (e.target as HTMLTextAreaElement).value });
  }
  /** 가둔 값을 칸에 되써 준다 — 400을 넘겨 적거나 칸을 비우면 상태만 가둬지고
   *  칸에는 적은 수가 그대로 남는다(같은 값으로 가둬지면 Svelte가 DOM을 안 건드린다).
   *  그러면 화면에 보이는 크기와 실제로 그리는 크기가 갈린다. */
  function onOverlayNumber(key: OverlayNumberKey) {
    return (e: Event) => {
      const el = e.target as HTMLInputElement;
      const patch: OverlayPatch = {};
      patch[key] = Number(el.value);
      patchActive(patch);
      const applied = editor.activeOverlay?.[key];
      if (applied !== undefined) el.value = String(applied);
    };
  }
  function onOverlayColor(key: "color" | "strokeColor") {
    return (e: Event) => {
      const patch: OverlayPatch = {};
      patch[key] = (e.target as HTMLInputElement).value;
      patchActive(patch);
    };
  }

  // ── 가리기 영역 ───────────────────────────────────
  const activeRegion = $derived(editor.activeRegion);
  /** 결과에 안 나오는 영역의 수 — 범위 밖이거나 크롭이 잘라낸 것을 함께 센다. */
  const unseenRegions = $derived(
    unseenRegionCount(editor.regions, {
      frameCount: editor.frames.length,
      selectedCount: editor.selectedCount,
      baseW: editor.base.w,
      baseH: editor.base.h,
      out: editor.output,
      tf: editor.transform,
    }),
  );
  const strengthMin = $derived(
    activeRegion?.mode === "blur" ? BLUR_MIN_RADIUS : MOSAIC_MIN_BLOCK,
  );
  const strengthMax = $derived(
    activeRegion?.mode === "blur" ? BLUR_MAX_RADIUS : MOSAIC_MAX_BLOCK,
  );

  function patchRegion(patch: RedactPatch) {
    if (activeRegion) editor.updateRegion(activeRegion.id, patch);
  }
  /** 가둔 값을 칸에 되써 준다 — 오버레이 쪽과 같은 이유다(화면 숫자와 실제 값이 갈리지 않게). */
  function onRegionNumber(key: "strength" | "from" | "to") {
    return (e: Event) => {
      const el = e.target as HTMLInputElement;
      const patch: RedactPatch = {};
      patch[key] = Number(el.value);
      patchRegion(patch);
      const applied = editor.activeRegion?.[key];
      if (applied !== undefined) el.value = String(applied);
    };
  }
</script>

<aside class="panel">
  <!-- 속도 -->
  <section class="sec">
    <h3>{t.panel.speed}</h3>
    <div class="chips">
      {#each SPEED_CHIPS as x (x)}
        <button
          type="button"
          class="chip"
          class:active={editor.speed === x}
          onclick={() => editor.setSpeed(x)}
        >
          {t.panel.speedChip(x)}
        </button>
      {/each}
      {#if flooredCount > 0}
        <span
          class="badge"
          title={t.panel.delayFloorHint(flooredCount, minDelay, fmtLabel)}
        >
          {t.panel.delayFloor(minDelay)}
        </span>
      {/if}
    </div>
    <p class="sub">{t.panel.delayLabel}</p>
    <div class="chips" role="group" aria-label={t.panel.delayLabel}>
      {#each DELAY_MODES as mode (mode)}
        <button
          type="button"
          class="chip"
          class:active={delayMode === mode}
          onclick={() => setDelayMode(mode)}
        >
          {DELAY_MODE_LABELS[mode]}
        </button>
      {/each}
    </div>
    <div class="row">
      <label class="lbl" for="delay-input">{DELAY_VALUE_LABELS[delayMode]}</label>
      <input
        id="delay-input"
        class="num"
        type="number"
        min={delayMode === "set" ? MIN_DELAY_MS : delayMode === "add" ? -MAX_DELAY_MS : 1}
        max={delayMode === "scale" ? 1000 : MAX_DELAY_MS}
        step="10"
        value={delayInput}
        oninput={onDelayInput}
      />
    </div>
    <div class="row">
      <button
        type="button"
        class="btn small"
        onclick={() => editor.setDelay(delayInput, true, delayMode)}
        disabled={editor.selectedCount === 0}
      >
        {t.panel.delayApplySelected}
      </button>
      <button
        type="button"
        class="btn small"
        onclick={() => editor.setDelay(delayInput, false, delayMode)}
      >
        {t.panel.delayApplyAll}
      </button>
    </div>
  </section>

  <!-- 프레임 구간 -->
  <section class="sec">
    <h3>{t.panel.range}</h3>
    <div class="row">
      <label class="lbl" for="range-from">{t.panel.rangeFrom}</label>
      <input
        id="range-from"
        class="num"
        type="number"
        min="1"
        max={Math.max(1, editor.frames.length)}
        step="1"
        value={rangeFrom}
        onchange={onRangeFrom}
      />
    </div>
    <div class="row">
      <label class="lbl" for="range-to">{t.panel.rangeTo}</label>
      <input
        id="range-to"
        class="num"
        type="number"
        min="1"
        max={Math.max(1, editor.frames.length)}
        step="1"
        value={rangeTo}
        onchange={onRangeTo}
      />
    </div>
    <div class="row">
      <button
        type="button"
        class="btn small"
        onclick={() => editor.selectNumbers(rangeFrom, rangeTo)}
        disabled={editor.frames.length === 0}
      >
        <Icon name="check" size={14} /> {t.panel.rangeSelect}
      </button>
      <button
        type="button"
        class="btn small"
        onclick={() => editor.keepNumbers(rangeFrom, rangeTo)}
        disabled={editor.frames.length === 0}
      >
        <Icon name="scissors" size={14} /> {t.panel.rangeKeep}
      </button>
    </div>
  </section>

  <!-- 크기 -->
  <section class="sec">
    <h3>{t.panel.size}</h3>
    <p class="info">
      {t.panel.originalSize(editor.base.w, editor.base.h)} ·
      {t.panel.outputSize(editor.output.w, editor.output.h)}
    </p>
    <div class="chips">
      {#each SCALE_CHIPS as pct (pct)}
        <button
          type="button"
          class="chip"
          class:active={Math.round(editor.transform.scale * 100) === pct}
          onclick={() => editor.setScale(pct / 100)}
        >
          {t.panel.scaleChip(pct)}
        </button>
      {/each}
    </div>
    <div class="row">
      <label class="lbl" for="width-input">{t.panel.widthLabel}</label>
      <input
        id="width-input"
        class="num"
        type="number"
        min="8"
        step="1"
        value={editor.output.w}
        onchange={onWidthChange}
      />
    </div>
  </section>

  <!-- 크롭 -->
  <section class="sec">
    <h3>{t.panel.crop}</h3>
    <div class="row">
      <button
        type="button"
        class="btn small"
        class:active={editor.cropMode}
        onclick={toggleCropMode}
      >
        <Icon name="crop" size={14} />
        {editor.cropMode ? t.panel.cropCancel : t.panel.cropStart}
      </button>
      {#if editor.transform.crop}
        <button type="button" class="btn small" onclick={() => editor.setCrop(null)}>
          {t.panel.cropClear}
        </button>
      {/if}
    </div>
    {#if editor.transform.crop}
      <p class="info">
        {t.panel.cropRect(editor.transform.crop.w, editor.transform.crop.h)}
      </p>
    {/if}
  </section>

  <!-- 회전·뒤집기 -->
  <section class="sec">
    <h3>{t.panel.rotateFlip}</h3>
    <div class="row wrap">
      <button type="button" class="btn small" onclick={() => editor.rotate90()}>
        <Icon name="rotate" size={14} /> {t.panel.rotate}
      </button>
      <button
        type="button"
        class="btn small"
        class:active={editor.transform.flipH}
        onclick={() => editor.toggleFlipH()}
      >
        <Icon name="flipH" size={14} /> {t.panel.flipH}
      </button>
      <button
        type="button"
        class="btn small"
        class:active={editor.transform.flipV}
        onclick={() => editor.toggleFlipV()}
      >
        <Icon name="flipV" size={14} /> {t.panel.flipV}
      </button>
      <button type="button" class="btn small ghost" onclick={() => editor.resetTransform()}>
        {t.panel.resetTransform}
      </button>
    </div>
  </section>

  <!-- 텍스트 -->
  <section class="sec">
    <h3>{t.panel.text}</h3>
    {#if editor.overlays.length}
      <div class="olist">
        {#each editor.overlays as o, i (o.id)}
          <div class="orow" class:active={o.id === editor.activeOverlayId}>
            <button
              type="button"
              class="opick"
              aria-label={t.panel.textItem(i + 1)}
              onclick={() => editor.setActiveOverlay(o.id)}
            >
              {o.text.trim() || t.panel.textEmpty}
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label={t.panel.textRemove}
              title={t.panel.textRemove}
              onclick={() => editor.removeOverlay(o.id)}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="row">
      <button type="button" class="btn small" onclick={() => editor.addOverlay()}>
        <Icon name="text" size={14} /> {t.panel.textAdd}
      </button>
      {#if unseenCount > 0}
        <span class="badge" title={t.panel.textUnseenHint(unseenCount)}>
          {t.panel.textUnseen(unseenCount)}
        </span>
      {/if}
    </div>

    {#if active}
      <textarea
        class="otext"
        rows="2"
        spellcheck="false"
        aria-label={t.panel.text}
        placeholder={t.panel.textPlaceholder}
        value={active.text}
        oninput={onOverlayText}
      ></textarea>

      <p class="sub">{t.panel.textVAlign}</p>
      <div class="chips" role="group" aria-label={t.panel.textVAlign}>
        {#each V_ALIGNS as v (v.id)}
          <button
            type="button"
            class="chip"
            class:active={active.vAlign === v.id}
            onclick={() => patchActive({ vAlign: v.id })}
          >
            {v.label}
          </button>
        {/each}
      </div>

      <p class="sub">{t.panel.textAlign}</p>
      <div class="chips" role="group" aria-label={t.panel.textAlign}>
        {#each ALIGNS as a (a.id)}
          <button
            type="button"
            class="chip"
            class:active={active.align === a.id}
            onclick={() => patchActive({ align: a.id })}
          >
            {a.label}
          </button>
        {/each}
      </div>

      <div class="row">
        <label class="lbl" for="ov-size">{t.panel.textSize}</label>
        <input
          id="ov-size"
          class="num"
          type="number"
          min="6"
          max="400"
          step="1"
          value={active.fontSize}
          onchange={onOverlayNumber("fontSize")}
        />
      </div>
      <div class="row">
        <label class="lbl" for="ov-color">{t.panel.textColor}</label>
        <input
          id="ov-color"
          class="color"
          type="color"
          value={active.color}
          oninput={onOverlayColor("color")}
        />
      </div>
      <div class="row">
        <label class="lbl" for="ov-stroke-color">{t.panel.textStrokeColor}</label>
        <input
          id="ov-stroke-color"
          class="color"
          type="color"
          value={active.strokeColor}
          oninput={onOverlayColor("strokeColor")}
        />
      </div>
      <div class="row">
        <label class="lbl" for="ov-stroke">{t.panel.textStrokeWidth}</label>
        <input
          id="ov-stroke"
          class="num"
          type="number"
          min="0"
          max="40"
          step="1"
          value={active.strokeWidth}
          onchange={onOverlayNumber("strokeWidth")}
        />
      </div>
      <div class="row">
        <label class="lbl" for="ov-dx">{t.panel.textOffsetX}</label>
        <input
          id="ov-dx"
          class="num"
          type="number"
          step="1"
          value={active.dx}
          onchange={onOverlayNumber("dx")}
        />
      </div>
      <div class="row">
        <label class="lbl" for="ov-dy">{t.panel.textOffsetY}</label>
        <input
          id="ov-dy"
          class="num"
          type="number"
          step="1"
          value={active.dy}
          onchange={onOverlayNumber("dy")}
        />
      </div>

      <p class="sub">{t.panel.textScope}</p>
      <div class="chips" role="group" aria-label={t.panel.textScope}>
        {#each SCOPES as s (s.id)}
          <button
            type="button"
            class="chip"
            class:active={active.scope === s.id}
            onclick={() => patchActive({ scope: s.id })}
          >
            {s.label}
          </button>
        {/each}
      </div>
      {#if active.scope === "range"}
        <div class="row">
          <label class="lbl" for="ov-from">{t.panel.rangeFrom}</label>
          <input
            id="ov-from"
            class="num"
            type="number"
            min="1"
            max={Math.max(1, editor.frames.length)}
            step="1"
            value={active.from}
            onchange={onOverlayNumber("from")}
          />
        </div>
        <div class="row">
          <label class="lbl" for="ov-to">{t.panel.rangeTo}</label>
          <input
            id="ov-to"
            class="num"
            type="number"
            min="1"
            max={Math.max(1, editor.frames.length)}
            step="1"
            value={active.to}
            onchange={onOverlayNumber("to")}
          />
        </div>
      {/if}
    {/if}
  </section>

  <!-- 가리기 -->
  <section class="sec">
    <h3>{t.panel.redact}</h3>
    {#if editor.regions.length}
      <div class="olist">
        {#each editor.regions as r, i (r.id)}
          <div class="orow" class:active={r.id === editor.activeRegionId}>
            <button
              type="button"
              class="opick"
              onclick={() => editor.setActiveRegion(r.id)}
            >
              {t.panel.redactItem(i + 1, REDACT_MODE_LABELS[r.mode], r.w, r.h)}
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label={t.panel.redactRemove}
              title={t.panel.redactRemove}
              onclick={() => editor.removeRegion(r.id)}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="row">
      <button
        type="button"
        class="btn small"
        class:active={editor.redactMode}
        onclick={() => editor.toggleRedactMode()}
        disabled={editor.frames.length === 0}
      >
        <Icon name="mosaic" size={14} />
        {editor.redactMode ? t.panel.redactCancel : t.panel.redactAdd}
      </button>
      {#if unseenRegions > 0}
        <span class="badge" title={t.panel.redactUnseenHint(unseenRegions)}>
          {t.panel.redactUnseen(unseenRegions)}
        </span>
      {/if}
    </div>

    {#if activeRegion}
      <div class="chips" role="group" aria-label={t.panel.redact}>
        {#each REDACT_MODES as m (m.id)}
          <button
            type="button"
            class="chip"
            class:active={activeRegion.mode === m.id}
            onclick={() => patchRegion({ mode: m.id })}
          >
            {m.label}
          </button>
        {/each}
      </div>
      <div class="row">
        <label class="lbl" for="rd-strength">
          {activeRegion.mode === "blur" ? t.panel.redactRadius : t.panel.redactBlock}
        </label>
        <input
          id="rd-strength"
          class="num"
          type="number"
          min={strengthMin}
          max={strengthMax}
          step="1"
          value={activeRegion.strength}
          onchange={onRegionNumber("strength")}
        />
      </div>

      <p class="sub">{t.panel.textScope}</p>
      <div class="chips" role="group" aria-label={t.panel.textScope}>
        {#each SCOPES as s (s.id)}
          <button
            type="button"
            class="chip"
            class:active={activeRegion.scope === s.id}
            onclick={() => patchRegion({ scope: s.id })}
          >
            {s.label}
          </button>
        {/each}
      </div>
      {#if activeRegion.scope === "range"}
        <div class="row">
          <label class="lbl" for="rd-from">{t.panel.rangeFrom}</label>
          <input
            id="rd-from"
            class="num"
            type="number"
            min="1"
            max={Math.max(1, editor.frames.length)}
            step="1"
            value={activeRegion.from}
            onchange={onRegionNumber("from")}
          />
        </div>
        <div class="row">
          <label class="lbl" for="rd-to">{t.panel.rangeTo}</label>
          <input
            id="rd-to"
            class="num"
            type="number"
            min="1"
            max={Math.max(1, editor.frames.length)}
            step="1"
            value={activeRegion.to}
            onchange={onRegionNumber("to")}
          />
        </div>
      {/if}
    {/if}
  </section>

  <!-- 반복 -->
  <section class="sec">
    <h3>{t.panel.loop}</h3>
    <div class="row">
      <button
        type="button"
        class="chip"
        class:active={editor.loopForever}
        onclick={() => editor.setLoopForever(true)}
      >
        {t.panel.loopForever}
      </button>
      <button
        type="button"
        class="chip"
        class:active={!editor.loopForever}
        onclick={() => editor.setLoopForever(false)}
      >
        {t.panel.loopCount}
      </button>
      {#if !editor.loopForever}
        <input
          class="num"
          type="number"
          min="1"
          max="100"
          step="1"
          value={editor.loopCount}
          onchange={onLoopCountChange}
          aria-label={t.panel.loopCount}
        />
      {/if}
    </div>
  </section>

  <!-- 화질 -->
  <section class="sec">
    <h3>{t.panel.quality}</h3>
    <div class="chips">
      {#each QUALITY_PRESETS as p (p.id)}
        <button
          type="button"
          class="chip"
          class:active={editor.activePreset === p.id}
          onclick={() => editor.applyPreset(p.id)}
        >
          {PRESET_LABELS[p.id]}
        </button>
      {/each}
    </div>
    {#if editor.exportFormat !== "mp4"}
    <details class="adv">
      <summary>{t.panel.advanced}</summary>
      {#if editor.exportFormat === "gif"}
        <div class="row">
          <label class="lbl" for="colors-select">{t.panel.colors}</label>
          <select
            id="colors-select"
            class="num"
            value={String(editor.gifColors)}
            onchange={onColorsChange}
          >
            {#each GIF_COLOR_CHOICES as c (c)}
              <option value={String(c)}>{c}</option>
            {/each}
          </select>
        </div>
        <label class="row checkrow">
          <input type="checkbox" checked={editor.gifDither} onchange={onDitherChange} />
          <span class="lbl">{t.panel.dither}</span>
        </label>
        <label class="row checkrow" title={t.panel.diffHint}>
          <input type="checkbox" checked={editor.gifDiff} onchange={onDiffChange} />
          <span class="lbl">{t.panel.diff}</span>
        </label>
      {:else}
        <div class="row">
          <label class="lbl" for="webp-quality">{t.panel.webpQuality}</label>
          <input
            id="webp-quality"
            class="num"
            type="number"
            min="1"
            max="100"
            step="1"
            value={editor.webpQuality}
            onchange={onWebpQualityChange}
          />
        </div>
      {/if}
    </details>
    {/if}
  </section>

  <!-- 내보내기 -->
  <section class="sec">
    <h3>{t.panel.export}</h3>
    <div class="chips" role="group" aria-label={t.panel.format}>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "gif"}
        onclick={() => editor.setExportFormat("gif")}
      >
        GIF
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "webp"}
        onclick={() => editor.setExportFormat("webp")}
      >
        WebP
      </button>
      <button
        type="button"
        class="chip"
        class:active={editor.exportFormat === "mp4"}
        onclick={() => editor.setExportFormat("mp4")}
      >
        MP4
      </button>
    </div>
    <span class="namefield">
      <input
        class="fname"
        bind:value={filename}
        aria-label={t.panel.fileName}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="ext">.{ext}</span>
    </span>

    <button
      type="button"
      class="btn primary"
      onclick={make}
      disabled={editor.busy || editor.frames.length === 0}
    >
      <Icon name="film" size={15} />
      {result ? t.panel.reEncode : t.panel.encodeAction(fmtLabel)}
    </button>

    {#if result}
      <div class="result" class:stale>
        <p class="result-size">
          {t.panel.resultReady(FORMAT_LABELS[result.fmt], formatBytes(result.blob.size))}
        </p>
        {#if stale}
          <p class="result-note">{t.panel.resultStale}</p>
        {/if}
        <button type="button" class="btn primary" onclick={saveResult} disabled={stale}>
          <Icon name="download" size={15} /> {t.panel.download}
        </button>
      </div>
    {/if}

    <button
      type="button"
      class="btn"
      onclick={extract}
      disabled={editor.busy || editor.frames.length === 0}
    >
      <Icon name="image" size={15} /> {t.panel.extractPng}
    </button>

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
    font-size: var(--text-sm);
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
  .row.wrap {
    flex-wrap: wrap;
  }

  .info {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sub {
    margin: 0;
    font-size: var(--text-md);
    color: var(--text-muted);
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
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .chip:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }
  .chip.active {
    background: var(--accent-weak);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent-ink);
  }

  /* 조건이 참일 때만 붙는 경고 배지 — 컨트롤 옆자리를 쓰고 문단으로 자라지 않는다. */
  .badge {
    align-self: center;
    padding: var(--space-2xs) var(--space-sm);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: help;
  }

  .lbl {
    font-size: var(--text-md);
    color: var(--text-muted);
    flex: 1;
  }
  .num {
    width: 76px;
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

  /* 텍스트 오버레이 목록 */
  .olist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .orow {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding-right: var(--space-2xs);
  }
  .orow.active {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: var(--accent-weak);
  }
  .opick {
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: var(--space-xs) var(--space-sm);
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: var(--text-md);
    font-family: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .orow.active .opick {
    color: var(--accent-ink);
    font-weight: 600;
  }

  .otext {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-base);
    font-family: inherit;
    line-height: 1.4;
  }
  .otext:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  /* 캔버스에 칠할 색 — UI 색이 아니라 그림 내용이라 토큰이 아닌 사용자 값을 담는다. */
  .color {
    width: 44px;
    height: 30px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .color:focus {
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

  .adv summary {
    cursor: pointer;
    font-size: var(--text-md);
    color: var(--text-muted);
    user-select: none;
  }
  .adv[open] summary {
    margin-bottom: 8px;
  }
  .adv {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .checkrow {
    cursor: pointer;
  }
  .checkrow input {
    accent-color: var(--accent);
  }

  @media (max-width: 760px) {
    .panel {
      width: auto;
      overflow-y: visible;
    }
  }
</style>
