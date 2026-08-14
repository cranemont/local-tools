import { t } from "../i18n";
import { loadImage, releaseAll, releaseOne } from "../image/decode";
import { rotatedSize } from "../image/size";
import type {
  CropRect,
  FitMode,
  ImageItem,
  ItemTransform,
  OutputFormat,
  OutputSettings,
  ResizeMode,
  ResizeSpec,
  Rotation,
} from "../image/types";

export const SCALE_DEFAULT = 50;
export const WIDTH_DEFAULT = 1280;
export const HEIGHT_DEFAULT = 1080;
export const LONGEST_DEFAULT = 1280;

/** 목표 치수의 상한 — 입력·계산 모두 이 값으로 자른다. */
const SIZE_MAX = 20000;

/** 크롭 영역의 최소 변 길이(px). */
export const MIN_CROP = 8;

/** 크롭 비율 프리셋 — 세로 전환은 값을 뒤집어 쓴다(16:9 → 9:16). */
export const CROP_RATIOS: { id: string; label: string; w: number; h: number }[] = [
  { id: "1:1", label: "1:1", w: 1, h: 1 },
  { id: "4:3", label: "4:3", w: 4, h: 3 },
  { id: "3:2", label: "3:2", w: 3, h: 2 },
  { id: "16:9", label: "16:9", w: 16, h: 9 },
];

/** 프리셋 대신 현재 장의 비율을 쓰는 항목. */
export const CROP_RATIO_ORIGINAL = "original";

/** 되돌리기 깊이. 삭제된 장은 스택에서 밀려날 때까지 메모리에 남는다. */
const HISTORY_MAX = 30;

/** 되돌리기 지점 — 장 목록(순서·구성)과 장별 편집값만 담는다.
 *  형식·품질·리사이즈는 패널에 그대로 보이고 직접 되돌릴 수 있어 제외한다. */
interface Snapshot {
  items: ImageItem[];
  current: number;
  transforms: Map<string, ItemTransform>;
}

function cloneTransform(tf: ItemTransform): ItemTransform {
  return {
    rotation: tf.rotation,
    flipX: tf.flipX,
    flipY: tf.flipY,
    crop: tf.crop ? { ...tf.crop } : null,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function clampSize(px: number): number {
  return clamp(Math.round(px), 1, SIZE_MAX);
}

/** 다른 장에 옮겨 붙일 때처럼 크기가 다를 수 있는 크롭을 그림 안으로 밀어 넣는다. */
function clampCrop(rect: CropRect, bounds: { w: number; h: number }): CropRect {
  const w = clamp(Math.round(rect.w), Math.min(MIN_CROP, bounds.w), bounds.w);
  const h = clamp(Math.round(rect.h), Math.min(MIN_CROP, bounds.h), bounds.h);
  return {
    x: clamp(Math.round(rect.x), 0, Math.max(0, bounds.w - w)),
    y: clamp(Math.round(rect.y), 0, Math.max(0, bounds.h - h)),
    w,
    h,
  };
}

/** 좌우(또는 상하) 반전 뒤에도 같은 곳이 남도록 크롭을 거울로 옮긴다. */
function mirrorCrop(crop: CropRect, axis: "x" | "y", bounds: { w: number; h: number }) {
  if (axis === "x") crop.x = Math.max(0, bounds.w - crop.x - crop.w);
  else crop.y = Math.max(0, bounds.h - crop.y - crop.h);
}

/** 비율 프리셋에 맞게 줄인 뒤 그림 안으로 밀어 넣는다. */
function fitRatio(
  rect: CropRect,
  ratio: number,
  bounds: { w: number; h: number },
): CropRect {
  let w = rect.w;
  let h = rect.h;
  if (w / h > ratio) w = h * ratio;
  else h = w / ratio;
  const shrink = Math.min(1, bounds.w / w, bounds.h / h);
  w = clamp(Math.round(w * shrink), MIN_CROP, bounds.w);
  h = clamp(Math.round(h * shrink), MIN_CROP, bounds.h);
  return {
    x: clamp(rect.x, 0, Math.max(0, bounds.w - w)),
    y: clamp(rect.y, 0, Math.max(0, bounds.h - h)),
    w,
    h,
  };
}

/** 단일 에디터 뷰의 전역 상태. 앱에 에디터가 하나뿐이라 모듈 싱글턴으로 둔다. */
export class EditorState {
  items = $state<ImageItem[]>([]);
  current = $state(0);

  format = $state<OutputFormat>("jpeg");
  quality = $state(80);
  resizeMode = $state<ResizeMode>("none");
  resizeScale = $state(SCALE_DEFAULT);
  resizeWidth = $state(WIDTH_DEFAULT);
  resizeHeight = $state(HEIGHT_DEFAULT);
  resizeLongest = $state(LONGEST_DEFAULT);
  resizeFit = $state<FitMode>("contain");
  /** contain 여백 색 — null이면 투명. */
  padColor = $state<string | null>("#ffffff");
  noEnlarge = $state(true);
  /** exact 모드에서 한쪽을 고치면 나머지가 따라온다(체인).
   *  기본은 꺼 둔다 — 켜 두면 1080×1080처럼 비율이 다른 목표를 아예 넣을 수 없다. */
  lockRatio = $state(false);
  keepExif = $state(false);

  /** 회전·반전·크롭을 선택한 장이 아니라 모든 장에 적용한다. */
  applyToAll = $state(false);

  cropMode = $state(false);
  /** 확정 전 크롭 후보 — 점선으로만 보이고, 자르기를 눌러야 실제 편집이 된다. */
  cropDraft = $state<CropRect | null>(null);
  /** 크롭 비율 프리셋 id — null=자유, "original"=현재 장 비율, 그 외 CROP_RATIOS의 id. */
  cropRatioId = $state<string | null>(null);
  /** 프리셋을 세로로 뒤집어 쓴다(4:3 → 3:4). */
  cropPortrait = $state(false);

  busy = $state(false);
  busyMsg = $state("");
  error = $state("");
  /** 마지막 일괄 저장에서 변환하지 못한 장의 id — 카드에 표시한다. */
  saveFailed = $state<string[]>([]);
  /** 편집 리비전 — 미리보기 재계산 트리거로 쓴다. */
  revision = $state(0);

  canUndo = $state(false);
  canRedo = $state(false);
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  readonly currentItem = $derived.by(() =>
    this.items.length
      ? this.items[Math.min(this.current, this.items.length - 1)]
      : null,
  );

  readonly resizeSpec = $derived.by(
    (): ResizeSpec => ({
      mode: this.resizeMode,
      scale: this.resizeScale,
      width: this.resizeWidth,
      height: this.resizeHeight,
      longest: this.resizeLongest,
      fit: this.resizeFit,
      padColor: this.padColor,
      noEnlarge: this.noEnlarge,
    }),
  );

  /** 크롭에 걸린 비율(w/h). 자유면 null. */
  readonly cropRatio = $derived.by((): number | null => {
    const id = this.cropRatioId;
    if (!id) return null;
    let ratio: number;
    if (id === CROP_RATIO_ORIGINAL) {
      const item = this.currentItem;
      if (!item) return null;
      const size = rotatedSize(item);
      ratio = size.w / size.h;
    } else {
      const preset = CROP_RATIOS.find((r) => r.id === id);
      if (!preset) return null;
      ratio = preset.w / preset.h;
    }
    return this.cropPortrait ? 1 / ratio : ratio;
  });

  readonly settings = $derived.by(
    (): OutputSettings => ({
      format: this.format,
      quality: this.quality,
      resize: this.resizeSpec,
      keepExif: this.keepExif,
    }),
  );

  touch(): void {
    this.revision++;
  }

  // ── 되돌리기 ────────────────────────────────────
  private capture(): Snapshot {
    return {
      items: [...this.items],
      current: this.current,
      transforms: new Map(
        this.items.map((item) => [item.id, cloneTransform(item.transform)]),
      ),
    };
  }

  /** 미리 떠 둔 스냅샷을 되돌리기 지점으로 확정한다. */
  private commit(snap: Snapshot): void {
    this.past.push(snap);
    if (this.past.length > HISTORY_MAX) this.past.shift();
    this.future = [];
    this.syncHistory();
  }

  /** 편집을 바꾸기 직전에 호출 — 지금 상태를 되돌리기 지점으로 남긴다. */
  private mark(): void {
    this.commit(this.capture());
  }

  private restore(snap: Snapshot): void {
    for (const item of snap.items) {
      const tf = snap.transforms.get(item.id);
      if (tf) item.transform = cloneTransform(tf);
    }
    this.items = [...snap.items];
    this.current = Math.min(snap.current, Math.max(0, snap.items.length - 1));
  }

  private syncHistory(): void {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
  }

  undo(): void {
    const snap = this.past.pop();
    if (!snap) return;
    this.future.push(this.capture());
    this.restore(snap);
    // 좌표계가 달라질 수 있으므로 잡아 둔 영역은 버린다.
    this.cancelCrop();
    this.syncHistory();
    this.touch();
  }

  redo(): void {
    const snap = this.future.pop();
    if (!snap) return;
    this.past.push(this.capture());
    this.restore(snap);
    this.cancelCrop();
    this.syncHistory();
    this.touch();
  }

  // ── 임포트 ──────────────────────────────────────
  async addFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files);
    if (!arr.length) return;
    const before = this.capture();
    this.error = "";
    this.busy = true;
    // 한 장이 실패해도 나머지는 계속 붙인다 — 오류는 모아 두었다 한 줄로 알린다.
    const errs: string[] = [];
    try {
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        this.busyMsg = t.editor.loading(file.name, i + 1, arr.length);
        try {
          const item = await loadImage(file);
          this.items = [...this.items, item];
        } catch (err) {
          errs.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      this.busy = false;
      this.busyMsg = "";
    }
    if (errs.length) {
      this.error = errs.length === 1 ? errs[0] : t.errors.andMore(errs[0], errs.length - 1);
    }
    if (this.items.length !== before.items.length) this.commit(before);
    this.touch();
  }

  removeOne(id: string): void {
    const currentId = this.currentItem?.id;
    this.mark();
    releaseOne(id);
    this.items = this.items.filter((item) => item.id !== id);
    const idx = currentId ? this.items.findIndex((item) => item.id === currentId) : -1;
    this.current =
      idx >= 0 ? idx : Math.min(this.current, Math.max(0, this.items.length - 1));
    this.touch();
  }

  clearAll(): void {
    if (!this.items.length) return;
    this.mark();
    this.items = [];
    releaseAll();
    this.current = 0;
    this.error = "";
    this.cancelCrop();
    this.touch();
  }

  select(index: number): void {
    this.current = index;
    this.cancelCrop();
  }

  // ── 장 편집 (applyToAll이 꺼져 있으면 선택한 장에만) ─
  /** 편집을 받을 장 목록. */
  private editTargets(): ImageItem[] {
    if (this.applyToAll) return this.items;
    const item = this.currentItem;
    return item ? [item] : [];
  }

  setApplyToAll(v: boolean): void {
    this.applyToAll = v;
  }

  /** dir=1 시계, dir=-1 반시계. */
  rotate(dir: 1 | -1): void {
    const targets = this.editTargets();
    if (!targets.length) return;
    this.mark();
    for (const item of targets) {
      const next = (item.transform.rotation + dir * 90 + 360) % 360;
      item.transform.rotation = next as Rotation;
      // 회전하면 크롭 좌표계가 달라진다 — 크롭 초기화.
      item.transform.crop = null;
    }
    this.cropDraft = null;
    this.touch();
  }

  flip(axis: "x" | "y"): void {
    const targets = this.editTargets();
    if (!targets.length) return;
    this.mark();
    for (const item of targets) {
      const bounds = rotatedSize(item);
      if (axis === "x") item.transform.flipX = !item.transform.flipX;
      else item.transform.flipY = !item.transform.flipY;
      if (item.transform.crop) mirrorCrop(item.transform.crop, axis, bounds);
    }
    const current = this.currentItem;
    // 잡아 두던 후보도 같이 뒤집어야 화면의 점선이 그대로 남는다.
    if (this.cropDraft && current) mirrorCrop(this.cropDraft, axis, rotatedSize(current));
    this.touch();
  }

  /** 크롭 지정(null이면 해제). 장마다 크기가 다르므로 그림 안으로 밀어 넣는다. */
  setCrop(rect: CropRect | null): void {
    const targets = this.editTargets();
    if (!targets.length) return;
    this.mark();
    for (const item of targets) {
      item.transform.crop = rect ? clampCrop(rect, rotatedSize(item)) : null;
    }
    this.touch();
  }

  resetEdit(): void {
    const targets = this.editTargets();
    if (!targets.length) return;
    this.mark();
    for (const item of targets) {
      item.transform = { rotation: 0, flipX: false, flipY: false, crop: null };
    }
    this.cancelCrop();
    this.touch();
  }

  // ── 크롭 (잡기 → 확정 2단계) ────────────────────
  startCrop(): void {
    const item = this.currentItem;
    if (!item) return;
    // 이미 크롭돼 있으면 그 영역을 그대로 다시 잡아 준다.
    this.cropDraft = item.transform.crop ? { ...item.transform.crop } : null;
    this.cropMode = true;
  }

  cancelCrop(): void {
    this.cropMode = false;
    this.cropDraft = null;
  }

  setCropDraft(rect: CropRect | null): void {
    this.cropDraft = rect;
  }

  /** 점선으로 잡아 둔 영역을 확정 — 여기서 처음으로 실제 크롭이 반영된다. */
  applyCropDraft(): void {
    const draft = this.cropDraft;
    if (!draft || !this.currentItem) return;
    this.setCrop({ ...draft });
    this.cropMode = false;
    this.cropDraft = null;
  }

  setCropRatio(id: string | null): void {
    this.cropRatioId = id;
    this.refitDraft();
  }

  toggleCropPortrait(): void {
    this.cropPortrait = !this.cropPortrait;
    this.refitDraft();
  }

  /** 비율이 바뀌면 잡아 둔 후보를 그 비율로 줄여 다시 앉힌다. */
  private refitDraft(): void {
    const item = this.currentItem;
    const ratio = this.cropRatio;
    if (!ratio || !this.cropDraft || !item) return;
    this.cropDraft = fitRatio(this.cropDraft, ratio, rotatedSize(item));
  }

  // ── 출력 설정 ───────────────────────────────────
  setFormat(f: OutputFormat): void {
    this.format = f;
    this.touch();
  }

  setQuality(q: number): void {
    this.quality = Math.min(100, Math.max(1, Math.round(q)));
    this.touch();
  }

  /** 모드 전환. 아직 손대지 않은 칸만 현재 장 크기로 채운다 —
   *  넣어 둔 값은 모드를 오갔다 돌아와도 그대로 남는다. */
  setResizeMode(mode: ResizeMode, base: { w: number; h: number } | null): void {
    this.resizeMode = mode;
    if (base) {
      if (mode === "width" && this.resizeWidth === WIDTH_DEFAULT) {
        this.resizeWidth = clampSize(base.w);
      } else if (mode === "height" && this.resizeHeight === HEIGHT_DEFAULT) {
        this.resizeHeight = clampSize(base.h);
      } else if (mode === "longest" && this.resizeLongest === LONGEST_DEFAULT) {
        this.resizeLongest = clampSize(Math.max(base.w, base.h));
      } else if (mode === "exact") {
        if (this.resizeWidth === WIDTH_DEFAULT) this.resizeWidth = clampSize(base.w);
        if (this.resizeHeight === HEIGHT_DEFAULT) this.resizeHeight = clampSize(base.h);
      }
    }
    this.touch();
  }

  setResizeScale(pct: number): void {
    if (Number.isFinite(pct)) {
      this.resizeScale = Math.min(400, Math.max(1, Math.round(pct)));
    }
    this.touch();
  }

  /** ratio(가로/세로)를 넘기면 체인이 켜져 있을 때 나머지 변이 따라온다. */
  setResizeWidth(px: number, ratio: number | null = null): void {
    if (Number.isFinite(px)) {
      this.resizeWidth = clampSize(px);
      if (ratio && this.lockRatio) this.resizeHeight = clampSize(this.resizeWidth / ratio);
    }
    this.touch();
  }

  setResizeHeight(px: number, ratio: number | null = null): void {
    if (Number.isFinite(px)) {
      this.resizeHeight = clampSize(px);
      if (ratio && this.lockRatio) this.resizeWidth = clampSize(this.resizeHeight * ratio);
    }
    this.touch();
  }

  setResizeLongest(px: number): void {
    if (Number.isFinite(px)) this.resizeLongest = clampSize(px);
    this.touch();
  }

  setResizeFit(fit: FitMode): void {
    this.resizeFit = fit;
    this.touch();
  }

  setPadColor(color: string | null): void {
    this.padColor = color;
    this.touch();
  }

  setNoEnlarge(v: boolean): void {
    this.noEnlarge = v;
    this.touch();
  }

  /** 체인을 켜는 순간 지금 세로를 현재 비율로 맞춰 둔다 — 켜기만 하고 값이 어긋나 있으면 헷갈린다. */
  setLockRatio(v: boolean, ratio: number | null = null): void {
    this.lockRatio = v;
    if (v && ratio) this.resizeHeight = clampSize(this.resizeWidth / ratio);
    this.touch();
  }

  setKeepExif(v: boolean): void {
    this.keepExif = v;
    this.touch();
  }
}

export const editor = new EditorState();
