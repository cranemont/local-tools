// 에디터 상태 싱글턴 (Svelte 5 runes).
import { t } from "../i18n";
import {
  getKeyframeTimes,
  isVideoFile,
  probeVideo,
  type VideoMeta,
} from "../video/probe";
import type {
  AudioFormatId,
  ContainerId,
  CutMode,
  PresetId,
  Rotation,
} from "../video/transcode";

/** 트림 구간의 최소 길이(초). */
export const MIN_RANGE_S = 0.1;
/** "사실상 전체" 판정 여유(초) — 부동소수점·핸들 스냅 오차 흡수. */
const FULL_EPS_S = 0.01;

/** 해상도 칩(세로 픽셀) — 원본보다 작은 것만 노출한다. */
export const RESOLUTION_CHIPS = [1080, 720, 480];
/** 타깃 용량 입력 한계(MB). */
export const MIN_TARGET_MB = 1;
export const MAX_TARGET_MB = 4000;
/** 비트레이트 입력 한계(kbps) — 영상·소리 공용. */
export const MIN_BITRATE_KBPS = 32;
export const MAX_BITRATE_KBPS = 200_000;
/** 프레임레이트 입력 한계. */
export const MIN_FPS = 1;
export const MAX_FPS = 240;
/** fps를 못 잰 파일에서 쓰는 보폭 기준. */
const FALLBACK_FPS = 30;

export class EditorState {
  file = $state<File | null>(null);
  meta = $state<VideoMeta | null>(null);
  videoUrl = $state("");
  /** 같은 설정으로 이어서 처리할 대기 파일들(활성 파일 제외). */
  queue = $state<File[]>([]);

  trimStart = $state(0);
  trimEnd = $state(0);
  /** 플레이헤드 위치(초) — Player가 갱신. */
  currentTime = $state(0);
  /** 구간 재생 중 여부 — trimEnd 도달 시 Player가 멈춘다. */
  rangePlaying = $state(false);

  cutMode = $state<CutMode>("exact");
  exportFormat = $state<ContainerId>("mp4");
  muteAudio = $state(false);
  preset = $state<PresetId>("balanced");
  /** 출력 세로 픽셀 (null = 원본). */
  resHeight = $state<number | null>(null);
  targetEnabled = $state(false);
  targetMB = $state(25);
  /** 지정 비트레이트(kbps). null이면 프리셋·타깃 용량을 따른다. */
  bitrateKbps = $state<number | null>(null);
  /** 출력 프레임레이트. null이면 원본. */
  fps = $state<number | null>(null);
  /** 시계 방향 회전. */
  rotate = $state<Rotation>(0);
  flipH = $state(false);
  flipV = $state(false);
  /** 소리만 저장 설정 — 영상 결과와 무관해 revision을 올리지 않는다. */
  audioFormat = $state<AudioFormatId>("auto");
  audioBitrateKbps = $state<number | null>(null);
  audioMono = $state(false);
  /** 키프레임 시각(초) — 무손실 스냅·타임라인 눈금. 스캔 완료 전엔 빈 배열. */
  keyframes = $state<number[]>([]);

  busy = $state(false);
  busyMsg = $state("");
  /** 인코딩 진행률 0~1. null이면 진행 중 아님. */
  progress = $state<number | null>(null);
  error = $state("");
  /** 편집 세대 — 내보내기 결과의 신선도 판단용. */
  revision = $state(0);

  /** Player가 바인딩하는 video 엘리먼트 (비반응). */
  videoEl: HTMLVideoElement | null = null;
  /** 진행 중 인코딩의 취소 훅 (비반응). */
  cancelCurrent: (() => void) | null = null;

  readonly duration = $derived(this.meta?.durationS ?? 0);
  readonly rangeLength = $derived(Math.max(0, this.trimEnd - this.trimStart));
  readonly isTrimmed = $derived(
    this.trimStart > FULL_EPS_S || this.trimEnd < this.duration - FULL_EPS_S,
  );
  /** 프레임 한 장의 길이(초) — 단축키·스텝 버튼의 보폭. */
  readonly frameStep = $derived(1 / (this.meta?.fps || FALLBACK_FPS));
  /** 활성 파일 + 대기 파일 — 큐 처리 순서 그대로. */
  readonly batch = $derived(this.file ? [this.file, ...this.queue] : []);
  readonly isBatch = $derived(this.queue.length > 0);

  touch(): void {
    this.revision++;
  }

  async openFile(file: File): Promise<void> {
    if (!isVideoFile(file)) {
      this.error = t.errors.notVideo(file.name);
      return;
    }
    this.busy = true;
    this.busyMsg = t.editor.loading;
    this.error = "";
    try {
      const meta = await probeVideo(file);
      this.#reset();
      this.file = file;
      this.meta = meta;
      this.videoUrl = URL.createObjectURL(file);
      this.trimEnd = meta.durationS;
      this.touch();
      // 키프레임 스캔은 편집을 막지 않도록 백그라운드로.
      void getKeyframeTimes(file).then((times) => {
        if (this.file === file) this.keyframes = times;
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
  }

  /** 여러 개를 받으면 첫 동영상을 열고 나머지는 큐에 쌓는다. */
  async openFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const videos = files.filter(isVideoFile);
    // 하나도 없으면 첫 파일로 열어 "동영상이 아니다"를 알린다.
    const first = videos[0] ?? files[0];
    await this.openFile(first);
    if (this.file === first) this.setQueue(videos.slice(1));
  }

  setQueue(files: File[]): void {
    this.queue = files.filter(isVideoFile);
  }

  clearQueue(): void {
    if (this.queue.length === 0) return;
    this.queue = [];
  }

  clear(): void {
    this.#reset();
    this.touch();
  }

  #reset(): void {
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.file = null;
    this.meta = null;
    this.videoUrl = "";
    this.queue = [];
    this.trimStart = 0;
    this.trimEnd = 0;
    this.currentTime = 0;
    this.rangePlaying = false;
    this.keyframes = [];
    // 파일마다 원본이 다른 값만 초기화 (모드·프리셋·타깃 용량은 유지)
    this.resHeight = null;
    this.fps = null;
    this.rotate = 0;
    this.flipH = false;
    this.flipV = false;
    this.error = "";
  }

  /** 무손실 모드에선 시작점을 직전 키프레임으로 내린다(그 지점부터 온전히 재생되도록). */
  #snapToKeyframe(v: number): number {
    if (this.cutMode !== "lossless" || this.keyframes.length === 0) return v;
    let snapped = this.keyframes[0];
    for (const k of this.keyframes) {
      if (k <= v + 1e-6) snapped = k;
      else break;
    }
    return snapped;
  }

  setTrimStart(v: number): void {
    const snapped = this.#snapToKeyframe(v);
    const next = Math.min(Math.max(0, snapped), this.trimEnd - MIN_RANGE_S);
    if (next === this.trimStart) return;
    this.trimStart = next;
    this.touch();
  }

  setTrimEnd(v: number): void {
    const next = Math.max(Math.min(this.duration, v), this.trimStart + MIN_RANGE_S);
    if (next === this.trimEnd) return;
    this.trimEnd = next;
    this.touch();
  }

  resetTrim(): void {
    if (!this.isTrimmed) return;
    this.trimStart = 0;
    this.trimEnd = this.duration;
    this.touch();
  }

  setCutMode(mode: CutMode): void {
    if (mode === this.cutMode) return;
    this.cutMode = mode;
    if (mode === "lossless") {
      this.setTrimStart(this.trimStart); // 기존 시작점도 스냅
      // 반전은 픽셀을 다시 그려야 해서 복사 경로에 없다 — 켜 둔 채 무시하지 않는다.
      this.flipH = false;
      this.flipV = false;
    }
    this.touch();
  }

  setExportFormat(f: ContainerId): void {
    if (f === this.exportFormat) return;
    this.exportFormat = f;
    this.touch();
  }

  setMuteAudio(on: boolean): void {
    if (on === this.muteAudio) return;
    this.muteAudio = on;
    this.touch();
  }

  setPreset(id: PresetId): void {
    if (id === this.preset) return;
    this.preset = id;
    this.touch();
  }

  setResHeight(h: number | null): void {
    if (h === this.resHeight) return;
    this.resHeight = h;
    this.touch();
  }

  setTargetEnabled(on: boolean): void {
    if (on === this.targetEnabled) return;
    this.targetEnabled = on;
    if (on) this.bitrateKbps = null; // 용량과 비트레이트는 둘 중 하나만
    this.touch();
  }

  setTargetMB(mb: number): void {
    const next = Math.min(MAX_TARGET_MB, Math.max(MIN_TARGET_MB, Math.round(mb)));
    if (next === this.targetMB) return;
    this.targetMB = next;
    this.touch();
  }

  setBitrateKbps(v: number | null): void {
    const next = v === null ? null : clampInt(v, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS);
    if (next === this.bitrateKbps) return;
    this.bitrateKbps = next;
    if (next !== null) this.targetEnabled = false;
    this.touch();
  }

  setFps(v: number | null): void {
    const next = v === null ? null : clampInt(v, MIN_FPS, MAX_FPS);
    if (next === this.fps) return;
    this.fps = next;
    this.touch();
  }

  setRotate(deg: Rotation): void {
    if (deg === this.rotate) return;
    this.rotate = deg;
    this.touch();
  }

  /** 지금 각도에서 시계 방향으로 90도. */
  rotateBy90(): void {
    this.setRotate(((this.rotate + 90) % 360) as Rotation);
  }

  setFlip(axis: "h" | "v", on: boolean): void {
    if (axis === "h") {
      if (on === this.flipH) return;
      this.flipH = on;
    } else {
      if (on === this.flipV) return;
      this.flipV = on;
    }
    this.touch();
  }

  setAudioFormat(f: AudioFormatId): void {
    this.audioFormat = f;
  }

  setAudioBitrateKbps(v: number | null): void {
    this.audioBitrateKbps =
      v === null ? null : clampInt(v, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS);
  }

  setAudioMono(on: boolean): void {
    this.audioMono = on;
  }

  /** 플레이어를 해당 시각으로 이동. */
  seek(tS: number): void {
    if (!this.videoEl) return;
    this.videoEl.currentTime = Math.min(Math.max(0, tS), this.duration);
    this.currentTime = this.videoEl.currentTime;
  }

  /** 현재 위치에서 dS초만큼 이동 (단축키·스텝 버튼). */
  nudge(dS: number): void {
    this.seek(this.currentTime + dS);
  }

  /** 구간 재생 토글 — Player 바 버튼과 Space 단축키가 함께 쓴다. */
  togglePlayRange(): void {
    const el = this.videoEl;
    if (!el) return;
    if (this.rangePlaying || !el.paused) {
      el.pause();
      return;
    }
    if (el.currentTime < this.trimStart || el.currentTime >= this.trimEnd) {
      el.currentTime = this.trimStart;
    }
    this.rangePlaying = true;
    void el.play();
  }
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

export const editor = new EditorState();
