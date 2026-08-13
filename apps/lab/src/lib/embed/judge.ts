// 판정 풀링 — 한 번 매기고 영원히 채점한다.
//
// 이 앱이 "다름"만 재던 것을 "나음"을 재게 만드는 자리다. 겹침(overlap@k)은 무엇이
// 바뀌었는지만 말하고 어느 쪽이 맞는지는 모른다. 정답이 있어야 Recall·NDCG·MRR이
// 나오고, 그래야 파레토 그림의 y축이 생긴다.
//
// 정답을 싸게 들여오는 방법이 **풀링**이다(TREC의 pooled relevance judgment):
// 질의 하나에 대해 **지금까지 돌린 모든 설정의 상위 결과를 합집합으로** 모아 한 번만
// 관련성을 매긴다. 그러면 나중에 추가한 설정까지 같은 판정으로 소급 채점된다.
// 여러 시스템이 이미 있다는 이 앱의 구조가 이 방법과 정확히 맞는다.
//
// ⚠️ 풀링 편향: 아무도 안 데려온 문서는 판정될 기회가 없다. 나중에 붙인 모델이
//    **아무도 못 찾은 정답**을 찾아오면 그건 "무관"으로 세어진다. 화면에 이 사실을
//    적어 둘 것 — 실험장이 자기 방법의 한계를 감추면 곤란하다.

import type { CorpusItem } from "../corpus/samples";
import { meanCI, type Interval } from "./stats";
import { ranking } from "./vector";

/** 질의·문서 인덱스 쌍 → 관련 여부. */
export type Marks = Record<string, boolean>;

const markKey = (query: number, doc: number) => `${query}:${doc}`;

/** 코퍼스가 다르면 판정도 다르다 — 긴 코퍼스 키를 저장소 키로 줄인다(FNV-1a). */
function digest(corpusKey: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < corpusKey.length; i++) {
    h ^= corpusKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const storeKey = (corpusKey: string) => `lab.judgments.${digest(corpusKey)}`;

export function loadMarks(corpusKey: string): Marks {
  try {
    const raw = localStorage.getItem(storeKey(corpusKey));
    return raw ? (JSON.parse(raw) as Marks) : {};
  } catch {
    return {};
  }
}

export function saveMarks(corpusKey: string, marks: Marks): void {
  try {
    localStorage.setItem(storeKey(corpusKey), JSON.stringify(marks));
  } catch {
    // 저장 공간이 없으면 이번 세션에서만 유지된다 — 판정을 막지는 않는다
  }
}

export function readMark(marks: Marks, query: number, doc: number): boolean | undefined {
  return marks[markKey(query, doc)];
}

export function setMark(marks: Marks, query: number, doc: number, relevant: boolean | null): Marks {
  const next = { ...marks };
  const key = markKey(query, doc);
  if (relevant === null) delete next[key];
  else next[key] = relevant;
  return next;
}

/**
 * 프로브 짝을 정답으로 깔아 준다 — 내장 코퍼스에서 판정을 처음부터 손으로 매기지
 * 않아도 되게. 짝은 관련, 나머지는 건드리지 않는다(무관으로 단정하면 풀링 편향을
 * 우리가 직접 만드는 셈이다).
 */
export function seedFromProbe(items: CorpusItem[], marks: Marks): Marks {
  const next = { ...marks };
  items.forEach((item, i) => {
    if (!item.probeId) return;
    items.forEach((other, j) => {
      if (i === j || other.probeId !== item.probeId) return;
      next[markKey(i, j)] = true;
    });
  });
  return next;
}

/** 어느 질의에 표가 하나라도 있는가. */
export function judgedQueries(marks: Marks): Set<number> {
  const out = new Set<number>();
  for (const key of Object.keys(marks)) out.add(Number(key.split(":")[0]));
  return out;
}

/** 질의 i의 정답 집합. */
export function relevantFor(marks: Marks, query: number): Set<number> {
  const out = new Set<number>();
  for (const [key, ok] of Object.entries(marks)) {
    if (!ok) continue;
    const [q, d] = key.split(":");
    if (Number(q) === query) out.add(Number(d));
  }
  return out;
}

/**
 * 여러 설정의 상위 결과를 합집합으로 — 판정할 후보 목록.
 * 이미 매긴 것도 함께 돌려준다(다시 볼 수 있게). 순서는 "가장 많은 설정이 데려온 것" 먼저.
 */
export function pool(
  matrices: Float32Array[],
  n: number,
  query: number,
  depth: number,
): { doc: number; votes: number }[] {
  const votes = new Map<number, number>();
  for (const m of matrices) {
    for (const doc of ranking(m, n, query).slice(0, depth)) {
      votes.set(doc, (votes.get(doc) ?? 0) + 1);
    }
  }
  return [...votes.entries()]
    .map(([doc, count]) => ({ doc, votes: count }))
    .sort((a, b) => b.votes - a.votes || a.doc - b.doc);
}

export interface IrReport {
  /** 정답이 하나 이상 매겨진 질의 수 — 실제 채점 모수 */
  queries: number;
  /** 표가 하나라도 있는 질의 수 */
  judged: number;
  /** 매긴 표 총 개수 */
  marks: number;
  k: number;
  recall: Interval & { mean: number };
  ndcg: Interval & { mean: number };
  mrr: Interval & { mean: number };
  /** 질의별 NDCG — 파레토의 오차막대가 이걸 쓴다 */
  perQuery: number[];
}

const EMPTY: IrReport = {
  queries: 0,
  judged: 0,
  marks: 0,
  k: 0,
  recall: { mean: 0, lo: 0, hi: 0 },
  ndcg: { mean: 0, lo: 0, hi: 0 },
  mrr: { mean: 0, lo: 0, hi: 0 },
  perQuery: [],
};

/**
 * 판정에 대고 채점한다 — Recall@k · NDCG@k(이진 이득) · MRR.
 *
 * 정답이 하나도 없는 질의(전부 "무관"으로 매긴 경우)는 뺀다. Recall의 분모가 0이라
 * 넣으면 평균이 오염된다 — IR 관행과 같다.
 */
export function scoreIr(marks: Marks, matrix: Float32Array, n: number, k: number): IrReport {
  const judged = judgedQueries(marks);
  if (judged.size === 0 || n === 0) return { ...EMPTY, k };

  const kk = Math.min(k, Math.max(1, n - 1));
  const recalls: number[] = [];
  const ndcgs: number[] = [];
  const rrs: number[] = [];

  for (const query of judged) {
    if (query >= n) continue;
    const relevant = relevantFor(marks, query);
    if (relevant.size === 0) continue;

    const order = ranking(matrix, n, query);
    const top = order.slice(0, kk);

    let hit = 0;
    let dcg = 0;
    top.forEach((doc, rank) => {
      if (!relevant.has(doc)) return;
      hit += 1;
      dcg += 1 / Math.log2(rank + 2);
    });

    let idcg = 0;
    for (let i = 0; i < Math.min(relevant.size, kk); i++) idcg += 1 / Math.log2(i + 2);

    const first = order.findIndex((doc) => relevant.has(doc));

    recalls.push(hit / relevant.size);
    ndcgs.push(idcg > 0 ? dcg / idcg : 0);
    rrs.push(first >= 0 ? 1 / (first + 1) : 0);
  }

  return {
    queries: ndcgs.length,
    judged: judged.size,
    marks: Object.keys(marks).length,
    k: kk,
    recall: meanCI(recalls),
    ndcg: meanCI(ndcgs),
    mrr: meanCI(rrs),
    perQuery: ndcgs,
  };
}
