import { t } from "../i18n";
import { loadImage, releaseAll, releaseOne } from "../image/decode";
import { rotatedSize } from "../image/pipeline";
import type {
  CropRect,
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

/** 크롭 영역의 최소 변 길이(px). */
export const MIN_CROP = 8;

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
  return { rotation: tf.rotation, crop: tf.crop ? { ...tf.crop } : null };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
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
  keepExif = $state(false);

  cropMode = $state(false);
  /** 확정 전 크롭 후보 — 점선으로만 보이고, 자르기를 눌러야 실제 편집이 된다. */
  cropDraft = $state<CropRect | null>(null);
  /** 크롭 비율 프리셋 — null=자유, 그 외 w/h 비율값. */
  cropRatio = $state<number | null>(null);

  busy = $state(false);
  busyMsg = $state("");
  error = $state("");
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
    }),
  );

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
    try {
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        this.busyMsg = t.editor.loading(file.name, i + 1, arr.length);
        try {
          const item = await loadImage(file);
          this.items = [...this.items, item];
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      this.busy = false;
      this.busyMsg = "";
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

  // ── 장별 편집 (선택한 장에만 적용) ───────────────
  rotateCurrent(): void {
    const item = this.currentItem;
    if (!item) return;
    this.mark();
    item.transform.rotation = ((item.transform.rotation + 90) % 360) as Rotation;
    // 회전하면 크롭 좌표계가 달라진다 — 크롭 초기화.
    item.transform.crop = null;
    this.cropDraft = null;
    this.touch();
  }

  setCurrentCrop(rect: CropRect | null): void {
    const item = this.currentItem;
    if (!item) return;
    this.mark();
    item.transform.crop = rect;
    this.touch();
  }

  resetCurrentEdit(): void {
    const item = this.currentItem;
    if (!item) return;
    this.mark();
    item.transform = { rotation: 0, crop: null };
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
    this.setCurrentCrop({ ...draft });
    this.cropMode = false;
    this.cropDraft = null;
  }

  setCropRatio(ratio: number | null): void {
    this.cropRatio = ratio;
    const item = this.currentItem;
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

  setResizeNone(): void {
    this.resizeMode = "none";
    this.touch();
  }

  setResizeScale(pct: number): void {
    this.resizeMode = "scale";
    if (Number.isFinite(pct)) {
      this.resizeScale = Math.min(400, Math.max(1, Math.round(pct)));
    }
    this.touch();
  }

  setResizeWidth(px: number): void {
    this.resizeMode = "width";
    if (Number.isFinite(px)) {
      this.resizeWidth = Math.min(20000, Math.max(1, Math.round(px)));
    }
    this.touch();
  }

  setResizeHeight(px: number): void {
    this.resizeMode = "height";
    if (Number.isFinite(px)) {
      this.resizeHeight = Math.min(20000, Math.max(1, Math.round(px)));
    }
    this.touch();
  }

  setKeepExif(v: boolean): void {
    this.keepExif = v;
    this.touch();
  }
}

export const editor = new EditorState();
