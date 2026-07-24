export type SourceKind = "pdf" | "image";

export interface SourceDoc {
  id: string;
  kind: SourceKind;
  name: string;
  mime: string;
  /** 원본 바이트 — 내보내기 때 pdf-lib가 페이지 복사/이미지 임베드에 사용. */
  bytes: Uint8Array;
  pageCount: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface PageItem {
  id: string;
  sourceId: string;
  /** PDF는 0-based 페이지 인덱스, 이미지는 항상 0. */
  pageIndex: number;
  /** 사용자가 추가로 적용한 회전(원본 회전에 더해짐). */
  rotation: Rotation;
  selected: boolean;
  /** 썸네일 dataURL. */
  thumb: string;
  label: string;
}
