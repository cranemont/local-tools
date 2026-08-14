import { defineConfig } from "vitest/config";

// 테스트는 앱 밖(tests/)에 둔다. 앱 소스에 섞으면 svelte-check가 같이 훑고,
// 앱마다 vitest를 devDependency로 달아야 한다 — 산출물과 무관한 무게를 앱에 지우지 않는다.
// 대상은 브라우저 없이 도는 순수 엔진뿐이다. 캔버스·WebCodecs·wasm이 필요한 코드는
// 여기서 재지 않는다(그건 실기 확인의 몫).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
