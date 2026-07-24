import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// 산출물: 모든 JS/CSS/라이브러리가 인라인된 자기완결 단일 .html
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  build: {
    target: "es2022",
  },
});
