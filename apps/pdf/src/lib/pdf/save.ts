import { zipSync } from "fflate";

/**
 * 표준 브라우저 다운로드(<a download>)로 저장한다.
 * File System Access(showSaveFilePicker)와 달리 크롬 "다운로드" 목록에 표시되고
 * 기본 다운로드 폴더로 저장된다.
 */
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

/** PDF 바이트를 파일로 다운로드. */
export function saveBytes(bytes: Uint8Array, filename: string): void {
  // Uint8Array<ArrayBufferLike> → ArrayBuffer 백킹으로 복사(엄격한 BlobPart 타입 충족).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(new Blob([copy], { type: "application/pdf" }), filename);
}

/**
 * 파일 여러 개를 ZIP 하나로 묶어 다운로드한다 — 다운로드가 여러 번 뜨지 않게.
 * PDF·PNG는 이미 압축돼 있으므로 저장(무압축) 모드로 빠르게 묶는다.
 */
export function saveZip(files: Record<string, Uint8Array>, filename: string): void {
  const zipped = zipSync(files, { level: 0 });
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  downloadBlob(new Blob([copy], { type: "application/zip" }), filename);
}
