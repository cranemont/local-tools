/**
 * 표준 브라우저 다운로드(<a download>)로 저장한다.
 * File System Access(showSaveFilePicker)와 달리 크롬 "다운로드" 목록에 표시되고
 * 기본 다운로드 폴더로 저장된다.
 *
 * 받는 경로는 이제 여기로 오지 않는다 — 청크를 디스크로 흘려보낸다(sink.ts).
 * 이 함수가 남아 있는 자리는 두 곳뿐이다: 디스크에 못 쓸 때의 폴백, 그리고
 * 그렇게 메모리에 담긴 항목의 저장 버튼.
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
