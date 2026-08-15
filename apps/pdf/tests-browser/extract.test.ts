/**
 * 텍스트 추출 — pdf.js를 실제로 태워서 잰다.
 *
 * `tests/pdf-text.test.ts`는 `layoutText`·`uprightCorrection`에 좌표를 손으로 넣어 잰다.
 * 여기서 다시 재는 것은 그 사이에 있는 것이다 — 인라인 워커가 뜨는가, 뷰포트 행렬이
 * 조각 행렬 왼쪽에 제대로 곱해지는가, 그러고도 글이 누웠을 때 2차 보정이 걸리는가.
 * 그 셋은 node에서 못 본다(CLAUDE.md 5번대로 워커가 `?worker&inline`이다).
 *
 * 표본의 성질이 여기 필요한 전부다: `makePdf`는 `/Rotate`만 바꾸고 글자는 회전하지 않은
 * 좌표에 그대로 그린다. apps/pdf 편집 탭이 만드는 PDF가 그 모양이다(CLAUDE.md 27번).
 */
import { describe, expect, it } from "vitest";
import {
  makeBlankPdf,
  makePdf,
  makeRotatedPdf,
  makeTextPdf,
  truncatePdf,
} from "../../../tests/fixtures/pdf";
import { extractPdfText, probePdf } from "../src/lib/pdf/extract";
import { PdfPasswordError } from "../src/lib/pdf/engine";
import { RangeSpecError } from "../src/lib/pdf/range";
import { encryptPdf } from "./fixtures/encrypted";

describe("extractPdfText", () => {
  it("쪽마다 그린 줄을 그 쪽의 글로 돌려준다", async () => {
    const doc = await extractPdfText("t.pdf", await makeTextPdf(3), {});
    expect(doc.pages.map((p) => p.text)).toEqual(["Page 1", "Page 2", "Page 3"]);
    expect(doc.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(doc.empty).toBe(false);
    expect(doc.emptyPages).toBe(0);
  });

  it("저장 이름은 확장자만 .txt로 바꾼 것이다", async () => {
    const doc = await extractPdfText("보고서.pdf", await makeTextPdf(1), {});
    expect(doc.fileName).toBe("보고서.txt");
  });

  it("쪽 경계는 폼 피드다 — 문서 하나가 .txt 한 장이다", async () => {
    const doc = await extractPdfText("t.pdf", await makeTextPdf(3), {});
    expect(doc.text).toBe("Page 1\n\f\nPage 2\n\f\nPage 3");
  });

  it("글자가 하나도 없는 쪽은 empty로 센다", async () => {
    const doc = await extractPdfText("t.pdf", await makeBlankPdf(2), {});
    expect(doc.empty).toBe(true);
    expect(doc.emptyPages).toBe(2);
    expect(doc.pages.every((p) => p.text === "")).toBe(true);
  });

  it("쪽 표기를 주면 그 쪽만 꺼내고 원래 쪽 번호를 유지한다", async () => {
    const doc = await extractPdfText("t.pdf", await makeTextPdf(5), {
      pageSpec: "2, 4-",
    });
    expect(doc.pages.map((p) => p.pageIndex)).toEqual([1, 3, 4]);
    expect(doc.pages.map((p) => p.text)).toEqual(["Page 2", "Page 4", "Page 5"]);
  });

  it("쪽 표기가 문서 밖만 가리키면 한 쪽도 안 꺼내고 거부한다", async () => {
    const err = await extractPdfText("t.pdf", await makeTextPdf(3), {
      pageSpec: "9-12",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RangeSpecError);
    expect((err as RangeSpecError).problem).toBe("syntax");
  });

  // 밖만 가리킨 것과 걸친 것은 다르다(`range.ts`의 resolveRange 주석 ①).
  it("경계에 걸친 표기는 잘라서 받는다", async () => {
    const doc = await extractPdfText("t.pdf", await makeTextPdf(3), {
      pageSpec: "2-9",
    });
    expect(doc.pages.map((p) => p.text)).toEqual(["Page 2", "Page 3"]);
  });

  it("진행률은 고른 쪽 수를 기준으로 센다", async () => {
    const seen: [number, number][] = [];
    await extractPdfText(
      "t.pdf",
      await makeTextPdf(5),
      { pageSpec: "2-4" },
      (page, total) => seen.push([page, total]),
    );
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("쪽마다 `/Rotate` 값이 달라도 쪽 하나씩 따로 본다", async () => {
    const doc = await extractPdfText("t.pdf", await makeRotatedPdf(), {});
    expect(doc.pages.map((p) => p.text)).toEqual([
      "Rotate 0",
      "Rotate 90",
      "Rotate 180",
      "Rotate 270",
    ]);
  });

  // CLAUDE.md 27번의 2차 보정.
  //
  // 되돌리기 실험(`uprightCorrection` 호출을 null로 바꿔 봤다)에서 실제로 빨개진 것은
  // 180° 하나다. 90·270°는 보정을 꺼도 초록이었다 — pdf.js가 기본값으로 인접 조각을
  // 한 항목으로 합쳐 주기 때문에, 이 표본에서는 한 줄이 언제나 조각 하나로 온다.
  // 그래서 줄 묶기(y 좌표)가 시험되지 않고, 조각 하나는 어느 방향으로 누워도 같은
  // 문자열이다. 네 방향을 다 적는 것은 계약을 적어 두려는 것이고, 회귀를 잡는 것은 180°다.
  //
  // **한 줄짜리 표본으로는 그 180°도 못 잡는다.** 줄이 하나면 순서가 뒤집혀도 결과가
  // 같아서, 처음 쓴 명세가 보정을 꺼 놓고도 초록이었다.
  const lines = ["First line", "Second line", "Third line"];
  for (const rotate of [0, 90, 180, 270] as const) {
    it(`\`/Rotate ${rotate}\`만 붙은 쪽에서도 줄이 그린 순서로 나온다`, async () => {
      const bytes = await makePdf([{ rotate, lines }]);
      const doc = await extractPdfText("t.pdf", bytes, {});
      expect(doc.pages[0].text).toBe(lines.join("\n"));
    });
  }

  it("암호가 걸린 문서는 PdfPasswordError로 올린다", async () => {
    const bytes = await encryptPdf(await makeTextPdf(1), "pw");
    await expect(extractPdfText("t.pdf", bytes, {})).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
  });

  it("열 수 없는 바이트는 그대로 던진다 — 비밀번호를 묻지 않는다", async () => {
    const broken = truncatePdf(await makeTextPdf(2));
    const err = await extractPdfText("t.pdf", broken, {}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PdfPasswordError);
  });
});

describe("probePdf", () => {
  it("쪽 수를 세고 글자 있는 문서를 알아본다", async () => {
    const probe = await probePdf("t.pdf", await makeTextPdf(4));
    expect(probe.pageCount).toBe(4);
    expect(probe.hasText).toBe(true);
  });

  // CLAUDE.md 32번 — 앞 5쪽만 보던 방식으로 되돌리면 이 표본이 "글자 없음"이 된다.
  it("글자가 여섯째 쪽에서 처음 나와도 찾는다", async () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      i === 5 ? { lines: ["Here"] } : {},
    );
    const probe = await probePdf("t.pdf", await makePdf(pages));
    expect(probe.hasText).toBe(true);
    expect(probe.pageCount).toBe(12);
  });

  it("글자가 없으면 전 쪽을 봤다고 밝힌다", async () => {
    const probe = await probePdf("t.pdf", await makeBlankPdf(7));
    expect(probe.hasText).toBe(false);
    expect(probe.complete).toBe(true);
    expect(probe.scannedPages).toBe(7);
  });

  it("글자를 찾으면 거기서 멈춘다 — 남은 쪽은 안 연다", async () => {
    const probe = await probePdf("t.pdf", await makeTextPdf(20));
    expect(probe.hasText).toBe(true);
    expect(probe.scannedPages).toBe(1);
    expect(probe.complete).toBe(false);
  });

  it("암호가 걸린 문서는 PdfPasswordError로 올린다", async () => {
    const bytes = await encryptPdf(await makeTextPdf(1), "pw");
    await expect(probePdf("t.pdf", bytes)).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
  });
});
