/** PDF 표본 — pdf-lib으로 짓는다. 읽는 쪽도 pdf-lib이면 된다.
 *
 * ## tests/fixtures 공통 규약 (여기가 정본, 나머지 파일은 이 문단을 가리킨다)
 *
 * **바이너리를 커밋하지 않는다**(`packages/pwa-kit`이 PNG를 코드로 인코딩하는 관행과 같다).
 * 표본은 테스트가 돌 때 코드로 짓는다.
 *
 * **import 경로가 두 갈래다.** pnpm이 앱마다 `node_modules`를 갈라 놓아서 루트에 걸린
 * `tests/`에서는 앱 의존성이 이름으로 안 풀린다.
 *   - 앱 의존성(`pdf-lib`·`gifenc`)은 앱의 `node_modules`를 경로로 지목한다 —
 *     `import { PDFDocument } from "../../apps/pdf/node_modules/pdf-lib"`.
 *     앱이 쓰는 판과 표본이 쓰는 판을 갈라 놓지 않으려는 것이다.
 *   - 표본 전용 의존성(`@napi-rs/canvas`·`@neslinesli93/qpdf-wasm`)은 루트
 *     devDependency라 이름으로 부른다. 앱 `dependencies`에 넣으면
 *     `scripts/check-stack-sources.mjs`가 기술 지도와 안 맞는다고 잡는다.
 *
 * **같은 입력이면 같은 바이트**여야 한다. 표본이 실행마다 흔들리면 그 표본을 쓰는 모든
 * 테스트가 흔들려, 빨간 불이 코드 때문인지 표본 때문인지 못 가른다. 이 성질은
 * `tests/fixtures.test.ts`가 못 박는다. 예외는 `pdf-password.ts` 하나다(qpdf가 난수 키를 쓴다).
 *
 * ## 이 파일
 *
 * 결정성에서 막아야 하는 자리는 문서 정보 딕셔너리 하나다. pdf-lib은 `create()`에서
 * `/CreationDate`·`/ModDate`에 현재 시각을 넣으므로, 같은 표본을 두 번 지으면 두 실행의
 * 바이트가 다르다(1698B와 1699B로 갈린 적이 있다). epoch로 박고 나머지 정보 항목도
 * 고정 문자열로 덮는다 — pdf-lib 판이 올라가도 `/Producer` 기본값에 안 끌려가게.
 *
 * 글꼴은 Helvetica(표준 14종)다. 한글은 안 그려진다 — 표본 문자열은 ASCII로 쓸 것.
 */

import { degrees, PDFDocument, StandardFonts } from "../../apps/pdf/node_modules/pdf-lib";

/** 쪽 하나의 명세. */
export interface PdfPageSpec {
  /** 쪽 크기(pt). 기본은 A4에 가까운 595×842다. */
  size?: [number, number];
  /** 이 쪽에 그릴 줄. 비우거나 안 주면 **글자가 하나도 없는 쪽**이다. */
  lines?: string[];
  /** `/Rotate` 값. */
  rotate?: PdfRotation;
  /** 글자 크기(pt). 기본 12. */
  fontSize?: number;
}

export type PdfRotation = 0 | 90 | 180 | 270;

const DEFAULT_SIZE: [number, number] = [595, 842];
const EPOCH = new Date(0);

/**
 * 쪽 명세대로 PDF 한 개.
 *
 * 줄은 왼쪽 여백 50pt에서 시작해 위에서 아래로 18pt씩 내려가며 그린다. 쪽을 회전해도
 * 글자는 **회전하지 않은 좌표계**에 그대로 그린다 — `/Rotate`만 붙은 쪽이 필요한
 * 테스트(추출 조각 순서·미리보기 방향)가 이 성질을 쓴다.
 */
export async function makePdf(pages: PdfPageSpec[] = [{}]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("local-tools fixture");
  doc.setAuthor("local-tools");
  doc.setSubject("test fixture");
  doc.setKeywords([]);
  doc.setProducer("local-tools fixture");
  doc.setCreator("local-tools fixture");
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);

  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const spec of pages) {
    const [width, height] = spec.size ?? DEFAULT_SIZE;
    const page = doc.addPage([width, height]);
    if (spec.rotate) page.setRotation(degrees(spec.rotate));

    const size = spec.fontSize ?? 12;
    const lines = spec.lines ?? [];
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: height - 60 - i * 18, size, font });
    });
  }

  return doc.save({ useObjectStreams: false });
}

/** 쪽마다 "Page 1"…이 한 줄씩 든 PDF. 글자가 필요한 테스트의 기본 표본. */
export function makeTextPdf(pageCount = 1): Promise<Uint8Array> {
  const pages: PdfPageSpec[] = [];
  for (let i = 1; i <= pageCount; i++) pages.push({ lines: [`Page ${i}`] });
  return makePdf(pages);
}

/** 글자가 하나도 없는 PDF. "글자를 못 찾았다"는 갈래를 재는 표본. */
export function makeBlankPdf(pageCount = 1): Promise<Uint8Array> {
  const pages: PdfPageSpec[] = [];
  for (let i = 0; i < pageCount; i++) pages.push({});
  return makePdf(pages);
}

/** 네 쪽에 `/Rotate` 0·90·180·270을 하나씩 건 PDF. 쪽마다 글자도 한 줄 있다. */
export function makeRotatedPdf(): Promise<Uint8Array> {
  const turns: PdfRotation[] = [0, 90, 180, 270];
  return makePdf(turns.map((rotate) => ({ rotate, lines: [`Rotate ${rotate}`] })));
}

/**
 * 뒤를 잘라 낸 바이트 — xref와 trailer가 사라져 열 수 없는 PDF가 된다.
 *
 * `keep`은 남길 비율(0~1)이다. 기본 0.6이면 본문 일부와 헤더는 남고 색인은 없다.
 */
export function truncatePdf(bytes: Uint8Array, keep = 0.6): Uint8Array {
  const size = Math.max(1, Math.floor(bytes.length * keep));
  return bytes.slice(0, size);
}

/** 표본 확인용 — 쪽 수. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/** 표본 확인용 — 쪽별 `/Rotate` 값. */
export async function pdfRotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getRotation().angle);
}

/** 표본 확인용 — 쪽별 [폭, 높이]. */
export async function pdfPageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => [page.getWidth(), page.getHeight()]);
}
