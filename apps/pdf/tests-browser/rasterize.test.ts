/**
 * 래스터화·이미지 재포장 — 캔버스가 있어야 도는 자리.
 *
 * node에서는 한 줄도 못 잰다. `rasterizePdf`는 `document.createElement("canvas")`와
 * `canvas.toBlob`을, `repackAsImages`는 그 결과를 pdf-lib에 심는다.
 *
 * 픽셀 값으로 단언하지 않는다(Chrome과 node Skia가 어긋난다). 잴 수 있는 것은
 * 치수·형식·개수·이름과, 자원을 거뒀는가다.
 */
import { describe, expect, it } from "vitest";
import {
  makeBlankPdf,
  makePdf,
  makeTextPdf,
  pdfPageCount,
  pdfPageSizes,
} from "../../../tests/fixtures/pdf";
import { formatExt, rasterizePdf } from "../src/lib/pdf/rasterize";
import { repackAsImages } from "../src/lib/pdf/repack";
import { probePdf } from "../src/lib/pdf/extract";
import { PdfPasswordError } from "../src/lib/pdf/engine";
import { RangeSpecError } from "../src/lib/pdf/range";
import { encryptPdf } from "./fixtures/encrypted";

/** 다 쓴 미리보기 URL을 거둔다 — 안 거두면 테스트 페이지에 한 벌씩 쌓인다. */
function revoke(pages: readonly { url: string }[]): void {
  for (const p of pages) URL.revokeObjectURL(p.url);
}

describe("rasterizePdf", () => {
  it("72dpi가 배율 1이다 — 쪽 크기(pt)가 그대로 픽셀이 된다", async () => {
    const pages = await rasterizePdf("t.pdf", await makeTextPdf(1), {
      dpi: 72,
      format: "png",
    });
    expect([pages[0].width, pages[0].height]).toEqual([595, 842]);
    revoke(pages);
  });

  it("dpi를 올리면 픽셀이 그 비율로 는다", async () => {
    const pages = await rasterizePdf("t.pdf", await makeTextPdf(1), {
      dpi: 144,
      format: "png",
    });
    expect([pages[0].width, pages[0].height]).toEqual([1190, 1684]);
    revoke(pages);
  });

  it("쪽 회전은 세로·가로를 바꾼다", async () => {
    const bytes = await makePdf([{ rotate: 90, lines: ["A"] }]);
    const pages = await rasterizePdf("t.pdf", bytes, { dpi: 72, format: "png" });
    expect([pages[0].width, pages[0].height]).toEqual([842, 595]);
    revoke(pages);
  });

  it("형식마다 그 형식의 blob과 확장자가 나온다", async () => {
    const bytes = await makeTextPdf(1);
    for (const format of ["png", "jpeg", "webp"] as const) {
      const pages = await rasterizePdf("t.pdf", bytes, { dpi: 48, format });
      expect(pages[0].blob.type).toBe(`image/${format}`);
      expect(pages[0].name.endsWith(`.${formatExt(format)}`)).toBe(true);
      revoke(pages);
    }
  });

  it("이름은 쪽 수 자릿수만큼 0을 채운다", async () => {
    const pages = await rasterizePdf("보고서.pdf", await makeTextPdf(12), {
      dpi: 48,
      format: "png",
      pageSpec: "1, 12",
    });
    expect(pages.map((p) => p.name)).toEqual(["보고서-01.png", "보고서-12.png"]);
    revoke(pages);
  });

  it("JPEG는 알파가 없어 흰 종이를 먼저 깐다", async () => {
    const pages = await rasterizePdf("t.pdf", await makeBlankPdf(1), {
      dpi: 24,
      format: "jpeg",
      quality: 0.9,
    });
    const bitmap = await createImageBitmap(pages[0].blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const [r, g, b, a] = ctx.getImageData(5, 5, 1, 1).data;
    expect([r, g, b, a]).toEqual([255, 255, 255, 255]);
    revoke(pages);
  });

  it("쪽 표기가 문서 밖만 가리키면 한 장도 안 만든다", async () => {
    await expect(
      rasterizePdf("t.pdf", await makeTextPdf(3), {
        dpi: 48,
        format: "png",
        pageSpec: "9-12",
      }),
    ).rejects.toBeInstanceOf(RangeSpecError);
  });

  it("암호가 걸린 문서는 PdfPasswordError로 올린다", async () => {
    const bytes = await encryptPdf(await makeTextPdf(1), "pw");
    await expect(
      rasterizePdf("t.pdf", bytes, { dpi: 48, format: "png" }),
    ).rejects.toBeInstanceOf(PdfPasswordError);
  });
});

describe("repackAsImages", () => {
  it("쪽 수를 지키고 종이 크기도 지킨다 — 픽셀이 아니라 포인트로 담는다", async () => {
    const out = await repackAsImages("t.pdf", await makeTextPdf(3), {
      dpi: 144,
      quality: 70,
    });
    expect(await pdfPageCount(out)).toBe(3);
    const sizes = await pdfPageSizes(out);
    // 144dpi로 그리면 1190×1684픽셀이고, 72/144를 곱해 595×842pt로 되돌아온다.
    // 이 환산을 빼면 A4가 두 배 크기로 나온다.
    for (const [w, h] of sizes) {
      expect(Math.round(w)).toBe(595);
      expect(Math.round(h)).toBe(842);
    }
  });

  it("글자 레이어를 잃는다 — 되돌릴 수 없다는 경고의 근거다", async () => {
    const src = await makeTextPdf(2);
    expect((await probePdf("t.pdf", src)).hasText).toBe(true);
    const out = await repackAsImages("t.pdf", src, { dpi: 72, quality: 60 });
    expect((await probePdf("t.pdf", out)).hasText).toBe(false);
  });

  it("품질을 낮추면 파일이 작아진다", async () => {
    const src = await makeTextPdf(2);
    const high = await repackAsImages("t.pdf", src, { dpi: 96, quality: 90 });
    const low = await repackAsImages("t.pdf", src, { dpi: 96, quality: 30 });
    expect(low.length).toBeLessThan(high.length);
  });

  it("암호가 걸린 문서는 PdfPasswordError로 올린다", async () => {
    const bytes = await encryptPdf(await makeTextPdf(1), "pw");
    await expect(
      repackAsImages("t.pdf", bytes, { dpi: 72, quality: 70 }),
    ).rejects.toBeInstanceOf(PdfPasswordError);
  });
});
