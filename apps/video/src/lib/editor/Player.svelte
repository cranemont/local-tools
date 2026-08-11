<script lang="ts">
  import Icon from "../Icon.svelte";
  import { fmtTime, t } from "../i18n";
  import { editor } from "./state.svelte";

  let videoEl: HTMLVideoElement | undefined = $state();
  let raf = 0;

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

  function playRange() {
    if (!videoEl) return;
    if (editor.rangePlaying) {
      videoEl.pause();
      return;
    }
    videoEl.currentTime = editor.trimStart;
    editor.rangePlaying = true;
    void videoEl.play();
  }
</script>

<div class="player">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    src={editor.videoUrl}
    controls
    playsinline
    onplay={onPlay}
    onpause={onPauseOrEnd}
    onended={onPauseOrEnd}
    onseeked={() => videoEl && (editor.currentTime = videoEl.currentTime)}
  ></video>
  <div class="bar">
    <button type="button" class="btn small" onclick={playRange}>
      <Icon name={editor.rangePlaying ? "pause" : "play"} size={14} />
      {editor.rangePlaying ? t.player.stop : t.player.playRange}
    </button>
    <span class="time">
      {fmtTime(editor.currentTime)} / {fmtTime(editor.duration)}
    </span>
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
    gap: 10px;
  }
  .time {
    font-size: var(--text-md);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
