// 캔버스에 그릴 색을 디자인 토큰에서 가져온다.
//
// 규칙 하나 때문에 이 파일이 있다 — 색은 packages/theme에서만 정의한다. 히트맵을
// 그리려고 캔버스 코드에 hex를 새로 심으면 그 색만 테마를 안 따라가고, 다크에서
// 혼자 튄다. 그래서 토큰 값을 실행 시점에 읽어 쓴다.
//
// 토큰은 OKLCH다. 문자열을 직접 파싱하는 대신 1×1 캔버스에 칠해서 픽셀을 읽는다 —
// 브라우저가 이미 갖고 있는 변환기를 쓰는 것이고, 토큰 표기법이 바뀌어도 안 깨진다
// (크로미엄 전용 전제라 캔버스의 oklch() 지원을 그냥 믿는다).

export type Rgb = [number, number, number];

let probe: CanvasRenderingContext2D | null = null;
const cache = new Map<string, Rgb>();

function ctx(): CanvasRenderingContext2D | null {
  if (probe) return probe;
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  probe = c.getContext("2d", { willReadFrequently: true });
  return probe;
}

/** `--accent` 같은 토큰 이름 → sRGB 3원색. 테마가 바뀌면 캐시가 비워진다. */
export function themeColor(token: string): Rgb {
  const hit = cache.get(token);
  if (hit) return hit;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const c = ctx();
  let out: Rgb = [128, 128, 128];
  if (c && raw) {
    // 실패하면 fillStyle이 이전 값을 유지하므로 매번 알려진 값으로 초기화한다
    c.fillStyle = "#000";
    c.fillStyle = raw;
    c.clearRect(0, 0, 1, 1);
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    out = [d[0], d[1], d[2]];
  }
  cache.set(token, out);
  return out;
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, s * 255)));
};

/**
 * 두 색 사이 보간 — 선형 광량에서 섞는다.
 *
 * sRGB 값끼리 그냥 평균내면 중간톤이 탁해진다(어두운 쪽으로 눌린다). 히트맵은
 * 중간 구간에서 대부분의 정보를 보여 주므로 여기가 탁하면 그림이 못 쓰게 된다.
 */
export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [0, 1, 2].map((i) => toSrgb(toLinear(a[i]) + (toLinear(b[i]) - toLinear(a[i])) * k)) as Rgb;
}

/**
 * 테마가 바뀌면 캐시를 비우고 알린다. 정리 함수를 돌려준다.
 * 명시적 토글(data-theme)과 시스템 설정 둘 다 봐야 한다 — 토글이 없으면
 * prefers-color-scheme만이 라이트와 다크를 가른다.
 */
export function onThemeChange(cb: () => void): () => void {
  const fire = () => {
    cache.clear();
    cb();
  };

  const mo = new MutationObserver(fire);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", fire);

  return () => {
    mo.disconnect();
    mq.removeEventListener("change", fire);
  };
}
