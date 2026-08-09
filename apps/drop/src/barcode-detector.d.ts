// Shape Detection API — 표준 TS lib에 아직 없어 최소 선언 (크로미엄 전용).
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
  static getSupportedFormats(): Promise<string[]>;
}
