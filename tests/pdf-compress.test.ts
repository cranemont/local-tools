import { describe, expect, it } from "vitest";

import {
  ATTEMPT_CAP,
  alreadyUnderTarget,
  attemptBudget,
  chooseSmaller,
  createPlan,
  formatBytes,
  MAX_DPI,
  MAX_QUALITY,
  MIN_DPI,
  MIN_QUALITY,
  nextValue,
  planOutcome,
  plannedAttempts,
  rasterStepAt,
  rasterSteps,
  recordAttempt,
  searchTarget,
  sizeReport,
  targetBytesFromMb,
  type AttemptInfo,
  type RasterStep,
} from "../apps/pdf/src/lib/pdf/compress";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 apps/pdf "용량 줄이기"의 명세다. 계획(compress.ts)과 만들기(repack.ts·
// qpdfLoader.ts)가 갈라져 있어서, 여기서는 가짜 생성기를 물려 계획만 잰다.
//
// 계약은 다섯이다.
//   ① 맞췄다(met=true)고 말하는 결과는 실제로 잰 바이트가 목표 이하다.
//   ② 하나도 못 맞추면 가장 작은 결과를 주고 met=false로 말한다.
//   ③ 시도 횟수는 maxAttempts를 넘지 않는다. 쪽 수가 많으면 그 상한이 더 낮다.
//   ④ 축의 맨 위는 사용자가 고른 (해상도, 품질)이다 — 목표 용량이 그보다 좋은 결과를
//      만들지 않는다.
//   ⑤ 압축 결과가 원본보다 크거나 같으면 원본을 그대로 돌려준다.
// ①②③은 단조 가정(값이 클수록 크다)이 깨져도 지켜져야 한다 — 재인코딩은 단조가 아니다.
// ─────────────────────────────────────────────────────────────────────────────

/** 값 → 바이트 표를 받아 시도 기록을 남기는 가짜 생성기. */
function fakeBuilder(sizeOf: (value: number) => number) {
  const seen: number[] = [];
  return {
    seen,
    build: async (value: number) => {
      seen.push(value);
      return { bytes: sizeOf(value), result: `v${value}` };
    },
  };
}

/** 값이 곧 용량인 가장 단순한 그림 — 값 v에서 v * 1000바이트. */
const linear = (value: number) => value * 1000;

describe("시도 횟수 — 다시 그리는 일이 비싸다", () => {
  it("구간이 넓어도 ATTEMPT_CAP을 넘지 않는다", () => {
    expect(plannedAttempts(0, 11)).toBeLessThanOrEqual(ATTEMPT_CAP);
    expect(plannedAttempts(1, 100000)).toBe(ATTEMPT_CAP);
  });

  it("쪽 수가 늘수록 시도 상한이 줄어든다", () => {
    const budgets = [1, 8, 40, 120, 400].map(attemptBudget);
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]).toBeLessThanOrEqual(budgets[i - 1]);
    }
  });

  it("★ 1쪽짜리는 여섯 번까지 짚는다", () => {
    expect(attemptBudget(1)).toBe(6);
    expect(attemptBudget(8)).toBe(6);
  });

  it("★ 120쪽을 넘으면 양 끝 둘만 짚는다 — 한 번이 문서 전체 렌더다", () => {
    expect(attemptBudget(121)).toBe(2);
    expect(attemptBudget(1000)).toBe(2);
  });

  it("쪽 수를 모르거나 0이면 한 번만 짚는다", () => {
    expect(attemptBudget(0)).toBe(1);
    expect(attemptBudget(-3)).toBe(1);
    expect(attemptBudget(Number.NaN)).toBe(1);
  });

  it("긴 문서의 예산으로 돌리면 렌더는 두 번뿐이다", async () => {
    // 맨 위 칸(11)이 목표를 넘겨서 아래 끝(0)까지 내려가는 그림.
    const b = fakeBuilder(linear);
    await searchTarget(
      { targetBytes: 5000, min: 0, max: 11, maxAttempts: attemptBudget(300) },
      b.build,
    );
    expect(b.seen).toEqual([11, 0]);
  });
});

describe("양 끝을 먼저 짚는다", () => {
  it("고른 설정(상한)으로 이미 목표를 맞추면 한 번에 끝난다", async () => {
    const b = fakeBuilder(linear);
    const hit = await searchTarget(
      { targetBytes: 100_000, min: 1, max: 100 },
      b.build,
    );
    expect(b.seen).toEqual([100]);
    expect(hit).toMatchObject({ value: 100, bytes: 100_000, met: true, attempts: 1 });
  });

  it("아래 끝으로도 못 맞추면 두 번 만에 포기한다", async () => {
    const b = fakeBuilder(linear);
    const hit = await searchTarget({ targetBytes: 500, min: 1, max: 100 }, b.build);
    expect(b.seen).toEqual([100, 1]);
    expect(hit).toMatchObject({ met: false, value: 1, bytes: 1000 });
  });
});

describe("이진 탐색 수렴 — 목표 이하의 가장 높은 값", () => {
  it("경계가 딱 떨어지는 표에서 그 값을 집는다", async () => {
    const hit = await searchTarget(
      { targetBytes: 8000, min: 0, max: 11, maxAttempts: 12 },
      fakeBuilder(linear).build,
    );
    expect(hit).toMatchObject({ value: 8, bytes: 8000, met: true });
  });

  it("찾은 값보다 한 칸 높은 값은 목표를 넘는다 — 더 높일 여지가 없다", async () => {
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 1, max: 100, maxAttempts: 12 },
      fakeBuilder(linear).build,
    );
    expect(hit!.value).toBe(42);
    expect(linear(hit!.value + 1)).toBeGreaterThan(42_000);
  });

  it("채택한 산출물은 그 값으로 만든 것이다 — 다시 만들지 않는다", async () => {
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 1, max: 100, maxAttempts: 12 },
      fakeBuilder(linear).build,
    );
    expect(hit!.result).toBe(`v${hit!.value}`);
  });

  it("같은 값을 두 번 만들지 않는다", async () => {
    const b = fakeBuilder(linear);
    await searchTarget({ targetBytes: 42_000, min: 1, max: 100, maxAttempts: 12 }, b.build);
    expect(new Set(b.seen).size).toBe(b.seen.length);
  });

  it("구간을 거꾸로 줘도(min>max) 같은 답을 낸다", async () => {
    const hit = await searchTarget(
      { targetBytes: 8000, min: 11, max: 0, maxAttempts: 12 },
      fakeBuilder(linear).build,
    );
    expect(hit).toMatchObject({ value: 8, met: true });
  });

  it("사다리 전 구간에서 최적값에 닿는다", async () => {
    const miss: string[] = [];
    for (const max of [1, 2, 5, 11, 23]) {
      for (let opt = 0; opt <= max; opt++) {
        // opt가 딱 맞고 opt+1은 넘도록 목표를 잡는다. opt=0은 어느 값으로도 못 맞추는 경우.
        const target = opt === 0 ? linear(0) : linear(opt);
        const hit = await searchTarget(
          { targetBytes: target, min: 0, max, maxAttempts: 12 },
          fakeBuilder(linear).build,
        );
        if (!hit!.met || hit!.value !== opt) {
          miss.push(`max=${max} 기대=${opt} 실제=${hit!.value} met=${hit!.met}`);
        }
      }
    }
    expect(miss).toEqual([]);
  });
});

describe("단조 가정이 깨져도 거짓을 말하지 않는다", () => {
  // 해상도를 낮췄는데 JPEG가 커지는 구간이 있다(사다리가 배율과 품질을 섞어 세우므로).
  const jagged = (value: number) => {
    const noise = [0, 9000, -4000, 2000, -7000][value % 5];
    return Math.max(100, value * 1000 + noise);
  };

  it("톱니 표에서도 맞췄다고 한 결과는 목표 이하다", async () => {
    for (let target = 2000; target <= 100_000; target += 1300) {
      const b = fakeBuilder(jagged);
      const hit = await searchTarget({ targetBytes: target, min: 1, max: 100 }, b.build);
      expect(hit).not.toBeNull();
      expect(b.seen).toContain(hit!.value);
      expect(hit!.bytes).toBe(jagged(hit!.value));
      if (hit!.met) expect(hit!.bytes).toBeLessThanOrEqual(target);
    }
  });

  it("어떤 값으로도 못 내려가면 못 맞췄다고 말한다", async () => {
    const hit = await searchTarget(
      { targetBytes: 10_000, min: 1, max: 100 },
      fakeBuilder((v) => 50_000 + v).build,
    );
    expect(hit!.met).toBe(false);
    expect(hit!.bytes).toBeGreaterThan(10_000);
  });
});

describe("목표를 못 맞추면 가장 작은 후보를 돌려준다", () => {
  it("짚어 본 것 중 가장 작은 결과를 준다", async () => {
    const sizeOf = (value: number) => 30_000 + value * 100;
    const b = fakeBuilder(sizeOf);
    const hit = await searchTarget({ targetBytes: 1000, min: 1, max: 100 }, b.build);
    expect(hit!.met).toBe(false);
    expect(hit!.bytes).toBe(Math.min(...b.seen.map(sizeOf)));
    expect(hit!.result).toBe(`v${hit!.value}`);
  });

  it("용량이 같으면 값이 높은 쪽(화질이 나은 쪽)을 남긴다", () => {
    const plan = createPlan({ targetBytes: 10, min: 1, max: 100 });
    recordAttempt(plan, 20, 5000);
    recordAttempt(plan, 60, 5000);
    expect(planOutcome(plan)).toMatchObject({ value: 60, met: false });
  });

  it("한 번도 만들지 않았으면 답이 없다", () => {
    const plan = createPlan({ targetBytes: 10, min: 1, max: 100 });
    expect(planOutcome(plan)).toBeNull();
    expect(nextValue(plan)).toBe(100);
  });
});

describe("최대 시도 횟수를 지킨다", () => {
  it("maxAttempts를 넘겨 만들지 않는다", async () => {
    for (const maxAttempts of [1, 2, 3, 5]) {
      const b = fakeBuilder(linear);
      await searchTarget({ targetBytes: 42_000, min: 1, max: 100, maxAttempts }, b.build);
      expect(b.seen.length).toBeLessThanOrEqual(maxAttempts);
    }
  });

  it("횟수가 모자라면 그때까지의 최선을 준다 — 실패로 던지지 않는다", async () => {
    const b = fakeBuilder(linear);
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 1, max: 100, maxAttempts: 2 },
      b.build,
    );
    expect(b.seen).toEqual([100, 1]);
    expect(hit).toMatchObject({ value: 1, bytes: 1000, met: true, attempts: 2 });
  });

  it("시도마다 번호와 상한을 알린다 — 화면이 멈춘 것처럼 보이지 않게", async () => {
    const seen: AttemptInfo[] = [];
    const b = fakeBuilder(linear);
    await searchTarget({ targetBytes: 42_000, min: 0, max: 11 }, b.build, (info) =>
      seen.push(info),
    );
    expect(seen.length).toBe(b.seen.length);
    expect(seen.map((s) => s.index)).toEqual(seen.map((_, i) => i + 1));
    for (const s of seen) expect(s.index).toBeLessThanOrEqual(s.max);
  });
});

describe("래스터 사다리 — 해상도 × 품질을 축 하나로 세운다", () => {
  /** 화면에서 고를 수 있는 조합 전부(Compress.svelte의 dpis × qualities). */
  const CAPS: RasterStep[] = [96, 144, 200].flatMap((dpi) =>
    [85, 70, 55].map((quality) => ({ dpi, quality })),
  );

  /** cap에서 세운 사다리를 위(좋은 쪽)부터 나열한다 — 값이 클수록 위다. */
  const ladderOf = (cap: RasterStep) =>
    Array.from({ length: rasterSteps(cap) }, (_, i) =>
      rasterStepAt(rasterSteps(cap) - 1 - i, cap),
    );

  it("★ 어떤 설정에서도 맨 위 칸이 그 설정이다", () => {
    for (const cap of CAPS) {
      expect(rasterStepAt(rasterSteps(cap) - 1, cap)).toEqual(cap);
    }
  });

  it("★ 고른 것보다 해상도가 높거나 품질이 좋은 칸은 사다리 어디에도 없다", () => {
    for (const cap of CAPS) {
      for (const step of ladderOf(cap)) {
        expect(step.dpi).toBeLessThanOrEqual(cap.dpi);
        expect(step.quality).toBeLessThanOrEqual(cap.quality);
      }
    }
  });

  it("목표가 헐거우면 고른 설정 그대로를 돌려준다", async () => {
    const cap = { dpi: 96, quality: 55 };
    const hit = await searchTarget(
      { targetBytes: 9_000_000, min: 0, max: rasterSteps(cap) - 1 },
      async (value) => ({ bytes: 1000, result: rasterStepAt(value, cap) }),
    );
    expect(hit).toMatchObject({ met: true, attempts: 1 });
    expect(hit!.result).toEqual(cap);
  });

  it("값이 작아질수록 해상도는 오르지 않는다", () => {
    for (const cap of CAPS) {
      for (let v = rasterSteps(cap) - 1; v > 0; v--) {
        expect(rasterStepAt(v - 1, cap).dpi).toBeLessThanOrEqual(
          rasterStepAt(v, cap).dpi,
        );
      }
    }
  });

  it("해상도가 같은 구간에서는 값이 작아질수록 품질이 내려간다", () => {
    for (const cap of CAPS) {
      for (let v = rasterSteps(cap) - 1; v > 0; v--) {
        const upper = rasterStepAt(v, cap);
        const lower = rasterStepAt(v - 1, cap);
        if (lower.dpi === upper.dpi) {
          expect(lower.quality).toBeLessThan(upper.quality);
        }
      }
    }
  });

  it("같은 칸이 두 번 나오지 않는다 — 같은 설정으로 두 번 그리는 셈이다", () => {
    for (const cap of CAPS) {
      const keys = ladderOf(cap).map((s) => `${s.dpi}@${s.quality}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("어떤 설정에서도 짚을 칸이 둘 이상 남는다 — 탐색할 여지가 있다", () => {
    for (const cap of CAPS) expect(rasterSteps(cap)).toBeGreaterThan(1);
  });

  it("칸 값은 정해진 범위 안이다", () => {
    for (const cap of CAPS) {
      for (const step of ladderOf(cap)) {
        expect(step.dpi).toBeGreaterThanOrEqual(MIN_DPI);
        expect(step.quality).toBeGreaterThanOrEqual(MIN_QUALITY);
      }
    }
  });

  it("범위 밖 값은 양 끝으로 붙잡힌다", () => {
    const cap = { dpi: 144, quality: 70 };
    expect(rasterStepAt(-5, cap)).toEqual(rasterStepAt(0, cap));
    expect(rasterStepAt(999, cap)).toEqual(rasterStepAt(rasterSteps(cap) - 1, cap));
  });

  it("범위 밖 설정도 붙잡힌다 — 화면 밖에서 들어온 값에 사다리가 무너지지 않는다", () => {
    expect(rasterStepAt(rasterSteps({ dpi: 9999, quality: 999 }) - 1, {
      dpi: 9999,
      quality: 999,
    })).toEqual({ dpi: MAX_DPI, quality: MAX_QUALITY });
    expect(
      rasterStepAt(rasterSteps({ dpi: 1, quality: 0 }) - 1, { dpi: 1, quality: 0 }),
    ).toEqual({ dpi: MIN_DPI, quality: MIN_QUALITY });
  });

  it("★ 시도 횟수를 안 주면 계획된 횟수만으로 어느 사다리든 끝까지 좁힌다", async () => {
    // ATTEMPT_CAP=6의 근거는 "양 끝 둘 + 남은 구간의 이진 넷"이고, 가장 긴 사다리가
    // 12칸이라 그 산수가 딱 맞는다. 맞는다고 믿지 말고 칸마다 최적이 그 칸이 되도록
    // 목표를 잡아 전부 훑는다 — 사다리를 늘리면 여기가 먼저 깨진다.
    const sizeOf = (v: number) => (v + 1) * 1000;
    const miss: string[] = [];
    for (const cap of CAPS) {
      const steps = rasterSteps(cap);
      for (let opt = 0; opt < steps; opt++) {
        const hit = await searchTarget(
          { targetBytes: sizeOf(opt), min: 0, max: steps - 1 },
          async (v) => ({ bytes: sizeOf(v), result: v }),
        );
        if (!hit!.met || hit!.value !== opt) {
          miss.push(
            `${cap.dpi}@${cap.quality} 칸=${steps} 기대=${opt} 실제=${hit!.value} 예산=${plannedAttempts(0, steps - 1)}`,
          );
        }
      }
    }
    expect(miss).toEqual([]);
  });

  it("사다리를 타고 목표 아래로 내려간다", async () => {
    const cap = { dpi: 200, quality: 85 };
    // 넓이 × 품질에 비례하는 가짜 크기표.
    const bytesOf = (value: number) => {
      const step = rasterStepAt(value, cap);
      return Math.round(step.dpi ** 2 * step.quality * 0.4);
    };
    const hit = await searchTarget(
      { targetBytes: 300_000, min: 0, max: rasterSteps(cap) - 1, maxAttempts: 12 },
      async (value) => ({ bytes: bytesOf(value), result: rasterStepAt(value, cap) }),
    );
    expect(hit!.met).toBe(true);
    expect(hit!.bytes).toBeLessThanOrEqual(300_000);
    expect(hit!.result).toEqual(rasterStepAt(hit!.value, cap));
  });
});

describe("★ 결과가 원본보다 크면 원본을 그대로 돌려준다", () => {
  // 실측: 이미 압축된 2394바이트 PDF에 qpdf를 돌리면 2437바이트(101.8%)가 된다.
  it("커진 경우 원본을 고르고 그렇게 말한다", () => {
    const choice = chooseSmaller(
      { bytes: 2394, data: "원본" },
      { bytes: 2437, data: "압축본" },
    );
    expect(choice.data).toBe("원본");
    expect(choice.keptOriginal).toBe(true);
    expect(choice.report.resultBytes).toBe(2394);
    expect(choice.report.verdict).toBe("same");
    expect(choice.report.savedBytes).toBe(0);
  });

  it("바이트 수가 같아도 원본이 이긴다 — 얻는 것이 없다", () => {
    const choice = chooseSmaller({ bytes: 1000, data: "원본" }, { bytes: 1000, data: "압축본" });
    expect(choice.data).toBe("원본");
    expect(choice.keptOriginal).toBe(true);
  });

  it("작아지면 압축본을 고르고 줄어든 양을 적는다", () => {
    const choice = chooseSmaller(
      { bytes: 4_186_230, data: "원본" },
      { bytes: 3_196_974, data: "압축본" },
    );
    expect(choice.data).toBe("압축본");
    expect(choice.keptOriginal).toBe(false);
    expect(choice.report.savedBytes).toBe(989_256);
    expect(choice.report.percent).toBe(76.4);
    expect(choice.report.verdict).toBe("smaller");
  });

  it("★ 0바이트 결과는 채택하지 않는다 — 만들다 만 것이다", () => {
    const choice = chooseSmaller({ bytes: 1000, data: "원본" }, { bytes: 0, data: "빈것" });
    expect(choice.data).toBe("원본");
    expect(choice.keptOriginal).toBe(true);
  });

  it("★ 원본이 0바이트면 잴 것이 없다 — 비율은 null이다", () => {
    const choice = chooseSmaller({ bytes: 0, data: "원본" }, { bytes: 0, data: "압축본" });
    expect(choice.keptOriginal).toBe(true);
    expect(choice.report.percent).toBeNull();
    expect(choice.report.verdict).toBe("same");
  });
});

describe("용량 표시 계산", () => {
  it("비율은 소수 첫째 자리까지 적는다", () => {
    expect(sizeReport(1000, 500).percent).toBe(50);
    expect(sizeReport(4_186_230, 3_162_487).percent).toBe(75.5);
    expect(sizeReport(2_274_458, 230_781).percent).toBe(10.1);
  });

  it("줄어든 양은 원본 − 결과다", () => {
    expect(sizeReport(1000, 400).savedBytes).toBe(600);
  });

  it("커진 경우를 커졌다고 적는다 — 음수로 남긴다", () => {
    const r = sizeReport(1000, 1200);
    expect(r.verdict).toBe("larger");
    expect(r.savedBytes).toBe(-200);
    expect(r.percent).toBe(120);
  });

  it("음수·NaN 바이트는 0으로 본다", () => {
    expect(sizeReport(-5, Number.NaN)).toMatchObject({
      originalBytes: 0,
      resultBytes: 0,
      percent: null,
      verdict: "same",
    });
  });

  it("1000 단위로 끊어 적는다", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.0 kB");
    expect(formatBytes(230_781)).toBe("230.8 kB");
    expect(formatBytes(4_186_230)).toBe("4.2 MB");
  });

  it("★ kB의 위 경계에서 1000.0 kB라고 적지 않는다", () => {
    expect(formatBytes(999_949)).toBe("999.9 kB");
    expect(formatBytes(999_999)).toBe("1.0 MB");
    expect(formatBytes(1_000_000)).toBe("1.0 MB");
  });
});

describe("★ 망가진 입력에도 탐색이 끝난다", () => {
  it("구간이 NaN이면 0..0으로 잘라 한 번만 짚는다", async () => {
    const b = fakeBuilder(linear);
    const hit = await searchTarget(
      { targetBytes: 1000, min: Number.NaN, max: Number.NaN },
      b.build,
    );
    expect(b.seen).toEqual([0]);
    expect(hit).toMatchObject({ value: 0, bytes: 0, met: true });
  });

  it("구간이 Infinity여도 멈춘다", async () => {
    const b = fakeBuilder(linear);
    await searchTarget(
      { targetBytes: 1000, min: 0, max: Number.POSITIVE_INFINITY, maxAttempts: 4 },
      b.build,
    );
    expect(b.seen.length).toBeLessThanOrEqual(4);
    expect(b.seen.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("maxAttempts가 NaN이면 ATTEMPT_CAP으로 본다", () => {
    const plan = createPlan({ targetBytes: 10, min: 0, max: 11, maxAttempts: Number.NaN });
    expect(plan.maxAttempts).toBe(ATTEMPT_CAP);
  });

  it("계획된 횟수는 어떤 구간에서도 1 이상 ATTEMPT_CAP 이하다", () => {
    for (const [min, max] of [
      [0, 0],
      [5, 5],
      [0, 11],
      [-9, 9],
      [Number.NaN, 3],
      [0, Number.POSITIVE_INFINITY],
    ]) {
      const n = plannedAttempts(min, max);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(ATTEMPT_CAP);
    }
  });

  it("사다리 칸을 NaN으로 물어도 양 끝 안쪽을 돌려준다", () => {
    const cap = { dpi: 144, quality: 70 };
    expect(rasterStepAt(Number.NaN, cap)).toEqual(rasterStepAt(0, cap));
    // NaN 설정은 양 끝으로 붙잡혀 맨 아래 칸 하나로 접힌다 — 칸이 하나여도 탐색은 끝난다.
    const nanCap = { dpi: Number.NaN, quality: Number.NaN };
    expect(rasterSteps(nanCap)).toBe(1);
    expect(rasterStepAt(0, nanCap)).toEqual({ dpi: MIN_DPI, quality: MIN_QUALITY });
  });

  it("칸이 하나뿐인 사다리에서도 한 번 짚고 끝난다", async () => {
    const b = fakeBuilder(linear);
    const hit = await searchTarget({ targetBytes: 1, min: 0, max: 0 }, b.build);
    expect(b.seen).toEqual([0]);
    expect(hit).toMatchObject({ value: 0, met: true, attempts: 1 });
  });

  it("쪽 수가 Infinity면 가장 짧은 예산을 쓴다", () => {
    expect(attemptBudget(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("★ 목표 용량 입력의 경계", () => {
  it("지수 표기와 앞뒤 공백을 읽는다", () => {
    expect(targetBytesFromMb("1e1")).toBe(10_000_000);
    expect(targetBytesFromMb("\t2\n")).toBe(2_000_000);
  });

  it("Infinity·전각 숫자·쉼표는 목표로 삼지 않거나 앞부분만 읽는다", () => {
    expect(targetBytesFromMb("Infinity")).toBeNull();
    expect(targetBytesFromMb("１")).toBeNull();
    expect(targetBytesFromMb("1,5")).toBe(1_000_000);
  });

  it("아주 작은 목표도 0보다 크면 목표로 삼는다", () => {
    expect(targetBytesFromMb("0.0001")).toBe(100);
  });
});

describe("목표 용량 입력", () => {
  it("MB를 바이트로 옮긴다", () => {
    expect(targetBytesFromMb("1")).toBe(1_000_000);
    expect(targetBytesFromMb("2.5")).toBe(2_500_000);
    expect(targetBytesFromMb(" 0.5 ")).toBe(500_000);
  });

  it("비었거나 0 이하거나 숫자가 아니면 목표를 안 쓴다", () => {
    for (const input of ["", "  ", "0", "-1", "abc"]) {
      expect(targetBytesFromMb(input)).toBeNull();
    }
  });

  it("★ 목표가 원본보다 크면 짚어 볼 것이 없다", () => {
    expect(alreadyUnderTarget(1_000_000, 2_000_000)).toBe(true);
    expect(alreadyUnderTarget(2_000_000, 2_000_000)).toBe(true);
    expect(alreadyUnderTarget(3_000_000, 2_000_000)).toBe(false);
  });

  it("원본이 0바이트면 목표를 맞췄다고 하지 않는다", () => {
    expect(alreadyUnderTarget(0, 2_000_000)).toBe(false);
  });
});
