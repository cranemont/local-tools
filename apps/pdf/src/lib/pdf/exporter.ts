import { degrees, PDFDocument } from "pdf-lib";
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

/**
 * 소스 하나를 pdf-lib으로 연다. 암호가 걸려 있으면 우리 문구로 바꿔 던진다.
 *
 * pdf.js는 열지만 pdf-lib은 못 여는 문서가 있다(사용자 비밀번호가 빈 채 소유자 권한만
 * 걸린 경우) — 영어 예외 대신 다음 할 일을 말해 준다.
 *
 * 오류의 종류로 가르지 않는다. pdf-lib 1.17.1은 ES5로 내려와 tslib `__extends`를 쓰는데,
 * 부모 `Error`를 함수로 부르면 새 Error가 돌아와 상속 사슬이 끊긴다 — `EncryptedPDFError`는
 * 자기 자신의 `instanceof`도 거짓이고 `constructor.name`이 "Error"다. 그래서 예전
 * `err instanceof EncryptedPDFError` 갈림길은 한 번도 참이 된 적이 없고, 사용자는 영어
 * 예외를 그대로 봤다. 지금은 오류를 안 보고 문서에 직접 묻는다.
 *
 * `ignoreEncryption: true`는 "암호가 걸렸으면 던져라"를 끄고 `isEncrypted`를 읽게 해 준다.
 * 그렇게 연 문서를 그냥 돌려주면 안 된다 — `copyPages`가 암호문인 내용 스트림을 그대로
 * 베껴 와 오류 없이 글자가 사라진 PDF가 저장되거나, 문서에 따라 "Expected instance of
 * PDFDict"로 죽는다. 그래서 돌려주기 전에 여기서 가른다.
 *
 * `updateMetadata: false`는 원본의 Info 사전을 고쳐 쓰지 않으려는 것이다. 이 문서는 쪽을
 * 베껴 갈 원본일 뿐이고(산출물은 `PDFDocument.create()`가 따로 만든다) 분할에서는 캐시에
 * 남아 여러 번 쓰인다 — 열 때마다 남의 파일에 Producer·ModDate를 써 넣을 이유가 없다.
 */
async function loadSource(src: SourceDoc): Promise<PDFDocument> {
  const doc = await PDFDocument.load(src.bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (doc.isEncrypted) throw new Error(t.errors.encryptedSource(src.name));
  return doc;
}
