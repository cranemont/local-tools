import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import type { Plugin, ViteUserConfig } from "vitest/config";

// 테스트는 앱 밖(tests/)에 둔다. 앱 소스에 섞으면 svelte-check가 같이 훑고,
// 앱마다 vitest를 devDependency로 달아야 한다 — 산출물과 무관한 무게를 앱에 지우지 않는다.
//
// 층은 둘로 갈라진다.
//   node    — 브라우저 없이 도는 순수 엔진과 `.svelte.ts` 룬 상태 기계. `tests/`.
//   browser — 캔버스·WebCodecs·ImageDecoder·wasm이 있어야 도는 코드. `apps/<앱>/tests-browser/`.
//
// node 층에 svelte 플러그인을 다는 이유: `$state`·`$derived`는 컴파일을 거쳐야 값이 되므로
// 플러그인 없이는 `.svelte.ts`를 import하는 순간 `$state is not defined`로 죽는다.
// 테스트 파일 자체는 어느 층에서도 룬을 못 쓴다 — 싱글턴의 메서드를 부르고 파생값을 읽는다.
//
// 두 층이 같은 표본 생성기(`tests/fixtures/`)를 쓴다. 그것이 앱 패키지를 이름으로 부를 수
// 있게 아래 `APP_DEPS` 별칭을 두 층에 다 건다 — 사연은 그 표 위에 적어 두었다.

/**
 * 브라우저 층 프로젝트 하나.
 *
 * root가 `apps/<앱>`인 것이 이 설정의 전제다. 저장소 루트로 두면 svelte가 안 풀리고
 * (pnpm 워크스페이스), 테스트 폴더로 두면 앱 의존성이 안 풀린다.
 * 앱 tsconfig의 `include`가 `src/**`뿐이라 `tests-browser/`는 svelte-check에 안 걸린다.
 */
function browserApp(
  name: string,
  optimize: string[],
  extra?: Partial<ViteUserConfig>,
): ViteUserConfig {
  return {
    ...extra,
    // 별칭은 두 층에 다 건다. 표본 생성기가 `tests/`에 있어 root(=앱) 밖이라,
    // 브라우저 층에서도 거기서는 앱 이름이 저절로 안 풀린다.
    resolve: { alias: appDepAlias },
    // 콜드 스타트에서 Vite가 사전 번들을 끼워 넣으면 페이지를 리로드하고 그 파일의
    // 테스트가 통째로 실패한다. CI는 늘 콜드라 여기 안 적으면 상시 빨간 불이다.
    // 적어야 하는 것은 root 밖에서 처음 닿는 패키지와, CJS 의존을 안고 있는 패키지다.
    optimizeDeps: { include: optimize },
    // vite의 root로 세운다(test.root가 아니라) — svelte 플러그인이 svelte.config.js를
    // 찾는 자리가 여기다. test.root만 옮기면 앱 설정을 못 찾아 매 실행 경고가 붙는다.
    root: `apps/${name}`,
    // svelte.config.js가 있는 앱은 그것을 쓰고(`lang="ts"` 전처리), 없는 앱은 끈다 —
    // 안 끄면 없는 앱마다 "no Svelte config found" 경고가 매 실행 붙는다.
    plugins: [
      ...(extra?.plugins ?? []),
      svelte(
        existsSync(new URL(`apps/${name}/svelte.config.js`, import.meta.url))
          ? {}
          : { configFile: false },
      ),
    ],
    test: {
      name: `browser:${name}`,
      include: ["tests-browser/**/*.test.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [
          {
            browser: "chromium",
            // 4층과 같은 헤드리스 셸을 쓴다 — 바이너리를 한 벌만 받게(리눅스 zip 114.7MB).
            // 이걸 안 적으면 전체 크로미엄을 찾는데, CI는 `--only-shell`로만 받는다.
            launchOptions: { channel: "chromium-headless-shell" },
          },
        ],
      },
    },
  };
}

/**
 * apps/doc의 wasm 배달 플러그인을 브라우저 층에도 그대로 얹는다.
 *
 * 빌드용 `apps/doc/rhwp-wasm.ts`를 import하지 않고 여기 다시 적는 이유는 하나다 —
 * 그 파일의 `require.resolve("@rhwp/core/…")`는 자기 자리에서 풀리는데, 루트 설정으로
 * 번들되면 `import.meta.url`이 저장소 루트가 되어 못 찾는다. 그래서 앱 디렉터리를
 * 기준으로 다시 푼다. 하는 일은 원본의 ①(글루의 자기참조 끊기)과 개발 서버 미들웨어
 * 둘뿐이다 — 파일로 내보내는 ②는 빌드에만 필요하다.
 */
function rhwpForBrowser(): { plugin: Plugin; define: Record<string, string> } {
  const require = createRequire(new URL("apps/doc/package.json", import.meta.url));
  const pkgPath = require.resolve("@rhwp/core/package.json");
  const version = String(JSON.parse(readFileSync(pkgPath, "utf8")).version);
  const bytes = readFileSync(pkgPath.replace(/package\.json$/, "rhwp_bg.wasm"));
  const integrity = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
  const fileName = `rhwp-${version}.wasm`;

  return {
    define: {
      __RHWP_WASM_FILE__: JSON.stringify(fileName),
      __RHWP_WASM_SHA384__: JSON.stringify(integrity),
      __RHWP_WASM_REMOTE__: JSON.stringify("https://tools.cranemont.com/doc/"),
      __RHWP_VERSION__: JSON.stringify(version),
    },
    plugin: {
      name: "doc-rhwp-wasm-test",
      enforce: "pre",
      transform(code, id) {
        if (!id.includes("@rhwp/core") || !id.endsWith("rhwp.js")) return null;
        const cut = code.replace(
          /new URL\((['"])rhwp_bg\.wasm\1,\s*import\.meta\.url\)/g,
          `(() => { throw new Error("rhwp 엔진은 검증된 바이트를 직접 넘겨야 해요."); })()`,
        );
        return cut === code ? null : { code: cut, map: null };
      },
      // 이 미들웨어가 없으면 엔진이 배포 주소로 폴백한다 — CI가 방금 만든 것이 아니라
      // 프로덕션에 올라간 옛 wasm을 재게 된다.
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.split("?")[0].endsWith(`/${fileName}`)) {
            next();
            return;
          }
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Cache-Control", "no-cache");
          res.end(bytes);
        });
      },
    },
  };
}

const rhwp = rhwpForBrowser();

/**
 * 표본 생성기가 앱 패키지를 **이름으로** 부르게 해 주는 별칭 — 두 층에 다 건다.
 *
 * pnpm이 앱마다 `node_modules`를 갈라 놓아 `tests/`에서는 `pdf-lib`이 이름으로 안 풀린다.
 * 예전에는 생성기가 `../../apps/pdf/node_modules/pdf-lib`처럼 경로로 지목했는데, 브라우저
 * 층이 같은 생성기를 쓰기 시작하자 깨졌다 — 그 경로가 Vite에게는 소스 파일이라 사전 번들에서
 * 빠지고, 안고 있는 CJS 의존(`pako`)이 `default` 내보내기 없이 그대로 나간다.
 *
 * 앱마다 판이 갈리지 않게 어느 앱의 것을 쓰는지 여기 한 곳에 적는다.
 */
const APP_DEPS: Record<string, string> = {
  "pdf-lib": "pdf",
  fflate: "pdf",
  gifenc: "gif",
  mediabunny: "video",
  exceljs: "sheet",
  "@rhwp/core": "doc",
};

const appDepAlias = Object.entries(APP_DEPS).map(([pkg, app]) => ({
  find: pkg,
  replacement: fileURLToPath(
    new URL(`apps/${app}/node_modules/${pkg}`, import.meta.url),
  ),
}));

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          // configFile: false — 저장소 루트에는 svelte.config.js가 없고(앱마다 하나씩 있다)
          // 안 끄면 매 실행 경고 한 줄이 붙는다. 이 층은 `.svelte.ts`만 다룬다.
          svelte({ configFile: false }),
        ],
        resolve: { alias: appDepAlias },
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      browserApp("pdf", ["pdf-lib", "pdfjs-dist", "@neslinesli93/qpdf-wasm"]),
      browserApp("gif", ["gifenc"]),
      browserApp("image", ["pica"]),
      browserApp("doc", ["fflate"], {
        define: rhwp.define,
        plugins: [rhwp.plugin],
      }),
    ],
    coverage: {
      // 리포트만 낸다. 문턱값은 걸지 않는다 — 전체 퍼센트는 앱 하나가 끌어올린
      // 평균이라 아무것도 강제하지 못한다. 문턱을 세운다면 파일별이다.
      include: ["apps/*/src/lib/**/*.ts"],
      exclude: ["**/*.d.ts", "apps/stack/**"],
    },
  },
});
