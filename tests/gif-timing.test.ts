import { describe, it, expect } from "vitest";
import {
  GIF_MIN_DELAY_MS,
  WEBP_MIN_DURATION_MS,
  MP4_MIN_DURATION_MS,
  formatMinDelayMs,
  effectiveDelayMs,
  isDelayFloored,
  type ExportFormat,
} from "../apps/gif/src/lib/gif/timing";

// CLAUDE.md 24번의 규약을 실행 가능한 형태로 옮긴 것.
// 화면에서 지운 안내("20ms 미만은 형식이 담지 못해 20ms로 저장돼요")가 여기 남는다.

const FORMATS: ExportFormat[] = ["gif", "webp", "mp4"];

describe("형식마다 프레임 딜레이 하한이 다르다", () => {
  it("GIF의 하한은 20ms다 — 1/100초 눈금에서 0·1은 브라우저가 100ms로 되돌리기 때문", () => {
    expect(GIF_MIN_DELAY_MS).toBe(20);
    expect(formatMinDelayMs("gif")).toBe(20);
  });

  it("WebP의 하한은 10ms다 — 0에 가까운 ANMF duration은 뷰어가 무시할 수 있다", () => {
    expect(WEBP_MIN_DURATION_MS).toBe(10);
    expect(formatMinDelayMs("webp")).toBe(10);
  });

  it("MP4의 하한은 10ms다 — 규격 제한이 아니라 0 길이 프레임을 muxer가 거부하는 것", () => {
    expect(MP4_MIN_DURATION_MS).toBe(10);
    expect(formatMinDelayMs("mp4")).toBe(10);
  });

  it("GIF의 하한만 나머지 둘의 두 배이고, WebP와 MP4는 서로 같다", () => {
    expect(formatMinDelayMs("webp")).toBe(formatMinDelayMs("mp4"));
    expect(formatMinDelayMs("gif")).toBe(formatMinDelayMs("webp") * 2);
  });

  it("같은 5ms 프레임이 형식에 따라 다른 답이 된다 — 형식 칩을 바꾸면 재생이 달라지는 이유", () => {
    expect(effectiveDelayMs(5, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(5, 1, "webp")).toBe(10);
    expect(effectiveDelayMs(5, 1, "mp4")).toBe(10);
  });
});

describe("GIF는 1/100초(10ms) 눈금에 스냅된다", () => {
  it("25ms는 10ms 눈금에서 반올림되어 30ms로 커진다 — 절반은 위로 간다", () => {
    expect(effectiveDelayMs(25, 1, "gif")).toBe(30);
  });

  it("24ms는 20ms로, 26ms는 30ms로 — 가까운 눈금을 고른다", () => {
    expect(effectiveDelayMs(24, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(26, 1, "gif")).toBe(30);
  });

  it("35ms는 40ms로 올라가고 33ms는 30ms로 내려간다", () => {
    expect(effectiveDelayMs(35, 1, "gif")).toBe(40);
    expect(effectiveDelayMs(33, 1, "gif")).toBe(30);
  });

  it("104ms는 100ms, 105ms는 110ms — 세 자리 값에서도 눈금은 10ms 그대로다", () => {
    expect(effectiveDelayMs(104, 1, "gif")).toBe(100);
    expect(effectiveDelayMs(105, 1, "gif")).toBe(110);
  });

  it("이미 눈금 위에 있는 값(20·100·1000ms)은 그대로 통과한다", () => {
    expect(effectiveDelayMs(20, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(100, 1, "gif")).toBe(100);
    expect(effectiveDelayMs(1000, 1, "gif")).toBe(1000);
  });

  it("GIF 결과는 언제나 10의 배수다 — 파일에 적히는 단위가 1/100초라서", () => {
    for (let ms = 0; ms <= 400; ms++) {
      expect(effectiveDelayMs(ms, 1, "gif") % 10).toBe(0);
    }
  });

  it("WebP·MP4는 눈금 스냅을 타지 않고 1ms 단위를 그대로 지킨다", () => {
    expect(effectiveDelayMs(25, 1, "webp")).toBe(25);
    expect(effectiveDelayMs(25, 1, "mp4")).toBe(25);
    expect(effectiveDelayMs(33, 1, "webp")).toBe(33);
    expect(effectiveDelayMs(104, 1, "mp4")).toBe(104);
  });

  it("소수 딜레이는 형식과 무관하게 정수 ms로 반올림된다 (60fps ≒ 16.67ms → 17ms)", () => {
    expect(effectiveDelayMs(50 / 3, 1, "webp")).toBe(17);
    expect(effectiveDelayMs(50 / 3, 1, "mp4")).toBe(17);
    // GIF는 같은 값이 눈금에 걸려 20ms(=하한과 같은 자리)로 간다.
    expect(effectiveDelayMs(50 / 3, 1, "gif")).toBe(20);
  });
});

describe("하한 아래 값과 이상한 값", () => {
  it("0ms 프레임은 형식의 하한으로 올라간다 — 0은 어느 형식도 담지 못한다", () => {
    expect(effectiveDelayMs(0, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(0, 1, "webp")).toBe(10);
    expect(effectiveDelayMs(0, 1, "mp4")).toBe(10);
  });

  it("1ms·5ms·19ms처럼 GIF 하한 미만인 값은 전부 20ms가 된다", () => {
    expect(effectiveDelayMs(1, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(5, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(19, 1, "gif")).toBe(20);
  });

  it("음수 딜레이가 들어와도 음수가 나가지 않고 하한이 나간다", () => {
    expect(effectiveDelayMs(-1, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(-1000, 1, "webp")).toBe(10);
    expect(effectiveDelayMs(-1000, 1, "mp4")).toBe(10);
  });

  it("어떤 입력에도 결과는 그 형식의 하한 이상이다", () => {
    for (const fmt of FORMATS) {
      const min = formatMinDelayMs(fmt);
      for (const ms of [-1e6, -1, 0, 0.4, 1, 9, 10, 19, 20, 21, 999]) {
        expect(effectiveDelayMs(ms, 1, fmt)).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("아주 큰 값은 하한 규칙에 막히지 않고 그대로 지나간다 (10분짜리 한 장)", () => {
    expect(effectiveDelayMs(600_000, 1, "gif")).toBe(600_000);
    expect(effectiveDelayMs(3_600_000, 1, "webp")).toBe(3_600_000);
    expect(effectiveDelayMs(3_600_000, 1, "mp4")).toBe(3_600_000);
  });
});

describe("배속을 먼저 적용하고 그다음에 하한·눈금을 맞춘다", () => {
  it("2배속은 딜레이를 절반으로 만든다 (GIF 40ms → 20ms)", () => {
    expect(effectiveDelayMs(40, 2, "gif")).toBe(20);
    expect(effectiveDelayMs(40, 2, "webp")).toBe(20);
  });

  it("0.5배속은 딜레이를 두 배로 늘린다 (100ms → 200ms)", () => {
    expect(effectiveDelayMs(100, 0.5, "gif")).toBe(200);
    expect(effectiveDelayMs(100, 0.5, "mp4")).toBe(200);
  });

  it("배속 때문에 하한 아래로 내려가면 하한에 걸린다 (GIF 40ms를 4배속 → 10ms → 20ms)", () => {
    expect(effectiveDelayMs(40, 4, "gif")).toBe(20);
    expect(effectiveDelayMs(40, 4, "webp")).toBe(10);
  });

  it("배속 0은 1배속으로 취급한다 — 0으로 나눠 Infinity가 새 나가지 않게", () => {
    expect(effectiveDelayMs(100, 0, "gif")).toBe(100);
    expect(effectiveDelayMs(100, 0, "webp")).toBe(100);
    expect(isDelayFloored(5, 0, "gif")).toBe(true);
    expect(isDelayFloored(100, 0, "gif")).toBe(false);
  });

  it("배속이 NaN이어도 1배속으로 떨어진다 (입력란이 비었을 때)", () => {
    expect(effectiveDelayMs(100, Number.NaN, "gif")).toBe(100);
    expect(isDelayFloored(100, Number.NaN, "gif")).toBe(false);
  });

  it("3배속의 100ms는 33.3ms이고 GIF에서는 30ms 눈금으로 내려앉는다", () => {
    expect(effectiveDelayMs(100, 3, "gif")).toBe(30);
    expect(effectiveDelayMs(100, 3, "webp")).toBe(33);
  });
});

describe("하한 판정(isDelayFloored)은 눈금 스냅과 하한을 구분한다", () => {
  it("하한과 정확히 같은 값은 걸린 것이 아니다 — 미만일 때만 참이다", () => {
    expect(isDelayFloored(20, 1, "gif")).toBe(false);
    expect(isDelayFloored(10, 1, "webp")).toBe(false);
    expect(isDelayFloored(10, 1, "mp4")).toBe(false);
  });

  it("하한 바로 아래는 걸린 것으로 센다", () => {
    expect(isDelayFloored(19, 1, "gif")).toBe(true);
    expect(isDelayFloored(9, 1, "webp")).toBe(true);
    expect(isDelayFloored(9, 1, "mp4")).toBe(true);
  });

  it("눈금 스냅으로 값이 줄어 하한과 같아져도 '하한에 걸렸다'고 하지 않는다 (21~24ms)", () => {
    // 결과는 20ms지만 하한이 깎은 게 아니라 1/100초 눈금이 당긴 것이다.
    for (const ms of [21, 22, 23, 24]) {
      expect(effectiveDelayMs(ms, 1, "gif")).toBe(20);
      expect(isDelayFloored(ms, 1, "gif")).toBe(false);
    }
  });

  it("경고는 형식마다 갈린다 — 15ms 프레임은 GIF에서만 걸린다", () => {
    expect(isDelayFloored(15, 1, "gif")).toBe(true);
    expect(isDelayFloored(15, 1, "webp")).toBe(false);
    expect(isDelayFloored(15, 1, "mp4")).toBe(false);
  });

  it("0과 음수는 모든 형식에서 걸린 것으로 센다", () => {
    for (const fmt of FORMATS) {
      expect(isDelayFloored(0, 1, fmt)).toBe(true);
      expect(isDelayFloored(-5, 1, fmt)).toBe(true);
    }
  });

  it("배속을 올려 하한 아래로 내려간 프레임도 걸린 것으로 센다", () => {
    expect(isDelayFloored(100, 1, "gif")).toBe(false);
    expect(isDelayFloored(100, 8, "gif")).toBe(true); // 12.5ms
    expect(isDelayFloored(100, 8, "webp")).toBe(false); // 12.5ms는 WebP 하한 위
    expect(isDelayFloored(100, 20, "webp")).toBe(true); // 5ms
  });

  it("큰 값은 어떤 배속에서도 걸리지 않는다", () => {
    expect(isDelayFloored(600_000, 1, "gif")).toBe(false);
    expect(isDelayFloored(1000, 2, "gif")).toBe(false);
  });

  it("걸렸다고 판정한 프레임의 결과는 반드시 하한 그 값이다 (판정과 계산이 어긋나지 않는다)", () => {
    for (const fmt of FORMATS) {
      const min = formatMinDelayMs(fmt);
      for (let ms = -20; ms <= 200; ms++) {
        for (const speed of [0.5, 1, 2, 3, 10]) {
          if (isDelayFloored(ms, speed, fmt)) {
            expect(effectiveDelayMs(ms, speed, fmt)).toBe(min);
          }
        }
      }
    }
  });
});

describe("숫자가 아닌 값이 들어와도 형식이 담을 수 있는 값만 나간다", () => {
  // 딜레이 칸을 비우면 Number("")이 아니라 Number(undefined)·Number("abc")로 NaN이 온다.
  // NaN은 Math.max(20, NaN) = NaN이라 하한을 그대로 통과해 gifenc의 writeUInt16과
  // WebP ANMF duration으로 들어간다 — 파일이 통째로 망가지는 자리다.
  it("딜레이가 NaN이면 형식의 하한이 나간다", () => {
    expect(effectiveDelayMs(Number.NaN, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(Number.NaN, 1, "webp")).toBe(10);
    expect(effectiveDelayMs(Number.NaN, 1, "mp4")).toBe(10);
  });

  it("딜레이가 NaN이면 배속이 얼마든 하한이 나간다", () => {
    for (const speed of [0.25, 1, 4]) {
      expect(effectiveDelayMs(Number.NaN, speed, "gif")).toBe(20);
    }
  });

  it("NaN 딜레이는 '입력한 값이 안 쓰인다'이므로 하한에 걸린 것으로 센다", () => {
    for (const fmt of FORMATS) {
      expect(isDelayFloored(Number.NaN, 1, fmt)).toBe(true);
    }
  });

  it("Infinity 딜레이도 파일에 적을 수 없으므로 하한으로 떨어진다", () => {
    expect(effectiveDelayMs(Number.POSITIVE_INFINITY, 1, "gif")).toBe(20);
    expect(effectiveDelayMs(Number.NEGATIVE_INFINITY, 1, "webp")).toBe(10);
    expect(Number.isFinite(effectiveDelayMs(Number.POSITIVE_INFINITY, 1, "mp4"))).toBe(true);
  });

  it("어떤 이상한 입력에도 결과는 유한한 정수다", () => {
    const weird = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const fmt of FORMATS) {
      for (const ms of weird) {
        for (const speed of [Number.NaN, 0, -2, 1, 4]) {
          const out = effectiveDelayMs(ms, speed, fmt);
          expect(Number.isInteger(out)).toBe(true);
          expect(out).toBeGreaterThanOrEqual(formatMinDelayMs(fmt));
        }
      }
    }
  });
});

describe("음수 배속은 배속이 아니다", () => {
  // -2배속은 뒤로 재생이 아니다(그런 설정이 없다). 그대로 나누면 raw가 음수가 되어
  // 모든 프레임이 하한 아래로 내려가고, 화면 전체가 거짓 경고로 덮인다.
  it("음수 배속에서 100ms 프레임은 하한에 걸리지 않는다", () => {
    expect(isDelayFloored(100, -2, "gif")).toBe(false);
    expect(isDelayFloored(100, -1, "webp")).toBe(false);
  });

  it("음수 배속은 1배속으로 떨어진다 — 딜레이가 그대로 나온다", () => {
    expect(effectiveDelayMs(100, -2, "gif")).toBe(100);
    expect(effectiveDelayMs(33, -0.5, "webp")).toBe(33);
  });

  it("음수 배속이어도 진짜 하한 미만인 프레임은 그대로 걸린다", () => {
    expect(isDelayFloored(5, -2, "gif")).toBe(true);
    expect(effectiveDelayMs(5, -2, "gif")).toBe(20);
  });

  it("0·NaN·음수는 전부 1배속과 같은 답을 준다", () => {
    for (const fmt of FORMATS) {
      const base = effectiveDelayMs(120, 1, fmt);
      for (const speed of [0, -0, Number.NaN, -1, -3.5]) {
        expect(effectiveDelayMs(120, speed, fmt)).toBe(base);
        expect(isDelayFloored(120, speed, fmt)).toBe(false);
      }
    }
  });

  it("걸렸다고 판정하면 결과는 하한 그 값이다 — 이상한 배속에서도", () => {
    for (const fmt of FORMATS) {
      const min = formatMinDelayMs(fmt);
      for (const speed of [-5, -1, 0, Number.NaN, 0.5, 2]) {
        for (const ms of [0, 5, 19, 20, 100, Number.NaN]) {
          if (isDelayFloored(ms, speed, fmt)) {
            expect(effectiveDelayMs(ms, speed, fmt)).toBe(min);
          }
        }
      }
    }
  });
});

describe("미리보기와 인코더가 같은 답을 받는다 (이 파일이 존재하는 이유)", () => {
  it("같은 입력을 몇 번을 물어도 같은 답이다 — 숨은 상태가 없다", () => {
    for (const fmt of FORMATS) {
      const first = effectiveDelayMs(37, 1.5, fmt);
      for (let i = 0; i < 50; i++) {
        expect(effectiveDelayMs(37, 1.5, fmt)).toBe(first);
        expect(isDelayFloored(37, 1.5, fmt)).toBe(isDelayFloored(37, 1.5, fmt));
      }
    }
  });

  it("배속과 딜레이가 같아도 형식이 다르면 답이 다를 수 있다 — 미리보기가 형식 칩을 따라가는 이유", () => {
    const delay = 25;
    expect(effectiveDelayMs(delay, 1, "gif")).toBe(30);
    expect(effectiveDelayMs(delay, 1, "webp")).toBe(25);
    expect(effectiveDelayMs(delay, 1, "mp4")).toBe(25);
  });

  it("WebP와 MP4는 하한도 눈금도 같으므로 모든 입력에서 답이 일치한다", () => {
    for (let ms = 0; ms <= 300; ms += 3) {
      for (const speed of [0.5, 1, 2, 7]) {
        expect(effectiveDelayMs(ms, speed, "webp")).toBe(effectiveDelayMs(ms, speed, "mp4"));
      }
    }
  });

  it("총 재생 시간은 프레임별 계산의 합과 같다 — 인코더가 따로 반올림하지 않는다", () => {
    const frames = [25, 25, 25, 25]; // 각 30ms로 스냅
    const total = frames.reduce((sum, ms) => sum + effectiveDelayMs(ms, 1, "gif"), 0);
    expect(total).toBe(120); // 100ms가 아니라 120ms — 눈금이 늘린 값이 그대로 쌓인다
  });
});
