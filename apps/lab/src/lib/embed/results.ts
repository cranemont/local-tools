// 파레토 그림에 찍히는 점들 — 세션을 넘겨 쌓인다.
//
// 벡터가 아니라 **결과만** 남긴다. 모델 하나가 200MB~2.4GB인데 그걸 저장할 이유가
// 없고, 점 하나는 100바이트도 안 된다. 그래서 IndexedDB 없이 localStorage로 끝난다.
// 다음에 앱을 열면 지난번에 재 본 조합들이 그림에 그대로 있고, 새로 돌린 것이 옆에
// 하나 더 찍힌다 — 이 그림이 자라는 게 실험장의 성과물이다.
//
// 코퍼스가 다르면 점수가 비교 불가라 저장소를 코퍼스별로 가른다.

/** 이 점이 어떤 잣대로 잰 값인가. 잣대가 다른 점을 같은 축에 올리면 안 된다. */
export type MetricKind = "pair" | "ndcg";

export interface ResultPoint {
  modelId: string;
  dtype: string;
  /** lexical은 0 */
  dim: number;
  usePrefix: boolean;
  /** 내려받는 바이트 — 파레토의 x축 */
  bytes: number;
  /** 문장 하나당 임베딩 시간(ms) */
  msPerItem: number;
  metric: MetricKind;
  value: number;
  lo: number;
  hi: number;
  /** 채점 모수 — 작으면 오차막대가 길어진다 */
  n: number;
}

export function pointKey(p: ResultPoint): string {
  return `${p.metric}|${p.modelId}|${p.dtype}|${p.dim}|${p.usePrefix ? 1 : 0}`;
}

function digest(corpusKey: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < corpusKey.length; i++) {
    h ^= corpusKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const storeKey = (corpusKey: string) => `lab.results.${digest(corpusKey)}`;

export function loadPoints(corpusKey: string): ResultPoint[] {
  try {
    const raw = localStorage.getItem(storeKey(corpusKey));
    return raw ? (JSON.parse(raw) as ResultPoint[]) : [];
  } catch {
    return [];
  }
}

/** 같은 조합은 덮어쓴다 — 판정이 늘어나면 점수가 달라지므로 최신이 맞다. */
export function mergePoints(corpusKey: string, incoming: ResultPoint[]): ResultPoint[] {
  const byKey = new Map(loadPoints(corpusKey).map((p) => [pointKey(p), p]));
  for (const p of incoming) byKey.set(pointKey(p), p);
  const merged = [...byKey.values()];
  try {
    localStorage.setItem(storeKey(corpusKey), JSON.stringify(merged));
  } catch {
    // 넘치면 이번 세션 것만 보여 준다
  }
  return merged;
}

export function clearPoints(corpusKey: string): void {
  try {
    localStorage.removeItem(storeKey(corpusKey));
  } catch {
    // 지울 게 없으면 그만
  }
}

/**
 * 파레토 프론티어 — 더 싸면서 더 좋은 점이 없는 것들.
 *
 * x(바이트)가 작을수록, y(품질)가 클수록 좋다. x 오름차순으로 훑으며 지금까지 본
 * 최고 y를 넘어서는 점만 남긴다. 같은 x에서는 y가 큰 것이 이긴다.
 */
export function frontier(points: ResultPoint[]): Set<string> {
  const sorted = [...points].sort((a, b) => a.bytes - b.bytes || b.value - a.value);
  const keep = new Set<string>();
  let best = -Infinity;
  for (const p of sorted) {
    if (p.value > best) {
      keep.add(pointKey(p));
      best = p.value;
    }
  }
  return keep;
}
