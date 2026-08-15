/** hwp 표본을 짓는 절차 — 층 둘이 함께 쓴다.
 *
 * 공통 규약은 `./pdf.ts` 머리말이 정본이다.
 *
 * `doc.ts`에서 갈라 나온 이유는 wasm을 켜는 방법이 층마다 달라서다 — node는 `node_modules`의
 * `.wasm`을 읽어 직접 `init`하고, 브라우저 층은 앱의 `engine.ts`가 받아 SHA-384로 검증한
 * 바이트로 켠다. 켜는 방법만 다르고 **문서를 짓는 절차는 같아야 하므로** 그 절차만 여기 둔다.
 * 그래서 이 파일은 `@rhwp/core`를 값으로 import하지 않고 클래스를 인자로 받는다.
 */

import type { HwpDocument } from "@rhwp/core";

/** `HwpDocument.createEmpty()`를 부를 수 있는 것 — 층마다 다른 자리에서 온다. */
export interface HwpDocumentCtor {
  createEmpty: () => HwpDocument;
}

/** 문서 하나의 명세. 문단과 표를 함께 둘 수 있다. */
export interface HwpSpec {
  /** 본문 문단. 안 주면 글자가 하나도 없는 문서다. */
  paragraphs?: string[];
  /** 표 한 개의 칸 내용(행×열). 빈 문자열이면 빈 칸이다. */
  table?: string[][];
}

/**
 * 명세대로 문서를 지어 손잡이를 돌려준다. 다 쓰면 `free()`.
 *
 * 표는 **첫 문단 끝에 앵커**된다 — 문단 텍스트가 아니라 컨트롤이라는 것이 한글 문서의
 * 성질이고(CLAUDE.md 18번), 그 성질을 재려면 표만 든 문서가 필요하다. `paragraphs`를
 * 비우고 `table`만 주면 **모든 문단의 길이가 0인 문서**가 나온다 — 선택 영역만 내보내는
 * 방식으로는 빈 결과가 되는 문서다.
 */
export function buildHwp(
  HwpDocument: HwpDocumentCtor,
  spec: HwpSpec,
): HwpDocument {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();

  const lines = spec.paragraphs ?? [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) doc.insertParagraph(0, i);
    doc.insertText(0, i, 0, lines[i]);
  }

  if (spec.table) {
    const rows = spec.table.length;
    const cols = Math.max(...spec.table.map((row) => row.length));
    const anchor = lines.length > 0 ? lines.length - 1 : 0;
    const created = JSON.parse(
      doc.createTable(0, anchor, doc.getParagraphLength(0, anchor), rows, cols),
    ) as { paraIdx: number; controlIdx: number };
    // 칸 번호는 행 우선으로 이어진다(0행 0열, 0행 1열, …).
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const text = spec.table[row][col] ?? "";
        if (!text) continue;
        doc.insertTextInCell(0, created.paraIdx, created.controlIdx, row * cols + col, 0, 0, text);
      }
    }
  }

  return doc;
}
