// 최소 Nostr 클라이언트 (NIP-01) — 랑데부 시그널링 전용.
// 세션마다 일회용 키를 만들어 서명하고, 여러 공개 릴레이에 병렬로 쓰고 읽는다.

import { schnorr } from "@noble/curves/secp256k1.js";

/** 공개 릴레이 — 하나만 살아 있어도 동작한다. */
export const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Filter {
  kinds: number[];
  "#d": string[];
  since?: number;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function createEvent(
  kind: number,
  tags: string[][],
  content: string,
  privKey: Uint8Array,
): Promise<NostrEvent> {
  const pubkey = hex(schnorr.getPublicKey(privKey));
  const created_at = Math.floor(Date.now() / 1000);
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized))),
  );
  const sig = hex(schnorr.sign(hexToBytes(id), privKey));
  return { id, pubkey, created_at, kind, tags, content, sig };
}

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 릴레이 여러 곳을 하나처럼 다룬다 — 발행은 1곳 성공이면 OK, 구독은 id로 중복 제거. */
export class RelayPool {
  private sockets: WebSocket[] = [];
  private ready: Promise<WebSocket>[] = [];
  private seen = new Set<string>();
  private subs = new Map<string, (ev: NostrEvent) => void>();
  private nextSubId = 0;

  constructor(urls: string[] = RELAYS) {
    for (const url of urls) {
      try {
        const ws = new WebSocket(url);
        this.sockets.push(ws);
        this.ready.push(
          new Promise((resolve, reject) => {
            ws.onopen = () => resolve(ws);
            ws.onerror = () => reject(new Error(url));
            ws.onclose = () => reject(new Error(url));
          }),
        );
        ws.onmessage = (e) => this.handle(String(e.data));
      } catch {
        /* 생성 자체가 실패한 릴레이는 건너뜀 */
      }
    }
  }

  private handle(raw: string): void {
    let msg: unknown[];
    try {
      msg = JSON.parse(raw) as unknown[];
    } catch {
      return;
    }
    if (msg[0] !== "EVENT" || typeof msg[1] !== "string") return;
    const ev = msg[2] as NostrEvent;
    const cb = this.subs.get(msg[1]);
    if (!cb || this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    cb(ev);
  }

  /** 연결된 릴레이 최소 1곳에 발행되면 성공. 전부 실패하면 reject. */
  async publish(ev: NostrEvent): Promise<void> {
    const payload = JSON.stringify(["EVENT", ev]);
    const attempts = this.ready.map((p) =>
      p.then((ws) => {
        ws.send(payload);
      }),
    );
    await Promise.any(attempts);
  }

  /** 모든 릴레이에 같은 구독을 건다. 반환된 함수로 해제. */
  subscribe(filter: Filter, onEvent: (ev: NostrEvent) => void): () => void {
    const subId = `drop-${this.nextSubId++}`;
    this.subs.set(subId, onEvent);
    const payload = JSON.stringify(["REQ", subId, filter]);
    for (const p of this.ready) {
      p.then((ws) => ws.send(payload)).catch(() => {});
    }
    return () => {
      this.subs.delete(subId);
      const close = JSON.stringify(["CLOSE", subId]);
      for (const ws of this.sockets) if (ws.readyState === WebSocket.OPEN) ws.send(close);
    };
  }

  /** 최소 1곳이라도 열리는지 — 랑데부 가용성 판단용. */
  async anyOpen(timeoutMs = 4000): Promise<boolean> {
    const timeout = new Promise<false>((r) => setTimeout(() => r(false), timeoutMs));
    const open = Promise.any(this.ready).then(
      () => true,
      () => false,
    );
    return Promise.race([open, timeout]);
  }

  close(): void {
    for (const ws of this.sockets) ws.close();
    this.sockets = [];
    this.subs.clear();
  }
}
