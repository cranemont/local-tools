/**
 * GIF·WebP 인코딩과 프레임 읽기 — 캔버스와 `ImageDecoder`가 있어야 도는 자리.
 *
 * node에서 이미 재는 것: 딜레이 눈금(`gif/timing.ts`), 차분 판정(`diff.ts`),
 * 가리기 좌표(`redact.ts`), 스냅샷(`plan.ts`). 전부 순수 함수라 결정만 잰다.
 * 여기서 재는 것은 그 결정이 실제 파일에 그대로 나타나는가다 — `OffscreenCanvas`로
 * 그리고, gifenc가 쓰고, 되읽어서 구조를 본다.
 *
 * 픽셀 값으로 단언하지 않는다(Chrome과 node Skia가 최대 8/255 어긋난다). 성질로 적는다.
 */
import { describe, expect, it } from "vitest";
import { makeGif, makeGifFrames, readGif } from "../../../tests/fixtures/gif";
import { makeRgba, variance } from "../../../tests/fixtures/rgba";
import { loadFile, releaseAll } from "../src/lib/gif/decode";
import { encodeGif } from "../src/lib/gif/encode";
import { encodeWebp } from "../src/lib/gif/webp";
import { snapshotPlan, type PlannedFrame } from "../src/lib/gif/plan";
import { newRegion } from "../src/lib/gif/redact";
import { outputSize, renderFrame } from "../src/lib/gif/transform";
import type { FrameSource, Transform } from "../src/lib/gif/types";

const FLAT: Transform = {
  crop: null,
  rotation: 0,
  flipH: false,
  flipV: false,
  scale: 1,
  redact: [],
};

/** 표본 GIF 한 개를 앱이 여는 경로로 통과시킨다 — `ImageDecoder`를 실제로 탄다. */
async function open(bytes: Uint8Array, name = "t.gif") {
  const file = new File([bytes as BlobPart], name, { type: "image/gif" });
  return loadFile(file);
}

function plan(
  source: FrameSource,
  frames: readonly PlannedFrame[],
  transform: Transform = FLAT,
) {
  return snapshotPlan({
    frames,
    sources: new Map([[source.id, source]]),
    transform,
    overlays: [],
    baseW: source.width,
    baseH: source.height,
  });
}

/**
 * 앞 프레임과 거의 같은 프레임들 — 왼쪽 위 작은 사각형만 프레임마다 바뀐다.
 *
 * `makeGifFrames`는 프레임마다 잔 무늬를 새로 뽑아 변경률이 1에 가깝다. 차분은 그때
 * 손해라서 스스로 꺼지므로(CLAUDE.md 34번) 그 표본으로는 차분 경로에 못 들어간다.
 */
function makeNearIdentical(count: number): Uint8Array {
  const base = makeRgba({ width: 64, height: 48, seed: 7 });
  const specs = [];
  for (let i = 0; i < count; i++) {
    const data = new Uint8ClampedArray(base.data);
    for (let y = 2; y < 10; y++) {
      for (let x = 2; x < 10; x++) {
        const at = (y * base.width + x) * 4;
        data[at] = (i * 37) % 256;
        data[at + 1] = (i * 91) % 256;
        data[at + 2] = (i * 13) % 256;
      }
    }
    specs.push({
      image: { width: base.width, height: base.height, data },
      delayMs: 100,
    });
  }
  return makeGif(specs);
}

/** 소스 안의 모든 프레임을 순서대로, 딜레이 하나로. */
function allFrames(source: FrameSource, delayMs: number): PlannedFrame[] {
  return Array.from({ length: source.frameCount }, (_, i) => ({
    sourceId: source.id,
    frameIndex: i,
    delayMs,
    selected: false,
  }));
}

describe("loadFile", () => {
  it("GIF를 프레임 목록으로 연다", async () => {
    const { source, frames } = await open(makeGifFrames(4, 120));
    expect(source.kind).toBe("animated");
    expect(source.frameCount).toBe(4);
    expect(frames).toHaveLength(4);
    expect(frames.every((f) => f.thumb.startsWith("data:image/"))).toBe(true);
    releaseAll();
  });

  it("파일에 적힌 딜레이를 그대로 읽어 온다", async () => {
    const { frames } = await open(
      makeGif([{ delayMs: 100 }, { delayMs: 250 }, { delayMs: 40 }]),
    );
    expect(frames.map((f) => f.delayMs)).toEqual([100, 250, 40]);
    releaseAll();
  });

  it("정지 이미지는 프레임 한 장이 된다", async () => {
    const canvas = new OffscreenCanvas(20, 16);
    const ctx = canvas.getContext("2d")!;
    const px = makeRgba({ width: 20, height: 16 });
    ctx.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const { source, frames } = await loadFile(
      new File([blob], "t.png", { type: "image/png" }),
    );
    expect(source.kind).toBe("still");
    expect(frames).toHaveLength(1);
    releaseAll();
  });

  it("우리가 모르는 형식은 거부한다", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "t.bmp", {
      type: "image/bmp",
    });
    await expect(loadFile(file)).rejects.toThrow();
  });
});

describe("encodeGif", () => {
  it("계획한 프레임 수와 화면 크기가 파일에 그대로 나온다", async () => {
    const { source } = await open(makeGifFrames(3, 100));
    const blob = await encodeGif({
      ...plan(source, allFrames(source, 100)),
      speed: 1,
      repeat: 0,
      maxColors: 64,
      dither: false,
      diff: false,
    });
    const info = readGif(new Uint8Array(await blob.arrayBuffer()));
    expect(info.frames).toHaveLength(3);
    expect([info.width, info.height]).toEqual([source.width, source.height]);
    expect(info.loop).toBe(0);
    releaseAll();
  });

  // CLAUDE.md 24번 — GIF는 1/100초 눈금이라 되읽으면 10ms 배수다.
  it("배속은 딜레이를 나눠 파일에 적는다", async () => {
    const { source } = await open(makeGifFrames(2, 200));
    const blob = await encodeGif({
      ...plan(source, allFrames(source, 200)),
      speed: 2,
      repeat: 0,
      maxColors: 32,
      dither: false,
      diff: false,
    });
    const info = readGif(new Uint8Array(await blob.arrayBuffer()));
    expect(info.frames.map((f) => f.delayMs)).toEqual([100, 100]);
    releaseAll();
  });

  it("반복 횟수를 첫 프레임에 적는다", async () => {
    const { source } = await open(makeGifFrames(2, 100));
    const blob = await encodeGif({
      ...plan(source, allFrames(source, 100)),
      speed: 1,
      repeat: 3,
      maxColors: 32,
      dither: false,
      diff: false,
    });
    expect(readGif(new Uint8Array(await blob.arrayBuffer())).loop).toBe(3);
    releaseAll();
  });

  it("색 수를 줄이면 팔레트 칸도 줄어든다", async () => {
    const { source } = await open(makeGifFrames(1, 100));
    const sizes: number[] = [];
    for (const maxColors of [8, 128]) {
      const blob = await encodeGif({
        ...plan(source, allFrames(source, 100)),
        speed: 1,
        repeat: 0,
        maxColors,
        dither: false,
        diff: false,
      });
      // 첫 프레임의 팔레트는 전역 색표로 나간다(gifenc 규약) — 지역 칸은 0이다.
      const info = readGif(new Uint8Array(await blob.arrayBuffer()));
      expect(info.frames[0].localPaletteSize).toBe(0);
      sizes.push(info.globalPaletteSize);
    }
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[0]).toBeLessThanOrEqual(8);
    releaseAll();
  });

  // CLAUDE.md 34번 — 투명으로 비워 둔 자리가 앞 프레임을 보이려면 "그대로 두기"여야 한다.
  it("거의 같은 프레임이면 차분이 붙는다 — 투명 인덱스와 유지 처리", async () => {
    const { source } = await open(makeNearIdentical(3));
    const frames = allFrames(source, 100);
    const opts = { speed: 1, repeat: 0, maxColors: 64, dither: false } as const;

    const readBack = async (diff: boolean) =>
      readGif(
        new Uint8Array(
          await (
            await encodeGif({ ...plan(source, frames), ...opts, diff })
          ).arrayBuffer(),
        ),
      );

    const off = await readBack(false);
    const on = await readBack(true);

    expect(off.frames.some((f) => f.transparent)).toBe(false);
    expect(on.frames.slice(1).every((f) => f.transparent)).toBe(true);
    expect(on.frames.every((f) => f.dispose === 1)).toBe(true);
    releaseAll();
  });

  // 같은 조건에서 파일이 실제로 작아지는가 — 차분을 켜는 이유가 이것이다.
  it("차분이 붙으면 파일이 작아진다", async () => {
    const { source } = await open(makeNearIdentical(6));
    const frames = allFrames(source, 100);
    const opts = { speed: 1, repeat: 0, maxColors: 64, dither: false } as const;
    const off = await encodeGif({ ...plan(source, frames), ...opts, diff: false });
    const on = await encodeGif({ ...plan(source, frames), ...opts, diff: true });
    expect(on.size).toBeLessThan(off.size);
    releaseAll();
  });

  // 잔 무늬가 매 프레임 통째로 바뀌면 차분은 손해다 — 꺼지는 것이 맞는 동작이다.
  it("프레임마다 그림이 통째로 달라지면 차분이 안 붙는다", async () => {
    const { source } = await open(makeGifFrames(3, 100));
    const blob = await encodeGif({
      ...plan(source, allFrames(source, 100)),
      speed: 1,
      repeat: 0,
      maxColors: 64,
      dither: false,
      diff: true,
    });
    const info = readGif(new Uint8Array(await blob.arrayBuffer()));
    expect(info.frames.some((f) => f.transparent)).toBe(false);
    releaseAll();
  });

  it("중단 신호를 주면 AbortError로 끝난다", async () => {
    const { source } = await open(makeGifFrames(4, 100));
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await encodeGif({
      ...snapshotPlan({
        frames: allFrames(source, 100),
        sources: new Map([[source.id, source]]),
        transform: FLAT,
        overlays: [],
        baseW: source.width,
        baseH: source.height,
        signal: ctrl.signal,
      }),
      speed: 1,
      repeat: 0,
      maxColors: 32,
      dither: false,
      diff: false,
    }).catch((e) => e);
    expect((err as DOMException).name).toBe("AbortError");
    releaseAll();
  });

  it("변형은 출력 크기를 바꾸고 파일이 그 크기로 나온다", async () => {
    const { source } = await open(makeGifFrames(1, 100));
    const tf: Transform = { ...FLAT, rotation: 90, scale: 0.5 };
    const blob = await encodeGif({
      ...plan(source, allFrames(source, 100), tf),
      speed: 1,
      repeat: 0,
      maxColors: 32,
      dither: false,
      diff: false,
    });
    const info = readGif(new Uint8Array(await blob.arrayBuffer()));
    const want = outputSize(source.width, source.height, tf);
    expect([info.width, info.height]).toEqual([want.w, want.h]);
    releaseAll();
  });
});

describe("encodeWebp", () => {
  it("VP8X·ANIM·ANMF를 붙여 애니메이션 WebP를 만든다", async () => {
    const { source } = await open(makeGifFrames(3, 100));
    const blob = await encodeWebp({
      ...plan(source, allFrames(source, 100)),
      speed: 1,
      loop: 0,
      quality: 80,
    });
    expect(blob.type).toBe("image/webp");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WEBP");
    expect(tag(12)).toBe("VP8X");
    // ANMF 청크가 프레임 수만큼 있어야 한다.
    let anmf = 0;
    for (let i = 12; i < bytes.length - 4; i++) {
      if (tag(i) === "ANMF") anmf++;
    }
    expect(anmf).toBe(3);
    releaseAll();
  });

  it("크로미엄이 되읽을 수 있는 WebP다", async () => {
    const { source } = await open(makeGifFrames(2, 100));
    const blob = await encodeWebp({
      ...plan(source, allFrames(source, 100)),
      speed: 1,
      loop: 0,
      quality: 90,
    });
    const back = await loadFile(new File([blob], "t.webp", { type: "image/webp" }));
    expect(back.source.frameCount).toBe(2);
    expect([back.source.width, back.source.height]).toEqual([
      source.width,
      source.height,
    ]);
    releaseAll();
  });
});

// CLAUDE.md 35번 — 가리기는 원본 위에 덧그리지 않는다. 여기서는 그림에 실제로
// 반영되는가만 본다(좌표 변환 자체는 node의 redact 명세가 잰다).
describe("renderFrame의 가리기", () => {
  it("모자이크를 건 자리는 무늬가 뭉개지고 밖은 그대로다", async () => {
    const { source } = await open(makeGifFrames(1, 100));
    const bitmap = await createImageBitmap(
      new Blob([makeGifFrames(1, 100) as BlobPart], { type: "image/gif" }),
    );

    const box = { x: 4, y: 4, w: 24, h: 20 };
    const region = newRegion("r1", box, source.width, source.height, 1, "mosaic");
    expect(region).not.toBeNull();

    const size = outputSize(source.width, source.height, FLAT);
    const read = (tf: Transform) => {
      const canvas = new OffscreenCanvas(size.w, size.h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      renderFrame(ctx, bitmap, tf, source.width, source.height, {
        overlays: [],
        index: 0,
        selected: false,
      });
      const d = ctx.getImageData(0, 0, size.w, size.h);
      return { width: d.width, height: d.height, data: d.data };
    };

    const plain = read(FLAT);
    const hidden = read({ ...FLAT, redact: [region!] });
    const inside = { x: box.x, y: box.y, width: box.w, height: box.h };
    const outside = {
      x: box.x + box.w + 2,
      y: box.y,
      width: 10,
      height: box.h,
    };

    expect(variance(hidden, inside)).toBeLessThan(variance(plain, inside));
    expect(variance(hidden, outside)).toBeCloseTo(variance(plain, outside), 5);
    releaseAll();
  });
});
