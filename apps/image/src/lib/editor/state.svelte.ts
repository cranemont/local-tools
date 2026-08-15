import { t } from "../i18n";
import { loadImage, releaseAll, releaseOne } from "../image/decode";
import { MAX_COLORS, MIN_COLORS } from "../image/quantize";
import { rotatedSize } from "../image/size";
import { UNIT_BYTES } from "../image/types";
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
  SizeUnit,
} from "../image/types";

export const SCALE_DEFAULT = 50;
export const WIDTH_DEFAULT = 1280;
export const HEIGHT_DEFAULT = 1080;
export const LONGEST_DEFAULT = 1280;

/** 목표 치수의 상한 — 입력·계산 모두 이 값으로 자른다. */
const SIZE_MAX = 20000;

/** 목표 용량 입력의 상한(단위별). KB는 4GB 근처가 아니라 상식적인 자리에서 자른다. */
const TARGET_MAX: Record<SizeUnit, number> = { KB: 999999, MB: 4096 };

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
  /** PNG 팔레트 색 수. null이면 색을 줄이지 않는다(기본) — 줄이면 반투명이 사라진다. */
  pngColors = $state<number | null>(null);
  /** 디더링은 기본이 꺼짐이다. 띠는 줄지만 고주파 노이즈가 늘어 PNG가 커진다 —
   *  실측에서 화면 캡처를 4색으로 줄일 때 48% → 82%였다(용량을 줄이려고 켜는 기능인데
   *  켜 두면 반대로 간다). 띠가 거슬리는 사람만 켠다. */
  pngDither = $state(false);
  /** 목표 용량을 켰는가. 끄면 아래 두 값은 그대로 남아 다시 켤 때 되살아난다. */
  targetOn = $state(false);
  targetValue = $state(1);
  targetUnit = $state<SizeUnit>("MB");
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

  /** 치수 칸에 값이 놓였는가 — 사용자가 넣었거나 모드 전환이 한 번 채운 것.
   *  값이 기본값과 같은지로 재면 가로 칸에 1280(=WIDTH_DEFAULT)을 직접 넣어 둔 사람의 값이
   *  모드를 옮겼다 돌아올 때 덮인다(1279·1281은 안 덮인다). 그래서 값이 아니라 사실로 남긴다. */
  private widthFilled = false;
  private heightFilled = false;
  private longestFilled = false;

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

  /** 목표 용량(바이트). 꺼져 있으면 null이고 파이프라인은 탐색을 건너뛴다. */
  readonly targetBytes = $derived.by((): number | null => {
    if (!this.targetOn) return null;
    const bytes = Math.round(this.targetValue * UNIT_BYTES[this.targetUnit]);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
  });

  readonly settings = $derived.by(
    (): OutputSettings => ({
      format: this.format,
      quality: this.quality,
      resize: this.resizeSpec,
      keepExif: this.keepExif,
      pngColors: this.pngColors,
      pngDither: this.pngDither,
      targetBytes: this.targetBytes,
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

  /** null이면 색을 줄이지 않는다. */
  setPngColors(n: number | null): void {
    if (n === null) this.pngColors = null;
    else if (Number.isFinite(n)) {
      this.pngColors = clamp(Math.round(n), MIN_COLORS, MAX_COLORS);
    }
    this.touch();
  }

  setPngDither(v: boolean): void {
    this.pngDither = v;
    this.touch();
  }

  setTargetOn(v: boolean): void {
    this.targetOn = v;
    this.touch();
  }

  setTargetValue(n: number): void {
    if (Number.isFinite(n)) {
      this.targetValue = clamp(Math.round(n), 1, TARGET_MAX[this.targetUnit]);
    }
    this.touch();
  }

  setTargetUnit(unit: SizeUnit): void {
    this.targetUnit = unit;
    this.targetValue = clamp(this.targetValue, 1, TARGET_MAX[unit]);
    this.touch();
  }

  /** 프리셋 칩 — 값과 단위를 함께 놓고 켠다. */
  setTarget(value: number, unit: SizeUnit): void {
    this.targetUnit = unit;
    this.targetValue = clamp(Math.round(value), 1, TARGET_MAX[unit]);
    this.targetOn = true;
    this.touch();
  }

  /** 모드 전환. 아직 손대지 않은 칸만 현재 장 크기로 채운다 —
   *  넣어 둔 값은 모드를 오갔다 돌아와도 그대로 남는다. */
  setResizeMode(mode: ResizeMode, base: { w: number; h: number } | null): void {
    this.resizeMode = mode;
    if (base) {
      if (mode === "width" && !this.widthFilled) {
        this.resizeWidth = clampSize(base.w);
        this.widthFilled = true;
      } else if (mode === "height" && !this.heightFilled) {
        this.resizeHeight = clampSize(base.h);
        this.heightFilled = true;
      } else if (mode === "longest" && !this.longestFilled) {
        this.resizeLongest = clampSize(Math.max(base.w, base.h));
        this.longestFilled = true;
      } else if (mode === "exact") {
        if (!this.widthFilled) {
          this.resizeWidth = clampSize(base.w);
          this.widthFilled = true;
        }
        if (!this.heightFilled) {
          this.resizeHeight = clampSize(base.h);
          this.heightFilled = true;
        }
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

  /** ratio(가로/세로)를 넘기면 체인이 켜져 있을 때 나머지 변이 따라온다.
   *  체인이 따라 쓴 칸도 값이 놓인 것으로 친다 — 안 그러면 모드를 옮길 때 그 칸만 덮인다. */
  setResizeWidth(px: number, ratio: number | null = null): void {
    if (Number.isFinite(px)) {
      this.resizeWidth = clampSize(px);
      this.widthFilled = true;
      if (ratio && this.lockRatio) {
        this.resizeHeight = clampSize(this.resizeWidth / ratio);
        this.heightFilled = true;
      }
    }
    this.touch();
  }

  setResizeHeight(px: number, ratio: number | null = null): void {
    if (Number.isFinite(px)) {
      this.resizeHeight = clampSize(px);
      this.heightFilled = true;
      if (ratio && this.lockRatio) {
        this.resizeWidth = clampSize(this.resizeHeight * ratio);
        this.widthFilled = true;
      }
    }
    this.touch();
  }

  setResizeLongest(px: number): void {
    if (Number.isFinite(px)) {
      this.resizeLongest = clampSize(px);
      this.longestFilled = true;
    }
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
    if (v && ratio) {
      this.resizeHeight = clampSize(this.resizeWidth / ratio);
      this.heightFilled = true;
    }
    this.touch();
  }

  setKeepExif(v: boolean): void {
    this.keepExif = v;
    this.touch();
  }
}

export const editor = new EditorState();
