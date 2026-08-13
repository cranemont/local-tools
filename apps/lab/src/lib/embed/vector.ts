// 벡터 연산과 "두 설정이 얼마나 다른가"를 재는 지표.
//
// 이 앱의 주장은 전부 여기서 나온다. 그림은 거들 뿐이고, 실제로 결정을 바꾸는 건
// overlap@k와 Spearman ρ 두 숫자다 — 768을 256으로 잘랐을 때 이웃 목록이 몇 % 남는가,
// 순위가 얼마나 뒤집혔는가.

/** 제자리 L2 정규화. 0 벡터는 그대로 둔다(NaN 방지). */
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/**
 * Matryoshka 절단 — 앞에서 dim개만 남기고 다시 정규화한다.
 * 재정규화가 핵심이다. 자르기만 하면 길이가 1이 아니게 되어 코사인이 내적과 어긋난다.
 */
export function truncate(v: Float32Array, dim: number): Float32Array {
  if (dim >= v.length) return v;
  return normalize(v.slice(0, dim));
}

/** 정규화된 벡터끼리는 내적이 곧 코사인이다. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/** n×n 유사도 행렬을 평평한 Float32Array로. 대각은 1. */
export function similarityMatrix(vecs: Float32Array[]): Float32Array {
  const n = vecs.length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    m[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = dot(vecs[i], vecs[j]);
      m[i * n + j] = s;
      m[j * n + i] = s;
    }
  }
  return m;
}

/** i행에서 자기 자신을 뺀 유사도 내림차순 인덱스. */
export function ranking(matrix: Float32Array, n: number, i: number): number[] {
  const idx: number[] = [];
  for (let j = 0; j < n; j++) if (j !== i) idx.push(j);
  idx.sort((a, b) => matrix[i * n + b] - matrix[i * n + a]);
  return idx;
}

export interface Neighbor {
  index: number;
  score: number;
}

export function topK(matrix: Float32Array, n: number, i: number, k: number): Neighbor[] {
  return ranking(matrix, n, i)
    .slice(0, k)
    .map((j) => ({ index: j, score: matrix[i * n + j] }));
}

/**
 * 두 설정의 top-k 이웃이 얼마나 겹치는가 — 행마다 |A∩B|/k 를 재고 평균낸다.
 *
 * 이게 "이 변경이 검색 결과를 바꾸는가"에 대한 가장 직접적인 답이다.
 * 1.0이면 자를수록 이득만 있는 것이고, 0.6이면 열 중 넷이 다른 문서로 바뀐 것이다.
 */
export function overlapAtK(a: Float32Array, b: Float32Array, n: number, k: number): number {
  if (n < 2) return 1;
  const kk = Math.min(k, n - 1);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const setA = new Set(ranking(a, n, i).slice(0, kk));
    let hit = 0;
    for (const j of ranking(b, n, i).slice(0, kk)) if (setA.has(j)) hit++;
    total += hit / kk;
  }
  return total / n;
}

/**
 * 순위 상관(Spearman ρ)을 행마다 재고 평균낸다 — 전체 순서가 얼마나 보존됐는가.
 *
 * overlap@k가 "상위 k에 누가 있나"만 본다면 이쪽은 꼬리까지 본다.
 * 둘이 갈릴 때가 재미있다: overlap은 높은데 ρ가 낮으면 같은 문서들이 자기들끼리
 * 자리를 바꾼 것이다.
 */
export function meanSpearman(a: Float32Array, b: Float32Array, n: number): number {
  if (n < 3) return 1;
  const m = n - 1; // 자기 자신 제외
  const denom = m * (m * m - 1);
  if (denom === 0) return 1;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const rankA = new Map<number, number>();
    ranking(a, n, i).forEach((j, r) => rankA.set(j, r));
    let d2 = 0;
    ranking(b, n, i).forEach((j, r) => {
      const d = r - (rankA.get(j) ?? 0);
      d2 += d * d;
    });
    total += 1 - (6 * d2) / denom;
  }
  return total / n;
}

/**
 * PCA 3축 투영 + 각 축의 설명분산 비율.
 *
 * 비율을 같이 돌려주는 게 요점이다. 768차원을 3으로 눌렀을 때 보통 15~30%밖에
 * 안 남는데, 그 숫자를 화면에 띄우지 않으면 점구름은 그럴듯한 거짓말이 된다.
 * 멱반복법 — 차원이 커도 공분산 행렬을 만들지 않는다.
 */
export function pca3(vecs: Float32Array[]): { points: number[][]; explained: number[] } {
  const n = vecs.length;
  if (n === 0) return { points: [], explained: [0, 0, 0] };
  const dim = vecs[0].length;

  const mean = new Float64Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) mean[i] += v[i];
  for (let i = 0; i < dim; i++) mean[i] /= n;

  // 중심화한 사본 — 성분을 뽑을 때마다 깎아 낸다(deflation)
  const centered = vecs.map((v) => {
    const c = new Float64Array(dim);
    for (let i = 0; i < dim; i++) c[i] = v[i] - mean[i];
    return c;
  });

  let totalVar = 0;
  for (const c of centered) for (let i = 0; i < dim; i++) totalVar += c[i] * c[i];

  const axes: Float64Array[] = [];
  const variances: number[] = [];

  for (let comp = 0; comp < 3; comp++) {
    // 결정론적 초기값 — Math.random()을 쓰면 같은 입력이 매번 다른 그림을 낸다
    let w = new Float64Array(dim);
    for (let i = 0; i < dim; i++) w[i] = Math.sin((comp + 1) * (i + 1) * 0.7) + 0.001;
    normalize64(w);

    for (let iter = 0; iter < 64; iter++) {
      const next = new Float64Array(dim);
      for (const c of centered) {
        let proj = 0;
        for (let i = 0; i < dim; i++) proj += c[i] * w[i];
        for (let i = 0; i < dim; i++) next[i] += proj * c[i];
      }
      if (normalize64(next) === 0) break;
      w = next;
    }

    let variance = 0;
    for (const c of centered) {
      let proj = 0;
      for (let i = 0; i < dim; i++) proj += c[i] * w[i];
      variance += proj * proj;
      for (let i = 0; i < dim; i++) c[i] -= proj * w[i]; // deflation
    }
    axes.push(w);
    variances.push(variance);
  }

  const points = vecs.map((v) => {
    const c = new Float64Array(dim);
    for (let i = 0; i < dim; i++) c[i] = v[i] - mean[i];
    return axes.map((ax) => {
      let proj = 0;
      for (let i = 0; i < dim; i++) proj += c[i] * ax[i];
      return proj;
    });
  });

  const explained = variances.map((v) => (totalVar > 0 ? v / totalVar : 0));
  return { points, explained };
}

function normalize64(v: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return norm;
}
