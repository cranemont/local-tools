import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { selfExtractingHtml } from "@local-tools/vite-plugin-self-extracting";
import { ortWasm } from "./ort-wasm";

/**
 * 산출물은 다른 도구들과 같은 자기완결 단일 HTML이다 — 단, **모델은 그 안에 없다**.
 *
 * transformers.js는 onnxruntime-web의 .wasm/.mjs를 번들에 넣지 않고 실행 시점에
 * jsDelivr에서 받고, 모델 가중치는 Hugging Face Hub에서 받는다. 실험장은 모델을
 * 갈아 끼우는 곳이라 이게 오히려 맞다 — 열두 개를 자체 호스팅할 방법은 없다.
 * 그래서 이 앱만은 처음 실행에 인터넷이 필요하다(그 뒤로는 Cache API에 남는다).
 *
 * ⚠️ `onnxruntime-node`와 `sharp`는 이 패키지의 Node 전용 의존성이다. package.json의
 *    exports 맵이 브라우저에서 `dist/transformers.web.js`를 고르므로 정상 경로에서는
 *    닿지 않지만, 최적화 스캐너가 먼저 물어 죽는 일이 있어 명시적으로 끊어 둔다.
 *
 * ⚠️ `ortWasm()`을 빼면 산출물이 63MB가 된다 — ort-wasm.ts의 주석 참고.
 *    빌드 로그의 `self-extracting-html: dist/index.html → NNN kB`가 1MB 근처인지
 *    꼭 확인할 것. 20MB대가 찍히면 저 플러그인이 안 먹은 것이다.
 */
export default defineConfig({
  plugins: [ortWasm(), svelte(), viteSingleFile(), selfExtractingHtml()],
  optimizeDeps: {
    exclude: ["onnxruntime-node", "sharp"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      external: ["onnxruntime-node", "sharp"],
    },
  },
});
