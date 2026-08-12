export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** OKLCH(tokens.css에 적힌 값) → sRGB. */
export function oklchToRgb(color: Oklch): Rgb;

/** `#rrggbb` 문자열. */
export function hex(rgb: Rgb): string;

export function crc32(bytes: Uint8Array): number;

/** RGBA 픽셀 버퍼 → PNG 바이트. */
export function encodePng(rgba: Uint8Array, size: number): Uint8Array;

/** 아이콘 글리프를 그리는 아주 작은 픽셀 캔버스. */
export class IconCanvas {
  constructor(size: number);
  readonly size: number;
  set(x: number, y: number, color: Rgb, alpha: number): void;
  rect(x0: number, y0: number, x1: number, y1: number, color: Rgb): void;
  roundedBackground(radius: number, color: Rgb): void;
  png(): Uint8Array;
}

/** 캐시 우선 서비스 워커 소스를 만든다(precache 밖의 같은 오리진 GET은 받아 온 뒤 캐시). */
export function serviceWorkerSource(options: { name: string; precache: string[] }): string;
