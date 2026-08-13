// 실험 대상 모델 목록 — 이 앱이 아는 모든 모델별 특이사항을 여기 한 곳에 가둔다.
//
// 값은 전부 실물에서 확인한 것이다(HF 저장소 파일 목록의 바이트 수, 모델 카드가 지시한
// 프리픽스·풀링). 눈대중으로 적지 말 것 — 이 앱이 답하는 질문이 "무엇을 써야 하나"인데
// 표에 적힌 용량이 틀리면 답 전체가 틀린다.
//
// 한국어 점수(koScore)는 ko-embedding-leaderboard(한국어 IR 7종, NDCG@5·10 평균)에서
// 가져왔다. 모델을 추가할 때 그 표에 없으면 null로 두고 비교에서 빼는 게 낫다 —
// 다른 벤치마크의 숫자를 같은 칸에 섞으면 표가 거짓말을 시작한다.

/** 문장 벡터를 어디서 얻는가. */
export type Head =
  /** ONNX 그래프가 풀링·정규화까지 이미 하고 `sentence_embedding`으로 내보낸다 */
  | "sentence_embedding"
  /** 토큰 은닉값 평균 */
  | "mean"
  /** 첫 토큰([CLS]) */
  | "cls"
  /** 마지막 토큰 — 디코더 계열 */
  | "last_token";

export interface DtypeOption {
  id: string;
  /** 내려받을 총 바이트 — 실측(.onnx + .onnx_data) */
  bytes: number;
  note?: string;
}

/**
 * 벡터를 만드는 것(dense)과 글자를 맞춰 보는 것(lexical).
 *
 * BM25를 같은 목록에 둔 건 화면에서 나란히 고르게 하려는 것만이 아니다 — 이 앱이
 * 답해야 할 질문이 "임베딩이 값을 하는가"라서, 기준선이 목록 밖에 있으면 아무도 안 켠다.
 * lexical 항목에서는 dim·ctx·head·mrl·prefix가 뜻이 없다(UI가 가린다).
 */
export type ModelKind = "dense" | "lexical";

export interface ModelSpec {
  id: string;
  kind: ModelKind;
  /** HF Hub 저장소 이름 — 그대로 fetch 경로가 된다. lexical은 빈 문자열. */
  repo: string;
  label: string;
  /** 파라미터 수(백만) */
  params: number;
  /** 출력 차원 */
  dim: number;
  /** 최대 입력 토큰 */
  ctx: number;
  head: Head;
  /** Matryoshka 학습된 절단 단계. 비었으면 MRL 미학습(절단은 실험 대상이지 보장이 아님) */
  mrl: number[];
  /** 모델 카드가 요구하는 프리픽스 — 없으면 null */
  prefix: { query: string; doc: string } | null;
  dtypes: DtypeOption[];
  /** 기본 선택 dtype */
  defaultDtype: string;
  /** ko-embedding-leaderboard 점수(한국어 IR 7종 NDCG@5·10 평균), 표에 없으면 null */
  koScore: number | null;
  note: string;
}

export const MODELS: ModelSpec[] = [
  {
    id: "bm25",
    kind: "lexical",
    repo: "",
    label: "BM25 (문자 2-gram)",
    params: 0,
    dim: 0,
    ctx: 0,
    head: "mean", // lexical에서는 쓰이지 않는다
    mrl: [],
    prefix: null,
    dtypes: [{ id: "—", bytes: 0, note: "내려받을 것이 없어요" }],
    defaultDtype: "—",
    koScore: null,
    note: "내려받지 않는 기준선. 글자가 겹치지 않으면 0점이라 치과↔이빨, 존댓말↔반말은 원리상 못 잡는다 — 임베딩이 무엇을 사 주는지 재는 잣대다.",
  },
  {
    id: "embeddinggemma",
    kind: "dense",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    label: "EmbeddingGemma 300M",
    params: 308,
    dim: 768,
    ctx: 2048,
    // 풀링·Dense·정규화가 그래프에 구워져 있다 — 우리가 풀링하면 안 된다.
    head: "sentence_embedding",
    mrl: [768, 512, 256, 128],
    prefix: {
      query: "task: search result | query: ",
      doc: "title: none | text: ",
    },
    // ⚠️ fp16·q4f16은 일부러 뺐다. 이 모델은 활성값이 fp16을 지원하지 않는다
    //    (모델 카드 명시). q4f16이 175.7MB로 제일 작아 솔깃하지만 결과가 깨진다.
    dtypes: [
      { id: "q4", bytes: 197_500_000, note: "QAT — 4비트로 학습해 손실이 작다" },
      { id: "q8", bytes: 309_600_000 },
      { id: "fp32", bytes: 1_710_000_000, note: "기준선 — 양자화 손실을 재는 잣대" },
    ],
    defaultDtype: "q4",
    koScore: 78.19,
    note: "브라우저에 들어가는 것 중 한국어 점수가 가장 높다. MRL을 실제로 학습한 유일한 모델.",
  },
  {
    id: "e5-small",
    kind: "dense",
    repo: "Xenova/multilingual-e5-small",
    label: "multilingual-e5-small",
    params: 118,
    dim: 384,
    ctx: 512,
    head: "mean",
    mrl: [],
    prefix: { query: "query: ", doc: "passage: " },
    // q4(399MB)가 fp16(235MB)보다 크다 — 이 모델은 무게 대부분이 임베딩 표라
    // 행렬곱 가중치만 4비트로 줄여 봐야 얻는 게 없다. 목록에 남겨 둔 건
    // 그 사실이 표에서 바로 보이라고.
    dtypes: [
      { id: "q8", bytes: 118_000_000, note: "이 모델의 실질적 정답" },
      { id: "fp16", bytes: 235_000_000 },
      { id: "q4", bytes: 399_000_000, note: "fp16보다 크다 — 무게가 임베딩 표에 있어서" },
      { id: "fp32", bytes: 470_000_000 },
    ],
    defaultDtype: "q8",
    koScore: null,
    note: "가장 가볍다. 한국어 튜닝판(dragonkue/multilingual-e5-small-ko-v2)이 같은 구조라 비교 기준으로 쓴다.",
  },
  {
    id: "bge-m3",
    kind: "dense",
    repo: "onnx-community/bge-m3-ONNX",
    label: "BGE-M3",
    params: 568,
    dim: 1024,
    ctx: 8192,
    head: "cls",
    mrl: [],
    prefix: null,
    // fp16 파일은 저장소에 2바이트로 올라와 있다(내보내기 실패) — 넣으면 죽는다.
    dtypes: [
      { id: "q8", bytes: 568_000_000 },
      { id: "q4f16", bytes: 700_000_000, note: "q8보다 크다" },
      { id: "fp32", bytes: 2_270_000_000 },
    ],
    defaultDtype: "q8",
    koScore: 79.3,
    note: "8192 토큰 — 긴 문서를 자르지 않고 넣어 볼 수 있는 유일한 선택지.",
  },
  {
    id: "qwen3-0.6b",
    kind: "dense",
    repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    label: "Qwen3-Embedding 0.6B",
    params: 595,
    dim: 1024,
    ctx: 32768,
    head: "last_token",
    mrl: [],
    prefix: {
      query: "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ",
      doc: "",
    },
    dtypes: [
      { id: "q4f16", bytes: 567_000_000 },
      { id: "q8", bytes: 614_000_000 },
      { id: "fp32", bytes: 2_400_000_000 },
    ],
    defaultDtype: "q4f16",
    koScore: 75.88,
    note: "덩치에 비해 한국어 점수가 낮다(리더보드 12위). 크기가 성능이 아니라는 대조군.",
  },
];

export function modelById(id: string): ModelSpec {
  const spec = MODELS.find((m) => m.id === id);
  if (!spec) throw new Error(`모르는 모델: ${id}`);
  return spec;
}

export function dtypeBytes(spec: ModelSpec, dtype: string): number {
  return spec.dtypes.find((d) => d.id === dtype)?.bytes ?? 0;
}

/**
 * 절단 후보 — MRL 학습분이 있으면 그것, 없으면 차원을 반씩 접어 만든 실험용 눈금.
 * lexical은 자를 벡터가 없어 빈 목록이다(호출부가 단계 하나를 알아서 만든다).
 */
export function truncationSteps(spec: ModelSpec): number[] {
  if (spec.kind === "lexical" || spec.dim <= 0) return [];
  if (spec.mrl.length) return spec.mrl;
  const steps: number[] = [];
  for (let d = spec.dim; d >= 64; d = Math.floor(d / 2)) steps.push(d);
  return steps;
}
