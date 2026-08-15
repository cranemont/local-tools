/** 동영상 편집기 상태 기계 — 구간 목록이 무엇을 약속하는가, 그리고 "무손실"이 참말인가.
 *
 * `tests/video-segments.test.ts`가 `video/segments.ts`의 규격(정규화·겹침 판정·
 * `checkLosslessConcat`)과 `transcode.ts`의 판정 함수들을 못 박는다면, 이 파일은 그 위
 * 두 층을 잰다.
 *   ① **상태 기계** — 파일을 열고 구간을 더하고 지우고 옮길 때 `segments`·`activeIndex`와
 *      파생값(`trimStart`·`trimEnd`·`segmentsTotal`)이 어떻게 맞물리는가.
 *   ② **엔진의 실동작** — 코드로 지은 동영상을 `concat.ts`의 복사 경로에 통과시켜,
 *      목록 순서가 정말 결과 순서인지 패킷 바이트로 확인한다.
 *
 * ②를 넣은 이유는 CLAUDE.md 25·33번이 **라이브러리의 성질**에 기대고 있어서다.
 * "WebM은 회전 메타데이터를 안 쓴다", "MP4는 vp9를 담는다" 같은 문장은 우리 표에 적혀
 * 있지만 참인지는 mediabunny가 정한다. 표만 재면 라이브러리가 바뀐 날 배지와 산출물이
 * 어긋나도 테스트가 초록으로 남는다. 그래서 표를 컨테이너에 직접 물어 맞춰 본다.
 *
 * ## 부르는 방법
 *
 * `state.svelte.ts`는 룬 모듈이라 svelte 플러그인을 거쳐야 값이 된다(`vitest.config.ts`).
 * 테스트 파일에서는 룬을 못 쓴다 — 메서드를 부르고 파생값을 읽는다. 앱은 모듈 싱글턴
 * `editor` 하나를 쓰지만 여기서는 테스트마다 `new EditorState()`를 만든다. 싱글턴을
 * 처음 상태로 되돌리는 메서드가 없어서다(`clear()`는 프리셋·목표 용량을 일부러 남긴다).
 * 재는 대상은 같은 클래스다.
 *
 * 재생기(`videoEl`)는 없다. `seek`·`togglePlayRange`는 엘리먼트가 없으면 아무 일도
 * 안 하도록 되어 있어, 구간을 고를 때 함께 불려도 상태를 흔들지 않는다.
 *
 * 표본은 `tests/fixtures/video.ts`가 코드로 짓는다. 픽셀이 없는 표본이라 디코딩은 못
 * 재지만(그 자리는 브라우저 층 몫), 컨테이너를 지나는 것은 다 잰다.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { EditorState } from "../apps/video/src/lib/editor/state.svelte";
import {
  concatSegments,
  containerAcceptsAudio,
  makeOutputFormat,
} from "../apps/video/src/lib/video/concat";
import { getKeyframeTimes, probeVideo } from "../apps/video/src/lib/video/probe";
import { hasOverlap, type Segment } from "../apps/video/src/lib/video/segments";
import {
  combineRotation,
  losslessCompatible,
  rotationBreaksCopy,
  type ContainerId,
} from "../apps/video/src/lib/video/transcode";
import {
  makeVideo,
  readPackets,
  roundTimes,
  videoFile,
  type VideoContainer,
} from "./fixtures/video";

/** 표본의 성질 — 20프레임 10fps, 5프레임마다 키프레임. */
const DURATION_S = 2;
const KEYFRAMES = [0, 0.5, 1, 1.5];

let sampleBytes: Uint8Array;
let rotatedMp4Bytes: Uint8Array;

beforeAll(async () => {
  sampleBytes = await makeVideo();
  rotatedMp4Bytes = await makeVideo({ container: "mp4", rotation: 90 });
});

/** 표본 바이트로 새 File. 앱은 File만 받는다. */
function sampleFile(name = "sample.webm"): File {
  return videoFile(sampleBytes, name);
}

function textFile(name = "note.txt"): File {
  return new File(["동영상이 아니다"], name, { type: "text/plain" });
}

/** 키프레임 스캔은 배경에서 돈다 — 채워질 때까지 이벤트 루프를 돌려 준다. */
async function settleKeyframes(ed: EditorState): Promise<void> {
  for (let i = 0; i < 200 && ed.keyframes.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** 표본을 연 편집기 — 키프레임까지 붙은 상태. */
async function opened(): Promise<EditorState> {
  const ed = new EditorState();
  await ed.openFile(sampleFile());
  await settleKeyframes(ed);
  return ed;
}

/** 목록 조작 테스트용 — 세 구간을 손으로 놓는다. id는 항목을 따라가려고 쓴다. */
function seedSegments(ed: EditorState): void {
  ed.segments = [
    { id: 101, start: 0, end: 0.4 },
    { id: 102, start: 0.6, end: 1 },
    { id: 103, start: 1.2, end: 1.6 },
  ];
  ed.activeIndex = 0;
}

function ids(list: readonly Segment[]): number[] {
  return list.map((s) => s.id);
}

function starts(list: readonly Segment[]): number[] {
  return roundTimes(list.map((s) => s.start));
}

/** 재인코딩 경로로 넘어갔다는 표시 — 복사라고 표시한 채 굽지 않는지 보는 데 쓴다. */
class RecodeReached extends Error {
  constructor() {
    super("재인코딩 경로");
  }
}

interface CopyRun {
  bytes: Uint8Array;
  recodeAsked: boolean;
}

/** 복사 경로로 이어붙인다. 재인코딩으로 넘어가면 즉시 던져서 그 사실을 드러낸다. */
async function copyJoin(
  segments: Segment[],
  opts: { container?: VideoContainer; rotate?: 0 | 90 | 180 | 270 } = {},
): Promise<CopyRun> {
  let recodeAsked = false;
  try {
    const res = await concatSegments({
      file: sampleFile(),
      segments,
      container: opts.container ?? "webm",
      mute: true,
      copy: true,
      rotate: opts.rotate ?? 0,
      transcodeOptions: () => {
        recodeAsked = true;
        throw new RecodeReached();
      },
    });
    const blob = res.blob;
    if (!blob) throw new Error("취소하지 않았는데 결과가 없다");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), recodeAsked };
  } catch (err) {
    if (err instanceof RecodeReached) return { bytes: new Uint8Array(), recodeAsked };
    throw err;
  }
}

describe("표본 — 코드로 지은 동영상이 실행마다 흔들리지 않는다", () => {
  it("같은 명세로 두 번 지으면 바이트가 같다", async () => {
    const a = await makeVideo();
    const b = await makeVideo();
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("MP4도 같은 명세면 같은 바이트다 — 만든 시각이 안 들어간다", async () => {
    const a = await makeVideo({ container: "mp4" });
    const b = await makeVideo({ container: "mp4" });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("probe가 표본에 심어 둔 것을 그대로 읽는다", async () => {
    expect(await probeVideo(sampleFile())).toEqual({
      width: 320,
      height: 240,
      durationS: DURATION_S,
      videoCodec: "vp9",
      audioCodec: null,
      hasAudio: false,
      fps: 10,
      rotation: 0,
    });
  });

  it("키프레임 목록은 심어 둔 자리 그대로다", async () => {
    expect(roundTimes(await getKeyframeTimes(sampleFile()))).toEqual(KEYFRAMES);
  });

  it("키프레임 간격을 좁히면 목록도 그만큼 촘촘해진다", async () => {
    const bytes = await makeVideo({ keyEvery: 2 });
    const times = roundTimes(await getKeyframeTimes(videoFile(bytes, "dense.webm")));
    expect(times).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8]);
  });

  it("MP4는 회전을 파일에 적고, probe가 그 값과 뒤바뀐 화면 크기를 읽는다", async () => {
    const meta = await probeVideo(videoFile(rotatedMp4Bytes, "rot.mp4"));
    expect(meta.rotation).toBe(90);
    expect([meta.width, meta.height]).toEqual([240, 320]);
  });

  it("WebM에는 회전을 못 적는다 — mediabunny가 거절한다(CLAUDE.md 25번의 뿌리)", async () => {
    await expect(makeVideo({ container: "webm", rotation: 90 })).rejects.toThrow(
      /rotation metadata/i,
    );
  });

  it("동영상이 아닌 바이트는 트랙을 못 찾고 이유를 남긴다", async () => {
    await expect(probeVideo(textFile("a.webm"))).rejects.toThrow();
  });
});

describe("파일을 열면 전체를 덮는 구간 하나로 시작한다", () => {
  it("구간 하나가 영상 전체를 덮고 그것이 선택된다", async () => {
    const ed = await opened();
    expect(ed.segments.length).toBe(1);
    expect(ed.segments[0].start).toBe(0);
    expect(ed.segments[0].end).toBe(DURATION_S);
    expect(ed.activeIndex).toBe(0);
    expect(ed.trimStart).toBe(0);
    expect(ed.trimEnd).toBe(DURATION_S);
    expect(ed.isTrimmed).toBe(false);
    expect(ed.isMultiSegment).toBe(false);
  });

  it("메타를 읽어 두고 재생용 주소를 만든다", async () => {
    const ed = await opened();
    expect(ed.meta?.width).toBe(320);
    expect(ed.videoUrl.startsWith("blob:")).toBe(true);
    expect(ed.busy).toBe(false);
    expect(ed.error).toBe("");
  });

  it("동영상이 아니면 열지 않고 이유를 알린다", async () => {
    const ed = new EditorState();
    await ed.openFile(textFile("note.txt"));
    expect(ed.file).toBe(null);
    expect(ed.error).toBe("동영상 파일이 아니에요: note.txt");
    expect(ed.segments).toEqual([]);
  });

  it("MIME이 비어 있어도 확장자가 동영상이면 연다 — 드롭한 파일에는 type이 없을 때가 있다", async () => {
    const ed = new EditorState();
    await ed.openFile(videoFile(sampleBytes, "clip.webm", ""));
    expect(ed.error).toBe("");
    expect(ed.meta?.durationS).toBe(DURATION_S);
  });

  it("키프레임 스캔은 편집을 막지 않고 뒤따라 붙는다", async () => {
    const ed = new EditorState();
    await ed.openFile(sampleFile());
    // 파일을 연 시점에 이미 편집할 수 있다 — 스캔은 그 뒤에 채워진다.
    expect(ed.segments.length).toBe(1);
    await settleKeyframes(ed);
    expect(roundTimes(ed.keyframes)).toEqual(KEYFRAMES);
  });

  it("여러 개를 주면 첫 동영상을 열고 나머지는 대기줄에 쌓는다", async () => {
    const ed = new EditorState();
    await ed.openFiles([textFile(), sampleFile("a.webm"), sampleFile("b.webm")]);
    expect(ed.file?.name).toBe("a.webm");
    expect(ed.queue.map((f) => f.name)).toEqual(["b.webm"]);
    expect(ed.isBatch).toBe(true);
    expect(ed.batch.map((f) => f.name)).toEqual(["a.webm", "b.webm"]);
  });

  it("대기줄에는 동영상만 들어간다", async () => {
    const ed = new EditorState();
    await ed.openFiles([sampleFile("a.webm"), textFile(), sampleFile("b.webm")]);
    expect(ed.queue.map((f) => f.name)).toEqual(["b.webm"]);
  });

  it("동영상이 하나도 없으면 첫 파일로 열어 이유를 알린다", async () => {
    const ed = new EditorState();
    await ed.openFiles([textFile("only.txt")]);
    expect(ed.error).toBe("동영상 파일이 아니에요: only.txt");
    expect(ed.isBatch).toBe(false);
  });

  it("새 파일을 열면 파일마다 다른 값만 초기화되고 설정은 남는다", async () => {
    const ed = await opened();
    ed.setRotate(90);
    ed.setResHeight(720);
    ed.setFps(24);
    ed.setPreset("high");
    ed.setTargetMB(50);
    ed.setExportFormat("webm");

    await ed.openFile(sampleFile("other.webm"));
    expect(ed.rotate).toBe(0);
    expect(ed.resHeight).toBe(null);
    expect(ed.fps).toBe(null);
    // 설정은 파일과 무관하다 — 다음 파일에도 같은 설정으로 이어서 처리한다.
    expect(ed.preset).toBe("high");
    expect(ed.targetMB).toBe(50);
    expect(ed.exportFormat).toBe("webm");
  });

  it("clear()는 파일을 놓고 구간을 비운다", async () => {
    const ed = await opened();
    ed.clear();
    expect(ed.file).toBe(null);
    expect(ed.meta).toBe(null);
    expect(ed.segments).toEqual([]);
    expect(ed.keyframes).toEqual([]);
    expect(ed.trimEnd).toBe(0);
  });
});

describe("구간 목록의 순서가 곧 이어붙이는 순서다", () => {
  it("구간을 더하면 빈 자리에 붙고 그것이 선택된다", async () => {
    const ed = await opened();
    ed.setTrimEnd(0.5);
    ed.currentTime = 1;
    ed.addSegment();
    expect(ed.segments.length).toBe(2);
    expect(starts(ed.segments)).toEqual([0, 0.5]);
    expect(ed.segments[1].end).toBe(DURATION_S);
    expect(ed.activeIndex).toBe(1);
  });

  it("빈 자리가 없으면 재생 위치에서 겹쳐 잡는다 — 같은 대목을 두 번 쓰는 편집이다", async () => {
    const ed = await opened();
    ed.currentTime = 0;
    ed.addSegment();
    expect(ed.segments.length).toBe(2);
    expect(ed.segments[1]).toMatchObject({ start: 0, end: DURATION_S });
  });

  it("구간 하나는 남긴다 — 목록이 비면 내보낼 것이 없다", async () => {
    const ed = await opened();
    ed.removeSegment(0);
    expect(ed.segments.length).toBe(1);
  });

  it("앞의 것을 지우면 뒤 번호가 당겨지므로 보던 구간을 계속 본다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 1;
    ed.removeSegment(0);
    expect(ids(ed.segments)).toEqual([102, 103]);
    // 번호를 안 당기면 여기서 103을 보게 된다 — 지운 것은 101인데 보던 것이 바뀐다.
    expect(ed.activeIndex).toBe(0);
    expect(ed.active?.id).toBe(102);
  });

  it("맨 뒤를 보다 앞의 것을 지워도 같은 구간에 남는다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 2;
    ed.removeSegment(0);
    expect(ed.activeIndex).toBe(1);
    expect(ed.active?.id).toBe(103);
  });

  it("뒤의 것을 지우면 보던 자리는 그대로다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 0;
    ed.removeSegment(2);
    expect(ids(ed.segments)).toEqual([101, 102]);
    expect(ed.activeIndex).toBe(0);
  });

  it("보던 것을 지우면 자리 번호가 목록 안으로 붙잡힌다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 2;
    ed.removeSegment(2);
    expect(ed.activeIndex).toBe(1);
    expect(ed.active?.id).toBe(102);
  });

  it("범위 밖 번호로는 아무것도 안 지운다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.removeSegment(-1);
    ed.removeSegment(9);
    expect(ids(ed.segments)).toEqual([101, 102, 103]);
  });

  it("순서를 바꾸면 고른 구간이 따라간다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 0;
    ed.moveSegmentBy(0, 1);
    expect(ids(ed.segments)).toEqual([102, 101, 103]);
    expect(ed.activeIndex).toBe(1);
    expect(ed.active?.id).toBe(101);
  });

  it("자리를 내준 쪽도 번호가 따라온다 — 둘이 자리를 맞바꾼 것이다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 1;
    ed.moveSegmentBy(0, 1);
    expect(ed.activeIndex).toBe(0);
    expect(ed.active?.id).toBe(102);
  });

  it("목록 밖으로는 못 옮긴다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 0;
    ed.moveSegmentBy(0, -1);
    ed.moveSegmentBy(2, 1);
    expect(ids(ed.segments)).toEqual([101, 102, 103]);
    expect(ed.activeIndex).toBe(0);
  });

  it("구간을 고르면 핸들이 그 구간을 가리킨다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.selectSegment(2);
    expect(ed.activeIndex).toBe(2);
    expect(ed.trimStart).toBeCloseTo(1.2, 6);
    expect(ed.trimEnd).toBeCloseTo(1.6, 6);
    expect(ed.rangeLength).toBeCloseTo(0.4, 6);
  });

  it("범위 밖 번호를 고르면 보던 구간이 그대로다", async () => {
    const ed = await opened();
    seedSegments(ed);
    ed.activeIndex = 1;
    ed.selectSegment(5);
    ed.selectSegment(-1);
    expect(ed.activeIndex).toBe(1);
  });

  it("내보내기 목록은 겹침도 뒤바뀐 순서도 고치지 않는다", async () => {
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 1.5, end: 2 },
      { id: 2, start: 0, end: 1 },
      { id: 3, start: 0.5, end: 1.5 },
    ];
    expect(ed.exportSegments()).toEqual([
      { id: 1, start: 1.5, end: 2 },
      { id: 2, start: 0, end: 1 },
      { id: 3, start: 0.5, end: 1.5 },
    ]);
  });

  it("0.1초 미만 구간은 내보내기 목록에서 빠진다", async () => {
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 0, end: 0.5 },
      { id: 2, start: 0.5, end: 0.55 },
    ];
    expect(ids(ed.exportSegments())).toEqual([1]);
  });

  it("영상 밖으로 나간 구간은 경계로 잘려 나간다", async () => {
    const ed = await opened();
    ed.segments = [{ id: 1, start: 1.5, end: 9 }];
    expect(ed.exportSegments()).toEqual([{ id: 1, start: 1.5, end: DURATION_S }]);
  });

  it("내보낼 총 길이는 겹친 대목을 두 번 센다", async () => {
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 0, end: 1 },
      { id: 2, start: 0, end: 1 },
    ];
    expect(ed.segmentsTotal).toBeCloseTo(2, 6);
    expect(ed.isMultiSegment).toBe(true);
    // 구간이 둘이면 전체를 덮더라도 "손댄 것"이다 — 결과가 원본과 다르다.
    expect(ed.isTrimmed).toBe(true);
  });
});

describe("트림 핸들은 고른 구간의 창이다", () => {
  it("시작은 0 아래로 안 내려간다", async () => {
    const ed = await opened();
    ed.setTrimStart(-5);
    expect(ed.trimStart).toBe(0);
  });

  it("시작은 끝에서 최소 길이(0.1초)만큼 떨어져 멈춘다", async () => {
    const ed = await opened();
    ed.setTrimStart(1.99);
    expect(ed.trimStart).toBeCloseTo(1.9, 6);
  });

  it("끝은 영상 길이를 안 넘는다", async () => {
    const ed = await opened();
    ed.setTrimEnd(99);
    expect(ed.trimEnd).toBe(DURATION_S);
  });

  it("끝은 시작에서 최소 길이만큼 떨어져 멈춘다", async () => {
    const ed = await opened();
    ed.setTrimStart(1);
    ed.setTrimEnd(1.01);
    expect(ed.trimEnd).toBeCloseTo(1.1, 6);
  });

  it("값이 안 바뀌면 편집 세대도 안 오른다 — 미리보기를 헛되이 다시 그리지 않는다", async () => {
    const ed = await opened();
    const before = ed.revision;
    ed.setTrimStart(0);
    ed.setTrimEnd(DURATION_S);
    expect(ed.revision).toBe(before);
  });

  it("파일이 없으면 창은 0..0이다", () => {
    const ed = new EditorState();
    expect(ed.trimStart).toBe(0);
    expect(ed.trimEnd).toBe(0);
    expect(ed.rangeLength).toBe(0);
    expect(ed.active).toBe(null);
    expect(ed.isTrimmed).toBe(false);
  });

  it("파일이 없으면 핸들을 끌어도 아무 일도 안 한다", () => {
    const ed = new EditorState();
    ed.setTrimStart(1);
    ed.setTrimEnd(2);
    expect(ed.segments).toEqual([]);
    expect(ed.revision).toBe(0);
  });

  it("resetTrim은 구간 하나로 되돌린다", async () => {
    const ed = await opened();
    ed.setTrimStart(0.5);
    ed.currentTime = 1.5;
    ed.addSegment();
    ed.resetTrim();
    expect(ed.segments.length).toBe(1);
    expect(ed.segments[0]).toMatchObject({ start: 0, end: DURATION_S });
    expect(ed.activeIndex).toBe(0);
    expect(ed.isTrimmed).toBe(false);
  });

  it("이미 전체면 resetTrim이 아무 일도 안 한다", async () => {
    const ed = await opened();
    const before = ed.revision;
    ed.resetTrim();
    expect(ed.revision).toBe(before);
  });

  it("끝이 사실상 영상 끝이면 잘린 것으로 안 센다 — 핸들 스냅 오차를 흡수한다", async () => {
    const ed = await opened();
    ed.setTrimEnd(DURATION_S - 0.005);
    expect(ed.isTrimmed).toBe(false);
    ed.setTrimEnd(DURATION_S - 0.02);
    expect(ed.isTrimmed).toBe(true);
  });

  it("시작이 여유 안이면 잘린 것으로 안 센다", async () => {
    const ed = await opened();
    ed.setTrimStart(0.005);
    expect(ed.isTrimmed).toBe(false);
    ed.setTrimStart(0.02);
    expect(ed.isTrimmed).toBe(true);
  });

  it("프레임 보폭은 fps의 역수이고, fps를 못 재면 30fps로 본다", async () => {
    const ed = await opened();
    expect(ed.frameStep).toBeCloseTo(0.1, 6);
    const empty = new EditorState();
    expect(empty.frameStep).toBeCloseTo(1 / 30, 6);
  });
});

describe("무손실로 바꾸면 모든 구간 시작이 키프레임으로 내려간다", () => {
  it("고른 구간뿐 아니라 목록 전체가 내려간다 — 하나만 어긋나도 복사가 아니라 재인코딩이다", async () => {
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 0.3, end: 0.8 },
      { id: 2, start: 1.2, end: 1.8 },
    ];
    ed.setCutMode("lossless");
    expect(starts(ed.segments)).toEqual([0, 1]);
  });

  it("이미 키프레임에서 시작하는 구간은 그대로다", async () => {
    const ed = await opened();
    ed.segments = [{ id: 1, start: 1, end: 1.8 }];
    ed.setCutMode("lossless");
    expect(ed.segments[0].start).toBe(1);
  });

  it("키프레임을 아직 못 읽었으면 스냅하지 않는다 — 없는 자리로 내리는 것이 더 나쁘다", async () => {
    const ed = await opened();
    ed.keyframes = [];
    ed.segments = [{ id: 1, start: 0.3, end: 0.8 }];
    ed.setCutMode("lossless");
    expect(ed.segments[0].start).toBeCloseTo(0.3, 6);
  });

  it("반전은 무손실에서 꺼진다 — 픽셀을 다시 그려야 해서 복사 경로에 없다", async () => {
    const ed = await opened();
    ed.setFlip("h", true);
    ed.setFlip("v", true);
    ed.setCutMode("lossless");
    expect(ed.flipH).toBe(false);
    expect(ed.flipV).toBe(false);
  });

  it("회전은 무손실에서도 남는다 — 컨테이너가 받으면 메타데이터로 실린다", async () => {
    const ed = await opened();
    ed.setRotate(90);
    ed.setCutMode("lossless");
    expect(ed.rotate).toBe(90);
  });

  it("정확 모드로 되돌려도 내려간 시작은 그대로다 — 되돌리는 조작이 아니다", async () => {
    const ed = await opened();
    ed.segments = [{ id: 1, start: 0.3, end: 0.8 }];
    ed.setCutMode("lossless");
    ed.setCutMode("exact");
    expect(ed.segments[0].start).toBe(0);
  });

  it("무손실에서 시작 핸들을 끌면 직전 키프레임으로 내려간다", async () => {
    const ed = await opened();
    ed.setCutMode("lossless");
    ed.setTrimStart(1.3);
    expect(ed.trimStart).toBe(1);
  });

  it("끝 핸들은 스냅하지 않는다 — 마지막 GOP를 조금 더 담으면 그만이다", async () => {
    const ed = await opened();
    ed.setCutMode("lossless");
    ed.setTrimEnd(1.3);
    expect(ed.trimEnd).toBeCloseTo(1.3, 6);
  });

  it("구간을 더할 때 시작은 빈 자리 그대로다 — 스냅이 앞 구간을 파고들지 않는다", async () => {
    const ed = await opened();
    ed.setCutMode("lossless");
    ed.setTrimEnd(0.6);
    ed.currentTime = 1;
    ed.addSegment();
    // 예전에는 직전 키프레임 0.5로 내려가 [0, 0.6]과 겹쳤고, 0.5~0.6초가 결과에 두 번
    // 들어갔다. 사용자는 그 겹침을 고른 적이 없다 — 스냅이 만든 겹침이라 막는다.
    expect(ed.segments[1].start).toBe(0.6);
    expect(hasOverlap(ed.segments)).toBe(false);
  });

  it("빈 자리가 키프레임에서 시작하면 그대로 복사가 된다 — 막은 것은 겹침뿐이다", async () => {
    const ed = await opened();
    ed.setCutMode("lossless");
    ed.setTrimEnd(0.5);
    ed.currentTime = 1;
    ed.addSegment();
    expect(ed.segments[1].start).toBe(0.5);
    expect(hasOverlap(ed.segments)).toBe(false);
  });

  it("맞닿은 두 구간을 무손실로 바꿔도 겹치지 않는다 — 스냅이 앞 구간 끝에서 멈춘다", async () => {
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 0, end: 0.6 },
      { id: 2, start: 0.6, end: 2 },
    ];
    ed.setCutMode("lossless");
    expect(starts(ed.segments)).toEqual([0, 0.6]);
    expect(hasOverlap(ed.segments)).toBe(false);
  });

  it("사용자가 만든 겹침은 스냅이 넓히지도 고치지도 않는다", async () => {
    // 겹침을 그대로 두는 규약(CLAUDE.md 33번)은 여기까지다 — 사용자가 앞 구간 안으로 끌면
    // 그 값이 남고, 스냅이 그것을 더 앞으로 끌고 가지 않는다.
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 0, end: 1 },
      { id: 2, start: 0.7, end: 2 },
    ];
    ed.activeIndex = 1;
    ed.setCutMode("lossless");
    expect(ed.segments[1].start).toBe(0.7);
    ed.setTrimStart(0.3);
    expect(ed.segments[1].start).toBeCloseTo(0.3, 6);
    expect(hasOverlap(ed.segments)).toBe(true);
  });

  it("첫 키프레임보다 앞을 고르면 파일 시작까지 내려간다 — 고른 앞부분을 버리지 않는다", async () => {
    // 우리 표본으로는 못 만드는 상황이다(mediabunny가 첫 패킷을 키프레임으로 강제한다).
    // 남이 만든 파일에서 첫 키프레임이 0이 아니면 여기로 온다.
    // 예전에는 첫 키프레임(0.5)으로 뒤로 밀어 사용자가 고른 0.2~0.5초가 결과에서 빠졌다.
    const ed = await opened();
    ed.keyframes = [0.5, 1, 1.5];
    ed.setCutMode("lossless");
    ed.setTrimStart(0.2);
    expect(ed.trimStart).toBe(0);
  });

  it("첫 키프레임보다 앞이면 구간을 더할 때도 뒤로 밀리지 않는다", async () => {
    const ed = await opened();
    ed.keyframes = [0.5, 1, 1.5];
    ed.setCutMode("lossless");
    ed.segments = [{ id: 1, start: 1.5, end: 2 }];
    ed.activeIndex = 0;
    ed.currentTime = 0.2;
    ed.addSegment();
    // 빈 자리 [0, 1.5]의 시작은 그대로 0이다 — 0.5로 밀면 앞 0.5초가 사라진다.
    expect(ed.segments[1].start).toBe(0);
  });

  it("스냅 한계는 목록 순서가 아니라 시간축에서 앞선 구간의 끝이다", async () => {
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 1.3, end: 1.9 },
      { id: 2, start: 0.3, end: 1.05 },
    ];
    ed.setCutMode("lossless");
    // 1.3의 직전 키프레임은 1이지만 목록 뒤의 구간이 1.05까지 덮고 있어 거기서 멈춘다.
    expect(ed.segments[0].start).toBeCloseTo(1.05, 6);
    expect(ed.segments[1].start).toBe(0);
    expect(hasOverlap(ed.segments)).toBe(false);
  });

  it("정확 모드에는 스냅이 없다 — 한계 계산이 값을 건드리면 안 된다", async () => {
    // `#snapStart`가 두 값의 큰 쪽을 고르므로, 한계가 고른 값을 넘기면 정확 모드에서도
    // 시작이 움직인다. 그 통로가 막혀 있는지 두 자리에서 잰다.
    const ed = await opened();
    ed.segments = [
      { id: 1, start: 0, end: 1 },
      { id: 2, start: 1, end: 2 },
    ];
    ed.activeIndex = 1;
    ed.setTrimStart(0.25);
    expect(ed.segments[1].start).toBeCloseTo(0.25, 6);

    ed.segments = [{ id: 1, start: 0, end: 0.6 }];
    ed.activeIndex = 0;
    ed.currentTime = 1;
    ed.addSegment();
    expect(ed.segments[1].start).toBeCloseTo(0.6, 6);
  });

  it("빈 칸이 없을 때 재생 위치에 겹쳐 놓는 것은 그대로다 — 스냅이 막을 자리가 아니다", async () => {
    // `nextSegmentSlot`이 정한 동작이다(빈 칸이 없으면 재생 위치에서 기본 길이만큼).
    // 겹침을 막는 한계가 여기까지 번지면 "구간 추가"가 아무 일도 안 하게 된다.
    const ed = await opened();
    ed.segments = [{ id: 1, start: 0, end: 2 }];
    ed.setCutMode("lossless");
    ed.currentTime = 0.7;
    ed.addSegment();
    expect(ed.segments).toHaveLength(2);
    expect(ed.segments[1].start).toBeCloseTo(0.7, 6);
    expect(hasOverlap(ed.segments)).toBe(true);
  });

  it("무손실 전환은 편집 세대를 올린다 — 결과가 달라지므로", async () => {
    const ed = await opened();
    const before = ed.revision;
    ed.setCutMode("lossless");
    expect(ed.revision).toBeGreaterThan(before);
    const after = ed.revision;
    ed.setCutMode("lossless");
    expect(ed.revision).toBe(after);
  });
});

describe("무손실 판정이 mediabunny의 실제 동작과 어긋나지 않는다", () => {
  const containers: ContainerId[] = ["mp4", "webm"];

  it("회전 메타데이터 표가 컨테이너의 실제 능력과 같다", () => {
    for (const container of containers) {
      const supports = makeOutputFormat(container).supportsVideoRotationMetadata;
      expect(rotationBreaksCopy(90, container)).toBe(!supports);
      expect(rotationBreaksCopy(180, container)).toBe(!supports);
      expect(rotationBreaksCopy(0, container)).toBe(false);
    }
    // 표가 무엇을 말하고 있는지도 못 박아 둔다 — 위 단언만 있으면 둘이 함께 틀려도 초록이다.
    expect(makeOutputFormat("webm").supportsVideoRotationMetadata).toBe(false);
    expect(makeOutputFormat("mp4").supportsVideoRotationMetadata).toBe(true);
  });

  it("코덱 표가 컨테이너가 담을 수 있는 목록과 같다", () => {
    for (const container of containers) {
      const real = new Set(makeOutputFormat(container).getSupportedVideoCodecs());
      const all = new Set([
        ...makeOutputFormat("mp4").getSupportedVideoCodecs(),
        ...makeOutputFormat("webm").getSupportedVideoCodecs(),
      ]);
      const ours = new Set([...all].filter((c) => losslessCompatible(c, container)));
      expect([...ours].sort()).toEqual([...real].sort());
    }
  });

  it("모르는 코덱과 코덱을 못 읽은 파일은 복사 대상이 아니다", () => {
    expect(losslessCompatible("theora", "webm")).toBe(false);
    expect(losslessCompatible(null, "mp4")).toBe(false);
  });

  it("소리 코덱은 표를 베끼지 않고 컨테이너에 직접 묻는다", () => {
    expect(containerAcceptsAudio("opus", "webm")).toBe(true);
    expect(containerAcceptsAudio("aac", "webm")).toBe(false);
    expect(containerAcceptsAudio("aac", "mp4")).toBe(true);
    // 담을 소리가 없으면 걸릴 것도 없다.
    expect(containerAcceptsAudio(null, "webm")).toBe(true);
  });

  it("세로로 찍은 영상은 회전을 안 걸어도 파일에 90이 적혀 있다 — 그 값까지 더해 판정한다", async () => {
    const ed = new EditorState();
    await ed.openFile(videoFile(rotatedMp4Bytes, "portrait.mp4"));
    expect(ed.meta?.rotation).toBe(90);
    expect(ed.rotate).toBe(0);
    const total = combineRotation(ed.meta?.rotation ?? 0, ed.rotate);
    expect(total).toBe(90);
    expect(rotationBreaksCopy(total, "webm")).toBe(true);
    expect(rotationBreaksCopy(total, "mp4")).toBe(false);
  });

  it("사용자가 되돌려 놓으면 합이 0이라 WebM에서도 복사가 산다", async () => {
    const ed = new EditorState();
    await ed.openFile(videoFile(rotatedMp4Bytes, "portrait.mp4"));
    ed.setRotate(270);
    const total = combineRotation(ed.meta?.rotation ?? 0, ed.rotate);
    expect(total).toBe(0);
    expect(rotationBreaksCopy(total, "webm")).toBe(false);
  });
});

describe("복사 경로는 목록 순서대로 패킷을 그대로 옮긴다", () => {
  it("구간 둘을 이으면 두 대목의 패킷이 이어 붙고 바이트가 그대로다", async () => {
    const run = await copyJoin([
      { id: 1, start: 0.5, end: 1 },
      { id: 2, start: 1.5, end: 2 },
    ]);
    expect(run.recodeAsked).toBe(false);
    const packets = await readPackets(run.bytes);
    // 채움 바이트가 원본 프레임 번호다 — 5~9번과 15~19번 프레임이 그대로 왔다.
    expect(packets.map((p) => p.marker)).toEqual([5, 6, 7, 8, 9, 15, 16, 17, 18, 19]);
    // 출력 시간축은 0에서 다시 시작하고 구간 사이가 붙는다.
    expect(roundTimes(packets.map((p) => p.timestamp))).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
    ]);
    expect(packets.filter((p) => p.type === "key").map((p) => p.marker)).toEqual([5, 15]);
  });

  it("구간 순서를 뒤집으면 결과의 순서도 뒤집힌다", async () => {
    const run = await copyJoin([
      { id: 1, start: 1.5, end: 2 },
      { id: 2, start: 0.5, end: 1 },
    ]);
    const packets = await readPackets(run.bytes);
    expect(packets.map((p) => p.marker)).toEqual([15, 16, 17, 18, 19, 5, 6, 7, 8, 9]);
  });

  it("같은 대목을 두 번 넣으면 결과에도 두 번 나온다", async () => {
    const run = await copyJoin([
      { id: 1, start: 0.5, end: 1 },
      { id: 2, start: 0.5, end: 1 },
    ]);
    const packets = await readPackets(run.bytes);
    expect(packets.map((p) => p.marker)).toEqual([5, 6, 7, 8, 9, 5, 6, 7, 8, 9]);
  });

  it("시작이 키프레임이 아니면 그 자리의 키프레임까지 내려가 시작한다", async () => {
    // 화면은 무손실에서 시작을 스냅해 주지만, 엔진도 스스로 한 번 더 맞춘다.
    // 안 맞추면 앞 GOP가 없는 delta 패킷부터 시작해 결과가 깨진다.
    const run = await copyJoin([{ id: 1, start: 0.7, end: 1 }]);
    const packets = await readPackets(run.bytes);
    expect(packets.map((p) => p.marker)).toEqual([5, 6, 7, 8, 9]);
    expect(packets[0].type).toBe("key");
  });

  it("이어붙인 결과에도 키프레임 자리가 남는다", async () => {
    const run = await copyJoin([
      { id: 1, start: 0.5, end: 1 },
      { id: 2, start: 1.5, end: 2 },
    ]);
    const times = await getKeyframeTimes(videoFile(run.bytes, "joined.webm"));
    expect(roundTimes(times)).toEqual([0, 0.5]);
  });

  it("MP4로 담으면 회전이 메타데이터로 실려 복사가 산다", async () => {
    const run = await copyJoin([{ id: 1, start: 0, end: 1 }], {
      container: "mp4",
      rotate: 90,
    });
    expect(run.recodeAsked).toBe(false);
    const meta = await probeVideo(videoFile(run.bytes, "rot.mp4"));
    expect(meta.rotation).toBe(90);
    expect([meta.width, meta.height]).toEqual([240, 320]);
    const packets = await readPackets(run.bytes);
    expect(packets.map((p) => p.marker)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("WebM에 회전이 걸리면 복사 경로가 재인코딩으로 넘긴다 — 복사로 표시한 채 굽지 않는다", async () => {
    const run = await copyJoin([{ id: 1, start: 0, end: 1 }], {
      container: "webm",
      rotate: 90,
    });
    expect(run.recodeAsked).toBe(true);
  });

  it("구간이 하나도 없으면 이어붙일 것이 없다", async () => {
    await expect(copyJoin([])).rejects.toThrow();
  });
});
