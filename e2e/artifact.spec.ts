/**
 * 산출물 자체를 잰다 — 브라우저를 안 열고 파일만 본다.
 *
 * 여기 있는 이유는 하나다. 자가해제 후처리는 `vite-plugin-singlefile`이 낸 태그 모양에
 * **정규식으로 의존**해서, Vite나 플러그인이 올라가 태그가 바뀌면 조용히 건너뛴다
 * (CLAUDE.md 3번 — early return이라 빌드는 초록이다). 그러면 앱은 멀쩡히 뜨고 파일만
 * 두 배가 되므로 **조작 테스트로는 안 잡힌다.**
 *
 * 상한은 지금 크기에 3할쯤 여유를 둔 값이다. 기능이 늘어 넘으면 그때 올리면 된다 —
 * 후처리가 빠지면 두 배 넘게 뛰므로 그 둘은 헷갈리지 않는다.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");

/** 앱 → dist/index.html 상한(kB). */
const CEILING: Record<string, number> = {
  pdf: 1220,
  doc: 680,
  sheet: 630,
  lab: 380,
  video: 280,
  gif: 260,
  dev: 240,
  image: 180,
  drop: 120,
};

for (const [app, limit] of Object.entries(CEILING)) {
  test(`${app} — 단일 HTML이 자가해제형이고 ${limit}kB 아래다`, () => {
    const file = resolve(ROOT, `apps/${app}/dist/index.html`);
    const html = readFileSync(file, "utf8");

    // 후처리가 돌았다는 표시. 이게 없으면 인라인 코드가 날것으로 들어 있는 것이다.
    expect(html).toContain("DecompressionStream");
    expect(html).toContain("deflate-raw");

    const kb = Math.round(statSync(file).size / 1024);
    expect(kb, `${app} dist/index.html = ${kb}kB`).toBeLessThan(limit);
  });
}

test("문서 PWA는 wasm을 옆에 두고, 단일 HTML은 안 품는다", () => {
  const pkg = readFileSync(
    resolve(ROOT, "apps/doc/node_modules/@rhwp/core/package.json"),
    "utf8",
  );
  const name = `rhwp-${String(JSON.parse(pkg).version)}.wasm`;

  // PWA 쪽에는 파일로 나가 있다(8MB — 단일 HTML에 넣을 수 있는 크기가 아니다).
  const emitted = statSync(resolve(ROOT, `apps/doc/dist-pwa/${name}`));
  expect(emitted.size).toBeGreaterThan(1024 * 1024);

  // 단일 HTML에는 그 바이트가 없다 — 이름만 들고 배포 주소에서 받아 간다.
  // (이름 자체는 자가해제 압축 안에 들어가 있어 grep으로는 안 보인다. 그래서 크기로 잰다.)
  const single = statSync(resolve(ROOT, "apps/doc/dist/index.html")).size;
  expect(single).toBeLessThan(emitted.size / 4);
});
