import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// 이 앱만 단일 HTML이 아니다 — 도구가 아니라 메타 페이지라서 오프라인 더블클릭 요구가 없다.
// 대신 코드 분할을 살려 three.js(도시 뷰)를 열 때만 내려받는다.
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  build: {
    target: "es2022",
  },
});
