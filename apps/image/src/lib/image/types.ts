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
}

export type OutputFormat = "jpeg" | "png" | "webp";

export type ResizeMode = "none" | "scale" | "width" | "height";

/** 공통 리사이즈 설정 — 비율은 항상 유지된다. */
export interface ResizeSpec {
  mode: ResizeMode;
  /** mode=scale일 때 배율(%). */
  scale: number;
  /** mode=width일 때 목표 가로(px). */
  width: number;
  /** mode=height일 때 목표 세로(px). */
  height: number;
}

/** 전체 장에 일괄 적용되는 출력 파이프라인 설정. */
export interface OutputSettings {
  format: OutputFormat;
  /** 1–100. PNG(무손실)에서는 무시된다. */
  quality: number;
  resize: ResizeSpec;
}

export const OUTPUT_MIME: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const OUTPUT_EXT: Record<OutputFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};
