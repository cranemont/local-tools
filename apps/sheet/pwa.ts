/** PWA 모드 빌드 후처리 — 매니페스트·아이콘·서비스 워커를 만들어 낸다.
 *
 * 이 앱만 두 벌로 빌드한다. 단일 HTML은 다른 도구들과 같은 오프라인 더블클릭용이고,
 * PWA는 **파일 연결**을 위해 있다 — 설치해야만 .csv 더블클릭이 이 앱으로 온다
 * (File Handling API). 매니페스트·서비스 워커는 단일 파일 안에 못 넣으므로 갈렸다.
 *
 * 아이콘은 여기서 직접 그려 PNG로 인코딩한다. 저장소에 바이너리를 두지 않으려는 것이고,
 * 색은 테마 토큰(--brand-600 등)의 OKLCH 값을 그대로 변환해 쓴다 — 손으로 고른 hex를
 * 새로 만들지 않기 위해서다.
 */

import { deflateSync } from "node:zlib";
import type { Plugin } from "vite";

// ── 색 ────────────────────────────────────────────────────────────
// packages/theme/tokens.css의 값과 같아야 한다.
const BRAND_600: Oklch = { l: 0.545, c: 0.155, h: 242 };
const SURFACE_LIGHT: Oklch = { l: 1, c: 0, h: 0 };

interface Oklch {
  l: number;
  c: number;
  h: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const bb = c * Math.sin(rad);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;

  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];

  const encode = (v: number): number => {
    const clamped = Math.min(1, Math.max(0, v));
    const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };

  return { r: encode(lin[0]), g: encode(lin[1]), b: encode(lin[2]) };
}

function hex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ── PNG 인코딩 ────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** RGBA 픽셀 버퍼 → PNG 바이트. */
function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  const stride = size * 4;
  const raw = new Uint8Array((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // 필터 없음
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 6; // 트루컬러 + 알파
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

// ── 아이콘 그리기 ─────────────────────────────────────────────────

/**
 * 도구 아이콘: 브랜드색 둥근 사각형 + 흰 격자.
 * 랜딩 카드의 "표" 아이콘과 같은 뜻을 담되, 작은 크기에서 뭉개지지 않게 선을 굵게 잡았다.
 */
function drawIcon(size: number, maskable: boolean): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const bg = oklchToRgb(BRAND_600);
  const fg = oklchToRgb(SURFACE_LIGHT);

  // 마스커블은 원형으로 잘려도 살아남아야 해서 배경을 꽉 채우고 글리프를 안쪽에 둔다.
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.22 : size * 0.2;

  const set = (x: number, y: number, color: Rgb, alpha: number): void => {
    const i = (y * size + x) * 4;
    const a = Math.max(0, Math.min(1, alpha));
    px[i] = Math.round(px[i] * (1 - a) + color.r * a);
    px[i + 1] = Math.round(px[i + 1] * (1 - a) + color.g * a);
    px[i + 2] = Math.round(px[i + 2] * (1 - a) + color.b * a);
    px[i + 3] = Math.round(px[i + 3] * (1 - a) + 255 * a);
  };

  // 둥근 사각형 배경(모서리는 거리로 판정하고 1px 폭으로 부드럽게).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
      const dist = Math.hypot(dx, dy);
      const alpha = radius === 0 ? 1 : Math.min(1, Math.max(0, radius - dist + 0.5));
      if (alpha > 0) set(x, y, bg, alpha);
    }
  }

  // 격자 글리프 — 바깥 테두리 + 가로줄 하나(머리글) + 세로줄 둘.
  const left = Math.round(inset);
  const right = Math.round(size - inset);
  const top = Math.round(inset + size * 0.02);
  const bottom = Math.round(size - inset - size * 0.02);
  const line = Math.max(2, Math.round(size * 0.035));

  const rect = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) set(x, y, fg, 1);
    }
  };

  rect(left, top, right, top + line); // 위
  rect(left, bottom - line, right, bottom); // 아래
  rect(left, top, left + line, bottom); // 왼
  rect(right - line, top, right, bottom); // 오
  rect(left, top + Math.round((bottom - top) * 0.3), right, top + Math.round((bottom - top) * 0.3) + line);
  const third = (right - left) / 3;
  rect(Math.round(left + third), top, Math.round(left + third) + line, bottom);
  rect(Math.round(left + third * 2), top, Math.round(left + third * 2) + line, bottom);

  return encodePng(px, size);
}

// ── 플러그인 ──────────────────────────────────────────────────────

const MANIFEST_NAME = "manifest.webmanifest";

export function pwaAssets(): Plugin {
  return {
    name: "sheet-pwa-assets",
    apply: "build",

    generateBundle(_options, bundle) {
      const themeColor = hex(oklchToRgb(BRAND_600));

      for (const [name, size, maskable] of [
        ["icon-192.png", 192, false],
        ["icon-512.png", 512, false],
        ["icon-maskable-512.png", 512, true],
      ] as const) {
        this.emitFile({ type: "asset", fileName: name, source: drawIcon(size, maskable) });
      }

      const manifest = {
        name: "local-tools 시트",
        short_name: "시트",
        description:
          "브라우저 안에서만 동작하는 표 편집기 — CSV·엑셀 열기, 수식, 서식, 변환. 파일은 서버로 전송되지 않습니다.",
        lang: "ko",
        start_url: "./",
        scope: "./",
        id: "./",
        display: "standalone",
        background_color: hex(oklchToRgb(SURFACE_LIGHT)),
        theme_color: themeColor,
        icons: [
          { src: "./icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "./icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "./icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // 설치된 앱이 .csv/.xlsx의 열기 대상이 되는 부분. 이게 이 빌드의 존재 이유다.
        file_handlers: [
          {
            action: "./",
            accept: {
              "text/csv": [".csv"],
              "text/tab-separated-values": [".tsv"],
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
              "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"],
              "application/json": [".json"],
            },
          },
        ],
        launch_handler: { client_mode: "focus-existing" },
      };

      this.emitFile({
        type: "asset",
        fileName: MANIFEST_NAME,
        source: JSON.stringify(manifest, null, 2),
      });

      // 서비스 워커 — 빌드 산출물을 통째로 미리 담아 오프라인에서도 열리게 한다.
      const precache = [
        "./",
        "./index.html",
        `./${MANIFEST_NAME}`,
        "./icon-192.png",
        "./icon-512.png",
        ...Object.keys(bundle).map((name) => `./${name}`),
      ];
      // 캐시 이름에 산출물 목록의 지문을 넣어, 배포가 바뀌면 옛 캐시가 버려지게 한다.
      const version = crc32(new TextEncoder().encode(precache.join("|"))).toString(36);

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorker(version, precache),
      });
    },

    transformIndexHtml(html) {
      return {
        html,
        tags: [
          { tag: "link", attrs: { rel: "manifest", href: `./${MANIFEST_NAME}` }, injectTo: "head" },
          {
            tag: "link",
            attrs: { rel: "apple-touch-icon", href: "./icon-192.png" },
            injectTo: "head",
          },
        ],
      };
    },
  };
}

function serviceWorker(version: string, precache: string[]): string {
  return `// 자동 생성 — apps/sheet/pwa.ts가 빌드마다 새로 쓴다. 직접 고치지 말 것.
const CACHE = "sheet-${version}";
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 캐시 우선 — 도구가 오프라인에서 열리는 게 먼저다. 새 배포는 위 activate에서 갈린다.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(request)
          .then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match("./index.html")),
    ),
  );
});
`;
}
