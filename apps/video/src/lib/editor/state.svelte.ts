// 에디터 상태 싱글턴 (Svelte 5 runes).
import { t } from "../i18n";
import { isVideoFile, probeVideo, type VideoMeta } from "../video/probe";

/** 트림 구간의 최소 길이(초). */
export const MIN_RANGE_S = 0.1;
/** "사실상 전체" 판정 여유(초) — 부동소수점·핸들 스냅 오차 흡수. */
const FULL_EPS_S = 0.01;

export class EditorState {
  file = $state<File | null>(null);
  meta = $state<VideoMeta | null>(null);
  videoUrl = $state("");

  trimStart = $state(0);
  trimEnd = $state(0);
  /** 플레이헤드 위치(초) — Player가 갱신. */
  currentTime = $state(0);
  /** 구간 재생 중 여부 — trimEnd 도달 시 Player가 멈춘다. */
  rangePlaying = $state(false);

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
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
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
    this.trimStart = 0;
    this.trimEnd = 0;
    this.currentTime = 0;
    this.rangePlaying = false;
    this.error = "";
  }

  setTrimStart(v: number): void {
    const next = Math.min(Math.max(0, v), this.trimEnd - MIN_RANGE_S);
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

  /** 플레이어를 해당 시각으로 이동. */
  seek(tS: number): void {
    if (!this.videoEl) return;
    this.videoEl.currentTime = Math.min(Math.max(0, tS), this.duration);
    this.currentTime = this.videoEl.currentTime;
  }
}

export const editor = new EditorState();
