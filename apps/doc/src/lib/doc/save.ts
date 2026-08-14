/**
 * 표준 브라우저 다운로드(<a download>)로 저장한다.
 * File System Access(showSaveFilePicker)와 달리 크롬 "다운로드" 목록에 표시되고
 * 기본 다운로드 폴더로 저장된다.
 */

import { zipSync } from "fflate";
import type { ExtractedImage } from "./markdown";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 다운로드가 시작될 시간을 준 뒤 URL 해제.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 사람 읽는 용량 표기. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 확장자를 갈아 끼운다 — 원본 이름을 이어받는 게 찾기 쉽다. */
export function withExtension(fileName: string, extension: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, "") || "문서";
  return `${base}.${extension}`;
}

/**
 * 마크다운을 저장한다. 그림이 있으면 md 한 장으로는 자기완결이 되지 않으므로
 * `images/`와 함께 ZIP으로 묶는다(PDF·이미지 도구가 여러 장을 ZIP으로 내리는 것과 같은 규칙).
 * 그림이 없으면 파일 하나로 끝난다.
 */
export function saveMarkdown(
  fileName: string,
  markdown: string,
  images: ExtractedImage[],
): { saved: string; zipped: boolean } {
  const encoder = new TextEncoder();

  if (images.length === 0) {
    const name = withExtension(fileName, "md");
    downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), name);
    return { saved: name, zipped: false };
  }

  const base = withExtension(fileName, "md");
  const entries: Record<string, Uint8Array> = { [base]: encoder.encode(markdown) };
  for (const image of images) entries[image.path] = image.bytes;

  const name = withExtension(fileName, "zip");
  downloadBlob(new Blob([zipSync(entries) as BlobPart], { type: "application/zip" }), name);
  return { saved: name, zipped: true };
}

/**
 * 일괄 변환의 결과 — 여러 문서의 마크다운과 그림을 ZIP 한 개로.
 * 경로는 `batch.ts`가 이미 문서별 폴더로 갈라 놓았으므로 여기서는 묶기만 한다.
 */
export function saveZip(fileName: string, entries: Record<string, Uint8Array>): void {
  downloadBlob(new Blob([zipSync(entries) as BlobPart], { type: "application/zip" }), fileName);
}

export function saveBytes(fileName: string, bytes: Uint8Array, mime: string): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: mime }), fileName);
}
