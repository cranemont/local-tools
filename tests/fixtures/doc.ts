/** 한글·워드 문서 표본 — hwp·hwpx는 `@rhwp/core`가, docx는 fflate가 짓는다.
 *
 * 공통 규약(바이너리를 커밋하지 않는다, import 경로가 두 갈래다, 같은 입력이면 같은 바이트)은
 * `./pdf.ts` 머리말이 정본이다. 여기서는 이 파일에만 있는 것을 적는다.
 *
 * ## 이 표본이 재지 못하는 것
 *
 * **rhwp가 쓰고 rhwp가 읽는다.** 그래서 형식 상호운용성은 이 표본으로 못 잰다 — 한컴이
 * 만든 hwp의 글꼴 표·스타일·개체가 어떻게 생겼는지 여기에는 없고, 회귀를 얼마나 놓치는지도
 * 재지 못했다. 검사 대상은 `apps/doc`의 `hwp.ts`·`batch.ts`·`state.svelte.ts`이고, 그 코드에게
 * 이 바이트는 **독립된 입력**이다(문단 걷기·컨트롤 걷기·매직바이트 판별은 누가 썼든 같다).
 *
 * ## wasm을 여기서 켠다
 *
 * `apps/doc`은 wasm을 네트워크로 받고 SHA-384로 검증하지만(`doc/engine.ts`), 표본은 그 길을
 * 타지 않는다 — `node_modules`의 `.wasm`을 직접 읽어 `init`에 넣는다. 앱의 `engine.ts`와
 * **같은 `@rhwp/core` 모듈 인스턴스**를 켜는 것이라(pnpm이 한 자리로 풀어 준다) 이 파일을
 * import한 테스트에서는 `openHwp`가 곧바로 문서를 연다. 대신 테스트가 `ensureEngine`을
 * 갈아 끼워 네트워크 경로를 막아야 한다.
 *
 * wasm은 글자 폭을 브라우저에 물어 온다(`measureTextWidth`). node에는 캔버스가 없으므로
 * 글자 수로 어림한 값을 준다 — 쪽 나눔이 실제 한글과 다를 수 있다는 뜻이라, **쪽 수에
 * 기대는 단언을 이 표본으로 쓰지 말 것**.
 */

import { readFileSync } from "node:fs";

import { zipSync } from "../../apps/doc/node_modules/fflate";
import init, { HwpDocument } from "../../apps/doc/node_modules/@rhwp/core/rhwp.js";

const WASM = new URL("../../apps/doc/node_modules/@rhwp/core/rhwp_bg.wasm", import.meta.url);

// wasm은 줄바꿈을 계산할 때 글자 폭을 밖에 묻는다. init 전에 등록해야 첫 렌더가 어긋나지
// 않는다(engine.ts의 registerTextMeasure와 같은 자리). 값은 결정적이어야 하므로 상수배다.
(globalThis as unknown as { measureTextWidth?: unknown }).measureTextWidth = (
  _font: string,
  text: string,
): number => text.length * 10;

await init({ module_or_path: readFileSync(WASM) });

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
function build(spec: HwpSpec): HwpDocument {
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

/** 명세대로 지은 .hwp 바이트(HWP 5.0, CFB). */
export function makeHwp(spec: HwpSpec = { paragraphs: ["첫 문단입니다"] }): Uint8Array {
  const doc = build(spec);
  try {
    return doc.exportHwp();
  } finally {
    doc.free();
  }
}

/** 같은 명세의 .hwpx 바이트(ZIP). */
export function makeHwpx(spec: HwpSpec = { paragraphs: ["첫 문단입니다"] }): Uint8Array {
  const doc = build(spec);
  try {
    return doc.exportHwpx();
  } finally {
    doc.free();
  }
}

/**
 * 비밀번호가 걸린 .hwp. **바이트는 결정적이지 않다**(암호화가 난수를 쓴다) —
 * 이 표본으로 바이트를 비교하지 말 것.
 */
export function makeEncryptedHwp(
  password: string,
  spec: HwpSpec = { paragraphs: ["잠긴 문서"] },
): Uint8Array {
  const doc = build(spec);
  try {
    return doc.exportHwpWithPassword(password);
  } finally {
    doc.free();
  }
}

/**
 * 뒤를 잘라 낸 바이트 — CFB 헤더는 남고 내용이 사라져 rhwp가 열지 못한다.
 * 매직바이트는 그대로라 `detect`는 여전히 hwp로 읽는다(그래서 '실패'로 가는 갈래다).
 */
export function truncateHwp(bytes: Uint8Array, keep = 0.6): Uint8Array {
  return bytes.slice(0, Math.max(1, Math.floor(bytes.length * keep)));
}

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

/**
 * rhwp를 패닉시킨다(CLAUDE.md 17번). 흉내가 아니라 진짜 패닉이라,
 * 던져지는 것은 wasm이 내는 `RuntimeError: unreachable`이다.
 *
 * 제목·문단·표가 섞인 HTML을 `pasteHtml`에 넣으면 `rendering.rs:3495`에서
 * `insertion index (is 3) should be <= len (is 1)`로 패닉한다. 이 말을 `isEnginePanic`이
 * 알아보는지가 곧 그 규격이 맞는지다.
 *
 * **패닉을 맞은 문서 손잡이는 되살릴 수 없다** — 그 뒤 어떤 호출도 "recursive use of an
 * object"로 실패하고 `free()`조차 "while it was borrowed"로 실패한다. 여기서는 손잡이를
 * 버리므로 wasm 모듈 자체는 다음 문서를 계속 열지만, 앱은 이 자리에서 상태를 `broken`으로
 * 굳히고 새로고침을 권한다(살릴 길이 없다는 판단은 앱 쪽 규약이다). 이 함수를 `guard`에
 * 통과시키는 테스트는 그 순간부터 엔진 상태를 되돌릴 수 없으므로 **파일 뒤쪽**에 둘 것.
 */
export function panicRhwp(): void {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  doc.pasteHtml(0, 0, 0, "<h1>제목</h1><p>문단</p><table><tr><td>가</td></tr></table><p>끝</p>");
  doc.free();
  throw new Error("rhwp가 패닉하지 않았다 — 표본이 낡았다(CLAUDE.md 17번을 다시 볼 것)");
}

/** 놓인 파일 하나. 이름이 곧 확장자이고, 종류는 앞 바이트로 갈린다(`detect`). */
export function docFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as BlobPart], name);
}
