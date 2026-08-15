/** 드롭의 전송 단계 기계 — 수락·청크·eof·ack·취소가 화면 상태로 어떻게 옮겨지는가.
 *
 * 프레임·ack 장부·`sendFile`·`Receiver`의 규격은 `tests/drop-transfer.test.ts`에 있다.
 * 이 파일이 재는 것은 `state.svelte.ts`가 그 부품을 그렇게 배선했는지다. 규격이 맞아도
 * 배선이 틀릴 수 있다 — `AckBook`이 모르는 id의 ack를 버려도, 화면이 장부를 안 거치고
 * 진행률을 쓰면 늦은 ack가 다음 파일에 얹힌다.
 *
 * 재는 자리는 CLAUDE.md 26번이다.
 *   · 취소 프레임은 **양방향 멱등**이다. 한쪽만 정리하면 상대가 영원히 기다린다.
 *   · 취소 뒤 남아서 도착하는 청크·ack가 다음 파일에 섞이면 받은 파일이 깨진다.
 *   · 진행률·완료는 상대의 `ack` 기준이다 — 데이터 채널에 건넨 바이트가 아니다.
 *
 * ## 부르는 방법
 *
 * `RTCPeerConnection`은 node에 없다. `rtc/peer`를 이중체로 갈아 끼우고, 상태 기계가
 * 스스로 세우는 배선(`makePeer`)은 **진짜 것을 그대로 쓴다** — 재려는 것이 그 배선이라서다.
 * 그래서 시그널링(SDP·QR·랑데부)은 지나지 않고, 채널이 열린 순간부터 시작한다.
 *
 * 상대는 프레임 한 장씩으로 흉내 낸다: `deliver()`는 상대가 보낸 프레임, `sent()`는 이쪽이
 * 내보낸 프레임이다. 둘 다 `frames.ts`를 지난다 — 문자열을 손으로 적으면 오타 하나가
 * 조용히 버려지는 프레임이 된다.
 *
 * 화면 갱신 타이머(`window.setInterval`)는 흉내 낸 시계다 — 250ms를 기다리지 않고
 * `runTick()`으로 한 박자씩 돌린다. 타이머가 켜지고 꺼지는 것도 같은 자리에서 잰다.
 *
 * ## 이 층이 재지 못하는 것
 *
 * · **연결 자체** — SDP 교환·ICE·랑데부·SPAKE2. 상대가 진짜 브라우저여야 한다.
 * · **디스크 스트리밍**(`showSaveFilePicker`). node에는 피커가 없어 언제나 메모리 폴백을
 *   탄다 — 그 갈래는 여기서 늘 켜져 있다.
 * · **시한**(예전 판 상대 20초 유예, 멈춘 상대 30초). 실시간을 그만큼 기다릴 수 없어
 *   `sendFile`에 시계를 넣어 재는 1층의 몫으로 남긴다.
 * · **백프레셔의 실제 동작** — 이중체의 `bufferedAmount`는 늘 0이다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileMeta, Frame } from "../apps/drop/src/lib/rtc/frames";

// ── 브라우저 자리 메우기 ────────────────────────────────────────────────

const globals = globalThis as unknown as Record<string, unknown>;

/** 흉내 낸 250ms 시계 — 돌리는 것은 `runTick()`이다. */
const intervals = new Map<number, () => void>();
/** 시계를 걸 때 앱이 적어 낸 주기(ms). 속도·남은 시간이 이 간격을 표본 주기로 삼는다. */
const tickPeriods: number[] = [];
let nextTimerId = 1;

globals.document = {
  addEventListener: (): void => {},
  removeEventListener: (): void => {},
  visibilityState: "visible",
  createElement: () => {
    const anchor = {
      href: "",
      download: "",
      click: (): void => {
        downloads.push({ name: anchor.download, blob: lastBlob });
      },
      remove: (): void => {},
    };
    return anchor;
  },
  body: { appendChild: (): void => {} },
};

// `canStreamToDisk()`가 여기서 `showSaveFilePicker`를 찾는다. 없으므로 메모리 폴백이다.
globals.window = {
  setInterval: (fn: () => void, ms?: number): number => {
    const id = nextTimerId++;
    intervals.set(id, fn);
    tickPeriods.push(ms ?? 0);
    return id;
  },
  clearInterval: (id: number): void => {
    intervals.delete(id);
  },
  setTimeout: (fn: () => void, ms?: number): number =>
    setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number): void => clearTimeout(id),
  addEventListener: (): void => {},
  removeEventListener: (): void => {},
};

/** 내려받은 것 — 메모리 폴백으로 받은 파일이 `<a download>`로 나가는 자리. */
const downloads: { name: string; blob: Blob | null }[] = [];
let lastBlob: Blob | null = null;

globals.URL = Object.assign(globalThis.URL, {
  createObjectURL: (blob: Blob): string => {
    lastBlob = blob;
    return "blob:drop-test";
  },
  revokeObjectURL: (): void => {},
});

// ── 피어 이중체 ─────────────────────────────────────────────────────────

interface PeerEvents {
  onOpen(): void;
  onDown(wasConnected: boolean): void;
  onMessage(data: string | ArrayBuffer): void;
}

/** 마지막으로 세워진 피어. 상태 기계가 `makePeer()`로 만든 것을 여기서 붙잡는다. */
let peer: FakePeer;

class FakePeer {
  /** 채널로 내보낸 것 — 제어 프레임과 청크가 섞여 있다. */
  readonly out: (string | ArrayBuffer)[] = [];
  readonly channel: unknown;
  closed = false;

  constructor(readonly events: PeerEvents) {
    peer = this;
    const out = this.out;
    this.channel = {
      readyState: "open",
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      send(data: string | ArrayBuffer): void {
        out.push(data);
      },
      addEventListener(): void {},
      removeEventListener(): void {},
    };
  }

  createOffer(): Promise<string> {
    return Promise.resolve("offer-sdp");
  }
  answer(): Promise<string> {
    return Promise.resolve("answer-sdp");
  }
  accept(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {
    this.closed = true;
  }
}

vi.mock("../apps/drop/src/lib/rtc/peer", () => ({ DropPeer: FakePeer }));

const { drop } = await import("../apps/drop/src/lib/editor/state.svelte");
const { encodeFrame, make, parseFrame } = await import("../apps/drop/src/lib/rtc/frames");

// ── 도우미 ──────────────────────────────────────────────────────────────

/** 상태 기계 안쪽 — 이중체를 끼우고 수신 줄이 비기를 기다리는 데만 쓴다. */
const inner = drop as unknown as {
  makePeer(): FakePeer;
  peer: FakePeer | null;
  receiver: { idle(): Promise<void> } | null;
};

/** 채널이 열린 상태로 만든다. 시그널링은 지나지 않는다. */
function connect(): void {
  const made = inner.makePeer();
  inner.peer = made;
  made.events.onOpen();
}

/** 상대가 보낸 제어 프레임. */
function deliver(frame: Frame): void {
  peer.events.onMessage(encodeFrame(frame));
}

/** 상대가 보낸 파일 청크. */
function deliverChunk(size: number): void {
  peer.events.onMessage(new Uint8Array(size).buffer);
}

/** 내보낸 제어 프레임만 순서대로. */
function sent(): Frame[] {
  return peer.out
    .filter((x): x is string => typeof x === "string")
    .map((x) => parseFrame(x))
    .filter((x): x is Frame => x !== null);
}

/** 내보낸 청크의 크기 목록. */
function sentChunks(): number[] {
  return peer.out
    .filter((x): x is ArrayBuffer => typeof x !== "string")
    .map((x) => x.byteLength);
}

/** 수신 줄(쓰기·열기·닫기)이 다 끝날 때까지. */
async function settle(): Promise<void> {
  await inner.receiver?.idle();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** 화면 갱신 시계를 한 박자 돌린다 — `tick()`이 계량기를 화면 값으로 옮기는 자리. */
function runTick(): void {
  for (const fn of [...intervals.values()]) fn();
}

/** 조건이 참이 될 때까지. 송신 루프의 어느 순간을 붙잡는 자리에서만 쓴다. */
async function waitFor(fn: () => boolean, label: string, ms = 3000): Promise<void> {
  const limit = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > limit) throw new Error(`기다리던 일이 일어나지 않았다: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const meta = (id: string, size: number, name = `${id}.bin`): FileMeta => ({
  id,
  name,
  size,
  mime: "application/octet-stream",
});

/** 목록을 한 줄로 — 이름·방향·상태·진행. */
function list(): [string, string, string, number][] {
  return drop.transfers.map((item) => [item.name, item.dir, item.status, item.done]);
}

/**
 * 상대가 묶음을 보내겠다고 알리고, 우리가 받기를 누른 상태까지.
 * 받기는 저장 위치를 묻는 약속을 기다리므로 그 약속이 풀릴 때까지 양보한다.
 */
async function acceptBatch(batch: string, files: FileMeta[]): Promise<void> {
  deliver(make.offer(batch, files));
  drop.acceptIncoming();
  await settle();
}

/** 보낼 파일 하나 — 내용은 0으로 채운다(바이트 값은 이 층이 재는 것이 아니다). */
function outgoing(name: string, size: number): File {
  return new File([new Uint8Array(size) as BlobPart], name);
}

/** 묶음 안에서 우리가 지은 파일 id를 읽기 좋게 바꾼다. 배선은 id를 id로만 다뤄야 한다. */
let uuidCount = 0;

/** 방금 내보낸 묶음 id — 상대의 답에 그대로 실어 돌려준다. */
function myBatch(): string {
  const offer = sent().find((f) => f.t === "offer");
  if (!offer || offer.t !== "offer") throw new Error("아직 묶음을 안 알렸다");
  return offer.batch;
}

/** 파일 하나를 수락까지 받아 끝까지 밀어 넣는다(확인은 아직 안 왔다). */
async function sendOne(name: string, size: number): Promise<void> {
  drop.sendFiles([outgoing(name, size)]);
  await waitFor(() => sent().some((f) => f.t === "offer"), "offer가 나가기");
  deliver(make.accept(myBatch()));
  await waitFor(() => sent().some((f) => f.t === "eof"), "eof가 나가기");
}

/** 파일 둘을 수락까지 받는다. 첫 파일은 다 나가고 확인을 기다리는 상태가 된다. */
async function sendTwo(): Promise<void> {
  drop.sendFiles([outgoing("가.bin", 40), outgoing("나.bin", 30)]);
  await waitFor(() => sent().some((f) => f.t === "offer"), "offer가 나가기");
  deliver(make.accept(myBatch()));
  await waitFor(() => drop.transfers[0].settling, "첫 파일이 확인을 기다리기");
}

beforeEach(() => {
  drop.reset();
  downloads.length = 0;
  intervals.clear();
  tickPeriods.length = 0;
  uuidCount = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    uuidCount += 1;
    return `id-${uuidCount}` as ReturnType<Crypto["randomUUID"]>;
  });
});

afterEach(() => {
  // 확인을 기다리며 도는 송신 루프가 남지 않게 먼저 접는다.
  drop.reset();
  vi.restoreAllMocks();
});

// ── ① 채널이 열린 순간 ──────────────────────────────────────────────────

describe("채널이 열리면 능력부터 알린다", () => {
  it("첫 프레임은 hello다 — ordered라 상대의 수락보다 먼저 도착한다", () => {
    connect();
    expect(drop.stage).toBe("connected");
    expect(sent()[0]).toEqual({ v: 1, t: "hello", ack: true });
  });

  it("상대가 어떤 판인지 모를 때는 건넨 바이트로라도 막대를 그린다 — 0에 붙어 있는 것보다 낫다", async () => {
    connect(); // hello를 안 받았다. 상대가 확인해 주는 판인지 아직 모른다.
    await sendOne("사진.jpg", 100);
    runTick();
    expect(drop.transfers[0].done).toBe(100);
  });

  it("상대가 확인해 주는 판이면 건넨 바이트는 진행률이 아니다", async () => {
    connect();
    deliver(make.hello(true));
    await sendOne("사진.jpg", 100);
    runTick();
    expect(drop.transfers[0].done).toBe(0);
  });
});

// ── ② 받는 쪽 — 수락해야 한 바이트도 앉는다 ─────────────────────────────

describe("묻지 않고 남의 파일이 디스크에 앉지 않는다", () => {
  beforeEach(() => {
    connect();
  });

  it("묶음이 오면 사용자에게 물을 뿐, 아무 답도 안 나간다", () => {
    deliver(make.offer("b1", [meta("f1", 10)]));
    expect(drop.incoming).toEqual({ batch: "b1", files: [meta("f1", 10)] });
    expect(sent().map((f) => f.t)).toEqual(["hello"]);
  });

  it("수락하기 전에 온 파일과 청크는 갈 곳이 없다", async () => {
    deliver(make.offer("b1", [meta("f1", 10)]));
    deliver(make.file("b1", meta("f1", 10)));
    deliverChunk(10);
    deliver(make.eof("f1"));
    await settle();

    expect(drop.transfers).toEqual([]);
    expect(sent().some((f) => f.t === "ack")).toBe(false);
  });

  it("받기를 누르면 accept가 나가고, 저장 위치를 못 정했으면 메모리로 물러난다", async () => {
    await acceptBatch("b1", [meta("f1", 10)]);
    expect(sent().map((f) => f.t)).toEqual(["hello", "accept"]);
    expect(drop.memoryFallback).toBe(true);
    expect(drop.incoming).toBe(null);
  });

  it("거절하면 decline만 나가고 그 묶음의 파일은 받지 않는다", async () => {
    deliver(make.offer("b1", [meta("f1", 10)]));
    drop.declineIncoming();
    deliver(make.file("b1", meta("f1", 10)));
    deliverChunk(10);
    await settle();

    expect(sent().map((f) => f.t)).toEqual(["hello", "decline"]);
    expect(drop.transfers).toEqual([]);
  });

  it("한 번에 한 묶음씩만 묻는다 — 답을 줘야 다음 카드가 올라온다", async () => {
    deliver(make.offer("b1", [meta("f1", 10)]));
    deliver(make.offer("b2", [meta("f2", 20)]));
    expect(drop.incoming?.batch).toBe("b1");

    drop.acceptIncoming();
    await settle();
    expect(drop.incoming?.batch).toBe("b2");
  });

  it("상대가 묶음을 거둬들이면 묻던 카드가 내려간다 — 오지 않을 파일을 기다리지 않는다", () => {
    deliver(make.offer("b1", [meta("f1", 10)]));
    deliver(make.withdraw("b1"));
    expect(drop.incoming).toBe(null);
  });

  it("줄에서 순서를 기다리던 묶음도 거둬들이면 올라오지 않는다", async () => {
    deliver(make.offer("b1", [meta("f1", 10)]));
    deliver(make.offer("b2", [meta("f2", 20)]));
    deliver(make.withdraw("b2"));

    drop.acceptIncoming();
    await settle();
    expect(drop.incoming).toBe(null);
  });
});

// ── ③ 받는 쪽 — 한 바퀴 ─────────────────────────────────────────────────

describe("수락 → 청크 → eof → 최종 ack → 완료", () => {
  beforeEach(async () => {
    connect();
    await acceptBatch("b1", [meta("f1", 300)]);
  });

  it("파일이 시작되면 목록에 받는 항목이 선다", async () => {
    deliver(make.file("b1", meta("f1", 300)));
    await settle();
    expect(list()).toEqual([["f1.bin", "in", "active", 0]]);
  });

  it("디스크에 앉은 만큼이 진행률이 되고, 마지막에 최종 ack가 나간다", async () => {
    deliver(make.file("b1", meta("f1", 300)));
    deliverChunk(100);
    deliverChunk(200);
    await settle();
    runTick();
    expect(drop.transfers[0].done).toBe(300);

    deliver(make.eof("f1"));
    await settle();

    const acks = sent().filter((f) => f.t === "ack");
    expect(acks[acks.length - 1]).toEqual({ v: 1, t: "ack", id: "f1", n: 300, fin: true });
    expect(list()).toEqual([["f1.bin", "in", "done", 300]]);
  });

  it("메모리로 받은 파일은 곧바로 내려받힌다 — 디스크로 흘렸으면 이미 앉아 있을 자리다", async () => {
    deliver(make.file("b1", meta("f1", 300)));
    deliverChunk(300);
    deliver(make.eof("f1"));
    await settle();

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("f1.bin");
    expect(downloads[0].blob?.size).toBe(300);
    expect(drop.transfers[0].blob?.size).toBe(300);
  });

  it("전송이 도는 동안에만 화면 시계가 돈다", async () => {
    expect(intervals.size).toBe(0);
    deliver(make.file("b1", meta("f1", 300)));
    await settle();
    expect(intervals.size).toBe(1);

    deliverChunk(300);
    deliver(make.eof("f1"));
    await settle();
    expect(intervals.size).toBe(0);
  });

  it("시계 주기는 250ms다 — 속도와 남은 시간이 이 간격을 표본 하나로 센다", async () => {
    deliver(make.file("b1", meta("f1", 300)));
    await settle();
    expect(tickPeriods).toEqual([250]);
  });

  it("상대가 글을 보내면 목록에 그대로 들어온다", () => {
    deliver(make.text("안녕하세요"));
    expect(list()).toEqual([["", "in", "done", 0]]);
    expect(drop.transfers[0].body).toBe("안녕하세요");
  });
});

// ── ④ 받는 쪽 — 취소 (CLAUDE.md 26번) ───────────────────────────────────

describe("받다가 접으면 양쪽이 같이 정리한다", () => {
  beforeEach(async () => {
    connect();
    await acceptBatch("b1", [meta("f1", 300), meta("f2", 50)]);
    deliver(make.file("b1", meta("f1", 300)));
    deliverChunk(100);
    await settle();
  });

  it("내가 접으면 상대에게도 알린다 — 안 그러면 상대 쪽이 갈 곳 없는 바이트를 끝까지 밀어 넣는다", async () => {
    drop.cancelTransfer("f1");
    await settle();

    expect(sent().filter((f) => f.t === "cancel")).toEqual([{ v: 1, t: "cancel", id: "f1" }]);
    expect(list()).toEqual([["f1.bin", "in", "cancelled", 0]]);
  });

  it("접은 파일에는 최종 ack를 보내지 않는다 — 보내면 상대가 그 파일을 완료로 센다", async () => {
    drop.cancelTransfer("f1");
    deliver(make.eof("f1"));
    await settle();

    expect(sent().some((f) => f.t === "ack" && f.fin)).toBe(false);
    expect(downloads).toEqual([]);
  });

  it("취소 뒤 늦게 온 청크가 다음 파일에 섞이지 않는다 — 섞이면 받은 파일이 깨진다", async () => {
    drop.cancelTransfer("f1");
    await settle();
    // 상대의 송신 루프가 멈추기 전에 밀어 넣은 청크. ack 문턱(256KB)을 넘겨서
    // 버려지지 않고 앉았다면 그 사실이 ack로 새어 나오게 한다.
    deliverChunk(200 * 1024);
    deliverChunk(200 * 1024);
    await settle();
    expect(sent().filter((f) => f.t === "ack")).toEqual([]);

    deliver(make.file("b1", meta("f2", 50)));
    deliverChunk(50);
    deliver(make.eof("f2"));
    await settle();

    const second = drop.transfers.find((item) => item.id === "f2");
    expect(second?.done).toBe(50);
    expect(second?.blob?.size).toBe(50);
    expect(sent().filter((f) => f.t === "ack")).toEqual([
      { v: 1, t: "ack", id: "f2", n: 50, fin: true },
    ]);
  });

  it("상대가 보낸 취소도 같은 자리를 정리한다", async () => {
    deliver(make.cancel("f1"));
    await settle();
    expect(list()).toEqual([["f1.bin", "in", "cancelled", 0]]);
  });

  it("이미 접은 파일에 취소가 또 와도 아무 일이 없다 — 양방향 멱등이다", async () => {
    drop.cancelTransfer("f1");
    await settle();
    const before = list();

    deliver(make.cancel("f1"));
    deliver(make.cancel("f1"));
    await settle();

    expect(list()).toEqual(before);
    expect(sent().filter((f) => f.t === "cancel")).toHaveLength(1);
  });

  it("연결이 끊기면 돌던 것도 기다리던 것도 접힌다", async () => {
    peer.events.onDown(true);
    await settle();

    expect(drop.stage).toBe("closed");
    expect(list()).toEqual([["f1.bin", "in", "error", 0]]);
    expect(drop.incoming).toBe(null);
    expect(intervals.size).toBe(0);
  });
});

// ── ⑤ 보내는 쪽 — 수락을 받아야 한 바이트도 나간다 ──────────────────────

describe("보내는 쪽은 목록을 먼저 알리고 답을 기다린다", () => {
  beforeEach(() => {
    connect();
    deliver(make.hello(true));
  });

  it("offer가 먼저 나가고, 답이 오기 전에는 한 바이트도 안 나간다", async () => {
    drop.sendFiles([outgoing("사진.jpg", 100)]);
    await settle();

    const frames = sent();
    expect(frames.map((f) => f.t)).toEqual(["hello", "offer"]);
    expect(sentChunks()).toEqual([]);
    expect(list()).toEqual([["사진.jpg", "out", "waiting", 0]]);
  });

  it("수락하면 file → 청크 → eof 순으로 나간다", async () => {
    await sendOne("사진.jpg", 100);
    expect(sent().map((f) => f.t)).toEqual(["hello", "offer", "file", "eof"]);
    expect(sentChunks()).toEqual([100]);
  });

  it("확인이 오기 전에는 '기다리는 중'이지 완료가 아니다", async () => {
    await sendOne("사진.jpg", 100);
    runTick();
    // 청크는 이미 다 나갔지만 상대가 확인해 준 것은 아직 없다.
    expect(drop.transfers[0].done).toBe(0);
    expect(drop.transfers[0].settling).toBe(true);
    expect(drop.transfers[0].status).toBe("active");

    deliver(make.ack(drop.transfers[0].id, 60, false));
    runTick();
    expect(drop.transfers[0].done).toBe(60);
    expect(drop.transfers[0].status).toBe("active");
  });

  it("완료는 상대가 파일을 닫은 뒤 오는 최종 ack다", async () => {
    await sendOne("사진.jpg", 100);
    deliver(make.ack(drop.transfers[0].id, 100, true));
    await waitFor(() => drop.transfers[0].status === "done", "최종 ack로 완료되기");

    expect(list()).toEqual([["사진.jpg", "out", "done", 100]]);
    expect(drop.transfers[0].settling).toBe(false);
  });

  it("거절하면 기다리던 항목이 한꺼번에 접힌다", async () => {
    drop.sendFiles([outgoing("가.bin", 10), outgoing("나.bin", 20)]);
    await waitFor(() => sent().some((f) => f.t === "offer"), "offer가 나가기");
    deliver(make.decline(myBatch()));
    await waitFor(() => drop.transfers.every((x) => x.status === "cancelled"), "거절이 반영되기");

    expect(list()).toEqual([
      ["가.bin", "out", "cancelled", 0],
      ["나.bin", "out", "cancelled", 0],
    ]);
    expect(sentChunks()).toEqual([]);
  });

  it("보낼 것을 남김없이 취소하면 묶음을 거둬들인다 — 상대가 오지 않을 카드를 보고 있지 않게", async () => {
    drop.sendFiles([outgoing("가.bin", 10)]);
    await waitFor(() => sent().some((f) => f.t === "offer"), "offer가 나가기");

    drop.cancelTransfer(drop.transfers[0].id);
    await waitFor(() => sent().some((f) => f.t === "withdraw"), "묶음을 거두기");
    expect(list()).toEqual([["가.bin", "out", "cancelled", 0]]);
  });

  it("거둬들인 묶음 뒤로 다음 묶음이 이어서 나간다 — 송신 줄이 막히지 않는다", async () => {
    drop.sendFiles([outgoing("가.bin", 10)]);
    await waitFor(() => sent().some((f) => f.t === "offer"), "첫 offer");
    drop.cancelTransfer(drop.transfers[0].id);

    drop.sendFiles([outgoing("나.bin", 20)]);
    await waitFor(() => sent().filter((f) => f.t === "offer").length === 2, "둘째 offer");
    const offers = sent().filter((f) => f.t === "offer") as { files: FileMeta[] }[];
    expect(offers[1].files.map((f) => f.name)).toEqual(["나.bin"]);
  });

  it("내가 보낸 글은 프레임과 목록에 함께 남는다", () => {
    drop.sendTextMsg("  안녕  ");
    expect(sent().filter((f) => f.t === "text")).toEqual([
      { v: 1, t: "text", body: "안녕" },
    ]);
    expect(list()).toEqual([["", "out", "done", 0]]);
  });

  it("빈 글은 보내지 않는다", () => {
    drop.sendTextMsg("   ");
    expect(sent().some((f) => f.t === "text")).toBe(false);
    expect(drop.transfers).toEqual([]);
  });
});

// ── ⑥ 보내는 쪽 — 취소와 늦은 ack (CLAUDE.md 26번) ──────────────────────

describe("취소한 파일의 늦은 ack는 다음 파일에 얹히지 않는다", () => {
  beforeEach(() => {
    connect();
    deliver(make.hello(true));
  });

  it("확인을 기다리는 중에 접으면 cancel을 남기고 다음 파일로 넘어간다", async () => {
    await sendTwo();
    const first = drop.transfers[0].id;
    drop.cancelTransfer(first);
    await waitFor(() => drop.transfers[1].status === "active", "둘째 파일이 시작되기");

    expect(sent().filter((f) => f.t === "cancel")).toEqual([{ v: 1, t: "cancel", id: first }]);
    expect(drop.transfers[0].status).toBe("cancelled");
  });

  it("접은 파일 앞으로 온 ack는 갈 곳이 없다 — 다음 파일의 막대가 저 혼자 뛰지 않는다", async () => {
    await sendTwo();
    const [first, second] = drop.transfers.map((item) => item.id);
    drop.cancelTransfer(first);
    await waitFor(() => drop.transfers[1].status === "active", "둘째 파일이 시작되기");

    // 상대의 송신 확인이 뒤늦게 도착했다. 첫 파일 것이므로 아무것도 건드리면 안 된다.
    deliver(make.ack(first, 1_000_000, true));
    runTick();
    expect(drop.transfers[0].done).toBe(0);
    expect(drop.transfers[1].done).toBe(0);

    // 둘째 파일의 ack만 둘째 파일을 움직인다.
    deliver(make.ack(second, 30, false));
    runTick();
    expect(drop.transfers[1].done).toBe(30);
  });

  it("모르는 id의 ack도 조용히 버린다 — 상대가 지어낸 id 포함", async () => {
    await sendOne("사진.jpg", 100);
    deliver(make.ack("있지도 않은 id", 999, true));
    runTick();
    expect(drop.transfers[0].done).toBe(0);
    expect(drop.transfers[0].status).toBe("active");
  });
});

// ── ⑦ 목록 정리 ─────────────────────────────────────────────────────────

describe("목록 정리", () => {
  it("끝난 것만 걷어내고 도는 것은 남긴다", async () => {
    connect();
    await acceptBatch("b1", [meta("f1", 50), meta("f2", 50)]);
    deliver(make.file("b1", meta("f1", 50)));
    deliverChunk(50);
    deliver(make.eof("f1"));
    await settle();
    deliver(make.file("b1", meta("f2", 50)));
    await settle();

    drop.clearFinished();
    expect(list()).toEqual([["f2.bin", "in", "active", 0]]);
  });

  it("다시 시작하면 목록도 시계도 비워진다", async () => {
    connect();
    await acceptBatch("b1", [meta("f1", 50)]);
    deliver(make.file("b1", meta("f1", 50)));
    await settle();
    expect(intervals.size).toBe(1);

    drop.reset();
    expect(drop.stage).toBe("idle");
    expect(drop.transfers).toEqual([]);
    expect(intervals.size).toBe(0);
  });
});
