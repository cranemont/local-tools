// PWA 빌드 후처리에 쓰는 공용 도구 — 아이콘을 코드로 그려 PNG로 인코딩하고,
// 서비스 워커 소스를 찍어 낸다. 저장소에 바이너리(아이콘 파일)를 두지 않기 위한 것이고,
// 색은 packages/theme의 OKLCH 토큰 값을 그대로 변환해 쓴다 — 손으로 고른 hex를
// 새로 만들지 않기 위해서다.
//
// 시트와 문서 두 앱이 쓴다. 앱마다 다른 것은 글리프·매니페스트뿐이라 그 둘만 앱에 남겼다.

import { deflateSync } from "node:zlib";

// ── 색 ────────────────────────────────────────────────────────────

/**
 * OKLCH → sRGB. tokens.css에 적힌 값을 그대로 넣으면 되게 만든 것이다.
 * @param {{ l: number, c: number, h: number }} color
 * @returns {{ r: number, g: number, b: number }}
 */
export function oklchToRgb({ l, c, h }) {
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

  const encode = (v) => {
    const clamped = Math.min(1, Math.max(0, v));
    const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };

  return { r: encode(lin[0]), g: encode(lin[1]), b: encode(lin[2]) };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {string}
 */
export function hex({ r, g, b }) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
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

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/**
 * RGBA 픽셀 버퍼 → PNG 바이트(필터 없음 + zlib).
 * @param {Uint8Array} rgba
 * @param {number} size
 * @returns {Uint8Array}
 */
export function encodePng(rgba, size) {
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

// ── 아이콘 캔버스 ─────────────────────────────────────────────────

/**
 * 아주 작은 픽셀 캔버스. 아이콘 글리프는 앱마다 다르지만 그리는 방법은 같아서
 * 여기 모았다 — 둥근 사각형 배경 하나와 사각형 몇 개면 대부분 그려진다.
 */
export class IconCanvas {
  /** @param {number} size */
  constructor(size) {
    this.size = size;
    this.px = new Uint8Array(size * size * 4);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ r: number, g: number, b: number }} color
   * @param {number} alpha
   */
  set(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const a = Math.max(0, Math.min(1, alpha));
    this.px[i] = Math.round(this.px[i] * (1 - a) + color.r * a);
    this.px[i + 1] = Math.round(this.px[i + 1] * (1 - a) + color.g * a);
    this.px[i + 2] = Math.round(this.px[i + 2] * (1 - a) + color.b * a);
    this.px[i + 3] = Math.round(this.px[i + 3] * (1 - a) + 255 * a);
  }

  /**
   * 채운 사각형.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {{ r: number, g: number, b: number }} color
   */
  rect(x0, y0, x1, y1, color) {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(this.size, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(this.size, Math.round(x1)); x++) {
        this.set(x, y, color, 1);
      }
    }
  }

  /**
   * 화면 전체를 덮는 둥근 사각형(모서리는 거리로 판정해 1px 폭으로 부드럽게).
   * radius 0이면 꽉 찬 사각형 — 마스커블 아이콘이 원형으로 잘려도 살아남게 할 때 쓴다.
   * @param {number} radius
   * @param {{ r: number, g: number, b: number }} color
   */
  roundedBackground(radius, color) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const dx = Math.max(radius - x, x - (this.size - 1 - radius), 0);
        const dy = Math.max(radius - y, y - (this.size - 1 - radius), 0);
        const dist = Math.hypot(dx, dy);
        const alpha = radius === 0 ? 1 : Math.min(1, Math.max(0, radius - dist + 0.5));
        if (alpha > 0) this.set(x, y, color, alpha);
      }
    }
  }

  /** @returns {Uint8Array} */
  png() {
    return encodePng(this.px, this.size);
  }
}

// ── 서비스 워커 ───────────────────────────────────────────────────

/**
 * 캐시 우선 서비스 워커 소스. 도구가 오프라인에서 열리는 게 먼저이므로 캐시를 먼저 보고,
 * 새 배포는 activate에서 옛 캐시를 버리는 것으로 갈린다.
 *
 * precache에 없는 같은 오리진 GET은 받아 온 뒤 캐시에 넣는다 — 문서 앱의 wasm 엔진처럼
 * 큰 파일을 설치 시점에 받지 않고, 처음 쓸 때 한 번만 받아 남기기 위해서다.
 *
 * @param {{ name: string, precache: string[] }} options
 * @returns {string}
 */
export function serviceWorkerSource({ name, precache }) {
  // 캐시 이름에 산출물 목록의 지문을 넣어, 배포가 바뀌면 옛 캐시가 버려지게 한다.
  const version = crc32(new TextEncoder().encode(precache.join("|"))).toString(36);

  return `// 자동 생성 — 앱의 pwa.ts가 빌드마다 새로 쓴다. 직접 고치지 말 것.
const CACHE = "${name}-${version}";
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
