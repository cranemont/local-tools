// 검색엔진에 내보이는 자산이 서로 어긋나지 않았는지 검사한다.
//
// 왜 있는가: OG 이미지 세 장이 404인 채로, 사이트맵에 두 페이지가 빠진 채로 오래 굴러갔다.
// 코드가 틀린 게 아니라 **아무도 세지 않아서** 생긴 결함이라, 세는 일을 CI에 맡긴다.
// `pnpm check`(=CI)에서 같이 돈다.
//
//  ① meta가 가리키는 og/*.png가 실재하는가 (카카오톡은 404면 폴백 없이 텍스트만 렌더한다)
//  ② 배포되는 페이지 · sitemap.xml · 랜딩 JSON-LD의 hasPart, 세 목록이 정확히 같은가
//  ③ 각 앱 index.html의 <body>에 크롤 가능한 본문이 최소치 이상 남아 있는가
//     (JS를 실행하지 않는 크롤러가 읽는 유일한 것 — 지우면 조용히 6단어로 돌아간다)
//  ④ 페이지마다 h1이 정확히 하나인가
//  ⑤ 정적 본문용 <style>이 자가해제 압축에 딸려 나가지 않았는가

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://tools.cranemont.com";

/** 배포되는 도구 페이지. .github/workflows/deploy.yml의 조립 목록과 같아야 한다. */
const APPS = ["pdf", "gif", "video", "image", "sheet", "doc", "drop", "dev", "lab", "stack"];

/** 크롤 가능한 본문의 최소 어절 수. 국내 경쟁 도구 사이트가 650~790단어다. */
const MIN_WORDS = 200;

const fail = [];

// ── ① OG 이미지가 실재하는가 ─────────────────────────────
const ogRefs = new Set();
for (const page of [...APPS.map((a) => `apps/${a}/index.html`), "site/index.html"]) {
  const html = readFileSync(join(root, page), "utf8");
  for (const [, name] of html.matchAll(/\/og\/([\w-]+\.png)/g)) ogRefs.add(name);
}
for (const name of [...ogRefs].sort()) {
  if (!existsSync(join(root, "site/og", name))) {
    fail.push(`og 이미지 없음: site/og/${name} — meta가 참조하는데 파일이 없어요`);
  }
}

// ── ② 배포 목록 · sitemap · hasPart 세 목록이 같은가 ──────
const expected = new Set([`${BASE}/`, ...APPS.map((a) => `${BASE}/${a}/`)]);

const sitemap = readFileSync(join(root, "site/sitemap.xml"), "utf8");
const inSitemap = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

const landing = readFileSync(join(root, "site/index.html"), "utf8");
const ld = JSON.parse(
  landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
);
const website = ld["@graph"].find((n) => n["@type"] === "WebSite");
const inHasPart = new Set([`${BASE}/`, ...website.hasPart.map((p) => p.url)]);

const diff = (label, got) => {
  for (const url of expected) if (!got.has(url)) fail.push(`${label}에 빠짐: ${url}`);
  for (const url of got) if (!expected.has(url)) fail.push(`${label}에 군더더기: ${url}`);
};
diff("sitemap.xml", inSitemap);
diff("랜딩 JSON-LD hasPart", inHasPart);

// ── ③④⑤ 앱 페이지의 정적 본문 ────────────────────────────
const wordCounts = [];
for (const app of APPS) {
  const page = `apps/${app}/index.html`;
  const html = readFileSync(join(root, page), "utf8");

  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? "";
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text ? text.split(" ").length : 0;
  wordCounts.push(words);

  if (words < MIN_WORDS) {
    fail.push(
      `${page} — 크롤 가능한 본문이 ${words}어절뿐이에요(최소 ${MIN_WORDS}). ` +
        `section#intro가 지워졌는지 보세요`,
    );
  }

  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) fail.push(`${page} — h1이 ${h1}개예요(하나여야 해요)`);

  // 정적 본문 스타일은 rel="stylesheet"가 없어야 압축을 안 탄다.
  if (!/<style>\s*\n\s*:root \{ color-scheme/.test(html)) {
    fail.push(`${page} — section#intro 전용 <style>이 안 보여요`);
  }
}

// ── 결과 ─────────────────────────────────────────────────
if (fail.length > 0) {
  console.error("\n[site] 검색엔진에 내보이는 자산이 어긋났어요:\n");
  for (const line of fail) console.error(`  · ${line}`);
  console.error(
    "\n새 도구를 추가했다면 이 파일의 APPS, site/sitemap.xml, 랜딩 JSON-LD의 hasPart,\n" +
      ".github/workflows/deploy.yml을 함께 고쳐 주세요.\n",
  );
  process.exit(1);
}

const min = Math.min(...wordCounts);
const max = Math.max(...wordCounts);
console.log(
  `[site] og 이미지 ${ogRefs.size}장 실재 · 페이지 ${expected.size}개가 sitemap·hasPart와 일치 · ` +
    `앱 ${APPS.length}개 정적 본문 ${min}~${max}어절 · h1 각 1개`,
);
