<script lang="ts">
  import Icon from "../Icon.svelte";
  import { fmtTime, t } from "../i18n";
  import { downloadBlob } from "../video/save";
  import { frameAt } from "../video/thumbs";
  import { editor } from "./state.svelte";

  let videoEl: HTMLVideoElement | undefined = $state();
  let raf = 0;
  /** 미리보기 상자 크기 — 회전했을 때 그림이 상자 안에 들어가도록 줄이는 데 쓴다. */
  let boxW = $state(0);
  let boxH = $state(0);

  // video 엘리먼트를 상태에 노출 (Timeline·Panel의 seek용)
  $effect(() => {
    editor.videoEl = videoEl ?? null;
    return () => {
      if (editor.videoEl === videoEl) editor.videoEl = null;
    };
  });

  // 재생 중엔 rAF로 플레이헤드를 부드럽게 갱신하고, 구간 재생이면 끝에서 멈춘다.
  function tick() {
    if (!videoEl) return;
    editor.currentTime = videoEl.currentTime;
    if (editor.rangePlaying && videoEl.currentTime >= editor.trimEnd) {
      videoEl.pause();
      videoEl.currentTime = editor.trimEnd;
      editor.currentTime = editor.trimEnd;
      editor.rangePlaying = false;
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  function onPlay() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function onPauseOrEnd() {
    cancelAnimationFrame(raf);
    editor.rangePlaying = false;
    if (videoEl) editor.currentTime = videoEl.currentTime;
  }
  $effect(() => () => cancelAnimationFrame(raf));

  $effect(() => {
    if (!videoEl) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      boxW = r.width;
      boxH = r.height;
    });
    ro.observe(videoEl);
    return () => ro.disconnect();
  });

  /** 회전·반전 미리보기 — 내보내기와 같은 순서(회전 → 반전)로 보이게 쌓는다.
   * CSS는 오른쪽부터 그림에 걸리므로 반전을 회전보다 왼쪽에 쓴다. */
  const previewTransform = $derived.by(() => {
    const parts: string[] = [];
    if (editor.flipV) parts.push("scaleY(-1)");
    if (editor.flipH) parts.push("scaleX(-1)");
    if (editor.rotate) parts.push(`rotate(${editor.rotate}deg)`);
    if (parts.length === 0) return "";
    const m = editor.meta;
    if (editor.rotate % 180 !== 0 && m && boxW > 0 && boxH > 0) {
      // object-fit:contain으로 그려진 크기를 재서, 눕힌 그림이 상자를 넘지 않게 줄인다.
      const fit = Math.min(boxW / m.width, boxH / m.height);
      const k = Math.min(boxW / (m.height * fit), boxH / (m.width * fit));
      if (k < 1) parts.push(`scale(${k.toFixed(4)})`);
    }
    return parts.join(" ");
  });

  // ── 현재 프레임 저장 ──────────────────────────────
  async function saveFrame() {
    const file = editor.file;
    if (!file || editor.busy) return;
    videoEl?.pause();
    editor.error = "";
    editor.busy = true;
    editor.busyMsg = t.player.savingFrame;
    try {
      const blob = await frameAt(file, editor.currentTime, {
        rotate: editor.rotate,
        flipH: editor.flipH,
        flipV: editor.flipV,
      });
      if (!blob) {
        editor.error = t.player.noFrame;
        return;
      }
      const stem = file.name.replace(/\.[^.]+$/, "") || "frame";
      downloadBlob(blob, `${stem}-${editor.currentTime.toFixed(1)}s.png`);
    } catch (err) {
      editor.error = err instanceof Error ? err.message : String(err);
    } finally {
      editor.busy = false;
      editor.busyMsg = "";
    }
  }
</script>

<div class="player">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    src={editor.videoUrl}
    controls
    playsinline
    style:transform={previewTransform}
    onplay={onPlay}
    onpause={onPauseOrEnd}
    onended={onPauseOrEnd}
    onseeked={() => videoEl && (editor.currentTime = videoEl.currentTime)}
  ></video>
  <div class="bar">
    <button
      type="button"
      class="icon-btn"
      aria-label={t.player.stepBack}
      title={t.player.stepBack}
      onclick={() => editor.nudge(-editor.frameStep)}
    >
      <Icon name="stepBack" size={14} />
    </button>
    <button
      type="button"
      class="btn small"
      onclick={() => editor.togglePlayRange()}
    >
      <Icon name={editor.rangePlaying ? "pause" : "play"} size={14} />
      {editor.rangePlaying ? t.player.stop : t.player.playRange}
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label={t.player.stepForward}
      title={t.player.stepForward}
      onclick={() => editor.nudge(editor.frameStep)}
    >
      <Icon name="stepForward" size={14} />
    </button>
    <span class="time">
      {fmtTime(editor.currentTime)} / {fmtTime(editor.duration)}
    </span>
    <span class="spacer"></span>
    <button
      type="button"
      class="btn small ghost"
      onclick={saveFrame}
      disabled={editor.busy || !editor.file}
    >
      <Icon name="image" size={14} /> {t.player.saveFrame}
    </button>
  </div>
</div>

<style>
  .player {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  video {
    flex: 1;
    min-height: 0;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    object-fit: contain;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .time {
    font-size: var(--text-md);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
