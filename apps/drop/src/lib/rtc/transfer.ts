// 파일 전송 프로토콜 v1.
// 제어 프레임은 JSON 문자열, 파일 내용은 ArrayBuffer 청크.
// 채널이 ordered+reliable이라 "마지막 file 프레임 이후의 바이너리는 그 파일 것"이 성립한다.
// 한 방향에서 파일을 동시에 보내면 청크가 섞이므로 송신은 반드시 직렬화할 것(state의 큐 담당).
// 취소는 cancel 프레임 하나로 양쪽이 같이 정리한다 — 한쪽만 멈추면 상대가 영원히 기다린다.

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

type Frame =
  | ({ v: 1; t: "file" } & FileMeta)
  | { v: 1; t: "eof"; id: string }
  | { v: 1; t: "cancel"; id: string }
  | { v: 1; t: "text"; body: string };

const CHUNK = 64 * 1024; // 크로미엄 간 안전 상한(256KB)보다 보수적으로
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

/** 전송이 끝난 사유 — 취소는 오류가 아니라 정상적인 결말이다. */
export type SendResult = "done" | "cancelled";

/**
 * 파일 하나를 보낸다. signal이 끊기면 남은 청크를 버리고 cancel 프레임으로 상대도 정리시킨다.
 * 취소 프레임은 양쪽 누구나 보낼 수 있고, 이미 정리한 쪽에서는 무시된다(멱등).
 */
export async function sendFile(
  ch: RTCDataChannel,
  file: File,
  id: string,
  onProgress: (sent: number) => void,
  signal?: AbortSignal,
): Promise<SendResult> {
  ch.bufferedAmountLowThreshold = LOW_WATER;
  if (signal?.aborted) {
    sendCancel(ch, id);
    return "cancelled";
  }
  const meta: Frame = { v: 1, t: "file", id, name: file.name, size: file.size, mime: file.type };
  ch.send(JSON.stringify(meta));
  let offset = 0;
  while (offset < file.size) {
    if (ch.readyState !== "open") throw new Error("channel closed");
    if (signal?.aborted) {
      sendCancel(ch, id);
      return "cancelled";
    }
    if (ch.bufferedAmount > HIGH_WATER) await drained(ch, signal);
    const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
    ch.send(chunk);
    offset += chunk.byteLength;
    onProgress(offset);
  }
  ch.send(JSON.stringify({ v: 1, t: "eof", id } satisfies Frame));
  return "done";
}

export function sendText(ch: RTCDataChannel, body: string): void {
  ch.send(JSON.stringify({ v: 1, t: "text", body } satisfies Frame));
}

/** 취소를 알린다 — 채널이 이미 닫혔으면 알릴 상대가 없으니 조용히 넘어간다. */
export function sendCancel(ch: RTCDataChannel, id: string): void {
  if (ch.readyState !== "open") return;
  ch.send(JSON.stringify({ v: 1, t: "cancel", id } satisfies Frame));
}

function drained(ch: RTCDataChannel, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("channel closed"));
    };
    // 취소는 버퍼가 빠지길 기다리는 동안에도 즉시 먹혀야 한다 — 8MB가 빠질 때까지 기다리면
    // 느린 연결에서 중단 버튼이 몇 초 뒤에야 반응한다.
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      ch.removeEventListener("bufferedamountlow", onLow);
      ch.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    ch.addEventListener("bufferedamountlow", onLow);
    ch.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort);
  });
}

export interface ReceiverEvents {
  onStart(meta: FileMeta): void;
  onProgress(id: string, received: number): void;
  onDone(id: string, blob: Blob): void;
  /** 상대가 이 파일을 중단했다 — 받던 조각은 이미 버려진 뒤다. */
  onCancel(id: string): void;
  onText(body: string): void;
}

export class Receiver {
  private cur: { meta: FileMeta; parts: ArrayBuffer[]; received: number } | null = null;

  constructor(private events: ReceiverEvents) {}

  /** 내 쪽에서 중단할 때 — 받던 조각을 버린다(상대에게 알리는 것은 호출자 몫). */
  discard(id: string): void {
    if (this.cur?.meta.id === id) this.cur = null;
  }

  handle(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      const frame = JSON.parse(data) as Frame;
      if (frame.t === "file") {
        const { v: _v, t: _t, ...meta } = frame;
        this.cur = { meta, parts: [], received: 0 };
        this.events.onStart(meta);
      } else if (frame.t === "cancel") {
        this.discard(frame.id);
        this.events.onCancel(frame.id);
      } else if (frame.t === "eof") {
        if (!this.cur || this.cur.meta.id !== frame.id) return;
        const { meta, parts } = this.cur;
        this.cur = null;
        this.events.onDone(meta.id, new Blob(parts, { type: meta.mime || "application/octet-stream" }));
      } else if (frame.t === "text") {
        this.events.onText(frame.body);
      }
    } else if (this.cur) {
      this.cur.parts.push(data);
      this.cur.received += data.byteLength;
      this.events.onProgress(this.cur.meta.id, this.cur.received);
    }
  }
}
