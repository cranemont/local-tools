/** PWA 모드 빌드 후처리 — 매니페스트·아이콘·서비스 워커를 만들어 낸다.
 *
 * 이 앱은 두 벌로 빌드한다. 단일 HTML은 다른 도구들과 같은 오프라인 더블클릭용이고,
 * PWA는 **파일 연결**을 위해 있다 — 설치해야만 .csv 더블클릭이 이 앱으로 온다
 * (File Handling API). 매니페스트·서비스 워커는 단일 파일 안에 못 넣으므로 갈렸다.
 *
 * 색 변환·PNG 인코딩·서비스 워커 소스는 @local-tools/pwa-kit에 있다(문서 앱과 공용).
 * 여기 남은 것은 이 도구만의 것 둘 — 글리프와 매니페스트다.
 */

import { IconCanvas, hex, oklchToRgb, serviceWorkerSource } from "@local-tools/pwa-kit";
import type { Oklch } from "@local-tools/pwa-kit";
import type { Plugin } from "vite";

// packages/theme/tokens.css의 값과 같아야 한다.
const BRAND_600: Oklch = { l: 0.545, c: 0.155, h: 242 };
const SURFACE_LIGHT: Oklch = { l: 1, c: 0, h: 0 };

/**
 * 도구 아이콘: 브랜드색 둥근 사각형 + 흰 격자.
 * 랜딩 카드의 "표" 아이콘과 같은 뜻을 담되, 작은 크기에서 뭉개지지 않게 선을 굵게 잡았다.
 */
function drawIcon(size: number, maskable: boolean): Uint8Array {
  const canvas = new IconCanvas(size);
  const bg = oklchToRgb(BRAND_600);
  const fg = oklchToRgb(SURFACE_LIGHT);

  // 마스커블은 원형으로 잘려도 살아남아야 해서 배경을 꽉 채우고 글리프를 안쪽에 둔다.
  canvas.roundedBackground(maskable ? 0 : size * 0.22, bg);
  const inset = maskable ? size * 0.22 : size * 0.2;

  // 격자 글리프 — 바깥 테두리 + 가로줄 하나(머리글) + 세로줄 둘.
  const left = Math.round(inset);
  const right = Math.round(size - inset);
  const top = Math.round(inset + size * 0.02);
  const bottom = Math.round(size - inset - size * 0.02);
  const line = Math.max(2, Math.round(size * 0.035));

  canvas.rect(left, top, right, top + line, fg); // 위
  canvas.rect(left, bottom - line, right, bottom, fg); // 아래
  canvas.rect(left, top, left + line, bottom, fg); // 왼
  canvas.rect(right - line, top, right, bottom, fg); // 오

  const head = top + Math.round((bottom - top) * 0.3);
  canvas.rect(left, head, right, head + line, fg);

  const third = (right - left) / 3;
  canvas.rect(left + third, top, left + third + line, bottom, fg);
  canvas.rect(left + third * 2, top, left + third * 2 + line, bottom, fg);

  return canvas.png();
}

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

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource({ name: "sheet", precache }),
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
