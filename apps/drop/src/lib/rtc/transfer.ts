// 파일 전송 프로토콜 v1.
// 제어 프레임은 JSON 문자열, 파일 내용은 ArrayBuffer 청크.
// 채널이 ordered+reliable이라 "마지막 file 프레임 이후의 바이너리는 그 파일 것"이 성립한다.
// 한 방향에서 파일을 동시에 보내면 청크가 섞이므로 송신은 반드시 직렬화할 것(state의 큐 담당).
// 취소는 cancel 프레임 하나로 양쪽이 같이 정리한다 — 한쪽만 멈추면 상대가 영원히 기다린다.
//
// ── 수락 단계 ────────────────────────────────────────────────────────
// 보내는 쪽은 파일을 밀어 넣기 전에 offer(목록·총량)를 먼저 알리고, 받는 쪽이
// accept/decline으로 답할 때까지 한 바이트도 보내지 않는다. 이 단계가 있는 이유는 두 가지다:
//  · 묻지도 않고 남의 파일이 내 디스크에 앉지 않는다.
//  · 저장 위치를 묻는 피커는 **사용자 제스처 안에서만** 열린다. 청크는 제스처 없이
//    도착하므로, "받기"를 누른 그 클릭에서 위치를 받아 두는 것이 유일한 방법이다.
//
// ── 역압 ────────────────────────────────────────────────────────────
// 받는 쪽은 디스크 쓰기를 await하며 나아간다. 쓰기가 밀리면 flow 프레임으로 상대를 세운다.
// 세우지 않고 큐에 쌓으면 메모리에 파일을 통째로 담던 예전 문제가 그대로 돌아온다.

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

/** 보내는 쪽이 먼저 알리는 묶음 — 받는 쪽은 이걸 보고 수락 여부를 정한다. */
export interface BatchOffer {
  batch: string;
  files: FileMeta[];
}

type Frame =
  | { v: 1; t: "offer"; batch: string; files: FileMeta[] }
  | { v: 1; t: "accept"; batch: string }
  | { v: 1; t: "decline"; batch: string }
  | { v: 1; t: "withdraw"; batch: string }
  | ({ v: 1; t: "file"; batch: string } & FileMeta)
  | { v: 1; t: "eof"; id: string }
  | { v: 1; t: "cancel"; id: string }
  | { v: 1; t: "flow"; paused: boolean }
  | { v: 1; t: "text"; body: string };

const CHUNK = 64 * 1024; // 크로미엄 간 안전 상한(256KB)보다 보수적으로
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

/** 받는 쪽에서 아직 디스크에 닿지 못한 양이 이만큼 쌓이면 상대를 세운다. */
const WRITE_HIGH = 4 * 1024 * 1024;
/** 이만큼까지 빠지면 다시 보내라고 한다. */
const WRITE_LOW = 1 * 1024 * 1024;

/** 받은 바이트가 실제로 앉는 자리. 디스크 스트림이거나 메모리다(sink.ts). */
export interface FileSink {
  /** 반드시 await된다 — 느린 디스크가 곧 역압이다. */
  write(chunk: ArrayBuffer): Promise<void>;
  /** 다 받았다. 메모리 폴백이면 Blob을, 디스크면 null을 돌려준다. */
  close(): Promise<Blob | null>;
  /** 중단 — 쓰다 만 파일을 남기지 않는다. */
  abort(): Promise<void>;
}

export type SinkFactory = (meta: FileMeta) => Promise<FileSink>;

/** 전송이 끝난 사유 — 취소는 오류가 아니라 정상적인 결말이다. */
export type SendResult = "done" | "cancelled";

/**
 * 상대가 "잠깐 멈춰"라고 할 때 송신 루프를 세우는 문.
 * 채널 하나에 하나면 된다 — 어차피 파일은 한 번에 하나씩 나간다.
 */
export class FlowGate {
  #paused = false;
  #waiters: (() => void)[] = [];

  get paused(): boolean {
    return this.#paused;
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const w of waiters) w();
  }

  /** 재개되거나 중단될 때까지 기다린다. 취소는 즉시 먹혀야 한다. */
  wait(signal?: AbortSignal): Promise<void> {
    if (!this.#paused || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        signal?.removeEventListener("abort", done);
        resolve();
      };
      this.#waiters.push(done);
      signal?.addEventListener("abort", done);
    });
  }
}

function post(ch: RTCDataChannel, frame: Frame): void {
  if (ch.readyState !== "open") return;
  ch.send(JSON.stringify(frame));
}

/** 보낼 목록을 먼저 알린다 — 받는 쪽이 수락해야 파일이 나간다. */
export function sendOffer(ch: RTCDataChannel, batch: string, files: FileMeta[]): void {
  post(ch, { v: 1, t: "offer", batch, files });
}

export function sendAccept(ch: RTCDataChannel, batch: string): void {
  post(ch, { v: 1, t: "accept", batch });
}

export function sendDecline(ch: RTCDataChannel, batch: string): void {
  post(ch, { v: 1, t: "decline", batch });
}

/**
 * 보내는 쪽이 묶음을 거둬들인다(다 취소했다).
 * 이게 없으면 받는 쪽은 영영 오지 않을 파일의 수락 카드를 보고 있게 된다.
 */
export function sendWithdraw(ch: RTCDataChannel, batch: string): void {
  post(ch, { v: 1, t: "withdraw", batch });
}

/** 내 디스크가 밀린다(또는 다시 여유가 생겼다)고 알린다. */
export function sendFlow(ch: RTCDataChannel, paused: boolean): void {
  post(ch, { v: 1, t: "flow", paused });
}

export function sendText(ch: RTCDataChannel, body: string): void {
  post(ch, { v: 1, t: "text", body });
}

/** 취소를 알린다 — 채널이 이미 닫혔으면 알릴 상대가 없으니 조용히 넘어간다. */
export function sendCancel(ch: RTCDataChannel, id: string): void {
  post(ch, { v: 1, t: "cancel", id });
}

/**
 * 파일 하나를 보낸다. signal이 끊기면 남은 청크를 버리고 cancel 프레임으로 상대도 정리시킨다.
 * 취소 프레임은 양쪽 누구나 보낼 수 있고, 이미 정리한 쪽에서는 무시된다(멱등).
 * gate가 닫혀 있으면(상대 디스크가 밀림) 열릴 때까지 기다렸다 잇는다.
 */
export async function sendFile(
  ch: RTCDataChannel,
  file: File,
  meta: FileMeta,
  batch: string,
  onProgress: (sent: number) => void,
  signal?: AbortSignal,
  gate?: FlowGate,
): Promise<SendResult> {
  ch.bufferedAmountLowThreshold = LOW_WATER;
  if (signal?.aborted) {
    sendCancel(ch, meta.id);
    return "cancelled";
  }
  ch.send(JSON.stringify({ v: 1, t: "file", batch, ...meta } satisfies Frame));
  let offset = 0;
  while (offset < file.size) {
    if (ch.readyState !== "open") throw new Error("channel closed");
    if (signal?.aborted) {
      sendCancel(ch, meta.id);
      return "cancelled";
    }
    if (gate?.paused) await gate.wait(signal);
    if (ch.bufferedAmount > HIGH_WATER) await drained(ch, signal);
    const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
    ch.send(chunk);
    offset += chunk.byteLength;
    onProgress(offset);
  }
  ch.send(JSON.stringify({ v: 1, t: "eof", id: meta.id } satisfies Frame));
  return "done";
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
  /** 상대가 보내겠다고 알려 왔다 — 사용자에게 받기/거절을 물을 차례다. */
  onOffer(offer: BatchOffer): void;
  /** 내가 보낸 묶음에 상대가 답했다. 수락 전에는 한 청크도 내보내지 않는다. */
  onVerdict(batch: string, accepted: boolean): void;
  /** 상대가 묶음을 거둬들였다 — 물어보던 것을 내린다. */
  onWithdraw(batch: string): void;
  onStart(meta: FileMeta): void;
  /** 디스크에 실제로 쓰인 만큼. 도착한 만큼이 아니다. */
  onProgress(id: string, written: number): void;
  /** 다 받았다. blob은 메모리 폴백일 때만 있다(디스크면 null). */
  onDone(id: string, blob: Blob | null): void;
  /** 상대가 이 파일을 중단했다 — 받던 조각은 이미 버려진 뒤다. */
  onCancel(id: string): void;
  /** 저장할 곳을 열지 못했거나 쓰다 실패했다. */
  onError(id: string): void;
  /** 내 디스크가 밀린다 — 상대에게 flow 프레임을 보내야 한다. */
  onCongest(paused: boolean): void;
  /** 상대 디스크가 밀린다 — 내 송신 게이트를 여닫아야 한다. */
  onFlow(paused: boolean): void;
  onText(body: string): void;
}

export class Receiver {
  /** 도착 순서를 지키는 한 줄 — 쓰기·열기·닫기가 전부 여기를 지난다. */
  #chain: Promise<void> = Promise.resolve();
  /** 수락한 묶음만 저장소를 갖는다. 없으면 그 묶음의 파일은 통째로 버린다. */
  #sinks = new Map<string, SinkFactory>();
  #cur: { meta: FileMeta; sink: FileSink; written: number } | null = null;
  /** 도착했지만 아직 디스크에 닿지 못한 바이트 */
  #queued = 0;
  #congested = false;

  constructor(private events: ReceiverEvents) {}

  /** 사용자가 받기를 눌렀다 — 이 묶음의 파일은 이 저장소로 간다. */
  accept(batch: string, factory: SinkFactory): void {
    this.#sinks.set(batch, factory);
  }

  /** 내 쪽에서 중단할 때 — 쓰다 만 파일을 지운다(상대에게 알리는 것은 호출자 몫). */
  discard(id: string): void {
    this.#enqueue(() => this.#abort(id));
  }

  /**
   * 연결이 끝났다 — 열려 있던 싱크를 정리한다.
   * 정리도 줄 끝에 세운다: 이미 도착해 줄에 서 있는 청크까지는 쓰고 나서 접어야
   * "쓰다 만 파일"이 정확히 한 번만 지워진다.
   */
  close(): Promise<void> {
    this.#enqueue(async () => {
      this.#sinks.clear();
      if (this.#cur) await this.#abort(this.#cur.meta.id);
    });
    return this.idle();
  }

  /** 줄에 남은 일이 다 끝날 때까지 (테스트·정리용). */
  idle(): Promise<void> {
    return this.#chain;
  }

  handle(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      let frame: Frame;
      try {
        frame = JSON.parse(data) as Frame;
      } catch {
        return; // 프레임이 아니면 무시
      }
      // 흐름 제어와 묶음 협상은 줄을 서지 않는다 — 쓰기가 밀리는 동안에도 즉시 먹혀야 한다.
      if (frame.t === "offer") {
        this.events.onOffer({ batch: frame.batch, files: frame.files });
      } else if (frame.t === "accept" || frame.t === "decline") {
        this.events.onVerdict(frame.batch, frame.t === "accept");
      } else if (frame.t === "withdraw") {
        this.#sinks.delete(frame.batch);
        this.events.onWithdraw(frame.batch);
      } else if (frame.t === "flow") {
        this.events.onFlow(frame.paused);
      } else if (frame.t === "text") {
        this.events.onText(frame.body);
      } else {
        this.#enqueue(() => this.#control(frame));
      }
      return;
    }
    // 청크는 도착한 즉시 세고(역압 판단), 쓰기는 줄을 선다.
    this.#queued += data.byteLength;
    if (!this.#congested && this.#queued > WRITE_HIGH) {
      this.#congested = true;
      this.events.onCongest(true);
    }
    this.#enqueue(() => this.#write(data));
  }

  #enqueue(step: () => Promise<void>): void {
    this.#chain = this.#chain.then(step, step);
  }

  async #write(chunk: ArrayBuffer): Promise<void> {
    const cur = this.#cur;
    try {
      if (cur) {
        await cur.sink.write(chunk);
        cur.written += chunk.byteLength;
        this.events.onProgress(cur.meta.id, cur.written);
      }
    } catch {
      // 디스크가 거부했다(용량·권한). 남은 청크가 더 와도 쓸 곳이 없다.
      if (cur) {
        this.#cur = null;
        await cur.sink.abort().catch(() => {});
        this.events.onError(cur.meta.id);
      }
    } finally {
      this.#queued -= chunk.byteLength;
      if (this.#congested && this.#queued <= WRITE_LOW) {
        this.#congested = false;
        this.events.onCongest(false);
      }
    }
  }

  async #control(frame: Frame): Promise<void> {
    if (frame.t === "file") {
      // 앞 파일이 eof 없이 끊겼다면 반쪽을 남기지 않는다.
      if (this.#cur) await this.#abort(this.#cur.meta.id);
      const factory = this.#sinks.get(frame.batch);
      if (!factory) return; // 수락하지 않은 묶음 — 이후 청크는 갈 곳이 없어 버려진다
      const meta: FileMeta = {
        id: frame.id,
        name: frame.name,
        size: frame.size,
        mime: frame.mime,
      };
      this.events.onStart(meta);
      try {
        this.#cur = { meta, sink: await factory(meta), written: 0 };
      } catch {
        this.#cur = null;
        this.events.onError(meta.id);
      }
    } else if (frame.t === "eof") {
      const cur = this.#cur;
      if (!cur || cur.meta.id !== frame.id) return;
      this.#cur = null;
      try {
        this.events.onDone(cur.meta.id, await cur.sink.close());
      } catch {
        await cur.sink.abort().catch(() => {});
        this.events.onError(cur.meta.id);
      }
    } else if (frame.t === "cancel") {
      await this.#abort(frame.id);
      this.events.onCancel(frame.id);
    }
  }

  /** 그 파일을 받던 중이면 쓰다 만 것을 지운다. */
  async #abort(id: string): Promise<void> {
    const cur = this.#cur;
    if (!cur || cur.meta.id !== id) return;
    this.#cur = null;
    await cur.sink.abort().catch(() => {});
  }
}
