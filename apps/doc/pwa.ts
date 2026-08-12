/** PWA 모드 빌드 후처리 — 매니페스트·아이콘·서비스 워커.
 *
 * 이 앱이 PWA를 따로 내는 이유는 둘이다.
 *  ① **파일 연결** — 설치해야 .hwp 더블클릭이 이 앱으로 온다. 한글이 없는 맥에서
 *     이 확장자를 열어 주는 앱은 아예 없으므로, 남의 자리를 뺏는 게 아니라 빈 자리를 메운다.
 *  ② **엔진 캐시** — 서비스 워커만이 2.1MB rhwp wasm을 오프라인에 남길 수 있다.
 *     단, 프리캐시에는 넣지 않는다(설치 순간 8MB를 받게 된다). 처음 hwp를 열 때
 *     한 번 받아서 런타임 캐시에 들어가고, 그 다음부터는 비행기에서도 열린다.
 *
 * 색 변환·PNG 인코딩·서비스 워커 소스는 @local-tools/pwa-kit(시트와 공용)에 있다.
 */

import { IconCanvas, hex, oklchToRgb, serviceWorkerSource } from "@local-tools/pwa-kit";
import type { Oklch } from "@local-tools/pwa-kit";
import type { Plugin } from "vite";
import type { RhwpWasmInfo } from "./rhwp-wasm";

// packages/theme/tokens.css의 값과 같아야 한다.
const BRAND_600: Oklch = { l: 0.545, c: 0.155, h: 242 };
const SURFACE_LIGHT: Oklch = { l: 1, c: 0, h: 0 };

/**
 * 도구 아이콘: 브랜드색 둥근 사각형 + 흰 문서(모서리 접힌 종이 + 본문 줄).
 * 랜딩 카드의 문서 아이콘과 같은 뜻이고, 작은 크기에서 접힌 모서리가 뭉개지지 않도록
 * 계단을 큼직하게 잡았다.
 */
function drawIcon(size: number, maskable: boolean): Uint8Array {
  const canvas = new IconCanvas(size);
  const bg = oklchToRgb(BRAND_600);
  const fg = oklchToRgb(SURFACE_LIGHT);

  canvas.roundedBackground(maskable ? 0 : size * 0.22, bg);
  const inset = maskable ? size * 0.28 : size * 0.24;

  const left = Math.round(inset);
  const right = Math.round(size - inset);
  const top = Math.round(inset * 0.86);
  const bottom = Math.round(size - inset * 0.86);
  const fold = Math.round((right - left) * 0.34); // 접힌 모서리 한 변

  // 종이 — 오른쪽 위 모서리를 대각선으로 잘라 낸다(계단식으로 그려 접힘을 표현).
  for (let y = top; y < bottom; y++) {
    const intoFold = y - top;
    const cut = intoFold < fold ? fold - intoFold : 0;
    canvas.rect(left, y, right - cut, y + 1, fg);
  }

  // 본문 줄 — 접힌 부분 아래에서 시작해 종이가 문서로 읽히게 한다.
  const line = Math.max(2, Math.round(size * 0.045));
  const gap = Math.round((bottom - top) * 0.16);
  const textLeft = left + Math.round((right - left) * 0.16);
  const textRight = right - Math.round((right - left) * 0.16);
  for (let i = 0; i < 3; i++) {
    const y = top + fold + Math.round(gap * 0.6) + i * gap;
    if (y + line > bottom - gap * 0.2) break;
    const end = i === 2 ? textLeft + (textRight - textLeft) * 0.6 : textRight;
    canvas.rect(textLeft, y, end, y + line, bg);
  }

  return canvas.png();
}

const MANIFEST_NAME = "manifest.webmanifest";

export function pwaAssets(wasm: RhwpWasmInfo): Plugin {
  return {
    name: "doc-pwa-assets",
    apply: "build",

    generateBundle(_options, bundle) {
      for (const [name, size, maskable] of [
        ["icon-192.png", 192, false],
        ["icon-512.png", 512, false],
        ["icon-maskable-512.png", 512, true],
      ] as const) {
        this.emitFile({ type: "asset", fileName: name, source: drawIcon(size, maskable) });
      }

      const manifest = {
        name: "local-tools 문서",
        short_name: "문서",
        description:
          "브라우저 안에서만 동작하는 문서 뷰어 — 한글(.hwp·.hwpx)·워드(.docx)를 열어 보고 마크다운으로 바꿉니다. 파일은 서버로 전송되지 않습니다.",
        lang: "ko",
        start_url: "./",
        scope: "./",
        id: "./",
        display: "standalone",
        background_color: hex(oklchToRgb(SURFACE_LIGHT)),
        theme_color: hex(oklchToRgb(BRAND_600)),
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
        // 설치된 앱이 .hwp/.hwpx의 열기 대상이 되는 부분. docx는 워드·페이지스가
        // 이미 잡고 있으므로 등록하지 않는다(드롭존은 그대로 받는다).
        file_handlers: [
          {
            action: "./",
            accept: {
              "application/x-hwp": [".hwp"],
              "application/haansofthwp": [".hwp"],
              "application/hwp+zip": [".hwpx"],
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

      // 프리캐시에서 wasm은 뺀다 — 설치하자마자 8MB를 받게 할 수는 없다.
      // 런타임 캐시가 처음 받을 때 담아 두므로 그 뒤로는 오프라인에서도 열린다.
      const precache = [
        "./",
        "./index.html",
        `./${MANIFEST_NAME}`,
        "./icon-192.png",
        "./icon-512.png",
        ...Object.keys(bundle)
          .filter((name) => name !== wasm.fileName)
          .map((name) => `./${name}`),
      ];

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource({ name: "doc", precache }),
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
