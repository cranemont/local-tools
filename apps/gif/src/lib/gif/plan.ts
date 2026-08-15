// 인코딩이 시작되는 순간의 상태를 굳히는 자리 — 캔버스도 DOM도 만지지 않는다.
//
// 네 인코더(gif·webp·mp4·png)는 프레임 하나마다 await로 멈춘다(디코딩·convertToBlob·
// muxer). 그 틈에 사용자가 프레임을 고르거나 딜레이를 고치면, 살아 있는 배열을 그대로
// 넘긴 인코딩은 **앞쪽 프레임과 뒤쪽 프레임이 서로 다른 상태를 보고 그려진다** —
// 결과 파일 하나가 자기 안에서 앞뒤가 다르다.
// 그래서 시작 시점에 여기서 한 번 베껴 굳히고, 그 인코딩은 끝까지 그것만 본다.
// 입력을 잠그지 않는 이유: 인코딩은 초 단위로 걸리고 그동안 다음 편집을 막을 이유가 없다.
//
// 무엇을 베끼는가(전부 소스에서 확인한 것):
//   · 프레임 배열 — 순서·소스·딜레이·선택. 인코더가 읽는 네 칸이 전부다(id·썸네일은 안 읽는다).
//   · 오버레이 — 칸이 전부 원시값이라 얕은 복사로 끊긴다.
//   · 변형 — crop만 중첩이라 그것도 새 객체로 뜬다.
//   · 소스 표 — **바이트는 복사하지 않는다.** FrameSource.bytes는 임포트 뒤 아무도 고치지
//     않는 읽기 전용이고, 프레임 한 장이 수 MB다. 위험한 것은 바이트가 바뀌는 게 아니라
//     인코딩 도중 표에서 **항목이 빠지는 것**(#pruneSources)이라, 표만 새로 뜨면 닫힌다.
//   · 형식·화질·배속·반복은 여기 없다 — 부르는 쪽이 이미 값으로 넘긴다(EncodeOptions).

import type { TextOverlay } from "./overlay";
import type { FrameSource, Transform } from "./types";

/** 인코더가 프레임에서 실제로 읽는 것 — Frame이 이 모양을 포함한다. */
export interface PlannedFrame {
  sourceId: string;
  frameIndex: number;
  /** 표시 시간(ms). 배속과 무관한 원본 값. */
  delayMs: number;
  /** "선택한 프레임만" 오버레이가 이 프레임에 얹히는지를 가른다. */
  selected: boolean;
}

/** 인코딩·추출이 공유하는 렌더 입력. 굳은 값이라 전부 readonly다. */
export interface RenderPlan {
  frames: readonly PlannedFrame[];
  sources: ReadonlyMap<string, FrameSource>;
  transform: Transform;
  /** 프레임 위에 얹을 텍스트 — 어느 프레임에 붙는지는 renderFrame이 고른다. */
  overlays: readonly TextOverlay[];
  baseW: number;
  baseH: number;
  /** 중단 신호 — 네 인코더가 프레임 루프 머리에서 함께 확인한다. */
  signal?: AbortSignal;
}

/** 살아 있는 에디터 상태 — 이 모양 그대로 들어와 굳은 계획으로 나간다. */
export interface PlanInput {
  frames: readonly PlannedFrame[];
  sources: ReadonlyMap<string, FrameSource>;
  transform: Transform;
  overlays: readonly TextOverlay[];
  baseW: number;
  baseH: number;
  signal?: AbortSignal;
}

/**
 * 지금 상태를 인코딩 한 번짜리 계획으로 굳힌다.
 * 여기서 나온 값은 에디터 쪽 배열·객체와 어떤 참조도 공유하지 않는다(소스 바이트만 예외).
 */
export function snapshotPlan(input: PlanInput): RenderPlan {
  const frames: PlannedFrame[] = input.frames.map((f) => ({
    sourceId: f.sourceId,
    frameIndex: f.frameIndex,
    delayMs: f.delayMs,
    selected: f.selected,
  }));

  // 이 계획이 실제로 지나는 소스만 들고 간다. 인코딩 도중 소스가 정리돼도(되돌리기 스택에서
  // 밀려나거나 모두 비우기) 이 인코딩은 자기 소스를 계속 본다.
  const sources = new Map<string, FrameSource>();
  for (const f of frames) {
    if (sources.has(f.sourceId)) continue;
    const s = input.sources.get(f.sourceId);
    if (s) sources.set(f.sourceId, s);
  }

  const tf = input.transform;
  return {
    frames,
    sources,
    transform: {
      crop: tf.crop ? { ...tf.crop } : null,
      rotation: tf.rotation,
      flipH: tf.flipH,
      flipV: tf.flipV,
      scale: tf.scale,
    },
    // 오버레이의 칸은 전부 원시값이라 한 겹만 베끼면 끊긴다.
    overlays: input.overlays.map((o) => ({ ...o })),
    baseW: input.baseW,
    baseH: input.baseH,
    signal: input.signal,
  };
}
