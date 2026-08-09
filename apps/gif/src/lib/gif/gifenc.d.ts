// gifenc@1.0.3은 타입 선언을 제공하지 않는다 — 소스(src/index.js) 기준 수기 선언.
declare module "gifenc" {
  export type PaletteFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface WriteFrameOptions {
    palette?: number[][];
    /** ms 단위 (내부에서 1/100초로 변환). */
    delay?: number;
    /** 첫 프레임에서만 의미 있음: -1=1회 재생, 0=무한, n>0=추가 반복 횟수. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** GIF disposal method (transparent=true면 기본 2). */
    dispose?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void;
    finish(): void;
    /** 지금까지 쓴 바이트의 복사본. */
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
  }

  export function GIFEncoder(opts?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: PaletteFormat;
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    },
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: PaletteFormat,
  ): Uint8Array<ArrayBuffer>;
}
