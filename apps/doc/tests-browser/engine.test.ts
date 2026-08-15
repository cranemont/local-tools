/**
 * 한글 엔진 — 받아서, 검증하고, 켜서, 쪽을 그린다.
 *
 * node 층(`tests/doc-editor.test.ts`)은 이 앞을 갈아 끼운다 — `ensureEngine`을 빈 약속으로
 * 바꾸고 wasm을 파일에서 직접 읽는다. 그래서 거기서는 **엔진을 받아 오는 길이 한 번도
 * 안 돈다**. 여기서 재는 것이 그 길이다(CLAUDE.md 16번):
 *   · `rhwp-<버전>.wasm`을 같은 자리에서 받는가
 *   · 빌드가 박은 SHA-384와 맞는가(어긋나면 폴백 없이 거부한다)
 *   · `init` 뒤에 문서가 실제로 열리는가
 * 그리고 쪽 SVG — 줄바꿈을 캔버스 `measureText`에 물어 오므로 node에서는 값이 다르다.
 *
 * **패닉을 부르지 않는다.** 한 번 패닉하면 wasm 인스턴스가 통째로 죽어(CLAUDE.md 17번)
 * 같은 페이지의 뒤 명세가 전부 실패한다. 패닉 갈래는 node 층이 잰다.
 */
import { describe, expect, it } from "vitest";
import {
  docFile,
  makeDocx,
  makeEncryptedHwp,
  makeHwp,
  makeHwpx,
} from "./fixtures/hwp";
import { ENGINE_VERSION, engineStatus, ensureEngine } from "../src/lib/doc/engine";
import {
  closeHwp,
  documentContent,
  openHwp,
  PasswordRequiredError,
  renderPage,
  searchAll,
  summarize,
  toHwpx,
} from "../src/lib/doc/hwp";
import { detect } from "../src/lib/doc/detect";
import { docxHtml, renderDocx } from "../src/lib/doc/docx";
import { htmlToMarkdown } from "../src/lib/doc/markdown";

describe("엔진 받아 오기", () => {
  it("검증을 통과해 ready가 된다", async () => {
    await ensureEngine();
    expect(engineStatus()).toBe("ready");
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("hwp 열기", () => {
  it("문단이 든 문서를 열어 쪽 수를 센다", async () => {
    const doc = await openHwp(await makeHwp({ paragraphs: ["첫 줄", "둘째 줄"] }));
    try {
      expect(summarize(doc).pages).toBeGreaterThanOrEqual(1);
    } finally {
      closeHwp(doc);
    }
  });

  // rhwp는 글자 하나에 `<text>` 하나를 내고 x를 직접 찍는다. 그 x가 `measureTextWidth`
  // 콜백에서 나오는데, 콜백을 다는 자리가 `engine.ts`이고 실체는 캔버스 `measureText`다.
  // node 층은 글자 수에 상수를 곱한 값을 대신 주므로 여기서만 진짜 값이 나온다.
  it("쪽을 SVG로 그린다 — 글자가 캔버스가 잰 자리에 하나씩 놓인다", async () => {
    const doc = await openHwp(await makeHwp({ paragraphs: ["보고서 초안"] }));
    try {
      const svg = renderPage(doc, 0);
      expect(svg.startsWith("<svg")).toBe(true);

      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const glyphs = [...parsed.querySelectorAll("text")];
      expect(glyphs.map((g) => g.textContent).join("")).toBe("보고서초안");

      const xs = glyphs.map((g) => Number(g.getAttribute("x")));
      expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true);
      // 띄어쓰기 자리(서→초)가 붙어 있는 자리보다 넓다 — 폭을 실제로 재고 있다는 뜻이다.
      expect(xs[3] - xs[2]).toBeGreaterThan(xs[1] - xs[0]);
    } finally {
      closeHwp(doc);
    }
  });

  it("본문에서 찾는다 — 없는 말은 안 나온다", async () => {
    const doc = await openHwp(
      await makeHwp({ paragraphs: ["예산 계획", "집행 예산 보고"] }),
    );
    try {
      expect(searchAll(doc, "예산", false).length).toBe(2);
      expect(searchAll(doc, "없는말", false)).toEqual([]);
    } finally {
      closeHwp(doc);
    }
  });

  // CLAUDE.md 18번 — 표는 문단 텍스트가 아니라 문단에 앵커된 컨트롤이다.
  it("표만 든 문서에서도 표가 마크다운으로 남는다", async () => {
    const table = [
      ["항목", "금액"],
      ["교통비", "12000"],
    ];
    const doc = await openHwp(await makeHwp({ table }));
    try {
      const { markdown } = htmlToMarkdown(documentContent(doc).html);
      expect(markdown).toContain("항목");
      expect(markdown).toContain("교통비");
      expect(markdown).toContain("|");
    } finally {
      closeHwp(doc);
    }
  });

  it("잠긴 문서는 비밀번호를 묻고, 주면 열린다", async () => {
    const bytes = await makeEncryptedHwp("비번1234", { paragraphs: ["잠긴 본문"] });
    await expect(openHwp(bytes)).rejects.toBeInstanceOf(PasswordRequiredError);

    const doc = await openHwp(bytes, "비번1234");
    try {
      expect(documentContent(doc).html).toContain("잠긴 본문");
    } finally {
      closeHwp(doc);
    }
  });

  it("틀린 비밀번호는 '다시 물어야 함'으로 온다", async () => {
    const bytes = await makeEncryptedHwp("맞는비번");
    const err = await openHwp(bytes, "틀린비번").catch((e) => e);
    expect(err).toBeInstanceOf(PasswordRequiredError);
    expect((err as PasswordRequiredError).wrongPassword).toBe(true);
  });

  it("열 수 없는 바이트는 사람 말로 실패한다 — 비밀번호를 묻지 않는다", async () => {
    const bytes = await makeHwp();
    const err = await openHwp(bytes.slice(0, Math.floor(bytes.length * 0.6))).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PasswordRequiredError);
  });

  it("hwpx로 내보낸 것을 다시 열 수 있다", async () => {
    const doc = await openHwp(await makeHwp({ paragraphs: ["표준으로 옮길 글"] }));
    let out: Uint8Array;
    try {
      out = toHwpx(doc);
    } finally {
      closeHwp(doc);
    }
    expect(detect("t.hwpx", out.slice(0, 16384))).toEqual({ kind: "hwpx" });

    const back = await openHwp(out);
    try {
      expect(documentContent(back).html).toContain("표준으로 옮길 글");
    } finally {
      closeHwp(back);
    }
  });

  it("hwpx도 그대로 열린다", async () => {
    const doc = await openHwp(await makeHwpx({ paragraphs: ["열린 문서 형식"] }));
    try {
      expect(documentContent(doc).html).toContain("열린 문서 형식");
    } finally {
      closeHwp(doc);
    }
  });
});

describe("docx", () => {
  it("페이지 모양 그대로 컨테이너에 그린다", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    try {
      await renderDocx(makeDocx({ paragraphs: ["워드 본문"] }), box);
      expect(box.textContent).toContain("워드 본문");
      expect(box.querySelector(".docx")).not.toBeNull();
    } finally {
      box.remove();
    }
  });

  it("다시 그리면 앞 내용이 남지 않는다", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    try {
      await renderDocx(makeDocx({ paragraphs: ["첫 번째"] }), box);
      await renderDocx(makeDocx({ paragraphs: ["두 번째"] }), box);
      expect(box.textContent).toContain("두 번째");
      expect(box.textContent).not.toContain("첫 번째");
    } finally {
      box.remove();
    }
  });

  it("시맨틱 HTML은 지연 로드한 mammoth가 준다", async () => {
    const html = await docxHtml(makeDocx({ paragraphs: ["의미 구조만"] }));
    expect(html).toContain("의미 구조만");
    expect(html).toContain("<p>");
  });

  it("워드의 표도 한글과 같은 마크다운 규칙을 지난다", async () => {
    const html = await docxHtml(
      makeDocx({
        table: [
          ["머리", "칸"],
          ["값1", "값2"],
        ],
      }),
    );
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("| 머리 | 칸 |");
    expect(markdown).toContain("값1");
  });

  it("놓인 파일은 이름이 아니라 앞 바이트로 갈린다", async () => {
    const hwp = docFile("보고서.docx", await makeHwp());
    const head = new Uint8Array(await hwp.slice(0, 16384).arrayBuffer());
    expect(detect(hwp.name, head)).toEqual({ kind: "hwp" });
  });
});
