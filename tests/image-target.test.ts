import { describe, expect, it } from "vitest";

import {
  ATTEMPT_CAP,
  PNG_STEPS,
  createPlan,
  nextValue,
  planOutcome,
  plannedAttempts,
  pngStepAt,
  recordAttempt,
  searchTarget,
  type AttemptInfo,
} from "../apps/image/src/lib/image/target";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 명세다. apps/image의 "목표 용량"은 계획(target.ts)과 인코딩(pipeline.ts)이
// 갈라져 있다 — 여기서는 가짜 인코더를 물려 계획만 잰다.
//
// 계약은 셋이다.
//   ① 맞췄다(met=true)고 말하는 결과는 **실제로 잰 바이트가 목표 이하**다.
//   ② 하나도 못 맞추면 **가장 작은 결과**를 주고 met=false로 말한다(조용히 큰 파일 금지).
//   ③ 시도 횟수는 maxAttempts를 절대 넘지 않는다.
// 이 셋은 단조 가정(값이 클수록 크다)이 깨져도 지켜져야 한다 — 재인코딩은 단조가 아니다.
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

describe("PNG 사다리 — 품질이 없는 형식의 탐색 축", () => {
  /** null(=색을 안 줄임)은 어떤 색 수보다도 위다. */
  const rank = (c: number | null) => (c === null ? Infinity : c);

  // 실측: 크로미엄에서 그라디언트 사진을 256색으로 줄이면 PNG가 109%로 **커진다**.
  // 그래서 "아무것도 안 하는" 칸이 맨 위에 있어야 목표 용량을 켠 쪽이 끈 쪽보다 나쁘지 않다.
  it("맨 위 칸은 색을 줄이지 않는다", () => {
    expect(pngStepAt(PNG_STEPS - 1)).toEqual({ colors: null, scale: 100 });
  });

  it("두 번째 칸부터 색을 줄이기 시작한다", () => {
    expect(pngStepAt(PNG_STEPS - 2)).toEqual({ colors: 256, scale: 100 });
  });

  it("가장 작은 값은 색도 크기도 가장 많이 줄인 칸이다", () => {
    const worst = pngStepAt(0);
    const best = pngStepAt(PNG_STEPS - 1);
    expect(rank(worst.colors)).toBeLessThan(rank(best.colors));
    expect(worst.scale).toBeLessThan(best.scale);
  });

  // 사다리는 "크기를 먼저 지킨다"는 **선호 순서**지 용량 순서가 아니다.
  // (색 8·배율 100%가 색 64·배율 75%보다 클 수도 있다.) 그래서 배율은 절대 오르지 않고,
  // 같은 배율 안에서만 색 수가 줄어든다 — 용량이 순서를 어기는 것은 탐색기가 감당한다.
  it("값이 작아질수록 배율은 절대 오르지 않는다", () => {
    for (let v = PNG_STEPS - 1; v > 0; v--) {
      expect(pngStepAt(v - 1).scale).toBeLessThanOrEqual(pngStepAt(v).scale);
    }
  });

  it("배율이 같은 구간 안에서는 값이 작아질수록 색 수가 줄어든다", () => {
    for (let v = PNG_STEPS - 1; v > 0; v--) {
      const upper = pngStepAt(v);
      const lower = pngStepAt(v - 1);
      if (lower.scale === upper.scale) {
        expect(rank(lower.colors)).toBeLessThan(rank(upper.colors));
      }
    }
  });

  it("같은 칸이 두 번 나오지 않는다", () => {
    const seen = new Set<string>();
    for (let v = 0; v < PNG_STEPS; v++) {
      const step = pngStepAt(v);
      seen.add(`${step.colors}@${step.scale}`);
    }
    expect(seen.size).toBe(PNG_STEPS);
  });

  it("색을 먼저 줄이고 그 다음에 크기를 줄인다 — 위 여섯 칸은 배율이 100%다", () => {
    for (let i = 0; i < 6; i++) expect(pngStepAt(PNG_STEPS - 1 - i).scale).toBe(100);
  });

  it("색을 줄이는 칸은 전부 2..256 안이고, 배율은 0 초과 100 이하다", () => {
    for (let v = 0; v < PNG_STEPS; v++) {
      const step = pngStepAt(v);
      if (step.colors !== null) {
        expect(step.colors).toBeGreaterThanOrEqual(2);
        expect(step.colors).toBeLessThanOrEqual(256);
      }
      expect(step.scale).toBeGreaterThan(0);
      expect(step.scale).toBeLessThanOrEqual(100);
    }
  });

  it("범위 밖 값은 양 끝으로 붙잡힌다", () => {
    expect(pngStepAt(-5)).toEqual(pngStepAt(0));
    expect(pngStepAt(PNG_STEPS + 99)).toEqual(pngStepAt(PNG_STEPS - 1));
  });

  it("사다리 22칸도 계획된 횟수 안에서 끝까지 좁혀진다", async () => {
    // 사다리를 늘리면 plannedAttempts(0, PNG_STEPS-1)가 모자라 조용히 중간에서 멈춘다.
    // 칸마다 최적이 그 칸이 되도록 목표를 잡아 전부 훑는다.
    const sizeOf = (v: number) => (v + 1) * 1000;
    const miss: string[] = [];
    for (let opt = 0; opt < PNG_STEPS; opt++) {
      const hit = await searchTarget(
        { targetBytes: sizeOf(opt), min: 0, max: PNG_STEPS - 1 },
        async (v) => ({ bytes: sizeOf(v), result: v }),
      );
      if (!hit!.met || hit!.value !== opt) miss.push(`기대=${opt} 실제=${hit!.value}`);
    }
    expect(miss).toEqual([]);
  });

  it("PNG 축도 같은 탐색기로 돈다 — 사다리를 타고 목표 아래로 내려간다", async () => {
    // 색 수 × 넓이에 비례하는 가짜 크기표(색을 안 줄이면 512색인 셈 친다).
    const bytesOf = (value: number) => {
      const step = pngStepAt(value);
      return Math.round((step.colors ?? 512) * 400 * (step.scale / 100) ** 2);
    };
    const hit = await searchTarget(
      { targetBytes: 8000, min: 0, max: PNG_STEPS - 1 },
      async (value) => ({ bytes: bytesOf(value), result: pngStepAt(value) }),
    );
    expect(hit!.met).toBe(true);
    expect(hit!.bytes).toBeLessThanOrEqual(8000);
    expect(hit!.result).toEqual(pngStepAt(hit!.value));
  });
});
