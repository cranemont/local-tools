/** 워드 문서(.docx) — 보기와 옮기기.
 *
 * 두 라이브러리가 각자 다른 일을 한다. 하나로 둘 다 하려 하면 어느 쪽이든 나빠진다.
 *  - **docx-preview**: 페이지 모양 그대로 그린다(왼쪽 화면). 워드의 서식·표·머리말을
 *    HTML+CSS로 옮겨 붙이므로 "문서처럼" 보인다. 대신 마크다운으로 옮기기엔 나쁜 소스다.
 *  - **mammoth**: 서식을 버리고 **의미 구조**(제목·목록·표·강조)만 남긴 HTML을 준다.
 *    마크다운의 재료로는 이쪽이 맞다. 무겁고(gzip 122KB) hwp만 보는 사람에겐 필요 없어서
 *    `await import()`로 미룬다 — 시트가 ExcelJS를 미루는 것과 같은 이유다.
 *
 * .doc(워드 97 바이너리)은 이 둘 다 못 읽는다. 판별은 detect.ts가 하고 여기 오지 않는다.
 */

import { renderAsync } from "docx-preview";
import type mammothTypes from "mammoth";

/** 페이지 모양 그대로 컨테이너에 그린다. 컨테이너 내용은 갈아 끼워진다. */
export async function renderDocx(bytes: Uint8Array, container: HTMLElement): Promise<void> {
  container.replaceChildren();
  await renderAsync(new Blob([bytes as BlobPart]), container, undefined, {
    className: "docx",
    inWrapper: true,
    // 원본 페이지 폭을 지켜야 "재현"이 되므로 크기는 건드리지 않는다.
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    useBase64URL: true,
  });
}

/** 약속을 캐시한다 — 동시에 두 번 불러도 한 번만 받는다. */
let mammoth: Promise<typeof mammothTypes> | null = null;

function loadMammoth(): Promise<typeof mammothTypes> {
  mammoth ??= import("mammoth/mammoth.browser.js").then((module) => module.default);
  return mammoth;
}

/**
 * 의미 구조만 남은 HTML. 그림은 base64 data URI로 들어오고, 마크다운으로 옮기는 쪽에서
 * 파일로 떼어 낸다(markdown.ts).
 */
export async function docxHtml(bytes: Uint8Array): Promise<string> {
  const engine = await loadMammoth();
  // ArrayBuffer로 넘겨야 브라우저 경로를 탄다(Buffer 경로는 노드용).
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const result = await engine.convertToHtml(
    { arrayBuffer: buffer },
    {
      // 워드의 "제목 1"이 h1이 되도록 기본 맵을 그대로 쓰되, 각주·미주는 살린다.
      includeDefaultStyleMap: true,
      includeEmbeddedStyleMap: true,
    },
  );
  return result.value;
}
