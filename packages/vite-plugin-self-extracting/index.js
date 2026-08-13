import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

/**
 * 빌드 후처리: 단일 HTML의 인라인 <script>/<style>를 deflate-raw로 압축·base64로 넣고,
 * 로드 시 DecompressionStream으로 풀어 실행하는 "자가 해제형" HTML로 만든다.
 * 디스크상 파일 크기를 절반 이하로 줄인다(크로미엄 전용 — DecompressionStream 필요).
 *
 * ⚠️ vite-plugin-singlefile 출력 태그 형태에 정규식으로 의존한다.
 *    매치 실패 시 원본을 유지하고 경고를 띄운다. 빌드 로그에
 *    `self-extracting-html: dist/index.html → NNN kB`가 찍히는지 반드시 확인할 것.
 *
 * 압축 대상은 **번들이 만든 것 하나씩뿐**이다:
 *   - CSS: singlefile이 `<link rel=stylesheet>`를 `<style rel="stylesheet" ...>`로
 *     바꾸므로 그 `rel` 속성으로 겨냥한다. index.html에 손으로 쓴 <style>은 건드리지 않는다.
 *   - JS: 앱 진입점인 `<script type="module">` 하나.
 * 즉 **index.html <body>에 손으로 쓴 마크업·스타일은 평문 그대로 남는다** —
 * 검색엔진이 읽을 정적 본문(section#intro)이 여기에 실린다.
 */
export function selfExtractingHtml(options = {}) {
  const {
    accentColor = "light-dark(oklch(0.62 0.158 240), oklch(0.716 0.125 240))",
    unsupportedHtml = "최신 브라우저가 필요합니다 (Chrome/Edge 등).<br>문서 자체는 온전합니다 — 최신 브라우저로 열어 주세요.",
    loadErrorPrefix = "불러오기에 실패했어요: ",
    /**
     * 산출물 상한. Google의 HTML 색인 처리 한도가 2MB라 넘으면 본문이 아니라
     * 오류 문구가 색인된다(절벽형 실패). 여유를 두고 빌드를 세운다.
     */
    maxBytes = 1_600_000,
  } = options;

  let root = process.cwd();
  let outDir = "dist";
  const pack = (s) =>
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

      // singlefile이 인라인한 것만 정확히 겨냥한다 — 손으로 쓴 <style>은 그대로 둔다.
      const STYLE_RE = /<style[^>]*\brel="stylesheet"[^>]*>([\s\S]*?)<\/style>/;
      const SCRIPT_RE = /<script type="module"[^>]*>([\s\S]*?)<\/script>/;

      const style = html.match(STYLE_RE);
      const script = html.match(SCRIPT_RE);
      if (!style || !script) {
        // 구조가 예상과 다르면 원본 유지. 조용히 넘어가면 파일만 커지고 아무도 모른다.
        this.warn(
          `self-extracting-html: ${outDir}/index.html 건너뜀 — ` +
            `${!style ? '<style rel="stylesheet">' : ""}${!style && !script ? "와 " : ""}` +
            `${!script ? '<script type="module">' : ""}를 못 찾았다. ` +
            `vite-plugin-singlefile 출력 형태가 바뀌었는지 확인할 것.`,
        );
        return;
      }

      const cssB64 = pack(style[1]);
      const jsB64 = pack(script[1]);

      const payload =
        `<script type="text/plain" id="app-css">${cssB64}</script>` +
        `<script type="text/plain" id="app-js">${jsB64}</script>`;

      const boot = `<script>
(async () => {
  const splashOff = () => {
    const sp = document.getElementById('boot-splash');
    if (sp) sp.remove();
  };
  // 실패해도 #app 안에만 쓴다. 예전엔 document.body.innerHTML로 통째로 지웠는데,
  // 그러면 정적 본문(section#intro)까지 함께 사라져 사람도 크롤러도 읽을 게 없어진다.
  const fail = (msg, color) => {
    splashOff();
    const host = document.getElementById('app') || document.body;
    host.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:50vh;font:15px/1.6 sans-serif;color:' + color + ';text-align:center;padding:40px">' + msg + '</div>';
  };
  if (typeof DecompressionStream === 'undefined') {
    fail(${JSON.stringify(unsupportedHtml)}, '#333');
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
    splashOff();
  } catch (e) {
    fail(${JSON.stringify(loadErrorPrefix)} + e, '#c00');
  }
})();
</script>`;

      // 스플래시는 #app 자리(첫 화면)만 덮는다. 예전엔 position:fixed;inset:0 라
      // 스크롤해도 따라와 그 아래 정적 본문에 닿을 수가 없었다 —
      // absolute로 두면 로딩 중에도 아래로 내려 도구 설명을 읽을 수 있다.
      const splash =
        `<div id="boot-splash" style="position:absolute;top:0;left:0;width:100%;height:100dvh;display:flex;align-items:center;justify-content:center;color-scheme:light dark;background:light-dark(oklch(0.978 0.003 240),oklch(0.172 0.008 250));z-index:99999">` +
        `<div style="width:34px;height:34px;border:3px solid light-dark(oklch(0.917 0.008 240),oklch(0.31 0.014 248));border-top-color:${accentColor};border-radius:50%;animation:bs .8s linear infinite"></div>` +
        `<style>@keyframes bs{to{transform:rotate(360deg)}}</style></div>`;

      // 찾을 때와 지울 때 같은 정규식을 써야 한다 — 느슨한 쪽으로 지우면
      // index.html에 손으로 쓴 <style>(정적 본문용)이 대신 날아간다.
      html = html
        .replace(STYLE_RE, "")
        .replace(SCRIPT_RE, payload + boot)
        .replace(/<body([^>]*)>/, `<body$1>${splash}`);

      const bytes = Buffer.byteLength(html);
      if (bytes > maxBytes) {
        // 넘으면 빈 화면이 아니라 "불러오기에 실패했어요"가 본문으로 색인되는
        // 절벽형 실패다. 조용히 통과시키지 말고 여기서 세운다.
        this.error(
          `self-extracting-html: ${outDir}/index.html 가 ${(bytes / 1024).toFixed(0)} kB — ` +
            `상한 ${(maxBytes / 1024).toFixed(0)} kB를 넘었다. ` +
            `Google의 HTML 색인 처리 한도가 2MB라 그 앞에서 막는다. ` +
            `무거운 의존성을 지연 로드로 돌리거나 selfExtractingHtml({ maxBytes })로 상한을 조정할 것.`,
        );
      }

      writeFileSync(file, html);
      const kb = (bytes / 1024).toFixed(0);
      this.info(`self-extracting-html: ${outDir}/index.html → ${kb} kB`);
    },
  };
}
