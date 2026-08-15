// 용량 줄이기의 "계획"과 "판정"만 모은 자리 — 여기서는 아무것도 인코딩하지 않는다.
// 렌더·qpdf 호출은 repack.ts와 qpdfLoader.ts가 하고, 이 파일은 무엇을 몇 번 시도할지와
// 나온 결과를 채택할지만 정한다. 그래서 브라우저 없이 잰다(명세는 tests/pdf-compress.test.ts).
//
// 상태 기계의 모양은 apps/image/src/lib/image/target.ts와 같다. 두 앱이 같은 파일을
// 나눠 쓰지 않는 이유는 apps/pdf가 apps/image에 의존하지 않기 때문이다(save.ts가 다섯 앱에
// 복제돼 있는 것과 같은 경계). 축의 규약도 같다:
//
//   ① 값이 클수록 결과가 크다(=품질이 높다)고 가정한다. 재인코딩은 단조가 아니라 이 가정이
//      깨질 수 있고, 깨져도 답이 거짓이 되지 않게 후보를 둘 들고 간다 — 목표를 맞춘 것 중
//      값이 가장 큰 것(best)과, 하나도 못 맞췄을 때 내놓을 가장 작은 결과(smallest).
//   ② 축의 맨 위는 언제나 사용자가 고른 설정이다. 목표 용량은 더 줄이기만 하지 더 좋게
//      (=더 크게) 만들지 않는다.
//
// 다른 점은 하나다. 여기서는 한 번의 시도가 문서 전체를 다시 그리는 일이라 200쪽짜리에서
// 9번을 짚으면 몇 분이 걸린다. 그래서 시도 횟수를 쪽 수로 깎는다(attemptBudget).

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

/** 다시 그리는 횟수의 상한. 사다리가 12칸이라 양 끝 둘 + 이진 넷이면 끝까지 좁혀진다. */
export const ATTEMPT_CAP = 6;

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 유한한 정수만 통과시킨다 — NaN·Infinity가 구간에 들어오면 탐색이 안 끝난다. */
function finiteInt(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** 구간 크기에서 정한 시도 횟수 — 양 끝 둘 + 이진 탐색 깊이, ATTEMPT_CAP에서 자른다. */
export function plannedAttempts(min: number, max: number): number {
  const span = Math.max(1, finiteInt(max, 0) - finiteInt(min, 0) + 1);
  return Math.max(1, Math.min(ATTEMPT_CAP, 2 + Math.ceil(Math.log2(span))));
}

/**
 * 쪽 수로 정한 시도 횟수의 상한.
 *
 * 한 번의 시도가 문서 전체 렌더라서 쪽 수에 비례해 느려진다. 3쪽짜리는 여섯 번 짚어도
 * 1초 안쪽이지만 200쪽짜리는 한 번이 수십 초다. 그래서 긴 문서에서는 양 끝만 짚고
 * (고른 설정 → 사다리 맨 아래) 그 둘 중에서 고른다 — 못 맞추면 못 맞췄다고 말한다.
 */
export function attemptBudget(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 1;
  if (pageCount <= 8) return 6;
  if (pageCount <= 40) return 4;
  if (pageCount <= 120) return 3;
  return 2;
}

export function createPlan(options: TargetOptions): SearchPlan {
  // NaN이 구간에 들어오면 lo > hi 비교가 언제나 거짓이라 nextValue가 NaN을 끝없이
  // 돌려준다(maxAttempts도 NaN이면 멈추는 곳이 없다). 여기서 잘라 낸다.
  const a = finiteInt(options.min, 0);
  const b = finiteInt(options.max, 0);
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return {
    targetBytes: options.targetBytes,
    min,
    max,
    maxAttempts:
      options.maxAttempts === undefined
        ? plannedAttempts(min, max)
        : Math.max(1, finiteInt(options.maxAttempts, ATTEMPT_CAP)),
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
export function recordAttempt(
  plan: SearchPlan,
  value: number,
  bytes: number,
): void {
  const attempt: Attempt = { value, bytes };
  plan.attempts.push(attempt);

  if (bytes <= plan.targetBytes) {
    if (!plan.best || value > plan.best.value) plan.best = attempt;
    plan.lo = value + 1;
  } else {
    plan.hi = value - 1;
  }

  // 용량이 같으면 값이 높은 쪽이 낫다(같은 크기에 화질만 더 좋다).
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

/** 시도 중계 — 화면이 멈춘 것처럼 보이지 않게 매 시도마다 부른다. */
export interface AttemptInfo {
  value: number;
  bytes: number;
  /** 1부터 센 시도 번호. */
  index: number;
  /** 이 탐색이 짚을 수 있는 최대 횟수. */
  max: number;
}

export interface TargetHit<T> extends SearchOutcome {
  /** 채택한 시도가 만든 것 — 다시 만들지 않으려고 들고 온다. */
  result: T;
}

/**
 * 계획대로 짚어 가며 목표에 맞는 값을 찾는다.
 * 만드는 일은 `build`가 하고, 이 함수는 무엇을 몇 번 물어볼지만 정한다.
 * 후보 둘(best·smallest)의 산출물만 붙들고 있으므로 메모리에 남는 결과는 최대 두 개다.
 */
export async function searchTarget<T>(
  options: TargetOptions,
  build: (value: number) => Promise<{ bytes: number; result: T }>,
  onAttempt?: (info: AttemptInfo) => void,
): Promise<TargetHit<T> | null> {
  const plan = createPlan(options);
  let best: { attempt: Attempt; result: T } | null = null;
  let smallest: { attempt: Attempt; result: T } | null = null;

  for (;;) {
    const value = nextValue(plan);
    if (value === null) break;
    const { bytes, result } = await build(value);
    recordAttempt(plan, value, bytes);
    const attempt = plan.attempts[plan.attempts.length - 1];
    if (plan.best === attempt) best = { attempt, result };
    if (plan.smallest === attempt) smallest = { attempt, result };
    onAttempt?.({
      value,
      bytes,
      index: plan.attempts.length,
      max: plan.maxAttempts,
    });
  }

  const outcome = planOutcome(plan);
  const pick = plan.best ? best : smallest;
  if (!outcome || !pick) return null;
  return { ...outcome, result: pick.result };
}

// ── 래스터 축(해상도 × 품질) ────────────────────────────────────────────────
// 쪽을 그림으로 다시 만드는 길에는 손잡이가 둘이다. 둘을 한 줄로 세워 축 하나로 만든다.
// 아래로 갈수록 작아지고, 탐색기가 쓰는 값(value)은 이 줄의 반대 순서다 — 탐색기는
// "값이 클수록 크다"를 가정하므로 값이 클수록 위(좋은 쪽)여야 한다.
//
// 해상도를 먼저 지키고 품질을 내린다. 96dpi 아래로 내려가면 본문 글자가 뭉개져서
// 스캔본에서도 읽기 어려워지므로, 같은 해상도 안에서 품질을 먼저 끝까지 쓴다.

export interface RasterStep {
  /** 72dpi가 배율 1이다(pdf.js 뷰포트 규약, rasterize.ts와 같은 값). */
  dpi: number;
  /** JPEG 품질 0~100. rasterize.ts에는 0~1로 나눠 넘긴다. */
  quality: number;
}

export const MIN_DPI = 48;
export const MAX_DPI = 300;
export const MIN_QUALITY = 20;
export const MAX_QUALITY = 95;

/** 좋은 쪽이 위. 선호 순서지 용량 순서가 아니다 — 96dpi·품질 45가 120dpi·품질 55보다
 *  클 수도 있고, 단조가 깨지는 그 경우는 탐색기가 감당한다(위의 best·smallest 규약). */
const RASTER_LADDER: readonly RasterStep[] = [
  { dpi: 200, quality: 85 },
  { dpi: 200, quality: 70 },
  { dpi: 200, quality: 55 },
  { dpi: 150, quality: 70 },
  { dpi: 150, quality: 55 },
  { dpi: 120, quality: 70 },
  { dpi: 120, quality: 55 },
  { dpi: 96, quality: 60 },
  { dpi: 96, quality: 45 },
  { dpi: 72, quality: 50 },
  { dpi: 72, quality: 35 },
  { dpi: 60, quality: 30 },
];

/** 상한을 건 사다리는 cap 하나로 정해진다 — 탐색이 칸마다 부르므로 세워 두고 다시 쓴다. */
const ladderCache = new Map<string, readonly RasterStep[]>();

/**
 * 사용자가 고른 설정(`cap`)을 상한으로 세운 사다리. 맨 위 칸이 그 설정이고, 그보다
 * 해상도가 높거나 품질이 좋은 칸은 없다 — 목표가 헐거우면 고른 설정이 답이다.
 *
 * cap 위의 칸을 버리는 게 아니라 **눌러서** 다시 세운다. 버리면 96dpi를 고른 사람에게
 * 남는 칸이 넷뿐이고 72dpi를 고르면 둘뿐이다. 눌러 세우면 고른 설정에서 시작해
 * 품질만 내려가는 온전한 사다리가 된다.
 */
function rasterLadder(cap: RasterStep): readonly RasterStep[] {
  const dpi = clampInt(cap.dpi, MIN_DPI, MAX_DPI);
  const quality = clampInt(cap.quality, MIN_QUALITY, MAX_QUALITY);
  const key = `${dpi}@${quality}`;
  const cached = ladderCache.get(key);
  if (cached) return cached;

  const seen = new Set<string>();
  const built: RasterStep[] = [];
  const push = (d: number, q: number) => {
    const k = `${d}@${q}`;
    if (seen.has(k)) return;
    seen.add(k);
    built.push({ dpi: d, quality: q });
  };
  push(dpi, quality); // 맨 위 = 사용자가 고른 설정
  for (const rung of RASTER_LADDER) {
    push(Math.min(rung.dpi, dpi), Math.min(rung.quality, quality));
  }
  // 눌러 세우면 줄 순서가 흐트러진다 — 96dpi를 고르면 120dpi 칸이 96dpi로 내려와
  // 앞줄의 품질 55 뒤에 품질 60이 온다. 해상도 내림차순, 그 안에서 품질 내림차순으로
  // 다시 세운다. 모든 칸이 cap 이하라 맨 위는 그대로 cap이다.
  built.sort((a, b) => b.dpi - a.dpi || b.quality - a.quality);
  ladderCache.set(key, built);
  return built;
}

/** 래스터 축의 칸 수 — 탐색 구간은 0 .. rasterSteps(cap) - 1이다. */
export function rasterSteps(cap: RasterStep): number {
  return rasterLadder(cap).length;
}

/** 값 → 사다리 칸. 값이 클수록 좋은 쪽(줄의 위)이고, 맨 위는 사용자가 고른 설정이다. */
export function rasterStepAt(value: number, cap: RasterStep): RasterStep {
  const ladder = rasterLadder(cap);
  return ladder[ladder.length - 1 - clampInt(value, 0, ladder.length - 1)];
}

// ── 글자 유무를 어디서 확인하는가 ───────────────────────────────────────────
// "이미지로 다시 그리기"는 글자를 영구히 없앤다. 그 경고를 띄울지 말지가 몇 쪽을
// 열어 봤는지에 달려 있으므로, 순서와 판정을 여기 순수 함수로 둔다(실제로 여는 일은
// extract.ts의 probePdf).

/**
 * 글자를 찾느라 쪽을 열어 보는 순서. 앞에서부터가 아니라 문서 전체에 흩어 놓는다.
 *
 * 첫 쪽과 마지막 쪽을 먼저 보고, 그다음부터 남은 구간을 반씩 쪼개 가운데를 본다.
 * 모든 쪽이 한 번씩 나오되, 도중에 멈춰도 본 것이 앞부분만은 아니다 — probePdf가
 * 시간 상한에 걸려 중간에 끊는 경우가 그것이다.
 */
export function probeOrder(pageCount: number): number[] {
  const n = Number.isFinite(pageCount) ? Math.floor(pageCount) : 0;
  if (n <= 0) return [];

  const seen = new Uint8Array(n);
  const order: number[] = [];
  const push = (i: number) => {
    if (i < 0 || i >= n || seen[i]) return;
    seen[i] = 1;
    order.push(i);
  };

  push(0);
  push(n - 1);
  // 남은 구간을 너비 우선으로 쪼갠다 — 같은 깊이의 가운데들이 먼저 나온다.
  const queue: [number, number][] = [[1, n - 2]];
  for (let head = 0; head < queue.length; head++) {
    const [lo, hi] = queue[head];
    if (lo > hi) continue;
    const mid = Math.floor((lo + hi) / 2);
    push(mid);
    queue.push([lo, mid - 1], [mid + 1, hi]);
  }
  return order;
}

/** 화면이 뭐라고 말해도 되는가. probe 결과에서 그대로 나온다. */
export type TextVerdict =
  /** 글자를 찾았다 — 래스터로 가면 잃는다. */
  | "text"
  /** 모든 쪽을 열어 봤고 글자가 없었다. */
  | "none"
  /** 훑은 범위에는 없었다. 나머지 쪽은 모른다. */
  | "sampled"
  /** 문서를 못 열었다 — 글자 유무를 말할 수 없다. */
  | "unknown";

export interface TextEvidence {
  hasText: boolean;
  /** 글자를 찾느라 실제로 열어 본 쪽 수. */
  scannedPages: number;
  /** 모든 쪽을 열어 봤는가. */
  complete: boolean;
}

/**
 * 근거의 범위를 화면 문구로 옮긴다.
 *
 * `hasText`가 참이면 범위는 상관없다 — 한 쪽에서 찾았어도 문서에 글자가 있다.
 * 거짓일 때만 몇 쪽을 봤는지가 뜻을 바꾼다. 훑다 만 문서에 "글자 없음"을 붙이면
 * 되돌릴 수 없는 래스터를 안심하고 누르게 된다.
 */
export function textVerdict(probe: TextEvidence | null): TextVerdict {
  if (!probe) return "unknown";
  if (probe.hasText) return "text";
  return probe.complete ? "none" : "sampled";
}

// ── 결과 판정 ───────────────────────────────────────────────────────────────

/** 원본 대비 결과. `same`은 바이트 수가 같은 경우다. */
export type SizeVerdict = "smaller" | "same" | "larger";

export interface SizeReport {
  originalBytes: number;
  /** 내려받을 바이트 수. 원본을 되돌렸으면 originalBytes와 같다. */
  resultBytes: number;
  /** 원본 − 결과. 음수면 커진 것이다. */
  savedBytes: number;
  /** 결과 ÷ 원본 × 100, 소수 첫째 자리. 원본이 0바이트면 잴 수 없어서 null이다. */
  percent: number | null;
  verdict: SizeVerdict;
}

export function sizeReport(
  originalBytes: number,
  resultBytes: number,
): SizeReport {
  const from = safeBytes(originalBytes);
  const to = safeBytes(resultBytes);
  return {
    originalBytes: from,
    resultBytes: to,
    savedBytes: from - to,
    percent: from > 0 ? Math.round((to / from) * 1000) / 10 : null,
    verdict: to < from ? "smaller" : to > from ? "larger" : "same",
  };
}

function safeBytes(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** 어느 쪽을 내려받게 할지. */
export interface Choice<T> {
  data: T;
  /** 압축 결과가 원본보다 크거나 같아서 원본을 그대로 돌려줬는가. */
  keptOriginal: boolean;
  report: SizeReport;
}

/**
 * 압축 결과와 원본 중 작은 쪽을 고른다.
 *
 * 같은 크기여도 원본이 이긴다 — 얻는 것이 없는데 구조만 바뀐 파일을 주는 셈이다.
 * 이미 압축된 PDF에 qpdf를 돌리면 객체 스트림 머리글 때문에 커진다(실측: 2394바이트
 * 문서가 2437바이트, 101.8%). 그 경우 화면은 "줄지 않았다"고 말하고 원본을 내려준다.
 */
export function chooseSmaller<T>(
  original: { bytes: number; data: T },
  candidate: { bytes: number; data: T },
): Choice<T> {
  const from = safeBytes(original.bytes);
  const to = safeBytes(candidate.bytes);
  const keptOriginal = to === 0 || to >= from;
  return {
    data: keptOriginal ? original.data : candidate.data,
    keptOriginal,
    report: sizeReport(from, keptOriginal ? from : to),
  };
}

/** 목표 용량이 이미 만족돼 있는가 — 시도 전에 물어서, 헛돌지 않게 한다. */
export function alreadyUnderTarget(
  originalBytes: number,
  targetBytes: number,
): boolean {
  const from = safeBytes(originalBytes);
  return from > 0 && Number.isFinite(targetBytes) && from <= targetBytes;
}

/**
 * 화면에 적는 용량. 1000 단위로 끊고 1MB 미만은 kB로 적는다.
 * 경계는 반올림한 뒤에 본다 — 999,999바이트를 "1000.0 kB"로 적지 않으려는 것이다.
 */
export function formatBytes(n: number): string {
  const bytes = safeBytes(n);
  if (bytes < 1000) return `${bytes} B`;
  if (bytes / 1000 < 999.95) return `${round1(bytes / 1000)} kB`;
  return `${round1(bytes / (1000 * 1000))} MB`;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** 목표 용량 입력(MB)을 바이트로. 비었거나 0 이하면 목표를 안 쓴다는 뜻이다. */
export function targetBytesFromMb(input: string): number | null {
  const mb = Number.parseFloat(input.trim());
  if (!Number.isFinite(mb) || mb <= 0) return null;
  return Math.round(mb * 1000 * 1000);
}
