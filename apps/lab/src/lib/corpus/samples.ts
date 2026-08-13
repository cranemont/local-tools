// 한국어 프로브 — 영어권 리더보드가 절대 답해 주지 않는 것들.
//
// 구조가 요점이다. 뭉뚱그린 문장 더미가 아니라 **같은 뜻의 짝**을 현상별로 묶었다.
// 그래서 "이 모델이 좋은가" 대신 훨씬 날카로운 질문을 물을 수 있다 —
// *내 짝이 내 1순위 이웃인가?* 짝짓기 정확도가 현상별로 갈리는 지점이
// 다국어 모델과 한국어 튜닝 모델의 차이가 실제로 드러나는 곳이다.
//
// 짧은 단어는 일부러 피했다. 두세 어절짜리 텍스트는 임베딩이 불안정해서
// 모델이 아니라 길이를 재게 된다.

export type ProbeKind = "register" | "spacing" | "sino" | "typo" | "english" | "control";

export interface ProbeGroup {
  kind: ProbeKind;
  label: string;
  /** 이 묶음이 묻는 것 */
  question: string;
}

export const PROBE_GROUPS: ProbeGroup[] = [
  {
    kind: "register",
    label: "존댓말·반말",
    question: "말투가 바뀌어도 같은 뜻으로 묶이는가",
  },
  {
    kind: "spacing",
    label: "띄어쓰기",
    question: "띄어쓰기가 흔들려도 같은 문장으로 보는가",
  },
  {
    kind: "sino",
    label: "한자어·고유어",
    question: "한자어와 순우리말이 같은 개념으로 만나는가",
  },
  {
    kind: "typo",
    label: "오타",
    question: "자모가 어긋난 오타를 원래 문장 옆에 두는가",
  },
  {
    kind: "english",
    label: "영어 혼용",
    question: "외래어·영어·번역어를 한 덩어리로 보는가",
  },
  {
    kind: "control",
    label: "대조군",
    question: "짝이 없는 문장 — 아무하고나 붙으면 안 된다",
  },
];

export interface Probe {
  id: string;
  kind: ProbeKind;
  /** 같은 뜻의 다른 표현들. 대조군은 하나뿐이라 짝이 없다. */
  variants: string[];
}

export const PROBES: Probe[] = [
  // ── 존댓말·반말 ────────────────────────────────────────────
  { id: "reg1", kind: "register", variants: ["밥 먹었어?", "식사는 하셨습니까?"] },
  {
    id: "reg2",
    kind: "register",
    variants: ["이거 얼마야?", "이 제품 가격이 어떻게 되나요?"],
  },
  {
    id: "reg3",
    kind: "register",
    variants: ["지금 어디 가?", "지금 어디로 가시는 중이신가요?"],
  },
  {
    id: "reg4",
    kind: "register",
    variants: ["빨리 좀 와 줘", "가능한 한 빨리 와 주시기 바랍니다"],
  },

  // ── 띄어쓰기 ──────────────────────────────────────────────
  {
    id: "spc1",
    kind: "spacing",
    variants: ["마당에 사과나무를 심었다", "마당에 사과 나무를 심었다"],
  },
  {
    id: "spc2",
    kind: "spacing",
    variants: ["혼자서도 충분히 할수있다", "혼자서도 충분히 할 수 있다"],
  },
  {
    id: "spc3",
    kind: "spacing",
    variants: ["여기서 담배를 피우면 안돼요", "여기서 담배를 피우면 안 돼요"],
  },
  {
    id: "spc4",
    kind: "spacing",
    variants: ["결과는 그때그때 다르게 나온다", "결과는 그 때 그 때 다르게 나온다"],
  },

  // ── 한자어·고유어 ──────────────────────────────────────────
  {
    id: "sin1",
    kind: "sino",
    variants: ["어금니가 아파서 치과에 다녀왔다", "어금니가 아파서 이빨 고치는 병원에 다녀왔다"],
  },
  {
    id: "sin2",
    kind: "sino",
    variants: ["출근길에 차량이 정체되었다", "출근길에 차가 꽉 막혔다"],
  },
  {
    id: "sin3",
    kind: "sino",
    variants: ["이번 주 강수량이 매우 많았다", "이번 주에 비가 아주 많이 내렸다"],
  },
  {
    id: "sin4",
    kind: "sino",
    variants: ["회의 개시 시각을 변경했다", "모임 시작하는 때를 바꿨다"],
  },

  // ── 오타 ──────────────────────────────────────────────────
  {
    id: "typ1",
    kind: "typo",
    variants: ["안녕하세요 만나서 반갑습니다", "안뇽하세요 만나서 방갑습니다"],
  },
  {
    id: "typ2",
    kind: "typo",
    variants: ["회의는 내일 오후 세 시입니다", "회읨는 내일 오후 세 시입니다"],
  },
  {
    id: "typ3",
    kind: "typo",
    variants: ["도와주셔서 정말 감사합니다", "도와주셔서 정말 감사함니다"],
  },
  {
    id: "typ4",
    kind: "typo",
    variants: ["말씀하신 내용이 맞습니다", "말씀하신 내용이 마즙니다"],
  },

  // ── 영어 혼용 ──────────────────────────────────────────────
  {
    id: "eng1",
    kind: "english",
    variants: [
      "머신러닝 모델을 새로 학습시켰다",
      "machine learning 모델을 새로 학습시켰다",
      "기계학습 모델을 새로 학습시켰다",
    ],
  },
  {
    id: "eng2",
    kind: "english",
    variants: ["이 앱은 다크 모드를 지원한다", "이 앱은 dark mode를 지원한다"],
  },
  {
    id: "eng3",
    kind: "english",
    variants: ["첨부 파일을 다운로드했다", "첨부 파일을 download 했다", "첨부 파일을 내려받았다"],
  },

  // ── 대조군 — 짝이 없다 ─────────────────────────────────────
  { id: "ctl1", kind: "control", variants: ["오늘 주식 시장이 크게 하락했다"] },
  { id: "ctl2", kind: "control", variants: ["고양이가 창가에서 낮잠을 자고 있다"] },
  { id: "ctl3", kind: "control", variants: ["이 다리는 1988년에 완공되었다"] },
  { id: "ctl4", kind: "control", variants: ["헌법 개정은 국민투표를 거쳐야 한다"] },
  { id: "ctl5", kind: "control", variants: ["빙하는 해마다 조금씩 후퇴하고 있다"] },
  { id: "ctl6", kind: "control", variants: ["그 소설의 결말은 오랫동안 논쟁거리였다"] },
];

export interface CorpusItem {
  text: string;
  /** 같은 짝끼리 공유하는 값. 사용자가 직접 넣은 문장은 null(정답이 없다). */
  probeId: string | null;
  kind: ProbeKind | null;
  /** 짝 안에서 몇 번째 표현인가 — 목록에 ①②③으로 표시 */
  variantIndex: number;
}

export function probeCorpus(): CorpusItem[] {
  const items: CorpusItem[] = [];
  for (const probe of PROBES) {
    probe.variants.forEach((text, variantIndex) => {
      items.push({ text, probeId: probe.id, kind: probe.kind, variantIndex });
    });
  }
  return items;
}

/** 사용자가 붙여넣은 줄들 — 정답 짝이 없으므로 짝짓기 채점에서 빠진다. */
export function pastedCorpus(raw: string): CorpusItem[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, probeId: null, kind: null, variantIndex: 0 }));
}

export function groupLabel(kind: ProbeKind): string {
  return PROBE_GROUPS.find((g) => g.kind === kind)?.label ?? kind;
}
