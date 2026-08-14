// 드롭의 전송 프로토콜 — 프레임·ack·진행률의 명세를 실행 가능한 형태로 적는다.
//
// 여기 적힌 규칙이 깨지면 사용자가 다치는 방식:
//  · **"완료"가 거짓이 된다.** 예전에는 데이터 채널에 건넨 바이트를 진행률로 쓰고 eof를
//    보낸 순간 완료라고 말했다. 그건 내 송신 버퍼에 쌓인 양이라, 상대가 디스크에 다 쓰기
//    전에(심지어 상대가 죽어도) 완료가 떴다. 지금은 **받는 쪽이 앉힌 만큼**만 진행률이고,
//    완료는 파일을 닫은 뒤 오는 최종 ack다.
//  · **취소 뒤 늦게 온 ack가 다음 파일에 얹히면** 진행률이 저 혼자 뛴다. 취소는 이 프로토콜의
//    급소라 장부를 id로만 찾는다 — 여기가 명세의 핵심이다.
//  · **상대가 예전 판이면** ack가 영영 안 온다. 그때 완료를 못 띄우고 멈추는 것이 최악이라
//    hello로 먼저 묻고, 그래도 소식이 없으면 유예 뒤 낙관 모드로 물러난다.
//  · 첫 구간 속도가 튀면 남은 시간이 "3초"라고 했다가 "4분"이 된다. 그래서 속도는
//    창이 충분히 길어지기 전에는 말하지 않는다.

import { describe, expect, it } from "vitest";

import {
  encodeFrame,
  make,
  parseFrame,
  type FileMeta,
  type Frame,
} from "../apps/drop/src/lib/rtc/frames";
import {
  ACK_BYTES,
  ACK_MS,
  AckBook,
  AckSession,
  AckTracker,
  ackDue,
  clampAck,
  etaSeconds,
  pushSample,
  windowRate,
  type Sample,
} from "../apps/drop/src/lib/rtc/progress";
import {
  FlowGate,
  Receiver,
  sendAck,
  sendFile,
  type FileSink,
  type ReceiverEvents,
} from "../apps/drop/src/lib/rtc/transfer";

// ── 도우미 ──────────────────────────────────────────────────────────

const CHUNK = 64 * 1024; // transfer.ts의 청크 크기 — 경계 시험이 이 값에 걸린다

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 조건이 참이 될 때까지 기다린다(안 되면 실패). 실시간 타이머를 쓰는 자리에서만. */
async function until(fn: () => boolean, ms = 2000): Promise<void> {
  const limit = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > limit) throw new Error("기다리던 일이 일어나지 않았다");
    await delay(1);
  }
}

const blob = (n: number): Blob => new Blob([new Uint8Array(n)]);

/** 시간을 손으로 돌리는 시계 — 받는 쪽 ack 주기를 재는 데 쓴다. */
function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

/** RTCDataChannel 흉내 — 나간 것을 모으고, 원하면 상대에게 흘려보낸다. */
function fakeChannel(sink?: (data: string | ArrayBuffer) => void) {
  const out: (string | ArrayBuffer)[] = [];
  const ch = {
    readyState: "open" as RTCDataChannelState,
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send(data: string | ArrayBuffer) {
      out.push(data);
      sink?.(data);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    ch: ch as unknown as RTCDataChannel,
    out,
    /** 나간 제어 프레임만 */
    frames: (): Frame[] =>
      out.filter((x): x is string => typeof x === "string").map((s) => parseFrame(s)!),
    /** 나간 바이너리 청크의 크기 목록 */
    chunks: (): number[] =>
      out.filter((x): x is ArrayBuffer => typeof x !== "string").map((b) => b.byteLength),
    has: (t: Frame["t"]) => out.some((x) => typeof x === "string" && parseFrame(x)?.t === t),
  };
}

const META: FileMeta = { id: "f1", name: "photo.jpg", size: 300, mime: "image/jpeg" };

/** 아무것도 안 하는 수신 이벤트 — 테스트마다 볼 것만 덮어쓴다. */
function events(over: Partial<ReceiverEvents> = {}): ReceiverEvents {
  return {
    onHello: () => {},
    onAckDue: () => {},
    onPeerAck: () => {},
    onOffer: () => {},
    onVerdict: () => {},
    onWithdraw: () => {},
    onStart: () => {},
    onProgress: () => {},
    onDone: () => {},
    onCancel: () => {},
    onError: () => {},
    onCongest: () => {},
    onFlow: () => {},
    onText: () => {},
    ...over,
  };
}

/** 받아 쓰는 자리 흉내. block()으로 느린 디스크를 만든다. */
function fakeSink() {
  const writes: number[] = [];
  let closed = false;
  let aborted = false;
  let gate: (() => void) | null = null;
  const sink: FileSink = {
    async write(chunk) {
      if (gate) await new Promise<void>((r) => (gate = r));
      writes.push(chunk.byteLength);
    },
    async close() {
      closed = true;
      return null;
    },
    async abort() {
      aborted = true;
    },
  };
  return {
    sink,
    writes,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    block() {
      gate = () => {};
    },
    release() {
      const g = gate;
      gate = null;
      g?.();
    },
  };
}

const fileFrame = (meta: FileMeta = META, batch = "batch-1") =>
  encodeFrame(make.file(batch, meta));
const chunk = (n: number) => new ArrayBuffer(n);

// ── 프레임 ──────────────────────────────────────────────────────────

describe("프레임 — 적은 대로 돌아온다", () => {
  it("모든 프레임이 왕복한다", () => {
    const all: Frame[] = [
      make.hello(true),
      make.offer("b1", [META]),
      make.accept("b1"),
      make.decline("b1"),
      make.withdraw("b1"),
      make.file("b1", META),
      make.eof("f1"),
      make.ack("f1", 1234, false),
      make.ack("f1", 1234, true),
      make.cancel("f1"),
      make.flow(true),
      make.text("여기 링크"),
    ];
    for (const f of all) expect(parseFrame(encodeFrame(f))).toEqual(f);
  });

  it("0바이트 파일도 온전한 메타다 (크기 0은 '모름'이 아니다)", () => {
    const empty: FileMeta = { id: "e", name: "빈.txt", size: 0, mime: "text/plain" };
    const back = parseFrame(encodeFrame(make.file("b1", empty)));
    expect(back).toEqual({ v: 1, t: "file", batch: "b1", ...empty });
  });

  it("정확히 청크 크기인 파일도 그대로 실린다", () => {
    const exact: FileMeta = { id: "c", name: "정확.bin", size: CHUNK, mime: "" };
    const back = parseFrame(encodeFrame(make.file("b1", exact)));
    expect(back).toMatchObject({ size: CHUNK });
  });

  it("유니코드 파일 이름이 한 글자도 안 바뀐다", () => {
    for (const name of [
      "회의록 2026-08.pdf",
      "報告書－最終版.docx",
      "résumé (2).pdf",
      "한글̈결합.txt",
      "emoji 없는 이름 — 대시.txt",
    ]) {
      const back = parseFrame(encodeFrame(make.file("b1", { ...META, name })));
      expect(back).toMatchObject({ name });
    }
  });

  it("ack는 누적 바이트와 최종 여부를 싣는다", () => {
    expect(parseFrame(encodeFrame(make.ack("f1", 0, true)))).toEqual({
      v: 1,
      t: "ack",
      id: "f1",
      n: 0,
      fin: true,
    });
  });
});

describe("프레임 — 상대가 준 값을 그대로 믿지 않는다", () => {
  it("프레임이 아니면 버린다", () => {
    for (const junk of ["", "{", "null", "[1,2]", '"문자열"', "12"]) {
      expect(parseFrame(junk)).toBeNull();
    }
  });

  it("모르는 종류와 다른 버전은 버린다 (앞으로 붙을 프레임에 대한 관용)", () => {
    expect(parseFrame(JSON.stringify({ v: 1, t: "무엇" }))).toBeNull();
    expect(parseFrame(JSON.stringify({ v: 2, t: "eof", id: "f1" }))).toBeNull();
  });

  it("모양이 안 맞는 메타는 통째로 버린다", () => {
    const bad = [
      { v: 1, t: "file", batch: "b1", id: "f1", name: "a", size: "300", mime: "" },
      { v: 1, t: "file", batch: "b1", id: "f1", name: "a", size: -1, mime: "" },
      { v: 1, t: "file", batch: "b1", id: "f1", size: 1, mime: "" },
      { v: 1, t: "file", id: "f1", name: "a", size: 1, mime: "" },
      { v: 1, t: "offer", batch: "b1", files: [{ id: "f1" }] },
      { v: 1, t: "ack", id: "f1", n: "많이" },
      { v: 1, t: "eof" },
      { v: 1, t: "text", body: 3 },
    ];
    for (const f of bad) expect(parseFrame(JSON.stringify(f))).toBeNull();
  });

  it("mime이 없으면 빈 문자열로 채운다 (undefined가 흘러다니지 않게)", () => {
    const back = parseFrame(
      JSON.stringify({ v: 1, t: "file", batch: "b1", id: "f1", name: "a", size: 1 }),
    );
    expect(back).toMatchObject({ mime: "" });
  });

  it("flow·hello의 참거짓은 엄격하게 읽는다", () => {
    expect(parseFrame(JSON.stringify({ v: 1, t: "flow", paused: "yes" }))).toEqual({
      v: 1,
      t: "flow",
      paused: false,
    });
    expect(parseFrame(JSON.stringify({ v: 1, t: "hello" }))).toEqual({
      v: 1,
      t: "hello",
      ack: false,
    });
  });
});

// ── ack 장부 ────────────────────────────────────────────────────────

describe("ack 장부 — 숫자는 앞으로만 간다", () => {
  it("순서가 뒤바뀌어도 뒤로 가지 않는다", () => {
    expect(clampAck(100, 50, 300)).toBe(100);
    const t = new AckTracker("f1", 300, 0);
    expect(t.apply(100, false, 1)).toBe(true);
    expect(t.apply(50, false, 2)).toBe(false);
    expect(t.acked).toBe(100);
  });

  it("같은 값이 두 번 와도 진행이 생기지 않는다", () => {
    const t = new AckTracker("f1", 300, 0);
    t.apply(100, false, 1);
    expect(t.apply(100, false, 2)).toBe(false);
    expect(t.acked).toBe(100);
  });

  it("파일 크기를 넘는 ack는 크기에서 멈춘다", () => {
    expect(clampAck(0, 999, 300)).toBe(300);
    const t = new AckTracker("f1", 300, 0);
    t.apply(999, false, 1);
    expect(t.acked).toBe(300);
  });

  it("숫자가 아닌 값은 장부를 흔들지 못한다", () => {
    expect(clampAck(100, Number.NaN, 300)).toBe(100);
    expect(clampAck(100, Number.POSITIVE_INFINITY, 300)).toBe(100);
  });

  it("최종 ack가 와야 완료다 — 숫자만 다 차는 것으로는 부족하다", () => {
    const t = new AckTracker("f1", 300, 0);
    t.apply(300, false, 1);
    expect(t.complete).toBe(false);
    t.apply(300, true, 2);
    expect(t.complete).toBe(true);
    expect(t.short).toBe(false);
  });

  it("다 썼다면서 숫자가 모자라면 완료가 아니라 어긋남이다", () => {
    const t = new AckTracker("f1", 300, 0);
    t.apply(200, true, 1);
    expect(t.complete).toBe(false);
    expect(t.short).toBe(true);
  });

  it("0바이트 파일은 최종 ack 한 장으로 완료된다", () => {
    const t = new AckTracker("e", 0, 0);
    t.apply(0, true, 1);
    expect(t.complete).toBe(true);
  });

  it("어떤 ack든 '상대가 확인해 주는 판'이라는 증거다 (중복·역행이라도)", () => {
    const t = new AckTracker("f1", 300, 0);
    expect(t.sawAck).toBe(false);
    t.apply(0, false, 1);
    expect(t.sawAck).toBe(true);
  });

  it("멈춰 있던 시간은 침묵으로 세지 않는다 (touch)", () => {
    const t = new AckTracker("f1", 300, 0);
    expect(t.silentFor(5000)).toBe(5000);
    t.touch(5000);
    expect(t.silentFor(5000)).toBe(0);
  });

  it("ack를 기다리던 쪽은 ack가 오면 깨어난다", async () => {
    const t = new AckTracker("f1", 300, 0);
    let woke = false;
    const waiting = t.next().then(() => (woke = true));
    await delay(1);
    expect(woke).toBe(false);
    t.apply(100, false, 1);
    await waiting;
    expect(woke).toBe(true);
  });
});

describe("ack 장부 묶음 — 취소한 파일의 늦은 ack는 갈 곳이 없다", () => {
  it("장부에서 빠진 id의 ack는 아무 일도 하지 않는다", () => {
    const book = new AckBook();
    book.open("f1", 300, 0);
    book.close("f1");
    expect(book.apply("f1", 300, true, 1)).toBeNull();
  });

  it("취소 뒤 도착한 ack가 다음 파일의 진행률에 얹히지 않는다", () => {
    const book = new AckBook();
    book.open("f1", 1000, 0);
    book.close("f1"); // 취소
    const second = book.open("f2", 1000, 1);
    // 상대는 아직 f1의 청크를 디스크에 앉히는 중이라 늦은 ack가 온다.
    expect(book.apply("f1", 900, false, 2)).toBeNull();
    expect(second.acked).toBe(0);
    // 새 파일의 ack만 새 파일에 앉는다.
    expect(book.apply("f2", 120, false, 3)?.acked).toBe(120);
    expect(second.acked).toBe(120);
  });

  it("모르는 id의 ack도 조용히 버린다 (상대가 지어낸 id 포함)", () => {
    const book = new AckBook();
    book.open("f2", 10, 0);
    expect(book.apply("없는-id", 999, true, 1)).toBeNull();
  });

  it("연결이 접히면 장부가 통째로 비워진다", () => {
    const book = new AckBook();
    book.open("f1", 10, 0);
    book.clear();
    expect(book.apply("f1", 10, true, 1)).toBeNull();
  });
});

// ── 속도·남은 시간 ──────────────────────────────────────────────────

describe("속도 — 첫 구간에서 튀지 않는다", () => {
  it("표본 하나로는 속도를 말하지 않는다", () => {
    const w: Sample[] = [];
    pushSample(w, 0, 65536);
    expect(windowRate(w, 0)).toBe(0);
  });

  it("창이 짧으면 아직 모른다 — 64KB가 2ms 만에 '나갔다'고 32MB/s라 하지 않는다", () => {
    const w: Sample[] = [];
    pushSample(w, 0, 0);
    pushSample(w, 2, 65536);
    expect(windowRate(w, 2)).toBe(0);
  });

  /** 250ms 표본 하나에 이만큼이면 초당 1 MiB다. */
  const PER_TICK = 1024 * 1024 * 0.25;

  it("창이 충분히 길어지면 그 기울기가 속도다", () => {
    const w: Sample[] = [];
    for (let i = 0; i <= 8; i++) pushSample(w, i * 250, i * PER_TICK);
    expect(windowRate(w, 2000)).toBeCloseTo(1024 * 1024, 0);
  });

  it("창 밖으로 밀린 표본은 속도를 끌고 다니지 않는다", () => {
    const w: Sample[] = [];
    // 앞 3초는 빨랐고(10 MiB/s), 뒤 3초는 느리다(1 MiB/s).
    for (let i = 0; i <= 12; i++) pushSample(w, i * 250, i * PER_TICK * 10);
    const fast = w[w.length - 1].bytes;
    for (let i = 1; i <= 12; i++) pushSample(w, 3000 + i * 250, fast + i * PER_TICK);
    expect(windowRate(w, 6000)).toBeCloseTo(1024 * 1024, 0);
  });

  it("진척이 멈추면 속도가 0으로 내려온다", () => {
    const w: Sample[] = [];
    for (let i = 0; i <= 8; i++) pushSample(w, i * 250, i * PER_TICK);
    for (let i = 9; i <= 20; i++) pushSample(w, i * 250, 8 * PER_TICK); // 그대로 멈춤
    expect(windowRate(w, 5000)).toBe(0);
  });

  it("소식이 끊기면(표본조차 안 들어오면) 속도를 0으로 본다", () => {
    const w: Sample[] = [];
    pushSample(w, 0, 0);
    pushSample(w, 1000, 1024 * 1024);
    expect(windowRate(w, 1000)).toBeCloseTo(1024 * 1024, 0);
    expect(windowRate(w, 9000)).toBe(0);
  });

  it("뒤로 가는 표본은 버린다 (늦게 온 값이 속도를 음수로 만들지 않는다)", () => {
    const w: Sample[] = [];
    pushSample(w, 0, 0);
    pushSample(w, 1000, 1_000_000);
    pushSample(w, 1200, 500_000); // 뒷걸음
    pushSample(w, 900, 2_000_000); // 과거
    expect(w.map((s) => s.bytes)).toEqual([0, 1_000_000]);
  });

  it("같은 시각의 표본은 덮어쓴다", () => {
    const w: Sample[] = [];
    pushSample(w, 0, 0);
    pushSample(w, 500, 100);
    pushSample(w, 500, 200);
    expect(w).toEqual([
      { at: 0, bytes: 0 },
      { at: 500, bytes: 200 },
    ]);
  });

  it("남은 시간은 속도를 알 때만 나온다", () => {
    expect(etaSeconds(1000, 5000)).toBe(5);
    expect(etaSeconds(0, 5000)).toBe(0);
    expect(etaSeconds(1000, 0)).toBe(0);
  });
});

describe("ack 주기 — 모든 청크마다 보내지 않는다", () => {
  it("쌓인 바이트가 문턱을 넘으면 보낸다", () => {
    expect(ackDue(ACK_BYTES - 1, 0, 0, 0)).toBe(false);
    expect(ackDue(ACK_BYTES, 0, 0, 0)).toBe(true);
  });

  it("덜 쌓였어도 시간이 지나면 보낸다 (느린 연결에서 소식이 끊기지 않게)", () => {
    expect(ackDue(1000, 0, 0, ACK_MS - 1)).toBe(false);
    expect(ackDue(1000, 0, 0, ACK_MS)).toBe(true);
  });

  it("진척이 없으면 보내지 않는다", () => {
    expect(ackDue(500, 500, 0, 10_000)).toBe(false);
  });
});

// ── 받는 쪽: ack를 언제 보내는가 ────────────────────────────────────

describe("수신 — 디스크에 앉힌 만큼만 ack한다", () => {
  const big: FileMeta = { ...META, size: 10 * CHUNK };

  function rig() {
    const c = clock();
    const acks: { id: string; n: number; fin: boolean }[] = [];
    const sink = fakeSink();
    const rx = new Receiver(
      events({ onAckDue: (id, n, fin) => acks.push({ id, n, fin }) }),
      c.now,
    );
    rx.accept("batch-1", async () => sink.sink);
    return { rx, acks, sink, clock: c };
  }

  it("청크 넉 장(256KB)이 앉으면 한 장 보낸다", async () => {
    const { rx, acks } = rig();
    rx.handle(fileFrame(big));
    for (let i = 0; i < 4; i++) rx.handle(chunk(CHUNK));
    await rx.idle();
    expect(acks).toEqual([{ id: "f1", n: 4 * CHUNK, fin: false }]);
  });

  it("덜 쌓였으면 참는다 — 그러나 시간이 지나면 보낸다", async () => {
    const { rx, acks, clock: c } = rig();
    rx.handle(fileFrame(big));
    for (let i = 0; i < 4; i++) rx.handle(chunk(CHUNK));
    await rx.idle();
    rx.handle(chunk(CHUNK)); // 64KB — 문턱에 못 미친다
    await rx.idle();
    expect(acks.length).toBe(1);
    c.advance(ACK_MS);
    rx.handle(chunk(CHUNK));
    await rx.idle();
    expect(acks[1]).toEqual({ id: "f1", n: 6 * CHUNK, fin: false });
  });

  it("최종 ack는 파일을 닫은 뒤에 나간다 (이것이 '완료'의 근거다)", async () => {
    const order: string[] = [];
    const c = clock();
    const sink = fakeSink();
    sink.sink.close = async () => {
      await delay(5);
      order.push("close");
      return null;
    };
    const rx = new Receiver(
      events({
        onAckDue: (_id, n, fin) => order.push(fin ? `ack:fin:${n}` : `ack:${n}`),
        onDone: () => order.push("done"),
      }),
      c.now,
    );
    rx.accept("batch-1", async () => sink.sink);
    rx.handle(fileFrame({ ...META, size: 100 }));
    rx.handle(chunk(100));
    rx.handle(encodeFrame(make.eof("f1")));
    await rx.idle();
    expect(order).toEqual(["close", "ack:fin:100", "done"]);
  });

  it("0바이트 파일도 최종 ack를 받는다", async () => {
    const { rx, acks } = rig();
    rx.handle(fileFrame({ ...META, size: 0 }));
    rx.handle(encodeFrame(make.eof("f1")));
    await rx.idle();
    expect(acks).toEqual([{ id: "f1", n: 0, fin: true }]);
  });

  it("취소된 파일은 최종 ack를 보내지 않는다 (지운 파일을 받았다고 말하지 않는다)", async () => {
    const { rx, acks } = rig();
    rx.handle(fileFrame(big));
    rx.handle(chunk(4 * CHUNK));
    rx.handle(encodeFrame(make.cancel("f1")));
    rx.handle(encodeFrame(make.eof("f1")));
    await rx.idle();
    expect(acks.some((a) => a.fin)).toBe(false);
  });

  it("쓰다 실패하면 최종 ack가 없다", async () => {
    const { rx, acks, sink } = rig();
    rx.handle(fileFrame(big));
    await rx.idle();
    sink.sink.write = async () => {
      throw new Error("QuotaExceededError");
    };
    rx.handle(chunk(CHUNK));
    rx.handle(encodeFrame(make.eof("f1")));
    await rx.idle();
    expect(acks).toEqual([]);
  });
});

describe("수신 — 못 나간 ack가 받은 파일을 죽이지 않는다", () => {
  /** 송신 버퍼가 상한에 닿거나 채널이 닫히는 찰나면 send가 던진다. */
  function throwingChannel() {
    return {
      readyState: "open" as RTCDataChannelState,
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      send() {
        throw new Error("OperationError");
      },
      addEventListener() {},
      removeEventListener() {},
    } as unknown as RTCDataChannel;
  }

  it("제어 프레임은 못 나가도 던지지 않는다", () => {
    expect(() => sendAck(throwingChannel(), "f1", 100, false)).not.toThrow();
  });

  it("ack가 못 나가도 디스크에 앉은 파일은 그대로 남는다", async () => {
    // ack는 **쓰기 줄 안에서** 나간다. 여기서 난 예외를 "디스크가 거부했다"로 읽으면
    // 멀쩡히 앉은 파일을 지우고(abort → removeEntry) 오류라고 말하게 된다.
    const ch = throwingChannel();
    const sink = fakeSink();
    const errors: string[] = [];
    const dones: string[] = [];
    const rx = new Receiver(
      events({
        onAckDue: (id, n, fin) => sendAck(ch, id, n, fin),
        onError: (id) => errors.push(id),
        onDone: (id) => dones.push(id),
      }),
    );
    rx.accept("batch-1", async () => sink.sink);
    rx.handle(fileFrame({ ...META, size: 4 * CHUNK }));
    for (let i = 0; i < 4; i++) rx.handle(chunk(CHUNK));
    rx.handle(encodeFrame(make.eof("f1")));
    await rx.idle();
    expect(errors).toEqual([]);
    expect(sink.aborted).toBe(false);
    expect(sink.closed).toBe(true);
    expect(dones).toEqual(["f1"]);
  });
});

describe("수신 — 상대의 ack·hello는 쓰기 줄 뒤에 서지 않는다", () => {
  it("디스크가 밀려 있어도 상대의 ack는 곧바로 위로 올라간다", async () => {
    const seen: number[] = [];
    const sink = fakeSink();
    const rx = new Receiver(events({ onPeerAck: (_id, n) => seen.push(n) }));
    rx.accept("batch-1", async () => sink.sink);
    rx.handle(fileFrame());
    await rx.idle();
    sink.block();
    rx.handle(chunk(100));
    // 쓰기가 막혀 줄이 서 있는 지금, 내 전송에 대한 ack가 도착한다.
    rx.handle(encodeFrame(make.ack("out-1", 4096, false)));
    expect(seen).toEqual([4096]); // await 없이 이미 올라왔다
    sink.release();
    await rx.idle();
  });

  it("hello는 상대가 ack를 아는 판인지 알려 준다", () => {
    const caps: boolean[] = [];
    const rx = new Receiver(events({ onHello: (c) => caps.push(c.ack) }));
    rx.handle(encodeFrame(make.hello(true)));
    expect(caps).toEqual([true]);
  });
});

// ── 보내는 쪽: 완료는 최종 ack다 ────────────────────────────────────

const FAST = { grace: 60, dead: 60, poll: 3 };

function sendRig(size: number, over: Partial<Parameters<typeof sendFile>[0]> = {}) {
  const net = fakeChannel();
  const session = new AckSession();
  const tracker = new AckTracker(META.id, size, performance.now());
  const progress: number[] = [];
  const settling: boolean[] = [];
  const run = (extra: Partial<Parameters<typeof sendFile>[0]> = {}) =>
    sendFile({
      ch: net.ch,
      file: blob(size),
      meta: { ...META, size },
      batch: "batch-1",
      tracker,
      session,
      onProgress: (n) => progress.push(n),
      onSettling: () => settling.push(true),
      timing: FAST,
      ...over,
      ...extra,
    });
  return { net, session, tracker, progress, settling, run };
}

describe("송신 — 건넨 바이트는 진행률이 아니다", () => {
  it("상대가 ack를 아는 판이면 진행률 콜백이 한 번도 안 불린다", async () => {
    const rig = sendRig(3 * CHUNK);
    rig.session.noteHello(true);
    const p = rig.run();
    await until(() => rig.net.has("eof"));
    expect(rig.progress).toEqual([]); // 버퍼에 쌓인 것을 '보냈다'고 세지 않는다
    rig.tracker.apply(3 * CHUNK, true, performance.now());
    await expect(p).resolves.toBe("done");
  });

  it("최종 ack가 오기 전에는 완료가 아니다", async () => {
    const rig = sendRig(200);
    rig.session.noteHello(true);
    let settled = false;
    const p = rig.run({ timing: { grace: 5000, dead: 5000, poll: 3 } }).then((r) => {
      settled = true;
      return r;
    });
    await until(() => rig.net.has("eof"));
    // 중간 ack가 다 차도 아직이다 — 파일이 닫혔다는 말을 들어야 한다.
    rig.tracker.apply(200, false, performance.now());
    await delay(30);
    expect(settled).toBe(false);
    expect(rig.settling).toEqual([true]);
    rig.tracker.apply(200, true, performance.now());
    await expect(p).resolves.toBe("done");
  });

  it("다 썼다면서 숫자가 모자란 최종 ack는 완료로 받지 않는다", async () => {
    const rig = sendRig(200);
    rig.session.noteHello(true);
    const p = rig.run({ timing: { grace: 5000, dead: 5000, poll: 3 } });
    await until(() => rig.net.has("eof"));
    rig.tracker.apply(120, true, performance.now());
    await expect(p).rejects.toThrow();
  });

  it("0바이트 파일은 청크 없이 file→eof로 나가고 최종 ack로 닫힌다", async () => {
    const rig = sendRig(0);
    rig.session.noteHello(true);
    const p = rig.run({ timing: { grace: 5000, dead: 5000, poll: 3 } });
    await until(() => rig.net.has("eof"));
    expect(rig.net.chunks()).toEqual([]);
    expect(rig.net.frames().map((f) => f.t)).toEqual(["file", "eof"]);
    rig.tracker.apply(0, true, performance.now());
    await expect(p).resolves.toBe("done");
  });

  it("정확히 청크 크기면 조각 하나, 한 바이트 더면 두 조각이다", async () => {
    const exact = sendRig(CHUNK);
    exact.session.noteHello(true);
    const p1 = exact.run({ timing: { grace: 5000, dead: 5000, poll: 3 } });
    await until(() => exact.net.has("eof"));
    expect(exact.net.chunks()).toEqual([CHUNK]);
    exact.tracker.apply(CHUNK, true, performance.now());
    await p1;

    const over = sendRig(CHUNK + 1);
    over.session.noteHello(true);
    const p2 = over.run({ timing: { grace: 5000, dead: 5000, poll: 3 } });
    await until(() => over.net.has("eof"));
    expect(over.net.chunks()).toEqual([CHUNK, 1]);
    over.tracker.apply(CHUNK + 1, true, performance.now());
    await p2;
  });
});

describe("송신 — ack를 안 보내는 상대(예전 판)", () => {
  it("유예 시간이 지나면 낙관 모드로 물러난다 — 영원히 기다리지 않는다", async () => {
    const rig = sendRig(200); // hello를 안 받았다 = 아직 모름
    await expect(rig.run()).resolves.toBe("done");
    expect(rig.session.peerAcks).toBe(false);
  });

  it("모르는 상대에게는 건넨 바이트로라도 막대를 그린다", async () => {
    const rig = sendRig(CHUNK + 10);
    await rig.run();
    expect(rig.progress).toEqual([CHUNK, CHUNK + 10]);
  });

  it("한 번 배우면 다음 파일부터는 기다리지 않는다", async () => {
    const rig = sendRig(200);
    await rig.run();
    expect(rig.session.peerAcks).toBe(false);
    // 유예를 아주 길게 줘도 곧바로 끝난다 — 기다리는 코드를 아예 지나지 않기 때문이다.
    const second = sendFile({
      ch: rig.net.ch,
      file: blob(200),
      meta: { ...META, id: "f2", size: 200 },
      batch: "batch-1",
      tracker: new AckTracker("f2", 200, performance.now()),
      session: rig.session,
      onProgress: () => {},
      timing: { grace: 60_000, dead: 60_000, poll: 1000 },
    });
    await expect(second).resolves.toBe("done");
  });

  it("hello로 안다고 해 놓고 한 장도 안 오면 완료가 아니라 오류다", async () => {
    // 유예(낙관 모드)는 **상대가 ack를 아는 판인지 모를 때만** 있는 문이다.
    // 안다고 들어 놓고 소식이 없으면 그건 예전 판이 아니라 멈춘 상대다 —
    // 여기서 done을 돌려주면 고치려던 그 거짓말("완료"인데 상대는 못 받았다)이 그대로 산다.
    const rig = sendRig(200);
    rig.session.noteHello(true);
    await expect(rig.run({ timing: { grace: 20, dead: 60, poll: 3 } })).rejects.toThrow();
    // 예전 판으로 오해하지도 않는다 — "확인 없음" 배지는 뜨면 안 된다.
    expect(rig.session.peerAcks).toBe(true);
  });

  it("늦게라도 ack가 오면 그 판단이 뒤집힌다", async () => {
    const rig = sendRig(200);
    const p = rig.run({ timing: { grace: 5000, dead: 5000, poll: 3 } });
    await until(() => rig.net.has("eof"));
    rig.tracker.apply(200, true, performance.now());
    await expect(p).resolves.toBe("done");
    expect(rig.session.peerAcks).toBeNull(); // 포기하지 않았다
  });
});

describe("송신 — 멈춘 상대와 느린 디스크를 가른다", () => {
  it("오던 ack가 끊기면 시한 뒤에 오류가 된다", async () => {
    const rig = sendRig(200);
    rig.session.noteHello(true);
    const p = rig.run({ timing: { grace: 5000, dead: 40, poll: 3 } });
    await until(() => rig.net.has("eof"));
    rig.tracker.apply(100, false, performance.now()); // 여기까지만 말하고 상대가 죽는다
    await expect(p).rejects.toThrow();
  });

  it("파일 한가운데서 접을 때는 상대에게 알린다 (쓰다 만 파일을 열어 둔 채 두지 않는다)", async () => {
    // eof 전에 접으면 받는 쪽은 아직 그 파일을 열어 두고 있다. 취소 프레임 없이 접으면
    // 반쪽 파일이 디스크에 남고 화면은 영영 "받는 중"이다.
    const rig = sendRig(4 * CHUNK);
    rig.session.noteHello(true);
    await expect(rig.run({ timing: { grace: 5000, dead: 0, poll: 3 } })).rejects.toThrow();
    expect(rig.net.has("eof")).toBe(false); // 끝까지 못 갔다
    expect(rig.net.has("cancel")).toBe(true);
  });

  it("상대가 세워 둔 동안(flow)은 침묵으로 세지 않는다", async () => {
    const rig = sendRig(200);
    rig.session.noteHello(true);
    const gate = new FlowGate();
    gate.pause();
    const p = rig.run({ gate, timing: { grace: 5000, dead: 40, poll: 3 } });
    await delay(120); // 시한을 훌쩍 넘겨 멈춰 있는다
    gate.resume();
    await until(() => rig.net.has("eof"));
    rig.tracker.apply(200, true, performance.now());
    await expect(p).resolves.toBe("done");
  });

  it("중단하면 cancel 프레임을 남기고 접는다", async () => {
    const rig = sendRig(200);
    rig.session.noteHello(true);
    const ctl = new AbortController();
    ctl.abort();
    await expect(rig.run({ signal: ctl.signal })).resolves.toBe("cancelled");
    expect(rig.net.frames().map((f) => f.t)).toEqual(["cancel"]);
  });

  it("확인을 기다리는 중에 중단해도 접힌다 (완료를 기다리다 갇히지 않는다)", async () => {
    const rig = sendRig(200);
    rig.session.noteHello(true);
    const ctl = new AbortController();
    const p = rig.run({ signal: ctl.signal, timing: { grace: 5000, dead: 5000, poll: 3 } });
    await until(() => rig.net.has("eof"));
    ctl.abort();
    await expect(p).resolves.toBe("cancelled");
    expect(rig.net.has("cancel")).toBe(true);
  });
});

// ── 양쪽을 이어 본다 ────────────────────────────────────────────────

describe("한 바퀴 — 보낸 쪽의 '완료'는 받은 쪽이 파일을 닫은 뒤다", () => {
  it("청크 → 디스크 → ack → 완료가 실제로 이어진다", async () => {
    const size = 5 * CHUNK;
    const meta: FileMeta = { id: "f1", name: "a.bin", size, mime: "" };
    const session = new AckSession();
    session.noteHello(true);
    const tracker = new AckTracker(meta.id, size, performance.now());
    const sink = fakeSink();
    let closedAt = -1;
    sink.sink.close = async () => {
      closedAt = sink.writes.reduce((a, b) => a + b, 0);
      return null;
    };

    // 보내는 쪽의 수신기 — 돌아오는 ack가 여기로 들어와 장부에 앉는다.
    const back = new Receiver(
      events({
        onPeerAck: (id, n, fin) => {
          if (id === meta.id) tracker.apply(n, fin, performance.now());
        },
      }),
    );
    // 받는 쪽 — 디스크에 앉힌 만큼을 ack 프레임으로 되돌려 보낸다.
    const rx = new Receiver(
      events({
        onAckDue: (id, n, fin) => back.handle(encodeFrame(make.ack(id, n, fin))),
      }),
    );
    rx.accept("batch-1", async () => sink.sink);

    const net = fakeChannel((data) => rx.handle(data));
    const result = await sendFile({
      ch: net.ch,
      file: blob(size),
      meta,
      batch: "batch-1",
      tracker,
      session,
      onProgress: () => {},
      timing: { grace: 5000, dead: 5000, poll: 3 },
    });

    expect(result).toBe("done");
    expect(closedAt).toBe(size); // 다 쓰고 닫았다
    expect(tracker.acked).toBe(size);
    expect(tracker.complete).toBe(true);
  });
});
