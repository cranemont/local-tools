<script lang="ts">
  import { t } from "../i18n";
  import { editor, MIN_CROP } from "./state.svelte";
  import { processItem, renderRotated, rotatedSize } from "../image/pipeline";
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
  /** 마지막 결과 URL — 반응 추적 밖에 둬야 이 값을 읽는 것이 재계산을 부르지 않는다. */
  let lastResultUrl = "";

  $effect(() => {
    const item = editor.currentItem;
    const settings = editor.settings;
    void editor.revision;
    if (!item) {
      if (lastResultUrl) URL.revokeObjectURL(lastResultUrl);
      lastResultUrl = "";
      result = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      computing = true;
      try {
        const r = await processItem(item, settings);
        if (cancelled) return;
        const prev = lastResultUrl;
        lastResultUrl = URL.createObjectURL(r.blob);
        result = { url: lastResultUrl, bytes: r.blob.size, w: r.width, h: r.height };
        // 새 결과를 올린 뒤에 이전 URL을 놓아 준다. 미리 놓으면 크롭 모드에서
        // 돌아오는 순간 img가 이미 회수된 URL을 다시 받으러 가 그림이 깨진다.
        if (prev) URL.revokeObjectURL(prev);
      } catch (err) {
        if (!cancelled) editor.error = err instanceof Error ? err.message : String(err);
      } finally {
        if (!cancelled) computing = false;
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
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

  // ── 크롭 영역 잡기 ────────────────────────────────
  // 화면 좌표 ↔ 이미지 좌표를 오가므로 기준이 두 개 필요하다:
  //   rot   = 회전 적용 후(크롭 전) 이미지 크기 — CropRect의 좌표계
  //   paint = 실제로 그려진 그림의 상자(stagebox 기준) — 여백을 제외한 진짜 범위
  interface ViewRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const HANDLES = [
    { id: "nw", sx: -1, sy: -1, cursor: "nwse-resize" },
    { id: "n", sx: 0, sy: -1, cursor: "ns-resize" },
    { id: "ne", sx: 1, sy: -1, cursor: "nesw-resize" },
    { id: "w", sx: -1, sy: 0, cursor: "ew-resize" },
    { id: "e", sx: 1, sy: 0, cursor: "ew-resize" },
    { id: "sw", sx: -1, sy: 1, cursor: "nesw-resize" },
    { id: "s", sx: 0, sy: 1, cursor: "ns-resize" },
    { id: "se", sx: 1, sy: 1, cursor: "nwse-resize" },
  ] as const;

  type Drag =
    | { mode: "new"; ax: number; ay: number }
    | { mode: "resize"; ax: number; ay: number; fixedX: number | null; fixedY: number | null }
    | { mode: "move"; dx: number; dy: number; w: number; h: number };

  let drag: Drag | null = null;
  let paint = $state<ViewRect | null>(null);

  const rot = $derived(item ? rotatedSize(item) : { w: 1, h: 1 });

  const draftView = $derived.by((): ViewRect | null => {
    const d = editor.cropDraft;
    const p = paint;
    if (!d || !p) return null;
    const sx = p.w / rot.w;
    const sy = p.h / rot.h;
    return { x: p.x + d.x * sx, y: p.y + d.y * sy, w: d.w * sx, h: d.h * sy };
  });

  /** 그려진 그림의 상자를 잰다 — object-fit:contain이라 요소 상자가 그림보다 클 수 있다. */
  function measurePaint() {
    const img = imgEl;
    if (!img || !boxEl || !editor.cropMode) {
      paint = null;
      return;
    }
    const r = img.getBoundingClientRect();
    const box = boxEl.getBoundingClientRect();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh || r.width < 1 || r.height < 1) {
      paint = null;
      return;
    }
    const scale = Math.min(r.width / nw, r.height / nh);
    const w = nw * scale;
    const h = nh * scale;
    // absolute 기준은 stagebox의 패딩 상자다 — 테두리 두께(clientLeft/Top)만큼 뺀다.
    paint = {
      x: r.left - box.left - boxEl.clientLeft + (r.width - w) / 2,
      y: r.top - box.top - boxEl.clientTop + (r.height - h) / 2,
      w,
      h,
    };
  }

  $effect(() => {
    const img = imgEl;
    void editor.cropMode;
    void shownUrl;
    if (!img || !boxEl) {
      paint = null;
      return;
    }
    measurePaint();
    const ro = new ResizeObserver(() => measurePaint());
    ro.observe(img);
    ro.observe(boxEl);
    return () => ro.disconnect();
  });

  function clampNum(n: number, lo: number, hi: number): number {
    return Math.min(Math.max(n, lo), hi);
  }

  /** 화면 좌표 → 이미지 좌표. 그림 밖은 가장자리로 잘린다. */
  function toImage(clientX: number, clientY: number): { x: number; y: number } {
    const p = paint!;
    const box = boxEl.getBoundingClientRect();
    // paint는 패딩 상자 기준이므로 테두리를 더해야 화면 좌표가 된다.
    const left = box.left + boxEl.clientLeft + p.x;
    const top = box.top + boxEl.clientTop + p.y;
    return {
      x: clampNum(((clientX - left) * rot.w) / p.w, 0, rot.w),
      y: clampNum(((clientY - top) * rot.h) / p.h, 0, rot.h),
    };
  }

  /** 고정점(ax,ay)과 포인터(px,py)로 사각형을 만든다. 비율이 걸려 있으면 그림 안에서 줄인다. */
  function rectFrom(
    ax: number,
    ay: number,
    px: number,
    py: number,
    ratio: number | null,
  ): ViewRect {
    let w = Math.abs(px - ax);
    let h = Math.abs(py - ay);
    const right = px >= ax;
    const down = py >= ay;
    if (ratio) {
      // 포인터가 더 많이 움직인 축을 따라가되, 경계를 넘으면 통째로 줄인다.
      if (w / ratio > h) h = w / ratio;
      else w = h * ratio;
      const maxW = right ? rot.w - ax : ax;
      const maxH = down ? rot.h - ay : ay;
      const shrink = Math.min(1, w > 0 ? maxW / w : 1, h > 0 ? maxH / h : 1);
      w *= shrink;
      h *= shrink;
    }
    return { x: right ? ax : ax - w, y: down ? ay : ay - h, w, h };
  }

  function toCropRect(r: ViewRect): CropRect {
    const x = clampNum(Math.round(r.x), 0, Math.max(0, rot.w - MIN_CROP));
    const y = clampNum(Math.round(r.y), 0, Math.max(0, rot.h - MIN_CROP));
    return {
      x,
      y,
      w: clampNum(Math.round(r.w), MIN_CROP, rot.w - x),
      h: clampNum(Math.round(r.h), MIN_CROP, rot.h - y),
    };
  }

  function cropDown(e: PointerEvent) {
    if (!paint || !item) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 활성 포인터가 없으면(합성 이벤트 등) 캡처 없이 진행
    }
    const p = toImage(e.clientX, e.clientY);
    const d = editor.cropDraft;
    const handleId = (e.target as HTMLElement).dataset.handle;
    const handle = handleId ? HANDLES.find((h) => h.id === handleId) : undefined;

    if (handle && d) {
      // 잡은 손잡이의 반대편이 고정점. 움직이지 않는 축은 현재 값으로 못 박는다.
      drag = {
        mode: "resize",
        ax: handle.sx < 0 ? d.x + d.w : d.x,
        ay: handle.sy < 0 ? d.y + d.h : d.y,
        fixedX: handle.sx === 0 ? d.x + d.w : null,
        fixedY: handle.sy === 0 ? d.y + d.h : null,
      };
    } else if (d && p.x >= d.x && p.x <= d.x + d.w && p.y >= d.y && p.y <= d.y + d.h) {
      drag = { mode: "move", dx: p.x - d.x, dy: p.y - d.y, w: d.w, h: d.h };
    } else {
      drag = { mode: "new", ax: p.x, ay: p.y };
      editor.setCropDraft(null);
    }
  }

  function cropMove(e: PointerEvent) {
    if (!drag || !paint || !item) return;
    const p = toImage(e.clientX, e.clientY);

    if (drag.mode === "move") {
      editor.setCropDraft(
        toCropRect({
          x: clampNum(p.x - drag.dx, 0, rot.w - drag.w),
          y: clampNum(p.y - drag.dy, 0, rot.h - drag.h),
          w: drag.w,
          h: drag.h,
        }),
      );
      return;
    }

    const px = drag.mode === "resize" && drag.fixedX !== null ? drag.fixedX : p.x;
    const py = drag.mode === "resize" && drag.fixedY !== null ? drag.fixedY : p.y;
    const rect = rectFrom(drag.ax, drag.ay, px, py, editor.cropRatio);
    if (rect.w < MIN_CROP || rect.h < MIN_CROP) {
      // 새로 긋는 중이면 아직 영역이 아니고, 조정 중이면 마지막 유효 값을 유지한다.
      if (drag.mode === "new") editor.setCropDraft(null);
      return;
    }
    editor.setCropDraft(toCropRect(rect));
  }

  function cropUp() {
    // 손을 떼도 자르지 않는다 — 점선으로 남겨 두고 '자르기'를 눌러야 반영된다.
    drag = null;
  }
</script>

<div class="preview">
  <div class="stagebox" bind:this={boxEl}>
    {#if item && shownUrl}
      <img
        class="shot"
        bind:this={imgEl}
        src={shownUrl}
        alt={item.name}
        draggable="false"
        onload={measurePaint}
      />
    {/if}

    {#if editor.cropMode}
      {#if paint}
        <div
          class="croplayer"
          role="application"
          aria-label={t.preview.cropArea}
          style={`left:${paint.x}px; top:${paint.y}px; width:${paint.w}px; height:${paint.h}px`}
          onpointerdown={cropDown}
          onpointermove={cropMove}
          onpointerup={cropUp}
          onpointercancel={cropUp}
        >
          {#if draftView}
            <div
              class="croprect"
              style={`left:${draftView.x - paint.x}px; top:${draftView.y - paint.y}px; width:${draftView.w}px; height:${draftView.h}px`}
            >
              {#each HANDLES as h (h.id)}
                <div class="handle {h.id}" data-handle={h.id} style={`cursor:${h.cursor}`}></div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="crophint">
        {editor.cropDraft ? t.preview.cropAdjust : t.preview.cropHint}
      </div>

      <div class="cropbar-wrap">
        <div class="cropbar">
          {#if editor.cropDraft}
            <span class="cropdims">
              {t.preview.dims(editor.cropDraft.w, editor.cropDraft.h)}
            </span>
          {/if}
          <button type="button" class="btn small" onclick={() => editor.cancelCrop()}>
            {t.edit.cropCancel}
          </button>
          <button
            type="button"
            class="btn small primary"
            disabled={!editor.cropDraft}
            onclick={() => editor.applyCropDraft()}
          >
            {t.preview.cropApply}
          </button>
        </div>
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

  /* 레이어는 그려진 그림 위에만 깔린다 — 여백에서는 선택이 시작되지 않는다. */
  .croplayer {
    position: absolute;
    cursor: crosshair;
    touch-action: none;
    overflow: hidden;
  }
  .croprect {
    position: absolute;
    border: 1.5px dashed var(--accent);
    cursor: move;
    /* 바깥을 덮어 선택 범위를 드러낸다 (레이어가 그림 밖을 잘라 낸다). */
    box-shadow: 0 0 0 9999px color-mix(in srgb, var(--bg) 62%, transparent);
  }
  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
  }
  /* 손가락·마우스 모두 잡기 쉽게 히트 영역만 넓힌다. */
  .handle::before {
    content: "";
    position: absolute;
    inset: -8px;
  }
  .handle.nw,
  .handle.ne,
  .handle.sw,
  .handle.se {
    border: 3px solid var(--accent);
  }
  .handle.nw {
    left: 0;
    top: 0;
    border-right: 0;
    border-bottom: 0;
  }
  .handle.ne {
    right: 0;
    top: 0;
    border-left: 0;
    border-bottom: 0;
  }
  .handle.sw {
    left: 0;
    bottom: 0;
    border-right: 0;
    border-top: 0;
  }
  .handle.se {
    right: 0;
    bottom: 0;
    border-left: 0;
    border-top: 0;
  }
  .handle.n,
  .handle.s {
    left: 50%;
    width: 22px;
    height: 3px;
    transform: translateX(-50%);
    background: var(--accent);
  }
  .handle.n {
    top: 0;
  }
  .handle.s {
    bottom: 0;
  }
  .handle.w,
  .handle.e {
    top: 50%;
    width: 3px;
    height: 22px;
    transform: translateY(-50%);
    background: var(--accent);
  }
  .handle.w {
    left: 0;
  }
  .handle.e {
    right: 0;
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
    font-size: var(--text-md);
    pointer-events: none;
    white-space: nowrap;
  }

  /* 폭 전체를 잡아 두고 그 안에서 가운데 정렬한다.
   * left:50%만 쓰면 쓸 수 있는 폭이 절반이라 좁은 화면에서 글자가 세로로 접힌다. */
  .cropbar-wrap {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .cropbar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    max-width: 100%;
    gap: 6px;
    padding: 6px;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-1);
    pointer-events: auto;
  }
  .cropbar button {
    flex: none;
    white-space: nowrap;
  }
  .cropdims {
    padding: 0 6px;
    font-size: var(--text-md);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
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
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 26px;
    font-size: var(--text-md);
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
    color: var(--accent-ink);
  }
  .badge.larger {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--danger);
  }
</style>
