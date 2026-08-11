// 상태 싱글턴 — 필터·검색·강조·드릴다운.
//
// 강조에는 두 갈래가 있다: hover는 스쳐 지나가는 것, 클릭(pin)은 고정하는 것.
// 마우스를 떼면 hover만 풀리고 고정은 남는다 — 패널을 읽는 동안 도시가 원래대로
// 돌아가 버리면 어느 건물을 보던 건지 잃어버린다.
//
// 예전엔 여기서 이분 그래프 좌표까지 계산했다. 도시가 그 일을 대신하게 되면서
// 남은 건 "무엇이 보이고, 무엇이 검색에 걸리는가"뿐이다.

import {
  FEATURES,
  FEATURE_BY_ID,
  KIND_ORDER,
  TECHS,
  TECH_BY_ID,
  USERS_OF_TECH,
  type Feature,
  type Tech,
  type TechKind,
} from "../data/stack";

/** 검색어가 걸리는지 — 라벨·설명·소속까지 본다 */
function matches(query: string, feat?: Feature, tech?: Tech): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = feat
    ? `${feat.label} ${feat.note} ${feat.app} ${feat.techs.join(" ")}`
    : tech
      ? `${tech.label} ${tech.note} ${tech.kind} ${tech.network ?? ""} ${tech.pkg ?? ""}`
      : "";
  return hay.toLowerCase().includes(q);
}

class GraphState {
  kinds = $state<TechKind[]>([...KIND_ORDER]);
  networkOnly = $state(false);
  query = $state("");

  hovered = $state<string | null>(null);
  pinned = $state<string | null>(null);

  /** 열려 있는 파이프라인 id — 있으면 드릴다운 뷰 */
  pipelineId = $state<string | null>(null);

  /** 열려 있는 메커니즘 id — 건물 안을 펼쳐 본 상태 */
  mechId = $state<string | null>(null);

  // ── 필터를 통과한 것 ──────────────────────────────────────
  visibleTechs = $derived(
    TECHS.filter(
      (tech) => this.kinds.includes(tech.kind) && (!this.networkOnly || Boolean(tech.network)),
    ),
  );

  /** 남은 기술과 연결이 하나도 없는 기능은 지도에서 뜻이 없다 */
  visibleFeatures = $derived.by(() => {
    const ids = new Set(this.visibleTechs.map((tech) => tech.id));
    return FEATURES.filter((feat) => feat.techs.some((id) => ids.has(id)));
  });

  hiddenFeatures = $derived(FEATURES.length - this.visibleFeatures.length);
  hiddenTechs = $derived(TECHS.length - this.visibleTechs.length);

  // ── 검색까지 통과한 것 ────────────────────────────────────
  matchedFeatures = $derived(
    this.visibleFeatures.filter((feat) => matches(this.query, feat, undefined)),
  );
  matchedTechs = $derived(this.visibleTechs.filter((tech) => matches(this.query, undefined, tech)));

  /** 검색어가 없으면 null — 도시가 "필터 안 함"으로 읽는다 */
  matchSet = $derived.by(() => {
    if (!this.query.trim()) return null;
    return new Set<string>([
      ...this.matchedFeatures.map((f) => f.id),
      ...this.matchedTechs.map((t) => t.id),
    ]);
  });

  matchCount = $derived(this.matchSet?.size ?? 0);

  /** 지금 강조의 중심 — 스쳐 지나가는 쪽이 고정을 이긴다 */
  active = $derived(this.hovered ?? this.pinned);

  /** 중심 + 직접 연결된 것들. 강조가 없으면 null(= 전부 평상시) */
  activeSet = $derived.by(() => {
    const id = this.active;
    if (!id) return null;
    const set = new Set<string>([id]);
    const feat = FEATURE_BY_ID.get(id);
    if (feat) for (const techId of feat.techs) set.add(techId);
    const users = USERS_OF_TECH.get(id);
    if (users) for (const featId of users) set.add(featId);
    return set;
  });

  /** 상세 패널이 보여줄 대상 — 고정된 것만. hover로 패널이 널뛰면 읽을 수 없다. */
  detail = $derived.by(() => {
    if (!this.pinned) return null;
    const feat = FEATURE_BY_ID.get(this.pinned);
    if (feat) return { type: "feature" as const, feature: feat };
    const tech = TECH_BY_ID.get(this.pinned);
    if (tech) return { type: "tech" as const, tech };
    return null;
  });

  isFiltered = $derived(this.kinds.length !== KIND_ORDER.length || this.networkOnly);

  toggleKind(kind: TechKind) {
    this.kinds = this.kinds.includes(kind)
      ? this.kinds.filter((k) => k !== kind)
      : [...this.kinds, kind];
    this.dropInvisiblePin();
  }

  toggleNetworkOnly() {
    this.networkOnly = !this.networkOnly;
    this.dropInvisiblePin();
  }

  resetFilters() {
    this.kinds = [...KIND_ORDER];
    this.networkOnly = false;
    this.query = "";
  }

  hover(id: string | null) {
    this.hovered = id;
  }

  /** 같은 것을 다시 누르면 고정을 푼다 */
  pin(id: string) {
    this.pinned = this.pinned === id ? null : id;
  }

  clearPin() {
    this.pinned = null;
  }

  openPipeline(id: string) {
    this.pipelineId = id;
  }

  closePipeline() {
    this.pipelineId = null;
  }

  openMech(id: string) {
    this.mechId = id;
    this.hovered = null;
  }

  closeMech() {
    this.mechId = null;
  }

  /** 필터로 사라진 것이 고정된 채 남으면 상세 패널만 유령처럼 떠 있게 된다 */
  private dropInvisiblePin() {
    if (!this.pinned) return;
    const stillThere =
      this.visibleFeatures.some((f) => f.id === this.pinned) ||
      this.visibleTechs.some((t) => t.id === this.pinned);
    if (!stillThere) this.pinned = null;
  }
}

export const graph = new GraphState();
