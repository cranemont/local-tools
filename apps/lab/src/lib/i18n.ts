// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "실험장",
  home: "홈",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  intro: {
    title: "임베딩 모델을 바꿔 끼우며 비교해요",
    sub: "같은 문장을 다른 모델·정밀도·차원으로 임베딩해 이웃이 어떻게 달라지는지 봐요",
  },

  corpus: {
    title: "코퍼스",
    probe: "한국어 프로브",
    pasted: "직접 넣기",
    pastedDesc: "한 줄에 한 문장",
    placeholder: "비교할 문장을 한 줄에 하나씩 붙여넣으세요",
    count: (n: number) => `문장 ${n}개`,
    tooMany: (max: number) => `${max}개까지만 써요 — 유사도 행렬이 문장 수의 제곱으로 커져요`,
    changedNote: "코퍼스를 바꾸면 이전 실행은 비교할 수 없어 지워져요",
  },

  model: {
    title: "모델",
    dim: (n: number) => `${n}차원`,
    ctx: (n: number) => `${n.toLocaleString("ko-KR")}토큰`,
    params: (m: number) => `${m}M`,
    koScore: "한국어 IR",
    koScoreHelp:
      "ko-embedding-leaderboard — 한국어 IR 7종의 NDCG@5·10 평균. 표에 없는 모델은 빈칸이에요",
    noScore: "—",
    precision: "정밀도",
    download: "내려받기",
    cached: "받아 둠",
    mrl: "MRL 학습됨",
    noMrl: "MRL 미학습 — 절단은 보장되지 않아요(그게 실험이에요)",
    prefix: "프리픽스",
    noPrefix: "이 모델은 프리픽스를 쓰지 않아요",
    noDownload: "내려받지 않는 기준선",
  },

  run: {
    start: "임베딩",
    rerun: "다시",
    loading: "모델 받는 중",
    embedding: "임베딩 중",
    embeddingAt: (done: number, total: number) => `임베딩 중 ${done}/${total}`,
    prefixOn: "프리픽스 O",
    prefixOff: "프리픽스 X",
    device: "장치",
    webgpu: "WebGPU",
    wasm: "WASM",
    wasmNote: "WebGPU를 못 써서 WASM으로 돌아요 — 훨씬 느려요",
    loadMs: "로드",
    embedMs: "임베딩",
    throughput: (n: number) => `${n.toFixed(1)}문장/초`,
  },

  compare: {
    title: "비교",
    slotA: "A",
    slotB: "B",
    pick: "실행을 고르세요",
    none: "아직 실행이 없어요",
    dim: "차원",
    needTwo: "설정이 다른 실행이 둘 있어야 비교돼요",
    overlap: (k: number) => `이웃 겹침 @${k}`,
    overlapHelp:
      "각 문장의 상위 k 이웃이 두 설정에서 얼마나 같은가 — 1.0이면 검색 결과가 그대로예요. 무엇이 바뀌었는지만 말할 뿐 어느 쪽이 맞는지는 몰라요",
    spearman: "순위 상관",
    spearmanHelp:
      "꼬리까지 포함한 순서 보존도(Spearman ρ). 겹침은 높은데 이게 낮으면 같은 문서끼리 자리만 바꾼 거예요",
    sameRun: "같은 실행을 다른 차원으로 — 절단 비용만 봐요",
  },

  verdict: {
    label: "판정",
    same: "구별되지 않아요",
    differs: "차이가 있어요",
    discordant: (n: number) => `엇갈린 문장 ${n}개`,
    split: (a: number, b: number) => `A만 맞힘 ${a} · B만 맞힘 ${b}`,
    p: (v: number) => (v >= 0.999 ? "p = 1.00" : `p = ${v.toFixed(3)}`),
    need: (n: number) => `이 비율이면 문장 ${n}개는 있어야 구별돼요`,
    help: "같은 문장들로 채점했으니 총점 차이가 아니라 엇갈린 문장만 봐요(McNemar 정확검정). 둘 다 맞히거나 둘 다 틀린 문장은 어느 쪽이 나은지 말해 주지 않아요",
    none: "문장별 정오가 있어야 검정할 수 있어요 — 프로브 코퍼스에서만 나와요",
  },

  view: {
    matrix: "유사도 행렬",
    bump: "순위 이동",
    neighbors: "이웃 목록",
    judge: "판정",
    pareto: "비용–품질",
    topK: "이웃 수",
  },

  matrix: {
    legend: "코사인 유사도",
    legendLexical: "BM25 점수",
    diagLexical: "BM25는 비대칭이라 행렬이 대각선 기준으로 접히지 않아요",
  },

  bump: {
    query: "기준 문장",
    stayed: "자리 지킴",
    moved: "자리 바뀜",
    entered: "새로 진입",
    left: "밀려남",
  },

  neighbors: {
    self: "기준",
    partner: "짝",
    score: "유사도",
    empty: "이웃을 보려면 왼쪽에서 문장을 고르세요",
  },

  score: {
    title: "짝짓기 정확도",
    overall: "전체",
    misses: "짝을 놓친 문장",
    took: "대신 고른 것",
    none: "직접 넣은 문장에는 정답 짝이 없어요 — 판정 탭에서 정답을 매기면 채점돼요",
    perfect: "모두 짝을 찾았어요",
    // "98% 95% 87–100%"로 읽히지 않게 괄호로 묶는다 — 신뢰수준은 툴팁에만 적는다
    ci: (lo: number, hi: number) => `[${Math.round(lo * 100)}–${Math.round(hi * 100)}%]`,
    ciHelp:
      "Wilson 신뢰구간. 40문장에서 100%는 [91%, 100%]라 97.5%와 겹쳐요 — 큰 숫자만 보고 고르면 없는 차이를 고르게 돼요",
  },

  ir: {
    title: "판정 대비 성적",
    ndcg: (k: number) => `NDCG@${k}`,
    recall: (k: number) => `Recall@${k}`,
    mrr: "MRR",
    queries: (n: number) => `채점한 질의 ${n}개`,
    none: "아직 매긴 정답이 없어요 — 판정 탭에서 시작하세요",
    ci: (lo: number, hi: number) => `${lo.toFixed(2)}–${hi.toFixed(2)}`,
  },

  judge: {
    title: "판정",
    bias:
      "풀링의 한계: 아무 설정도 데려오지 않은 문장은 여기 뜨지 않아요. 나중에 붙인 모델이 아무도 못 찾은 정답을 찾아오면 무관으로 세어져요",
    query: "질의 문장",
    relevant: "관련",
    notRelevant: "무관",
    unset: "지움",
    votes: (n: number) => `${n}개 설정이 데려옴`,
    seed: "프로브 짝으로 채우기",
    seedHelp: "내장 프로브의 짝을 정답으로 깔아요 — 나머지는 건드리지 않아요",
    clear: "판정 지우기",
    confirmClear: "이 코퍼스의 판정을 전부 지울까요?",
    marks: (n: number) => `매긴 표 ${n}개`,
    needRun: "판정하려면 실행이 하나는 있어야 해요",
    depth: "풀링 깊이",
  },

  pareto: {
    title: "비용–품질",
    x: "내려받는 용량",
    yPair: "짝짓기 정확도",
    yNdcg: (k: number) => `NDCG@${k}`,
    free: "0 (내려받지 않음)",
    frontier: "파레토 프론티어",
    dominated: "지배당한 조합",
    errorBars: "오차막대는 95% 신뢰구간 — 세로로 겹치는 점끼리는 구별되지 않아요",
    empty: "실행을 돌리면 점이 하나씩 쌓여요",
    stored: (n: number) => `지난 세션에서 이어진 점 포함 ${n}개`,
    reset: "쌓인 점 지우기",
    confirmReset: "이 코퍼스에 쌓인 점을 전부 지울까요?",
  },

  storage: {
    title: "받아 둔 모델",
    open: "저장소",
    empty: "아직 받은 모델이 없어요",
    runtime: "런타임(onnxruntime)",
    usage: (used: string, quota: string) => `이 사이트가 쓰는 저장 공간 ${used} / ${quota}`,
    files: (n: number) => `파일 ${n}개`,
    remove: "지우기",
    removeAll: "전부 지우기",
    confirmAll: "받아 둔 모델을 전부 지울까요?",
    close: "닫기",
  },

  net: {
    title: "이 앱이 접속하는 곳",
    body: "모델 가중치와 실행기(wasm)를 받아 오는 요청뿐이에요. 문장·계산 결과는 전송되지 않아요",
    offline: "받아 둔 모델은 다음부터 오프라인에서도 열려요",
  },

  errors: {
    emptyCorpus: "비교할 문장이 없어요",
    network: "모델을 받지 못했어요 — 인터넷 연결을 확인해 주세요",
    device: (msg: string) => `이 브라우저에서 모델을 실행할 수 없어요 — ${msg}`,
    dismiss: "닫기",
  },
} as const;
