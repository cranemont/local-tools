// 진행률·속도·남은 시간이 나오는 자리. RTC를 모르는 순수 계산이라 그대로 테스트한다.
//
// ── 왜 ack인가 ──────────────────────────────────────────────────────
// 예전에는 **데이터 채널에 건넨 바이트**를 진행률로 썼다. 그건 상대가 받은 양이 아니라
// 내 쪽 송신 버퍼에 쌓인 양이라, 첫 구간에서 속도가 실제보다 높게 나왔다가 가라앉았고
// "완료"는 상대가 디스크에 다 쓰기도 전에 떴다. 지금은 받는 쪽이 **디스크에 앉힌 만큼**을
// ack로 알리고, 그 값만 진행률이 된다.
//
// ── 속도를 재는 방법 ────────────────────────────────────────────────
// 지수이동평균(EMA)은 첫 표본에 기댈 것이 없어 그 값이 그대로 속도가 된다 —
// 64KB가 2ms 만에 "나갔다"면 32MB/s다. 그래서 **시간 창**으로 바꿨다: 창이 충분히
// 길어지기 전에는 속도를 말하지 않는다(0 = 아직 모름).

export interface Sample {
  at: number;
  bytes: number;
}

/** 속도를 재는 창. 이보다 오래된 표본은 버린다. */
export const RATE_WINDOW_MS = 3000;
/** 창이 이보다 짧으면 속도를 말하지 않는다 — 첫 구간이 튀던 자리다. */
export const RATE_MIN_SPAN_MS = 400;

/**
 * 표본 하나를 창에 넣는다. 뒤로 가는 표본(시각·바이트)은 버린다 —
 * 취소 뒤 늦게 온 값이 창을 흔들면 속도가 음수가 된다.
 */
export function pushSample(samples: Sample[], at: number, bytes: number): void {
  const last = samples[samples.length - 1];
  if (last) {
    if (at < last.at || bytes < last.bytes) return;
    if (at === last.at) {
      last.bytes = bytes;
      return;
    }
  }
  samples.push({ at, bytes });
  // 창 밖은 버리되 창 앞을 덮는 표본 하나는 남긴다(둘이 있어야 기울기가 나온다).
  while (samples.length > 2 && samples[1].at <= at - RATE_WINDOW_MS) samples.shift();
}

/** 창 안 평균 속도(B/s). 아직 말할 수 없으면 0이다. */
export function windowRate(samples: readonly Sample[], now: number): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  // 마지막 표본조차 창 밖이면 그동안 아무 소식이 없었다는 뜻이다.
  if (now - last.at > RATE_WINDOW_MS) return 0;
  const span = last.at - first.at;
  if (span < RATE_MIN_SPAN_MS) return 0;
  const moved = last.bytes - first.bytes;
  if (moved <= 0) return 0;
  return (moved * 1000) / span;
}

/** 남은 시간(초). 속도를 모르면 0 — 화면은 0을 빈 문자열로 그린다. */
export function etaSeconds(rate: number, remaining: number): number {
  if (!(rate > 0) || !(remaining > 0)) return 0;
  return remaining / rate;
}

// ── 받는 쪽: 언제 ack를 보낼까 ──────────────────────────────────────
// 청크마다 보내면 64KB당 프레임 하나라 과하고, 파일 끝에만 보내면 진행률이 통째로 없다.
// 그래서 둘로 잰다 — 쌓인 바이트, 그리고 흐른 시간. 느린 연결에서 바이트 문턱만 두면
// 몇 초씩 소식이 없어 보내는 쪽 화면이 "정체됨"으로 넘어간다.

/** 이만큼 쌓이면 알린다(청크 4장). */
export const ACK_BYTES = 256 * 1024;
/** 덜 쌓였어도 이만큼 지났으면 알린다. */
export const ACK_MS = 500;

export function ackDue(written: number, acked: number, lastAt: number, now: number): boolean {
  if (written <= acked) return false;
  return written - acked >= ACK_BYTES || now - lastAt >= ACK_MS;
}

// ── 보내는 쪽: 상대가 ack를 아는 판인가 ─────────────────────────────

/**
 * 한 연결 동안 유지되는 판단. 파일마다 다시 배우지 않는다.
 * null = 아직 모름, true = 확인해 주는 판, false = 예전 판(낙관 모드로 간다).
 */
export class AckSession {
  #acks: boolean | null = null;

  get peerAcks(): boolean | null {
    return this.#acks;
  }

  /** hello를 받았다 — 첫 바이트를 밀기 전에 오는 정본이다. */
  noteHello(ack: boolean): void {
    this.#acks = ack;
  }

  /** ack가 실제로 왔다 — hello를 못 봤더라도 이쪽이 더 센 증거다. */
  noteAck(): void {
    this.#acks = true;
  }

  /** 기다릴 만큼 기다렸는데 하나도 안 왔다. 이미 안다고 판단한 것은 뒤집지 않는다. */
  giveUp(): void {
    if (this.#acks === null) this.#acks = false;
  }
}

/** ack를 장부에 앉힌다 — 뒤로 가지 않고, 파일 크기를 넘지 않는다. */
export function clampAck(prev: number, next: number, size: number): number {
  if (typeof next !== "number" || !Number.isFinite(next)) return prev;
  return Math.min(Math.max(prev, next), size);
}

/**
 * 파일 하나의 ack 장부. 시계는 밖에서 준다(테스트가 시간을 쥔다).
 * 채널이 ordered라 ack는 순서대로 오지만, 장부는 그것에 기대지 않는다 —
 * 뒤바뀐 값·중복·크기를 넘는 값이 와도 앉는 숫자는 단조 증가한다.
 */
export class AckTracker {
  readonly id: string;
  readonly size: number;
  #acked = 0;
  #final = false;
  #saw = false;
  #at: number;
  #wake: (() => void)[] = [];

  constructor(id: string, size: number, at: number) {
    this.id = id;
    this.size = size;
    this.#at = at;
  }

  get acked(): number {
    return this.#acked;
  }

  /** 최종 ack를 받았다(파일이 닫혔다) */
  get final(): boolean {
    return this.#final;
  }

  /** ack를 하나라도 봤다 — 상대가 예전 판이 아니라는 증거 */
  get sawAck(): boolean {
    return this.#saw;
  }

  /** 최종 ack가 왔고 장부도 다 찼다 = 진짜 완료 */
  get complete(): boolean {
    return this.#final && this.#acked >= this.size;
  }

  /** 최종이라면서 못 채웠다 — "완료"라고 말하면 안 되는 경우 */
  get short(): boolean {
    return this.#final && this.#acked < this.size;
  }

  /** ack 한 장. 장부가 늘었으면 true. */
  apply(bytes: number, final: boolean, at: number): boolean {
    this.#saw = true;
    const next = clampAck(this.#acked, bytes, this.size);
    const moved = next > this.#acked;
    this.#acked = next;
    if (final) this.#final = true;
    this.#at = at;
    if (moved || final) this.#flush();
    return moved;
  }

  /** 마지막 소식 이후 흐른 시간 — 상대가 죽었는지 재는 자다. */
  silentFor(now: number): number {
    return now - this.#at;
  }

  /**
   * 침묵의 시작점을 지금으로 옮긴다.
   * 상대가 세워 둔 동안(flow) 흐른 시간은 침묵이 아니다 — 그걸 세면
   * 느린 디스크를 죽은 상대로 오해한다.
   */
  touch(at: number): void {
    this.#at = at;
  }

  /** 다음 ack가 올 때까지. */
  next(): Promise<void> {
    return new Promise((resolve) => this.#wake.push(resolve));
  }

  #flush(): void {
    const wake = this.#wake;
    this.#wake = [];
    for (const resolve of wake) resolve();
  }
}

/**
 * 보내는 쪽의 장부 묶음. **id로만 찾는다** — 이것이 취소의 급소다.
 * 취소한 파일은 장부에서 빠지고, 그 뒤 도착한 ack는 갈 곳이 없어 버려진다.
 * (id로 안 가르면 늦게 온 ack가 다음 파일의 진행률에 얹힌다.)
 */
export class AckBook {
  #open = new Map<string, AckTracker>();

  open(id: string, size: number, at: number): AckTracker {
    const tracker = new AckTracker(id, size, at);
    this.#open.set(id, tracker);
    return tracker;
  }

  close(id: string): void {
    this.#open.delete(id);
  }

  clear(): void {
    this.#open.clear();
  }

  /** ack 한 장을 앉힌다. 모르는 id면 null — 아무 진행률도 건드리지 않는다. */
  apply(id: string, bytes: number, final: boolean, at: number): AckTracker | null {
    const tracker = this.#open.get(id);
    if (!tracker) return null;
    tracker.apply(bytes, final, at);
    return tracker;
  }
}
