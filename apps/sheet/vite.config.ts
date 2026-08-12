import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { selfExtractingHtml } from "@local-tools/vite-plugin-self-extracting";
import { pwaAssets } from "./pwa";

/**
 * 이 앱만 두 벌로 빌드한다.
 *   기본  → dist/index.html      자기완결 단일 HTML(다른 도구들과 같음)
 *   pwa   → dist-pwa/            매니페스트 + 서비스 워커 + 아이콘
 *
 * PWA 쪽이 따로 있는 이유는 하나다 — **파일 연결**. 설치해야만 .csv 더블클릭이
 * 이 앱으로 들어오는데(File Handling API), 매니페스트와 서비스 워커는 단일 HTML
 * 안에 넣을 수 없다.
 *
 * exceljs는 브라우저용 빌드가 두 개다. core-js 폴리필이 든 것(931kB)과 없는
 * bare(848kB) — 이 저장소는 크로미엄 전용이라 폴리필이 통째로 죽은 무게다.
 */
export default defineConfig(({ mode }) => {
  const pwa = mode === "pwa";

  return {
    base: "./",
    plugins: pwa
      ? [svelte(), pwaAssets()]
      : [svelte(), viteSingleFile(), selfExtractingHtml()],
    resolve: {
      alias: { exceljs: "exceljs/dist/exceljs.bare.min.js" },
    },
    build: {
      target: "es2022",
      outDir: pwa ? "dist-pwa" : "dist",
      // 단일 HTML 빌드에서는 xlsx 엔진도 결국 한 파일에 들어가지만, PWA 빌드에서는
      // 별도 청크로 남아 CSV만 쓰는 사람은 내려받지 않는다.
      chunkSizeWarningLimit: 1200,
    },
  };
});
