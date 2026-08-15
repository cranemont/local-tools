// 구간 목록 — 자를 곳이 여러 개일 때의 계산. DOM·mediabunny 없이 돈다.
//
// 규약: 목록 순서가 곧 이어붙이는 순서다. 겹치는 구간도, 시작 시각이 뒤바뀐 순서도
// 고치지 않고 그대로 둔다 — 강의 영상에서 뒤 대목을 앞에 놓거나 같은 대목을 두 번 쓰는 것이
// 정당한 편집이라서다. 대신 겹침·순서 뒤바뀜을 알아보는 함수를 따로 두어 화면이 배지로 알린다.
// 정규화가 하는 일은 기계적으로 필요한 것뿐이다 — 경계 clamp, 뒤집힌 start/end 교환,
// 최소 길이 미만 제거.

/** 시간축의 반열린 구간 [start, end). */
export interface Interval {
  start: number;
  end: number;
}

/** 구간 하나. id는 목록 조작(삭제·순서 바꾸기)에서 항목을 따라가는 데 쓴다. */
export interface Segment extends Interval {
  id: number;
}

/** 구간 하나의 최소 길이(초). 이보다 짧으면 정규화가 버린다. */
export const MIN_SEGMENT_S = 0.1;
/** 빈 자리가 없을 때 새 구간에 주는 기본 길이(초). */
export const DEFAULT_SEGMENT_S = 5;

/** 부동소수점 비교 여유. */
const EPS = 1e-9;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function segmentLength(seg: Interval): number {
  return Math.max(0, seg.end - seg.start);
}

/**
 * 경계 clamp + 뒤집힌 start/end 교환 + 최소 길이 미만 제거. 목록 순서는 그대로 둔다.
 * NaN은 clamp에서 걸러지지 않으므로 길이 비교에서 탈락한다.
 */
export function normalizeSegments(
  list: readonly Segment[],
  durationS: number,
  minLength = MIN_SEGMENT_S,
): Segment[] {
  const limit = Math.max(0, durationS) || 0;
  const out: Segment[] = [];
  for (const seg of list) {
    const lo = Math.min(seg.start, seg.end);
    const hi = Math.max(seg.start, seg.end);
    const start = clamp(lo, 0, limit);
    const end = clamp(hi, 0, limit);
    if (!(end - start >= minLength - EPS)) continue;
    out.push({ id: seg.id, start, end });
  }
  return out;
}

/** 내보낼 총 길이(초). 겹친 구간은 결과에서 두 번 나오므로 두 번 센다. */
export function totalLength(list: readonly Interval[]): number {
  let sum = 0;
  for (const seg of list) sum += segmentLength(seg);
  return sum;
}

/**
 * 구간별 진행률 가중치 — 합이 1이다. 길이에 비례하므로 구간 하나가 끝나도 진행률이 튀지 않는다.
 * 총 길이가 0이면 균등 분배한다(합 1을 지키려는 것).
 */
export function segmentWeights(list: readonly Interval[]): number[] {
  if (list.length === 0) return [];
  const total = totalLength(list);
  if (total <= 0) return list.map(() => 1 / list.length);
  return list.map((seg) => segmentLength(seg) / total);
}

/** 지금 index번째 구간을 fraction만큼 처리했을 때의 전체 진행률(0~1). */
export function overallProgress(
  weights: readonly number[],
  index: number,
  fraction: number,
): number {
  let done = 0;
  for (let i = 0; i < index && i < weights.length; i++) done += weights[i];
  const here = weights[index] ?? 0;
  return clamp(done + here * clamp(fraction, 0, 1), 0, 1);
}

/** 겹치는 구간 쌍이 있는가. 맞닿기만 한 것(앞의 end === 뒤의 start)은 겹침이 아니다. */
export function hasOverlap(list: readonly Interval[]): boolean {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end - EPS) return true;
  }
  return false;
}

/** 목록 순서가 시작 시각 순서와 다른가. */
export function isOutOfOrder(list: readonly Interval[]): boolean {
  for (let i = 1; i < list.length; i++) {
    if (list[i].start < list[i - 1].start - EPS) return true;
  }
  return false;
}

/** 겹치거나 맞닿은 구간을 합친 목록 — 시작 시각 순. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list]
    .map((seg) => ({ start: seg.start, end: seg.end }))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const seg of sorted) {
    const last = out[out.length - 1];
    if (last && seg.start <= last.end + EPS) last.end = Math.max(last.end, seg.end);
    else out.push({ ...seg });
  }
  return out;
}

/** 어느 구간에도 안 덮인 자리 — 타임라인의 흐린 칸이 여기서 나온다. */
export function freeIntervals(
  list: readonly Interval[],
  durationS: number,
): Interval[] {
  const limit = Math.max(0, durationS);
  const out: Interval[] = [];
  let cursor = 0;
  for (const seg of mergeIntervals(list)) {
    const start = clamp(seg.start, 0, limit);
    const end = clamp(seg.end, 0, limit);
    if (start > cursor + EPS) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < limit - EPS) out.push({ start: cursor, end: limit });
  return out;
}

/**
 * "구간 추가"가 놓을 자리. 재생 위치가 든 빈 칸을 먼저 보고, 없으면 가장 긴 빈 칸을 쓴다.
 * 빈 칸이 하나도 없으면 재생 위치에서 기본 길이만큼 잡는다 — 겹쳐도 목록 순서대로 잇는다.
 */
export function nextSegmentSlot(
  list: readonly Interval[],
  durationS: number,
  atS: number,
  minLength = MIN_SEGMENT_S,
): Interval | null {
  const limit = Math.max(0, durationS);
  if (limit < minLength - EPS) return null;
  const at = clamp(atS, 0, limit);
  const gaps = freeIntervals(list, limit).filter(
    (g) => g.end - g.start >= minLength - EPS,
  );
  const here = gaps.find((g) => at >= g.start - EPS && at < g.end + EPS);
  if (here) return { ...here };
  let longest: Interval | null = null;
  for (const g of gaps) {
    if (!longest || g.end - g.start > longest.end - longest.start) longest = g;
  }
  if (longest) return { ...longest };
  const start = clamp(at, 0, limit - minLength);
  return { start, end: Math.min(limit, start + DEFAULT_SEGMENT_S) };
}

/**
 * 무손실 스냅이 시작을 앞으로 옮길 때 넘지 말아야 할 자리(초). 아무도 안 덮고 있으면
 * 0이다 — 파일 시작까지 내려갈 수 있다는 뜻이다.
 *
 * 겹침을 고치지 않는다는 첫머리 규약은 **사용자가 만든 겹침** 이야기다. 스냅이 시작을 남의
 * 구간 안으로 밀어 넣으면 그 대목이 결과에 두 번 들어가는데, 사용자는 그 자리를 고른 적이
 * 없다. 그래서 한계는 `startS` 앞을 이미 덮고 있는 구간이 끝나는 자리다. 이미 겹쳐 있는
 * 자리라면(다른 구간이 `startS`를 걸치고 있다) 한계가 `startS` 자신이 되어 스냅이 걸리지
 * 않는다 — 있는 겹침을 넓히지도 않는다.
 *
 * `skipIndex`는 지금 옮기는 구간 자신이다. 자기 자신은 언제나 `startS` 뒤를 덮으므로
 * 세면 어떤 값도 못 내려가 스냅이 걸리지 않는다.
 */
export function snapFloor(
  list: readonly Interval[],
  startS: number,
  skipIndex = -1,
): number {
  let floor = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === skipIndex) continue;
    const seg = list[i];
    if (seg.start >= startS - EPS) continue;
    const covered = Math.min(seg.end, startS);
    if (covered > floor) floor = covered;
  }
  return floor;
}

/** 목록에서 from을 to 자리로 옮긴 새 배열. 범위를 벗어나면 그대로 돌려준다. */
export function moveSegment(
  list: readonly Segment[],
  from: number,
  to: number,
): Segment[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
    return [...list];
  }
  const out = [...list];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * 무손실(패킷 복사)로 이어붙일 수 있는지.
 *
 * 코덱 파라미터는 볼 필요가 없다 — 구간이 전부 같은 파일의 같은 트랙에서 나오므로
 * 언제나 같다. 실제로 걸리는 것은 셋이다: 컨테이너가 그 코덱을 담는가, 회전이 복사를
 * 깨지 않는가(CLAUDE.md 25번), 그리고 구간마다 시작이 키프레임인가.
 * 키프레임이 아닌 자리에서 시작하면 그 구간 앞부분이 참조 프레임 없이 디코딩된다.
 */
export interface LosslessConcatInput {
  segments: readonly Interval[];
  /** 원본 비디오 트랙의 키프레임 시각(초). 비어 있으면 판정하지 않고 복사를 포기한다. */
  keyframes: readonly number[];
  /** 원본 비디오 코덱을 고른 컨테이너에 담을 수 있는가. */
  videoCodecFits: boolean;
  /** 소리를 담는데 그 코덱을 컨테이너가 담을 수 있는가(소리를 안 담으면 true). */
  audioCodecFits: boolean;
  /** 회전이 패킷 복사를 깨는가. */
  rotationBreaksCopy: boolean;
  /** 키프레임 일치로 볼 오차(초). */
  toleranceS?: number;
}

export interface LosslessConcatCheck {
  /** 패킷 복사로 끝나는가. false면 재인코딩된다. */
  copies: boolean;
  /** 시작이 키프레임에 안 맞는 구간의 목록 인덱스. */
  misaligned: number[];
}

/** 값 하나가 키프레임 목록의 어느 시각과 tol 안에서 같은가. */
export function isKeyframeAligned(
  startS: number,
  keyframes: readonly number[],
  toleranceS = 1e-6,
): boolean {
  for (const k of keyframes) {
    if (Math.abs(k - startS) <= toleranceS) return true;
  }
  return false;
}

export function checkLosslessConcat(input: LosslessConcatInput): LosslessConcatCheck {
  const tol = input.toleranceS ?? 1e-6;
  const misaligned: number[] = [];
  if (input.keyframes.length > 0) {
    input.segments.forEach((seg, i) => {
      if (!isKeyframeAligned(seg.start, input.keyframes, tol)) misaligned.push(i);
    });
  }
  const copies =
    input.segments.length > 0 &&
    input.keyframes.length > 0 &&
    input.videoCodecFits &&
    input.audioCodecFits &&
    !input.rotationBreaksCopy &&
    misaligned.length === 0;
  return { copies, misaligned };
}
