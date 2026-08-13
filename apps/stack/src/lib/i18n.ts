// UI 껍데기 문구 — 버튼·라벨·안내. (한국어 전용)
// 지도에 그려지는 내용(앱·기능·기술 설명)은 데이터라서 lib/data/*.ts에 있다.
// 톤: 짧고 담백하게. 감탄사·이모지 금지.

export const t = {
  brandName: "local-tools",
  appName: "기술 지도",
  home: "홈",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  intro: {
    title: "무엇으로 만들었나",
    // 개수를 문장에 박지 말 것 — 바로 아래 요약 막대가 실시간으로 센다.
    // ("여섯 개 도구"로 적혀 있다가 도구가 아홉이 되도록 아무도 못 봤다.)
    sub: "도구의 기능 하나하나가 어떤 기술 위에 서 있는지, 그리고 그중 무엇이 네트워크를 타는지",
  },

  summary: {
    apps: "도구",
    features: "기능",
    techs: "기술",
    thirdParty: "서드파티",
    wasm: "wasm",
    network: "네트워크",
    networkHint: "나머지는 전부 브라우저 안에서 끝난다",
  },

  controls: {
    searchLabel: "검색",
    searchPlaceholder: "기능·기술·설명 검색",
    searchClear: "검색어 지우기",
    matchCount: (n: number) => `${n}개 일치`,
    noMatch: "일치하는 것 없음",
    networkOnly: "네트워크 타는 것만",
    networkOnlyHint: "인터넷이 필요한 지점만 남긴다",
    reset: "필터 초기화",
    hidden: (feats: number, techs: number) => `필터로 숨김 — 기능 ${feats} · 기술 ${techs}`,
    lanes: "레인",
  },

  list: {
    label: "목록",
    count: (n: number) => `${n}개`,
    empty: "필터·검색에 남은 게 없어요",
    hint: "짚으면 도시에서 켜지고, 누르면 그리로 날아가요",
    offMap: "도시에는 없어요 — 파일이 지나는 자리가 아니라서 지형을 안 세웠어요",
  },

  detail: {
    panelLabel: "선택한 항목 자세히",
    close: "닫기",
    usedBy: "쓰는 기능",
    uses: "쓰는 기술",
    source: "소스",
    openPipeline: "파이프라인 보기",
    network: "네트워크",
    netStack: "통로 계층",
    netHosts: "붙는 곳",
    offline: "완전 오프라인",
    offlineNote: "이 기능은 인터넷 없이 돌아가요",
    appOf: "소속",
    emptyTitle: "아무것도 고르지 않았어요",
    emptyBody: "왼쪽에서 기능을, 오른쪽에서 기술을 누르면 여기에 자세히 나와요",
    emptyHintTech: "기술을 누르면 그걸 쓰는 기능이 전부 드러나요",
  },

  city: {
    hint: "드래그로 회전 · 휠로 확대 · 유닛을 누르면 자세히",
    legend:
      "도시에는 파일이 실제로 지나는 자리만 서 있어요. 유닛 높이·앞면 눈금 = 여기를 몇 번 지나는가 · 왼쪽 면 포트 = 기대는 기술(색은 그 성격) · 지붕 안테나 = 바깥과 통함 · 덕트 = wasm",
    pipes:
      "재생해 보세요 — 궤짝이 곧 파일입니다. 쪼개지면 여러 개가 되고, 압축되면 작아지고, 256색으로 줄면 색이 갈립니다. 어느 흐름이든 마지막엔 가운데 출입구로 나가요",
    walls:
      "성벽 = 브라우저 안. 성문 밖 기둥은 프로토콜 계층이고, 격자탑 하나가 실제로 붙는 서버 하나예요",
    walk: "거리 시점",
    walking: "거리 시점 — WASD로 이동, Shift로 빨리, Esc로 나가기",
    reset: "시점 초기화",
    flow: "흘려보낼 흐름",
    play: "파일 흘려보내기",
    stop: "정지",
    speed: "속도",
    speeds: [
      { mult: 0.5, label: "느리게" },
      { mult: 1, label: "보통" },
      { mult: 2, label: "빠르게" },
    ],
    cargoNow: "지금 흐르는 것",
    step: (n: number, total: number) => `${n} / ${total}`,
    loading: "도시 불러오는 중…",
    failed: "도시를 불러오지 못했어요",
    noWebgl: "이 브라우저에서는 WebGL을 쓸 수 없어요 — 오른쪽 목록으로 둘러볼 수 있어요",
  },

  mech: {
    open: "안 들여다보기",
    back: "돌아가기",
    usedIn: "이 기계가 도는 곳",
    source: "소스",
    seqHint:
      "점선 레인은 성벽 밖 참여자 — 믿지 않는 쪽이에요. 파란 칸은 봉인된(암호화된) 메시지고요",
    bytes: (n: number) => `${n}B`,
    bytesScale: (n: number) =>
      `막대 폭은 바이트 수에 비례해요(표시 구간 합계 ${n}B). 좁은 칸도 이름이 보이도록 최소 폭을 줬어요`,
  },

  pipeline: {
    back: "지도로 돌아가기",
    play: "흐름 재생",
    stop: "정지",
    replay: "다시 재생",
    input: "입력",
    output: "출력",
    step: "단계",
    reducedMotion: "모션 축소 설정이 켜져 있어 단계만 차례로 짚어요",
  },

  footer: {
    privacy: "여기는 도구가 아니라 이 저장소를 설명하는 메타 페이지예요 — 바깥으로 나가는 요청은 없어요",
    source: "저장소에서 코드 보기",
  },
} as const;
