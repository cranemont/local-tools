import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// 테스트는 앱 밖(tests/)에 둔다. 앱 소스에 섞으면 svelte-check가 같이 훑고,
// 앱마다 vitest를 devDependency로 달아야 한다 — 산출물과 무관한 무게를 앱에 지우지 않는다.
//
// 두 갈래를 잰다.
//   ① 브라우저 없이 도는 순수 엔진 — 캔버스도 wasm도 안 부르는 함수들.
//   ② `.svelte.ts` 룬 상태 기계와, 코드로 지은 실물 표본의 왕복.
// ②를 열려고 svelte 플러그인을 단다. `$state`·`$derived`는 컴파일을 거쳐야 값이 되므로
// 플러그인 없이는 `.svelte.ts`를 import하는 순간 `$state is not defined`로 죽는다.
// 테스트 파일 자체는 여전히 룬을 못 쓴다 — 싱글턴의 메서드를 부르고 파생값을 읽는다.
//
// 여기서 재지 않는 것: `.svelte` 컴포넌트 마운트, 캔버스 픽셀, WebCodecs, wasm 엔진.
// 그건 브라우저가 있어야 하는 층의 몫이다.
//
// 앱 의존성은 루트에서 이름으로 안 풀린다(pnpm 격리). 표본 생성기가 앱 패키지를
// 부르는 방법은 `tests/fixtures/pdf.ts` 머리말에 적어 두었다.
export default defineConfig({
  // configFile: false — 저장소 루트에는 svelte.config.js가 없고(앱마다 하나씩 있다)
  // 안 끄면 매 실행 경고 한 줄이 붙는다. 앱 설정이 하는 일은 `.svelte` 파일의
  // `lang="ts"` 전처리뿐인데 이 층은 `.svelte.ts`만 다루므로 쓸 자리가 없다.
  plugins: [svelte({ configFile: false })],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      // 리포트만 낸다. 문턱값은 걸지 않는다 — 전체 퍼센트는 앱 하나가 끌어올린
      // 평균이라 아무것도 강제하지 못한다. 문턱을 세운다면 파일별이다.
      include: ["apps/*/src/lib/**/*.ts"],
      exclude: ["**/*.d.ts", "apps/stack/**"],
    },
  },
});
