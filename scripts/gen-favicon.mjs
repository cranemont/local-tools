// 파비콘 실파일 생성 — site/favicon.ico · site/apple-touch-icon.png · site/icon.svg
//
// 왜 필요한가: 앱들은 파비콘을 data: URI로 인라인해 둔다(오프라인 더블클릭 요구).
// 그런데 검색엔진은 **가져갈 수 있는 URL**의 파비콘을 원한다 — Google은 홈페이지의
// 파비콘을 사이트 전체에 적용하므로 site/ 에만 실파일을 두면 된다.
// 앱의 data: URI는 그대로 둔다(오프라인에서도 아이콘이 보여야 하니까).
//
// 실행: node scripts/gen-favicon.mjs  (산출물은 커밋한다 — 배포는 site/를 통째로 복사)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { IconCanvas, oklchToRgb } from "../packages/pwa-kit/index.js";

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "../site");

// packages/theme/tokens.css 의 --brand-600 과 같은 색.
const ACCENT = oklchToRgb({ l: 0.62, c: 0.158, h: 240 });
const WHITE = { r: 255, g: 255, b: 255 };

/** 로고 글리프: 둥근 파란 사각형 + 가운데 흰 원. 18단위 좌표계를 size로 환산한다. */
function drawLogo(size) {
  const c = new IconCanvas(size);
  c.roundedBackground(Math.round((5 / 18) * size), ACCENT);

  const cx = size / 2;
  const cy = size / 2;
  const r = (3.4 / 18) * size;
  const lo = Math.max(0, Math.floor(cx - r - 1));
  const hi = Math.min(size - 1, Math.ceil(cx + r + 1));
  for (let y = lo; y <= hi; y++) {
    for (let x = lo; x <= hi; x++) {
      // 픽셀 중심까지의 거리로 가장자리를 부드럽게 — 16px에서도 원이 각지지 않는다.
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.min(1, Math.max(0, r + 0.5 - d));
      if (a > 0) c.set(x, y, WHITE, a);
    }
  }
  return c.png();
}

/** PNG 여러 장을 ICO 한 장으로 묶는다(Vista 이후 ICO는 PNG를 그대로 담을 수 있다). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  const blobs = [];

  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, at + 0); // 0 == 256
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // 팔레트 색 수 (트루컬러라 0)
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // color planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
    blobs.push(Buffer.from(png));
  });

  return Buffer.concat([header, dir, ...blobs]);
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">` +
  `<rect x="1" y="1" width="16" height="16" rx="5" fill="oklch(0.62 0.158 240)"/>` +
  `<circle cx="9" cy="9" r="3.4" fill="#fff"/>` +
  `</svg>\n`;

const ico = buildIco([16, 32, 48].map((size) => ({ size, png: drawLogo(size) })));

writeFileSync(resolve(siteDir, "favicon.ico"), ico);
writeFileSync(resolve(siteDir, "apple-touch-icon.png"), Buffer.from(drawLogo(180)));
writeFileSync(resolve(siteDir, "icon.svg"), svg);

console.log(
  `favicon: site/favicon.ico (16·32·48, ${(ico.length / 1024).toFixed(1)} kB) · ` +
    `site/apple-touch-icon.png (180) · site/icon.svg`,
);
