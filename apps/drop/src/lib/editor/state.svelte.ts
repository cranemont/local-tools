import { DropPeer } from "../rtc/peer";
import { encodeSignal, decodeSignal } from "../rtc/signal";
import { generateCode, hostRendezvous, fetchOffer, publishAnswer } from "../rtc/rendezvous";
import { Receiver, sendFile, sendText } from "../rtc/transfer";
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
  status: "active" | "done" | "error";
  blob: Blob | null;
  body: string;
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

  private peer: DropPeer | null = null;
  private rzCancel: (() => void) | null = null;
  /** 한 채널에 파일 프레임이 섞이지 않도록 송신을 직렬화 */
  private sendChain: Promise<void> = Promise.resolve();

  private find(id: string): TransferItem | null {
    return this.transfers.find((x) => x.id === id) ?? null;
  }

  private makePeer(): DropPeer {
    const receiver = new Receiver({
      onStart: (meta) => {
        this.transfers.push({
          id: meta.id,
          kind: "file",
          dir: "in",
          name: meta.name,
          size: meta.size,
          done: 0,
          status: "active",
          blob: null,
          body: "",
        });
      },
      onProgress: (id, received) => {
        const item = this.find(id);
        if (item) item.done = received;
      },
      onDone: (id, blob) => {
        const item = this.find(id);
        if (!item) return;
        item.done = item.size;
        item.status = "done";
        item.blob = blob;
        // 자동 수락 — 받는 즉시 표준 다운로드로 저장
        downloadBlob(blob, item.name);
      },
      onText: (body) => {
        this.transfers.push({
          id: crypto.randomUUID(),
          kind: "text",
          dir: "in",
          name: "",
          size: 0,
          done: 0,
          status: "done",
          blob: null,
          body,
        });
      },
    });
    return new DropPeer({
      onOpen: () => {
        this.rzCancel?.();
        this.rzCancel = null;
        this.joining = false;
        this.stage = "connected";
      },
      onDown: (wasConnected) => {
        if (wasConnected || this.stage === "connected") this.stage = "closed";
        else if (this.stage === "connecting") this.stage = "failed";
        for (const item of this.transfers) if (item.status === "active") item.status = "error";
      },
      onMessage: (data) => receiver.handle(data),
    });
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

  /** 게스트: 짧은 코드로 참여 — 응답 발행까지 자동 */
  async joinWithCode(rawCode: string): Promise<void> {
    const code = rawCode.replace(/\D/g, "");
    if (code.length !== 6) return;
    this.error = null;
    this.busy = true;
    this.stage = "guest";
    try {
      const offer = await fetchOffer(code);
      this.peer = this.makePeer();
      const answer = await this.peer.answer(offer);
      this.joining = true;
      await publishAnswer(code, answer);
    } catch (e) {
      this.joining = false;
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

  sendFiles(files: File[]): void {
    const ch = this.peer?.channel;
    if (!ch) return;
    for (const file of files) {
      const id = crypto.randomUUID();
      this.transfers.push({
        id,
        kind: "file",
        dir: "out",
        name: file.name,
        size: file.size,
        done: 0,
        status: "active",
        blob: null,
        body: "",
      });
      this.sendChain = this.sendChain
        .then(() =>
          sendFile(ch, file, id, (sent) => {
            const item = this.find(id);
            if (item) item.done = sent;
          }),
        )
        .then(() => {
          const item = this.find(id);
          if (item) item.status = "done";
        })
        .catch(() => {
          const item = this.find(id);
          if (item && item.status === "active") item.status = "error";
        });
    }
  }

  sendTextMsg(body: string): void {
    const ch = this.peer?.channel;
    const text = body.trim();
    if (!ch || !text) return;
    sendText(ch, text);
    this.transfers.push({
      id: crypto.randomUUID(),
      kind: "text",
      dir: "out",
      name: "",
      size: 0,
      done: 0,
      status: "done",
      blob: null,
      body: text,
    });
  }

  saveItem(item: TransferItem): void {
    if (item.blob) downloadBlob(item.blob, item.name);
  }

  reset(): void {
    this.rzCancel?.();
    this.rzCancel = null;
    this.peer?.close();
    this.peer = null;
    this.sendChain = Promise.resolve();
    this.stage = "idle";
    this.myCode = "";
    this.shortCode = "";
    this.rzStatus = "idle";
    this.joining = false;
    this.error = null;
    this.busy = false;
    this.transfers = [];
  }
}

export const drop = new DropState();
