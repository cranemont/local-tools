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

/** 목표 용량 입력의 단위 — 화면에서 고르고 바이트로 환산해 파이프라인에 넘긴다. */
export type SizeUnit = "KB" | "MB";

export const UNIT_BYTES: Record<SizeUnit, number> = {
  KB: 1024,
  MB: 1024 * 1024,
};

/** 전체 장에 일괄 적용되는 출력 파이프라인 설정. */
export interface OutputSettings {
  format: OutputFormat;
  /** 1–100. PNG(무손실)에서는 무시된다. 목표 용량을 켜면 탐색의 상한이 된다. */
  quality: number;
  resize: ResizeSpec;
  /** 원본 EXIF를 출력에 유지 (JPEG·WebP 출력만 지원). */
  keepExif: boolean;
  /** PNG 전용 팔레트 색 수(2–256). null이면 색을 줄이지 않는다. */
  pngColors: number | null;
  /** PNG 색 수 축소에 Floyd–Steinberg 디더링을 쓴다. */
  pngDither: boolean;
  /** 목표 용량(바이트). null이면 탐색하지 않고 위 설정 그대로 한 번만 인코딩한다. */
  targetBytes: number | null;
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

/** 알파를 담을 수 있는 입력 형식인가 — JPEG로 내보낼 때 투명이 사라지는지 가리는 데 쓴다.
 *  픽셀에 실제로 투명이 있는지는 전수 검사 없이 알 수 없어 형식으로만 가른다
 *  (JPEG·BMP 원본은 애초에 알파가 없으므로 경고할 것이 없다). */
export function mayHaveAlpha(mime: string): boolean {
  return (
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/avif" ||
    mime === "image/gif" ||
    mime === "image/svg+xml" ||
    mime === "image/heic" ||
    mime === "image/heif"
  );
}

/** EXIF 유지를 지원하는 출력 — PNG(무손실 관례상 제외)·AVIF(HEIF 컨테이너)는 미지원. */
export function supportsExifKeep(format: OutputFormat): boolean {
  return format === "jpeg" || format === "webp";
}
