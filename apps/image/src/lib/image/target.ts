// 목표 용량 탐색의 "계획"만 모은 자리 — 여기서는 아무것도 인코딩하지 않는다.
// 인코딩을 콜백으로 받는 이유는 둘이다: 브라우저 없이 수렴을 시험할 수 있게 하려는 것,
// 그리고 형식마다 다른 축(JPEG·WebP·AVIF의 품질 / PNG의 사다리)을 같은 상태 기계로
// 돌리려는 것. size.ts가 pipeline.ts에서 갈라져 나온 것과 같은 이유다.
//
// 축의 규약: **값이 클수록 결과가 크다**(=품질이 높다)고 가정한다. 재인코딩은 실제로는
// 단조가 아니라 이 가정이 깨질 수 있고, 깨져도 답이 거짓이 되지 않게 후보를 둘 들고 간다 —
// 목표를 맞춘 것 중 값이 가장 큰 것(best)과, 하나도 못 맞췄을 때 내놓을 가장 작은 결과
// (smallest). 그래서 "맞췄다"고 말하는 결과는 언제나 실제로 잰 바이트가 목표 이하다.
//
// 순서: 양 끝(max → min)을 먼저 짚고 안쪽을 이진 탐색한다. 흔한 두 경우 —
// 지금 설정으로 이미 목표를 맞추는 그림, 어떻게 줄여도 못 맞추는 그림 — 이 한두 번에 끝난다.

/** 한 번의 시도 — 무엇을 넣었고 몇 바이트가 나왔는가. */
export interface Attempt {
  value: number;
  bytes: number;
}

export interface TargetOptions {
  /** 이 바이트 이하로 떨어뜨리는 가장 높은 값을 찾는다. */
  targetBytes: number;
  /** 탐색 구간(양끝 포함). */
  min: number;
  max: number;
  /** 최대 시도 횟수. 생략하면 구간 크기에서 정한다. */
  maxAttempts?: number;
}

export interface SearchPlan {
  targetBytes: number;
  min: number;
  max: number;
  maxAttempts: number;
  /** 아직 답이 있을 수 있는 구간. */
  lo: number;
  hi: number;
  attempts: Attempt[];
  /** 목표를 맞춘 것 중 값이 가장 큰 시도. */
  best: Attempt | null;
  /** 전체에서 결과가 가장 작았던 시도 — 목표를 못 맞췄을 때 내놓는다. */
  smallest: Attempt | null;
  /** 다음에 짚을 자리: 위 끝 → 아래 끝 → 이진. */
  stage: "max" | "min" | "binary";
}

export interface SearchOutcome {
  value: number;
  bytes: number;
  /** 목표 이하로 떨어졌는가. 거짓이면 가장 작은 결과를 돌려준 것이다. */
  met: boolean;
  attempts: number;
}

/** 재인코딩 횟수의 상한. 9 = 양 끝 둘 + 품질 1..100을 끝까지 좁히는 이진 일곱.
 *  품질 축이 이 저장소에서 가장 넓은 축이라 여기까지면 어느 형식도 끝까지 수렴한다. */
export const ATTEMPT_CAP = 9;

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 구간 크기에서 정한 시도 횟수 — 양 끝 둘 + 이진 탐색 깊이, ATTEMPT_CAP에서 자른다. */
export function plannedAttempts(min: number, max: number): number {
  const span = Math.max(1, Math.round(max) - Math.round(min) + 1);
  return Math.max(1, Math.min(ATTEMPT_CAP, 2 + Math.ceil(Math.log2(span))));
}

export function createPlan(options: TargetOptions): SearchPlan {
  const a = Math.round(options.min);
  const b = Math.round(options.max);
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const planned = plannedAttempts(min, max);
  return {
    targetBytes: options.targetBytes,
    min,
    max,
    maxAttempts:
      options.maxAttempts === undefined
        ? planned
        : Math.max(1, Math.round(options.maxAttempts)),
    lo: min,
    hi: max,
    attempts: [],
    best: null,
    smallest: null,
    stage: "max",
  };
}

/** 다음에 시도할 값. null이면 더 볼 것이 없다(구간이 닫혔거나 횟수를 다 썼다). */
export function nextValue(plan: SearchPlan): number | null {
  if (plan.attempts.length >= plan.maxAttempts) return null;
  if (plan.lo > plan.hi) return null;
  if (plan.stage === "max") return plan.hi;
  if (plan.stage === "min") return plan.lo;
  return Math.floor((plan.lo + plan.hi) / 2);
}

/** 잰 결과를 계획에 접어 넣는다. 목표를 맞췄으면 더 높은 값을, 넘겼으면 더 낮은 값을 본다. */
export function recordAttempt(plan: SearchPlan, value: number, bytes: number): void {
  const attempt: Attempt = { value, bytes };
  plan.attempts.push(attempt);

  if (bytes <= plan.targetBytes) {
    if (!plan.best || value > plan.best.value) plan.best = attempt;
    plan.lo = value + 1;
  } else {
    plan.hi = value - 1;
  }

  // 용량이 같으면 값이 높은 쪽이 낫다(같은 크기에 품질만 더 좋다).
  const smaller =
    !plan.smallest ||
    bytes < plan.smallest.bytes ||
    (bytes === plan.smallest.bytes && value > plan.smallest.value);
  if (smaller) plan.smallest = attempt;

  plan.stage = plan.stage === "max" ? "min" : "binary";
}

/** 지금까지 짚어 본 것으로 내놓을 답. 한 번도 안 재 봤으면 null. */
export function planOutcome(plan: SearchPlan): SearchOutcome | null {
  const pick = plan.best ?? plan.smallest;
  if (!pick) return null;
  return {
    value: pick.value,
    bytes: pick.bytes,
    met: plan.best !== null,
    attempts: plan.attempts.length,
  };
}

/** 시도 중계 — 화면이 "멈춘 것처럼" 보이지 않게 매 시도마다 부른다. */
export interface AttemptInfo {
  value: number;
  bytes: number;
  /** 1부터 센 시도 번호. */
  index: number;
  /** 이 탐색이 짚을 수 있는 최대 횟수. */
  max: number;
}

export interface TargetHit<T> extends SearchOutcome {
  /** 채택한 시도가 만든 것 — 다시 인코딩하지 않으려고 들고 온다. */
  result: T;
}

/**
 * 계획대로 짚어 가며 목표에 맞는 값을 찾는다.
 * 인코딩은 `encode`가 하고, 이 함수는 무엇을 몇 번 물어볼지만 정한다.
 * 후보 둘(best·smallest)의 산출물만 붙들고 있으므로 메모리에 남는 결과는 최대 두 개다.
 */
export async function searchTarget<T>(
  options: TargetOptions,
  encode: (value: number) => Promise<{ bytes: number; result: T }>,
  onAttempt?: (info: AttemptInfo) => void,
): Promise<TargetHit<T> | null> {
  const plan = createPlan(options);
  let best: { attempt: Attempt; result: T } | null = null;
  let smallest: { attempt: Attempt; result: T } | null = null;

  for (;;) {
    const value = nextValue(plan);
    if (value === null) break;
    const { bytes, result } = await encode(value);
    recordAttempt(plan, value, bytes);
    const attempt = plan.attempts[plan.attempts.length - 1];
    if (plan.best === attempt) best = { attempt, result };
    if (plan.smallest === attempt) smallest = { attempt, result };
    onAttempt?.({ value, bytes, index: plan.attempts.length, max: plan.maxAttempts });
  }

  const outcome = planOutcome(plan);
  const pick = plan.best ? best : smallest;
  if (!outcome || !pick) return null;
  return { ...outcome, result: pick.result };
}

// ── PNG의 탐색 축 ────────────────────────────────────────────────────────────
// PNG에는 품질 손잡이가 없다. 그래서 색 수(quantize.ts)와 축소 배율을 한 줄로 세워
// 축을 만든다. 아래로 갈수록 작아지고, 탐색기가 쓰는 값(value)은 이 줄의 반대 순서다
// — 탐색기는 "값이 클수록 크다"를 가정하므로 값이 클수록 위(좋은 쪽)여야 한다.

export interface PngStep {
  /** 팔레트 색 수. **null이면 색을 줄이지 않는다.** */
  colors: number | null;
  /** 결과 캔버스에 더 거는 축소 배율(%). 100이면 크기를 건드리지 않는다. */
  scale: number;
}

/** 좋은 쪽이 위. **선호 순서지 용량 순서가 아니다** — PNG는 대개 화면 캡처·도식이라
 *  픽셀 크기를 지키는 편이 낫다고 보고, 색을 먼저 끝까지 줄인 뒤에 크기를 줄인다.
 *  그래서 아래 칸이 위 칸보다 클 수도 있고(색 8·100%는 색 64·75%보다 클 수 있다),
 *  단조가 깨지는 그 경우는 탐색기가 감당한다(위의 best·smallest 규약).
 *
 *  ⚠️ 맨 위가 `colors: null`인 것은 실측 때문이다. 크로미엄에서 800×600 그라디언트 사진을
 *  256색으로 줄였더니 PNG가 **109%로 커졌다**(디더링까지 켜면 115%). PNG 필터는 부드러운
 *  변화를 0에 가까운 잔차로 만드는데 색을 줄이면 등고선에서 큰 계단이 생겨 필터가 진다.
 *  그래서 "아무것도 안 하는" 칸이 사다리의 맨 위에 있어야 한다 —
 *  안 그러면 목표 용량을 켜는 순간 최선의 결과가 끄고 있을 때보다 나빠진다. */
const PNG_LADDER: readonly PngStep[] = [
  { colors: null, scale: 100 },
  { colors: 256, scale: 100 },
  { colors: 128, scale: 100 },
  { colors: 64, scale: 100 },
  { colors: 32, scale: 100 },
  { colors: 16, scale: 100 },
  { colors: 8, scale: 100 },
  { colors: 64, scale: 75 },
  { colors: 32, scale: 75 },
  { colors: 16, scale: 75 },
  { colors: 8, scale: 75 },
  { colors: 32, scale: 50 },
  { colors: 16, scale: 50 },
  { colors: 8, scale: 50 },
  { colors: 16, scale: 35 },
  { colors: 8, scale: 35 },
  { colors: 16, scale: 25 },
  { colors: 8, scale: 25 },
  { colors: 4, scale: 25 },
  { colors: 8, scale: 15 },
  { colors: 4, scale: 10 },
  { colors: 2, scale: 10 },
];

/** PNG 축의 칸 수 — 탐색 구간은 0 .. PNG_STEPS - 1이다. */
export const PNG_STEPS = PNG_LADDER.length;

/** 값 → 사다리 칸. 값이 클수록 좋은 쪽(줄의 위)이다. */
export function pngStepAt(value: number): PngStep {
  return PNG_LADDER[PNG_STEPS - 1 - clampInt(value, 0, PNG_STEPS - 1)];
}
