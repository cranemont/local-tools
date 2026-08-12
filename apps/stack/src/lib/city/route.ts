// 파이프라인 → 도시 안의 실제 경로.
//
// 경로를 따로 적지 않는다. 각 단계에 이미 소스 파일이 달려 있고, 건물은 그 파일을
// 가진 기능이므로, "이 단계가 어느 건물에서 벌어지는가"는 데이터에서 유도된다.
// 설명과 지형이 어긋날 여지를 없애려는 것이다.

import { FEATURES, FEATURE_BY_ID, TECH_BY_ID } from "../data/stack";
import { PIPELINES, PIPELINE_BY_ID, type Step } from "../data/pipelines";

export interface RouteStop {
  step: Step;
  index: number;
  /** 이 단계가 벌어지는 건물(=기능 id). 못 찾으면 null → 구역 중심으로 간다. */
  buildingId: string | null;
  /** 성문 밖으로 나가야 하는 단계면 그 창고(=기술 id) */
  outpostId: string | null;
}

export function routeFor(pipelineId: string): RouteStop[] {
  const pipeline = PIPELINE_BY_ID.get(pipelineId);
  if (!pipeline) return [];

  const owner = FEATURES.find((feat) => feat.pipeline === pipelineId);
  const ownerApp = owner?.app;

  const stops: RouteStop[] = [];
  pipeline.steps.forEach((step, index) => {
    let buildingId: string | null = null;
    if (step.feat) {
      // 손으로 못 박은 단계 — 한 파일을 여러 기능이 나눠 쓸 때만 쓴다.
      buildingId = FEATURE_BY_ID.has(step.feat) ? step.feat : null;
    } else if (step.src) {
      const holders = FEATURES.filter((feat) => feat.src.includes(step.src!));
      // 한 파일을 여러 기능이 나눠 쓰면 이 파이프라인의 주인과 같은 앱을 고른다.
      buildingId = (holders.find((f) => f.app === ownerApp) ?? holders[0])?.id ?? null;
    }

    const tech = step.tech ? TECH_BY_ID.get(step.tech) : undefined;
    // P2P는 창고가 아니라 다리다 — 옆 도시로 직행하므로 여기서 제외한다.
    const outpostId = tech?.network && tech.id !== "webrtc" ? tech.id : null;

    stops.push({ step, index, buildingId, outpostId });
  });

  return stops;
}

/**
 * 도시에 유닛이 서는 기능 — 흐름이 한 번이라도 지나는 것들.
 *
 * 나머지(개발자 유틸처럼 파일이 지나지 않는 기능)는 지형이 없다. 목록에서 그걸
 * 눌러도 카메라가 안 움직이는 게 정상이라, 목록이 미리 표시해 준다.
 */
export const FEATURES_ON_FLOW = new Set(
  PIPELINES.flatMap((pipeline) => routeFor(pipeline.id))
    .map((stop) => stop.buildingId)
    .filter((id): id is string => Boolean(id)),
);

/** 이 파이프라인이 옆 도시(P2P)로 건너가는가 */
export function usesBridge(pipelineId: string): boolean {
  const pipeline = PIPELINE_BY_ID.get(pipelineId);
  return Boolean(pipeline?.steps.some((step) => step.tech === "webrtc"));
}
