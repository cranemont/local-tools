import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { selfExtractingHtml } from "@local-tools/vite-plugin-self-extracting";
import { pwaAssets } from "./pwa";
import { readRhwpWasm, rhwpDefines, rhwpWasm } from "./rhwp-wasm";

/**
 * 시트와 같은 이유로 두 벌로 빌드한다.
 *   기본  → dist/index.html      자기완결 단일 HTML(다른 도구들과 같음)
 *   pwa   → dist-pwa/            매니페스트 + 서비스 워커 + 아이콘 + rhwp wasm
 *
 * PWA가 있는 이유는 둘이다.
 *  ① 파일 연결 — 설치해야 .hwp 더블클릭이 이 앱으로 온다(한글 없는 맥에서는
 *     이 확장자를 열어 주는 앱이 아예 없다).
 *  ② 서비스 워커 캐시 — 2.1MB 엔진을 진짜로 오프라인에 남길 수 있는 유일한 방법.
 *     단일 HTML(`file://`)은 오리진이 불투명해 캐시 저장소를 못 쓴다.
 *
 * mammoth(docx → 시맨틱 HTML)는 지연 로드라 PWA 빌드에서 별도 청크로 남는다 —
 * hwp만 보는 사람은 내려받지 않는다.
 */
export default defineConfig(({ mode }) => {
  const pwa = mode === "pwa";
  const wasm = readRhwpWasm();

  return {
    base: "./",
    define: rhwpDefines(wasm),
    plugins: pwa
      ? [rhwpWasm(wasm, { emit: true }), svelte(), pwaAssets(wasm)]
      : [
          rhwpWasm(wasm, { emit: false }),
          svelte(),
          viteSingleFile(),
          selfExtractingHtml(),
        ],
    build: {
      target: "es2022",
      outDir: pwa ? "dist-pwa" : "dist",
      chunkSizeWarningLimit: 700,
    },
  };
});
