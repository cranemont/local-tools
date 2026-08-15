/**
 * 이미지 파이프라인 — 디코드 → 회전·반전·크롭 → 맞춤·pica → 인코딩까지 실물로 태운다.
 *
 * node가 이미 재는 것: 목표 캔버스와 배치 계산(`size.ts`), 목표 용량 탐색의 상태 기계
 * (`target.ts`), 색 축소(`quantize.ts`), EXIF 바이트 조작(`exif.ts`). 전부 순수 함수다.
 * 여기서 재는 것은 그 결정이 실제 파일에 나타나는가다 — `createImageBitmap`·pica·
 * `canvas.toBlob`이 있어야 하는 자리라 node에서는 한 줄도 못 돈다.
 *
 * 픽셀 값으로 단언하지 않는다. 잴 수 있는 것은 치수·형식·용량 관계와, 무늬가 남았는가다.
 */
import { describe, expect, it } from "vitest";
import { makeRgba, variance } from "../../../tests/fixtures/rgba";
import { loadImage, releaseAll } from "../src/lib/image/decode";
import { processItem, renderRotated } from "../src/lib/image/pipeline";
import { targetSize } from "../src/lib/image/size";
import type {
  ImageItem,
  OutputSettings,
  ResizeSpec,
} from "../src/lib/image/types";

const NO_RESIZE: ResizeSpec = {
  mode: "none",
  scale: 100,
  width: 0,
  height: 0,
  longest: 0,
  fit: "stretch",
  padColor: null,
  noEnlarge: false,
};

const BASE: OutputSettings = {
  format: "png",
  quality: 90,
  resize: NO_RESIZE,
  keepExif: false,
  pngColors: null,
  pngDither: false,
  targetBytes: null,
};

/** 잔 무늬 한 장을 PNG 파일로 구워 앱이 여는 경로로 통과시킨다. */
async function loadPattern(width = 160, height = 120, seed = 3): Promise<ImageItem> {
  const px = makeRgba({ width, height, seed });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(px.data, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return loadImage(new File([blob], "t.png", { type: "image/png" }));
}

/** 결과 blob의 픽셀 — 성질로 단언하기 위한 판독기. */
async function pixels(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: d.width, height: d.height, data: d.data };
}

describe("loadImage", () => {
  it("치수와 썸네일을 갖춘 아이템으로 연다", async () => {
    const item = await loadPattern(160, 120);
    expect([item.width, item.height]).toEqual([160, 120]);
    expect(item.thumb.startsWith("data:image/png")).toBe(true);
    expect(item.transform).toEqual({
      rotation: 0,
      flipX: false,
      flipY: false,
      crop: null,
    });
    releaseAll();
  });

  it("우리가 모르는 형식은 거부한다", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "t.tga", {
      type: "image/x-tga",
    });
    await expect(loadImage(file)).rejects.toThrow();
  });
});

describe("processItem — 형식", () => {
  it("고른 형식으로 인코딩한다", async () => {
    const item = await loadPattern();
    for (const format of ["png", "jpeg", "webp"] as const) {
      const out = await processItem(item, { ...BASE, format });
      expect(out.blob.type).toBe(`image/${format}`);
      expect([out.width, out.height]).toEqual([160, 120]);
    }
    releaseAll();
  });

  it("JPEG 품질을 낮추면 파일이 작아진다", async () => {
    const item = await loadPattern();
    const high = await processItem(item, { ...BASE, format: "jpeg", quality: 95 });
    const low = await processItem(item, { ...BASE, format: "jpeg", quality: 30 });
    expect(low.blob.size).toBeLessThan(high.blob.size);
    releaseAll();
  });

  it("PNG 색 수를 줄이면 파일이 작아지고 그림은 남는다", async () => {
    const item = await loadPattern();
    const full = await processItem(item, BASE);
    const few = await processItem(item, { ...BASE, pngColors: 8 });
    expect(few.blob.size).toBeLessThan(full.blob.size);
    // 색을 줄여도 무늬가 사라지면 안 된다 — 한 색으로 뭉개졌다는 뜻이다.
    expect(variance(await pixels(few.blob))).toBeGreaterThan(0);
    releaseAll();
  });
});

describe("processItem — 크기", () => {
  it("배율은 화면 안내와 같은 함수로 계산한 캔버스를 낸다", async () => {
    const item = await loadPattern(160, 120);
    const resize: ResizeSpec = { ...NO_RESIZE, mode: "scale", scale: 50 };
    const out = await processItem(item, { ...BASE, resize });
    expect([out.width, out.height]).toEqual([
      targetSize(160, 120, resize).w,
      targetSize(160, 120, resize).h,
    ]);
    releaseAll();
  });

  // CLAUDE.md 22번 — 배율에는 noEnlarge를 안 건다. 한 번 걸었다가 "배율 200%"가 죽었다.
  it("배율 200%는 확대 안 함을 켜도 커진다", async () => {
    const item = await loadPattern(80, 60);
    const out = await processItem(item, {
      ...BASE,
      resize: { ...NO_RESIZE, mode: "scale", scale: 200, noEnlarge: true },
    });
    expect([out.width, out.height]).toEqual([160, 120]);
    releaseAll();
  });

  it("긴 변 맞춤에서는 확대 안 함이 원본 크기를 지킨다", async () => {
    const item = await loadPattern(80, 60);
    const out = await processItem(item, {
      ...BASE,
      resize: { ...NO_RESIZE, mode: "longest", longest: 400, noEnlarge: true },
    });
    expect([out.width, out.height]).toEqual([80, 60]);
    releaseAll();
  });

  it("정확한 크기 + 여백 맞춤은 캔버스를 채우고 그림 비율을 지킨다", async () => {
    const item = await loadPattern(160, 80);
    const out = await processItem(item, {
      ...BASE,
      resize: {
        ...NO_RESIZE,
        mode: "exact",
        width: 200,
        height: 200,
        fit: "contain",
        padColor: "#ff0000",
      },
    });
    expect([out.width, out.height]).toEqual([200, 200]);
    const px = await pixels(out.blob);
    const at = (x: number, y: number) => {
      const i = (y * px.width + x) * 4;
      return [px.data[i], px.data[i + 1], px.data[i + 2]];
    };
    // 160×80을 200×200에 넣으면 세로 100px만 그려지고 위아래 50px씩 여백이다.
    expect(at(100, 5)).toEqual([255, 0, 0]);
    expect(at(100, 195)).toEqual([255, 0, 0]);
    releaseAll();
  });
});

describe("processItem — 회전·크롭", () => {
  it("90° 회전은 가로·세로를 바꾼다", async () => {
    const item = await loadPattern(160, 120);
    item.transform = { ...item.transform, rotation: 90 };
    const out = await processItem(item, BASE);
    expect([out.width, out.height]).toEqual([120, 160]);
    releaseAll();
  });

  it("크롭은 그 상자만 남긴다", async () => {
    const item = await loadPattern(160, 120);
    item.transform = {
      ...item.transform,
      crop: { x: 20, y: 10, w: 60, h: 40 },
    };
    const out = await processItem(item, BASE);
    expect([out.width, out.height]).toEqual([60, 40]);
    releaseAll();
  });

  it("renderRotated는 회전만 적용한 PNG다 — 크롭은 안 먹는다", async () => {
    const item = await loadPattern(160, 120);
    item.transform = {
      ...item.transform,
      rotation: 270,
      crop: { x: 0, y: 0, w: 10, h: 10 },
    };
    const blob = await renderRotated(item);
    expect(blob.type).toBe("image/png");
    const px = await pixels(blob);
    expect([px.width, px.height]).toEqual([120, 160]);
    releaseAll();
  });
});

// CLAUDE.md 31번 — 목표 용량은 사용자가 고른 설정보다 더 줄이기만 한다.
describe("processItem — 목표 용량", () => {
  it("목표 아래로 떨어뜨리고 몇 번 시도했는지 알린다", async () => {
    const item = await loadPattern(320, 240);
    const plain = await processItem(item, { ...BASE, format: "jpeg" });
    const target = Math.floor(plain.blob.size / 3);

    const seen: number[] = [];
    const out = await processItem(
      item,
      { ...BASE, format: "jpeg", targetBytes: target },
      (info) => seen.push(info.attempt),
    );
    expect(out.blob.size).toBeLessThanOrEqual(target);
    expect(out.search?.met).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(out.search?.attempts).toBe(seen.length);
    releaseAll();
  });

  it("고른 품질이 탐색의 상한이다 — 더 좋게 만들지 않는다", async () => {
    const item = await loadPattern(320, 240);
    const out = await processItem(item, {
      ...BASE,
      format: "jpeg",
      quality: 40,
      // 원본보다 큰 목표 — 더 올릴 여지가 있어도 40을 넘지 않아야 한다.
      targetBytes: 5 * 1024 * 1024,
    });
    expect(out.search?.quality).toBeLessThanOrEqual(40);
    releaseAll();
  });

  it("원본이 이미 목표보다 작아도 파일을 내놓는다", async () => {
    const item = await loadPattern(64, 48);
    const out = await processItem(item, {
      ...BASE,
      format: "jpeg",
      targetBytes: 10 * 1024 * 1024,
    });
    expect(out.blob.size).toBeGreaterThan(0);
    expect(out.search?.met).toBe(true);
    releaseAll();
  });

  it("PNG 축은 고른 색 수를 상한으로 눌러 세운다", async () => {
    const item = await loadPattern(320, 240);
    const plain = await processItem(item, { ...BASE, pngColors: 32 });
    const out = await processItem(item, {
      ...BASE,
      pngColors: 32,
      targetBytes: Math.floor(plain.blob.size / 2),
    });
    expect(out.search?.colors).not.toBeUndefined();
    expect(out.search?.colors ?? 0).toBeLessThanOrEqual(32);
    releaseAll();
  });
});
