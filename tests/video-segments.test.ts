import { describe, expect, it } from "vitest";

import {
  checkLosslessConcat,
  DEFAULT_SEGMENT_S,
  freeIntervals,
  hasOverlap,
  isKeyframeAligned,
  isOutOfOrder,
  mergeIntervals,
  MIN_SEGMENT_S,
  moveSegment,
  nextSegmentSlot,
  normalizeSegments,
  overallProgress,
  segmentLength,
  segmentWeights,
  totalLength,
  type Segment,
} from "../apps/video/src/lib/video/segments";
import {
  combineRotation,
  rotationBreaksCopy,
  trimStartBreaksCopy,
} from "../apps/video/src/lib/video/transcode";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 apps/video 구간 목록의 명세다.
// 규약 하나가 나머지를 결정한다 — 목록 순서가 곧 이어붙이는 순서이고, 겹침과 순서
// 뒤바뀜은 고치지 않는다. 정규화는 경계 clamp·뒤집힌 start/end 교환·최소 길이 미만
// 제거만 한다. 기대값은 구현을 베끼지 않고 손으로 계산한 값이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 짧게 쓰기 위한 생성기 — id는 목록 조작용이라 값 자체에는 뜻이 없다. */
function seg(id: number, start: number, end: number): Segment {
  return { id, start, end };
}

describe("정규화는 경계만 맞추고 목록 순서와 겹침은 건드리지 않는다", () => {
  it("구간이 0개면 빈 목록이 나온다", () => {
    expect(normalizeSegments([], 60)).toEqual([]);
  });

  it("구간 하나는 그대로 남는다", () => {
    expect(normalizeSegments([seg(1, 3, 9)], 60)).toEqual([seg(1, 3, 9)]);
  });

  it("영상 길이를 넘는 끝은 영상 길이로 잘린다", () => {
    expect(normalizeSegments([seg(1, 50, 120)], 60)).toEqual([seg(1, 50, 60)]);
  });

  it("음수 시작은 0으로 올라간다", () => {
    expect(normalizeSegments([seg(1, -5, 4)], 60)).toEqual([seg(1, 0, 4)]);
  });

  it("구간 전체가 음수 자리면 clamp 뒤 0 길이가 되어 버려진다", () => {
    expect(normalizeSegments([seg(1, -9, -2)], 60)).toEqual([]);
  });

  it("0 길이 구간은 버려진다", () => {
    expect(normalizeSegments([seg(1, 7, 7)], 60)).toEqual([]);
  });

  it("최소 길이(0.1초)보다 짧으면 버리고, 딱 최소 길이면 남긴다", () => {
    expect(MIN_SEGMENT_S).toBe(0.1);
    expect(normalizeSegments([seg(1, 1, 1.09)], 60)).toEqual([]);
    expect(normalizeSegments([seg(2, 1, 1.1)], 60)).toEqual([seg(2, 1, 1.1)]);
  });

  it("start가 end보다 크면 둘을 바꾼다 — 핸들을 서로 지나치게 끌었을 때", () => {
    expect(normalizeSegments([seg(1, 20, 5)], 60)).toEqual([seg(1, 5, 20)]);
  });

  it("겹치는 구간을 합치지 않는다 — 같은 대목을 두 번 넣는 편집이 정당하다", () => {
    const list = [seg(1, 0, 10), seg(2, 5, 15)];
    expect(normalizeSegments(list, 60)).toEqual(list);
  });

  it("완전히 포함된 구간도 그대로 남는다", () => {
    const list = [seg(1, 0, 30), seg(2, 10, 12)];
    expect(normalizeSegments(list, 60)).toEqual(list);
  });

  it("순서가 뒤바뀐 목록을 시작 시각 순으로 정렬하지 않는다", () => {
    const list = [seg(1, 40, 50), seg(2, 0, 10)];
    expect(normalizeSegments(list, 60)).toEqual(list);
  });

  it("영상 길이가 0이면 전부 사라진다", () => {
    expect(normalizeSegments([seg(1, 0, 10)], 0)).toEqual([]);
  });

  it("NaN이 든 구간은 길이 비교에서 탈락한다", () => {
    expect(normalizeSegments([seg(1, NaN, 5)], 60)).toEqual([]);
  });

  it("영상 길이가 NaN이면 잴 수가 없으니 전부 사라진다", () => {
    expect(normalizeSegments([seg(1, 0, 10)], NaN)).toEqual([]);
  });

  it("영상 길이가 음수면 0으로 보고 전부 사라진다", () => {
    expect(normalizeSegments([seg(1, 0, 10)], -5)).toEqual([]);
  });

  it("무한대 끝은 영상 길이로 잘린다", () => {
    expect(normalizeSegments([seg(1, 10, Infinity)], 60)).toEqual([seg(1, 10, 60)]);
  });

  it("id는 그대로 따라온다 — 목록 조작이 항목을 id로 따라간다", () => {
    expect(normalizeSegments([seg(7, -3, 200)], 60)).toEqual([seg(7, 0, 60)]);
  });

  it("여러 개 중 짧은 것만 빠지고 나머지 순서는 그대로다", () => {
    const out = normalizeSegments([seg(1, 0, 5), seg(2, 9, 9.05), seg(3, 20, 30)], 60);
    expect(out.map((s) => s.id)).toEqual([1, 3]);
  });

  it("길이 계산은 뒤집힌 구간에서 0이다 — 음수 길이를 만들지 않는다", () => {
    expect(segmentLength({ start: 9, end: 4 })).toBe(0);
    expect(segmentLength({ start: 4, end: 9 })).toBe(5);
  });
});

describe("겹침과 순서 뒤바뀜은 고치는 대신 알아본다", () => {
  it("맞닿기만 한 구간은 겹침이 아니다", () => {
    expect(hasOverlap([seg(1, 0, 10), seg(2, 10, 20)])).toBe(false);
  });

  it("1초라도 겹치면 겹침이다", () => {
    expect(hasOverlap([seg(1, 0, 10), seg(2, 9, 20)])).toBe(true);
  });

  it("완전히 포함된 구간도 겹침이다", () => {
    expect(hasOverlap([seg(1, 0, 30), seg(2, 10, 12)])).toBe(true);
  });

  it("목록 순서가 뒤죽박죽이어도 겹침 판정은 같다", () => {
    expect(hasOverlap([seg(1, 9, 20), seg(2, 0, 10)])).toBe(true);
  });

  it("구간 하나·0개는 겹치지 않는다", () => {
    expect(hasOverlap([])).toBe(false);
    expect(hasOverlap([seg(1, 0, 10)])).toBe(false);
  });

  it("시작 시각이 오름차순이면 순서 뒤바뀜이 아니다", () => {
    expect(isOutOfOrder([seg(1, 0, 10), seg(2, 20, 30)])).toBe(false);
  });

  it("뒤 대목을 앞에 놓으면 순서 뒤바뀜이다 — 막지 않고 표시만 한다", () => {
    expect(isOutOfOrder([seg(1, 20, 30), seg(2, 0, 10)])).toBe(true);
  });

  it("시작이 같은 두 구간은 순서 뒤바뀜이 아니다", () => {
    expect(isOutOfOrder([seg(1, 5, 10), seg(2, 5, 20)])).toBe(false);
  });

  it("같은 구간을 두 번 넣으면 겹침이다", () => {
    expect(hasOverlap([seg(1, 3, 8), seg(2, 3, 8)])).toBe(true);
  });

  it("구간 셋 중 맨 앞과 맨 뒤만 겹쳐도 겹침이다", () => {
    expect(hasOverlap([seg(1, 0, 40), seg(2, 45, 50), seg(3, 30, 35)])).toBe(true);
  });

  it("판정 함수는 받은 목록을 정렬해 두지 않는다", () => {
    const list = [seg(1, 20, 30), seg(2, 0, 10)];
    hasOverlap(list);
    expect(list.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("총 길이와 진행률 가중치", () => {
  it("총 길이는 구간 길이의 합이다", () => {
    expect(totalLength([seg(1, 0, 10), seg(2, 30, 35)])).toBe(15);
  });

  it("겹친 부분은 결과에 두 번 나오므로 두 번 센다", () => {
    expect(totalLength([seg(1, 0, 10), seg(2, 5, 15)])).toBe(20);
  });

  it("가중치의 합은 1이다", () => {
    const w = segmentWeights([seg(1, 0, 10), seg(2, 30, 35), seg(3, 40, 45)]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("가중치는 길이에 비례한다 — 10초와 5초는 2:1", () => {
    expect(segmentWeights([seg(1, 0, 10), seg(2, 30, 35)])).toEqual([2 / 3, 1 / 3]);
  });

  it("구간 하나면 가중치도 하나고 값은 1이다", () => {
    expect(segmentWeights([seg(1, 0, 10)])).toEqual([1]);
  });

  it("구간 0개면 가중치도 0개다", () => {
    expect(segmentWeights([])).toEqual([]);
  });

  it("총 길이가 0이면 균등 분배로 합 1을 지킨다", () => {
    const w = segmentWeights([seg(1, 5, 5), seg(2, 9, 9)]);
    expect(w).toEqual([0.5, 0.5]);
    expect(w.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("진행률은 앞 구간의 가중치를 다 더한 자리에서 이어진다 — 구간이 바뀌어도 안 튄다", () => {
    const w = segmentWeights([seg(1, 0, 10), seg(2, 30, 35)]);
    // 첫 구간 끝(2/3)과 둘째 구간 시작(2/3)이 같은 값이다.
    expect(overallProgress(w, 0, 1)).toBeCloseTo(2 / 3, 12);
    expect(overallProgress(w, 1, 0)).toBeCloseTo(2 / 3, 12);
    expect(overallProgress(w, 1, 1)).toBeCloseTo(1, 12);
  });

  it("진행률은 0~1 밖으로 나가지 않는다", () => {
    const w = segmentWeights([seg(1, 0, 10), seg(2, 30, 35)]);
    expect(overallProgress(w, 0, -3)).toBe(0);
    expect(overallProgress(w, 1, 9)).toBeCloseTo(1, 12);
    expect(overallProgress(w, 7, 1)).toBeCloseTo(1, 12);
  });
});

describe("빈 자리 계산과 새 구간 자리", () => {
  it("겹치거나 맞닿은 구간은 하나로 합쳐 본다", () => {
    expect(mergeIntervals([seg(1, 0, 10), seg(2, 10, 20), seg(3, 5, 7)])).toEqual([
      { start: 0, end: 20 },
    ]);
  });

  it("빈 자리는 구간 사이와 끝에 남는 곳이다", () => {
    expect(freeIntervals([seg(1, 10, 20), seg(2, 30, 40)], 60)).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
      { start: 40, end: 60 },
    ]);
  });

  it("전체를 덮으면 빈 자리가 없다", () => {
    expect(freeIntervals([seg(1, 0, 60)], 60)).toEqual([]);
  });

  it("재생 위치가 든 빈 자리를 먼저 고른다", () => {
    const slot = nextSegmentSlot([seg(1, 0, 10), seg(2, 50, 60)], 60, 25);
    expect(slot).toEqual({ start: 10, end: 50 });
  });

  it("재생 위치가 덮인 자리면 가장 긴 빈 자리를 고른다", () => {
    const slot = nextSegmentSlot([seg(1, 0, 10), seg(2, 12, 40)], 60, 5);
    expect(slot).toEqual({ start: 40, end: 60 });
  });

  it("빈 자리가 없으면 재생 위치에서 기본 길이만큼 잡는다 — 겹쳐도 된다", () => {
    const slot = nextSegmentSlot([seg(1, 0, 60)], 60, 20);
    expect(slot).toEqual({ start: 20, end: 20 + DEFAULT_SEGMENT_S });
  });

  it("영상이 최소 길이보다 짧으면 놓을 자리가 없다", () => {
    expect(nextSegmentSlot([], 0.05, 0)).toBeNull();
  });

  it("구간이 0개면 영상 전체가 자리다", () => {
    expect(nextSegmentSlot([], 60, 0)).toEqual({ start: 0, end: 60 });
  });

  it("최소 길이보다 짧은 빈 자리는 고르지 않는다", () => {
    // 0~10과 10.05~60 사이의 0.05초는 구간이 될 수 없다 — 남은 자리가 없는 것으로 본다.
    const slot = nextSegmentSlot([seg(1, 0, 10), seg(2, 10.05, 60)], 60, 10.02);
    expect(slot).toEqual({ start: 10.02, end: 15.02 });
  });

  it("빈 자리가 없고 재생 위치가 끝에 붙어 있으면 최소 길이만큼은 확보한다", () => {
    const slot = nextSegmentSlot([seg(1, 0, 3)], 3, 3);
    expect(slot).not.toBeNull();
    expect(slot!.end - slot!.start).toBeGreaterThanOrEqual(MIN_SEGMENT_S);
    expect(slot!.end).toBeLessThanOrEqual(3);
  });

  it("영상 길이를 넘어선 구간이 있어도 빈 자리는 영상 안에서만 나온다", () => {
    expect(freeIntervals([seg(1, 50, 120)], 60)).toEqual([{ start: 0, end: 50 }]);
  });

  it("빈 자리 계산은 받은 목록을 고치지 않는다", () => {
    const list = [seg(1, 10, 20), seg(2, 5, 30)];
    freeIntervals(list, 60);
    expect(list).toEqual([seg(1, 10, 20), seg(2, 5, 30)]);
  });

  it("구간이 0개면 영상 전체가 빈 자리다", () => {
    expect(freeIntervals([], 60)).toEqual([{ start: 0, end: 60 }]);
  });
});

describe("목록 순서 바꾸기", () => {
  const list = [seg(1, 0, 10), seg(2, 20, 30), seg(3, 40, 50)];

  it("가운데 것을 맨 앞으로 옮긴다", () => {
    expect(moveSegment(list, 1, 0).map((s) => s.id)).toEqual([2, 1, 3]);
  });

  it("맨 앞을 맨 뒤로 옮긴다", () => {
    expect(moveSegment(list, 0, 2).map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it("범위 밖이면 목록이 그대로다", () => {
    expect(moveSegment(list, 0, -1).map((s) => s.id)).toEqual([1, 2, 3]);
    expect(moveSegment(list, 3, 0).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("원본 배열을 고치지 않는다", () => {
    moveSegment(list, 0, 2);
    expect(list.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("제자리로 옮기면 목록이 그대로다", () => {
    expect(moveSegment(list, 1, 1).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("한 칸씩 옮기면 이웃과 자리를 바꾼다 — 화면의 앞으로·뒤로 버튼이 이것이다", () => {
    expect(moveSegment(list, 2, 1).map((s) => s.id)).toEqual([1, 3, 2]);
    expect(moveSegment(list, 0, 1).map((s) => s.id)).toEqual([2, 1, 3]);
  });

  it("구간이 하나면 옮길 곳이 없다", () => {
    expect(moveSegment([seg(1, 0, 10)], 0, 0).map((s) => s.id)).toEqual([1]);
  });
});

describe("무손실 이어붙이기 판정", () => {
  const keyframes = [0, 2, 4, 6, 8];
  const base = {
    keyframes,
    videoCodecFits: true,
    audioCodecFits: true,
    rotationBreaksCopy: false,
  };

  it("모든 구간이 키프레임에서 시작하면 복사한다", () => {
    const r = checkLosslessConcat({
      ...base,
      segments: [seg(1, 0, 2), seg(2, 4, 6)],
    });
    expect(r).toEqual({ copies: true, misaligned: [] });
  });

  it("키프레임이 아닌 자리에서 시작한 구간의 인덱스를 돌려준다", () => {
    const r = checkLosslessConcat({
      ...base,
      segments: [seg(1, 0, 2), seg(2, 3, 6), seg(3, 4, 8)],
    });
    expect(r).toEqual({ copies: false, misaligned: [1] });
  });

  it("끝은 키프레임이 아니어도 된다 — 마지막 GOP를 조금 더 담을 뿐이다", () => {
    const r = checkLosslessConcat({ ...base, segments: [seg(1, 2, 5.3)] });
    expect(r.copies).toBe(true);
  });

  it("오차 안이면 키프레임에 맞은 것으로 본다", () => {
    expect(isKeyframeAligned(2 + 1e-7, keyframes)).toBe(true);
    expect(isKeyframeAligned(2 + 1e-5, keyframes)).toBe(false);
  });

  it("오차 경계값은 맞은 쪽에 넣는다", () => {
    expect(isKeyframeAligned(2.01, keyframes, 0.01)).toBe(true);
    expect(isKeyframeAligned(2.011, keyframes, 0.01)).toBe(false);
  });

  it("컨테이너가 비디오 코덱을 못 담으면 복사하지 않는다", () => {
    const r = checkLosslessConcat({
      ...base,
      videoCodecFits: false,
      segments: [seg(1, 0, 2)],
    });
    expect(r).toEqual({ copies: false, misaligned: [] });
  });

  it("컨테이너가 오디오 코덱을 못 담으면 복사하지 않는다", () => {
    const r = checkLosslessConcat({
      ...base,
      audioCodecFits: false,
      segments: [seg(1, 0, 2)],
    });
    expect(r.copies).toBe(false);
  });

  it("회전이 복사를 깨면 복사하지 않는다 — WebM은 회전 메타데이터를 안 쓴다", () => {
    const r = checkLosslessConcat({
      ...base,
      rotationBreaksCopy: true,
      segments: [seg(1, 0, 2)],
    });
    expect(r.copies).toBe(false);
  });

  it("키프레임 목록이 비면 판정하지 않고 복사를 포기한다 — 스캔이 실패했거나 아직 도는 중", () => {
    const r = checkLosslessConcat({
      ...base,
      keyframes: [],
      segments: [seg(1, 0, 2)],
    });
    expect(r).toEqual({ copies: false, misaligned: [] });
  });

  it("구간이 0개면 복사할 것이 없다", () => {
    expect(checkLosslessConcat({ ...base, segments: [] }).copies).toBe(false);
  });

  it("어긋난 구간이 여럿이면 인덱스를 목록 순서대로 다 돌려준다", () => {
    const r = checkLosslessConcat({
      ...base,
      segments: [seg(1, 1, 2), seg(2, 4, 6), seg(3, 7, 8)],
    });
    expect(r.misaligned).toEqual([0, 2]);
  });

  it("첫 키프레임보다 앞에서 시작하면 어긋난 것으로 본다", () => {
    const r = checkLosslessConcat({
      ...base,
      keyframes: [2, 4, 6],
      segments: [seg(1, 0, 3)],
    });
    expect(r).toEqual({ copies: false, misaligned: [0] });
  });

  it("복사를 막는 조건이 여럿이면 어긋난 인덱스는 그대로 두고 복사만 끈다", () => {
    // 화면이 사유를 가려 쓸 수 있어야 한다 — 키프레임 어긋남과 코덱 불일치는 다른 배지다.
    const r = checkLosslessConcat({
      ...base,
      videoCodecFits: false,
      segments: [seg(1, 0, 2), seg(2, 3, 5)],
    });
    expect(r).toEqual({ copies: false, misaligned: [1] });
  });
});

describe("복사 판정에 함께 걸리는 회전·시작 자르기", () => {
  it("파일에 적힌 회전과 사용자가 더한 회전을 합친다", () => {
    expect(combineRotation(0, 0)).toBe(0);
    expect(combineRotation(90, 90)).toBe(180);
    expect(combineRotation(270, 180)).toBe(90);
    expect(combineRotation(270, 90)).toBe(0);
  });

  it("합이 0이면 회전이 없는 것과 같다 — 세로 영상을 되돌려 놓은 경우다", () => {
    expect(rotationBreaksCopy(combineRotation(90, 270), "webm")).toBe(false);
  });

  it("MP4는 회전을 메타데이터로 실어 복사를 지킨다", () => {
    expect(rotationBreaksCopy(90, "mp4")).toBe(false);
    expect(rotationBreaksCopy(180, "mp4")).toBe(false);
  });

  it("WebM은 회전 메타데이터를 안 써서 0이 아니면 복사가 깨진다", () => {
    expect(rotationBreaksCopy(0, "webm")).toBe(false);
    expect(rotationBreaksCopy(90, "webm")).toBe(true);
    expect(rotationBreaksCopy(180, "webm")).toBe(true);
    expect(rotationBreaksCopy(270, "webm")).toBe(true);
  });

  it("세로로 찍은 원본은 사용자가 회전을 안 걸어도 WebM에서 복사가 깨진다", () => {
    expect(rotationBreaksCopy(combineRotation(90, 0), "webm")).toBe(true);
  });

  it("시작을 조금이라도 자르면 Conversion이 패킷 복사를 끈다", () => {
    expect(trimStartBreaksCopy(0)).toBe(false);
    expect(trimStartBreaksCopy(0.5)).toBe(true);
    expect(trimStartBreaksCopy(1e-9)).toBe(false); // 오차 안은 안 자른 것으로 본다
  });

  it("원본의 첫 패킷이 0이 아니면 그 자리까지는 자른 것이 아니다", () => {
    expect(trimStartBreaksCopy(1.5, 1.5)).toBe(false);
    expect(trimStartBreaksCopy(1.6, 1.5)).toBe(true);
  });
});
