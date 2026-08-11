import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const dataDir = resolve(here, "src/lib/data");

/**
 * 도시 뷰의 건물 높이는 "실제 소스 줄 수"다. 손으로 적으면 그날로 낡으므로
 * 빌드/개발 시점에 파일을 세어 가상 모듈로 넣는다 — 커밋되는 생성 파일이 없다.
 */
function stackLoc(): Plugin {
  const ID = "virtual:stack-loc";
  const RESOLVED = "\0" + ID;
  // check-stack-sources.mjs의 것과 같은 범위를 봐야 한다 — 한쪽만 넓으면 높이가 0인 건물이 생긴다.
  const PATH_RE = /"((?:apps|packages|scripts|site)\/[^"]+)"/g;

  return {
    name: "stack-loc",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const loc: Record<string, number> = {};
      for (const file of readdirSync(dataDir).filter((n) => n.endsWith(".ts"))) {
        const full = join(dataDir, file);
        this.addWatchFile(full);
        for (const [, rel] of readFileSync(full, "utf8").matchAll(PATH_RE)) {
          if (rel in loc) continue;
          const target = join(repoRoot, rel);
          // 경로의 실재는 check-stack-sources.mjs가 따로 강제한다. 여기선 0으로 두고 넘어간다.
          loc[rel] = existsSync(target) ? readFileSync(target, "utf8").split("\n").length : 0;
        }
      }
      return `export const LOC = ${JSON.stringify(loc)};`;
    },
  };
}

// 이 앱만 단일 HTML이 아니다 — 도구가 아니라 메타 페이지라서 오프라인 더블클릭 요구가 없다.
// 대신 코드 분할을 살려 three.js(도시 뷰)를 열 때만 내려받는다.
export default defineConfig({
  base: "./",
  plugins: [svelte(), stackLoc()],
  build: {
    target: "es2022",
  },
});
