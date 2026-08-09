<script lang="ts">
  import { t } from "../i18n";
  import { editor } from "./state.svelte";
  import { processItem } from "../image/pipeline";
  import { formatBytes } from "../image/save";

  const DEBOUNCE_MS = 200;

  let view = $state<"result" | "original">("result");
  let computing = $state(false);

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

  const item = $derived(editor.currentItem);
  const deltaPct = $derived.by(() => {
    if (!item || !result) return 0;
    return Math.round(((result.bytes - item.bytes.byteLength) / item.bytes.byteLength) * 100);
  });
  const shownUrl = $derived(view === "original" ? origUrl : (result?.url ?? origUrl));
</script>

<div class="preview">
  <div class="stagebox">
    {#if item}
      <img class="shot" src={shownUrl} alt={item.name} />
    {/if}

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

    {#if computing}
      <span class="computing">{t.preview.computing}</span>
    {/if}
  </div>

  <div class="meta">
    {#if item && result}
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
