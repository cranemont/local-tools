import { DropPeer } from "../rtc/peer";
import { encodeSignal, decodeSignal } from "../rtc/signal";
import { generateCode, hostRendezvous, joinRendezvous } from "../rtc/rendezvous";
import {
  FlowGate,
  Receiver,
  sendAccept,
  sendCancel,
  sendDecline,
  sendFile,
  sendFlow,
  sendOffer,
  sendText,
  sendWithdraw,
  type BatchOffer,
  type FileMeta,
} from "../rtc/transfer";
import { memorySink, pickDestination } from "../rtc/sink";
import { downloadBlob } from "../rtc/save";
import { t } from "../i18n";

export type Stage = "idle" | "host" | "guest" | "connecting" | "connected" | "failed" | "closed";

export interface TransferItem {
  id: string;
  kind: "file" | "text";
  dir: "in" | "out";
  name: string;
  size: number;
  done: number;
  /** waiting = 상대의 수락을 기다리는 중(아직 한 바이트도 안 나갔다) */
  status: "waiting" | "active" | "done" | "error" | "cancelled";
  /** 최근 구간 이동평균 속도(B/s). 정체 중이면 0. */
  rate: number;
  /** 몇 초째 한 바이트도 안 늘었다 */
  stalled: boolean;
  blob: Blob | null;
  body: string;
}

/** 화면 갱신 주기 — 64KB 청크마다 그리면 1GB 파일에 1만 6천 번이다. */
const TICK_MS = 250;
/** 이 시간 동안 진척이 없으면 정체로 본다. */
const STALL_MS = 3000;
/** 이동평균에서 새 표본이 갖는 몫 — 청크 단위로 재면 값이 튄다. */
const RATE_ALPHA = 0.3;
/** 연결이 붙기를 기다려 주는 시간. 넘으면 화면을 실패로 굳혀 탈출구를 준다. */
const CONNECT_TIMEOUT_MS = 30_000;

/** 항목별 진행 계량기. $state 밖(일반 객체)에 두어 청크마다 반응성을 건드리지 않는다. */
interface Meter {
  /** 콜백이 마지막으로 알려 온 값 */
  pending: number;
  /** 화면에 이미 반영한 값 */
  shown: number;
  /** 마지막 계산 시각 */
  at: number;
  /** 마지막으로 값이 늘어난 시각 */
  movedAt: number;
  rate: number;
}

class DropState {
  stage = $state<Stage>("idle");
  /** 상대에게 전달할 코드 — host면 청약, guest면 응답 */
  myCode = $state("");
  /** 숫자 6자리 짧은 코드 (Nostr 랑데부) */
  shortCode = $state("");
  rzStatus = $state<"idle" | "active" | "failed">("idle");
  /** 게스트가 짧은 코드로 참여해 응답을 올리고 연결을 기다리는 중 */
  joining = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);
  transfers = $state<TransferItem[]>([]);
  /** 상대가 보내겠다고 알려 온 묶음 — 사용자가 받기/거절을 고를 때까지 기다린다 */
  incoming = $state<BatchOffer | null>(null);
  /** 이번에 받은 것이 디스크가 아니라 메모리로 갔다(폴백) — 용량 주의를 띄운다 */
  memoryFallback = $state(false);

  private peer: DropPeer | null = null;
  private receiver: Receiver | null = null;
  private rzCancel: (() => void) | null = null;
  /** 한 채널에 파일 프레임이 섞이지 않도록 송신을 직렬화 */
  private sendChain: Promise<void> = Promise.resolve();
  /** 상대 디스크가 밀리면 닫히는 문 — 송신 루프가 여기서 기다린다 */
  private gate = new FlowGate();
  /** 아직 답을 못 받은 내 묶음들 */
  private verdicts = new Map<string, (accepted: boolean) => void>();
  /** 항목 → 그 항목이 속한 묶음 (묶음을 통째로 거둘 때 쓴다) */
  private itemBatch = new Map<string, string>();
  /** 답을 기다리는 상대 묶음들 — 한 번에 하나씩만 묻는다 */
  private offerQueue: BatchOffer[] = [];
  /** 보내는 중인 파일의 중단 스위치 — 취소는 여기를 끊는 것으로 시작한다 */
  private aborts = new Map<string, AbortController>();
  private meters = new Map<string, Meter>();
  private ticker: number | null = null;
  private connectTimer: number | null = null;
  private lock: WakeLockSentinel | null = null;
  private lockPending = false;

  constructor() {
    // 화면 잠금이 풀리며 wake lock도 함께 풀린다 — 돌아오면 다시 잡아야 한다.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.hasActive()) void this.acquireLock();
    });
  }

  private find(id: string): TransferItem | null {
    return this.transfers.find((x) => x.id === id) ?? null;
  }

  private hasActive(): boolean {
    return this.transfers.some((x) => x.status === "active");
  }

  private makePeer(): DropPeer {
    this.receiver = new Receiver({
      onOffer: (offer) => {
        this.offerQueue.push(offer);
        this.nextOffer();
      },
      onVerdict: (batch, accepted) => {
        const resolve = this.verdicts.get(batch);
        this.verdicts.delete(batch);
        resolve?.(accepted);
      },
      onWithdraw: (batch) => {
        this.offerQueue = this.offerQueue.filter((o) => o.batch !== batch);
        if (this.incoming?.batch === batch) this.incoming = null;
        this.nextOffer();
      },
      onStart: (meta) => {
        this.push({
          id: meta.id,
          kind: "file",
          dir: "in",
          name: meta.name,
          size: meta.size,
          done: 0,
          status: "active",
          rate: 0,
          stalled: false,
          blob: null,
          body: "",
        });
      },
      onProgress: (id, written) => this.meter(id, written),
      onDone: (id, blob) => {
        const item = this.find(id);
        if (!item) return;
        item.done = item.size;
        item.blob = blob;
        this.finish(item, "done");
        // blob이 있다는 것은 메모리 폴백으로 받았다는 뜻이다 — 그때만 표준 다운로드로 내린다.
        // 디스크 스트리밍이면 이미 사용자가 고른 자리에 앉아 있다.
        if (blob) downloadBlob(blob, item.name);
      },
      onError: (id) => {
        const item = this.find(id);
        if (item && item.status === "active") this.finish(item, "error");
        // 내 쪽이 접었으면 상대도 접어야 한다. 안 그러면 갈 곳 없는 바이트를 파일 끝까지
        // 밀어 넣고는 "완료"라고 말한다(취소 프레임은 양방향 멱등이라 겹쳐도 안전하다).
        const ch = this.peer?.channel;
        if (ch) sendCancel(ch, id);
      },
      // 내 디스크가 밀린다 → 상대를 세운다. 큐에 쌓으면 메모리 문제가 그대로 돌아온다.
      onCongest: (paused) => {
        const ch = this.peer?.channel;
        if (ch) sendFlow(ch, paused);
      },
      // 상대 디스크가 밀린다 → 내 송신 루프를 세운다.
      onFlow: (paused) => (paused ? this.gate.pause() : this.gate.resume()),
      onCancel: (id) => {
        // 상대가 끊었다. 내가 보내던 것이면 내 루프도 멈춘다(그 루프가 되돌려 보내는
        // 취소 프레임은 이미 정리된 상대 쪽에서 무시된다).
        this.aborts.get(id)?.abort();
        const item = this.find(id);
        if (item && item.status === "active") this.finish(item, "cancelled");
      },
      onText: (body) => {
        this.push({
          id: crypto.randomUUID(),
          kind: "text",
          dir: "in",
          name: "",
          size: 0,
          done: 0,
          status: "done",
          rate: 0,
          stalled: false,
          blob: null,
          body,
        });
      },
    });
    const receiver = this.receiver;
    return new DropPeer({
      onOpen: () => {
        this.rzCancel?.();
        this.rzCancel = null;
        this.clearConnectTimeout();
        this.joining = false;
        this.stage = "connected";
      },
      onDown: (wasConnected) => {
        this.clearConnectTimeout();
        // 기다리던 것들을 전부 접는다 — 한쪽만 정리하면 상대가 영원히 기다린다.
        void this.receiver?.close();
        this.incoming = null;
        this.offerQueue = [];
        for (const resolve of this.verdicts.values()) resolve(false);
        this.verdicts.clear();
        this.gate.resume();
        if (wasConnected || this.stage === "connected") this.stage = "closed";
        else if (this.stage === "connecting" || this.joining) {
          // 응답을 올리고 기다리던 게스트는 stage가 아직 "guest"다 — 여기서 끊지 않으면
          // 시한까지 방금 지운 뒤라 "연결하는 중…"에 갇힌다. 사유는 따로 없으니 비운다.
          this.joining = false;
          this.error = null;
          this.stage = "failed";
        }
        for (const item of this.transfers)
          if (item.status === "active" || item.status === "waiting") this.finish(item, "error");
      },
      onMessage: (data) => receiver.handle(data),
    });
  }

  // ── 진행 계량 ────────────────────────────────────────────────
  // 청크 콜백은 계량기에 값만 남기고, 화면에 쓰는 것은 250ms 타이머 한 곳이다.
  // 속도·남은 시간·정체 판정이 모두 같은 자리에서 나온다.

  private push(item: TransferItem): void {
    this.transfers.push(item);
    if (item.status === "active" || item.status === "waiting") {
      const now = performance.now();
      this.meters.set(item.id, { pending: 0, shown: 0, at: now, movedAt: now, rate: 0 });
    }
    this.syncActivity();
  }

  private meter(id: string, done: number): void {
    const m = this.meters.get(id);
    if (m) m.pending = done;
  }

  private finish(item: TransferItem, status: TransferItem["status"]): void {
    item.status = status;
    item.rate = 0;
    item.stalled = false;
    this.meters.delete(item.id);
    this.aborts.delete(item.id);
    this.syncActivity();
  }

  private tick(): void {
    const now = performance.now();
    for (const item of this.transfers) {
      if (item.status !== "active") continue;
      const m = this.meters.get(item.id);
      if (!m) continue;
      const moved = m.pending - m.shown;
      const dt = (now - m.at) / 1000;
      if (moved > 0 && dt > 0) {
        const inst = moved / dt;
        m.rate = m.rate === 0 ? inst : m.rate * (1 - RATE_ALPHA) + inst * RATE_ALPHA;
        m.shown = m.pending;
        m.movedAt = now;
        item.done = m.pending;
      }
      m.at = now;
      // 큐에서 순서를 기다리는 파일은 아직 한 바이트도 안 움직인 게 정상이다 —
      // 정체 판정은 첫 바이트가 나간 뒤부터 센다.
      if (m.pending === 0) m.movedAt = now;
      const stalled = now - m.movedAt > STALL_MS;
      if (stalled) m.rate = 0;
      if (item.stalled !== stalled) item.stalled = stalled;
      if (item.rate !== m.rate) item.rate = m.rate;
    }
  }

  /** 전송이 도는 동안에만 타이머·화면 잠금·이탈 경고를 켠다. */
  private syncActivity(): void {
    const active = this.hasActive();
    if (active && this.ticker === null) {
      this.ticker = window.setInterval(() => this.tick(), TICK_MS);
    } else if (!active && this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
    if (active) {
      void this.acquireLock();
      window.addEventListener("beforeunload", this.onBeforeUnload);
    } else {
      void this.releaseLock();
      window.removeEventListener("beforeunload", this.onBeforeUnload);
    }
  }

  /** 탭을 닫으면 양쪽 전송이 함께 죽는다 — 문구는 브라우저가 고른다. */
  private onBeforeUnload = (e: BeforeUnloadEvent): void => {
    e.preventDefault();
  };

  private async acquireLock(): Promise<void> {
    if (this.lock || this.lockPending || !navigator.wakeLock) return;
    this.lockPending = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => {
        if (this.lock === lock) this.lock = null;
      });
      this.lock = lock;
      // 기다리는 동안 전송이 끝났으면 곧바로 놓는다.
      if (!this.hasActive()) void this.releaseLock();
    } catch {
      // 정책·권한으로 거부될 수 있다. 전송은 그대로 진행한다.
    } finally {
      this.lockPending = false;
    }
  }

  private async releaseLock(): Promise<void> {
    const lock = this.lock;
    this.lock = null;
    try {
      await lock?.release();
    } catch {
      // 이미 풀린 경우
    }
  }

  // ── 연결 ────────────────────────────────────────────────────

  /** 연결이 붙기를 기다리는 구간마다 시한을 건다. */
  private armConnectTimeout(): void {
    this.clearConnectTimeout();
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.stage === "connected") return;
      this.rzCancel?.();
      this.rzCancel = null;
      this.peer?.close();
      this.peer = null;
      this.joining = false;
      this.busy = false;
      this.error = t.conn.timeout;
      this.stage = "failed";
    }, CONNECT_TIMEOUT_MS);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /** 호스트: 청약 생성 + 짧은 코드 랑데부 개시 */
  async startHost(): Promise<void> {
    this.error = null;
    this.busy = true;
    this.stage = "host";
    let sdp: string;
    try {
      this.peer = this.makePeer();
      sdp = await this.peer.createOffer();
      this.myCode = await encodeSignal(sdp);
    } catch {
      this.stage = "failed";
      this.busy = false;
      return;
    }
    this.busy = false;
    // 랑데부는 백그라운드 — 실패해도 QR·복붙 경로는 그대로 살아 있다
    this.shortCode = generateCode();
    try {
      this.rzCancel = await hostRendezvous(this.shortCode, sdp, (answer) => {
        void this.applyAnswer(answer);
      });
      this.rzStatus = "active";
    } catch {
      this.rzStatus = "failed";
    }
  }

  /** 게스트: 짧은 코드로 참여 — SPAKE2 왕복과 응답 발행까지 자동 */
  async joinWithCode(rawCode: string): Promise<void> {
    const code = rawCode.replace(/\D/g, "");
    if (code.length !== 6) return;
    this.error = null;
    this.busy = true;
    this.stage = "guest";
    try {
      await joinRendezvous(code, async (offerSdp) => {
        this.peer = this.makePeer();
        const answer = await this.peer.answer(offerSdp);
        this.joining = true;
        this.armConnectTimeout();
        return answer;
      });
    } catch (e) {
      this.joining = false;
      this.clearConnectTimeout();
      this.error = (e as Error).message === "no relay" ? t.rz.noRelay : t.rz.notFound;
      this.peer?.close();
      this.peer = null;
    }
    this.busy = false;
  }

  private async applyAnswer(sdp: string): Promise<void> {
    if (!this.peer || this.stage === "connecting" || this.stage === "connected") return;
    try {
      await this.peer.accept(sdp);
      this.stage = "connecting";
      this.armConnectTimeout();
    } catch {
      this.error = t.conn.badCode;
    }
  }

  /** 게스트 화면 진입 */
  startGuest(): void {
    this.error = null;
    this.myCode = "";
    this.stage = "guest";
  }

  /** URL #프래그먼트로 들어온 청약을 바로 처리 (QR 스캔 → 자동 진입) */
  async autoJoin(offerCode: string): Promise<void> {
    this.startGuest();
    await this.makeAnswer(offerCode);
  }

  /** 링크째 붙여넣어도 코드만 추려낸다 — base64url에는 #이 없다 */
  private stripUrl(code: string): string {
    const s = code.trim();
    const i = s.lastIndexOf("#");
    return i >= 0 ? s.slice(i + 1) : s;
  }

  /** 게스트: 청약 코드 → 응답 코드 생성 */
  async makeAnswer(offerCode: string): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      const sdp = await decodeSignal(this.stripUrl(offerCode));
      this.peer = this.makePeer();
      this.myCode = await encodeSignal(await this.peer.answer(sdp));
    } catch {
      this.error = t.conn.badCode;
      this.peer?.close();
      this.peer = null;
    }
    this.busy = false;
  }

  /** 호스트: 응답 코드 수동 적용 → 연결 시작 */
  async acceptAnswer(answerCode: string): Promise<void> {
    if (!this.peer) return;
    this.error = null;
    this.busy = true;
    try {
      await this.applyAnswer(await decodeSignal(this.stripUrl(answerCode)));
    } catch {
      this.error = t.conn.badCode;
    }
    this.busy = false;
  }

  // ── 전송: 받는 쪽의 수락 ─────────────────────────────────────────

  private nextOffer(): void {
    if (!this.incoming) this.incoming = this.offerQueue.shift() ?? null;
  }

  /**
   * 받기 — **이 호출은 클릭 핸들러에서 곧바로 와야 한다.**
   * 저장 위치를 묻는 피커는 사용자 제스처 안에서만 열리는데 청크는 제스처 없이
   * 도착한다. 그래서 이 클릭이 위치를 받아 둘 수 있는 유일한 순간이다.
   */
  acceptIncoming(): void {
    const offer = this.incoming;
    const ch = this.peer?.channel;
    if (!offer || !ch) return;
    // 앞에 await를 두면 브라우저가 피커를 막는다 — 첫 문장이어야 한다.
    const picked = pickDestination(offer.files);
    this.incoming = null;
    void picked.then((factory) => {
      // 위치를 못 정했으면(미지원·취소) 예전처럼 메모리에 모아 <a download>로 내린다.
      this.memoryFallback = factory === null;
      this.receiver?.accept(offer.batch, factory ?? memorySink);
      sendAccept(ch, offer.batch);
      this.nextOffer();
    });
  }

  declineIncoming(): void {
    const offer = this.incoming;
    if (!offer) return;
    const ch = this.peer?.channel;
    if (ch) sendDecline(ch, offer.batch);
    this.incoming = null;
    this.nextOffer();
  }

  // ── 보내는 쪽 ────────────────────────────────────────────────────

  sendFiles(files: File[]): void {
    const ch = this.peer?.channel;
    if (!ch) return;
    const batch = crypto.randomUUID();
    const metas: FileMeta[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mime: file.type,
    }));
    for (const meta of metas) {
      this.aborts.set(meta.id, new AbortController());
      this.itemBatch.set(meta.id, batch);
      this.push({
        id: meta.id,
        kind: "file",
        dir: "out",
        name: meta.name,
        size: meta.size,
        done: 0,
        status: "waiting",
        rate: 0,
        stalled: false,
        blob: null,
        body: "",
      });
    }
    // 묶음 하나가 끝나야 다음 묶음을 묻는다 — 수락 대화가 겹치지 않는다.
    this.sendChain = this.sendChain
      .then(() => this.runBatch(ch, batch, files, metas))
      .catch(() => {});
  }

  /** 목록을 먼저 알리고, 수락을 받은 뒤에야 파일을 하나씩 흘려보낸다. */
  private async runBatch(
    ch: RTCDataChannel,
    batch: string,
    files: File[],
    metas: FileMeta[],
  ): Promise<void> {
    // 줄에서 순서를 기다리는 동안 취소된 것은 묻지 않는다. 전부 취소됐다면 아예 묻지
    // 않는다 — 그러지 않으면 상대는 오지 않을 파일의 수락 카드를 보고 저장 위치까지 고른다.
    const live = metas.filter((m) => this.find(m.id)?.status === "waiting");
    if (!live.length) return;
    sendOffer(ch, batch, live);
    const accepted = await new Promise<boolean>((resolve) => {
      this.verdicts.set(batch, resolve);
    });
    if (!accepted) {
      for (const meta of metas) {
        const item = this.find(meta.id);
        if (item && item.status === "waiting") this.finish(item, "cancelled");
      }
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const meta = metas[i];
      const item = this.find(meta.id);
      if (!item || item.status !== "waiting") continue; // 기다리는 동안 취소됐다
      item.status = "active";
      // 수락을 기다린 시간은 전송 시간이 아니다 — 계량기를 지금부터 다시 센다.
      const m = this.meters.get(meta.id);
      if (m) m.at = m.movedAt = performance.now();
      this.syncActivity();
      try {
        const result = await sendFile(
          ch,
          files[i],
          meta,
          batch,
          (sent) => this.meter(meta.id, sent),
          this.aborts.get(meta.id)?.signal,
          this.gate,
        );
        if (item.status !== "active") continue;
        if (result === "done") item.done = item.size;
        this.finish(item, result === "done" ? "done" : "cancelled");
      } catch {
        if (item.status === "active") this.finish(item, "error");
      }
    }
  }

  /** 전송 중단 — 양쪽이 같이 정리해야 상대가 영원히 기다리지 않는다. */
  cancelTransfer(id: string): void {
    const item = this.find(id);
    if (!item || (item.status !== "active" && item.status !== "waiting")) return;
    const ctl = this.aborts.get(id);
    if (ctl) {
      // 보내는 중 — 루프가 빠져나오며 cancel 프레임을 보낸다. 큐에서 순서를 기다리는
      // 파일은 그 루프가 한참 뒤에 돌므로 화면은 지금 바로 바꾼다.
      ctl.abort();
      this.finish(item, "cancelled");
      this.abandonIfEmpty(id);
      return;
    }
    // 받는 중 — 내 조각을 버리고 상대 루프를 멈춘다
    const ch = this.peer?.channel;
    if (ch) sendCancel(ch, id);
    this.receiver?.discard(id);
    this.finish(item, "cancelled");
  }

  /**
   * 묶음에 기다리는 파일이 하나도 안 남았으면 통째로 거둔다.
   * 안 그러면 ① 상대는 오지 않을 파일의 수락 카드를 계속 보고 있고,
   * ② 내 송신 줄은 오지 않을 답을 기다리며 다음 묶음을 못 보낸다.
   */
  private abandonIfEmpty(itemId: string): void {
    const batch = this.itemBatch.get(itemId);
    if (!batch) return;
    for (const [id, b] of this.itemBatch)
      if (b === batch && this.find(id)?.status === "waiting") return;
    const resolve = this.verdicts.get(batch);
    if (!resolve) return; // 이미 수락·거절이 온 묶음
    this.verdicts.delete(batch);
    const ch = this.peer?.channel;
    if (ch) sendWithdraw(ch, batch);
    resolve(false);
  }

  sendTextMsg(body: string): void {
    const ch = this.peer?.channel;
    const text = body.trim();
    if (!ch || !text) return;
    sendText(ch, text);
    this.push({
      id: crypto.randomUUID(),
      kind: "text",
      dir: "out",
      name: "",
      size: 0,
      done: 0,
      status: "done",
      rate: 0,
      stalled: false,
      blob: null,
      body: text,
    });
  }

  saveItem(item: TransferItem): void {
    if (item.blob) downloadBlob(item.blob, item.name);
  }

  /** 끝난 항목만 목록에서 걷어낸다 — 받은 파일은 이미 저장된 뒤다. */
  clearFinished(): void {
    this.transfers = this.transfers.filter(
      (x) => x.status === "active" || x.status === "waiting",
    );
  }

  reset(): void {
    this.rzCancel?.();
    this.rzCancel = null;
    this.clearConnectTimeout();
    for (const ctl of this.aborts.values()) ctl.abort();
    this.aborts.clear();
    this.meters.clear();
    this.peer?.close();
    this.peer = null;
    // 받던 파일이 있으면 쓰다 만 것을 지우고 닫는다.
    void this.receiver?.close();
    this.receiver = null;
    this.sendChain = Promise.resolve();
    // 기다리던 묶음은 전부 거절로 접는다 — 안 그러면 송신 체인이 영영 매달린다.
    for (const resolve of this.verdicts.values()) resolve(false);
    this.verdicts.clear();
    this.offerQueue = [];
    this.itemBatch.clear();
    this.incoming = null;
    this.memoryFallback = false;
    this.gate = new FlowGate();
    this.stage = "idle";
    this.myCode = "";
    this.shortCode = "";
    this.rzStatus = "idle";
    this.joining = false;
    this.error = null;
    this.busy = false;
    this.transfers = [];
    this.syncActivity();
  }
}

export const drop = new DropState();
