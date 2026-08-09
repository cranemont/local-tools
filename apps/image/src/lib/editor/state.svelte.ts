import { t } from "../i18n";
import { loadImage, releaseAll, releaseOne } from "../image/decode";
import type {
  CropRect,
  ImageItem,
  OutputFormat,
  OutputSettings,
  ResizeMode,
  ResizeSpec,
  Rotation,
} from "../image/types";

export const SCALE_DEFAULT = 50;
export const WIDTH_DEFAULT = 1280;
export const HEIGHT_DEFAULT = 1080;

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
  /** 크롭 비율 프리셋 — null=자유, 그 외 w/h 비율값. */
  cropRatio = $state<number | null>(null);

  busy = $state(false);
  busyMsg = $state("");
  error = $state("");
  /** 편집 리비전 — 미리보기 재계산 트리거로 쓴다. */
  revision = $state(0);

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
    this.touch();
  }

  removeOne(id: string): void {
    const currentId = this.currentItem?.id;
    releaseOne(id);
    this.items = this.items.filter((item) => item.id !== id);
    const idx = currentId ? this.items.findIndex((item) => item.id === currentId) : -1;
    this.current =
      idx >= 0 ? idx : Math.min(this.current, Math.max(0, this.items.length - 1));
    this.touch();
  }

  clearAll(): void {
    this.items = [];
    releaseAll();
    this.current = 0;
    this.error = "";
    this.touch();
  }

  select(index: number): void {
    this.current = index;
    this.cropMode = false;
  }

  // ── 장별 편집 (선택한 장에만 적용) ───────────────
  rotateCurrent(): void {
    const item = this.currentItem;
    if (!item) return;
    item.transform.rotation = ((item.transform.rotation + 90) % 360) as Rotation;
    // 회전하면 크롭 좌표계가 달라진다 — 크롭 초기화.
    item.transform.crop = null;
    this.touch();
  }

  setCurrentCrop(rect: CropRect | null): void {
    const item = this.currentItem;
    if (!item) return;
    item.transform.crop = rect;
    this.touch();
  }

  resetCurrentEdit(): void {
    const item = this.currentItem;
    if (!item) return;
    item.transform = { rotation: 0, crop: null };
    this.cropMode = false;
    this.touch();
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
