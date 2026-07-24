import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "./pdfjs";

export interface RasterPage {
  id: string;
  name: string;
  pageIndex: number;
  width: number;
  height: number;
  blob: Blob;
  /** 미리보기용 object URL — 다 쓴 뒤 revoke 필요. */
  url: string;
}

const uid = (): string => crypto.randomUUID();

/** PDF의 각 페이지를 PNG로 렌더한다. scale은 pdf.js 뷰포트 배율(2 ≈ 144dpi). */
export async function rasterizePdf(
  name: string,
  bytes: Uint8Array,
  scale: number,
  onProgress?: (page: number, total: number) => void,
): Promise<RasterPage[]> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc: PDFDocumentProxy = await loadingTask.promise;

  const base = stripExt(name);
  const pad = String(doc.numPages).length;
  const out: RasterPage[] = [];

  for (let i = 0; i < doc.numPages; i++) {
    onProgress?.(i + 1, doc.numPages);
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d 컨텍스트를 만들 수 없어요.");

    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    const blob = await canvasToBlob(canvas);
    out.push({
      id: uid(),
      name: `${base}-${String(i + 1).padStart(pad, "0")}.png`,
      pageIndex: i,
      width: canvas.width,
      height: canvas.height,
      blob,
      url: URL.createObjectURL(blob),
    });
    page.cleanup();
  }

  await loadingTask.destroy();
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG 변환에 실패했어요."))),
      "image/png",
    );
  });
}

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}
