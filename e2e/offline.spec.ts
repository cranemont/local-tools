/**
 * 오프라인 스모크 — 빌드 산출물 하나를 열어 파일을 넣고 결과 파일을 받아 낸다.
 *
 * 3층(브라우저 모드)은 앱 **소스**를 개발 서버로 띄운다. 그래서 자가해제 후처리가 조용히
 * 건너뛰거나(CLAUDE.md 3번) 워커·wasm이 인라인에서 빠져도 초록이다. 여기서 여는 것은
 * 그것들이 다 굳은 뒤의 `dist/index.html` 한 장이다.
 *
 * 앱마다 한 갈래씩만 잰다 — 안에서 무엇을 계산하는지는 1·2·3층이 훨씬 싸게 잰다.
 * 여기서 묻는 것은 "이 파일 한 장으로 일이 끝나는가"다.
 *
 * 네트워크를 아예 막고 돈다(`page.route`). 그래서 남의 인프라가 죽어도 이 명세는 안 흔들리고,
 * 반대로 **오프라인이어야 할 앱이 몰래 밖으로 나가면 여기서 걸린다.**
 */
import { expect, test, type Page } from "@playwright/test";
import { makeTextPdf, pdfPageCount } from "../tests/fixtures/pdf";
import { makeGifFrames, readGif } from "../tests/fixtures/gif";
import { makePng } from "../tests/fixtures/image";
import { makeDocx } from "../tests/fixtures/docx";
import { makeVideo } from "../tests/fixtures/video";

/** 이 페이지가 밖으로 나가면 실패시킨다. 상대는 자기 자신(localhost)뿐이다. */
async function goOffline(page: Page, path: string): Promise<void> {
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://localhost:4173/")) {
      route.continue();
      return;
    }
    outside.push(url);
    route.abort();
  });
  await page.goto(path);
  page.on("close", () => expect(outside).toEqual([]));
}

/** 다운로드 버튼을 누르고 받은 바이트를 돌려준다. */
async function download(
  page: Page,
  click: () => Promise<void>,
): Promise<{ name: string; bytes: Buffer }> {
  const [event] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await event.path();
  const { readFile } = await import("node:fs/promises");
  return { name: event.suggestedFilename(), bytes: await readFile(path) };
}

test("pdf — 두 파일을 합쳐 한 장으로 내려받는다", async ({ page }) => {
  await goOffline(page, "/pdf/");
  await page.setInputFiles('input[type="file"]', [
    {
      name: "a.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await makeTextPdf(2)),
    },
    {
      name: "b.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await makeTextPdf(3)),
    },
  ]);
  // 썸네일이 다 뜰 때까지 — 여기까지 왔으면 인라인 pdf.js 워커가 산출물 안에서 돈 것이다.
  await expect(page.getByText("5쪽")).toBeVisible();

  const out = await download(page, () =>
    page.getByRole("button", { name: "전체 PDF로 내보내기" }).click(),
  );
  expect(out.name).toBe("merged.pdf");
  expect(await pdfPageCount(new Uint8Array(out.bytes))).toBe(5);
});

test("sheet — CSV를 열어 고치고 다시 CSV로 내려받는다", async ({ page }) => {
  await goOffline(page, "/sheet/");
  await page.setInputFiles('input[type="file"]', {
    name: "t.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("이름,수량\n사과,3\n배,5\n"),
  });
  await expect(page.getByText("사과")).toBeVisible();

  // 글자를 바로 치면 안 들어간다 — 편집은 Enter·F2·더블클릭으로 시작한다(App.svelte).
  await page.getByText("사과").dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("자두");
  await page.keyboard.press("Enter");
  await expect(page.getByText("자두")).toBeVisible();

  await page.getByRole("button", { name: "저장" }).click();
  const out = await download(page, () =>
    page.getByRole("button", { name: "CSV로 저장" }).click(),
  );
  expect(out.name).toBe("t.csv");
  // 줄 끝은 CRLF, 끝에도 한 줄(RFC 4180). 앞머리 BOM은 기본으로 붙는다 —
  // 엑셀에서 한글이 안 깨지게 하려는 설정이라 여기서도 그대로 나온다.
  expect(out.bytes.toString("utf8")).toBe("\ufeff이름,수량\r\n자두,3\r\n배,5\r\n");
});

test("image — PNG를 열어 WebP로 내려받는다", async ({ page }) => {
  await goOffline(page, "/image/");
  await page.setInputFiles('input[type="file"]', {
    name: "t.png",
    mimeType: "image/png",
    buffer: Buffer.from(makePng({ width: 200, height: 150 })),
  });
  await expect(page.getByText("200×150px")).toBeVisible();

  await page.getByRole("button", { name: "WebP", exact: true }).click();
  const out = await download(page, () =>
    page.getByRole("button", { name: "저장", exact: true }).click(),
  );
  expect(out.name).toBe("t.webp");
  // RIFF....WEBP — 실제로 다른 형식으로 다시 구운 것이다.
  expect(out.bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(out.bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
});

test("gif — GIF를 열어 딜레이를 바꿔 다시 만든다", async ({ page }) => {
  await goOffline(page, "/gif/");
  await page.setInputFiles('input[type="file"]', {
    name: "t.gif",
    mimeType: "image/gif",
    buffer: Buffer.from(makeGifFrames(3, 100)),
  });
  await expect(page.getByText("3프레임")).toBeVisible();

  await page.getByRole("button", { name: "2×", exact: true }).click();
  // 만들기와 내려받기가 두 걸음이다 — 다 만든 뒤에야 받는 버튼이 생긴다.
  await page.getByRole("button", { name: "GIF 만들기" }).click();
  const out = await download(page, () =>
    page.getByRole("button", { name: "다운로드" }).click(),
  );
  expect(out.name.endsWith(".gif")).toBe(true);

  const info = readGif(new Uint8Array(out.bytes));
  expect(info.frames).toHaveLength(3);
  // 2배속이면 100ms가 50ms로 나간다(1/100초 눈금 — CLAUDE.md 24번).
  expect(info.frames.map((f) => f.delayMs)).toEqual([50, 50, 50]);
});

test("video — WebM을 열어 MP4로 내보낸다", async ({ page }) => {
  await goOffline(page, "/video/");
  await page.setInputFiles('input[type="file"]', {
    name: "t.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(await makeVideo()),
  });
  await expect(page.getByText("320×240 · 0:02.0 · 2 KB")).toBeVisible();

  // 무손실(패킷 복사)로 간다. 표본의 패킷 안은 프레임 번호로 채운 바이트라 VP9가 아니고,
  // 재인코딩 경로는 WebCodecs가 "key로 표시됐는데 키 프레임이 아니다"로 거부한다
  // (`tests/fixtures/video.ts` 머리말). 컨테이너를 지나는 것은 이 길로 잰다.
  await page.getByRole("button", { name: "무손실(빠름)" }).click();
  await page.getByRole("button", { name: "MP4 만들기" }).click();
  const out = await download(page, () =>
    page.getByRole("button", { name: "다운로드" }).click(),
  );
  expect(out.name.endsWith(".mp4")).toBe(true);
  // ISO BMFF — 앞 상자가 ftyp이다.
  expect(out.bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
});

test("doc — 워드 문서를 열어 마크다운으로 내려받는다", async ({ page }) => {
  await goOffline(page, "/doc/");
  await page.setInputFiles('input[type="file"]', {
    name: "보고.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(
      makeDocx({
        paragraphs: ["첫 문단입니다"],
        table: [
          ["항목", "금액"],
          ["교통비", "12000"],
        ],
      }),
    ),
  });
  await expect(page.getByText("워드 문서 · 1 KB")).toBeVisible();

  const out = await download(page, () =>
    page.getByRole("button", { name: "마크다운 저장" }).click(),
  );
  expect(out.name).toBe("보고.md");
  const text = out.bytes.toString("utf8");
  expect(text).toContain("첫 문단입니다");
  expect(text).toContain("| 항목 | 금액 |");
});
