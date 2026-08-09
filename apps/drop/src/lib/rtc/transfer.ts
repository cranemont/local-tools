// 파일 전송 프로토콜 v1.
// 제어 프레임은 JSON 문자열, 파일 내용은 ArrayBuffer 청크.
// 채널이 ordered+reliable이라 "마지막 file 프레임 이후의 바이너리는 그 파일 것"이 성립한다.
// 한 방향에서 파일을 동시에 보내면 청크가 섞이므로 송신은 반드시 직렬화할 것(state의 큐 담당).

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

type Frame =
  | ({ v: 1; t: "file" } & FileMeta)
  | { v: 1; t: "eof"; id: string }
  | { v: 1; t: "text"; body: string };

const CHUNK = 64 * 1024; // 크로미엄 간 안전 상한(256KB)보다 보수적으로
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

export async function sendFile(
  ch: RTCDataChannel,
  file: File,
  id: string,
  onProgress: (sent: number) => void,
): Promise<void> {
  ch.bufferedAmountLowThreshold = LOW_WATER;
  const meta: Frame = { v: 1, t: "file", id, name: file.name, size: file.size, mime: file.type };
  ch.send(JSON.stringify(meta));
  let offset = 0;
  while (offset < file.size) {
    if (ch.readyState !== "open") throw new Error("channel closed");
    if (ch.bufferedAmount > HIGH_WATER) await drained(ch);
    const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
    ch.send(chunk);
    offset += chunk.byteLength;
    onProgress(offset);
  }
  ch.send(JSON.stringify({ v: 1, t: "eof", id } satisfies Frame));
}

export function sendText(ch: RTCDataChannel, body: string): void {
  ch.send(JSON.stringify({ v: 1, t: "text", body } satisfies Frame));
}

function drained(ch: RTCDataChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("channel closed"));
    };
    const cleanup = () => {
      ch.removeEventListener("bufferedamountlow", onLow);
      ch.removeEventListener("close", onClose);
    };
    ch.addEventListener("bufferedamountlow", onLow);
    ch.addEventListener("close", onClose);
  });
}

export interface ReceiverEvents {
  onStart(meta: FileMeta): void;
  onProgress(id: string, received: number): void;
  onDone(id: string, blob: Blob): void;
  onText(body: string): void;
}

export class Receiver {
  private cur: { meta: FileMeta; parts: ArrayBuffer[]; received: number } | null = null;

  constructor(private events: ReceiverEvents) {}

  handle(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      const frame = JSON.parse(data) as Frame;
      if (frame.t === "file") {
        const { v: _v, t: _t, ...meta } = frame;
        this.cur = { meta, parts: [], received: 0 };
        this.events.onStart(meta);
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
