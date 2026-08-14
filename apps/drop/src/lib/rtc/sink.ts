// 받은 파일이 어디에 앉는가.
//
// ① 디스크 스트리밍(File System Access) — 청크가 올 때마다 곧바로 파일에 쓴다.
//    저장소의 다른 도구는 전부 <a download>다(4번 주의사항). 여기만 예외인 이유는
//    받는 파일이 몇 GB일 수 있어서다 — 메모리에 통째로 쌓으면 탭이 죽는다.
//    ※ 피커는 사용자 제스처 안에서만 열린다. 청크는 제스처 없이 도착하므로,
//      저장 위치는 "받기"를 누른 그 클릭에서 미리 받아 둔다(pickDestination).
//
// ② 폴백 — 피커가 없거나(비크로미엄) 사용자가 위치 고르기를 취소하면 메모리에 모아
//    <a download>로 내린다. 예전 동작 그대로이고, 지우면 안 된다.

import type { FileMeta, FileSink, SinkFactory } from "./transfer";

/** 파일시스템이 싫어하는 글자 — 제어문자와 윈도 예약문자. */
const FORBIDDEN = /[\u0000-\u001f<>:"|?*]/g;
/** 이름 상한. 대부분의 파일시스템이 바이트 255를 넘기지 못한다(한글은 3바이트). */
const NAME_MAX = 80;

/**
 * 상대가 준 파일 이름을 쓸 수 있는 이름으로 다듬는다.
 * 이 값은 **상대가 정한 문자열**이라 그대로 디렉터리 핸들에 넘기면 안 된다 —
 * 경로 구분자를 지우고(디렉터리 탈출), "."·".." 같은 이름은 갈아 끼운다.
 */
export function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(FORBIDDEN, "_").trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return "받은 파일";
  // 확장자는 남기고 앞부분만 줄인다.
  if (cleaned.length <= NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, NAME_MAX - ext.length) + ext;
}

export function canStreamToDisk(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/**
 * 저장 위치를 묻는다. **사용자 제스처 안에서 곧바로** 불러야 한다 —
 * 앞에 await가 하나라도 끼면 브라우저가 피커를 막는다.
 * 위치를 못 정하면(미지원·취소) null → 호출부가 메모리 폴백으로 간다.
 */
export function pickDestination(files: FileMeta[]): Promise<SinkFactory | null> {
  if (!canStreamToDisk()) return Promise.resolve(null);
  if (files.length > 1) {
    return window
      .showDirectoryPicker({ mode: "readwrite", startIn: "downloads" })
      .then((dir) => directorySink(dir))
      .catch(() => null);
  }
  return window
    .showSaveFilePicker({ suggestedName: safeName(files[0]?.name ?? ""), startIn: "downloads" })
    .then((handle) => singleFileSink(handle))
    .catch(() => null);
}

/** 같은 이름이 이미 있으면 "이름 (2).확장자"로 비켜 간다 — 덮어쓰지 않는다. */
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate; // 없다 → 이 이름을 쓴다
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

function directorySink(dir: FileSystemDirectoryHandle): SinkFactory {
  return async (meta) => {
    const name = await freeName(dir, safeName(meta.name));
    const handle = await dir.getFileHandle(name, { create: true });
    return streamSink(await handle.createWritable(), async () => {
      // 쓰다 만 파일은 남기지 않는다.
      await dir.removeEntry(name).catch(() => {});
    });
  };
}

function singleFileSink(handle: FileSystemFileHandle): SinkFactory {
  let used = false;
  return async (_meta) => {
    // 파일 한 개짜리 묶음에만 쓰는 경로다. 어쩌다 둘째가 오면 디스크에 겹쳐 쓰는 대신
    // 메모리로 물러난다(그 파일은 <a download>로 나간다).
    if (used) return memorySink(_meta);
    used = true;
    // 부모 디렉터리 핸들이 없어 취소해도 파일 자체는 지울 수 없다.
    // 다만 abort()는 쓴 내용을 하나도 확정하지 않으므로 0바이트로 남는다.
    return streamSink(await handle.createWritable(), async () => {});
  };
}

function streamSink(stream: FileSystemWritableFileStream, remove: () => Promise<void>): FileSink {
  return {
    // write는 반드시 await한다 — 여기서 기다리는 것이 역압의 전부다.
    write: (chunk) => stream.write(chunk),
    async close() {
      await stream.close();
      return null; // 이미 디스크에 있다 — 화면에 저장 버튼을 띄울 이유가 없다
    },
    async abort() {
      await stream.abort().catch(() => {});
      await remove();
    },
  };
}

/** 폴백 — 메모리에 모았다가 Blob으로 넘긴다(예전 동작). */
export const memorySink: SinkFactory = async (meta) => {
  let parts: ArrayBuffer[] = [];
  return {
    async write(chunk) {
      parts.push(chunk);
    },
    async close() {
      const blob = new Blob(parts, { type: meta.mime || "application/octet-stream" });
      parts = [];
      return blob;
    },
    async abort() {
      parts = [];
    },
  };
};
