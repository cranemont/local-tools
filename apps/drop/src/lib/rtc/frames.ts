// 이 채널 위를 도는 말의 전부 — 정의·인코딩·파싱이 여기 한 자리에 있다.
// RTCPeerConnection을 모르는 순수 모듈이라 그대로 테스트한다.
//
// 규칙 두 가지:
//  · **모르는 프레임은 조용히 버린다.** 예전 판 상대가 새 프레임을 받아도 아무 일이
//    없어야 하고(그쪽 파서는 t를 못 알아본다), 우리도 마찬가지여야 한다. 이 관용이
//    ack를 프로토콜을 깨지 않고 얹을 수 있게 하는 자리다.
//  · **상대가 보낸 값은 믿지 않는다.** JSON.parse 결과를 그대로 쓰면 상대가 정한
//    문자열·숫자가 곧바로 우리 상태가 된다. parseFrame이 모양을 재고 통과한 것만 넘긴다.

/** 프레임 버전. 능력 협상은 버전이 아니라 hello가 한다(아래). */
export const PROTOCOL_VERSION = 1;

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

/**
 * hello = 능력 교환. 채널이 열리자마자 양쪽이 하나씩 보낸다.
 * ack는 나중에 붙은 프레임이라 상대가 모를 수 있는데, **채널이 ordered라서
 * hello는 언제나 accept보다 먼저 도착한다** — 첫 바이트를 밀기 전에 상대가
 * 확인해 주는 판인지 알 수 있다는 뜻이다. hello가 아예 안 오면 예전 판이다.
 */
export interface Caps {
  ack: boolean;
}

export type Frame =
  | { v: 1; t: "hello"; ack: boolean }
  | { v: 1; t: "offer"; batch: string; files: FileMeta[] }
  | { v: 1; t: "accept"; batch: string }
  | { v: 1; t: "decline"; batch: string }
  | { v: 1; t: "withdraw"; batch: string }
  | ({ v: 1; t: "file"; batch: string } & FileMeta)
  | { v: 1; t: "eof"; id: string }
  // n = 디스크에 앉은 누적 바이트. fin이면 파일을 닫은 뒤라 이것이 "완료"의 근거다.
  | { v: 1; t: "ack"; id: string; n: number; fin: boolean }
  | { v: 1; t: "cancel"; id: string }
  | { v: 1; t: "flow"; paused: boolean }
  | { v: 1; t: "text"; body: string };

/** 프레임 생성 — 리터럴을 손으로 적지 않는다(오타가 조용히 버려지는 프레임이 된다). */
export const make = {
  hello: (ack = true): Frame => ({ v: 1, t: "hello", ack }),
  offer: (batch: string, files: FileMeta[]): Frame => ({ v: 1, t: "offer", batch, files }),
  accept: (batch: string): Frame => ({ v: 1, t: "accept", batch }),
  decline: (batch: string): Frame => ({ v: 1, t: "decline", batch }),
  withdraw: (batch: string): Frame => ({ v: 1, t: "withdraw", batch }),
  file: (batch: string, meta: FileMeta): Frame => ({ v: 1, t: "file", batch, ...meta }),
  eof: (id: string): Frame => ({ v: 1, t: "eof", id }),
  ack: (id: string, n: number, fin: boolean): Frame => ({ v: 1, t: "ack", id, n, fin }),
  cancel: (id: string): Frame => ({ v: 1, t: "cancel", id }),
  flow: (paused: boolean): Frame => ({ v: 1, t: "flow", paused }),
  text: (body: string): Frame => ({ v: 1, t: "text", body }),
};

export function encodeFrame(f: Frame): string {
  return JSON.stringify(f);
}

const str = (v: unknown): v is string => typeof v === "string";
const size = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** 파일 메타 — 이름은 여기서 다듬지 않는다(디스크에 닿기 직전 sink.ts의 safeName 몫). */
function readMeta(o: Record<string, unknown>): FileMeta | null {
  if (!str(o.id) || !str(o.name) || !size(o.size)) return null;
  return { id: o.id, name: o.name, size: o.size, mime: str(o.mime) ? o.mime : "" };
}

/** 모양이 맞는 프레임만 통과시킨다. 아니면 null — 호출부는 조용히 버린다. */
export function parseFrame(data: string): Frame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION) return null;
  switch (o.t) {
    case "hello":
      return { v: 1, t: "hello", ack: o.ack === true };
    case "offer": {
      if (!str(o.batch) || !Array.isArray(o.files)) return null;
      const files: FileMeta[] = [];
      for (const f of o.files) {
        if (!f || typeof f !== "object") return null;
        const meta = readMeta(f as Record<string, unknown>);
        if (!meta) return null;
        files.push(meta);
      }
      return { v: 1, t: "offer", batch: o.batch, files };
    }
    case "accept":
      return str(o.batch) ? { v: 1, t: "accept", batch: o.batch } : null;
    case "decline":
      return str(o.batch) ? { v: 1, t: "decline", batch: o.batch } : null;
    case "withdraw":
      return str(o.batch) ? { v: 1, t: "withdraw", batch: o.batch } : null;
    case "file": {
      const meta = readMeta(o);
      return meta && str(o.batch) ? { v: 1, t: "file", batch: o.batch, ...meta } : null;
    }
    case "eof":
      return str(o.id) ? { v: 1, t: "eof", id: o.id } : null;
    case "ack":
      return str(o.id) && size(o.n) ? { v: 1, t: "ack", id: o.id, n: o.n, fin: o.fin === true } : null;
    case "cancel":
      return str(o.id) ? { v: 1, t: "cancel", id: o.id } : null;
    case "flow":
      return { v: 1, t: "flow", paused: o.paused === true };
    case "text":
      return str(o.body) ? { v: 1, t: "text", body: o.body } : null;
    default:
      return null;
  }
}
