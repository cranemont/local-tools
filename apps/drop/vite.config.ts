import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { selfExtractingHtml } from "@local-tools/vite-plugin-self-extracting";

// 산출물: 모든 JS/CSS가 인라인된 자기완결 단일 .html (압축 자가 해제형)
export default defineConfig({
  plugins: [svelte(), viteSingleFile(), selfExtractingHtml()],
  build: {
    target: "es2022",
  },
});
