export type Rotation = 0 | 90 | 180 | 270;

/** 회전 적용 후 좌표계의 크롭 영역. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 장별 편집 — 적용 순서: 회전 → 반전 → 크롭. 회전이 바뀌면 크롭은 초기화된다.
 *  반전은 회전 후 화면 좌표계에서 뒤집으므로 크롭은 좌표만 거울로 옮긴다. */
export interface ItemTransform {
  rotation: Rotation;
  flipX: boolean;
  flipY: boolean;
  crop: CropRect | null;
}

/** 필름스트립에 올라온 이미지 한 장. 풀사이즈 비트맵은 온디맨드 디코딩(decode.ts). */
export interface ImageItem {
  id: string;
  /** 원본 파일명 (확장자 포함). */
  name: string;
  mime: string;
  /** 원본 바이트 — 온디맨드 디코딩·원본 미리보기에 사용. */
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** 필름스트립 썸네일 dataURL (작은 크기만 상주). */
  thumb: string;
  transform: ItemTransform;
}

export type OutputFormat = "jpeg" | "png" | "webp" | "avif";

export type ResizeMode = "none" | "scale" | "width" | "height" | "longest" | "exact";

/** 목표 캔버스와 그림의 비율이 어긋날 때 무엇을 할지. exact 모드에서만 갈린다
 *  — 나머지 모드는 목표 크기 자체를 비율에 맞춰 계산하므로 언제나 stretch와 같다. */
export type FitMode = "stretch" | "contain" | "cover";

/** 공통 리사이즈 설정. exact를 뺀 모든 모드는 비율을 유지한다. */
export interface ResizeSpec {
  mode: ResizeMode;
  /** mode=scale일 때 배율(%). */
  scale: number;
  /** mode=width·exact일 때 목표 가로(px). */
  width: number;
  /** mode=height·exact일 때 목표 세로(px). */
  height: number;
  /** mode=longest일 때 긴 변 목표(px). */
  longest: number;
  /** mode=exact에서 비율이 어긋날 때의 처리. */
  fit: FitMode;
  /** contain 여백 색. null이면 투명 — 알파가 없는 JPEG는 흰색으로 떨어진다. */
  padColor: string | null;
  /** 목표 치수가 원본보다 크면 원본 크기로 둔다(width·height·longest에만 건다).
   *  배율은 부른 배수가 곧 요청이고 exact는 캔버스가 고정이라 둘 다 해당 없음. */
  noEnlarge: boolean;
}

/** 전체 장에 일괄 적용되는 출력 파이프라인 설정. */
export interface OutputSettings {
  format: OutputFormat;
  /** 1–100. PNG(무손실)에서는 무시된다. */
  quality: number;
  resize: ResizeSpec;
  /** 원본 EXIF를 출력에 유지 (JPEG·WebP 출력만 지원). */
  keepExif: boolean;
}

export const OUTPUT_MIME: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export const OUTPUT_EXT: Record<OutputFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
};

/** EXIF 유지를 지원하는 출력 — PNG(무손실 관례상 제외)·AVIF(HEIF 컨테이너)는 미지원. */
export function supportsExifKeep(format: OutputFormat): boolean {
  return format === "jpeg" || format === "webp";
}
