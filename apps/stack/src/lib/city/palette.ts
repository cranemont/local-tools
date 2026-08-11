// 씬 색을 테마 토큰에서 읽어 온다 — 3D라고 색을 따로 만들지 않는다.
//
// 토큰은 oklch()로 적혀 있지만 THREE.Color는 CSS Color 4를 모른다. 게다가 크로미엄은
// 계산값을 lab()으로 정규화해서 돌려주므로 문자열만 보고 넘겨짚을 수 없다.
// 그래서 1×1 캔버스에 실제로 칠해 보고 그 픽셀을 읽는다 — 브라우저가 2D에 칠하는
// 바로 그 sRGB 값이라 두 뷰의 색이 어긋날 수가 없다.
// (캔버스가 파싱하지 못하는 문법이면 아래 oklch 변환식으로 물러난다.)

const TOKENS = [
  "--bg",
  "--surface",
  "--surface-2",
  "--surface-raised",
  "--text",
  "--text-muted",
  "--border",
  "--border-strong",
  "--accent",
  "--accent-ink",
  "--success",
  "--danger",
  "--cat-1",
  "--cat-2",
  "--cat-3",
  "--cat-4",
  "--cat-5",
] as const;

export type TokenName = (typeof TOKENS)[number];
export type Palette = Record<TokenName, number>;

const OKLCH_RE = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

const srgbGamma = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const to8 = (c: number): number => Math.round(Math.min(1, Math.max(0, c)) * 255);

/** OKLCH → sRGB 정수. 색역을 벗어나면 채널을 자른다(브라우저 표시와 같은 처리). */
export function oklchToInt(l: number, c: number, hDeg: number): number {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  return (to8(srgbGamma(r)) << 16) | (to8(srgbGamma(g)) << 8) | to8(srgbGamma(bl));
}

/** 파싱 실패를 알아채기 위한 표식 — 이 색이 그대로 나오면 캔버스가 값을 못 읽은 것이다. */
const SENTINEL = "#010203";
const SENTINEL_INT = 0x010203;

let probe: CanvasRenderingContext2D | null | undefined;

function paintProbe(value: string): number | null {
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return null;

  // 파싱에 실패하면 fillStyle이 바뀌지 않는다 — 그래서 매번 표식으로 되돌려 놓고 시작한다.
  probe.fillStyle = SENTINEL;
  probe.fillStyle = value;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  const int = (r << 16) | (g << 8) | b;
  return int === SENTINEL_INT ? null : int;
}

/** CSS 색 문자열 → sRGB 정수. 브라우저가 칠한 픽셀이 1순위, 직접 변환이 2순위. */
export function cssColorToInt(value: string, fallback = 0x808080): number {
  const text = value.trim();
  if (!text) return fallback;

  const painted = paintProbe(text);
  if (painted !== null) return painted;

  const ok = OKLCH_RE.exec(text);
  if (ok) {
    const l = ok[1].endsWith("%") ? parseFloat(ok[1]) / 100 : parseFloat(ok[1]);
    return oklchToInt(l, parseFloat(ok[2]), parseFloat(ok[3]));
  }

  const hex = HEX_RE.exec(text);
  if (hex) {
    const body = hex[1];
    const full =
      body.length === 3
        ? body
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : body;
    return parseInt(full, 16);
  }

  const rgb = RGB_RE.exec(text);
  if (rgb) {
    return (
      (Math.round(parseFloat(rgb[1])) << 16) |
      (Math.round(parseFloat(rgb[2])) << 8) |
      Math.round(parseFloat(rgb[3]))
    );
  }

  return fallback;
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const out = {} as Palette;
  for (const token of TOKENS) out[token] = cssColorToInt(style.getPropertyValue(token));
  return out;
}

/**
 * 테마가 바뀔 때마다 알려 준다 — 토글(data-theme)과 시스템 설정 양쪽을 본다.
 * 반환값을 호출하면 구독이 끊긴다.
 */
export function onThemeChange(run: () => void): () => void {
  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", run);
  return () => {
    observer.disconnect();
    mq.removeEventListener("change", run);
  };
}
