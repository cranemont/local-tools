<script lang="ts">
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import { processItem, renderRotated } from "../image/pipeline";
  import { formatBytes } from "../image/save";
  import type { CropRect } from "../image/types";

  const DEBOUNCE_MS = 200;

  let view = $state<"result" | "original">("result");
  let computing = $state(false);

  let boxEl: HTMLDivElement;
  let imgEl = $state<HTMLImageElement | null>(null);

  // ── 원본 미리보기 URL ─────────────────────────────
  let origUrl = $state("");
  $effect(() => {
    const item = editor.currentItem;
    if (!item) {
      origUrl = "";
      return;
    }
    const url = URL.createObjectURL(new Blob([item.bytes], { type: item.mime }));
    origUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  // ── 결과 미리보기 (디바운스 재인코딩) ─────────────
  interface ResultView {
    url: string;
    bytes: number;
    w: number;
    h: number;
  }
  let result = $state<ResultView | null>(null);

  $effect(() => {
    const item = editor.currentItem;
    const settings = editor.settings;
    void editor.revision;
    if (!item) {
      result = null;
      return;
    }
    let url = "";
    let cancelled = false;
    const timer = setTimeout(async () => {
      computing = true;
      try {
        const r = await processItem(item, settings);
        if (cancelled) return;
        url = URL.createObjectURL(r.blob);
        result = { url, bytes: r.blob.size, w: r.width, h: r.height };
      } catch (err) {
        if (!cancelled) editor.error = err instanceof Error ? err.message : String(err);
      } finally {
        if (!cancelled) computing = false;
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // 이미 표시 중인 img는 revoke 후에도 유지된다.
      if (url) URL.revokeObjectURL(url);
    };
  });

  // ── 크롭 모드 바탕 (회전만 적용한 원본) ───────────
  let cropUrl = $state("");
  $effect(() => {
    if (!editor.cropMode) {
      cropUrl = "";
      return;
    }
    const item = editor.currentItem;
    if (!item) return;
    void item.transform.rotation;
    let url = "";
    let cancelled = false;
    void (async () => {
      try {
        const blob = await renderRotated(item);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        cropUrl = url;
      } catch (err) {
        if (!cancelled) editor.error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  });

  const item = $derived(editor.currentItem);
  const deltaPct = $derived.by(() => {
    if (!item || !result) return 0;
    return Math.round(((result.bytes - item.bytes.byteLength) / item.bytes.byteLength) * 100);
  });
  const shownUrl = $derived.by(() => {
    if (editor.cropMode) return cropUrl;
    return view === "original" ? origUrl : (result?.url ?? origUrl);
  });

  // ── 크롭 드래그 (비율 프리셋 제약) ─────────────────
  interface ViewRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  let cropStart: { x: number; y: number } | null = null;
  let cropView = $state<ViewRect | null>(null);

  /** 회전 적용 후(크롭 전) 이미지 크기 — 화면→이미지 좌표 변환의 기준. */
  function rotatedDims(): { w: number; h: number } {
    if (!item) return { w: 1, h: 1 };
    const swap = item.transform.rotation % 180 !== 0;
    return swap ? { w: item.height, h: item.width } : { w: item.width, h: item.height };
  }

  function clampToImg(clientX: number, clientY: number) {
    const r = imgEl!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(clientX, r.left), r.right),
      y: Math.min(Math.max(clientY, r.top), r.bottom),
    };
  }

  function cropDown(e: PointerEvent) {
    if (!imgEl) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 활성 포인터가 없으면(합성 이벤트 등) 캡처 없이 진행
    }
    cropStart = clampToImg(e.clientX, e.clientY);
    cropView = null;
  }

  function cropMove(e: PointerEvent) {
    if (!cropStart || !imgEl) return;
    const p = clampToImg(e.clientX, e.clientY);
    let w = Math.abs(p.x - cropStart.x);
    let h = Math.abs(p.y - cropStart.y);
    // 이미지가 균등 스케일로 표시되므로 화면 비율 = 이미지 비율.
    const ratio = editor.cropRatio;
    if (ratio) {
      let ch = w / ratio;
      if (ch > h) {
        w = h * ratio;
      } else {
        h = ch;
      }
    }
    const x = p.x >= cropStart.x ? cropStart.x : cropStart.x - w;
    const y = p.y >= cropStart.y ? cropStart.y : cropStart.y - h;
    const box = boxEl.getBoundingClientRect();
    cropView = { x: x - box.left, y: y - box.top, w, h };
  }

  function cropUp() {
    const view_ = cropView;
    cropStart = null;
    cropView = null;
    // 그냥 클릭이면 모드 유지
    if (!view_ || view_.w < 5 || view_.h < 5 || !imgEl) return;

    const box = boxEl.getBoundingClientRect();
    const r = imgEl.getBoundingClientRect();
    const rot = rotatedDims();
    const scaleX = rot.w / r.width;
    const scaleY = rot.h / r.height;
    const rect = clampCrop(
      Math.round((view_.x + box.left - r.left) * scaleX),
      Math.round((view_.y + box.top - r.top) * scaleY),
      Math.round(view_.w * scaleX),
      Math.round(view_.h * scaleY),
      rot.w,
      rot.h,
    );
    editor.cropMode = false;
    if (rect) editor.setCurrentCrop(rect);
  }

  function clampCrop(
    x: number,
    y: number,
    w: number,
    h: number,
    bw: number,
    bh: number,
  ): CropRect | null {
    const nx = Math.max(0, Math.min(x, bw - 1));
    const ny = Math.max(0, Math.min(y, bh - 1));
    const nw = Math.max(1, Math.min(w, bw - nx));
    const nh = Math.max(1, Math.min(h, bh - ny));
    if (nw < 4 || nh < 4) return null;
    return { x: nx, y: ny, w: nw, h: nh };
  }
</script>

<div class="preview">
  <div class="stagebox" bind:this={boxEl}>
    {#if item && shownUrl}
      <img class="shot" bind:this={imgEl} src={shownUrl} alt={item.name} draggable="false" />
    {/if}

    {#if editor.cropMode}
      <div
        class="croplayer"
        role="application"
        aria-label={t.preview.cropHint}
        onpointerdown={cropDown}
        onpointermove={cropMove}
        onpointerup={cropUp}
      >
        {#if cropView}
          <div
            class="croprect"
            style={`left:${cropView.x}px; top:${cropView.y}px; width:${cropView.w}px; height:${cropView.h}px`}
          ></div>
        {/if}
        <div class="crophint">{t.preview.cropHint}</div>
      </div>
    {:else}
      <div class="viewtoggle" role="group" aria-label={t.preview.result}>
        <button
          type="button"
          class="vbtn"
          class:active={view === "original"}
          onclick={() => (view = "original")}
        >
          {t.preview.original}
        </button>
        <button
          type="button"
          class="vbtn"
          class:active={view === "result"}
          onclick={() => (view = "result")}
        >
          {t.preview.result}
        </button>
      </div>
    {/if}

    {#if computing && !editor.cropMode}
      <span class="computing">{t.preview.computing}</span>
    {/if}
  </div>

  <div class="meta">
    {#if item && result && !editor.cropMode}
      <span class="badge" class:smaller={deltaPct < 0} class:larger={deltaPct > 0}>
        {t.preview.sizeBadge(
          formatBytes(item.bytes.byteLength),
          formatBytes(result.bytes),
          deltaPct,
        )}
      </span>
      <span class="dims">
        {t.preview.dims(item.width, item.height)}
        {#if result.w !== item.width || result.h !== item.height}
          → {t.preview.dims(result.w, result.h)}
        {/if}
      </span>
    {/if}
  </div>
</div>

<style>
  .preview {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .stagebox {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    padding: 12px;
  }

  .shot {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    /* 투명 픽셀 확인용 체커보드 */
    background: conic-gradient(
        var(--surface-2) 25%,
        transparent 0 50%,
        var(--surface-2) 0 75%,
        transparent 0
      )
      0 0 / 16px 16px;
    box-shadow: var(--shadow-1);
  }

  .croplayer {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .croprect {
    position: absolute;
    border: 1.5px dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    pointer-events: none;
  }
  .crophint {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 12.5px;
    pointer-events: none;
    white-space: nowrap;
  }

  .viewtoggle {
    position: absolute;
    top: 10px;
    left: 10px;
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .vbtn {
    border: 0;
    background: transparent;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .vbtn.active {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text);
  }

  .computing {
    position: absolute;
    top: 14px;
    right: 14px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 26px;
    font-size: 12.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .badge {
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-weight: 600;
    color: var(--text);
  }
  .badge.smaller {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: var(--accent-weak);
    color: var(--accent);
  }
  .badge.larger {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--danger);
  }
</style>
