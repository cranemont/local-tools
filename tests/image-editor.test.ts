/** 이미지 편집기 상태 기계 — 되돌리기가 무엇을 담는가, 크롭은 언제 실제 편집이 되는가,
 *  목표 용량은 누구에게 딸린 값인가.
 *
 * `tests/image-size.test.ts`와 `tests/image-target.test.ts`가 엔진의 규격(`targetSize`·
 * `fitPlan`·PNG 사다리)을 못 박는다면, 이 파일은 **화면 상태가 그 규격에 무엇을 먹이는가**를
 * 잰다. 규격이 맞아도 상태가 엉뚱한 값을 넘기면 결과는 틀린다.
 *
 * 재는 자리는 CLAUDE.md 세 곳이다.
 *   12번 — 크롭은 잡기·확정 2단계이고, 되돌리기는 장 목록과 장별 편집만 담는다.
 *   22번 — 크기 계산은 두 함수로 갈라져 있고 화면과 파이프라인이 같은 것을 부른다.
 *   31번 — 목표 용량은 고른 설정보다 **더 줄이기만** 한다. 그 설정이 곧 탐색의 상한이다.
 *
 * ## 부르는 방법
 *
 * `state.svelte.ts`는 룬 모듈이라 svelte 플러그인을 거쳐야 값이 된다(`vitest.config.ts`).
 * 테스트 파일에서는 룬을 못 쓴다 — 메서드를 부르고 파생값(`currentItem`·`settings`·
 * `canUndo`)을 읽는다. 앱은 모듈 싱글턴 `editor` 하나를 쓰지만 여기서는 테스트마다
 * `new EditorState()`를 만든다. 되돌리기 스택이 인스턴스 안에 사는 private 배열이라
 * 싱글턴을 처음 상태로 되돌릴 방법이 없어서다. 재는 대상은 같은 클래스다.
 *
 * ## 캔버스가 없는 자리에서 장을 붙이는 법
 *
 * `addFiles`는 `image/decode.ts`를 지나고 그 안에 `createImageBitmap`과
 * `document.createElement("canvas")`(썸네일)가 있다. node에는 둘 다 없다. 그래서 그
 * **둘만** `@napi-rs/canvas`로 갈아 끼운다(`installCanvasStubs`). 표본 PNG의 실제 치수가
 * 그대로 `ImageItem.width/height`로 들어오므로 크롭·회전 경계가 진짜 숫자 위에서 재진다.
 *
 * 갈아 끼우는 것은 그 둘뿐이다. 그 상태에서 `pipeline.ts`도 절반은 돈다 — 마지막
 * describe가 회전·크롭·형식·목표 용량이 산출물에 닿는지 잰다. 리사이즈는 pica가
 * `.from`을 Image·Canvas·ImageBitmap으로만 받아 못 돌고, PNG 색 줄이기는 `ImageData`가
 * 없어서 못 돈다. 그 둘은 브라우저가 있는 층의 몫이다.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CROP_RATIO_ORIGINAL,
  EditorState,
  MIN_CROP,
  WIDTH_DEFAULT,
} from "../apps/image/src/lib/editor/state.svelte";
import { loadImage } from "../apps/image/src/lib/image/decode";
import { MAX_COLORS, MIN_COLORS } from "../apps/image/src/lib/image/quantize";
import { processItem } from "../apps/image/src/lib/image/pipeline";
import { pngStepAt, pngSteps } from "../apps/image/src/lib/image/target";
import type { CropRect, ImageItem } from "../apps/image/src/lib/image/types";
import { makePng } from "./fixtures/image";

/** 기본 표본의 크기. 90도 돌리면 20×40이 되는 가로 그림이다. */
const W = 40;
const H = 20;

function pngFile(spec: { width: number; height: number }, name = "a.png"): File {
  const bytes = makePng(spec);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([buffer], name, { type: "image/png" });
}

/**
 * `createImageBitmap`과 `document.createElement("canvas")`를 @napi-rs/canvas로 갈아 끼운다.
 * 디코딩만 대신할 뿐 크기·픽셀은 진짜다 — 표본 PNG의 실제 치수가 상태로 들어온다.
 */
async function installCanvasStubs(): Promise<void> {
  const { createCanvas, loadImage: decodeBytes } = await import("@napi-rs/canvas");
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const image = await decodeBytes(Buffer.from(await blob.arrayBuffer()));
    // decode.ts가 LRU에서 밀려난 비트맵을 닫는다 — 닫는 시늉만 해 준다.
    (image as unknown as { close: () => void }).close = () => {};
    return image;
  });
  vi.stubGlobal("document", { createElement: () => createCanvas(1, 1) });
}

beforeAll(async () => {
  await installCanvasStubs();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** 장을 되돌리기 이력 없이 놓는다 — 이력이 걸린 상태는 `addFiles`가 따로 잰다. */
async function seed(
  ed: EditorState,
  sizes: { width: number; height: number }[] = [{ width: W, height: H }],
): Promise<ImageItem[]> {
  const items = await Promise.all(
    sizes.map((size, i) => loadImage(pngFile(size, `p${i}.png`))),
  );
  ed.items = items;
  ed.current = 0;
  return items;
}

/** 표본 하나를 놓은 편집기. */
async function withOneItem(): Promise<EditorState> {
  const ed = new EditorState();
  await seed(ed);
  return ed;
}

function cropOf(ed: EditorState, index = 0): CropRect | null {
  return ed.items[index].transform.crop;
}

describe("장을 붙이는 길", () => {
  it("붙인 장이 목록 끝에 쌓이고 되돌리기 지점이 하나 남는다", async () => {
    const ed = new EditorState();
    await ed.addFiles([
      pngFile({ width: W, height: H }, "one.png"),
      pngFile({ width: 16, height: 12 }, "two.png"),
    ]);
    expect(ed.items.map((i) => i.name)).toEqual(["one.png", "two.png"]);
    expect(ed.items[1].width).toBe(16);
    expect(ed.canUndo).toBe(true);
    ed.undo();
    expect(ed.items).toEqual([]);
  });

  it("읽지 못한 장은 나머지를 막지 않고 오류로만 모인다", async () => {
    const ed = new EditorState();
    await ed.addFiles([
      new File(["글자"], "note.txt", { type: "text/plain" }),
      pngFile({ width: W, height: H }, "ok.png"),
    ]);
    expect(ed.items.map((i) => i.name)).toEqual(["ok.png"]);
    expect(ed.error).toBe("지원하지 않는 형식이에요: note.txt");
  });

  it("여러 장이 실패하면 첫 오류에 남은 수를 붙여 한 줄로 알린다", async () => {
    const ed = new EditorState();
    await ed.addFiles([
      new File(["x"], "a.txt", { type: "text/plain" }),
      new File(["y"], "b.txt", { type: "text/plain" }),
    ]);
    expect(ed.error).toBe("지원하지 않는 형식이에요: a.txt 외 1건");
  });

  it("한 장도 안 붙으면 되돌리기 지점을 안 남긴다 — 되돌릴 것이 없다", async () => {
    const ed = new EditorState();
    await ed.addFiles([new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(ed.items).toEqual([]);
    expect(ed.canUndo).toBe(false);
  });

  it("빈 목록을 주면 아무 일도 안 한다", async () => {
    const ed = new EditorState();
    ed.error = "먼저 있던 오류";
    await ed.addFiles([]);
    expect(ed.error).toBe("먼저 있던 오류");
    expect(ed.revision).toBe(0);
  });

  it("다 붙이고 나면 진행 표시가 내려간다", async () => {
    const ed = new EditorState();
    await ed.addFiles([pngFile({ width: W, height: H })]);
    expect(ed.busy).toBe(false);
    expect(ed.busyMsg).toBe("");
  });
});

describe("되돌리기 스택은 장 목록과 장별 편집만 담는다", () => {
  it("회전을 되돌리면 각도가 돌아온다", async () => {
    const ed = await withOneItem();
    ed.rotate(1);
    expect(ed.items[0].transform.rotation).toBe(90);
    ed.undo();
    expect(ed.items[0].transform.rotation).toBe(0);
    expect(ed.canUndo).toBe(false);
    expect(ed.canRedo).toBe(true);
  });

  it("형식·품질·리사이즈는 스택에 안 담긴다 — 되돌려도 지금 고른 설정 그대로다", async () => {
    const ed = await withOneItem();
    ed.setFormat("png");
    ed.setQuality(30);
    ed.setResizeMode("scale", null);
    ed.setResizeScale(25);
    ed.rotate(1);
    ed.undo();
    expect(ed.items[0].transform.rotation).toBe(0);
    expect(ed.format).toBe("png");
    expect(ed.quality).toBe(30);
    expect(ed.resizeMode).toBe("scale");
    expect(ed.resizeScale).toBe(25);
  });

  it("설정만 바꾸면 되돌릴 것이 생기지 않는다", async () => {
    const ed = await withOneItem();
    ed.setFormat("webp");
    ed.setQuality(50);
    ed.setTarget(1, "MB");
    ed.setKeepExif(true);
    expect(ed.canUndo).toBe(false);
    ed.undo();
    expect(ed.format).toBe("webp");
  });

  it("삭제도 되돌릴 수 있다 — 지운 장이 자리째 돌아온다", async () => {
    const ed = new EditorState();
    const items = await seed(ed, [
      { width: W, height: H },
      { width: 16, height: 12 },
      { width: 24, height: 24 },
    ]);
    ed.select(2);
    ed.removeOne(items[2].id);
    expect(ed.items.length).toBe(2);
    expect(ed.current).toBe(1);
    ed.undo();
    expect(ed.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(ed.current).toBe(2);
  });

  it("모두 비우기도 되돌릴 수 있다", async () => {
    const ed = new EditorState();
    const items = await seed(ed, [{ width: W, height: H }, { width: 16, height: 12 }]);
    ed.clearAll();
    expect(ed.items).toEqual([]);
    ed.undo();
    expect(ed.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("스택은 서른 칸이다 — 서른한 번째 편집이 가장 오래된 것을 밀어낸다", async () => {
    const ed = await withOneItem();
    for (let i = 0; i < 31; i++) ed.rotate(1);
    expect(ed.items[0].transform.rotation).toBe(270); // 31 * 90 = 2790 → 270
    for (let i = 0; i < 30; i++) ed.undo();
    expect(ed.canUndo).toBe(false);
    // 처음(0도)이 아니라 한 번 돌린 자리까지만 돌아간다.
    expect(ed.items[0].transform.rotation).toBe(90);
  });

  it("되돌린 뒤 새로 편집하면 다시하기가 사라진다", async () => {
    const ed = await withOneItem();
    ed.rotate(1);
    ed.rotate(1);
    ed.undo();
    expect(ed.canRedo).toBe(true);
    ed.flip("x");
    expect(ed.canRedo).toBe(false);
    ed.redo();
    expect(ed.items[0].transform.rotation).toBe(90);
    expect(ed.items[0].transform.flipX).toBe(true);
  });

  it("다시하기는 되돌린 편집을 그대로 되살린다", async () => {
    const ed = await withOneItem();
    ed.rotate(1);
    ed.undo();
    ed.redo();
    expect(ed.items[0].transform.rotation).toBe(90);
    expect(ed.canRedo).toBe(false);
    expect(ed.canUndo).toBe(true);
  });

  it("되돌리기·다시하기는 잡아 둔 크롭 후보를 버린다 — 좌표계가 달라질 수 있다", async () => {
    const ed = await withOneItem();
    ed.rotate(1);
    ed.startCrop();
    ed.setCropDraft({ x: 0, y: 0, w: 10, h: 10 });
    ed.undo();
    expect(ed.cropMode).toBe(false);
    expect(ed.cropDraft).toBe(null);
  });

  it("여러 장을 한꺼번에 편집한 것도 한 번에 되돌아간다", async () => {
    const ed = new EditorState();
    await seed(ed, [{ width: W, height: H }, { width: 16, height: 12 }]);
    ed.setApplyToAll(true);
    ed.rotate(1);
    expect(ed.items.map((i) => i.transform.rotation)).toEqual([90, 90]);
    ed.undo();
    expect(ed.items.map((i) => i.transform.rotation)).toEqual([0, 0]);
  });

  it("편집마다 편집 세대가 오른다 — 미리보기가 이 값으로 다시 그린다", async () => {
    const ed = await withOneItem();
    const before = ed.revision;
    ed.rotate(1);
    ed.flip("y");
    expect(ed.revision).toBe(before + 2);
  });

  it("되돌릴 것이 없으면 아무 일도 안 한다", async () => {
    const ed = await withOneItem();
    ed.undo();
    ed.redo();
    expect(ed.items[0].transform.rotation).toBe(0);
    expect(ed.canUndo).toBe(false);
    expect(ed.canRedo).toBe(false);
  });
});

describe("크롭은 잡기와 확정 두 단계다", () => {
  it("후보를 잡는 것만으로는 아무것도 안 잘린다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 4, y: 2, w: 20, h: 10 });
    expect(cropOf(ed)).toBe(null);
    expect(ed.canUndo).toBe(false);
    expect(ed.cropMode).toBe(true);
  });

  it("확정해야 편집이 되고, 그때 되돌리기 지점이 남는다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 4, y: 2, w: 20, h: 10 });
    ed.applyCropDraft();
    expect(cropOf(ed)).toEqual({ x: 4, y: 2, w: 20, h: 10 });
    expect(ed.cropMode).toBe(false);
    expect(ed.cropDraft).toBe(null);
    ed.undo();
    expect(cropOf(ed)).toBe(null);
  });

  it("취소(Esc)는 후보를 버리고 편집을 남기지 않는다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 4, y: 2, w: 20, h: 10 });
    ed.cancelCrop();
    expect(ed.cropMode).toBe(false);
    expect(ed.cropDraft).toBe(null);
    expect(cropOf(ed)).toBe(null);
    expect(ed.canUndo).toBe(false);
  });

  it("확정할 후보가 없으면 아무 일도 안 하고 크롭 모드에 머문다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.applyCropDraft();
    expect(cropOf(ed)).toBe(null);
    expect(ed.cropMode).toBe(true);
    expect(ed.canUndo).toBe(false);
  });

  it("이미 잘린 장에서 다시 잡으면 그 영역을 그대로 다시 준다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 4, y: 2, w: 20, h: 10 });
    ed.startCrop();
    expect(ed.cropDraft).toEqual({ x: 4, y: 2, w: 20, h: 10 });
  });

  it("다시 잡아 준 후보는 복사본이다 — 끌기만 해도 편집이 바뀌면 2단계가 무너진다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 4, y: 2, w: 20, h: 10 });
    ed.startCrop();
    const draft = ed.cropDraft;
    if (draft) draft.x = 30;
    expect(cropOf(ed)).toEqual({ x: 4, y: 2, w: 20, h: 10 });
  });

  it("그림 밖으로 나간 후보는 확정할 때 그림 안으로 밀려 들어간다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: -30, y: -30, w: 200, h: 200 });
    ed.applyCropDraft();
    expect(cropOf(ed)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it("모서리를 벗어난 후보는 크기를 지키고 자리만 안으로 당겨진다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 36, y: 18, w: 10, h: 10 });
    ed.applyCropDraft();
    expect(cropOf(ed)).toEqual({ x: 30, y: 10, w: 10, h: 10 });
  });

  it("너무 작은 후보는 최소 변(8px)까지 부풀려 확정된다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 5, y: 5, w: 2, h: 2 });
    ed.applyCropDraft();
    expect(cropOf(ed)).toEqual({ x: 5, y: 5, w: MIN_CROP, h: MIN_CROP });
  });

  it("그림이 최소 변보다 작으면 그림 크기가 이긴다", async () => {
    const ed = new EditorState();
    await seed(ed, [{ width: 6, height: 6 }]);
    ed.startCrop();
    ed.setCropDraft({ x: 0, y: 0, w: 2, h: 2 });
    ed.applyCropDraft();
    expect(cropOf(ed)).toEqual({ x: 0, y: 0, w: 6, h: 6 });
  });

  it("장을 바꾸면 크롭 모드가 닫힌다", async () => {
    const ed = new EditorState();
    await seed(ed, [{ width: W, height: H }, { width: 16, height: 12 }]);
    ed.startCrop();
    ed.setCropDraft({ x: 0, y: 0, w: 10, h: 10 });
    ed.select(1);
    expect(ed.current).toBe(1);
    expect(ed.cropMode).toBe(false);
    expect(ed.cropDraft).toBe(null);
  });

  it("장이 하나도 없으면 크롭을 시작할 수 없다", () => {
    const ed = new EditorState();
    ed.startCrop();
    expect(ed.cropMode).toBe(false);
  });

  it("모두 비우기는 크롭 모드도 닫는다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.clearAll();
    expect(ed.cropMode).toBe(false);
  });
});

describe("회전·반전은 크롭 좌표계를 건드린다", () => {
  it("회전은 크롭과 후보를 함께 버린다 — 좌표계가 달라진다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 4, y: 2, w: 20, h: 10 });
    ed.startCrop();
    ed.setCropDraft({ x: 4, y: 2, w: 20, h: 10 });
    ed.rotate(1);
    expect(cropOf(ed)).toBe(null);
    expect(ed.cropDraft).toBe(null);
    // 모드는 열어 둔다 — 돌린 그림 위에서 새로 잡으라는 뜻이다.
    expect(ed.cropMode).toBe(true);
  });

  it("반시계 회전도 각도가 0..270 안에 남는다", async () => {
    const ed = await withOneItem();
    ed.rotate(-1);
    expect(ed.items[0].transform.rotation).toBe(270);
    ed.rotate(-1);
    expect(ed.items[0].transform.rotation).toBe(180);
  });

  it("좌우 반전은 크롭을 거울로 옮긴다 — 같은 자리가 남는다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 2, y: 3, w: 10, h: 8 });
    ed.flip("x");
    expect(cropOf(ed)).toEqual({ x: W - 2 - 10, y: 3, w: 10, h: 8 });
  });

  it("상하 반전은 세로만 옮긴다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 2, y: 3, w: 10, h: 8 });
    ed.flip("y");
    expect(cropOf(ed)).toEqual({ x: 2, y: H - 3 - 8, w: 10, h: 8 });
  });

  it("두 번 뒤집으면 크롭이 제자리로 돌아온다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 2, y: 3, w: 10, h: 8 });
    ed.flip("x");
    ed.flip("x");
    expect(cropOf(ed)).toEqual({ x: 2, y: 3, w: 10, h: 8 });
  });

  it("최소 변보다 작은 크롭은 지정하는 순간 부풀려진다", async () => {
    const ed = await withOneItem();
    ed.setCrop({ x: 2, y: 3, w: 10, h: 5 });
    expect(cropOf(ed)).toEqual({ x: 2, y: 3, w: 10, h: MIN_CROP });
  });

  it("반전은 잡아 둔 후보도 같이 뒤집는다 — 화면의 점선이 그 자리에 남는다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 2, y: 3, w: 10, h: 5 });
    ed.flip("x");
    expect(ed.cropDraft).toEqual({ x: W - 2 - 10, y: 3, w: 10, h: 5 });
  });

  it("회전한 뒤의 반전은 돌아간 크기를 기준으로 삼는다", async () => {
    const ed = await withOneItem();
    ed.rotate(1); // 40×20 → 20×40
    ed.setCrop({ x: 2, y: 3, w: 10, h: 8 });
    ed.flip("x");
    expect(cropOf(ed)).toEqual({ x: 20 - 2 - 10, y: 3, w: 10, h: 8 });
  });

  it("모든 장에 적용이면 크롭이 장마다 제 크기 안으로 밀려 들어간다", async () => {
    const ed = new EditorState();
    await seed(ed, [{ width: W, height: H }, { width: 16, height: 12 }]);
    ed.setApplyToAll(true);
    ed.setCrop({ x: 0, y: 0, w: W, h: H });
    expect(cropOf(ed, 0)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(cropOf(ed, 1)).toEqual({ x: 0, y: 0, w: 16, h: 12 });
  });

  it("모든 장에 적용이 꺼져 있으면 지금 고른 장만 바뀐다", async () => {
    const ed = new EditorState();
    await seed(ed, [{ width: W, height: H }, { width: 16, height: 12 }]);
    ed.select(1);
    ed.rotate(1);
    expect(ed.items.map((i) => i.transform.rotation)).toEqual([0, 90]);
  });

  it("편집 되돌리기는 회전·반전·크롭을 한 번에 초기화한다", async () => {
    const ed = await withOneItem();
    ed.rotate(1);
    ed.flip("x");
    ed.setCrop({ x: 2, y: 3, w: 10, h: 5 });
    ed.resetEdit();
    expect(ed.items[0].transform).toEqual({
      rotation: 0,
      flipX: false,
      flipY: false,
      crop: null,
    });
  });

  it("장이 없으면 편집 메서드가 되돌리기 지점도 안 남긴다", () => {
    const ed = new EditorState();
    ed.rotate(1);
    ed.flip("x");
    ed.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    ed.resetEdit();
    expect(ed.canUndo).toBe(false);
    expect(ed.revision).toBe(0);
  });
});

describe("크롭 비율 프리셋", () => {
  it("비율을 고르면 잡아 둔 후보가 그 비율로 줄어든다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 0, y: 0, w: W, h: H });
    ed.setCropRatio("1:1");
    expect(ed.cropDraft).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });

  it("세로 전환은 비율을 뒤집는다", async () => {
    const ed = await withOneItem();
    ed.setCropRatio("16:9");
    expect(ed.cropRatio).toBeCloseTo(16 / 9, 6);
    ed.toggleCropPortrait();
    expect(ed.cropRatio).toBeCloseTo(9 / 16, 6);
  });

  it("'원본 비율'은 회전한 뒤의 비율이다", async () => {
    const ed = await withOneItem();
    ed.setCropRatio(CROP_RATIO_ORIGINAL);
    expect(ed.cropRatio).toBeCloseTo(W / H, 6);
    ed.rotate(1);
    expect(ed.cropRatio).toBeCloseTo(H / W, 6);
  });

  it("자유 비율이면 걸린 비율이 없다", async () => {
    const ed = await withOneItem();
    ed.setCropRatio("1:1");
    ed.setCropRatio(null);
    expect(ed.cropRatio).toBe(null);
  });

  it("모르는 프리셋 id는 비율을 안 건다", async () => {
    const ed = await withOneItem();
    ed.setCropRatio("7:3");
    expect(ed.cropRatio).toBe(null);
  });

  it("장이 없으면 '원본 비율'도 잴 것이 없다", () => {
    const ed = new EditorState();
    ed.setCropRatio(CROP_RATIO_ORIGINAL);
    expect(ed.cropRatio).toBe(null);
  });

  it("잡아 둔 후보가 없으면 비율만 바뀌고 그릴 것은 안 생긴다", async () => {
    const ed = await withOneItem();
    ed.setCropRatio("1:1");
    expect(ed.cropDraft).toBe(null);
  });
});

describe("목표 용량은 장이 아니라 설정에 딸린 값이다", () => {
  it("꺼져 있으면 파이프라인에 목표가 안 간다", async () => {
    const ed = await withOneItem();
    expect(ed.targetOn).toBe(false);
    expect(ed.targetBytes).toBe(null);
    expect(ed.settings.targetBytes).toBe(null);
  });

  it("켜면 값과 단위를 곱해 바이트로 간다", async () => {
    const ed = await withOneItem();
    ed.setTarget(500, "KB");
    expect(ed.targetOn).toBe(true);
    expect(ed.settings.targetBytes).toBe(500 * 1024);
    ed.setTarget(2, "MB");
    expect(ed.settings.targetBytes).toBe(2 * 1024 * 1024);
  });

  it("끄면 값은 남는다 — 다시 켜면 그대로 되살아난다", async () => {
    const ed = await withOneItem();
    ed.setTarget(300, "KB");
    ed.setTargetOn(false);
    expect(ed.targetBytes).toBe(null);
    expect(ed.targetValue).toBe(300);
    ed.setTargetOn(true);
    expect(ed.targetBytes).toBe(300 * 1024);
  });

  it("장을 모두 비우고 새로 붙여도 목표는 그대로다", async () => {
    const ed = await withOneItem();
    ed.setTarget(2, "MB");
    ed.clearAll();
    await ed.addFiles([pngFile({ width: 16, height: 12 }, "next.png")]);
    expect(ed.targetOn).toBe(true);
    expect(ed.settings.targetBytes).toBe(2 * 1024 * 1024);
  });

  it("단위마다 상한이 다르다 — KB는 999999, MB는 4096에서 잘린다", async () => {
    const ed = await withOneItem();
    ed.setTarget(9_999_999, "KB");
    expect(ed.targetValue).toBe(999999);
    ed.setTarget(9999, "MB");
    expect(ed.targetValue).toBe(4096);
  });

  it("단위를 바꾸면 값은 그대로 두고 새 상한으로만 누른다", async () => {
    const ed = await withOneItem();
    ed.setTarget(999999, "KB");
    ed.setTargetUnit("MB");
    expect(ed.targetValue).toBe(4096);
    ed.setTarget(500, "KB");
    ed.setTargetUnit("MB");
    // 500KB가 500MB가 된다 — 숫자를 환산하지 않는다.
    expect(ed.targetValue).toBe(500);
    expect(ed.targetUnit).toBe("MB");
  });

  it("0이나 음수는 1로 붙잡히고, 수가 아니면 값을 안 바꾼다", async () => {
    const ed = await withOneItem();
    ed.setTargetValue(0);
    expect(ed.targetValue).toBe(1);
    ed.setTargetValue(-10);
    expect(ed.targetValue).toBe(1);
    ed.setTargetValue(7);
    ed.setTargetValue(Number.NaN);
    expect(ed.targetValue).toBe(7);
  });

  it("목표를 켜도 품질과 색 수를 잠그지 않는다 — 고른 값이 탐색의 상한이다", async () => {
    const ed = await withOneItem();
    ed.setTarget(1, "MB");
    ed.setQuality(60);
    ed.setPngColors(64);
    expect(ed.settings.quality).toBe(60);
    expect(ed.settings.pngColors).toBe(64);
    // 탐색이 그 상한을 지키는지는 tests/image-target.test.ts가 잰다.
  });
});

describe("PNG 색 수 설정이 곧 사다리의 맨 윗칸이다", () => {
  /** 상태가 고른 설정으로 세운 사다리의 모든 칸(위에서 아래로). */
  function ladderOf(ed: EditorState) {
    const cap = ed.settings.pngColors;
    const top = pngSteps(cap) - 1;
    return Array.from({ length: top + 1 }, (_, i) => pngStepAt(top - i, cap));
  }

  it("색 수를 고르면 맨 윗칸이 그 설정이고 그보다 색이 많은 칸은 없다", async () => {
    const ed = await withOneItem();
    ed.setPngColors(4);
    const ladder = ladderOf(ed);
    expect(ladder[0]).toEqual({ colors: 4, scale: 100 });
    expect(ladder.every((step) => (step.colors ?? 0) <= 4)).toBe(true);
  });

  it("색 수를 안 고르면 맨 윗칸은 색을 줄이지 않는 칸이다", async () => {
    const ed = await withOneItem();
    expect(ed.settings.pngColors).toBe(null);
    expect(ladderOf(ed)[0]).toEqual({ colors: null, scale: 100 });
  });

  it("색 수는 2..256으로 붙잡힌다", async () => {
    const ed = await withOneItem();
    ed.setPngColors(1);
    expect(ed.pngColors).toBe(MIN_COLORS);
    ed.setPngColors(9999);
    expect(ed.pngColors).toBe(MAX_COLORS);
    ed.setPngColors(null);
    expect(ed.pngColors).toBe(null);
  });

  it("수가 아니면 고른 색 수를 안 건드린다", async () => {
    const ed = await withOneItem();
    ed.setPngColors(16);
    ed.setPngColors(Number.NaN);
    expect(ed.pngColors).toBe(16);
  });

  it("디더링은 기본이 꺼짐이다 — 켜면 오히려 파일이 커진다", async () => {
    const ed = await withOneItem();
    expect(ed.settings.pngDither).toBe(false);
    ed.setPngDither(true);
    expect(ed.settings.pngDither).toBe(true);
  });
});

describe("출력 설정 한 덩어리", () => {
  it("품질은 1..100으로 붙잡히고 반올림된다", async () => {
    const ed = await withOneItem();
    ed.setQuality(0);
    expect(ed.quality).toBe(1);
    ed.setQuality(1000);
    expect(ed.quality).toBe(100);
    ed.setQuality(79.6);
    expect(ed.quality).toBe(80);
  });

  it("설정은 한 덩어리로 파이프라인에 간다", async () => {
    const ed = await withOneItem();
    ed.setFormat("webp");
    ed.setQuality(72);
    ed.setKeepExif(true);
    ed.setResizeMode("longest", null);
    ed.setResizeLongest(900);
    ed.setPadColor(null);
    expect(ed.settings).toEqual({
      format: "webp",
      quality: 72,
      keepExif: true,
      pngColors: null,
      pngDither: false,
      targetBytes: null,
      resize: {
        mode: "longest",
        scale: 50,
        width: 1280,
        height: 1080,
        longest: 900,
        fit: "contain",
        padColor: null,
        noEnlarge: true,
      },
    });
  });

  it("모드를 바꾸면 아직 손대지 않은 칸만 현재 장 크기로 채운다", async () => {
    const ed = await withOneItem();
    ed.setResizeMode("width", { w: 800, h: 600 });
    expect(ed.resizeWidth).toBe(800);
    ed.setResizeWidth(640);
    ed.setResizeMode("none", { w: 800, h: 600 });
    ed.setResizeMode("width", { w: 800, h: 600 });
    expect(ed.resizeWidth).toBe(640);
  });

  it("정확한 크기 모드는 두 칸을 다 채운다", async () => {
    const ed = await withOneItem();
    ed.setResizeMode("exact", { w: 800, h: 600 });
    expect([ed.resizeWidth, ed.resizeHeight]).toEqual([800, 600]);
  });

  it("긴 변 모드는 두 변 중 큰 쪽을 기본값으로 잡는다", async () => {
    const ed = await withOneItem();
    ed.setResizeMode("longest", { w: 800, h: 600 });
    expect(ed.resizeLongest).toBe(800);
  });

  it("기본값과 같은 값을 직접 넣어 두면 모드를 옮길 때 덮인다 — 손댔는지를 값으로만 잰다", async () => {
    const ed = await withOneItem();
    ed.setResizeWidth(WIDTH_DEFAULT);
    ed.setResizeMode("width", { w: 800, h: 600 });
    expect(ed.resizeWidth).toBe(800);
  });

  it("치수는 1..20000으로 붙잡힌다", async () => {
    const ed = await withOneItem();
    ed.setResizeWidth(0);
    expect(ed.resizeWidth).toBe(1);
    ed.setResizeHeight(99_999);
    expect(ed.resizeHeight).toBe(20000);
    ed.setResizeLongest(-5);
    expect(ed.resizeLongest).toBe(1);
  });

  it("수가 아닌 치수는 넣지 않는다", async () => {
    const ed = await withOneItem();
    ed.setResizeWidth(700);
    ed.setResizeWidth(Number.NaN);
    expect(ed.resizeWidth).toBe(700);
  });

  it("배율은 1..400으로 붙잡힌다", async () => {
    const ed = await withOneItem();
    ed.setResizeScale(0);
    expect(ed.resizeScale).toBe(1);
    ed.setResizeScale(1000);
    expect(ed.resizeScale).toBe(400);
  });

  it("체인을 켜면 세로가 지금 가로와 비율에 맞춰 따라온다", async () => {
    const ed = await withOneItem();
    ed.setResizeWidth(1000);
    ed.setLockRatio(true, 2);
    expect(ed.resizeHeight).toBe(500);
    ed.setResizeWidth(800, 2);
    expect(ed.resizeHeight).toBe(400);
  });

  it("체인이 꺼져 있으면 가로를 고쳐도 세로는 그대로다", async () => {
    const ed = await withOneItem();
    ed.setResizeHeight(1080);
    ed.setResizeWidth(800, 2);
    expect(ed.resizeHeight).toBe(1080);
  });

  it("체인은 세로 쪽에서도 같은 비율로 돈다", async () => {
    const ed = await withOneItem();
    ed.setLockRatio(true, 2);
    ed.setResizeHeight(300, 2);
    expect(ed.resizeWidth).toBe(600);
  });
});

describe("장 목록 조작", () => {
  it("다른 장을 지우면 보던 장을 계속 본다", async () => {
    const ed = new EditorState();
    const items = await seed(ed, [
      { width: W, height: H },
      { width: 16, height: 12 },
      { width: 24, height: 24 },
    ]);
    ed.select(1);
    ed.removeOne(items[0].id);
    expect(ed.currentItem?.id).toBe(items[1].id);
    expect(ed.current).toBe(0);
  });

  it("없는 id를 지우라고 하면 목록이 그대로다", async () => {
    const ed = new EditorState();
    const items = await seed(ed, [{ width: W, height: H }]);
    ed.removeOne("없는 id");
    expect(ed.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("모두 비우기는 목록과 오류를 함께 지운다", async () => {
    const ed = await withOneItem();
    ed.error = "먼저 있던 오류";
    ed.clearAll();
    expect(ed.items).toEqual([]);
    expect(ed.error).toBe("");
    expect(ed.currentItem).toBe(null);
  });

  it("빈 목록에서 모두 비우기는 되돌리기 지점을 안 남긴다", () => {
    const ed = new EditorState();
    ed.clearAll();
    expect(ed.canUndo).toBe(false);
  });

  it("고른 자리가 목록 끝을 넘어도 마지막 장을 본다", async () => {
    const ed = new EditorState();
    const items = await seed(ed, [{ width: W, height: H }, { width: 16, height: 12 }]);
    ed.select(5);
    expect(ed.currentItem?.id).toBe(items[1].id);
  });
});

describe("상태가 고른 설정이 산출물까지 간다", () => {
  // `pipeline.ts`가 위 두 전역만 갈아 끼우면 node에서도 도는 데까지만 잰다 —
  // JPEG·WebP 인코딩, 회전·반전·크롭, 품질 축의 목표 용량 탐색.
  // 리사이즈는 pica가 `.from`을 Image·Canvas·ImageBitmap으로만 받아 못 돌고
  // ("Pica: '.from' should be Image, Canvas or ImageBitmap"), PNG 색 줄이기는
  // `ImageData`가 없어서 못 돈다. 그 둘은 브라우저가 있는 층의 몫이다.
  //
  // 인코더가 크로미엄이 아니라 @napi-rs/canvas라 바이트 수는 다르다. 그래서 크기를
  // 값으로 단언하지 않고 성질로만 적는다 — 목표 이하인가, 고른 품질을 넘겼는가.

  /** 200×120 잔 무늬 — 품질을 내리면 용량이 뚜렷하게 준다. */
  async function bigItem(): Promise<{ ed: EditorState; item: ImageItem }> {
    const ed = new EditorState();
    const [item] = await seed(ed, [{ width: 200, height: 120 }]);
    return { ed, item };
  }

  it("회전한 각도가 결과 치수에 반영된다", async () => {
    const ed = await withOneItem();
    ed.rotate(1);
    const res = await processItem(ed.items[0], ed.settings);
    expect([res.width, res.height]).toEqual([H, W]);
    expect(res.blob.type).toBe("image/jpeg");
  });

  it("확정한 크롭이 결과 치수가 된다", async () => {
    const ed = await withOneItem();
    ed.startCrop();
    ed.setCropDraft({ x: 4, y: 2, w: 20, h: 12 });
    ed.applyCropDraft();
    const res = await processItem(ed.items[0], ed.settings);
    expect([res.width, res.height]).toEqual([20, 12]);
  });

  it("고른 형식이 결과의 형식이다", async () => {
    const ed = await withOneItem();
    ed.setFormat("webp");
    const res = await processItem(ed.items[0], ed.settings);
    expect(res.blob.type).toBe("image/webp");
  });

  it("목표를 안 켜면 탐색 없이 한 번만 인코딩한다", async () => {
    const { ed, item } = await bigItem();
    const res = await processItem(item, ed.settings);
    expect(res.search).toBeUndefined();
  });

  it("목표를 켜면 결과가 목표 이하이고 맞췄다고 말한다", async () => {
    const { ed, item } = await bigItem();
    ed.setTarget(3, "KB");
    const res = await processItem(item, ed.settings);
    expect(res.blob.size).toBeLessThanOrEqual(3 * 1024);
    expect(res.search?.met).toBe(true);
  });

  it("목표가 헐거우면 고른 품질 그대로 나온다 — 더 좋게 만들지 않는다", async () => {
    const { ed, item } = await bigItem();
    ed.setQuality(40);
    ed.setTarget(1, "MB");
    const res = await processItem(item, ed.settings);
    expect(res.search?.met).toBe(true);
    expect(res.search?.quality).toBe(40);
  });

  it("어떻게 줄여도 못 맞추면 못 맞췄다고 말한다 — 조용히 큰 것을 주지 않는다", async () => {
    const { ed, item } = await bigItem();
    ed.setTarget(300, "KB");
    ed.setTargetValue(1); // 1KB — 어떤 품질로도 못 내려간다
    const res = await processItem(item, ed.settings);
    expect(res.search?.met).toBe(false);
    expect(res.blob.size).toBeGreaterThan(1024);
  });
});
