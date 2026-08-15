import type { PDFDocumentProxy } from "pdfjs-dist";
import { probeOrder } from "./compress";
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

/** 문서를 열어 본 결과 — 쪽 수, 글자 레이어 유무, 그리고 그 판단의 근거 범위. */
export interface PdfProbe {
  pageCount: number;
  /** 글자가 한 자라도 있는가. 거짓이면 아래 두 값과 같이 읽어야 한다. */
  hasText: boolean;
  /** 글자를 찾느라 실제로 열어 본 쪽 수. */
  scannedPages: number;
  /** 모든 쪽을 열어 봤는가. 거짓이면 hasText=false는 "훑은 범위에는 없다"는 뜻이다. */
  complete: boolean;
}

/**
 * 글자를 찾느라 문서를 훑는 시간의 상한(ms).
 *
 * 쪽당 비용을 재 보면(node 24, pdfjs-dist v6, 합성 문서) 글자 없는 쪽은 싸다 —
 * 쪽마다 JPEG 한 장인 스캔본 모양이 0.1~0.35ms/쪽이라 500쪽이 62ms고, 선 400개짜리
 * 도형 쪽이 0.6ms/쪽이다. 비싼 것은 선 2만 개짜리 도면으로 26ms/쪽이라 200쪽이면
 * 5.3초다. 그래서 쪽 수가 아니라 시간으로 끊고, 끊긴 경우 몇 쪽을 봤는지 화면에 적는다.
 */
const PROBE_BUDGET_MS = 1500;

/**
 * 용량 줄이기 화면이 결정에 쓰는 값을 잰다.
 *
 * 쪽 수는 시도 횟수를 깎는 데 쓰고(compress.ts의 `attemptBudget`), 글자 레이어
 * 유무는 "이미지로 다시 만들기"에 경고를 띄울지 정하는 데 쓴다. 글을 재구성하지
 * 않고 조각이 하나라도 있는지만 보므로 `extractPdfText`보다 값싸다.
 *
 * 예전에는 앞 5쪽만 봤다. 6쪽부터 글자가 시작하는 문서에 "글자 없음"이 붙어서,
 * 글자를 영구히 잃는 래스터를 안심하고 누르게 됐다. 지금은 전 쪽을 훑되 순서를
 * 문서 전체에 흩고(`probeOrder`) 시간 상한에 걸리면 멈춘 자리를 그대로 돌려준다.
 */
export async function probePdf(
  name: string,
  bytes: Uint8Array,
): Promise<PdfProbe> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (isPasswordException(err)) throw new PdfPasswordError(name, bytes);
    throw err;
  }

  try {
    const order = probeOrder(doc.numPages);
    const started = performance.now();
    let scanned = 0;
    for (const i of order) {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      const found = content.items.some(
        (item) => "str" in item && item.str.trim() !== "",
      );
      page.cleanup();
      scanned++;
      if (found) {
        return {
          pageCount: doc.numPages,
          hasText: true,
          scannedPages: scanned,
          complete: scanned === order.length,
        };
      }
      if (performance.now() - started >= PROBE_BUDGET_MS) break;
    }
    return {
      pageCount: doc.numPages,
      hasText: false,
      scannedPages: scanned,
      complete: scanned === order.length,
    };
  } finally {
    await loadingTask.destroy();
  }
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
