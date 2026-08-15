// 에디터 상태 싱글턴 (Svelte 5 runes).
import { t } from "../i18n";
import {
  getKeyframeTimes,
  isVideoFile,
  probeVideo,
  type VideoMeta,
} from "../video/probe";
import {
  MIN_SEGMENT_S,
  moveSegment,
  nextSegmentSlot,
  normalizeSegments,
  snapFloor,
  totalLength,
  type Segment,
} from "../video/segments";
import type {
  AudioFormatId,
  ContainerId,
  CutMode,
  PresetId,
  Rotation,
} from "../video/transcode";

/** 여러 구간을 어떻게 내보내는가. */
export type ExportMode = "join" | "each";

/** 트림 구간의 최소 길이(초). */
export const MIN_RANGE_S = MIN_SEGMENT_S;
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

  /**
   * 잘라 낼 구간 목록. 목록 순서가 곧 이어붙이는 순서다(segments.ts 첫머리 주석).
   * 파일을 열면 전체를 덮는 구간 하나로 시작한다.
   */
  segments = $state<Segment[]>([]);
  /** 핸들·시작/끝 입력이 건드리는 구간. */
  activeIndex = $state(0);
  exportMode = $state<ExportMode>("join");
  #nextId = 1;

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
  /** 핸들이 붙은 구간. 목록이 비면 null. */
  readonly active = $derived<Segment | null>(this.segments[this.activeIndex] ?? null);
  readonly trimStart = $derived(this.active?.start ?? 0);
  readonly trimEnd = $derived(this.active?.end ?? this.duration);
  readonly rangeLength = $derived(Math.max(0, this.trimEnd - this.trimStart));
  readonly isMultiSegment = $derived(this.segments.length > 1);
  /** 내보낼 총 길이 — 겹친 구간은 결과에 두 번 나오므로 두 번 센다. */
  readonly segmentsTotal = $derived(totalLength(this.segments));
  readonly isTrimmed = $derived(
    this.segments.length > 1 ||
      this.trimStart > FULL_EPS_S ||
      this.trimEnd < this.duration - FULL_EPS_S,
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
      this.segments = [{ id: this.#nextId++, start: 0, end: meta.durationS }];
      this.activeIndex = 0;
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
    this.segments = [];
    this.activeIndex = 0;
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

  /**
   * 무손실 모드에선 시작점을 직전 키프레임으로 내린다(그 지점부터 온전히 재생되도록).
   *
   * 앞으로만 옮긴다. 첫 키프레임보다 앞을 고르면 내려갈 키프레임이 없는데, 예전에는 그때
   * 첫 키프레임으로 **뒤로 밀어** 사용자가 고른 앞부분이 결과에서 빠졌다. 지금은 파일
   * 시작(0)까지 내린다 — 고른 구간이 그대로 남고, 시작이 키프레임에 안 맞으면 패널이
   * 배지로 재인코딩 사유를 적는다.
   */
  #snapToKeyframe(v: number): number {
    if (this.cutMode !== "lossless" || this.keyframes.length === 0) return v;
    let snapped = 0;
    for (const k of this.keyframes) {
      if (k <= v + 1e-6) snapped = k;
      else break;
    }
    return snapped;
  }

  /**
   * 스냅을 적용한 시작 시각 — 키프레임으로 내리되 다른 구간이 이미 덮은 자리로는 안 간다.
   * 스냅이 만든 겹침은 사용자가 고른 적이 없다(같은 대목이 결과에 두 번 들어간다).
   * `skipIndex`는 지금 옮기는 구간 자신이고, 목록에 아직 없는 구간이면 -1이다.
   */
  #snapStart(v: number, skipIndex: number): number {
    return Math.max(this.#snapToKeyframe(v), snapFloor(this.segments, v, skipIndex));
  }

  setTrimStart(v: number): void {
    const seg = this.active;
    if (!seg) return;
    const snapped = this.#snapStart(v, this.activeIndex);
    const next = Math.min(Math.max(0, snapped), seg.end - MIN_RANGE_S);
    if (next === seg.start) return;
    seg.start = next;
    this.touch();
  }

  setTrimEnd(v: number): void {
    const seg = this.active;
    if (!seg) return;
    const next = Math.max(Math.min(this.duration, v), seg.start + MIN_RANGE_S);
    if (next === seg.end) return;
    seg.end = next;
    this.touch();
  }

  resetTrim(): void {
    if (!this.isTrimmed) return;
    this.segments = [{ id: this.#nextId++, start: 0, end: this.duration }];
    this.activeIndex = 0;
    this.touch();
  }

  // ── 구간 목록 ─────────────────────────────────────
  // 겹침·순서 뒤바뀜을 여기서 고치지 않는다. 화면이 배지로 알리고 사용자가 정한다.

  /** 재생 위치의 빈 자리에 구간을 하나 붙이고 그것을 선택한다. */
  addSegment(): void {
    const slot = nextSegmentSlot(this.segments, this.duration, this.currentTime);
    if (!slot) return;
    // 빈 자리는 앞 구간이 끝나는 자리에서 시작한다 — 여기서 키프레임까지 내리면 그만큼이
    // 앞 구간과 겹쳐 같은 대목이 결과에 두 번 들어간다. `#snapStart`가 그 자리에서 멈춘다.
    // 새 구간은 아직 목록에 없으므로 건너뛸 자리도 없다.
    const start = this.#snapStart(slot.start, -1);
    this.segments = [
      ...this.segments,
      {
        id: this.#nextId++,
        start,
        end: Math.max(slot.end, start + MIN_RANGE_S),
      },
    ];
    this.activeIndex = this.segments.length - 1;
    this.touch();
  }

  /** 구간 하나는 남긴다 — 목록이 비면 내보낼 것이 없어진다. */
  removeSegment(index: number): void {
    if (this.segments.length <= 1 || index < 0 || index >= this.segments.length) return;
    this.segments = this.segments.filter((_, i) => i !== index);
    // 앞의 것을 지우면 뒤 번호가 하나씩 당겨진다 — 보던 구간을 계속 보게 맞춘다.
    const shifted = index < this.activeIndex ? this.activeIndex - 1 : this.activeIndex;
    this.activeIndex = Math.min(Math.max(0, shifted), this.segments.length - 1);
    this.touch();
  }

  /** 목록에서 delta칸 옮긴다 — 이어붙이는 순서가 바뀐다. */
  moveSegmentBy(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= this.segments.length) return;
    this.segments = moveSegment(this.segments, index, to);
    if (this.activeIndex === index) this.activeIndex = to;
    else if (this.activeIndex === to) this.activeIndex = index;
    this.touch();
  }

  /** 구간을 고른다. 타임라인에서 누를 때는 클릭 지점으로 따로 이동하므로 seek을 끈다. */
  selectSegment(index: number, seekToStart = true): void {
    if (index < 0 || index >= this.segments.length) return;
    this.activeIndex = index;
    if (seekToStart) this.seek(this.segments[index].start);
  }

  setExportMode(mode: ExportMode): void {
    if (mode === this.exportMode) return;
    this.exportMode = mode;
    this.touch();
  }

  /** 내보내기 직전의 구간 목록 — 경계 clamp·최소 길이 미만 제거를 거친 값. */
  exportSegments(): Segment[] {
    return normalizeSegments(this.segments, this.duration);
  }

  setCutMode(mode: CutMode): void {
    if (mode === this.cutMode) return;
    this.cutMode = mode;
    if (mode === "lossless") {
      // 모든 구간의 시작을 키프레임으로 내린다 — 하나라도 어긋나면 복사가 아니라 재인코딩이 된다.
      // 여기서도 남의 구간 안으로는 안 내려간다(맞닿은 두 구간을 겹치게 만들지 않는다).
      // 한계를 먼저 다 재고 나서 옮긴다 — 옮기는 도중의 값을 보면 목록 순서가 결과를 바꾼다.
      const snapped = this.segments.map((seg, i) => this.#snapStart(seg.start, i));
      this.segments.forEach((seg, i) => {
        if (snapped[i] !== seg.start) seg.start = Math.min(snapped[i], seg.end - MIN_RANGE_S);
      });
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
