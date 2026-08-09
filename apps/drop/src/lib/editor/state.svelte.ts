import { DropPeer } from "../rtc/peer";
import { encodeSignal, decodeSignal } from "../rtc/signal";
import { Receiver, sendFile } from "../rtc/transfer";
import { downloadBlob } from "../rtc/save";
import { t } from "../i18n";

export type Stage = "idle" | "host" | "guest" | "connecting" | "connected" | "failed" | "closed";

export interface TransferItem {
  id: string;
  dir: "in" | "out";
  name: string;
  size: number;
  done: number;
  status: "active" | "done" | "error";
  blob: Blob | null;
}

class DropState {
  stage = $state<Stage>("idle");
  /** 상대에게 전달할 코드 — host면 청약, guest면 응답 */
  myCode = $state("");
  busy = $state(false);
  error = $state<string | null>(null);
  transfers = $state<TransferItem[]>([]);

  private peer: DropPeer | null = null;
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
          dir: "in",
          name: meta.name,
          size: meta.size,
          done: 0,
          status: "active",
          blob: null,
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
      onText: () => {
        /* 마일스톤 ② */
      },
    });
    return new DropPeer({
      onOpen: () => {
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

  /** 호스트: 청약 코드 생성 */
  async startHost(): Promise<void> {
    this.error = null;
    this.busy = true;
    this.stage = "host";
    try {
      this.peer = this.makePeer();
      this.myCode = await encodeSignal(await this.peer.createOffer());
    } catch {
      this.stage = "failed";
    }
    this.busy = false;
  }

  /** 게스트 화면 진입 */
  startGuest(): void {
    this.error = null;
    this.myCode = "";
    this.stage = "guest";
  }

  /** 게스트: 청약 코드 → 응답 코드 생성 */
  async makeAnswer(offerCode: string): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      const sdp = await decodeSignal(offerCode);
      this.peer = this.makePeer();
      this.myCode = await encodeSignal(await this.peer.answer(sdp));
    } catch {
      this.error = t.conn.badCode;
      this.peer?.close();
      this.peer = null;
    }
    this.busy = false;
  }

  /** 호스트: 응답 코드 적용 → 연결 시작 */
  async acceptAnswer(answerCode: string): Promise<void> {
    if (!this.peer) return;
    this.error = null;
    this.busy = true;
    try {
      await this.peer.accept(await decodeSignal(answerCode));
      this.stage = "connecting";
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
        dir: "out",
        name: file.name,
        size: file.size,
        done: 0,
        status: "active",
        blob: null,
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

  saveItem(item: TransferItem): void {
    if (item.blob) downloadBlob(item.blob, item.name);
  }

  reset(): void {
    this.peer?.close();
    this.peer = null;
    this.sendChain = Promise.resolve();
    this.stage = "idle";
    this.myCode = "";
    this.error = null;
    this.busy = false;
    this.transfers = [];
  }
}

export const drop = new DropState();
