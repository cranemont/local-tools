/** 만들어진 PDF에서 "쪽에 그려진 글자"를 꺼내는 판독기.
 *
 * 공통 규약(import 경로·바이너리 금지·결정성)은 `tests/fixtures/pdf.ts` 머리말에 있다.
 *
 * 왜 pdf.js가 아니라 이것인가: `apps/pdf`의 글자 추출은 `extract.ts`이고 그것은
 * `./pdfjs`를 거쳐 `?worker&inline`을 문다 — node에는 전역 `Worker`가 없어 import
 * 단계에서 실패한다(자세한 것은 `tests/pdf-roundtrip.test.ts` 머리말). 그래서 쪽의
 * 정체를 확인하는 수단이 따로 필요하다. 여기서 하는 일은 그것뿐이다 — 내용 스트림을
 * 펴서 글자를 보여 주는 연산자의 인자를 모은다.
 *
 * **읽는 범위가 좁다.** 표본은 pdf-lib이 그리고 qpdf가 다시 쓴 것뿐이라 그 둘이
 * 내는 모양만 안다: `Tj`·`TJ`와 리터럴 문자열 `(...)`·16진 문자열 `<...>`. 글꼴
 * 인코딩은 안 본다(표본이 Helvetica/WinAnsi라 바이트가 곧 ASCII다). `Tz`·`TJ`의
 * 자간 조정, 여러 조각으로 갈린 낱말은 그냥 이어 붙인다. 임의의 PDF에 쓰지 말 것.
 */

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFPage,
} from "../../apps/pdf/node_modules/pdf-lib";
import { inflateSync } from "node:zlib";

/** 쪽마다 그려진 글자 한 줄. 쪽 순서 그대로다. */
export async function pdfDrawnText(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => showStrings(contentOf(page)));
}

/** 쪽 하나의 내용 스트림을 편 바이트(여러 조각이면 이어 붙인다). */
function contentOf(page: PDFPage): string {
  const node = page.node.lookup(PDFName.of("Contents"));
  const streams: PDFRawStream[] = [];
  if (node instanceof PDFRawStream) streams.push(node);
  else if (node instanceof PDFArray) {
    for (let i = 0; i < node.size(); i++) {
      const part = node.lookup(i);
      if (part instanceof PDFRawStream) streams.push(part);
    }
  }
  return streams.map((s) => decode(s.contents)).join("\n");
}

/** FlateDecode면 펴고, 아니면 그대로 읽는다. 다른 필터는 안 다룬다. */
function decode(raw: Uint8Array): string {
  try {
    return Buffer.from(inflateSync(Buffer.from(raw))).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

/** `(...)`·`<...>` 다음에 `Tj`나 `TJ`가 오는 자리의 문자열을 모은다. */
function showStrings(content: string): string {
  let out = "";
  // 문자열 하나 또는 배열 하나 + 보여 주기 연산자.
  const re = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[[^\]]*\])\s*(Tj|TJ)/g;
  for (const m of content.matchAll(re)) {
    const arg = m[1];
    if (arg.startsWith("[")) {
      for (const inner of arg.matchAll(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g)) {
        out += literal(inner[0]);
      }
    } else {
      out += literal(arg);
    }
  }
  return out;
}

/** `(글자)`나 `<16진>` 하나를 문자열로. */
function literal(token: string): string {
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    const even = hex.length % 2 === 0 ? hex : `${hex}0`;
    let s = "";
    for (let i = 0; i < even.length; i += 2) {
      s += String.fromCharCode(Number.parseInt(even.slice(i, i + 2), 16));
    }
    return s;
  }
  return token.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c: string) => {
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    return map[c] ?? c;
  });
}
