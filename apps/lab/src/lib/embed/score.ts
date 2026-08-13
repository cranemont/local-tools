// 짝짓기 채점 — 프로브 코퍼스에만 쓸 수 있는, 이 앱에서 가장 날카로운 숫자.
//
// "이 모델 좋아요?" 대신 "존댓말과 반말을 같은 뜻으로 보나요?"를 묻는다.
// 각 문장에게 1순위 이웃을 물어 그게 자기 짝인지 세면 끝이다. 현상별로 갈리는
// 지점이 곧 그 모델이 한국어에서 무엇을 못 하는지다.

import type { CorpusItem, ProbeKind } from "../corpus/samples";
import { groupLabel } from "../corpus/samples";
import { ranking } from "./vector";

export interface KindScore {
  kind: ProbeKind;
  label: string;
  hits: number;
  total: number;
  /** hits/total — total이 0이면 null(대조군엔 짝이 없다) */
  rate: number | null;
}

export interface PairReport {
  kinds: KindScore[];
  hits: number;
  total: number;
  rate: number | null;
  /** 짝을 1순위로 데려오지 못한 문장들 — 여기가 진짜 볼거리다 */
  misses: { index: number; text: string; kind: ProbeKind; tookText: string; tookScore: number }[];
  /**
   * 문장별 정오 — McNemar가 이걸 먹는다.
   *
   * 두 설정을 비교할 때 "둘 다 맞힘·둘 다 틀림"은 어느 쪽이 나은지에 대해 아무 말도
   * 하지 않으므로, 총점이 아니라 **어느 문장에서 갈렸는지**가 있어야 한다.
   */
  outcomes: Map<number, boolean>;
}

export function scorePairs(
  items: CorpusItem[],
  matrix: Float32Array,
  n: number,
): PairReport {
  // 짝이 둘 이상 있는 프로브만 채점 대상 — 대조군은 정답이 없다
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.probeId) counts.set(it.probeId, (counts.get(it.probeId) ?? 0) + 1);
  }

  const byKind = new Map<ProbeKind, { hits: number; total: number }>();
  const misses: PairReport["misses"] = [];
  const outcomes = new Map<number, boolean>();
  let hits = 0;
  let total = 0;

  for (let i = 0; i < n; i++) {
    const item = items[i];
    if (!item?.probeId || !item.kind) continue;
    if ((counts.get(item.probeId) ?? 0) < 2) continue;

    const best = ranking(matrix, n, i)[0];
    if (best === undefined) continue;

    const ok = items[best]?.probeId === item.probeId;
    outcomes.set(i, ok);
    const bucket = byKind.get(item.kind) ?? { hits: 0, total: 0 };
    bucket.total += 1;
    if (ok) bucket.hits += 1;
    else {
      misses.push({
        index: i,
        text: item.text,
        kind: item.kind,
        tookText: items[best]?.text ?? "",
        tookScore: matrix[i * n + best],
      });
    }
    byKind.set(item.kind, bucket);

    total += 1;
    if (ok) hits += 1;
  }

  const kinds: KindScore[] = [...byKind.entries()].map(([kind, b]) => ({
    kind,
    label: groupLabel(kind),
    hits: b.hits,
    total: b.total,
    rate: b.total > 0 ? b.hits / b.total : null,
  }));

  return {
    kinds,
    hits,
    total,
    rate: total > 0 ? hits / total : null,
    misses,
    outcomes,
  };
}
