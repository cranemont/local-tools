import { t } from "../i18n";
import { loadFile, releaseAll, releaseSource } from "../gif/decode";
import { outputSize } from "../gif/transform";
import {
  extractVideoFrames,
  isVideoFile,
  probeVideo,
  type ExtractOptions,
} from "../gif/video";
import {
  applyOverlayPatch,
  newOverlay,
  selectionAffectsOverlays,
  type OverlayPatch,
  type TextOverlay,
} from "../gif/overlay";
import {
  applyRedactPatch,
  newRegion,
  outputToRegion,
  selectionAffectsRegions,
  type RedactMode,
  type RedactPatch,
  type RedactRect,
  type RedactRegion,
} from "../gif/redact";
import type { ExportFormat } from "../gif/timing";
import type { CropRect, Frame, Rotation, Transform } from "../gif/types";
import type { FrameSource } from "../gif/types";

const uid = (): string => crypto.randomUUID();

/** 이 픽셀 수(약 1000×1000)를 넘는 원본이면 리사이즈 제안 배너를 띄운다. */
const LARGE_PIXELS = 1_000_000;

export const SPEED_CHIPS = [0.25, 0.5, 1, 2, 4] as const;
export const SCALE_CHIPS = [25, 50, 75, 100] as const;

export const MIN_DELAY_MS = 20;
export const MAX_DELAY_MS = 10_000;

/** 되돌리기 깊이. 지운 프레임의 소스는 스택에서 밀려날 때까지 메모리에 남는다. */
const HISTORY_MAX = 30;

export type { ExportFormat };
export const GIF_COLOR_CHOICES = [256, 128, 64, 32] as const;

/** 딜레이 적용 방식 — 덮어쓰기 / 가감(±ms) / 비율(%). */
export type DelayMode = "set" | "add" | "scale";

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
  return { crop: null, rotation: 0, flipH: false, flipV: false, scale: 1, redact: [] };
}

function cloneTransform(tf: Transform): Transform {
  return {
    crop: tf.crop ? { ...tf.crop } : null,
    rotation: tf.rotation,
    flipH: tf.flipH,
    flipV: tf.flipV,
    scale: tf.scale,
    // 가릴 영역도 한 겹 베낀다 — 되돌리기 지점이 살아 있는 목록을 붙들면 안 된다.
    redact: tf.redact.map((r) => ({ ...r })),
  };
}

function clampDelay(ms: number): number {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(ms)));
}

/** 되돌리기 지점 — 프레임 목록(순서·딜레이·선택)과 출력 변형·오버레이 목록을 담는다.
 *  형식·화질·반복은 패널에 그대로 보이고 직접 되돌릴 수 있어 제외한다.
 *  오버레이는 추가·삭제(구조가 바뀌는 일)에서만 지점을 남긴다 — 칸 하나 고칠 때마다
 *  지점을 남기면 글자를 치는 동안 스택이 키 입력 수만큼 쌓인다. */
interface Snapshot {
  frames: Frame[];
  current: number;
  transform: Transform;
  overlays: TextOverlay[];
  /** 편집 중이던 오버레이도 같이 돌아온다 — 안 그러면 되돌린 뒤 편집칸이 통째로 사라진다. */
  activeOverlayId: string | null;
  /** 가릴 영역은 transform 안에 있고, 편집 중이던 영역만 따로 기억한다(오버레이와 같다). */
  activeRegionId: string | null;
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

  /** 영역을 끌어 만드는 중인가. 크롭 모드와 동시에 켜지 않는다(같은 드래그를 두 뜻으로 읽는다). */
  redactMode = $state(false);
  /** 패널에서 편집 중인 가리기 영역. */
  activeRegionId = $state<string | null>(null);

  /** 프레임 위에 얹는 텍스트. 여러 개(위 자막 + 아래 자막)를 겹칠 수 있다. */
  overlays = $state<TextOverlay[]>([]);
  /** 패널에서 편집 중인 오버레이. 목록에서 사라지면 아래 activeOverlay가 null로 떨어진다. */
  activeOverlayId = $state<string | null>(null);

  exportFormat = $state<ExportFormat>("gif");
  gifColors = $state(256);
  gifDither = $state(false);
  /** 프레임 차분(gif/diff.ts). 기본으로 켠다 — 손해가 날 조건은 프레임마다 걸러 낸다. */
  gifDiff = $state(true);
  webpQuality = $state(80);
  mp4Quality = $state<PresetId>("balanced");

  /** 동영상 임포트 다이얼로그 (한 번에 한 파일). */
  videoDialog = $state<{
    file: File;
    width: number;
    height: number;
    durationS: number;
  } | null>(null);
  #videoQueue: File[] = [];

  busy = $state(false);
  busyMsg = $state("");
  /** 지금 도는 긴 작업을 멈추는 손잡이 (없으면 취소 불가). */
  busyCancel = $state<(() => void) | null>(null);
  error = $state("");

  canUndo = $state(false);
  canRedo = $state(false);
  #past: Snapshot[] = [];
  #future: Snapshot[] = [];
  /** 상자를 끌기 시작할 때 떠 둔 지점. 첫 이동에서 한 번만 확정한다(끌기 하나 = 되돌리기 하나). */
  #dragMark: Snapshot | null = null;
  /** 범위 선택의 기준점 — Shift+클릭이 여기서부터 칠한다.
   *  인덱스가 아니라 **프레임 id**다. 인덱스로 두면 순서를 바꾸거나(move·reverse)
   *  장을 끼워 넣는(duplicate) 자리마다 되돌려 놓아야 하고, 한 곳이라도 빠지면
   *  기준점이 엉뚱한 장을 가리킨다. id는 목록이 어떻게 바뀌어도 같은 장을 가리킨다. */
  #anchorId: string | null = null;
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
  /** 미리보기가 지금 그리는 변형. 크롭 모드에서는 변형 없는 베이스 위에서 남길 영역을 고르고,
   *  가릴 영역은 그때도 그대로 들고 간다(좌표가 베이스 기준이라 자리가 맞다).
   *  미리보기·패널·끌기가 **이 하나**를 본다 — 화면에 그려진 상자와 목록의 크기 표시가
   *  갈라지지 않게 하려는 것이니, 화면용 계산을 따로 만들지 말 것(CLAUDE.md 22번과 같은 규약). */
  readonly previewTransform = $derived.by<Transform>(() =>
    this.cropMode
      ? {
          crop: null,
          rotation: 0,
          flipH: false,
          flipV: false,
          scale: 1,
          redact: this.transform.redact,
        }
      : this.transform,
  );
  readonly previewOutput = $derived.by(() =>
    outputSize(this.base.w, this.base.h, this.previewTransform),
  );
  /** 배율 1 기준 출력 크기 — 가로(px) 입력에서 배율 역산에 사용. */
  readonly unscaledOutput = $derived.by(() =>
    outputSize(this.base.w, this.base.h, { ...this.transform, scale: 1 }),
  );
  readonly selectedCount = $derived(
    this.frames.filter((f) => f.selected).length,
  );
  /** 패널이 편집하는 오버레이. 지워진 id가 남아 있어도 null로 떨어진다. */
  readonly activeOverlay = $derived(
    this.overlays.find((o) => o.id === this.activeOverlayId) ?? null,
  );
  /** 가릴 영역 목록 — 변형 안에 산다(좌표가 크롭과 같은 베이스 기준이라 함께 움직인다). */
  readonly regions = $derived(this.transform.redact);
  /** 패널이 편집하는 영역. 지워진 id가 남아 있어도 null로 떨어진다. */
  readonly activeRegion = $derived(
    this.transform.redact.find((r) => r.id === this.activeRegionId) ?? null,
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
    if (this.exportFormat === "mp4") return this.mp4Quality;
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

  // ── 되돌리기 ────────────────────────────────────
  // 프레임은 얕은 복사로 뜬다 — thumb·bytes는 문자열·소스 참조라 같이 복사되지 않는다.
  #capture(): Snapshot {
    return {
      frames: this.frames.map((f) => ({ ...f })),
      current: this.current,
      transform: cloneTransform(this.transform),
      overlays: this.overlays.map((o) => ({ ...o })),
      activeOverlayId: this.activeOverlayId,
      activeRegionId: this.activeRegionId,
    };
  }

  /** 미리 떠 둔 스냅샷을 되돌리기 지점으로 확정한다. */
  #commit(snap: Snapshot): void {
    this.#past.push(snap);
    if (this.#past.length > HISTORY_MAX) this.#past.shift();
    this.#future = [];
    this.#syncHistory();
  }

  /** 편집을 바꾸기 직전에 호출 — 지금 상태를 되돌리기 지점으로 남긴다. */
  #mark(): void {
    this.#commit(this.#capture());
  }

  #restore(snap: Snapshot): void {
    this.frames = snap.frames.map((f) => ({ ...f }));
    this.current = Math.min(snap.current, Math.max(0, snap.frames.length - 1));
    this.transform = cloneTransform(snap.transform);
    this.overlays = snap.overlays.map((o) => ({ ...o }));
    this.activeOverlayId = snap.overlays.some((o) => o.id === snap.activeOverlayId)
      ? snap.activeOverlayId
      : null;
    this.activeRegionId = this.transform.redact.some((r) => r.id === snap.activeRegionId)
      ? snap.activeRegionId
      : null;
    this.cropMode = false;
    this.redactMode = false;
    this.#anchorId = null;
    // 끌던 도중에 되돌리기가 들어오면 떠 둔 지점은 버린다 — 되돌린 상태 위에 다시 쌓지 않는다.
    this.#dragMark = null;
  }

  #syncHistory(): void {
    this.canUndo = this.#past.length > 0;
    this.canRedo = this.#future.length > 0;
    this.#pruneSources();
  }

  /** 지금 프레임도 히스토리도 참조하지 않는 소스의 바이트를 버린다. */
  #pruneSources(): void {
    const alive = new Set<string>();
    for (const f of this.frames) alive.add(f.sourceId);
    for (const snap of [...this.#past, ...this.#future]) {
      for (const f of snap.frames) alive.add(f.sourceId);
    }
    for (const id of this.sources.keys()) {
      if (alive.has(id)) continue;
      this.sources.delete(id);
      releaseSource(id); // 바이트를 들고 있는 디코더·비트맵도 같이 놓는다
    }
  }

  undo(): void {
    const snap = this.#past.pop();
    if (!snap) return;
    this.#future.push(this.#capture());
    this.#restore(snap);
    this.#syncHistory();
    this.touch();
  }

  redo(): void {
    const snap = this.#future.pop();
    if (!snap) return;
    this.#past.push(this.#capture());
    this.#restore(snap);
    this.#syncHistory();
    this.touch();
  }

  // ── 임포트 ──────────────────────────────────────
  async addFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files);
    if (!arr.length) return;
    const videos = arr.filter(isVideoFile);
    const stills = arr.filter((f) => !isVideoFile(f));
    this.error = "";

    if (stills.length) {
      const before = this.#capture();
      this.busy = true;
      try {
        for (let i = 0; i < stills.length; i++) {
          const file = stills[i];
          this.busyMsg = t.editor.loading(file.name, i + 1, stills.length);
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
      if (this.frames.length !== before.frames.length) this.#commit(before);
      this.#maybeSuggestResize();
      this.touch();
    }

    if (videos.length) {
      this.#videoQueue.push(...videos);
      if (!this.videoDialog) await this.#openNextVideoDialog();
    }
  }

  // ── 동영상 임포트 (다이얼로그 플로우) ────────────
  async #openNextVideoDialog(): Promise<void> {
    const file = this.#videoQueue.shift();
    if (!file) return;
    this.busy = true;
    this.busyMsg = t.video.probing(file.name);
    try {
      const info = await probeVideo(file);
      this.videoDialog = { file, ...info };
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.busy = false;
      this.busyMsg = "";
      // 실패한 파일은 건너뛰고 다음 파일 진행
      return this.#openNextVideoDialog();
    }
    this.busy = false;
    this.busyMsg = "";
  }

  async confirmVideoImport(opts: Omit<ExtractOptions, "onProgress">): Promise<void> {
    const dialog = this.videoDialog;
    if (!dialog) return;
    const before = this.#capture();
    this.videoDialog = null;
    this.busy = true;
    this.busyMsg = t.video.extracting(dialog.file.name, 0, 0);
    try {
      const { sources, frames } = await extractVideoFrames(dialog.file, {
        ...opts,
        onProgress: (done, total) =>
          (this.busyMsg = t.video.extracting(dialog.file.name, done, total)),
      });
      for (const s of sources) this.sources.set(s.id, s);
      this.frames = [...this.frames, ...frames];
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
    if (this.frames.length !== before.frames.length) this.#commit(before);
    this.#maybeSuggestResize();
    this.touch();
    await this.#openNextVideoDialog();
  }

  cancelVideoImport(): void {
    this.videoDialog = null;
    void this.#openNextVideoDialog();
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
    if (!this.frames.length) return;
    this.#mark();
    this.frames = [];
    // sources는 지우지 않는다 — 되돌리기로 돌아올 수 있어야 한다.
    // (#pruneSources가 히스토리에서 밀려난 소스만 버린다.)
    releaseAll(); // 디코더·비트맵 캐시는 소스 바이트에서 다시 만들 수 있다
    // 가릴 영역도 여기서 함께 사라진다(defaultTransform) — 좌표가 지운 프레임의 것이라 남길 뜻이 없다.
    this.transform = defaultTransform();
    // 오버레이도 함께 비운다 — 위에서 #mark()를 했으므로 되돌리기로 통째로 돌아온다.
    this.overlays = [];
    this.activeOverlayId = null;
    this.activeRegionId = null;
    this.#anchorId = null;
    this.cropMode = false;
    this.redactMode = false;
    this.playing = false;
    this.current = 0;
    this.banner = null;
    this.#bannerDismissed = false;
    this.error = "";
    this.touch();
  }

  // ── 재생 ────────────────────────────────────────
  togglePlay(): void {
    if (!this.frames.length) return;
    this.playing = !this.playing;
  }

  /** 프레임 이동 (재생 중이면 멈춘다). */
  step(delta: number): void {
    const n = this.frames.length;
    if (!n) return;
    this.playing = false;
    this.current = (this.current + delta + n) % n;
  }

  // ── 선택 ────────────────────────────────────────
  /** 선택이 바뀌면 "선택한 프레임만" 글자가 붙는 자리도 바뀐다 — 그때만 리비전을 올린다.
   *  미리보기는 리비전으로만 다시 그리고 결과의 '낡음' 표시도 같은 값을 본다.
   *  늘 올리면 글자가 없을 때도 프레임을 고를 때마다 결과가 낡음으로 표시된다. */
  #touchIfSelectionDraws(): void {
    if (
      selectionAffectsOverlays(this.overlays) ||
      selectionAffectsRegions(this.transform.redact)
    ) {
      this.touch();
    }
  }

  /** 기준점이 지금 몇 번째인가. 가리키던 장이 목록에 없으면(지웠거나 아직 안 골랐으면) 0이다. */
  #anchorIndex(): number {
    if (this.#anchorId === null) return 0;
    const i = this.frames.findIndex((f) => f.id === this.#anchorId);
    return i >= 0 ? i : 0;
  }

  /** 기준점을 인덱스로 놓는다 — 그 자리의 id를 기억한다(빈 목록이면 놓지 않는다). */
  #setAnchorAt(index: number): void {
    this.#anchorId = this.frames[index]?.id ?? null;
  }

  /** 한 장 토글. range면 기준점부터 이 프레임까지 한 번에 칠한다(Shift+클릭). */
  toggleSelect(id: string, range = false): void {
    const i = this.frames.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (range) {
      this.selectRange(this.#anchorIndex(), i, true);
      return;
    }
    this.frames[i].selected = !this.frames[i].selected;
    this.#anchorId = id;
    this.#touchIfSelectionDraws();
  }

  /** 인덱스 a..b 구간의 선택 상태를 한꺼번에 바꾼다. */
  selectRange(a: number, b: number, value: boolean): void {
    const last = this.frames.length - 1;
    if (last < 0) return;
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(last, Math.max(a, b));
    for (let i = lo; i <= hi; i++) this.frames[i].selected = value;
    this.#setAnchorAt(Math.max(0, Math.min(b, last)));
    this.#touchIfSelectionDraws();
  }

  /** 1-based 프레임 번호 구간을 선택한다(패널 입력용). */
  selectNumbers(from: number, to: number): void {
    this.selectNone();
    this.selectRange(Math.round(from) - 1, Math.round(to) - 1, true);
  }

  selectAll(): void {
    for (const f of this.frames) f.selected = true;
    this.#setAnchorAt(0);
    this.#touchIfSelectionDraws();
  }

  selectNone(): void {
    for (const f of this.frames) f.selected = false;
    this.#touchIfSelectionDraws();
  }

  // ── 프레임 조작 ─────────────────────────────────
  #removeWhere(pred: (f: Frame, i: number) => boolean): void {
    const currentId = this.frames[this.current]?.id;
    const next = this.frames.filter((f, i) => !pred(f, i));
    if (next.length === this.frames.length) return;
    this.#mark();
    this.frames = next;
    const idx = currentId
      ? this.frames.findIndex((f) => f.id === currentId)
      : -1;
    this.current =
      idx >= 0 ? idx : Math.min(this.current, Math.max(0, this.frames.length - 1));
    // 기준점은 여기서 되돌리지 않는다 — id라서 남은 장을 계속 가리키고,
    // 가리키던 장이 지워졌으면 #anchorIndex()가 0으로 읽는다.
    this.touch();
  }

  deleteSelected(): void {
    this.#removeWhere((f) => f.selected);
  }

  /** 트림·컷: 선택한 프레임만 남긴다. */
  keepSelected(): void {
    if (!this.selectedCount) return;
    this.#removeWhere((f) => !f.selected);
  }

  /** 트림: 1-based 번호 구간만 남긴다(패널 입력용).
   *  번호는 프레임 수 안으로 가둔다 — 밖의 값을 그대로 쓰면 한 장도 안 남는다. */
  keepNumbers(from: number, to: number): void {
    const last = this.frames.length - 1;
    if (last < 0) return;
    const clamp = (n: number) => Math.max(0, Math.min(Math.round(n) - 1, last));
    const lo = clamp(from);
    const hi = clamp(to);
    this.#removeWhere((_f, i) => i < Math.min(lo, hi) || i > Math.max(lo, hi));
  }

  deleteOne(id: string): void {
    this.#removeWhere((f) => f.id === id);
  }

  duplicateOne(id: string): void {
    const i = this.frames.findIndex((f) => f.id === id);
    if (i < 0) return;
    this.#mark();
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
    this.#mark();
    const next: Frame[] = [];
    for (const f of this.frames) {
      next.push(f);
      if (f.selected) next.push({ ...f, id: uid(), selected: false });
    }
    this.frames = next;
    this.touch();
  }

  /** 순서 뒤집기 — 선택이 둘 이상이면 그 자리들 안에서만 뒤집는다. */
  reverse(): void {
    const picked: number[] = [];
    this.frames.forEach((f, i) => {
      if (f.selected) picked.push(i);
    });
    const targets = picked.length >= 2 ? picked : this.frames.map((_f, i) => i);
    if (targets.length < 2) return;
    this.#mark();
    const currentId = this.frames[this.current]?.id;
    const next = [...this.frames];
    for (let a = 0, b = targets.length - 1; a < b; a++, b--) {
      const i = targets[a];
      const j = targets[b];
      [next[i], next[j]] = [next[j], next[i]];
    }
    this.frames = next;
    if (currentId) {
      this.current = Math.max(
        0,
        this.frames.findIndex((f) => f.id === currentId),
      );
    }
    this.touch();
  }

  move(from: number, to: number): void {
    if (from === to) return;
    if (from < 0 || to < 0 || from >= this.frames.length || to >= this.frames.length) return;
    this.#mark();
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

  /** 지금 보고 있는 프레임을 한 칸 옮긴다(키보드 순서 바꾸기). */
  moveCurrent(delta: number): void {
    this.move(this.current, this.current + delta);
  }

  setDelay(value: number, onlySelected: boolean, mode: DelayMode = "set"): void {
    if (!this.frames.length) return;
    if (!Number.isFinite(value)) return;
    const targets = onlySelected ? this.frames.filter((f) => f.selected) : this.frames;
    const next = targets.map((f) =>
      clampDelay(
        mode === "set" ? value : mode === "add" ? f.delayMs + value : (f.delayMs * value) / 100,
      ),
    );
    // 바뀌는 프레임이 하나도 없으면(선택이 비었거나 이미 그 값이면) 지점도 리비전도 안 남긴다
    // — setScale·setCrop·setFrameDelay와 같은 규약이다.
    if (targets.every((f, i) => f.delayMs === next[i])) return;
    this.#mark();
    targets.forEach((f, i) => (f.delayMs = next[i]));
    this.touch();
  }

  /** 카드에서 한 장만 고칠 때. */
  setFrameDelay(id: string, ms: number): void {
    const f = this.frames.find((x) => x.id === id);
    if (!f || !Number.isFinite(ms)) return;
    const v = clampDelay(ms);
    if (f.delayMs === v) return;
    this.#mark();
    f.delayMs = v;
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

  setGifDiff(v: boolean): void {
    this.gifDiff = v;
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
    } else if (this.exportFormat === "webp") {
      this.webpQuality = preset.webpQuality;
    } else {
      this.mp4Quality = id;
    }
    this.touch();
  }

  // ── 변형 ────────────────────────────────────────
  rotate90(): void {
    this.#mark();
    this.transform.rotation = ((this.transform.rotation + 90) % 360) as Rotation;
    this.touch();
  }

  toggleFlipH(): void {
    this.#mark();
    this.transform.flipH = !this.transform.flipH;
    this.touch();
  }

  toggleFlipV(): void {
    this.#mark();
    this.transform.flipV = !this.transform.flipV;
    this.touch();
  }

  setScale(s: number): void {
    const v = Math.min(8, Math.max(0.05, s));
    if (this.transform.scale === v) return;
    this.#mark();
    this.transform.scale = v;
    this.touch();
  }

  setCrop(rect: CropRect | null): void {
    if (!rect && !this.transform.crop) return;
    this.#mark();
    this.transform.crop = rect;
    this.touch();
  }

  /** 크롭·회전·뒤집기·배율만 되돌린다 — **가릴 영역은 남긴다.**
   *  얼굴을 가려 놓고 크롭을 고치려다 가리기가 통째로 사라지면 그대로 내보내게 된다. */
  resetTransform(): void {
    this.#mark();
    this.transform = { ...defaultTransform(), redact: this.transform.redact };
    this.cropMode = false;
    this.touch();
  }

  // ── 텍스트 오버레이 ─────────────────────────────
  /** 기본값은 캔버스 높이에서 나온다 — 원본이 얼마든 처음부터 읽히는 크기로 뜬다.
   *  높이는 원본이 아니라 **배율 1 기준 출력** 높이다. 크롭·회전이 걸리면 둘이 갈라지고,
   *  원본 높이로 잡으면 잘라 낸 조각보다 큰 글자가 기본값으로 뜬다. */
  addOverlay(): void {
    this.#mark();
    const o = newOverlay(uid(), this.unscaledOutput.h, this.frames.length);
    this.overlays = [...this.overlays, o];
    this.activeOverlayId = o.id;
    this.touch();
  }

  removeOverlay(id: string): void {
    if (!this.overlays.some((o) => o.id === id)) return;
    this.#mark();
    this.overlays = this.overlays.filter((o) => o.id !== id);
    if (this.activeOverlayId === id) {
      this.activeOverlayId = this.overlays.length
        ? this.overlays[this.overlays.length - 1].id
        : null;
    }
    this.touch();
  }

  setActiveOverlay(id: string | null): void {
    this.activeOverlayId = id;
  }

  /** 칸 하나를 고친다. 되돌리기 지점을 남기지 않는다(위 Snapshot 주석 참고).
   *  값을 가두는 규칙은 전부 applyOverlayPatch에 있다 — 구간 번호를 손대지 않은 편집이
   *  구간을 줄이지 않는 것도 거기서 지킨다. */
  updateOverlay(id: string, patch: OverlayPatch): void {
    const i = this.overlays.findIndex((o) => o.id === id);
    if (i < 0) return;
    const next = [...this.overlays];
    next[i] = applyOverlayPatch(this.overlays[i], patch, this.frames.length);
    this.overlays = next;
    this.touch();
  }

  // ── 가리기 영역 ─────────────────────────────────
  /** 영역 그리기 모드를 켜고 끈다. 크롭 모드와는 배타다 — 드래그 한 번을 두 뜻으로 못 읽는다. */
  toggleRedactMode(): void {
    this.playing = false;
    this.redactMode = !this.redactMode;
    if (this.redactMode) this.cropMode = false;
  }

  /**
   * 미리보기에서 끈 사각형으로 영역을 만든다. 인자는 **미리보기가 그리는 출력 좌표**다 —
   * 미리보기는 변형이 걸린 그림을 보여 주므로, 저장은 베이스 좌표로 되돌려서 한다
   * (그래야 나중에 크롭·회전을 바꿔도 같은 자리를 덮는다).
   * 되돌리는 기준은 `previewOutput`/`previewTransform`이다 — 끌기(dragRegionTo)와 같은
   * 좌표계여야 만든 자리와 잡아 옮긴 자리가 갈라지지 않는다(CLAUDE.md 35번).
   * 너무 작으면 아무 일도 없다 — 잘못 찍은 클릭으로 영역이 생기지 않게.
   */
  addRegionFromOutput(rect: RedactRect, mode: RedactMode = "mosaic"): void {
    const box = outputToRegion(
      rect,
      this.base.w,
      this.base.h,
      this.previewOutput,
      this.previewTransform,
    );
    if (!box) return;
    const region = newRegion(uid(), box, this.base.w, this.base.h, this.frames.length, mode);
    if (!region) return;
    this.#mark();
    this.transform.redact = [...this.transform.redact, region];
    this.activeRegionId = region.id;
    this.touch();
  }

  removeRegion(id: string): void {
    if (!this.transform.redact.some((r) => r.id === id)) return;
    this.#mark();
    const next = this.transform.redact.filter((r) => r.id !== id);
    this.transform.redact = next;
    if (this.activeRegionId === id) {
      this.activeRegionId = next.length ? next[next.length - 1].id : null;
    }
    this.touch();
  }

  setActiveRegion(id: string | null): void {
    this.activeRegionId = id;
  }

  /** 미리보기에서 상자를 잡았다. 되돌리기 지점은 **실제로 움직였을 때** 남긴다 —
   *  고르려고 한 번 누른 것까지 스택에 쌓이면 되돌리기가 헛돈다. */
  beginRegionDrag(id: string): void {
    this.setActiveRegion(id);
    this.#dragMark = this.transform.redact.some((r) => r.id === id)
      ? this.#capture()
      : null;
  }

  /**
   * 끌고 있는 중 — 인자는 **출력 캔버스 좌표**이고 저장은 베이스 좌표로 한다
   * (addRegionFromOutput과 같은 규약). 미리보기가 보고 있는 변형으로 되돌리므로
   * 크롭 모드에서 잡아도 자리가 맞는다.
   * 되돌린 결과가 최소 크기 밑이면 그 프레임의 값을 그대로 둔다.
   */
  dragRegionTo(id: string, rect: RedactRect): void {
    const i = this.transform.redact.findIndex((r) => r.id === id);
    if (i < 0) return;
    const box = outputToRegion(
      rect,
      this.base.w,
      this.base.h,
      this.previewOutput,
      this.previewTransform,
    );
    if (!box) return;
    const cur = this.transform.redact[i];
    if (cur.x === box.x && cur.y === box.y && cur.w === box.w && cur.h === box.h) return;
    if (this.#dragMark) {
      this.#commit(this.#dragMark);
      this.#dragMark = null;
    }
    const next: RedactRegion[] = [...this.transform.redact];
    next[i] = { ...cur, ...box };
    this.transform.redact = next;
    this.touch();
  }

  endRegionDrag(): void {
    this.#dragMark = null;
  }

  /** 칸 하나를 고친다. 오버레이와 같이 되돌리기 지점은 남기지 않는다.
   *  값을 가두는 규칙은 전부 applyRedactPatch에 있다. */
  updateRegion(id: string, patch: RedactPatch): void {
    const i = this.transform.redact.findIndex((r) => r.id === id);
    if (i < 0) return;
    const next: RedactRegion[] = [...this.transform.redact];
    next[i] = applyRedactPatch(next[i], patch, this.frames.length);
    this.transform.redact = next;
    this.touch();
  }
}

export const editor = new EditorState();
