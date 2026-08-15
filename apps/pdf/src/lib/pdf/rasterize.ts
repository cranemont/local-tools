import type { PDFDocumentProxy } from "pdfjs-dist";
import { isPasswordException, PdfPasswordError } from "./engine";
import { pdfjsLib } from "./pdfjs";
import { RangeSpecError, resolveRange } from "./range";

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

/** 내보낼 수 있는 이미지 형식 — 전부 크로미엄 네이티브 인코더라 새 의존성이 없다. */
export type RasterFormat = "png" | "jpeg" | "webp";

export interface RasterOptions {
  /** 72dpi가 기준 배율 1이다(pdf.js 뷰포트 규약). */
  dpi: number;
  format: RasterFormat;
  /** "1-5, 8, 12-" 표기. 비우면 전 쪽. */
  pageSpec?: string;
  /** 손실 형식일 때의 품질(0~1). PNG는 무시된다. */
  quality?: number;
}

const MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const EXT: Record<RasterFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

const uid = (): string => crypto.randomUUID();

/** 형식의 파일 확장자(화면의 ".png" 표시와 파일 이름이 같은 곳에서 나오게). */
export const formatExt = (format: RasterFormat): string => EXT[format];

/** PDF의 지정한 쪽을 이미지로 렌더한다. */
export async function rasterizePdf(
  name: string,
  bytes: Uint8Array,
  options: RasterOptions,
  onProgress?: (page: number, total: number) => void,
): Promise<RasterPage[]> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    // 암호가 걸린 문서 — 부르는 쪽이 비밀번호를 받아 푼 바이트로 다시 부른다.
    if (isPasswordException(err)) throw new PdfPasswordError(name, bytes);
    throw err;
  }

  const base = stripExt(name);
  const pad = String(doc.numPages).length;
  const scale = options.dpi / 72;
  const mime = MIME[options.format];
  // 알파가 없는 형식은 빈 자리가 검게 나온다 — 흰 종이를 먼저 깔아 둔다.
  const opaque = options.format === "jpeg";

  const out: RasterPage[] = [];

  try {
    const spec = options.pageSpec?.trim();
    let targets: number[];
    if (spec) {
      // 편집 탭과 같은 규칙(resolveRange) — 조각 하나라도 문서 밖이면 전체를 거부한다.
      // 예전엔 invalid를 버리고 indices만 읽어서, 9쪽 문서의 "12-"가 말없이 0장이 됐다.
      const { indices, problem } = resolveRange(spec, doc.numPages);
      if (problem) throw new RangeSpecError(problem, name);
      targets = indices;
    } else {
      targets = Array.from({ length: doc.numPages }, (_, i) => i);
    }

    for (let n = 0; n < targets.length; n++) {
      const i = targets[n];
      onProgress?.(n + 1, targets.length);
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d 컨텍스트를 만들 수 없어요.");
      if (opaque) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const blob = await canvasToBlob(canvas, mime, options.quality);
      out.push({
        id: uid(),
        name: `${base}-${String(i + 1).padStart(pad, "0")}.${EXT[options.format]}`,
        pageIndex: i,
        width: canvas.width,
        height: canvas.height,
        blob,
        url: URL.createObjectURL(blob),
      });
      page.cleanup();
    }
  } catch (err) {
    // 던지면 이 배열은 아무에게도 안 간다 — 여기서 거두지 않으면 만들다 만
    // 미리보기 URL이 주인 없이 남는다(부르는 쪽은 받은 것만 거둘 수 있다).
    for (const p of out) URL.revokeObjectURL(p.url);
    throw err;
  } finally {
    // 문서를 연 뒤로는 어떻게 끝나든 반드시 닫는다 — 깨진 쪽 하나에 걸려 던지면
    // 워커 쪽 문서가 남고, 다시 시도할 때마다 한 벌씩 쌓인다.
    await loadingTask.destroy();
  }

  return out;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("이미지 변환에 실패했어요."))),
      mime,
      quality,
    );
  });
}

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}
