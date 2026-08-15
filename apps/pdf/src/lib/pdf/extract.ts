import type { PDFDocumentProxy } from "pdfjs-dist";
import { isPasswordException, PdfPasswordError } from "./engine";
import { pdfjsLib } from "./pdfjs";
import { RangeSpecError, resolveRange } from "./range";
import {
  joinPages,
  layoutText,
  pieceFromMatrix,
  uprightCorrection,
  type TextPiece,
} from "./text";

/** 한 쪽에서 꺼낸 글. */
export interface ExtractedPage {
  pageIndex: number;
  text: string;
  /** 글자가 한 자도 없었다 — 스캔한 쪽이다. */
  empty: boolean;
}

/** 문서 한 개에서 꺼낸 글 — 저장은 이 단위로 .txt 한 장이다. */
export interface ExtractedDoc {
  /** 원본 파일 이름. */
  name: string;
  /** 저장될 이름(.txt). */
  fileName: string;
  pages: ExtractedPage[];
  /** 쪽을 이어 붙인 최종 본문. */
  text: string;
  /** 글자가 있는 쪽이 하나도 없었다. */
  empty: boolean;
  /** 글자가 없는 쪽 수. */
  emptyPages: number;
}

export interface ExtractOptions {
  /** "1-5, 8, 12-" 표기. 비우면 전 쪽. */
  pageSpec?: string;
}

/**
 * PDF의 지정한 쪽에서 텍스트 레이어를 꺼낸다.
 *
 * 여기가 pdf.js와 닿는 유일한 자리다 — 좌표를 화면 기준으로 옮겨 주고, 줄·문단으로
 * 되돌리는 계산은 text.ts(순수 함수)에 맡긴다.
 *
 * 실패 신호는 래스터화와 같다: 암호는 PdfPasswordError, 쪽 표기는 RangeSpecError.
 */
export async function extractPdfText(
  name: string,
  bytes: Uint8Array,
  options: ExtractOptions,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedDoc> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (isPasswordException(err)) throw new PdfPasswordError(name, bytes);
    throw err;
  }

  // 문서를 연 뒤로는 어떻게 끝나든 반드시 닫는다 — 깨진 쪽 하나에 걸려 던지면
  // 워커 쪽 문서가 남고, 다시 시도할 때마다 한 벌씩 쌓인다.
  const pages: ExtractedPage[] = [];
  try {
    const spec = options.pageSpec?.trim();
    let targets: number[];
    if (spec) {
      // 세 탭이 같은 규칙을 쓴다 — 조각 하나라도 문서 밖이면 전체를 거부한다.
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
      const content = await page.getTextContent();
      // 회전은 여기서 걷어낸다 — text.ts는 "가로로 눕고 위에서 아래로 읽는" 한 가지만 안다.
      // 뷰포트 변환이 첫 번째다. 그런데 그것은 글이 /Rotate에 맞춰 그려졌을 때만
      // 걷어내는 것이고, 회전이 나중에 얹힌 문서에서는 오히려 글을 눕힌다.
      // 그래서 두 번째로 글 자신의 방향을 재서 되돌린다(uprightCorrection).
      const viewport = page.getViewport({ scale: 1 });
      const items: TextItemLike[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue; // 표시 구간(TextMarkedContent)은 글자가 아니다
        items.push(item);
      }
      const matrices = items.map(
        (it) =>
          pdfjsLib.Util.transform(viewport.transform, it.transform) as number[],
      );
      const upright = uprightCorrection(
        matrices,
        viewport.width,
        viewport.height,
      );
      const pieces: TextPiece[] = items.map((it, k) => {
        const m = upright
          ? (pdfjsLib.Util.transform(upright, matrices[k]) as number[])
          : matrices[k];
        return pieceFromMatrix(it.str, m, it.width, it.height, it.hasEOL);
      });
      page.cleanup();

      const laid = layoutText(pieces);
      pages.push({ pageIndex: i, text: laid.text, empty: laid.empty });
    }
  } finally {
    await loadingTask.destroy();
  }

  const emptyPages = pages.filter((p) => p.empty).length;
  return {
    name,
    fileName: `${stripExt(name)}.txt`,
    pages,
    text: joinPages(pages.map((p) => p.text)),
    empty: pages.length === 0 || emptyPages === pages.length,
    emptyPages,
  };
}

/**
 * pdf.js의 TextItem 중 우리가 읽는 부분.
 *
 * 아이템 행렬은 PDF 사용자 좌표(y가 위로)에 있고 쪽 회전이 안 반영돼 있다 — 화면
 * 좌표로 옮기는 것은 위에서 곱하는 행렬들의 몫이다. 배율 1의 변환은 회전·뒤집기뿐이라
 * 길이가 보존되므로 폭·높이는 pdf.js가 잰 값을 그대로 쓴다.
 *
 * (`TextItem`을 pdfjs-dist 루트에서 내보내지 않아 구조로 적는다.)
 */
interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}
