import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

/**
 * 빌드 후처리: 단일 HTML의 인라인 <script>/<style>를 deflate-raw로 압축·base64로 넣고,
 * 로드 시 DecompressionStream으로 풀어 실행하는 "자가 해제형" HTML로 만든다.
 * 디스크상 파일 크기를 절반 이하로 줄인다(크로미엄 전용 — DecompressionStream 필요).
 */
function selfExtractingHtml(): Plugin {
  let root = process.cwd();
  let outDir = "dist";
  const pack = (s: string) =>
    deflateRawSync(Buffer.from(s, "utf8"), { level: 9 }).toString("base64");

  return {
    name: "self-extracting-html",
    enforce: "post",
    configResolved(c) {
      root = c.root;
      outDir = c.build.outDir;
    },
    closeBundle() {
      const file = resolve(root, outDir, "index.html");
      let html = readFileSync(file, "utf8");

      const style = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
      const script = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
      if (!style || !script) return; // 구조가 예상과 다르면 원본 유지

      const cssB64 = pack(style[1]);
      const jsB64 = pack(script[1]);

      const payload =
        `<script type="text/plain" id="app-css">${cssB64}</script>` +
        `<script type="text/plain" id="app-js">${jsB64}</script>`;

      const boot = `<script>
(async () => {
  if (typeof DecompressionStream === 'undefined') {
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:15px/1.6 sans-serif;color:#333;text-align:center;padding:40px">최신 브라우저가 필요합니다 (Chrome/Edge 등).<br>문서 자체는 온전합니다 — 최신 브라우저로 열어 주세요.</div>';
    return;
  }
  const inflate = async (id) => {
    const b64 = document.getElementById(id).textContent.trim();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };
  try {
    const st = document.createElement('style');
    st.textContent = await inflate('app-css');
    document.head.appendChild(st);
    const js = await inflate('app-js');
    await import(URL.createObjectURL(new Blob([js], { type: 'text/javascript' })));
    const sp = document.getElementById('boot-splash');
    if (sp) sp.remove();
  } catch (e) {
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:15px sans-serif;color:#c00">불러오기에 실패했어요: ' + e + '</div>';
  }
})();
</script>`;

      const splash =
        `<div id="boot-splash" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f6f7f9;z-index:99999">` +
        `<div style="width:34px;height:34px;border:3px solid #e2e6eb;border-top-color:#0ea5e9;border-radius:50%;animation:bs .8s linear infinite"></div>` +
        `<style>@keyframes bs{to{transform:rotate(360deg)}}</style></div>`;

      html = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/, "")
        .replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/, payload + boot)
        .replace(/<body([^>]*)>/, `<body$1>${splash}`);

      writeFileSync(file, html);
      const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
      this.info(`self-extracting-html: dist/index.html → ${kb} kB`);
    },
  };
}

// 산출물: 모든 JS/CSS/라이브러리가 인라인된 자기완결 단일 .html (압축 자가 해제형)
export default defineConfig({
  plugins: [svelte(), viteSingleFile(), selfExtractingHtml()],
  build: {
    target: "es2022",
  },
});
