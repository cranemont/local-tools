// 배포 직전에 sitemap.xml의 lastmod를 실제 마지막 변경일로 갈아 끼운다.
//
// URL 목록은 손으로 관리한다(site/sitemap.xml이 정본, check-site-assets.mjs가 강제).
// 여기서 고치는 것은 날짜뿐이다 — 손으로 적으면 반드시 낡고, 낡은 lastmod는
// 재크롤 우선순위를 **반대로** 낮춘다.
//
// 실행: node scripts/stamp-sitemap.mjs <대상 sitemap 경로>
// GitHub Actions에서 _site/sitemap.xml에 대고 돌린다(저장소 파일은 안 건드린다).
// ⚠️ actions/checkout은 기본이 shallow라 `fetch-depth: 0`이 있어야 날짜가 나온다.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.cwd(), process.argv[2] ?? "site/sitemap.xml");

/** 페이지가 무엇으로 만들어지는가 — 이 경로들이 바뀌면 그 페이지가 바뀐 것이다. */
const SHARED = ["packages/theme", "packages/vite-plugin-self-extracting"];
const SOURCES = {
  "": ["site"],
  pdf: ["apps/pdf", ...SHARED, "packages/wasm-loader"],
  gif: ["apps/gif", ...SHARED],
  video: ["apps/video", ...SHARED],
  image: ["apps/image", ...SHARED, "packages/wasm-loader"],
  sheet: ["apps/sheet", ...SHARED, "packages/pwa-kit"],
  doc: ["apps/doc", ...SHARED, "packages/pwa-kit", "packages/wasm-loader"],
  drop: ["apps/drop", ...SHARED],
  dev: ["apps/dev", ...SHARED],
  lab: ["apps/lab", ...SHARED],
  stack: ["apps/stack", "packages/theme"],
};

const lastCommitDate = (paths) => {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...paths], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
};

let xml = readFileSync(target, "utf8");
const stamped = [];
let missed = 0;

xml = xml.replace(
  /<loc>https:\/\/tools\.cranemont\.com\/([\w-]*)\/?<\/loc>(\s*)<lastmod>[^<]*<\/lastmod>/g,
  (whole, slug, gap) => {
    const paths = SOURCES[slug];
    const date = paths && lastCommitDate(paths);
    if (!date) {
      // 알 수 없으면 원래 값을 둔다 — 지어낸 날짜보다 낡은 날짜가 낫다.
      missed += 1;
      return whole;
    }
    stamped.push(`/${slug}${slug ? "/" : ""} ${date}`);
    return whole.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${date}</lastmod>`);
  },
);

writeFileSync(target, xml);
console.log(
  `sitemap lastmod: ${stamped.length}개 갱신${missed ? ` · ${missed}개는 이력을 못 찾아 그대로 둠` : ""}\n  ` +
    stamped.join("\n  "),
);
