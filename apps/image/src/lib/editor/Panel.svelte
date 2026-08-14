<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { zipSync } from "fflate";
  import { CROP_RATIOS, CROP_RATIO_ORIGINAL, editor } from "./state.svelte";
  import { processItem } from "../image/pipeline";
  import { effectiveFit, effectiveSize, fitPlan, targetSize } from "../image/size";
  import { readExifDisplay, type ExifDisplay } from "../image/exif";
  import { downloadBlob, formatBytes } from "../image/save";
  import {
    OUTPUT_EXT,
    mayHaveAlpha,
    supportsExifKeep,
    type FitMode,
    type OutputFormat,
    type ResizeMode,
  } from "../image/types";

  const FORMAT_LABELS: Record<OutputFormat, string> = {
    jpeg: "JPG",
    png: "PNG",
    webp: "WebP",
    avif: "AVIF",
  };

  const RESIZE_MODES: { id: ResizeMode; label: string }[] = [
    { id: "none", label: t.panel.sizeOriginal },
    { id: "scale", label: t.panel.sizeScale },
    { id: "width", label: t.panel.sizeWidth },
    { id: "height", label: t.panel.sizeHeight },
    { id: "longest", label: t.panel.sizeLongest },
    { id: "exact", label: t.panel.sizeExact },
  ];

  const SCALE_PRESETS = [25, 50, 75, 100];

  /** '늘리지 않기'가 뜻을 갖는 모드 — 목표 치수를 직접 적는 쪽만이다.
   *  배율은 부른 배수가 곧 요청이고, 정확히는 캔버스가 고정이라 둘 다 빠진다. */
  const NO_ENLARGE_MODES: ResizeMode[] = ["width", "height", "longest"];

  const FIT_MODES: { id: FitMode; label: string }[] = [
    { id: "stretch", label: t.panel.fitStretch },
    { id: "contain", label: t.panel.fitContain },
    { id: "cover", label: t.panel.fitCover },
  ];

  const PAD_PRESETS: { label: string; value: string | null }[] = [
    { label: t.panel.padWhite, value: "#ffffff" },
    { label: t.panel.padBlack, value: "#000000" },
    { label: t.panel.padTransparent, value: null },
  ];

  let filename = $state("");
  let status = $state("");

  const ext = $derived(OUTPUT_EXT[editor.format]);
  const multiple = $derived(editor.items.length > 1);
  const nameFallback = $derived(
    multiple ? "images" : baseName(editor.items[0]?.name ?? "image"),
  );
  const currentCrop = $derived(editor.currentItem?.transform.crop ?? null);
  const currentEdited = $derived.by(() => {
    const tf = editor.currentItem?.transform;
    return !!tf && (tf.rotation !== 0 || tf.flipX || tf.flipY || tf.crop !== null);
  });

  // 목표 치수·배치는 파이프라인과 같은 함수로 구한다 — 안내문이 결과와 어긋나지 않게.
  const outDims = $derived.by(() => {
    const item = editor.currentItem;
    if (!item) return null;
    const eff = effectiveSize(item);
    const target = targetSize(eff.w, eff.h, editor.resizeSpec);
    const fit = effectiveFit(editor.resizeSpec);
    const plan = fitPlan(eff.w, eff.h, target.w, target.h, fit);
    return {
      eff,
      target,
      fit,
      plan,
      padded: plan.draw.w !== target.w || plan.draw.h !== target.h,
      cropped: plan.src.w !== eff.w || plan.src.h !== eff.h,
    };
  });

  /** 체인이 이어 주는 기준 비율 — 현재 장의 편집 후 가로/세로. */
  const aspect = $derived(outDims ? outDims.eff.w / outDims.eff.h : null);

  /** 늘리기가 실제로 비율을 눌러 버리는가 — 목표를 손으로 적는 정확히 모드에서만 생긴다.
   *  1% 넘게 어긋날 때만 참으로 본다(1px 반올림까지 경고하면 배지가 상시 노출이 된다). */
  const stretchDistorts = $derived.by(() => {
    if (!outDims || outDims.fit !== "stretch") return false;
    const source = outDims.eff.w / outDims.eff.h;
    const target = outDims.target.w / outDims.target.h;
    return Math.abs(source / target - 1) > 0.01;
  });

  /** JPEG로 내보내 투명이 사라지는가 — 알파를 담을 수 있는 원본이거나, 여백을 투명으로 둔 경우. */
  const alphaLost = $derived.by(() => {
    if (editor.format !== "jpeg") return false;
    const transparentPad =
      editor.resizeMode === "exact" &&
      editor.resizeFit === "contain" &&
      editor.padColor === null;
    return transparentPad || editor.items.some((i) => mayHaveAlpha(i.mime));
  });

  // ── EXIF 표시 (장별 캐시) ─────────────────────────
  const exifCache = new Map<string, ExifDisplay | null>();
  let exifInfo = $state<ExifDisplay | null>(null);
  let exifLoading = $state(false);
  $effect(() => {
    const item = editor.currentItem;
    if (!item) {
      exifInfo = null;
      return;
    }
    const cached = exifCache.get(item.id);
    if (cached !== undefined) {
      exifInfo = cached;
      return;
    }
    let cancelled = false;
    exifLoading = true;
    exifInfo = null;
    void readExifDisplay(item).then((info) => {
      if (cancelled) return;
      exifCache.set(item.id, info);
      exifInfo = info;
      exifLoading = false;
    });
    return () => {
      cancelled = true;
      exifLoading = false;
    };
  });

  function baseName(name: string): string {
    return name.replace(/\.[^.]+$/, "");
  }

  function cleanName(): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, "").trim();
    return clean || nameFallback;
  }

  function activateMode(mode: ResizeMode) {
    const item = editor.currentItem;
    editor.setResizeMode(mode, item ? effectiveSize(item) : null);
  }

  /** 비율 프리셋 칩의 표시 — 세로로 뒤집으면 값도 뒤집어 보여 준다. */
  function ratioLabel(r: { label: string; w: number; h: number }): string {
    return editor.cropPortrait ? `${r.h}:${r.w}` : r.label;
  }

  function toggleCropMode() {
    if (editor.cropMode) editor.cancelCrop();
    else editor.startCrop();
  }
  function onKeepExifChange(e: Event) {
    editor.setKeepExif((e.target as HTMLInputElement).checked);
  }
  function onApplyAllChange(e: Event) {
    editor.setApplyToAll((e.target as HTMLInputElement).checked);
  }
  function onNoEnlargeChange(e: Event) {
    editor.setNoEnlarge((e.target as HTMLInputElement).checked);
  }

  function onQualityInput(e: Event) {
    editor.setQuality(Number((e.target as HTMLInputElement).value));
  }
  function onScaleChange(e: Event) {
    editor.setResizeScale(Number((e.target as HTMLInputElement).value));
  }
  function onWidthChange(e: Event) {
    editor.setResizeWidth(Number((e.target as HTMLInputElement).value), linkRatio());
  }
  function onHeightChange(e: Event) {
    editor.setResizeHeight(Number((e.target as HTMLInputElement).value), linkRatio());
  }
  function onLongestChange(e: Event) {
    editor.setResizeLongest(Number((e.target as HTMLInputElement).value));
  }
  function onPadColorInput(e: Event) {
    editor.setPadColor((e.target as HTMLInputElement).value);
  }

  /** 체인이 걸리는 조건 — 정확히 모드에서만 두 변이 서로를 끈다. */
  function linkRatio(): number | null {
    return editor.resizeMode === "exact" ? aspect : null;
  }

  // ── 저장: 한 장 = 파일, 여러 장 = ZIP 한 개 ────────
  async function saveAll() {
    const items = editor.items;
    if (!items.length || editor.busy) return;
    editor.error = "";
    editor.saveFailed = [];
    status = "";
    editor.busy = true;
    try {
      const settings = editor.settings;
      if (items.length === 1) {
        editor.busyMsg = t.panel.converting(items[0].name, 1, 1);
        const r = await processItem(items[0], settings);
        downloadBlob(r.blob, `${cleanName()}.${ext}`);
        status = t.panel.savedOne(formatBytes(r.blob.size));
      } else {
        const files: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        const failed: string[] = [];
        const errs: string[] = [];
        let total = 0;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          editor.busyMsg = t.panel.converting(item.name, i + 1, items.length);
          // 장별로 잡는다 — 한 장이 실패해도 나머지는 묶어서 내보낸다.
          try {
            const r = await processItem(item, settings);
            files[uniqueName(used, baseName(item.name))] = new Uint8Array(
              await r.blob.arrayBuffer(),
            );
            total += r.blob.size;
          } catch (err) {
            failed.push(item.id);
            errs.push(err instanceof Error ? err.message : String(err));
          }
        }
        editor.saveFailed = failed;
        if (errs.length) {
          editor.error =
            errs.length === 1 ? errs[0] : t.errors.andMore(errs[0], errs.length - 1);
        }
        const ok = items.length - failed.length;
        if (!ok) return;
        editor.busyMsg = t.panel.zipping;
        // 이미지 포맷은 이미 압축돼 있으므로 저장(무압축) 모드로 빠르게 묶음.
        const zipped = zipSync(files, { level: 0 });
        const buf = new Uint8Array(zipped.byteLength);
        buf.set(zipped);
        downloadBlob(new Blob([buf], { type: "application/zip" }), `${cleanName()}.zip`);
        status = failed.length
          ? t.panel.savedZipPartial(ok, formatBytes(total), failed.length)
          : t.panel.savedZip(ok, formatBytes(total));
      }
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
    }
  }

  function uniqueName(used: Set<string>, base: string): string {
    let name = `${base}.${ext}`;
    let i = 1;
    while (used.has(name)) name = `${base} (${i++}).${ext}`;
    used.add(name);
    return name;
  }
</script>

<aside class="panel">
  <!-- 형식 -->
  <section class="sec">
    <h3>{t.panel.format}</h3>
    <div class="chips" role="group" aria-label={t.panel.format}>
      {#each Object.entries(FORMAT_LABELS) as [id, label] (id)}
        <button
          type="button"
          class="chip"
          class:active={editor.format === id}
          onclick={() => editor.setFormat(id as OutputFormat)}
        >
          {label}
        </button>
      {/each}
      {#if alphaLost}
        <span class="badge" title={t.panel.alphaWarnHint}>{t.panel.alphaWarn}</span>
      {/if}
    </div>
  </section>

  <!-- 품질 (PNG는 무손실이라 조절할 것이 없다) -->
  {#if editor.format !== "png"}
    <section class="sec">
      <h3>{t.panel.quality}</h3>
      <div class="row">
        <input
          class="slider"
          type="range"
          min="1"
          max="100"
          step="1"
          value={editor.quality}
          oninput={onQualityInput}
          aria-label={t.panel.quality}
        />
        <input
          class="num"
          type="number"
          min="1"
          max="100"
          step="1"
          value={editor.quality}
          onchange={onQualityInput}
          aria-label={t.panel.quality}
        />
      </div>
    </section>
  {/if}

  <!-- 크기 -->
  <section class="sec">
    <h3>{t.panel.size}</h3>
    <div class="chips">
      {#each RESIZE_MODES as m (m.id)}
        <button
          type="button"
          class="chip"
          class:active={editor.resizeMode === m.id}
          onclick={() => activateMode(m.id)}
        >
          {m.label}
        </button>
      {/each}
    </div>
    {#if editor.resizeMode === "scale"}
      <div class="chips" role="group" aria-label={t.panel.sizeScale}>
        {#each SCALE_PRESETS as p (p)}
          <button
            type="button"
            class="chip"
            class:active={editor.resizeScale === p}
            onclick={() => editor.setResizeScale(p)}
          >
            {p}{t.panel.scaleUnit}
          </button>
        {/each}
      </div>
      <div class="row">
        <label class="lbl" for="resize-scale">{t.panel.sizeScale}({t.panel.scaleUnit})</label>
        <input
          id="resize-scale"
          class="num"
          type="number"
          min="1"
          max="400"
          step="1"
          value={editor.resizeScale}
          onchange={onScaleChange}
        />
      </div>
    {:else if editor.resizeMode === "width"}
      <div class="row">
        <label class="lbl" for="resize-width">{t.panel.sizeWidth}({t.panel.pxUnit})</label>
        <input
          id="resize-width"
          class="num"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeWidth}
          onchange={onWidthChange}
        />
      </div>
    {:else if editor.resizeMode === "height"}
      <div class="row">
        <label class="lbl" for="resize-height">{t.panel.sizeHeight}({t.panel.pxUnit})</label>
        <input
          id="resize-height"
          class="num"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeHeight}
          onchange={onHeightChange}
        />
      </div>
    {:else if editor.resizeMode === "longest"}
      <div class="row">
        <label class="lbl" for="resize-longest">
          {t.panel.sizeLongest}({t.panel.pxUnit})
        </label>
        <input
          id="resize-longest"
          class="num"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeLongest}
          onchange={onLongestChange}
        />
      </div>
    {:else if editor.resizeMode === "exact"}
      <p class="info">{t.panel.sizeExactLabel}</p>
      <div class="row">
        <input
          class="num grow"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeWidth}
          onchange={onWidthChange}
          aria-label="{t.panel.sizeWidth}({t.panel.pxUnit})"
        />
        <button
          type="button"
          class="icon-btn"
          class:active={editor.lockRatio}
          aria-pressed={editor.lockRatio}
          aria-label={t.panel.lockRatio}
          title={t.panel.lockRatio}
          onclick={() => editor.setLockRatio(!editor.lockRatio, aspect)}
        >
          <Icon name={editor.lockRatio ? "link" : "link-off"} size={15} />
        </button>
        <input
          class="num grow"
          type="number"
          min="1"
          max="20000"
          step="1"
          value={editor.resizeHeight}
          onchange={onHeightChange}
          aria-label="{t.panel.sizeHeight}({t.panel.pxUnit})"
        />
      </div>

      <div class="chips" role="group" aria-label={t.panel.fit}>
        {#each FIT_MODES as f (f.id)}
          <button
            type="button"
            class="chip"
            class:active={editor.resizeFit === f.id}
            onclick={() => editor.setResizeFit(f.id)}
          >
            {f.label}
          </button>
        {/each}
        {#if stretchDistorts && outDims}
          <span
            class="badge"
            title={t.panel.fitStretchWarnHint(
              outDims.eff.w,
              outDims.eff.h,
              outDims.target.w,
              outDims.target.h,
            )}
          >
            {t.panel.fitStretchWarn}
          </span>
        {/if}
      </div>

      {#if editor.resizeFit === "contain"}
        <div class="chips" role="group" aria-label={t.panel.padColor}>
          {#each PAD_PRESETS as p (p.label)}
            <button
              type="button"
              class="chip"
              class:active={editor.padColor === p.value}
              onclick={() => editor.setPadColor(p.value)}
            >
              {p.label}
            </button>
          {/each}
          <input
            class="swatch"
            type="color"
            value={editor.padColor ?? "#ffffff"}
            oninput={onPadColorInput}
            aria-label={t.panel.padCustom}
            title={t.panel.padCustom}
          />
        </div>
      {/if}
    {/if}

    {#if NO_ENLARGE_MODES.includes(editor.resizeMode)}
      <label class="row checkrow">
        <input
          type="checkbox"
          checked={editor.noEnlarge}
          onchange={onNoEnlargeChange}
        />
        <span class="lbl">{t.panel.noEnlarge}</span>
      </label>
    {/if}

    {#if outDims}
      <p class="info">
        {#if currentEdited}
          {t.panel.sizeInfoEdited(
            outDims.eff.w,
            outDims.eff.h,
            outDims.target.w,
            outDims.target.h,
          )}
        {:else}
          {t.panel.sizeInfo(
            outDims.eff.w,
            outDims.eff.h,
            outDims.target.w,
            outDims.target.h,
          )}
        {/if}
      </p>
      {#if outDims.fit === "contain" && outDims.padded}
        <p class="info">{t.panel.fitContainInfo(outDims.plan.draw.w, outDims.plan.draw.h)}</p>
      {:else if outDims.fit === "cover" && outDims.cropped}
        <p class="info">{t.panel.fitCoverInfo(outDims.plan.src.w, outDims.plan.src.h)}</p>
      {/if}
    {/if}
  </section>

  <!-- 편집 (크롭·회전·반전) — 기본은 선택한 장, 모든 장에 적용을 켜면 전부 -->
  <section class="sec">
    <h3>{t.edit.title}</h3>
    <div class="row wrap">
      <button
        type="button"
        class="btn small"
        class:active={editor.cropMode}
        onclick={toggleCropMode}
      >
        <Icon name="crop" size={14} />
        {editor.cropMode ? t.edit.cropCancel : t.edit.cropStart}
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label={t.edit.rotateCcw}
        title={t.edit.rotateCcw}
        onclick={() => editor.rotate(-1)}
      >
        <Icon name="rotate-ccw" size={15} />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label={t.edit.rotateCw}
        title={t.edit.rotateCw}
        onclick={() => editor.rotate(1)}
      >
        <Icon name="rotate" size={15} />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label={t.edit.flipX}
        title={t.edit.flipX}
        onclick={() => editor.flip("x")}
      >
        <Icon name="flip-x" size={15} />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label={t.edit.flipY}
        title={t.edit.flipY}
        onclick={() => editor.flip("y")}
      >
        <Icon name="flip-y" size={15} />
      </button>
    </div>
    {#if editor.cropMode}
      <div class="chips" role="group" aria-label={t.edit.ratioGroup}>
        <button
          type="button"
          class="chip"
          class:active={editor.cropRatioId === null}
          onclick={() => editor.setCropRatio(null)}
        >
          {t.edit.ratioFree}
        </button>
        <button
          type="button"
          class="chip"
          class:active={editor.cropRatioId === CROP_RATIO_ORIGINAL}
          title={t.edit.ratioOriginal}
          onclick={() => editor.setCropRatio(CROP_RATIO_ORIGINAL)}
        >
          {t.edit.ratioOriginalShort}
        </button>
        {#each CROP_RATIOS as r (r.id)}
          <button
            type="button"
            class="chip"
            class:active={editor.cropRatioId === r.id}
            onclick={() => editor.setCropRatio(r.id)}
          >
            {ratioLabel(r)}
          </button>
        {/each}
        <button
          type="button"
          class="chip"
          class:active={editor.cropPortrait}
          aria-pressed={editor.cropPortrait}
          disabled={editor.cropRatioId === null}
          title={t.edit.portrait}
          onclick={() => editor.toggleCropPortrait()}
        >
          {t.edit.portraitShort}
        </button>
      </div>
    {/if}
    {#if currentCrop}
      <div class="row">
        <p class="info grow">{t.edit.cropRect(currentCrop.w, currentCrop.h)}</p>
        <button type="button" class="btn small" onclick={() => editor.setCrop(null)}>
          {t.edit.cropClear}
        </button>
      </div>
    {/if}
    {#if multiple}
      <label class="row checkrow">
        <input
          type="checkbox"
          checked={editor.applyToAll}
          onchange={onApplyAllChange}
        />
        <span class="lbl">{t.edit.applyAll}</span>
      </label>
    {/if}
    {#if currentEdited || (multiple && editor.applyToAll)}
      <button type="button" class="btn small ghost" onclick={() => editor.resetEdit()}>
        {t.edit.reset}
      </button>
    {/if}
  </section>

  <!-- EXIF -->
  <section class="sec">
    <h3>{t.exif.title}</h3>
    {#if exifLoading}
      <p class="info">{t.exif.loading}</p>
    {:else if exifInfo}
      <dl class="kv">
        {#if exifInfo.date}<dt>{t.exif.date}</dt><dd>{exifInfo.date}</dd>{/if}
        {#if exifInfo.camera}<dt>{t.exif.camera}</dt><dd>{exifInfo.camera}</dd>{/if}
        {#if exifInfo.exposure}<dt>{t.exif.exposure}</dt><dd>{exifInfo.exposure}</dd>{/if}
        {#if exifInfo.gps}<dt>{t.exif.gps}</dt><dd>{exifInfo.gps}</dd>{/if}
      </dl>
    {:else}
      <p class="info">{t.exif.none}</p>
    {/if}
    <label class="row checkrow">
      <input
        type="checkbox"
        checked={editor.keepExif}
        disabled={!supportsExifKeep(editor.format)}
        onchange={onKeepExifChange}
      />
      <span class="lbl">{t.exif.keep}</span>
    </label>
  </section>

  <!-- 내보내기 -->
  <section class="sec">
    <h3>{t.panel.export}</h3>
    <span class="namefield">
      <input
        class="fname"
        bind:value={filename}
        placeholder={nameFallback}
        aria-label={t.panel.fileName}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="ext">.{multiple ? "zip" : ext}</span>
    </span>

    <button
      type="button"
      class="btn primary"
      onclick={saveAll}
      disabled={editor.busy || editor.items.length === 0}
    >
      <Icon name="download" size={15} /> {t.panel.save}
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
    white-space: nowrap;
    cursor: help;
  }

  .lbl {
    font-size: var(--text-md);
    color: var(--text-muted);
    flex: 1;
  }
  .slider {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
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
  /* 두 변을 나란히 놓을 땐 남는 폭을 반씩 나눠 갖는다. */
  .num.grow {
    width: auto;
    flex: 1;
    min-width: 0;
  }

  .swatch {
    width: 30px;
    height: 26px;
    flex: none;
    padding: 2px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
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

  .status {
    margin: 0;
    font-size: var(--text-md);
    color: var(--text-muted);
  }

  .info.grow {
    flex: 1;
  }

  .kv {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    font-size: var(--text-sm);
  }
  .kv dt {
    color: var(--text-muted);
  }
  .kv dd {
    margin: 0;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
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
