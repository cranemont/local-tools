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

/** 사람 읽는 용량 표기. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
