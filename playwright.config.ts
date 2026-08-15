import { defineConfig, devices } from "@playwright/test";

/**
 * 4층 — 빌드 산출물을 브라우저로 조작한다.
 *
 * 여기서만 잡히는 것이 있어서 둔다. 3층은 앱 **소스**를 개발 서버로 띄우므로,
 * 자가해제 후처리가 조용히 건너뛰거나(CLAUDE.md 3번) 워커·wasm이 인라인에서 빠져도
 * 초록이다. 산출물은 그것들이 다 굳은 뒤의 파일이다.
 *
 * 늘리는 기준은 "빌드 산출물에서만 깨지는가" 하나다. 화면 조작 자체는 3층이 훨씬 싸다.
 *
 * `@net` 태그는 남의 인프라에 달린 것이다(jsdelivr의 qpdf·heic wasm, 공개 Nostr 릴레이,
 * 구글 STUN). 배포는 `pnpm e2e:offline`이 막고, 이쪽은 나이틀리에서 돈다 —
 * 릴레이 하나가 죽었다고 배포가 멈추면 안 된다.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // 3층과 같은 헤드리스 셸을 쓴다 — 바이너리를 한 벌만 받게.
      use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell" },
    },
  ],
  webServer: {
    command: "node scripts/serve-dist.mjs",
    url: "http://localhost:4173/pdf/",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
