// File System Access의 피커 두 개 — 표준 TS lib에 아직 없어 최소 선언 (크로미엄 전용).
// 핸들·쓰기 스트림 타입(FileSystemFileHandle·FileSystemWritableFileStream)은 lib.dom에 있다.

interface FilePickerOptions {
  /** 처음 열 위치 힌트 — "downloads"·"documents" 등 */
  startIn?: string;
  /** 같은 id끼리 마지막 위치를 기억한다 */
  id?: string;
}

interface Window {
  showSaveFilePicker(
    options?: FilePickerOptions & { suggestedName?: string },
  ): Promise<FileSystemFileHandle>;
  showDirectoryPicker(
    options?: FilePickerOptions & { mode?: "read" | "readwrite" },
  ): Promise<FileSystemDirectoryHandle>;
}
