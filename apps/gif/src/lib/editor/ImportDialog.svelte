<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";
  import { editor } from "./state.svelte";

  const SCALE_OPTIONS = [100, 75, 50, 25];

  let dialogEl = $state<HTMLDialogElement | null>(null);

  // showModal()이 포커스 트랩·배경 inert·Escape 닫기를 전부 켠다
  $effect(() => {
    const el = dialogEl;
    if (!el || el.open) return;
    el.showModal();
  });

  let fps = $state(12);
  let scalePct = $state(100);
  let startS = $state(0);
  let endS = $state(0);

  // 다이얼로그가 열릴 때마다 해당 동영상 기준으로 초기화
  $effect(() => {
    const d = editor.videoDialog;
    if (!d) return;
    fps = 12;
    scalePct = defaultScale(d.width);
    startS = 0;
    endS = round1(d.durationS);
  });

  /** 큰 원본은 기본 배율을 낮춰 제안 (강제 아님). */
  function defaultScale(width: number): number {
    if (width > 1280) return 25;
    if (width > 640) return 50;
    return 100;
  }

  const round1 = (v: number) => Math.round(v * 10) / 10;

  const estFrames = $derived(Math.max(1, Math.ceil((endS - startS) * fps)));
  const invalid = $derived(endS - startS <= 0 || fps < 1);

  function onFpsChange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) fps = Math.min(60, Math.max(1, Math.round(v)));
  }
  function onStartChange(e: Event) {
    const d = editor.videoDialog;
    const v = Number((e.target as HTMLInputElement).value);
    if (d && Number.isFinite(v)) startS = Math.min(Math.max(0, v), round1(d.durationS));
  }
  function onEndChange(e: Event) {
    const d = editor.videoDialog;
    const v = Number((e.target as HTMLInputElement).value);
    if (d && Number.isFinite(v)) endS = Math.min(Math.max(0, v), round1(d.durationS));
  }

  function confirm() {
    if (invalid) return;
    void editor.confirmVideoImport({ fps, scale: scalePct / 100, startS, endS });
  }
</script>

{#if editor.videoDialog}
  {@const d = editor.videoDialog}
  <!-- 네이티브 dialog — Escape·포커스 트랩·배경 inert를 브라우저가 처리한다 -->
  <dialog
    bind:this={dialogEl}
    class="backdrop"
    aria-label={t.video.dialogTitle}
    onclose={() => editor.cancelVideoImport()}
  >
    <div class="modal">
      <h2>{t.video.dialogTitle}</h2>
      <p class="meta" title={d.file.name}>{d.file.name}</p>
      <p class="meta">{t.video.meta(d.width, d.height, String(round1(d.durationS)))}</p>

      <div class="row">
        <label class="lbl" for="video-fps">{t.video.fps}</label>
        <input
          id="video-fps"
          class="num"
          type="number"
          min="1"
          max="60"
          step="1"
          value={fps}
          onchange={onFpsChange}
        />
      </div>

      <div class="field">
        <span class="lbl">{t.video.scale}</span>
        <div class="chips">
          {#each SCALE_OPTIONS as pct (pct)}
            <button
              type="button"
              class="chip"
              class:active={scalePct === pct}
              onclick={() => (scalePct = pct)}
            >
              {t.video.scaleOption(pct, Math.round((d.width * pct) / 100))}
            </button>
          {/each}
        </div>
      </div>

      <div class="field">
        <span class="lbl">{t.video.range}</span>
        <div class="row">
          <label class="sub" for="video-start">{t.video.rangeStart}</label>
          <input
            id="video-start"
            class="num"
            type="number"
            min="0"
            max={round1(d.durationS)}
            step="0.1"
            value={startS}
            onchange={onStartChange}
          />
          <label class="sub" for="video-end">{t.video.rangeEnd}</label>
          <input
            id="video-end"
            class="num"
            type="number"
            min="0"
            max={round1(d.durationS)}
            step="0.1"
            value={endS}
            onchange={onEndChange}
          />
        </div>
      </div>

      <p class="est">{t.video.estFrames(estFrames)}</p>

      <div class="actions">
        <button type="button" class="btn" onclick={() => dialogEl?.close()}>
          {t.video.cancel}
        </button>
        <button type="button" class="btn primary" onclick={confirm} disabled={invalid}>
          <Icon name="download" size={15} /> {t.video.import}
        </button>
      </div>
    </div>
  </dialog>
{/if}

<style>
  .backdrop {
    /* dialog 기본값(border/padding/그림자)을 걷어내고 전체 화면 중앙 정렬로 */
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .backdrop:not([open]) {
    display: none;
  }
  .backdrop::backdrop {
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    backdrop-filter: blur(2px);
  }
  .modal {
    width: 340px;
    max-width: calc(100vw - 40px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
  }
  h2 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
  }
  .meta {
    margin: 0;
    font-size: var(--text-md);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    font-size: var(--text-md);
    color: var(--text-muted);
    flex: 1;
  }
  .sub {
    font-size: var(--text-sm);
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
    font-variant-numeric: tabular-nums;
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
  .est {
    margin: 0;
    font-size: var(--text-md);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 4px;
  }
</style>
