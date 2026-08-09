import { t } from "../i18n";
import { loadFile, releaseAll } from "../gif/decode";
import { outputSize } from "../gif/transform";
import type { CropRect, Frame, Rotation, Transform } from "../gif/types";
import type { FrameSource } from "../gif/types";

const uid = (): string => crypto.randomUUID();

/** 이 픽셀 수(약 1000×1000)를 넘는 원본이면 리사이즈 제안 배너를 띄운다. */
const LARGE_PIXELS = 1_000_000;

export const SPEED_CHIPS = [0.25, 0.5, 1, 2, 4] as const;
export const SCALE_CHIPS = [25, 50, 75, 100] as const;

export const MIN_DELAY_MS = 20;
export const MAX_DELAY_MS = 10_000;

export type ExportFormat = "gif" | "webp";
export const GIF_COLOR_CHOICES = [256, 128, 64, 32] as const;

/** 화질 프리셋 — 형식별 설정을 한 번에 적용. */
export type PresetId = "small" | "balanced" | "high";
export const QUALITY_PRESETS: {
  id: PresetId;
  gif: { colors: number; dither: boolean };
  webpQuality: number;
}[] = [
  { id: "small", gif: { colors: 64, dither: false }, webpQuality: 60 },
  { id: "balanced", gif: { colors: 256, dither: false }, webpQuality: 80 },
  { id: "high", gif: { colors: 256, dither: true }, webpQuality: 95 },
];

function defaultTransform(): Transform {
  return { crop: null, rotation: 0, flipH: false, flipV: false, scale: 1 };
}

/** 단일 에디터 뷰의 전역 상태. 앱에 에디터가 하나뿐이라 모듈 싱글턴으로 둔다. */
export class EditorState {
  frames = $state<Frame[]>([]);
  /** 렌더에 직접 쓰이지 않으므로 일반 Map (썸네일은 frame.thumb). */
  readonly sources = new Map<string, FrameSource>();

  current = $state(0);
  playing = $state(false);
  speed = $state(1);
  loopForever = $state(true);
  loopCount = $state(3);
  transform = $state<Transform>(defaultTransform());
  cropMode = $state(false);

  exportFormat = $state<ExportFormat>("gif");
  gifColors = $state(256);
  gifDither = $state(false);
  webpQuality = $state(80);

  busy = $state(false);
  busyMsg = $state("");
  error = $state("");
  /** 편집 리비전 — 인코딩 결과가 낡았는지 판단하는 데 쓴다. */
  revision = $state(0);
  banner = $state<{ w: number; h: number } | null>(null);
  #bannerDismissed = false;

  /** 베이스 캔버스 크기 = 모든 소스의 최대 폭·높이. */
  readonly base = $derived.by(() => {
    let w = 0;
    let h = 0;
    for (const f of this.frames) {
      const s = this.sources.get(f.sourceId);
      if (!s) continue;
      if (s.width > w) w = s.width;
      if (s.height > h) h = s.height;
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  });

  readonly output = $derived.by(() =>
    outputSize(this.base.w, this.base.h, this.transform),
  );
  /** 배율 1 기준 출력 크기 — 가로(px) 입력에서 배율 역산에 사용. */
  readonly unscaledOutput = $derived.by(() =>
    outputSize(this.base.w, this.base.h, { ...this.transform, scale: 1 }),
  );
  readonly selectedCount = $derived(
    this.frames.filter((f) => f.selected).length,
  );
  /** gifenc repeat 값: -1=1회 재생, 0=무한, n>0=추가 반복 횟수. */
  readonly repeat = $derived.by(() => {
    if (this.loopForever) return 0;
    const extra = Math.max(1, this.loopCount) - 1;
    return extra === 0 ? -1 : extra;
  });
  /** WebP ANIM loop 값: 0=무한, n>0=재생 횟수. */
  readonly webpLoop = $derived.by(() =>
    this.loopForever ? 0 : Math.max(1, this.loopCount),
  );
  /** 현재 화질 설정과 일치하는 프리셋 (없으면 null). */
  readonly activePreset = $derived.by(() => {
    for (const p of QUALITY_PRESETS) {
      const match =
        this.exportFormat === "gif"
          ? this.gifColors === p.gif.colors && this.gifDither === p.gif.dither
          : this.webpQuality === p.webpQuality;
      if (match) return p.id;
    }
    return null;
  });

  touch(): void {
    this.revision++;
  }

  // ── 임포트 ──────────────────────────────────────
  async addFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files);
    if (!arr.length) return;
    this.error = "";
    this.busy = true;
    try {
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        this.busyMsg = t.editor.loading(file.name, i + 1, arr.length);
        try {
          const { source, frames } = await loadFile(file, (done, total) => {
            this.busyMsg = t.editor.decodingFrames(file.name, done, total);
          });
          this.sources.set(source.id, source);
          this.frames = [...this.frames, ...frames];
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
    this.#maybeSuggestResize();
    this.touch();
  }

  #maybeSuggestResize(): void {
    if (this.#bannerDismissed || this.transform.scale !== 1) return;
    const { w, h } = this.base;
    if (w * h > LARGE_PIXELS) this.banner = { w, h };
  }

  dismissBanner(): void {
    this.banner = null;
    this.#bannerDismissed = true;
  }

  applyBannerShrink(scalePct: number): void {
    this.setScale(scalePct / 100);
    this.banner = null;
  }

  clearAll(): void {
    this.frames = [];
    this.sources.clear();
    releaseAll();
    this.transform = defaultTransform();
    this.cropMode = false;
    this.playing = false;
    this.current = 0;
    this.banner = null;
    this.#bannerDismissed = false;
    this.error = "";
    this.touch();
  }

  // ── 프레임 조작 ─────────────────────────────────
  toggleSelect(id: string): void {
    const f = this.frames.find((x) => x.id === id);
    if (f) f.selected = !f.selected;
  }

  selectAll(): void {
    for (const f of this.frames) f.selected = true;
  }

  selectNone(): void {
    for (const f of this.frames) f.selected = false;
  }

  #removeWhere(pred: (f: Frame) => boolean): void {
    const currentId = this.frames[this.current]?.id;
    this.frames = this.frames.filter((f) => !pred(f));
    const idx = currentId
      ? this.frames.findIndex((f) => f.id === currentId)
      : -1;
    this.current =
      idx >= 0 ? idx : Math.min(this.current, Math.max(0, this.frames.length - 1));
    this.touch();
  }

  deleteSelected(): void {
    this.#removeWhere((f) => f.selected);
  }

  /** 트림·컷: 선택한 프레임만 남긴다. */
  keepSelected(): void {
    this.#removeWhere((f) => !f.selected);
  }

  deleteOne(id: string): void {
    this.#removeWhere((f) => f.id === id);
  }

  duplicateOne(id: string): void {
    const i = this.frames.findIndex((f) => f.id === id);
    if (i < 0) return;
    const copy: Frame = { ...this.frames[i], id: uid(), selected: false };
    this.frames = [
      ...this.frames.slice(0, i + 1),
      copy,
      ...this.frames.slice(i + 1),
    ];
    this.touch();
  }

  duplicateSelected(): void {
    if (!this.selectedCount) return;
    const next: Frame[] = [];
    for (const f of this.frames) {
      next.push(f);
      if (f.selected) next.push({ ...f, id: uid(), selected: false });
    }
    this.frames = next;
    this.touch();
  }

  reverse(): void {
    if (this.frames.length < 2) return;
    this.frames = [...this.frames].reverse();
    this.current = this.frames.length - 1 - this.current;
    this.touch();
  }

  move(from: number, to: number): void {
    if (from === to) return;
    const currentId = this.frames[this.current]?.id;
    const next = [...this.frames];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.frames = next;
    if (currentId) {
      this.current = Math.max(
        0,
        this.frames.findIndex((f) => f.id === currentId),
      );
    }
    this.touch();
  }

  setDelay(ms: number, onlySelected: boolean): void {
    const v = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(ms)));
    for (const f of this.frames) {
      if (!onlySelected || f.selected) f.delayMs = v;
    }
    this.touch();
  }

  setSpeed(x: number): void {
    this.speed = x;
    this.touch();
  }

  setLoopForever(v: boolean): void {
    this.loopForever = v;
    this.touch();
  }

  setLoopCount(n: number): void {
    this.loopCount = Math.min(100, Math.max(1, Math.round(n)));
    this.touch();
  }

  // ── 내보내기 형식·화질 ──────────────────────────
  setExportFormat(f: ExportFormat): void {
    this.exportFormat = f;
    this.touch();
  }

  setGifColors(n: number): void {
    this.gifColors = Math.min(256, Math.max(8, Math.round(n)));
    this.touch();
  }

  setGifDither(v: boolean): void {
    this.gifDither = v;
    this.touch();
  }

  setWebpQuality(q: number): void {
    this.webpQuality = Math.min(100, Math.max(1, Math.round(q)));
    this.touch();
  }

  applyPreset(id: PresetId): void {
    const preset = QUALITY_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    if (this.exportFormat === "gif") {
      this.gifColors = preset.gif.colors;
      this.gifDither = preset.gif.dither;
    } else {
      this.webpQuality = preset.webpQuality;
    }
    this.touch();
  }

  // ── 변형 ────────────────────────────────────────
  rotate90(): void {
    this.transform.rotation = ((this.transform.rotation + 90) % 360) as Rotation;
    this.touch();
  }

  toggleFlipH(): void {
    this.transform.flipH = !this.transform.flipH;
    this.touch();
  }

  toggleFlipV(): void {
    this.transform.flipV = !this.transform.flipV;
    this.touch();
  }

  setScale(s: number): void {
    this.transform.scale = Math.min(8, Math.max(0.05, s));
    this.touch();
  }

  setCrop(rect: CropRect | null): void {
    this.transform.crop = rect;
    this.touch();
  }

  resetTransform(): void {
    this.transform = defaultTransform();
    this.cropMode = false;
    this.touch();
  }
}

export const editor = new EditorState();
