import { describe, expect, it } from "vitest";

import {
  ATTEMPT_CAP,
  createPlan,
  nextValue,
  planOutcome,
  plannedAttempts,
  pngStepAt,
  pngSteps,
  recordAttempt,
  searchTarget,
  type AttemptInfo,
} from "../apps/image/src/lib/image/target";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 명세다. apps/image의 "목표 용량"은 계획(target.ts)과 인코딩(pipeline.ts)이
// 갈라져 있다 — 여기서는 가짜 인코더를 물려 계획만 잰다.
//
// 계약은 넷이다.
//   ① 맞췄다(met=true)고 말하는 결과는 **실제로 잰 바이트가 목표 이하**다.
//   ② 하나도 못 맞추면 **가장 작은 결과**를 주고 met=false로 말한다(조용히 큰 파일 금지).
//   ③ 시도 횟수는 maxAttempts를 절대 넘지 않는다.
//   ④ 축의 맨 위는 **사용자가 고른 설정**이다 — 목표 용량은 더 줄이기만 하지 더 좋게(=더 크게)
//      만들지 않는다. 품질 축은 구간 [1, 사용자 품질]로, PNG 사다리는 사용자가 고른 색 수를
//      상한으로 눌러 이 약속을 지킨다.
// ①②③은 단조 가정(값이 클수록 크다)이 깨져도 지켜져야 한다 — 재인코딩은 단조가 아니다.
// ─────────────────────────────────────────────────────────────────────────────

/** 값 → 바이트 표를 받아 시도 기록을 남기는 가짜 인코더. */
function fakeEncoder(sizeOf: (value: number) => number) {
  const seen: number[] = [];
  return {
    seen,
    encode: async (value: number) => {
      seen.push(value);
      return { bytes: sizeOf(value), result: `q${value}` };
    },
  };
}

/** 품질이 곧 용량인 가장 단순한 그림 — 품질 q에서 q * 1000바이트. */
const linear = (value: number) => value * 1000;

describe("plannedAttempts — 재인코딩 횟수의 상한", () => {
  it("구간이 넓어도 ATTEMPT_CAP을 넘지 않는다", () => {
    expect(plannedAttempts(1, 100)).toBeLessThanOrEqual(ATTEMPT_CAP);
    expect(plannedAttempts(1, 100000)).toBe(ATTEMPT_CAP);
  });

  it("구간이 하나뿐이면 몇 번을 잡든 실제 시도는 한 번으로 끝난다", () => {
    const plan = createPlan({ targetBytes: 10, min: 7, max: 7 });
    expect(nextValue(plan)).toBe(7);
    recordAttempt(plan, 7, 5);
    expect(nextValue(plan)).toBeNull();
    expect(plan.attempts).toHaveLength(1);
  });

  it("구간이 넓을수록 시도 횟수가 늘지만 로그로만 는다", () => {
    expect(plannedAttempts(1, 2)).toBeLessThan(plannedAttempts(1, 64));
  });
});

describe("양 끝을 먼저 짚는다", () => {
  it("지금 설정(상한)으로 이미 목표를 맞추면 한 번에 끝난다", async () => {
    const enc = fakeEncoder(linear);
    const hit = await searchTarget({ targetBytes: 100_000, min: 1, max: 100 }, enc.encode);
    expect(enc.seen).toEqual([100]);
    expect(hit).toMatchObject({ value: 100, bytes: 100_000, met: true, attempts: 1 });
  });

  it("아래 끝으로도 못 맞추면 두 번 만에 포기한다", async () => {
    const enc = fakeEncoder(linear);
    const hit = await searchTarget({ targetBytes: 500, min: 1, max: 100 }, enc.encode);
    // 100 → 100000(초과), 1 → 1000(초과). 더 볼 것이 없다.
    expect(enc.seen).toEqual([100, 1]);
    expect(hit?.met).toBe(false);
    expect(hit?.value).toBe(1);
    expect(hit?.bytes).toBe(1000);
  });
});

describe("이진 탐색 수렴 — 목표 이하의 가장 높은 값", () => {
  it("경계가 딱 떨어지는 표에서 정확히 그 값을 집는다", async () => {
    // 목표 42000바이트 → q=42가 딱 맞고 q=43은 넘는다.
    const enc = fakeEncoder(linear);
    const hit = await searchTarget({ targetBytes: 42_000, min: 1, max: 100 }, enc.encode);
    expect(hit).toMatchObject({ value: 42, bytes: 42_000, met: true });
    expect(enc.seen.length).toBeLessThanOrEqual(ATTEMPT_CAP);
  });

  it("목표보다 큰 결과를 채택하지 않는다", async () => {
    for (const target of [1500, 9000, 33_333, 99_999]) {
      const hit = await searchTarget(
        { targetBytes: target, min: 1, max: 100 },
        fakeEncoder(linear).encode,
      );
      expect(hit).not.toBeNull();
      if (hit!.met) expect(hit!.bytes).toBeLessThanOrEqual(target);
    }
  });

  it("찾은 값보다 한 칸 높은 값은 실제로 목표를 넘는다 (더 높일 여지가 없다)", async () => {
    // 시도 횟수를 넉넉히 줘서 이진 탐색이 끝까지 좁히게 한다.
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 1, max: 100, maxAttempts: 12 },
      fakeEncoder(linear).encode,
    );
    expect(hit!.value).toBe(42);
    expect(linear(hit!.value + 1)).toBeGreaterThan(42_000);
  });

  it("채택한 결과물은 그 값으로 인코딩한 것이다 — 다시 인코딩하지 않는다", async () => {
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 1, max: 100 },
      fakeEncoder(linear).encode,
    );
    expect(hit!.result).toBe(`q${hit!.value}`);
  });

  it("구간을 거꾸로 줘도(min>max) 같은 답을 낸다", async () => {
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 100, max: 1 },
      fakeEncoder(linear).encode,
    );
    expect(hit).toMatchObject({ value: 42, met: true });
  });
});

describe("단조 가정이 깨져도 거짓말하지 않는다", () => {
  // 실제 인코더는 단조가 아니다 — 품질을 낮췄는데 커지는 구간이 있다.
  // 그래도 met=true인 결과는 반드시 목표 이하여야 하고, 채택값은 실제로 재 본 값이어야 한다.
  const jagged = (value: number) => {
    const noise = [0, 9000, -4000, 2000, -7000][value % 5];
    return Math.max(100, value * 1000 + noise);
  };

  it("톱니 모양 표에서도 맞췄다고 한 결과는 실제로 목표 이하다", async () => {
    for (let target = 2000; target <= 100_000; target += 1300) {
      const enc = fakeEncoder(jagged);
      const hit = await searchTarget({ targetBytes: target, min: 1, max: 100 }, enc.encode);
      expect(hit).not.toBeNull();
      // 채택값은 실제로 짚어 본 값이고, 잰 바이트도 그 값의 것이다.
      expect(enc.seen).toContain(hit!.value);
      expect(hit!.bytes).toBe(jagged(hit!.value));
      if (hit!.met) expect(hit!.bytes).toBeLessThanOrEqual(target);
    }
  });

  it("아래로 갈수록 커지는(뒤집힌) 표에서도 맞춘 것만 met으로 센다", async () => {
    const inverted = (value: number) => (101 - value) * 1000;
    const enc = fakeEncoder(inverted);
    const hit = await searchTarget({ targetBytes: 5000, min: 1, max: 100 }, enc.encode);
    // 상한(100)이 1000바이트로 이미 맞는다 → 한 번에 끝난다.
    expect(hit).toMatchObject({ value: 100, bytes: 1000, met: true });
    expect(hit!.bytes).toBeLessThanOrEqual(5000);
  });

  it("계단 중간이 튀어 목표를 놓쳐도 못 맞췄다고 말하지 조용히 큰 것을 주지 않는다", async () => {
    // 어떤 값에서도 목표 아래로 못 내려가는 표.
    const floorBound = (value: number) => 50_000 + value;
    const hit = await searchTarget(
      { targetBytes: 10_000, min: 1, max: 100 },
      fakeEncoder(floorBound).encode,
    );
    expect(hit!.met).toBe(false);
    expect(hit!.bytes).toBeGreaterThan(10_000);
  });
});

describe("목표를 못 맞추면 가장 작은 후보를 돌려준다", () => {
  it("짚어 본 것 중 가장 작은 결과를 준다", async () => {
    const table: Record<number, number> = {};
    const sizeOf = (value: number) => {
      // 값이 클수록 크되, 최소가 여전히 목표를 넘는다.
      const bytes = 30_000 + value * 100;
      table[value] = bytes;
      return bytes;
    };
    const enc = fakeEncoder(sizeOf);
    const hit = await searchTarget({ targetBytes: 1000, min: 1, max: 100 }, enc.encode);
    expect(hit!.met).toBe(false);
    const smallest = Math.min(...enc.seen.map((v) => table[v]));
    expect(hit!.bytes).toBe(smallest);
    expect(hit!.result).toBe(`q${hit!.value}`);
  });

  it("용량이 같으면 값이 높은 쪽(품질이 나은 쪽)을 남긴다", () => {
    const plan = createPlan({ targetBytes: 10, min: 1, max: 100 });
    recordAttempt(plan, 20, 5000);
    recordAttempt(plan, 60, 5000);
    expect(planOutcome(plan)).toMatchObject({ value: 60, met: false });
  });

  it("한 번도 인코딩하지 않았으면 답이 없다", () => {
    const plan = createPlan({ targetBytes: 10, min: 1, max: 100 });
    expect(planOutcome(plan)).toBeNull();
  });
});

describe("최대 시도 횟수를 지킨다", () => {
  it("maxAttempts를 넘겨 인코딩하지 않는다", async () => {
    for (const maxAttempts of [1, 2, 3, 5]) {
      const enc = fakeEncoder(linear);
      await searchTarget({ targetBytes: 42_000, min: 1, max: 100, maxAttempts }, enc.encode);
      expect(enc.seen.length).toBeLessThanOrEqual(maxAttempts);
    }
  });

  it("횟수가 모자라면 그때까지의 최선을 준다 — 실패로 던지지 않는다", async () => {
    const enc = fakeEncoder(linear);
    const hit = await searchTarget(
      { targetBytes: 42_000, min: 1, max: 100, maxAttempts: 2 },
      enc.encode,
    );
    // 100(초과) → 1(1000, 맞음)에서 끊긴다. 42는 못 찾지만 거짓말은 하지 않는다.
    expect(enc.seen).toEqual([100, 1]);
    expect(hit).toMatchObject({ value: 1, bytes: 1000, met: true, attempts: 2 });
  });

  it("횟수를 지정하지 않으면 계획된 상한 안에서 끝난다", async () => {
    const enc = fakeEncoder(linear);
    await searchTarget({ targetBytes: 42_000, min: 1, max: 100 }, enc.encode);
    expect(enc.seen.length).toBeLessThanOrEqual(plannedAttempts(1, 100));
  });

  it("같은 값을 두 번 인코딩하지 않는다", async () => {
    const enc = fakeEncoder(linear);
    await searchTarget({ targetBytes: 42_000, min: 1, max: 100, maxAttempts: 12 }, enc.encode);
    expect(new Set(enc.seen).size).toBe(enc.seen.length);
  });
});

describe("계획된 횟수가 정말 끝까지 좁히기에 충분한가", () => {
  // ATTEMPT_CAP=9와 plannedAttempts의 근거는 "양 끝 둘 + 이진 log2"다. 그 산수가 맞는지
  // 한 케이스로 확인하면 구간을 좁혔을 때(사용자가 품질을 낮춰 잡았을 때) 조용히 최적을
  // 놓치는 것을 못 잡는다 — 그래서 모든 최적값을 훑는다.
  it("단조 표에서는 어떤 상한·목표에서도 정확히 최적값에 닿는다", async () => {
    const miss: string[] = [];
    for (const max of [1, 2, 3, 5, 8, 21, 37, 64, 100]) {
      for (let opt = 0; opt <= max; opt++) {
        // opt가 딱 맞고 opt+1은 넘도록 목표를 잡는다. opt=0은 어느 값으로도 못 맞추는 경우.
        const target = opt === 0 ? linear(1) - 1 : linear(opt);
        const hit = await searchTarget(
          { targetBytes: target, min: 1, max },
          fakeEncoder(linear).encode,
        );
        if (opt === 0) {
          if (hit!.met) miss.push(`max=${max} 못 맞춰야 하는데 met=true`);
        } else if (!hit!.met || hit!.value !== opt) {
          miss.push(`max=${max} 기대=${opt} 실제=${hit!.value} met=${hit!.met}`);
        }
      }
    }
    expect(miss).toEqual([]);
  });

  it("못 맞춘 경우 돌려준 것이 짚어 본 것 중 실제로 가장 작다", async () => {
    // 톱니 표에서 met=false가 나오는 목표를 훑는다.
    const jagged = (v: number) => 40_000 + ((v * 7919) % 5000);
    for (let target = 30_000; target <= 40_000; target += 500) {
      const enc = fakeEncoder(jagged);
      const hit = await searchTarget({ targetBytes: target, min: 1, max: 100 }, enc.encode);
      expect(hit!.met).toBe(false);
      expect(hit!.bytes).toBe(Math.min(...enc.seen.map(jagged)));
    }
  });
});

describe("진행 알림 — 화면이 멈춘 것처럼 보이지 않게", () => {
  it("시도마다 번호와 상한을 함께 알린다", async () => {
    const seen: AttemptInfo[] = [];
    const enc = fakeEncoder(linear);
    await searchTarget({ targetBytes: 42_000, min: 1, max: 100 }, enc.encode, (info) =>
      seen.push(info),
    );
    expect(seen.length).toBe(enc.seen.length);
    expect(seen.map((s) => s.index)).toEqual(seen.map((_, i) => i + 1));
    for (const s of seen) {
      expect(s.max).toBe(plannedAttempts(1, 100));
      expect(s.index).toBeLessThanOrEqual(s.max);
    }
  });
});

describe("품질 축의 상한 — 부탁한 것보다 좋은 결과를 돌려주지 않는다", () => {
  it("상한 위의 값은 아예 짚지 않는다", async () => {
    // pipeline.ts가 max에 사용자가 고른 품질을 넣는다. 탐색기가 그 위를 짚으면
    // 목표 용량을 켠 것만으로 부탁한 것보다 큰 파일이 나온다.
    const enc = fakeEncoder(linear);
    await searchTarget({ targetBytes: 500_000, min: 1, max: 60 }, enc.encode);
    expect(Math.max(...enc.seen)).toBeLessThanOrEqual(60);
  });

  it("목표가 헐거우면 상한 그대로를 돌려준다", async () => {
    const hit = await searchTarget(
      { targetBytes: 500_000, min: 1, max: 60 },
      fakeEncoder(linear).encode,
    );
    expect(hit).toMatchObject({ value: 60, met: true, attempts: 1 });
  });
});

describe("PNG 사다리 — 품질이 없는 형식의 탐색 축", () => {
  /** null(=색을 안 줄임)은 어떤 색 수보다도 위다. */
  const rank = (c: number | null) => (c === null ? Infinity : c);

  /** 화면에서 고를 수 있는 색 수 전부 + "원본"(null). null이 기본값이다. */
  const CAPS: (number | null)[] = [null, 256, 128, 64, 32, 16, 8, 4, 3, 2];

  /** cap에서 세운 사다리를 위(좋은 쪽)부터 나열한다 — 값이 클수록 위다. */
  const ladderOf = (cap: number | null) =>
    Array.from({ length: pngSteps(cap) }, (_, i) => pngStepAt(pngSteps(cap) - 1 - i, cap));

  // ── 축의 시작 칸 = 사용자가 고른 설정 ──────────────────────────────────────
  // 이것이 계약 ④다. 예전에는 사다리가 고정이라 사용자가 색 4를 골라 둬도 목표가 헐거우면
  // 맨 위 칸(원본 색)을 돌려줬다 — 목표 용량을 켜는 것만으로 설정보다 큰 파일이 나왔다.

  it("색을 고르지 않았으면(원본 색) 맨 위 칸은 색을 줄이지 않는다", () => {
    // 실측: 크로미엄에서 그라디언트 사진을 256색으로 줄이면 PNG가 109%로 **커진다**.
    // 그래서 "아무것도 안 하는" 칸이 맨 위에 있어야 목표를 켠 쪽이 끈 쪽보다 나쁘지 않다.
    expect(pngStepAt(pngSteps(null) - 1, null)).toEqual({ colors: null, scale: 100 });
    expect(pngStepAt(pngSteps(null) - 2, null)).toEqual({ colors: 256, scale: 100 });
  });

  it("상한(256)을 골랐으면 맨 위 칸이 256색이다 — 원본 색 칸은 후보에 없다", () => {
    expect(pngStepAt(pngSteps(256) - 1, 256)).toEqual({ colors: 256, scale: 100 });
    for (const step of ladderOf(256)) expect(step.colors).not.toBeNull();
  });

  it("색 4를 골랐으면 맨 위 칸이 색 4·100%다", () => {
    expect(pngStepAt(pngSteps(4) - 1, 4)).toEqual({ colors: 4, scale: 100 });
  });

  it("색 2(하한)를 골랐으면 색은 2로 붙박이고 크기만 내려간다", () => {
    const ladder = ladderOf(2);
    expect(ladder[0]).toEqual({ colors: 2, scale: 100 });
    for (const step of ladder) expect(step.colors).toBe(2);
    expect(ladder.length).toBeGreaterThan(1); // 크기 축이 남아 탐색할 여지가 있다
  });

  it("어떤 cap에서도 맨 위 칸이 곧 그 설정이다", () => {
    for (const cap of CAPS) {
      const top = pngStepAt(pngSteps(cap) - 1, cap);
      expect(top.scale).toBe(100); // 100% = 사용자가 고른 리사이즈 그대로
      expect(top.colors).toBe(cap);
    }
  });

  it("고른 색 수보다 색이 많은 칸은 사다리 어디에도 없다", () => {
    for (const cap of CAPS) {
      for (const step of ladderOf(cap)) {
        expect(rank(step.colors)).toBeLessThanOrEqual(rank(cap));
        expect(step.scale).toBeLessThanOrEqual(100); // 리사이즈 설정도 상한이다
      }
    }
  });

  it("고른 색 수보다 큰 결과를 절대 채택하지 않는다 — 목표가 어떻든", async () => {
    // 색 수 × 넓이에 비례하는 가짜 크기표. 목표를 아주 헐거운 것부터 도저히 못 맞추는 것까지.
    const bytesOf = (cap: number | null) => (value: number) => {
      const step = pngStepAt(value, cap);
      return Math.round((step.colors ?? 512) * 400 * (step.scale / 100) ** 2);
    };
    for (const cap of CAPS) {
      const sizeOf = bytesOf(cap);
      for (const target of [10, 900, 5_000, 30_000, 200_000, 9_000_000]) {
        const hit = await searchTarget(
          { targetBytes: target, min: 0, max: pngSteps(cap) - 1 },
          async (value) => ({ bytes: sizeOf(value), result: pngStepAt(value, cap) }),
        );
        expect(rank(hit!.result.colors)).toBeLessThanOrEqual(rank(cap));
      }
    }
  });

  it("목표가 헐거우면 고른 설정 그대로를 돌려준다 — 색 4는 색 4로 나온다", async () => {
    const hit = await searchTarget(
      { targetBytes: 9_000_000, min: 0, max: pngSteps(4) - 1 },
      async (value) => ({ bytes: 1000, result: pngStepAt(value, 4) }),
    );
    expect(hit).toMatchObject({ met: true, attempts: 1 });
    expect(hit!.result).toEqual({ colors: 4, scale: 100 });
  });

  // ── 사다리의 모양(어떤 cap에서도 지켜야 할 것) ────────────────────────────

  it("가장 작은 값은 색도 크기도 가장 많이 줄인 칸이다", () => {
    for (const cap of CAPS) {
      const worst = pngStepAt(0, cap);
      const best = pngStepAt(pngSteps(cap) - 1, cap);
      expect(rank(worst.colors)).toBeLessThanOrEqual(rank(best.colors));
      expect(worst.scale).toBeLessThan(best.scale);
    }
  });

  // 사다리는 "크기를 먼저 지킨다"는 **선호 순서**지 용량 순서가 아니다.
  // (색 8·배율 100%가 색 64·배율 75%보다 클 수도 있다.) 그래서 배율은 절대 오르지 않고,
  // 같은 배율 안에서만 색 수가 줄어든다 — 용량이 순서를 어기는 것은 탐색기가 감당한다.
  it("값이 작아질수록 배율은 절대 오르지 않는다", () => {
    for (const cap of CAPS) {
      for (let v = pngSteps(cap) - 1; v > 0; v--) {
        expect(pngStepAt(v - 1, cap).scale).toBeLessThanOrEqual(pngStepAt(v, cap).scale);
      }
    }
  });

  it("배율이 같은 구간 안에서는 값이 작아질수록 색 수가 줄어든다", () => {
    for (const cap of CAPS) {
      for (let v = pngSteps(cap) - 1; v > 0; v--) {
        const upper = pngStepAt(v, cap);
        const lower = pngStepAt(v - 1, cap);
        if (lower.scale === upper.scale) {
          expect(rank(lower.colors)).toBeLessThan(rank(upper.colors));
        }
      }
    }
  });

  it("같은 칸이 두 번 나오지 않는다 — 같은 설정을 두 번 인코딩하는 셈이다", () => {
    for (const cap of CAPS) {
      const keys = ladderOf(cap).map((s) => `${s.colors}@${s.scale}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("색을 먼저 줄이고 그 다음에 크기를 줄인다 — 원본 색 축의 위 여섯 칸은 배율이 100%다", () => {
    for (let i = 0; i < 6; i++) {
      expect(pngStepAt(pngSteps(null) - 1 - i, null).scale).toBe(100);
    }
  });

  it("색을 줄이는 칸은 전부 2..256 안이고, 배율은 0 초과 100 이하다", () => {
    for (const cap of CAPS) {
      for (const step of ladderOf(cap)) {
        if (step.colors !== null) {
          expect(step.colors).toBeGreaterThanOrEqual(2);
          expect(step.colors).toBeLessThanOrEqual(256);
        }
        expect(step.scale).toBeGreaterThan(0);
        expect(step.scale).toBeLessThanOrEqual(100);
      }
    }
  });

  it("범위 밖 값은 양 끝으로 붙잡힌다", () => {
    for (const cap of CAPS) {
      expect(pngStepAt(-5, cap)).toEqual(pngStepAt(0, cap));
      expect(pngStepAt(pngSteps(cap) + 99, cap)).toEqual(pngStepAt(pngSteps(cap) - 1, cap));
    }
  });

  it("범위 밖 cap도 붙잡힌다 — 화면 밖에서 들어온 값에 사다리가 무너지지 않는다", () => {
    expect(ladderOf(1000)).toEqual(ladderOf(256));
    expect(ladderOf(1)).toEqual(ladderOf(2));
    expect(ladderOf(0)).toEqual(ladderOf(2));
    expect(ladderOf(Number.NaN)).toEqual(ladderOf(2));
    expect(ladderOf(4.4)).toEqual(ladderOf(4));
  });

  // ── 짧아진 사다리에서도 수렴하는가 ────────────────────────────────────────

  it("계획된 횟수는 어떤 cap의 사다리도 끝까지 좁히기에 충분하다", async () => {
    // plannedAttempts = 2(양 끝) + ceil(log2(칸 수))이고, 양 끝을 짚고 나면 남는 구간은
    // 최대 칸 수 - 2다. 사다리가 짧아질수록 이 산수는 더 넉넉해지지만, "넉넉하다"를
    // 믿지 말고 칸마다 최적이 그 칸이 되도록 목표를 잡아 전부 훑는다.
    const sizeOf = (v: number) => (v + 1) * 1000;
    const miss: string[] = [];
    for (const cap of CAPS) {
      const steps = pngSteps(cap);
      for (let opt = 0; opt < steps; opt++) {
        const hit = await searchTarget(
          { targetBytes: sizeOf(opt), min: 0, max: steps - 1 },
          async (v) => ({ bytes: sizeOf(v), result: v }),
        );
        if (!hit!.met || hit!.value !== opt) {
          miss.push(`cap=${cap} 칸수=${steps} 기대=${opt} 실제=${hit!.value}`);
        }
      }
    }
    expect(miss).toEqual([]);
  });

  it("계획된 횟수의 산수 자체를 못 박는다 — 양 끝 둘 + 남은 구간의 이진 깊이", () => {
    for (const cap of CAPS) {
      const steps = pngSteps(cap);
      // 양 끝을 짚고 남는 최악의 구간은 steps - 2칸, 이진 탐색에 ceil(log2(steps-1))번.
      const needed = 2 + Math.ceil(Math.log2(Math.max(1, steps - 1)));
      expect(plannedAttempts(0, steps - 1)).toBeGreaterThanOrEqual(needed);
      expect(plannedAttempts(0, steps - 1)).toBeLessThanOrEqual(ATTEMPT_CAP);
    }
  });

  it("PNG 축도 같은 탐색기로 돈다 — 사다리를 타고 목표 아래로 내려간다", async () => {
    // 색 수 × 넓이에 비례하는 가짜 크기표(색을 안 줄이면 512색인 셈 친다).
    const bytesOf = (value: number) => {
      const step = pngStepAt(value, null);
      return Math.round((step.colors ?? 512) * 400 * (step.scale / 100) ** 2);
    };
    const hit = await searchTarget(
      { targetBytes: 8000, min: 0, max: pngSteps(null) - 1 },
      async (value) => ({ bytes: bytesOf(value), result: pngStepAt(value, null) }),
    );
    expect(hit!.met).toBe(true);
    expect(hit!.bytes).toBeLessThanOrEqual(8000);
    expect(hit!.result).toEqual(pngStepAt(hit!.value, null));
  });
});
