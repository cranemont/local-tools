/**
 * 남의 인프라에 달린 갈래 — `@net` 태그가 붙는다.
 *
 * `pnpm e2e:offline`이 이 파일을 건너뛰므로 **배포를 막지 않는다.** jsdelivr가 느리거나
 * 릴레이가 죽었다고 배포가 멈추면 안 되고, 이 갈래가 잡는 것(SRI 부패·CDN 판 교체)은
 * 하루 늦게 알아도 된다. 도는 자리는 나이틀리다.
 *
 * qpdf는 CLAUDE.md 2번의 그 경로다 — 글루 JS를 SRI로, wasm을 SHA-384로 직접 검증한다.
 * 버전을 올리고 해시를 안 고치면 암호 기능이 통째로 죽는데, 그것을 여기서만 알 수 있다.
 */
import { expect, test } from "@playwright/test";
import { makeTextPdf, pdfPageCount } from "../tests/fixtures/pdf";

test("@net pdf — CDN에서 qpdf를 받아 암호를 걸고 다시 푼다", async ({ page }) => {
  test.setTimeout(120_000);

  // 태그가 사실인지 여기서 확인한다 — 밖으로 안 나갔으면 이 명세는 나이틀리가 아니라
  // 오프라인 쪽에 있어야 한다.
  const cdn: string[] = [];
  page.on("request", (req) => {
    if (req.url().startsWith("https://cdn.jsdelivr.net/")) cdn.push(req.url());
  });

  await page.goto("/pdf/");
  await page.getByRole("tab", { name: "압축·암호" }).click();
  await page.getByRole("button", { name: "암호 설정" }).click();

  await page.setInputFiles('input[type="file"]', {
    name: "a.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makeTextPdf(3)),
  });
  await page.getByLabel(/비밀번호/).first().fill("pw1234");

  const [locked] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("button", { name: "암호 걸기" }).click(),
  ]);
  const { readFile } = await import("node:fs/promises");
  const lockedBytes = await readFile(await locked.path());

  // pdf-lib은 암호가 걸린 문서를 그냥은 안 연다 — 실제로 걸렸다는 뜻이다.
  await expect(pdfPageCount(new Uint8Array(lockedBytes))).rejects.toThrow();

  await page.getByRole("button", { name: "암호 해제" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: lockedBytes,
  });
  await page.getByLabel(/비밀번호/).first().fill("pw1234");

  const [opened] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("button", { name: "암호 풀기" }).click(),
  ]);
  const openedBytes = await readFile(await opened.path());
  expect(await pdfPageCount(new Uint8Array(openedBytes))).toBe(3);

  // 글루 JS와 wasm 두 개. 엔진은 한 번만 받는다(두 번째 실행은 이미 켜진 것을 쓴다).
  expect(cdn.filter((u) => u.endsWith(".wasm"))).toHaveLength(1);
  expect(cdn.filter((u) => u.endsWith(".js"))).toHaveLength(1);
});
