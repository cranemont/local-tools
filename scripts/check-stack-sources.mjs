// apps/stack(기술 지도) 데이터가 코드와 어긋나지 않았는지 검사한다.
//
// 이 페이지는 코드를 손으로 설명한 지도라서, 파일이 옮겨지거나 의존성이 바뀌면 설명만
// 조용히 낡는다. 그걸 막는 장치다 — `pnpm check`(=CI)에서 같이 돈다.
//
//  ① 데이터가 가리키는 "apps/..."·"packages/..." 경로가 전부 실재하는가
//  ② 지도의 서드파티 목록(pkg)과 각 앱 package.json의 dependencies가 정확히 일치하는가
//  ③ 지도가 그리는 네트워크 상대(net.hosts)가 그 소스에 실제로 적혀 있는가

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "apps/stack/src/lib/data");

// 따옴표 안의 저장소 상대 경로만 집는다(주석 안의 경로는 검사하지 않는다).
const PATH_RE = /"((?:apps|packages|scripts|site)\/[^"]+)"/g;

const missing = [];
const referenced = new Set();
let checked = 0;

for (const file of readdirSync(dataDir).filter((name) => name.endsWith(".ts"))) {
  const text = readFileSync(join(dataDir, file), "utf8");
  for (const [, relPath] of text.matchAll(PATH_RE)) {
    checked += 1;
    if (existsSync(join(root, relPath))) referenced.add(relPath);
    else missing.push({ file, relPath });
  }
}

if (missing.length > 0) {
  console.error(`\n[stack] 데이터가 가리키는 파일 ${missing.length}개를 찾을 수 없어요:\n`);
  for (const { file, relPath } of missing) console.error(`  ${relPath}   (${file})`);
  console.error(
    "\n파일을 옮겼다면 apps/stack/src/lib/data/*.ts의 src 경로도 같이 고쳐 주세요.\n",
  );
  process.exit(1);
}

// ── ② 서드파티 목록 대조 ─────────────────────────────────────────
// 지도에 적힌 pkg: "..." 와 각 앱의 dependencies(워크스페이스 링크 제외)를 양방향으로 본다.
const PKG_RE = /pkg:\s*"([^"]+)"/g;
const mapped = new Set(
  [...readFileSync(join(dataDir, "stack.ts"), "utf8").matchAll(PKG_RE)].map(([, name]) => name),
);

const declared = new Set();
const appsDir = join(root, "apps");
for (const app of readdirSync(appsDir)) {
  const manifest = join(appsDir, app, "package.json");
  if (!existsSync(manifest)) continue;
  const deps = JSON.parse(readFileSync(manifest, "utf8")).dependencies ?? {};
  for (const [name, range] of Object.entries(deps)) {
    if (String(range).startsWith("workspace:")) continue; // 모노레포 내부 패키지는 서드파티가 아니다
    declared.add(name);
  }
}

const unmapped = [...declared].filter((name) => !mapped.has(name)).sort();
const stale = [...mapped].filter((name) => !declared.has(name)).sort();

if (unmapped.length > 0 || stale.length > 0) {
  console.error("\n[stack] 지도의 서드파티 목록이 package.json과 어긋나요:\n");
  for (const name of unmapped) console.error(`  + ${name} — 앱이 쓰는데 지도에 없어요`);
  for (const name of stale) console.error(`  - ${name} — 지도에 있는데 쓰는 앱이 없어요`);
  console.error("\napps/stack/src/lib/data/stack.ts의 TECHS를 맞춰 주세요.\n");
  process.exit(1);
}

// ── ③ 네트워크 상대 대조 ─────────────────────────────────────────
// 도시는 성벽 밖 설비를 net.hosts로 세운다. 릴레이가 교체되거나 CDN이 바뀌면 그림만
// 조용히 낡으므로, 적어 둔 호스트가 소스 어딘가에 실제로 있는지 본다.
const HOSTS_RE = /hosts:\s*\[([^\]]*)\]/g;
const stackText = readFileSync(join(dataDir, "stack.ts"), "utf8");
const hosts = new Set();
for (const [, body] of stackText.matchAll(HOSTS_RE)) {
  for (const [, host] of body.matchAll(/"([^"]+)"/g)) hosts.add(host);
}

const haystack = [...referenced].map((rel) => readFileSync(join(root, rel), "utf8")).join("\n");
const phantom = [...hosts].filter((host) => !haystack.includes(host)).sort();

if (phantom.length > 0) {
  console.error("\n[stack] 지도가 그리는 네트워크 상대를 소스에서 찾을 수 없어요:\n");
  for (const host of phantom) console.error(`  ${host}`);
  console.error(
    "\n주소가 바뀌었다면 apps/stack/src/lib/data/stack.ts의 net.hosts도 같이 고쳐 주세요.\n",
  );
  process.exit(1);
}

console.log(
  `[stack] 소스 경로 ${checked}개 확인 — 전부 실재 · 서드파티 ${mapped.size}개 package.json과 일치 · 네트워크 상대 ${hosts.size}곳 소스와 일치`,
);
