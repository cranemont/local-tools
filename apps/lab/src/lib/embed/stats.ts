// 이 앱이 정밀도로 거짓말하지 않게 막는 곳.
//
// 프로브가 46문장이라 채점 대상이 40개다. 39/40(97.5%)과 40/40(100%)을 큰 글씨로
// 나란히 띄우면 두 설정이 다른 것처럼 읽히지만, 실제로 엇갈린 문장은 **한 개**다.
// 같은 문장들로 채점했으니 McNemar가 맞는 검정이고, 엇갈린 쌍이 하나면 p = 1.0 —
// 구별이 전혀 안 된다. 숫자를 크게 쓸수록 이 계산이 같이 있어야 한다.

export interface Interval {
  lo: number;
  hi: number;
}

/** log(n!) — 조합수를 로그로 다루려고 쓴다. 필요한 만큼만 늘려 캐시한다. */
const LOG_FACT: number[] = [0];
function logFactorial(n: number): number {
  while (LOG_FACT.length <= n) LOG_FACT.push(LOG_FACT[LOG_FACT.length - 1] + Math.log(LOG_FACT.length));
  return LOG_FACT[n];
}

/**
 * 비율의 Wilson 신뢰구간.
 *
 * 정규근사(p̂ ± z·√(p̂q̂/n))를 쓰면 안 된다 — n이 작거나 p̂이 0·1에 붙으면
 * 구간이 [1.0, 1.0]처럼 폭이 0으로 찌그러지거나 범위를 벗어난다. 40/40이 정확히
 * 그 경우다(정규근사로는 100%±0%, Wilson으로는 [91.2%, 100%]).
 */
export function wilson(hits: number, total: number, z = 1.96): Interval {
  if (total <= 0) return { lo: 0, hi: 1 };
  const p = hits / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {
    lo: Math.max(0, (center - spread) / denom),
    hi: Math.min(1, (center + spread) / denom),
  };
}

/**
 * 평균의 신뢰구간 — NDCG처럼 질의별 값이 0..1인 지표에 쓴다(비율이 아니라 Wilson이 곧바로는 안 맞는다).
 *
 * ⚠️ 표본분산이 0이면 정규구간이 [1.00, 1.00]처럼 **폭 0으로 붕괴한다**. 40개 질의가
 *    전부 만점이라는 게 "다음 질의도 반드시 만점"이라는 뜻은 아닌데, 그림에서는 오차막대가
 *    사라져 확실한 승자처럼 보인다. 값이 0..1로 갇혀 있다는 걸 이용해 그럴 때만
 *    같은 n·같은 평균의 이항구간(Wilson)으로 물러난다 — 보수적이고 폭이 0이 아니다.
 */
export function meanCI(values: number[], z = 1.96): { mean: number; lo: number; hi: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, lo: 0, hi: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;

  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  if (variance <= 0) {
    const { lo, hi } = wilson(mean * n, n, z);
    return { mean, lo, hi };
  }

  const spread = z * Math.sqrt(variance / n);
  return { mean, lo: Math.max(0, mean - spread), hi: Math.min(1, mean + spread) };
}

export interface McNemar {
  /** A만 맞힌 문장 수 */
  aOnly: number;
  /** B만 맞힌 문장 수 */
  bOnly: number;
  /** 엇갈린 문장 수 = aOnly + bOnly */
  discordant: number;
  /** 양측 정확검정 p */
  p: number;
  /** p < 0.05 */
  significant: boolean;
}

/**
 * McNemar 정확검정 — **엇갈린 문장만** 본다.
 *
 * 두 설정이 같은 문장들로 채점됐다는 것이 요점이다. 둘 다 맞힌 문장과 둘 다 틀린
 * 문장은 어느 쪽이 나은지에 대해 아무 말도 하지 않으므로 계산에서 빠진다. 남은
 * 엇갈린 쌍이 동전 던지기와 구별되는지만 묻는다.
 *
 * 표본이 작아 카이제곱 근사 대신 이항 정확검정을 쓴다(엇갈린 쌍이 한 자릿수인 게 보통).
 */
export function mcnemar(aOnly: number, bOnly: number): McNemar {
  const discordant = aOnly + bOnly;
  if (discordant === 0) {
    return { aOnly, bOnly, discordant, p: 1, significant: false };
  }

  const m = Math.min(aOnly, bOnly);
  const logHalf = discordant * Math.log(0.5);
  let tail = 0;
  for (let i = 0; i <= m; i++) {
    tail += Math.exp(
      logFactorial(discordant) - logFactorial(i) - logFactorial(discordant - i) + logHalf,
    );
  }
  const p = Math.min(1, 2 * tail);
  return { aOnly, bOnly, discordant, p, significant: p < 0.05 };
}

/**
 * 지금 갈리는 비율이 유지된다면 문장이 몇 개 있어야 구별이 될까.
 *
 * 한쪽으로만 완전히 갈려도 엇갈린 쌍이 **6개**는 있어야 p < 0.05다(2·0.5⁶ = 0.031,
 * 5개면 0.063으로 모자란다). 관측된 엇갈림 비율로 그걸 전체 문장 수로 환산한다.
 * 엇갈린 문장이 아예 없으면 비율을 추정할 수 없어 null.
 */
export const MIN_DISCORDANT = 6;

export function neededItems(discordant: number, total: number): number | null {
  if (discordant <= 0 || total <= 0) return null;
  if (discordant >= MIN_DISCORDANT) return null; // 이미 충분한 엇갈림
  return Math.ceil((MIN_DISCORDANT * total) / discordant);
}
