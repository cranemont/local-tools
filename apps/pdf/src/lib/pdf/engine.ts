import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "./pdfjs";
import type { PageItem, SourceDoc } from "./types";

export interface LoadResult {
  source: SourceDoc;
  pages: PageItem[];
}

const uid = (): string => crypto.randomUUID();

const SUPPORTED_IMAGE = new Set(["image/png", "image/jpeg"]);

/**
 * 암호가 걸려 열 수 없다는 신호. 부르는 쪽이 비밀번호를 받아 푼 뒤
 * loadPdf(name, 푼 바이트)로 다시 부르라고 원본을 함께 들려 보낸다.
 */
export class PdfPasswordError extends Error {
  constructor(
    readonly fileName: string,
    readonly bytes: Uint8Array,
  ) {
    super("password required");
    this.name = "PdfPasswordError";
  }
}

/** pdf.js가 던진 것이 비밀번호 요구인가(영어 예외 문구를 화면에 내보내지 않기 위해). */
export function isPasswordException(err: unknown): boolean {
  return err instanceof Error && err.name === "PasswordException";
}

/** 파일 하나를 소스 + 페이지 목록으로 변환. */
export async function loadFile(file: File): Promise<LoadResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) return loadPdf(file.name, bytes);
  if (SUPPORTED_IMAGE.has(file.type)) return loadImage(file, bytes);

  throw new Error(`지원하지 않는 형식이에요: ${file.name}`);
}

export async function loadPdf(name: string, bytes: Uint8Array): Promise<LoadResult> {
  // pdf.js가 버퍼를 detach할 수 있으니 복사본을 넘기고 원본은 내보내기용으로 보존.
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (isPasswordException(err)) throw new PdfPasswordError(name, bytes);
    throw err;
  }

  const sourceId = uid();
  const source: SourceDoc = {
    id: sourceId,
    kind: "pdf",
    name,
    mime: "application/pdf",
    bytes,
    pageCount: doc.numPages,
  };

  const pages: PageItem[] = [];
  // 문서를 연 뒤로는 어떻게 끝나든 반드시 닫는다 — 썸네일 한 장에 걸려 던지면
  // 워커 쪽 문서가 남고, 다시 떨어뜨릴 때마다 한 벌씩 쌓인다.
  try {
    for (let i = 0; i < doc.numPages; i++) {
      const thumb = await renderThumb(doc, i);
      pages.push({
        id: uid(),
        sourceId,
        pageIndex: i,
        rotation: 0,
        selected: false,
        thumb,
        label: `${name} · ${i + 1}p`,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return { source, pages };
}

async function renderThumb(
  doc: PDFDocumentProxy,
  pageIndex: number,
  maxSize = 240,
): Promise<string> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = maxSize / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 컨텍스트를 만들 수 없어요.");

  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  const url = canvas.toDataURL("image/png");
  page.cleanup();
  return url;
}

async function loadImage(file: File, bytes: Uint8Array): Promise<LoadResult> {
  const sourceId = uid();
  const source: SourceDoc = {
    id: sourceId,
    kind: "image",
    name: file.name,
    mime: file.type,
    bytes,
    pageCount: 1,
  };
  const thumb = await blobToDataURL(file);
  const pages: PageItem[] = [
    {
      id: uid(),
      sourceId,
      pageIndex: 0,
      rotation: 0,
      selected: false,
      thumb,
      label: file.name,
    },
  ];
  return { source, pages };
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
