/** 애니메이션(GIF·WebP)은 ImageDecoder로, 정지 이미지(PNG·JPG)는 createImageBitmap으로 디코딩. */
export type SourceKind = "animated" | "still";

export interface FrameSource {
  id: string;
  kind: SourceKind;
  name: string;
  mime: string;
  /** 원본 바이트 — 온디맨드 풀사이즈 프레임 디코딩에 사용. */
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  frameCount: number;
}

export interface Frame {
  id: string;
  sourceId: string;
  /** 소스 내 프레임 인덱스 (정지 이미지는 항상 0). */
  frameIndex: number;
  /** 표시 시간(ms). 배속과 무관한 원본 값. */
  delayMs: number;
  selected: boolean;
  /** 필름스트립 썸네일 dataURL (작은 크기만 상주). */
  thumb: string;
}

export type Rotation = 0 | 90 | 180 | 270;

/** 베이스 캔버스 좌표계의 크롭 영역. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 출력 변형 — 적용 순서: 크롭 → 회전 → 뒤집기 → 배율. */
export interface Transform {
  crop: CropRect | null;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
  /** 1 = 100%. */
  scale: number;
}
