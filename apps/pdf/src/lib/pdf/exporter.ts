import { degrees, PDFDocument } from "pdf-lib";
import type { PageItem, SourceDoc } from "./types";

/** 페이지 목록(순서·회전 반영)을 하나의 PDF 바이트로 합친다. */
export async function buildPdf(
  items: PageItem[],
  sources: Map<string, SourceDoc>,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const libCache = new Map<string, PDFDocument>();

  for (const item of items) {
    const src = sources.get(item.sourceId);
    if (!src) continue;

    if (src.kind === "pdf") {
      let libDoc = libCache.get(src.id);
      if (!libDoc) {
        libDoc = await PDFDocument.load(src.bytes);
        libCache.set(src.id, libDoc);
      }
      const [copied] = await out.copyPages(libDoc, [item.pageIndex]);
      const baseAngle = copied.getRotation().angle;
      copied.setRotation(degrees((baseAngle + item.rotation) % 360));
      out.addPage(copied);
    } else {
      const img =
        src.mime === "image/png"
          ? await out.embedPng(src.bytes)
          : await out.embedJpg(src.bytes);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      if (item.rotation) page.setRotation(degrees(item.rotation));
    }
  }

  return out.save();
}
