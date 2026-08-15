/** GIF 편집기 상태 기계 — 내보내기 스냅샷·되돌리기·리비전.
 *
 * `tests/gif-overlay.test.ts`·`tests/gif-redact.test.ts`가 `snapshotPlan`의 규격을
 * 못 박는다면, 이 파일은 **살아 있는 편집기 상태가 그 규격을 지나는가**를 잰다.
 * 두 자리가 갈리는 이유는 소스 표에 있다 — 계획은 프레임·자막을 베껴 뜨지만
 * 소스 표는 편집기가 계속 정리하는(`#pruneSources`) 살아 있는 Map이고,
 * 계획이 자기 것을 따로 들고 가지 않으면 인코딩 도중 소스가 사라진다.
 *
 * ## 부르는 방법
 *
 * `state.svelte.ts`는 룬 모듈이라 svelte 플러그인을 거쳐야 값이 된다(`vitest.config.ts`).
 * 테스트 파일 자체에서는 룬을 못 쓴다 — 메서드를 부르고 파생값(`base`·`output`·
 * `selectedCount`·`repeat`)을 읽는 모양이다.
 *
 * 싱글턴 `editor` 대신 **`new EditorState()`를 테스트마다 새로 만든다.** 되돌리기 스택이
 * private이라 밖에서 비울 방법이 없어서다(시트와 달리 `newBook()`에 해당하는 것이 없다).
 * 같은 클래스라 재는 대상은 같다.
 *
 * 프레임은 손으로 심는다. `addFiles`는 `ImageDecoder`·`createImageBitmap`을 타는데
 * 둘 다 node에 없다 — 임포트 경로는 브라우저가 있는 층의 몫이고, 여기서 재는 것은
 * 프레임이 들어온 **다음**이다. 소스 바이트만은 실물 GIF를 넣는다(`makeGifFrames`).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { EditorState } from "../apps/gif/src/lib/editor/state.svelte";
import { snapshotPlan } from "../apps/gif/src/lib/gif/plan";
import type { Frame, FrameSource } from "../apps/gif/src/lib/gif/types";
import { makeGifFrames } from "./fixtures/gif";

/** 되돌리기 깊이. state.svelte.ts의 HISTORY_MAX와 같은 값이고 그쪽은 export되지 않는다. */
const HISTORY_MAX = 30;

const BASE_W = 64;
const BASE_H = 48;

/** 소스 바이트는 한 번만 짓는다 — 테스트마다 다시 지으면 GIF 인코딩이 60번 돈다. */
const SOURCE_BYTES = makeGifFrames(8, 100, { spec: { width: BASE_W, height: BASE_H } });

let ed: EditorState;

function source(id: string): FrameSource {
  return {
    id,
    kind: "animated",
    name: `${id}.gif`,
    mime: "image/gif",
    bytes: new Uint8Array(SOURCE_BYTES),
    width: BASE_W,
    height: BASE_H,
    frameCount: 8,
  };
}

/** 프레임 `count`장을 소스 하나에서 심는다. id는 `<sourceId>1`부터. */
function seed(count: number, sourceId = "s1", delayMs = 100): Frame[] {
  ed.sources.set(sourceId, source(sourceId));
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({
      id: `${sourceId}f${i + 1}`,
      sourceId,
      frameIndex: i,
      delayMs,
      selected: false,
      thumb: "",
    });
  }
  ed.frames = [...ed.frames, ...frames];
  return frames;
}

/** 지금 프레임의 id 순서. */
function ids(): string[] {
  return ed.frames.map((f) => f.id);
}

/** 지금 골라 둔 프레임의 id 순서. */
function selected(): string[] {
  return ed.frames.filter((f) => f.selected).map((f) => f.id);
}

/** 되돌리기 지점을 남기는 편집을 n번 한다 — 스택을 밀어내는 데 쓴다. */
function churn(n: number): void {
  for (let i = 0; i < n; i++) ed.rotate90();
}

/** 지금 상태로 인코딩 계획을 굳힌다. Panel.svelte의 `plan()`과 같은 인자다. */
function plan() {
  return snapshotPlan({
    frames: ed.frames,
    sources: ed.sources,
    transform: ed.transform,
    overlays: ed.overlays,
    baseW: ed.base.w,
    baseH: ed.base.h,
  });
}

beforeEach(() => {
  ed = new EditorState();
});

describe("계획을 굳힌 뒤의 편집은 그 인코딩에 안 들어간다", () => {
  it("프레임을 지워도 계획의 프레임 수와 순서가 그대로다", () => {
    seed(4);
    const frozen = plan();
    ed.selectNumbers(2, 3);
    ed.deleteSelected();
    expect(ids()).toEqual(["s1f1", "s1f4"]);
    expect(frozen.frames.map((f) => f.frameIndex)).toEqual([0, 1, 2, 3]);
  });

  it("딜레이를 고쳐도 계획의 딜레이가 그대로다", () => {
    seed(3, "s1", 80);
    const frozen = plan();
    ed.setDelay(500, false);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([500, 500, 500]);
    expect(frozen.frames.map((f) => f.delayMs)).toEqual([80, 80, 80]);
  });

  it("선택을 바꿔도 계획의 선택이 그대로다 — '선택한 프레임만' 자막이 여기에 걸린다", () => {
    seed(3);
    ed.toggleSelect("s1f1");
    const frozen = plan();
    ed.selectNone();
    ed.toggleSelect("s1f3");
    expect(frozen.frames.map((f) => f.selected)).toEqual([true, false, false]);
  });

  it("자막을 고치거나 지워도 계획의 자막이 그대로다", () => {
    seed(2);
    ed.addOverlay();
    const id = ed.activeOverlayId ?? "";
    ed.updateOverlay(id, { text: "처음" });
    const frozen = plan();
    ed.updateOverlay(id, { text: "고친 뒤" });
    ed.removeOverlay(id);
    expect(ed.overlays).toHaveLength(0);
    expect(frozen.overlays.map((o) => o.text)).toEqual(["처음"]);
  });

  it("가릴 영역을 지워도 계획은 계속 가린다", () => {
    seed(2);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    const frozen = plan();
    ed.removeRegion(ed.activeRegionId ?? "");
    expect(ed.regions).toHaveLength(0);
    expect(frozen.transform.redact).toHaveLength(1);
    expect(frozen.transform.redact[0].w).toBe(20);
  });

  it("배율·회전을 바꿔도 계획의 변형이 그대로다", () => {
    seed(2);
    const frozen = plan();
    ed.setScale(0.5);
    ed.rotate90();
    expect(ed.output).toEqual({ w: 24, h: 32 });
    expect(frozen.transform.scale).toBe(1);
    expect(frozen.transform.rotation).toBe(0);
  });

  it("소스가 히스토리에서 밀려나 정리돼도 계획은 자기 소스를 들고 있다", () => {
    // plan.ts가 소스 표를 베껴 뜨는 이유가 여기 있다 — 바이트가 바뀌는 게 아니라
    // 인코딩 도중 표에서 항목이 빠진다(#pruneSources).
    seed(2);
    const frozen = plan();
    ed.clearAll();
    churn(HISTORY_MAX); // 모두 비우기 지점이 스택 밖으로 밀려난다
    expect(ed.sources.size).toBe(0);
    expect(frozen.sources.get("s1")?.bytes.length).toBe(SOURCE_BYTES.length);
  });

  it("되돌리기로 프레임이 돌아와도 계획은 안 바뀐다", () => {
    seed(3);
    ed.selectNumbers(1, 1);
    ed.deleteSelected();
    const frozen = plan();
    ed.undo();
    expect(ed.frames).toHaveLength(3);
    expect(frozen.frames).toHaveLength(2);
  });
});

describe("되돌리기 스택에 드는 것과 안 드는 것", () => {
  it("프레임 순서·딜레이·선택과 보던 자리가 함께 돌아온다", () => {
    seed(3);
    ed.toggleSelect("s1f2");
    ed.current = 2;
    ed.setFrameDelay("s1f1", 40);
    ed.move(0, 2);
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f1"]);

    ed.undo();
    expect(ids()).toEqual(["s1f1", "s1f2", "s1f3"]);
    ed.undo();
    expect(ed.frames[0].delayMs).toBe(100);
    expect(ed.frames[1].selected).toBe(true);
    expect(ed.current).toBe(2);
  });

  it("크롭·회전·배율과 가릴 영역이 함께 돌아온다", () => {
    seed(2);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    ed.setCrop({ x: 2, y: 2, w: 40, h: 30 });
    ed.rotate90();
    ed.setScale(2);
    expect(ed.output).toEqual({ w: 60, h: 80 });

    ed.undo();
    ed.undo();
    ed.undo();
    expect(ed.transform.crop).toBeNull();
    expect(ed.transform.rotation).toBe(0);
    expect(ed.transform.scale).toBe(1);
    // 영역은 세 번째 되돌리기까지 살아 있다 — 그 지점 이전에 만들었다.
    expect(ed.regions).toHaveLength(1);
    ed.undo();
    expect(ed.regions).toHaveLength(0);
  });

  it("편집 중이던 자막·영역도 같이 돌아온다 — 안 그러면 되돌린 뒤 편집칸이 사라진다", () => {
    seed(2);
    ed.addOverlay();
    const first = ed.activeOverlayId;
    ed.addOverlay();
    expect(ed.activeOverlayId).not.toBe(first);

    ed.undo();
    expect(ed.overlays.map((o) => o.id)).toEqual([first]);
    expect(ed.activeOverlayId).toBe(first);
  });

  it("형식·색 수·디더·배속·반복은 스냅샷에 안 든다 — 패널에 그대로 보이는 값이다", () => {
    seed(2);
    ed.rotate90();
    ed.setExportFormat("webp");
    ed.setGifColors(64);
    ed.setGifDither(true);
    ed.setSpeed(2);
    ed.setLoopForever(false);
    ed.setLoopCount(5);

    ed.undo();
    expect(ed.transform.rotation).toBe(0);
    expect(ed.exportFormat).toBe("webp");
    expect(ed.gifColors).toBe(64);
    expect(ed.gifDither).toBe(true);
    expect(ed.speed).toBe(2);
    expect(ed.loopCount).toBe(5);
  });

  it("자막 칸 하나를 고치는 것은 지점을 안 남긴다 — 글자마다 쌓이면 스택이 키 입력 수가 된다", () => {
    seed(2);
    ed.addOverlay();
    const id = ed.activeOverlayId ?? "";
    ed.updateOverlay(id, { text: "가" });
    ed.updateOverlay(id, { text: "가나" });
    ed.updateOverlay(id, { text: "가나다" });

    ed.undo(); // 자막 추가 하나만 되돌아간다
    expect(ed.overlays).toHaveLength(0);
    expect(ed.canUndo).toBe(false);
  });

  it("영역 칸 편집과 편집 대상 고르기도 지점을 안 남긴다", () => {
    seed(2);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    const id = ed.activeRegionId ?? "";
    ed.updateRegion(id, { strength: 24 });
    ed.setActiveRegion(null);
    ed.setActiveOverlay(null);

    ed.undo();
    expect(ed.regions).toHaveLength(0);
    expect(ed.canUndo).toBe(false);
  });

  it("아무것도 안 지우는 삭제는 지점을 안 남긴다", () => {
    seed(3);
    ed.deleteSelected(); // 선택이 없다
    ed.keepSelected(); // 선택이 없다
    ed.selectAll();
    ed.keepSelected(); // 세 장 다 선택 — 지울 것이 없다
    expect(ed.frames).toHaveLength(3);
    expect(ed.canUndo).toBe(false);
  });

  // 딜레이도 같은 규약을 지킨다 — 바뀌는 프레임이 없으면 지점도 리비전도 안 남는다.
  // 예전에는 선택이 비어도 지점과 리비전을 남겨서 되돌리기가 한 번 헛돌았다.
  it("선택이 비었는데 '선택한 장만' 딜레이를 걸면 지점도 리비전도 안 남는다", () => {
    seed(3);
    const revision = ed.revision;
    ed.setDelay(500, true);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([100, 100, 100]);
    expect(ed.canUndo).toBe(false);
    expect(ed.revision).toBe(revision);
  });

  it("이미 그 값이면 딜레이를 다시 걸어도 지점을 안 남긴다", () => {
    seed(2, "s1", 120);
    const revision = ed.revision;
    ed.setDelay(120, false);
    expect(ed.canUndo).toBe(false);
    expect(ed.revision).toBe(revision);
  });

  it("가둔 결과가 지금 값과 같아도 안 남긴다 — 하한 20ms에 붙은 장에 더 작은 값을 넣을 때다", () => {
    seed(2, "s1", 20);
    ed.setDelay(5, false);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([20, 20]);
    expect(ed.canUndo).toBe(false);
  });

  it("고른 장 하나만 바뀌어도 지점을 남긴다", () => {
    seed(3, "s1", 120);
    ed.toggleSelect("s1f2");
    ed.setDelay(300, true);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([120, 300, 120]);
    ed.undo();
    expect(ed.frames.map((f) => f.delayMs)).toEqual([120, 120, 120]);
  });

  // 덮어쓰기 말고 나머지 두 방식도 같은 규약을 탄다 — 항등원이 서로 다르다.
  it("보태기 0ms와 비율 100%도 지점을 안 남긴다", () => {
    seed(3, "s1", 100);
    ed.setDelay(0, false, "add");
    ed.setDelay(100, false, "scale");
    expect(ed.frames.map((f) => f.delayMs)).toEqual([100, 100, 100]);
    expect(ed.canUndo).toBe(false);
  });

  it("가둬서 값이 바뀌면 지점을 남긴다 — 비율 0%는 하한 20ms로 내려앉는다", () => {
    seed(2, "s1", 100);
    ed.setDelay(0, false, "scale");
    expect(ed.frames.map((f) => f.delayMs)).toEqual([20, 20]);
    expect(ed.canUndo).toBe(true);
  });

  it("한 장만 하한에 붙어 있고 나머지가 움직이면 지점을 남긴다", () => {
    seed(2, "s1", 20);
    ed.frames[1].delayMs = 100;
    ed.setDelay(-50, false, "add");
    expect(ed.frames.map((f) => f.delayMs)).toEqual([20, 50]);
    expect(ed.canUndo).toBe(true);
  });

  it("딜레이에 NaN·무한대를 넣으면 값도 지점도 안 움직인다", () => {
    seed(2);
    ed.setDelay(Number.NaN, false);
    ed.setDelay(Number.POSITIVE_INFINITY, false);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([100, 100]);
    expect(ed.canUndo).toBe(false);
  });

  it("되돌리면 크롭 모드와 가리기 모드가 꺼진다", () => {
    seed(2);
    ed.rotate90();
    ed.toggleRedactMode();
    expect(ed.redactMode).toBe(true);
    ed.undo();
    expect(ed.redactMode).toBe(false);
    expect(ed.cropMode).toBe(false);
  });

  it("되돌린 뒤 새로 편집하면 다시 실행이 사라진다", () => {
    seed(2);
    ed.rotate90();
    ed.undo();
    expect(ed.canRedo).toBe(true);
    ed.toggleFlipH();
    expect(ed.canRedo).toBe(false);
  });

  it("다시 실행은 되돌린 편집을 그대로 얹는다", () => {
    seed(2);
    ed.setFrameDelay("s1f1", 250);
    ed.undo();
    expect(ed.frames[0].delayMs).toBe(100);
    ed.redo();
    expect(ed.frames[0].delayMs).toBe(250);
    expect(ed.canRedo).toBe(false);
  });

  it(`스택은 ${HISTORY_MAX}개까지다 — 넘치면 가장 오래된 지점부터 버린다`, () => {
    seed(1);
    for (let i = 1; i <= HISTORY_MAX + 1; i++) ed.setFrameDelay("s1f1", 100 + i * 10);
    expect(ed.frames[0].delayMs).toBe(100 + (HISTORY_MAX + 1) * 10);

    for (let i = 0; i < HISTORY_MAX; i++) ed.undo();
    expect(ed.canUndo).toBe(false);
    // 맨 처음 100ms로는 못 돌아간다 — 그 지점이 밀려났다.
    expect(ed.frames[0].delayMs).toBe(110);
  });

  it("아무것도 없을 때 되돌리기·다시 실행은 아무 일도 안 한다", () => {
    seed(2);
    const revision = ed.revision;
    ed.undo();
    ed.redo();
    expect(ed.frames).toHaveLength(2);
    expect(ed.revision).toBe(revision);
  });
});

describe("영역 끌기는 자리가 바뀌었을 때만 지점을 남긴다", () => {
  function addRegion(): string {
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    return ed.activeRegionId ?? "";
  }

  it("잡기만 하고 놓으면 스택이 안 쌓인다 — 고르려고 누른 것까지 쌓이면 되돌리기가 헛돈다", () => {
    seed(2);
    const id = addRegion();
    ed.undo(); // 영역 만들기까지 되돌려 스택을 비운다
    expect(ed.canUndo).toBe(false);
    ed.redo();

    ed.beginRegionDrag(id);
    ed.endRegionDrag();
    expect(ed.canUndo).toBe(true); // 영역 만들기 하나뿐
    ed.undo();
    expect(ed.regions).toHaveLength(0);
    expect(ed.canUndo).toBe(false);
  });

  it("한 번 끄는 동안 여러 번 움직여도 지점은 하나다", () => {
    seed(2);
    const id = addRegion();
    ed.beginRegionDrag(id);
    ed.dragRegionTo(id, { x: 10, y: 10, w: 20, h: 16 });
    ed.dragRegionTo(id, { x: 16, y: 12, w: 20, h: 16 });
    ed.endRegionDrag();
    expect(ed.regions[0].x).toBe(16);

    ed.undo();
    expect(ed.regions[0].x).toBe(4); // 끌기 전 자리
    ed.undo();
    expect(ed.regions).toHaveLength(0);
  });

  it("같은 자리로 끌면 지점도 안 남고 값도 안 바뀐다", () => {
    seed(2);
    const id = addRegion();
    const revision = ed.revision;
    ed.beginRegionDrag(id);
    ed.dragRegionTo(id, { x: 4, y: 4, w: 20, h: 16 });
    ed.endRegionDrag();
    expect(ed.revision).toBe(revision);
    ed.undo();
    expect(ed.regions).toHaveLength(0);
  });

  it("끌던 도중 되돌리기가 들어오면 떠 둔 지점을 버린다 — 되돌린 상태 위에 옛 지점을 쌓지 않는다", () => {
    seed(2);
    const id = addRegion();
    ed.rotate90();
    ed.beginRegionDrag(id);

    ed.undo(); // 회전이 되돌아간다. 상자를 잡을 때 떠 둔 지점은 회전이 걸린 상태였다.
    expect(ed.transform.rotation).toBe(0);
    ed.dragRegionTo(id, { x: 16, y: 12, w: 20, h: 16 });
    expect(ed.regions[0].x).toBe(16);

    // 옛 지점을 쌓았다면 여기서 회전이 되살아나고 영역도 남는다.
    ed.undo();
    expect(ed.regions).toHaveLength(0);
    expect(ed.transform.rotation).toBe(0);
  });

  it("되돌리기로 사라진 영역을 끌면 아무 일도 안 한다", () => {
    seed(2);
    const id = addRegion();
    ed.beginRegionDrag(id);
    ed.undo();
    expect(ed.regions).toHaveLength(0);
    ed.dragRegionTo(id, { x: 30, y: 30, w: 20, h: 16 });
    expect(ed.regions).toHaveLength(0);
    expect(ed.canUndo).toBe(false);
  });
});

describe("선택을 바꾸면 결과가 낡는가 (리비전)", () => {
  it("자막도 영역도 없으면 프레임을 골라도 리비전이 안 오른다", () => {
    seed(3);
    const revision = ed.revision;
    ed.toggleSelect("s1f1");
    ed.selectAll();
    ed.selectNone();
    ed.selectNumbers(1, 2);
    expect(ed.revision).toBe(revision);
  });

  it("'선택한 프레임만' 자막에 글자가 있으면 오른다", () => {
    seed(3);
    ed.addOverlay();
    ed.updateOverlay(ed.activeOverlayId ?? "", { text: "자막", scope: "selected" });
    const revision = ed.revision;
    ed.toggleSelect("s1f1");
    expect(ed.revision).toBe(revision + 1);
  });

  it("글자가 빈 자막은 안 올린다 — 그릴 것이 없으면 그림이 안 바뀐다", () => {
    seed(3);
    ed.addOverlay();
    ed.updateOverlay(ed.activeOverlayId ?? "", { text: "   ", scope: "selected" });
    const revision = ed.revision;
    ed.toggleSelect("s1f1");
    expect(ed.revision).toBe(revision);
  });

  it("범위가 '전체'인 자막은 선택과 무관하다", () => {
    seed(3);
    ed.addOverlay();
    ed.updateOverlay(ed.activeOverlayId ?? "", { text: "자막", scope: "all" });
    const revision = ed.revision;
    ed.selectAll();
    expect(ed.revision).toBe(revision);
  });

  it("'선택한 프레임만' 가릴 영역은 글자가 없어도 언제나 올린다", () => {
    seed(3);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    ed.updateRegion(ed.activeRegionId ?? "", { scope: "selected" });
    const revision = ed.revision;
    ed.selectAll();
    expect(ed.revision).toBe(revision + 1);
    ed.selectNone();
    expect(ed.revision).toBe(revision + 2);
  });

  it("재생과 프레임 이동은 리비전을 안 올린다", () => {
    seed(3);
    const revision = ed.revision;
    ed.togglePlay();
    ed.step(1);
    ed.step(-2);
    expect(ed.current).toBe(2);
    expect(ed.playing).toBe(false);
    expect(ed.revision).toBe(revision);
  });

  it("형식·색 수·배속·반복은 언제나 올린다 — 결과 파일이 달라진다", () => {
    seed(2);
    const revision = ed.revision;
    ed.setExportFormat("webp");
    ed.setGifColors(64);
    ed.setGifDiff(false);
    ed.setSpeed(2);
    ed.setLoopForever(false);
    expect(ed.revision).toBe(revision + 5);
  });
});

describe("프레임 지우기·구간 남기기·순서 뒤집기", () => {
  it("고른 것만 지우고 보던 프레임은 id로 따라간다", () => {
    seed(5);
    ed.current = 3; // s1f4
    ed.selectNumbers(1, 2);
    ed.deleteSelected();
    expect(ids()).toEqual(["s1f3", "s1f4", "s1f5"]);
    expect(ed.current).toBe(1);
  });

  it("보던 프레임이 지워지면 남은 목록 끝을 넘지 않는다", () => {
    seed(4);
    ed.current = 3;
    ed.selectNumbers(3, 4);
    ed.deleteSelected();
    expect(ed.frames).toHaveLength(2);
    expect(ed.current).toBe(1);
  });

  it("다 지우면 보던 자리가 0으로 내려온다", () => {
    seed(3);
    ed.current = 2;
    ed.selectAll();
    ed.deleteSelected();
    expect(ed.frames).toHaveLength(0);
    expect(ed.current).toBe(0);
  });

  it("구간만 남기기는 1-based 번호를 프레임 수 안으로 가둔다", () => {
    seed(5);
    ed.keepNumbers(0, 100);
    expect(ids()).toHaveLength(5);
    ed.keepNumbers(2, 4);
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f4"]);
  });

  it("거꾸로 적은 구간도 같은 구간으로 읽는다", () => {
    seed(5);
    ed.keepNumbers(4, 2);
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f4"]);
  });

  it("선택한 것만 남기기는 선택이 없으면 아무 일도 안 한다", () => {
    seed(3);
    ed.keepSelected();
    expect(ed.frames).toHaveLength(3);
  });

  it("남긴 장은 선택된 채로 남는다 — 필름스트립의 체크가 그대로 보인다", () => {
    seed(5);
    ed.selectNumbers(2, 4);
    ed.keepSelected();
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f4"]);
    expect(ed.selectedCount).toBe(3);
  });

  it("구간만 남기기는 선택을 다시 칠하지 않는다 — 번호로 자르는 것과 고르는 것은 다른 조작이다", () => {
    seed(5);
    ed.selectNumbers(1, 2);
    ed.keepNumbers(2, 4);
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f4"]);
    expect(ed.frames.filter((f) => f.selected).map((f) => f.id)).toEqual(["s1f2"]);
  });

  it("선택이 둘 이상이면 그 자리들 안에서만 뒤집는다", () => {
    seed(5);
    ed.selectNumbers(2, 4);
    ed.reverse();
    expect(ids()).toEqual(["s1f1", "s1f4", "s1f3", "s1f2", "s1f5"]);
  });

  it("선택이 하나 이하면 전체를 뒤집는다", () => {
    seed(4);
    ed.toggleSelect("s1f2");
    ed.reverse();
    expect(ids()).toEqual(["s1f4", "s1f3", "s1f2", "s1f1"]);
  });

  it("뒤집어도 보던 프레임은 따라간다", () => {
    seed(4);
    ed.current = 0;
    ed.reverse();
    expect(ed.current).toBe(3);
  });

  it("프레임이 둘도 안 되면 뒤집기가 지점을 안 남긴다", () => {
    seed(1);
    ed.reverse();
    expect(ed.canUndo).toBe(false);
  });

  it("옮기기는 목록 끝에서 감싸지 않는다", () => {
    seed(3);
    ed.current = 0;
    ed.moveCurrent(-1);
    expect(ids()).toEqual(["s1f1", "s1f2", "s1f3"]);
    expect(ed.canUndo).toBe(false);
    ed.current = 2;
    ed.moveCurrent(1);
    expect(ids()).toEqual(["s1f1", "s1f2", "s1f3"]);
  });

  it("한 장 복제는 원본 다음 자리에 놓고 사본은 선택되지 않는다", () => {
    seed(2);
    ed.toggleSelect("s1f1");
    ed.duplicateOne("s1f1");
    expect(ed.frames).toHaveLength(3);
    expect(ed.frames[1].frameIndex).toBe(0);
    expect(ed.frames[1].selected).toBe(false);
    expect(ed.frames[1].id).not.toBe("s1f1");
  });

  it("고른 것 복제는 장마다 뒤에 한 장씩 끼운다", () => {
    seed(3);
    ed.selectNumbers(1, 2);
    ed.duplicateSelected();
    expect(ed.frames.map((f) => f.frameIndex)).toEqual([0, 0, 1, 1, 2]);
    expect(ed.selectedCount).toBe(2);
  });

  it("지우기는 자막 구간 번호를 다시 쓰지 않는다 — 사용자가 적어 둔 값이다", () => {
    seed(5);
    ed.addOverlay();
    const id = ed.activeOverlayId ?? "";
    ed.updateOverlay(id, { text: "자막", scope: "range", from: 3, to: 5 });
    ed.keepNumbers(1, 2);
    expect(ed.frames).toHaveLength(2);
    expect(ed.overlays[0].from).toBe(3);
    expect(ed.overlays[0].to).toBe(5);
  });

  it("지우기는 가릴 영역을 안 건드린다 — 좌표가 프레임이 아니라 베이스 기준이다", () => {
    seed(4);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    ed.selectNumbers(1, 3);
    ed.deleteSelected();
    expect(ed.frames).toHaveLength(1);
    expect(ed.regions).toHaveLength(1);
    expect(ed.regions[0].x).toBe(4);
  });

  it("지운 뒤 Shift 클릭은 처음부터 칠한다 — 기준점이 0으로 돌아간다", () => {
    seed(5);
    ed.toggleSelect("s1f4"); // 기준점 = 3
    ed.deleteSelected();
    expect(ids()).toEqual(["s1f1", "s1f2", "s1f3", "s1f5"]);

    // 기준점이 지운 자리에 남아 있으면 여기서 s1f3~s1f5가 칠해진다.
    ed.toggleSelect("s1f3", true);
    expect(ed.frames.filter((f) => f.selected).map((f) => f.id)).toEqual([
      "s1f1",
      "s1f2",
      "s1f3",
    ]);
  });

  it("Shift 클릭이 다음 Shift 클릭의 기준점이 된다 — 두 번째는 앞에서부터 다시 칠하지 않는다", () => {
    seed(5);
    ed.toggleSelect("s1f2"); // 기준점 = 1
    ed.toggleSelect("s1f4", true); // 1..3을 칠하고 기준점을 3으로 옮긴다
    expect(selected()).toEqual(["s1f2", "s1f3", "s1f4"]);

    ed.selectNone();
    ed.toggleSelect("s1f5", true);
    // 기준점이 0으로 남아 있으면 여기서 다섯 장이 통째로 칠해진다.
    expect(selected()).toEqual(["s1f4", "s1f5"]);
  });

  it("번호로 고르기도 기준점을 끝 번호에 둔다", () => {
    seed(5);
    ed.selectNumbers(2, 4); // 기준점 = 3
    ed.selectNone();
    ed.toggleSelect("s1f2", true);
    expect(selected()).toEqual(["s1f2", "s1f3", "s1f4"]);
  });

  // 기준점은 인덱스가 아니라 프레임 id다. 인덱스로 두면 순서를 바꾸거나 장을 끼워 넣는
  // 자리마다 되돌려 놓아야 하는데 move·duplicate가 그러지 않아 옛 자리에 남아 있었다.
  it("맨 뒤 장을 맨 앞으로 옮긴 뒤 그 장을 Shift 클릭하면 한 장만 칠해진다", () => {
    seed(5);
    ed.toggleSelect("s1f5"); // 기준점 = s1f5(자리 4)
    ed.selectNone();
    ed.move(4, 0);
    expect(ids()).toEqual(["s1f5", "s1f1", "s1f2", "s1f3", "s1f4"]);

    // 기준점이 자리 4에 남아 있으면 여기서 다섯 장이 칠해진다.
    ed.toggleSelect("s1f5", true);
    expect(selected()).toEqual(["s1f5"]);
  });

  // 위 :664가 기준점 자신이 지워진 경우를 잰다면 이쪽은 남은 경우다. 둘을 같이 세워 두면
  // `#removeWhere`에 `#anchor = 0`을 되살려 :664만 통과시키는 수를 막는다.
  it("기준점이 아닌 장을 지워도 기준점은 남은 그 장을 계속 가리킨다", () => {
    seed(5);
    ed.toggleSelect("s1f5"); // 기준점 = s1f5(자리 4)
    ed.selectNone();
    ed.deleteOne("s1f1"); // [f2, f3, f4, f5] — 기준점은 자리 3으로 밀린다
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f4", "s1f5"]);

    ed.toggleSelect("s1f4", true);
    expect(selected()).toEqual(["s1f4", "s1f5"]);
  });

  it("옮긴 뒤 Shift 클릭은 기준점이 옮겨 간 자리에서부터 칠한다", () => {
    seed(5);
    ed.toggleSelect("s1f1"); // 기준점 = s1f1(자리 0)
    ed.selectNone();
    ed.move(0, 4);
    expect(ids()).toEqual(["s1f2", "s1f3", "s1f4", "s1f5", "s1f1"]);

    ed.toggleSelect("s1f4", true); // s1f4(2) .. s1f1(4)
    expect(selected()).toEqual(["s1f4", "s1f5", "s1f1"]);
  });

  it("한 장 복제로 앞자리가 밀려도 기준점은 같은 장을 가리킨다", () => {
    seed(4);
    ed.toggleSelect("s1f3"); // 기준점 = s1f3(자리 2)
    ed.selectNone();
    ed.duplicateOne("s1f1"); // 사본이 자리 1에 끼어 s1f3이 자리 3으로 밀린다
    expect(ed.frames).toHaveLength(5);

    ed.toggleSelect("s1f4", true);
    expect(selected()).toEqual(["s1f3", "s1f4"]);
  });

  it("고른 것 복제로 자리가 밀려도 기준점은 같은 장을 가리킨다", () => {
    seed(4);
    ed.selectNumbers(1, 2); // 기준점 = s1f2(자리 1)
    ed.duplicateSelected(); // [s1f1, 사본, s1f2, 사본, s1f3, s1f4]
    ed.selectNone();

    ed.toggleSelect("s1f3", true); // s1f2(2) .. s1f3(4)
    expect(ed.frames.map((f) => f.selected)).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("뒤집어도 기준점은 같은 장을 가리킨다", () => {
    seed(4);
    ed.toggleSelect("s1f1"); // 기준점 = s1f1(자리 0)
    ed.selectNone();
    ed.reverse();
    expect(ids()).toEqual(["s1f4", "s1f3", "s1f2", "s1f1"]);

    ed.toggleSelect("s1f2", true); // s1f2(2) .. s1f1(3)
    expect(selected()).toEqual(["s1f2", "s1f1"]);
  });

  it("모두 비우고 새로 붙이면 기준점이 맨 앞에서 다시 시작한다", () => {
    seed(3);
    ed.toggleSelect("s1f3"); // 기준점 = s1f3
    ed.clearAll();
    seed(3, "s2");

    ed.toggleSelect("s2f2", true);
    expect(selected()).toEqual(["s2f1", "s2f2"]);
  });

  it("되돌리기로 목록이 돌아와도 기준점은 맨 앞이다 — 스냅샷에 기준점은 안 담긴다", () => {
    seed(4);
    ed.toggleSelect("s1f4"); // 기준점 = s1f4
    ed.move(0, 3);
    ed.undo();
    expect(ids()).toEqual(["s1f1", "s1f2", "s1f3", "s1f4"]);

    ed.selectNone();
    ed.toggleSelect("s1f2", true);
    expect(selected()).toEqual(["s1f1", "s1f2"]);
  });
});

describe("모두 비우기", () => {
  it("프레임·자막·변형이 함께 사라지고 되돌리기 하나로 함께 돌아온다", () => {
    seed(3);
    ed.addOverlay();
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    ed.setScale(0.5);
    ed.clearAll();
    expect(ed.frames).toHaveLength(0);
    expect(ed.overlays).toHaveLength(0);
    expect(ed.regions).toHaveLength(0);
    expect(ed.transform.scale).toBe(1);

    ed.undo();
    expect(ed.frames).toHaveLength(3);
    expect(ed.overlays).toHaveLength(1);
    expect(ed.regions).toHaveLength(1);
    expect(ed.transform.scale).toBe(0.5);
  });

  it("소스는 남는다 — 되돌리기로 돌아올 수 있어야 한다", () => {
    seed(2);
    ed.clearAll();
    expect(ed.sources.has("s1")).toBe(true);
  });

  it("프레임이 없으면 아무 일도 안 하고 지점도 안 남긴다", () => {
    ed.clearAll();
    expect(ed.canUndo).toBe(false);
    expect(ed.revision).toBe(0);
  });
});

describe("소스 바이트는 되돌리기가 붙들고 있는 동안만 남는다", () => {
  it("지운 프레임의 소스는 스택이 붙들고 있다", () => {
    seed(2, "s1");
    seed(2, "s2");
    ed.selectNumbers(3, 4);
    ed.deleteSelected();
    expect(ed.frames).toHaveLength(2);
    expect(ed.sources.has("s2")).toBe(true);
  });

  it(`지점이 ${HISTORY_MAX}개 뒤로 밀려나면 표에서 사라진다`, () => {
    seed(2, "s1");
    seed(2, "s2");
    ed.selectNumbers(3, 4);
    ed.deleteSelected();

    churn(HISTORY_MAX - 1);
    expect(ed.sources.has("s2")).toBe(true);
    churn(1);
    expect(ed.sources.has("s2")).toBe(false);
    expect(ed.sources.has("s1")).toBe(true);
  });

  it("되돌려서 프레임이 살아나면 소스도 그대로 쓰인다", () => {
    seed(2, "s1");
    seed(2, "s2");
    ed.selectNumbers(3, 4);
    ed.deleteSelected();
    ed.undo();
    expect(ed.frames).toHaveLength(4);
    expect(ed.sources.get("s2")?.bytes.length).toBe(SOURCE_BYTES.length);
  });
});

describe("반복 횟수는 gifenc의 repeat 규약으로 나간다", () => {
  it("무한 재생은 0이다", () => {
    expect(ed.repeat).toBe(0);
    expect(ed.webpLoop).toBe(0);
  });

  it("1회 재생은 -1이다 — 0으로 내면 무한이 된다", () => {
    ed.setLoopForever(false);
    ed.setLoopCount(1);
    expect(ed.repeat).toBe(-1);
    expect(ed.webpLoop).toBe(1);
  });

  it("n회 재생은 추가 반복 n-1이다", () => {
    ed.setLoopForever(false);
    ed.setLoopCount(3);
    expect(ed.repeat).toBe(2);
    expect(ed.webpLoop).toBe(3);
  });

  it("반복 횟수는 1~100으로 가둔다", () => {
    ed.setLoopForever(false);
    ed.setLoopCount(0);
    expect(ed.loopCount).toBe(1);
    ed.setLoopCount(1000);
    expect(ed.loopCount).toBe(100);
  });
});

describe("화면에서 오는 이상한 수", () => {
  it("딜레이 칸이 비면(NaN) 아무 일도 안 하고 지점도 안 남긴다", () => {
    seed(2);
    ed.setDelay(Number.NaN, false);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([100, 100]);
    expect(ed.canUndo).toBe(false);
    ed.setFrameDelay("s1f1", Number.NaN);
    expect(ed.frames[0].delayMs).toBe(100);
    expect(ed.canUndo).toBe(false);
  });

  it("딜레이는 20~10000ms로 가둔다 — GIF가 담지 못하는 값이 나가지 않게", () => {
    seed(2);
    ed.setDelay(1, false);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([20, 20]);
    ed.setDelay(99_999, false);
    expect(ed.frames.map((f) => f.delayMs)).toEqual([10_000, 10_000]);
  });

  it("가감·비율 딜레이도 같은 상한·하한에 걸린다", () => {
    seed(2, "s1", 200);
    ed.setDelay(-500, false, "add");
    expect(ed.frames.map((f) => f.delayMs)).toEqual([20, 20]);
    ed.setDelay(50, false, "scale");
    expect(ed.frames.map((f) => f.delayMs)).toEqual([20, 20]);
  });

  it("색 수는 8~256으로 가둔다", () => {
    ed.setGifColors(2);
    expect(ed.gifColors).toBe(8);
    ed.setGifColors(1000);
    expect(ed.gifColors).toBe(256);
  });

  it("배율은 0.05~8로 가둔다", () => {
    seed(2);
    ed.setScale(0);
    expect(ed.transform.scale).toBe(0.05);
    ed.setScale(100);
    expect(ed.transform.scale).toBe(8);
  });

  it("너무 작은 영역은 만들어지지 않는다 — 잘못 찍은 클릭이다", () => {
    seed(2);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 2, h: 2 });
    expect(ed.regions).toHaveLength(0);
    expect(ed.canUndo).toBe(false);
  });
});

describe("크롭 모드와 가리기 모드는 함께 켜지지 않는다", () => {
  it("가리기를 켜면 크롭이 꺼진다 — 같은 드래그를 두 뜻으로 읽지 않는다", () => {
    seed(2);
    ed.cropMode = true;
    ed.toggleRedactMode();
    expect(ed.redactMode).toBe(true);
    expect(ed.cropMode).toBe(false);
  });

  it("가리기를 켜면 재생이 멈춘다", () => {
    seed(2);
    ed.togglePlay();
    expect(ed.playing).toBe(true);
    ed.toggleRedactMode();
    expect(ed.playing).toBe(false);
  });

  it("크롭 모드에서 미리보기는 변형 없는 베이스를 보여 주고 가릴 영역만 들고 간다", () => {
    seed(2);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    ed.setCrop({ x: 8, y: 8, w: 32, h: 24 });
    ed.setScale(0.5);
    expect(ed.previewOutput).toEqual({ w: 16, h: 12 });

    ed.cropMode = true;
    expect(ed.previewOutput).toEqual({ w: BASE_W, h: BASE_H });
    expect(ed.previewTransform.crop).toBeNull();
    expect(ed.previewTransform.scale).toBe(1);
    expect(ed.previewTransform.redact).toHaveLength(1);
  });

  // 영역 좌표는 한 좌표계에만 산다(CLAUDE.md 35번). 만들기는 `output`/`transform`으로,
  // 끌기는 `previewOutput`/`previewTransform`으로 되돌리고 있었다 — 크롭 모드에서는
  // 둘이 갈라진다. 지금 화면에서는 크롭 모드와 가리기 모드가 배타라 도달하지 않지만
  // (Panel.svelte:313·toggleRedactMode), 두 자리가 다른 것 자체가 결함이다.
  it("크롭 모드에서 만든 영역은 미리보기가 그리는 좌표계로 앉는다", () => {
    seed(2);
    ed.setCrop({ x: 8, y: 8, w: 32, h: 24 });
    ed.setScale(0.5);
    ed.cropMode = true; // 미리보기는 변형 없는 64×48을 그린다

    ed.addRegionFromOutput({ x: 10, y: 10, w: 20, h: 16 });
    expect(ed.regions[0]).toMatchObject({ x: 10, y: 10, w: 20, h: 16 });
  });

  it("만든 자리를 그대로 다시 끌면 값이 안 바뀐다 — 두 자리가 같은 좌표계를 쓴다", () => {
    seed(2);
    ed.setCrop({ x: 8, y: 8, w: 32, h: 24 });
    ed.setScale(0.5);
    ed.cropMode = true;
    ed.addRegionFromOutput({ x: 10, y: 10, w: 20, h: 16 });
    const id = ed.regions[0].id;

    const revision = ed.revision;
    ed.beginRegionDrag(id);
    ed.dragRegionTo(id, { x: 10, y: 10, w: 20, h: 16 });
    ed.endRegionDrag();
    expect(ed.revision).toBe(revision);
    expect(ed.regions[0]).toMatchObject({ x: 10, y: 10, w: 20, h: 16 });
  });

  it("가리기 모드에서는 크롭·배율이 걸린 출력 좌표를 베이스로 되돌린다", () => {
    seed(2);
    ed.setCrop({ x: 8, y: 8, w: 32, h: 24 });
    ed.setScale(0.5); // 출력은 16×12
    ed.toggleRedactMode();
    expect(ed.cropMode).toBe(false);

    // 출력 (2,2)-(12,10)은 베이스로는 크롭 왼쪽 위(8,8)에서 (4,4)만큼 들어간 자리다.
    ed.addRegionFromOutput({ x: 2, y: 2, w: 10, h: 8 });
    expect(ed.regions[0]).toMatchObject({ x: 12, y: 12, w: 20, h: 16 });
  });
});

describe("변형 되돌리기는 가릴 영역을 남긴다", () => {
  it("크롭·회전·배율만 지우고 가리기는 그대로 둔다", () => {
    // 얼굴을 가려 놓고 크롭을 고치려다 가리기가 사라지면 그대로 내보내게 된다.
    seed(2);
    ed.addRegionFromOutput({ x: 4, y: 4, w: 20, h: 16 });
    ed.setCrop({ x: 2, y: 2, w: 40, h: 30 });
    ed.rotate90();
    ed.setScale(2);

    ed.resetTransform();
    expect(ed.transform.crop).toBeNull();
    expect(ed.transform.rotation).toBe(0);
    expect(ed.transform.scale).toBe(1);
    expect(ed.regions).toHaveLength(1);
    expect(ed.regions[0]).toMatchObject({ x: 4, y: 4, w: 20, h: 16 });
  });
});
