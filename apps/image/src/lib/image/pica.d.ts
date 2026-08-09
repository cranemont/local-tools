declare module "pica" {
  interface PicaResizeOptions {
    quality?: number;
    alpha?: boolean;
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
  }

  class Pica {
    constructor(options?: { features?: string[] });
    resize(
      from: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
      to: HTMLCanvasElement,
      options?: PicaResizeOptions,
    ): Promise<HTMLCanvasElement>;
  }

  export default Pica;
}
