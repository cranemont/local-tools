/**
 * 빌드 산출물을 배포와 같은 주소 모양으로 띄우는 정적 서버 — 4층(e2e) 전용.
 *
 * 왜 필요한가:
 *  · `file://`로 열면 apps/doc이 wasm을 **배포 주소에서** 받는다(상대경로가 없으므로
 *    `engine.ts`가 폴백한다). 그러면 CI가 방금 만든 것이 아니라 프로덕션에 올라간 옛
 *    바이트를 재게 되고, 검사가 남의 서버에 매달린다.
 *  · 앱마다 산출 디렉터리가 다르다 — 시트와 문서만 PWA 쪽(`dist-pwa/`)을 얹는다.
 *    그 갈래는 `.github/workflows/deploy.yml`의 Assemble site 단계와 같아야 한다.
 *
 * 의존성 없이 node만 쓴다. 파일 개수가 적어 캐시도 색인도 두지 않는다.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT ?? 4173);

/**
 * 주소 앞머리 → 그 앱이 실제로 배포되는 디렉터리.
 * 시트·문서는 PWA를 얹는다(매니페스트·서비스 워커·wasm이 거기 있다).
 */
const APPS = {
  pdf: "apps/pdf/dist",
  gif: "apps/gif/dist",
  video: "apps/video/dist",
  dev: "apps/dev/dist",
  image: "apps/image/dist",
  drop: "apps/drop/dist",
  lab: "apps/lab/dist",
  sheet: "apps/sheet/dist-pwa",
  doc: "apps/doc/dist-pwa",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** 주소 하나를 디스크 경로로. 앱 밖으로 나가는 경로는 안 준다. */
function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0]));
  const [, head, ...rest] = clean.split("/");
  const base = APPS[head];
  if (!base) return null;

  const dir = join(ROOT, base);
  const target = resolve(dir, rest.join("/") || "index.html");
  if (!target.startsWith(dir)) return null;
  if (existsSync(target) && statSync(target).isDirectory()) {
    return join(target, "index.html");
  }
  return target;
}

createServer((req, res) => {
  const file = resolvePath(req.url ?? "/");
  if (!file || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  process.stdout.write(`serve-dist: http://localhost:${PORT}/\n`);
});
