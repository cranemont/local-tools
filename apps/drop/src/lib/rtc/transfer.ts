// 파일 전송 프로토콜 v1.
// 제어 프레임은 JSON 문자열(frames.ts), 파일 내용은 ArrayBuffer 청크.
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
//
// ── ack ─────────────────────────────────────────────────────────────
// 받는 쪽은 **디스크에 앉힌 만큼**을 ack로 알리고, 파일을 닫은 뒤 최종 ack를 보낸다.
// 보내는 쪽의 진행률·속도·"완료"는 전부 그 값에서 나온다 — 데이터 채널에 건넨 바이트는
// 송신 버퍼에 쌓인 양이라 진행률이 아니다.
// 상대가 ack를 모르는 예전 판일 수 있다. hello로 먼저 묻고(ordered라 accept보다 먼저 온다),
// 그래도 소식이 없으면 유예 시간 뒤 **낙관 모드**로 물러난다 — 영원히 "완료"를 못 띄우는
// 것이 최악이라서다.

import {
  encodeFrame,
  make,
  parseFrame,
  type BatchOffer,
  type Caps,
  type FileMeta,
  type Frame,
} from "./frames";
import { AckSession, AckTracker, ackDue } from "./progress";

export type { BatchOffer, Caps, FileMeta } from "./frames";

const CHUNK = 64 * 1024; // 크로미엄 간 안전 상한(256KB)보다 보수적으로
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

/** 받는 쪽에서 아직 디스크에 닿지 못한 양이 이만큼 쌓이면 상대를 세운다. */
const WRITE_HIGH = 4 * 1024 * 1024;
/** 이만큼까지 빠지면 다시 보내라고 한다. */
const WRITE_LOW = 1 * 1024 * 1024;

/** ack를 기다리는 시한들. 화면 동작의 근거라 테스트가 작은 값으로 갈아 끼운다. */
export interface AckTiming {
  /** ack가 하나도 안 오면 이만큼 기다렸다 낙관 모드로 물러난다(예전 판 상대). */
  grace: number;
  /** 오던 ack가 끊기면 이만큼 뒤에 상대가 죽은 것으로 본다. */
  dead: number;
  /** 시계를 다시 보는 주기. */
  poll: number;
}

export const ACK_TIMING: AckTiming = {
  // 상대가 새 판이면 hello가 이미 왔고, 아니어도 첫 쓰기 500ms 안에 ack가 온다.
  // 20초는 "느린 디스크"와 "예전 판"을 가르기에 넉넉하고, 틀려도 대가는 진행률 표시뿐이다.
  grace: 20_000,
  // 브라우저의 연결 실패 판정(10~30초)보다 서두르지 않는다. 느린 디스크는 여기 오기 전에
  // flow 프레임으로 우리를 세우므로, 여기까지 조용한 것은 상대가 멈춘 것이다.
  dead: 30_000,
  poll: 1_000,
};

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

function post(ch: RTCDataChannel, f: Frame): void {
  if (ch.readyState !== "open") return;
  // 제어 프레임 하나가 못 나갔다고 전송을 죽이지 않는다. 채널이 닫히는 찰나이거나
  // 송신 버퍼가 상한에 닿으면 send가 던지는데, 그 예외가 **받는 쪽 디스크 쓰기 줄에서
  // 올라오면 "디스크가 거부했다"로 잘못 읽혀 멀쩡히 앉은 파일을 지운다**(ack는 그 줄에서
  // 나간다). 못 간 값은 다음 ack에 누적으로 다시 실린다.
  try {
    ch.send(encodeFrame(f));
  } catch {
    // 상대는 다음 프레임에서 다시 듣는다.
  }
}

/** 능력 교환 — 채널이 열리자마자 한 번. 예전 판 상대는 이 프레임을 조용히 버린다. */
export function sendHello(ch: RTCDataChannel): void {
  post(ch, make.hello(true));
}

/** 보낼 목록을 먼저 알린다 — 받는 쪽이 수락해야 파일이 나간다. */
export function sendOffer(ch: RTCDataChannel, batch: string, files: FileMeta[]): void {
  post(ch, make.offer(batch, files));
}

export function sendAccept(ch: RTCDataChannel, batch: string): void {
  post(ch, make.accept(batch));
}

export function sendDecline(ch: RTCDataChannel, batch: string): void {
  post(ch, make.decline(batch));
}

/**
 * 보내는 쪽이 묶음을 거둬들인다(다 취소했다).
 * 이게 없으면 받는 쪽은 영영 오지 않을 파일의 수락 카드를 보고 있게 된다.
 */
export function sendWithdraw(ch: RTCDataChannel, batch: string): void {
  post(ch, make.withdraw(batch));
}

/** 내 디스크가 밀린다(또는 다시 여유가 생겼다)고 알린다. */
export function sendFlow(ch: RTCDataChannel, paused: boolean): void {
  post(ch, make.flow(paused));
}

/** 디스크에 앉힌 만큼을 알린다. fin이면 파일을 닫은 뒤다. */
export function sendAck(ch: RTCDataChannel, id: string, n: number, fin: boolean): void {
  post(ch, make.ack(id, n, fin));
}

export function sendText(ch: RTCDataChannel, body: string): void {
  post(ch, make.text(body));
}

/** 취소를 알린다 — 채널이 이미 닫혔으면 알릴 상대가 없으니 조용히 넘어간다. */
export function sendCancel(ch: RTCDataChannel, id: string): void {
  post(ch, make.cancel(id));
}

export interface SendOptions {
  ch: RTCDataChannel;
  file: Blob;
  meta: FileMeta;
  batch: string;
  /** 이 파일의 ack 장부. 상대의 ack는 바깥(수신 경로)에서 여기 앉는다. */
  tracker: AckTracker;
  /** 연결 단위 판단 — 상대가 ack를 아는 판인가. */
  session: AckSession;
  /** 화면에 쓸 진행값. **낙관 모드에서만** 건넨 바이트를 넘긴다. */
  onProgress(bytes: number): void;
  /** eof를 보냈고 상대가 디스크에 앉히기를 기다린다. */
  onSettling?(): void;
  signal?: AbortSignal;
  gate?: FlowGate;
  now?: () => number;
  timing?: AckTiming;
}

/**
 * 파일 하나를 보낸다. signal이 끊기면 남은 청크를 버리고 cancel 프레임으로 상대도 정리시킨다.
 * 취소 프레임은 양쪽 누구나 보낼 수 있고, 이미 정리한 쪽에서는 무시된다(멱등).
 * gate가 닫혀 있으면(상대 디스크가 밀림) 열릴 때까지 기다렸다 잇는다.
 *
 * 돌아오는 "done"은 **상대의 최종 ack를 받았다는 뜻**이다. 다만 상대가 ack를 모르는
 * 판이면 예전처럼 eof를 보낸 시점에 done으로 닫는다(낙관 모드).
 */
export async function sendFile(o: SendOptions): Promise<SendResult> {
  const { ch, file, meta, batch, tracker, session, onProgress, signal, gate } = o;
  const now = o.now ?? (() => performance.now());
  const timing = o.timing ?? ACK_TIMING;
  ch.bufferedAmountLowThreshold = LOW_WATER;
  const quit = (): SendResult => {
    sendCancel(ch, meta.id);
    return "cancelled";
  };
  if (signal?.aborted) return quit();
  post(ch, make.file(batch, meta));
  // 표시 방식은 파일 시작 때 정한다. 상대가 ack를 아는 판이면 진행률은 ack에서만 나오고,
  // 모르는(또는 아직 모르겠는) 판이면 건넨 바이트로 그린다 — 막대가 0에 붙어 있는 것보다 낫다.
  const optimistic = session.peerAcks !== true;
  let offset = 0;
  while (offset < file.size) {
    if (ch.readyState !== "open") throw new Error("channel closed");
    if (signal?.aborted) return quit();
    if (gate?.paused) {
      await gate.wait(signal);
      // 세워 둔 동안 흐른 시간은 침묵이 아니다.
      tracker.touch(now());
      if (signal?.aborted) return quit();
    }
    if (ch.bufferedAmount > HIGH_WATER) {
      await drained(ch, signal);
      tracker.touch(now());
      if (signal?.aborted) return quit();
    }
    const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
    ch.send(chunk);
    offset += chunk.byteLength;
    if (optimistic) onProgress(offset);
    // 상대가 ack를 아는데 뚝 끊겼다. 느린 디스크는 flow로 우리를 세우므로 여기 오지 않는다.
    if (!optimistic && tracker.silentFor(now()) >= timing.dead) {
      // 파일 한가운데서 접는 것이라 반드시 알린다 — 안 그러면 상대는 쓰다 만 파일을
      // 연 채로 영영 기다린다(취소 프레임은 양방향 멱등이라 겹쳐도 안전하다).
      sendCancel(ch, meta.id);
      throw new Error("ack timeout");
    }
  }
  post(ch, make.eof(meta.id));
  o.onSettling?.();
  // 예전 판 상대 — 확인해 줄 사람이 없으니 v1처럼 여기서 닫는다.
  if (session.peerAcks === false) return "done";
  return settle(ch, tracker, session, now, timing, signal);
}

/**
 * eof를 보낸 뒤 상대의 최종 ack를 기다린다.
 * 세 갈래로만 빠져나온다 — 최종 ack(완료), 취소, 그리고 시한.
 */
async function settle(
  ch: RTCDataChannel,
  tracker: AckTracker,
  session: AckSession,
  now: () => number,
  timing: AckTiming,
  signal?: AbortSignal,
): Promise<SendResult> {
  const eofAt = now();
  while (!tracker.final) {
    if (signal?.aborted) {
      sendCancel(ch, tracker.id);
      return "cancelled";
    }
    if (ch.readyState !== "open") throw new Error("channel closed");
    await Promise.race([tracker.next(), sleep(timing.poll, signal)]);
    const at = now();
    // 낙관으로 물러날 수 있는 것은 **상대가 ack를 아는 판인지 모를 때뿐**이다.
    // hello로 안다고 들어 놓고 한 장도 안 오면 그건 예전 판이 아니라 멈춘 상대다 —
    // 여기서 "완료"라고 하면 고치려던 그 거짓말을 그대로 되살린다.
    if (!tracker.sawAck && session.peerAcks !== true) {
      // 한 장도 안 왔다 → 상대는 ack를 모르는 판이다. 다음 파일부터는 기다리지 않는다.
      if (at - eofAt >= timing.grace) {
        session.giveUp();
        return "done";
      }
    } else if (tracker.silentFor(at) >= timing.dead) {
      throw new Error("ack timeout");
    }
  }
  // 다 썼다면서 숫자가 모자란다 — "완료"라고 말하지 않는다.
  if (tracker.short) throw new Error("short ack");
  return "done";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
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
  /** 상대가 능력을 알려 왔다 — ack를 아는 판인지. */
  onHello(caps: Caps): void;
  /** 상대가 보내겠다고 알려 왔다 — 사용자에게 받기/거절을 물을 차례다. */
  onOffer(offer: BatchOffer): void;
  /** 내가 보낸 묶음에 상대가 답했다. 수락 전에는 한 청크도 내보내지 않는다. */
  onVerdict(batch: string, accepted: boolean): void;
  /** 상대가 묶음을 거둬들였다 — 물어보던 것을 내린다. */
  onWithdraw(batch: string): void;
  onStart(meta: FileMeta): void;
  /** 디스크에 실제로 쓰인 만큼. 도착한 만큼이 아니다. */
  onProgress(id: string, written: number): void;
  /** 여기까지 앉혔다고 상대에게 알릴 차례다(final이면 파일을 닫은 뒤). */
  onAckDue(id: string, written: number, final: boolean): void;
  /** 상대가 내 전송을 확인해 왔다 — 내 진행률·완료가 여기서 나온다. */
  onPeerAck(id: string, bytes: number, final: boolean): void;
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
  #cur: {
    meta: FileMeta;
    sink: FileSink;
    written: number;
    /** 마지막으로 알린 값과 그 시각 — 다음 ack를 언제 보낼지 여기서 나온다. */
    acked: number;
    ackAt: number;
  } | null = null;
  /** 도착했지만 아직 디스크에 닿지 못한 바이트 */
  #queued = 0;
  #congested = false;

  constructor(
    private events: ReceiverEvents,
    private now: () => number = () => performance.now(),
  ) {}

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
      const frame = parseFrame(data);
      if (!frame) return; // 프레임이 아니거나 모양이 안 맞으면 무시
      // 흐름 제어·능력 교환·ack·묶음 협상은 줄을 서지 않는다 —
      // 쓰기가 밀리는 동안에도 즉시 먹혀야 한다.
      if (frame.t === "hello") {
        this.events.onHello({ ack: frame.ack });
      } else if (frame.t === "ack") {
        this.events.onPeerAck(frame.id, frame.n, frame.fin);
      } else if (frame.t === "offer") {
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
        // 여기서만 ack가 나간다 — 도착한 바이트가 아니라 **앉은 바이트**를 알리는 자리.
        const at = this.now();
        if (ackDue(cur.written, cur.acked, cur.ackAt, at)) {
          cur.acked = cur.written;
          cur.ackAt = at;
          this.events.onAckDue(cur.meta.id, cur.written, false);
        }
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
        const sink = await factory(meta);
        this.#cur = { meta, sink, written: 0, acked: 0, ackAt: this.now() };
      } catch {
        this.#cur = null;
        this.events.onError(meta.id);
      }
    } else if (frame.t === "eof") {
      const cur = this.#cur;
      if (!cur || cur.meta.id !== frame.id) return;
      this.#cur = null;
      let blob: Blob | null = null;
      try {
        blob = await cur.sink.close();
      } catch {
        // 닫다 실패했다 = 다 앉지 못했다. 최종 ack를 보내지 않으니 상대도 완료라 하지 않는다.
        await cur.sink.abort().catch(() => {});
        this.events.onError(cur.meta.id);
        return;
      }
      // 최종 ack는 **파일을 닫은 뒤**다. 이것이 보내는 쪽 "완료"의 유일한 근거다.
      this.events.onAckDue(cur.meta.id, cur.written, true);
      this.events.onDone(cur.meta.id, blob);
    } else if (frame.t === "cancel") {
      await this.#abort(frame.id);
      this.events.onCancel(frame.id);
    }
  }

  /** 그 파일을 받던 중이면 쓰다 만 것을 지운다. 지운 파일은 ack하지 않는다. */
  async #abort(id: string): Promise<void> {
    const cur = this.#cur;
    if (!cur || cur.meta.id !== id) return;
    this.#cur = null;
    await cur.sink.abort().catch(() => {});
  }
}
