import { degrees, EncryptedPDFError, PDFDocument } from "pdf-lib";
import { t } from "../i18n";
import type { PageItem, SourceDoc } from "./types";

/** 소스별로 한 번만 파싱하도록 들고 있는 pdf-lib 문서 캐시(분할처럼 여러 번 구울 때 공유). */
export type LibCache = Map<string, PDFDocument>;

/** 페이지 목록(순서·회전 반영)을 하나의 PDF 바이트로 합친다. */
export async function buildPdf(
  items: PageItem[],
  sources: Map<string, SourceDoc>,
  cache: LibCache = new Map(),
): Promise<Uint8Array> {
  const out = await PDFDocument.create();

  for (const item of items) {
    const src = sources.get(item.sourceId);
    if (!src) continue;

    if (src.kind === "pdf") {
      let libDoc = cache.get(src.id);
      if (!libDoc) {
        libDoc = await loadSource(src);
        cache.set(src.id, libDoc);
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

export interface PdfPart {
  name: string;
  bytes: Uint8Array;
}

/**
 * 묶음마다 PDF 하나 — 분할은 병합의 반대 방향이고 엔진은 같다.
 * 파일 이름은 전체 개수의 자릿수에 맞춰 0으로 채운다(탐색기 정렬이 깨지지 않게).
 */
export async function buildPdfParts(
  groups: PageItem[][],
  sources: Map<string, SourceDoc>,
  baseName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfPart[]> {
  // 소스 파싱은 묶음 사이에서 공유한다 — 100쪽을 낱장으로 갈라도 원본은 한 번만 읽는다.
  const cache: LibCache = new Map();
  const pad = String(groups.length).length;
  const parts: PdfPart[] = [];

  for (let i = 0; i < groups.length; i++) {
    onProgress?.(i + 1, groups.length);
    const bytes = await buildPdf(groups[i], sources, cache);
    parts.push({ name: `${baseName}-${String(i + 1).padStart(pad, "0")}.pdf`, bytes });
  }

  return parts;
}

async function loadSource(src: SourceDoc): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(src.bytes);
  } catch (err) {
    // pdf.js는 열지만 pdf-lib은 못 여는 문서가 있다(사용자 비밀번호가 빈 채
    // 소유자 권한만 걸린 경우) — 영어 예외 대신 다음 할 일을 말해 준다.
    if (err instanceof EncryptedPDFError) {
      throw new Error(t.errors.encryptedSource(src.name));
    }
    throw err;
  }
}
