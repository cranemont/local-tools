import type { RedactRegion } from "./redact";

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

/** 출력 변형 — 적용 순서: 크롭 → 회전 → 뒤집기 → 배율 → 가리기. */
export interface Transform {
  crop: CropRect | null;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
  /** 1 = 100%. */
  scale: number;
  /** 모자이크·블러로 덮을 영역. 좌표는 crop과 같은 베이스 캔버스 기준이라,
   *  크롭·회전·배율을 바꾸면 renderFrame이 같이 옮겨 그린다(redact.ts).
   *  변형과 한 칸에 두는 이유: 영역은 이 기하를 따라다니고, 되돌리기·스냅샷도 함께 떠야 한다. */
  redact: readonly RedactRegion[];
}
