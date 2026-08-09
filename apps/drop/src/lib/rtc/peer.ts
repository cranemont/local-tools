// WebRTC 피어 래퍼 — non-trickle: ICE 후보 수집을 끝낸 SDP 하나로 왕복한다.
// (시그널링이 QR/복붙 1회 교환이라 후보를 나중에 추가로 보낼 채널이 없음)

export interface PeerEvents {
  onOpen(): void;
  /** 연결 수립 전 실패와 수립 후 끊김을 구분해서 전달 */
  onDown(wasConnected: boolean): void;
  onMessage(data: string | ArrayBuffer): void;
}

const CONFIG: RTCConfiguration = {
  // 같은 망에서는 mDNS/host 후보로 붙고, 크로스망에서만 STUN 응답이 쓰인다.
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** 후보 수집이 안 끝나도 이 시간이 지나면 지금까지 모은 것으로 진행. */
const ICE_TIMEOUT_MS = 3000;

export class DropPeer {
  private pc: RTCPeerConnection;
  private ch: RTCDataChannel | null = null;
  private opened = false;

  constructor(private events: PeerEvents) {
    this.pc = new RTCPeerConnection(CONFIG);
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "failed" || s === "closed" || s === "disconnected")
        this.events.onDown(this.opened);
    };
  }

  /** 호스트: 데이터 채널을 만들고 청약 SDP를 돌려준다. */
  async createOffer(): Promise<string> {
    this.attach(this.pc.createDataChannel("drop"));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.waitIce();
    return this.pc.localDescription!.sdp;
  }

  /** 게스트: 청약을 받아 응답 SDP를 돌려준다. */
  async answer(offerSdp: string): Promise<string> {
    this.pc.ondatachannel = (e) => this.attach(e.channel);
    await this.pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.waitIce();
    return this.pc.localDescription!.sdp;
  }

  /** 호스트: 게스트의 응답을 적용하면 연결이 시작된다. */
  async accept(answerSdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  get channel(): RTCDataChannel | null {
    return this.ch;
  }

  close(): void {
    this.pc.onconnectionstatechange = null;
    this.ch?.close();
    this.pc.close();
  }

  private waitIce(): Promise<void> {
    if (this.pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ICE_TIMEOUT_MS);
      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === "complete") {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  private attach(ch: RTCDataChannel): void {
    this.ch = ch;
    ch.binaryType = "arraybuffer";
    ch.onopen = () => {
      this.opened = true;
      this.events.onOpen();
    };
    ch.onmessage = (e) => this.events.onMessage(e.data as string | ArrayBuffer);
  }
}
