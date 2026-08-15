/** 표본 생성기의 명세 — `tests/fixtures/`가 짓는 PDF·이미지·GIF.
 *
 * 여기서 못 박는 성질은 둘이다.
 *   ① **같은 입력이면 같은 바이트.** 표본이 실행마다 흔들리면 그 표본을 쓰는 모든
 *      테스트가 흔들리고, 빨간 불이 코드 때문인지 표본 때문인지 가를 수 없다.
 *      pdf-lib이 `/CreationDate`·`/ModDate`에 현재 시각을 넣는 자리가 그 예다.
 *   ② **명세대로 지어진다.** 쪽 수·회전·크기·프레임 수·딜레이를 되읽어 대조한다.
 *      생성기가 조용히 다른 것을 만들면 그 위에 쌓은 단언은 아무것도 재지 않는다.
 *
 * 표본은 앱 코드를 하나도 안 부른다. 여기가 빨개지면 원인은 표본 쪽이다.
 */

import { describe, expect, it } from "vitest";

import { makeGif, makeGifFrames, readGif } from "./fixtures/gif";
import {
  decodeImage,
  differingPixels,
  makeJpeg,
  makePng,
  makeRgba,
  mulberry32,
  variance,
} from "./fixtures/image";
import { decryptPdf, encryptPdf } from "./fixtures/pdf-password";
import {
  makeBlankPdf,
  makePdf,
  makeRotatedPdf,
  makeTextPdf,
  pdfPageCount,
  pdfPageSizes,
  pdfRotations,
  truncatePdf,
} from "./fixtures/pdf";

describe("PDF 표본", () => {
  it("같은 명세로 두 번 지으면 바이트가 같다", async () => {
    const once = await makeTextPdf(2);
    const twice = await makeTextPdf(2);
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(true);
  });

  it("문서 날짜가 epoch로 박혀 있다 — 안 박으면 실행 시각이 바이트에 들어간다", async () => {
    const text = Buffer.from(await makeTextPdf(1)).toString("latin1");
    expect(text).toContain("/CreationDate (D:19700101000000Z)");
    expect(text).toContain("/ModDate (D:19700101000000Z)");
    // 두 번 지어 비교하는 것만으로는 못 잡는다 — 같은 초 안에 지으면 시각도 같다.
    expect(text).not.toContain(`D:${new Date().getFullYear()}`);
  });

  it("쪽 수는 명세한 만큼 나온다", async () => {
    expect(await pdfPageCount(await makeTextPdf(1))).toBe(1);
    expect(await pdfPageCount(await makeTextPdf(5))).toBe(5);
    expect(await pdfPageCount(await makeBlankPdf(3))).toBe(3);
  });

  it("글자 있는 쪽과 없는 쪽은 바이트가 다르다", async () => {
    const text = await makeTextPdf(1);
    const blank = await makeBlankPdf(1);
    expect(Buffer.from(text).equals(Buffer.from(blank))).toBe(false);
    // 글자를 그린 쪽이 더 크다. 같은 크기면 drawText가 아무것도 안 한 것이다.
    expect(text.length).toBeGreaterThan(blank.length);
  });

  it("/Rotate 0·90·180·270이 쪽마다 그대로 남는다", async () => {
    expect(await pdfRotations(await makeRotatedPdf())).toEqual([0, 90, 180, 270]);
  });

  it("회전을 걸어도 쪽 크기(MediaBox)는 안 돌아간다 — /Rotate는 표시 지시다", async () => {
    const bytes = await makePdf([{ size: [400, 200], rotate: 90 }]);
    expect(await pdfPageSizes(bytes)).toEqual([[400, 200]]);
  });

  it("쪽 크기를 안 주면 595×842다", async () => {
    expect(await pdfPageSizes(await makeBlankPdf(1))).toEqual([[595, 842]]);
  });

  it("잘라 낸 바이트는 pdf-lib이 못 연다", async () => {
    const broken = truncatePdf(await makeTextPdf(3));
    await expect(pdfPageCount(broken)).rejects.toThrow();
  });

  it("자르는 비율이 남는 길이를 정한다", async () => {
    const whole = await makeTextPdf(3);
    expect(truncatePdf(whole, 0.5).length).toBe(Math.floor(whole.length * 0.5));
    // 0에 가까워도 최소 1바이트는 남긴다 — 빈 배열은 "PDF가 아님"과 구별이 안 된다.
    expect(truncatePdf(whole, 0).length).toBe(1);
  });
});

describe("이미지 표본", () => {
  it("같은 seed면 픽셀이 같고, seed가 다르면 다르다", () => {
    const a = makeRgba({ seed: 7 });
    const b = makeRgba({ seed: 7 });
    const c = makeRgba({ seed: 8 });
    expect(differingPixels(a, b)).toBe(0);
    expect(differingPixels(a, c)).toBeGreaterThan(0);
  });

  it("PNG·JPEG 모두 두 번 만들면 바이트가 같다", () => {
    expect(Buffer.from(makePng({ seed: 3 })).equals(Buffer.from(makePng({ seed: 3 })))).toBe(true);
    expect(Buffer.from(makeJpeg({ seed: 3 })).equals(Buffer.from(makeJpeg({ seed: 3 })))).toBe(true);
  });

  it("mulberry32는 같은 씨앗에서 같은 수열을 낸다", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = [a(), a(), a()];
    expect(first).toEqual([b(), b(), b()]);
    // 0 이상 1 미만.
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("PNG는 손실이 없어 픽셀이 그대로 돌아온다", async () => {
    const source = makeRgba({ width: 24, height: 16, seed: 5 });
    const back = await decodeImage(makePng({ width: 24, height: 16, seed: 5 }));
    expect(back.width).toBe(24);
    expect(back.height).toBe(16);
    expect(differingPixels(source, back)).toBe(0);
  });

  it("기본 무늬는 잔 무늬다 — 3px 블록 안에서도 색이 갈린다", () => {
    const image = makeRgba({ width: 32, height: 32, seed: 2 });
    // 블록 하나(3×3)를 재도 분산이 남아야 모자이크·블러가 값을 움직인다.
    expect(variance(image, { x: 0, y: 0, width: 3, height: 3 })).toBeGreaterThan(20);
    expect(variance(image)).toBeGreaterThan(1000);
  });

  it("jitter를 0으로 두면 블록 안이 균일해진다 — 가리기 테스트에 쓰면 안 되는 표본이다", () => {
    const flat = makeRgba({ width: 32, height: 32, jitter: 0, cell: 4, seed: 2 });
    expect(variance(flat, { x: 0, y: 0, width: 4, height: 4 })).toBe(0);
  });

  it("알파는 255로 채운다", () => {
    const image = makeRgba({ width: 8, height: 8 });
    for (let i = 3; i < image.data.length; i += 4) expect(image.data[i]).toBe(255);
  });

  it("JPEG는 손실이 있어 픽셀이 달라지지만 크기는 그대로다", async () => {
    const source = makeRgba({ width: 32, height: 24, seed: 9 });
    const back = await decodeImage(makeJpeg({ width: 32, height: 24, seed: 9 }, 60));
    expect([back.width, back.height]).toEqual([32, 24]);
    expect(differingPixels(source, back)).toBeGreaterThan(0);
  });

  it("품질을 낮추면 JPEG가 작아진다", () => {
    const low = makeJpeg({ seed: 4 }, 20);
    const high = makeJpeg({ seed: 4 }, 95);
    expect(low.length).toBeLessThan(high.length);
  });
});

describe("GIF 표본", () => {
  it("같은 명세로 두 번 지으면 바이트가 같다", () => {
    const once = makeGifFrames(3, 80);
    const twice = makeGifFrames(3, 80);
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(true);
  });

  it("판독기가 논리 화면 크기와 프레임 수를 읽는다", () => {
    const info = readGif(makeGifFrames(4, 100, { spec: { width: 40, height: 30 } }));
    expect(info.version).toBe("89a");
    expect([info.width, info.height]).toEqual([40, 30]);
    expect(info.frames).toHaveLength(4);
  });

  it("딜레이는 1/100초 눈금으로 반올림돼 들어간다", () => {
    const info = readGif(
      makeGif([{ delayMs: 100 }, { delayMs: 34 }, { delayMs: 35 }, { delayMs: 0 }]),
    );
    expect(info.frames.map((f) => f.delayMs)).toEqual([100, 30, 40, 0]);
  });

  it("disposal은 프레임마다 따로 남는다", () => {
    const info = readGif(makeGif([{ dispose: 2 }, { dispose: 1 }, { dispose: 3 }]));
    expect(info.frames.map((f) => f.dispose)).toEqual([2, 1, 3]);
  });

  it("루프 횟수는 NETSCAPE 확장에서 나오고, 음수를 주면 확장 자체가 없다", () => {
    expect(readGif(makeGifFrames(2)).loop).toBe(0);
    expect(readGif(makeGifFrames(2, 100, { loop: 3 })).loop).toBe(3);
    expect(readGif(makeGifFrames(2, 100, { loop: -1 })).loop).toBe(null);
  });

  it("색표는 전역 하나뿐이다 — 프레임에 지역 색표가 안 붙는다", () => {
    const info = readGif(makeGifFrames(3));
    expect(info.globalPalette).toBe(true);
    expect(info.globalPaletteSize).toBeGreaterThan(0);
    expect(info.frames.every((f) => f.localPalette === false)).toBe(true);
  });

  it("프레임은 (0,0)에서 화면 크기 그대로 놓인다", () => {
    const info = readGif(makeGifFrames(2, 100, { spec: { width: 20, height: 12 } }));
    for (const frame of info.frames) {
      expect([frame.x, frame.y, frame.width, frame.height]).toEqual([0, 0, 20, 12]);
    }
  });

  it("투명 플래그는 안 켠다 — 켠 표본이 필요하면 프레임을 직접 짜야 한다", () => {
    expect(readGif(makeGifFrames(2)).frames.every((f) => f.transparent === false)).toBe(true);
  });

  it("GIF가 아닌 바이트를 넣으면 판독기가 던진다", () => {
    expect(() => readGif(makePng({ width: 8, height: 8 }))).toThrow(/GIF/);
  });

  it("프레임 크기가 서로 다르면 짓기를 거부한다", () => {
    const small = makeRgba({ width: 8, height: 8 });
    const big = makeRgba({ width: 16, height: 8 });
    expect(() => makeGif([{ image: small }, { image: big }])).toThrow();
  });

  it("프레임이 없으면 짓기를 거부한다", () => {
    expect(() => makeGif([])).toThrow();
  });
});

describe("암호 걸린 PDF 표본", () => {
  it("암호를 걸면 pdf-lib이 그냥은 못 열고, 풀면 쪽 수가 돌아온다", async () => {
    const plain = await makeTextPdf(2);
    const locked = await encryptPdf(plain, "열려라");
    await expect(pdfPageCount(locked)).rejects.toThrow();

    const unlocked = await decryptPdf(locked, "열려라");
    expect(await pdfPageCount(unlocked)).toBe(2);
  }, 30_000);

  it("암호가 틀리면 푸는 쪽이 던진다", async () => {
    const locked = await encryptPdf(await makeTextPdf(1), "열려라");
    await expect(decryptPdf(locked, "안 열려라")).rejects.toThrow();
  }, 30_000);

  it("암호화 결과는 결정적이지 않다 — 이 표본으로 바이트를 비교하지 말 것", async () => {
    const plain = await makeTextPdf(1);
    const once = await encryptPdf(plain, "가나다");
    const twice = await encryptPdf(plain, "가나다");
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(false);
  }, 30_000);
});
