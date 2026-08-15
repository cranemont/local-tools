/** 워드 문서(.docx) 표본과, 놓인 파일 한 개 — wasm 없이 도는 것만 여기 둔다.
 *
 * 공통 규약은 `./pdf.ts` 머리말이 정본이다.
 *
 * `doc.ts`에서 갈라 나온 이유는 그 파일이 모듈을 읽는 순간 rhwp wasm을 켜기 때문이다
 * (`node:fs`로 바이트를 읽는다). 브라우저 층은 wasm을 앱의 `engine.ts`로 켜므로 그 파일을
 * import할 수 없는데, docx 표본은 순수 JS(fflate)라 두 층이 함께 쓸 수 있다.
 */

import { zipSync } from "fflate";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** ZIP이 적을 수 있는 가장 이른 시각. 결정적 바이트를 위해 여기에 박는다. */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1));

function docxParagraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function docxTable(cells: string[][]): string {
  const rows = cells
    .map(
      (row) =>
        `<w:tr>${row
          .map((cell) => `<w:tc><w:tcPr/>${docxParagraph(cell)}</w:tc>`)
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr/>${rows}</w:tbl>`;
}

/**
 * 최소한의 .docx(OOXML ZIP 4항목). mammoth가 읽는 것을 확인했다.
 *
 * 첫 항목이 `[Content_Types].xml`이어야 `detect`가 워드로 읽는다 — hwpx는 `mimetype`이
 * 첫 항목이고, 그 한 바이트 차이가 '엔진을 타는 문서'와 '순수 JS로 가는 문서'를 가른다.
 * fflate는 넣은 순서를 지키므로 여기 적힌 순서가 곧 ZIP의 순서다.
 */
export function makeDocx(spec: { paragraphs?: string[]; table?: string[][] } = {}): Uint8Array {
  const body = [
    ...(spec.paragraphs ?? []).map(docxParagraph),
    ...(spec.table ? [docxTable(spec.table)] : []),
  ].join("");

  return zipSync(
    {
      "[Content_Types].xml": encode(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `</Types>`,
      ),
      "_rels/.rels": encode(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
          `</Relationships>`,
      ),
      "word/_rels/document.xml.rels": encode(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
      ),
      "word/document.xml": encode(
        `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:body>${body}<w:sectPr/></w:body></w:document>`,
      ),
    },
    // 시각을 박지 않으면 ZIP 머리에 지금 시각이 들어가 두 실행의 바이트가 달라진다.
    // ZIP은 1980년 이전을 못 적으므로(fflate가 거부한다) 그 첫날로 박는다.
    { mtime: ZIP_EPOCH },
  );
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 놓인 파일 하나. 이름이 곧 확장자이고, 종류는 앞 바이트로 갈린다(`detect`). */
export function docFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as BlobPart], name);
}
