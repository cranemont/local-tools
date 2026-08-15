// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "문서",
  home: "홈",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  drop: {
    hint: "문서를 끌어다 놓거나 클릭해서 선택",
    sub: "한글 .hwp · .hwpx · 워드 .docx · 여러 개면 일괄 변환",
    open: "문서 열기",
    overlay: "여기에 놓으면 열려요",
  },

  file: {
    opening: "여는 중…",
    // "찾기 닫기"와 나란히 놓이므로 무엇을 닫는지 밝힌다 — 둘 다 X 아이콘이라 이름이 유일한 단서다.
    close: "문서 닫기",
    pages: (n: number) => `${n}쪽`,
    kind: {
      hwp: "한글 문서",
      hwpx: "한글 문서(개방형)",
      docx: "워드 문서",
    },
  },

  panes: {
    original: "원본",
    both: "나란히",
    markdown: "마크다운",
    syncScroll: "스크롤 맞춤",
    empty: "옮길 내용이 없어요",
  },

  view: {
    outline: "목차",
    outlineOpen: "목차 열기",
    outlineClose: "목차 닫기",
    outlineEmpty: "제목으로 잡힌 문단이 없어요",
    page: "쪽 번호",
    pageTotal: (n: number) => `/ ${n}`,
    zoom: "배율",
    zoomIn: "확대",
    zoomOut: "축소",
    fitWidth: "폭 맞춤으로 되돌리기",
    percent: (zoom: number) => `${Math.round(zoom * 100)}%`,
  },

  actions: {
    saveMarkdown: "마크다운 저장",
    copyMarkdown: "마크다운 복사",
    saveHwpx: "hwpx로 저장",
    saveHwpxFromDocx: "한글(.hwpx)로 저장",
    print: "인쇄 · PDF로 저장",
    find: "문서에서 찾기",
  },

  busy: {
    savingMarkdown: "마크다운 만드는 중…",
    copying: "복사하는 중…",
    converting: ".hwpx로 바꾸는 중…",
    saving: "저장하는 중…",
    zipping: "ZIP 묶는 중…",
  },

  // 일괄 변환 — 여러 개를 놓으면 편집기 대신 이 목록이 뜬다.
  batch: {
    title: "일괄 변환",
    progress: (done: number, total: number) => `${done} / ${total}`,
    saveZip: "ZIP으로 저장",
    stop: "중단",
    // 누른 뒤에도 돌던 문서가 끝날 때까지는 목록이 그대로다 — 눌린 사실만이라도 보여 준다.
    stopping: "중단하는 중…",
    skip: "건너뛰기",
    zipName: "문서-마크다운.zip",
    nothing: "저장할 결과가 없어요",
    // 패닉은 새로고침 말고 살릴 길이 없다(CLAUDE.md 17번). 한 줄로 그 사실만 알린다.
    // 발이 묶이는 것은 한글 문서뿐이므로(워드는 rhwp를 타지 않는다) 그렇게 적는다.
    halted: "엔진이 멈춰 한글 문서는 못 했어요 — 새로고침한 뒤 남은 것만 다시 해 주세요",
    // 아직 워드가 남아 도는 중 — 이때 새로고침을 권하면 옮겨 놓은 것을 잃는다.
    haltedBusy: "엔진이 멈췄어요 — 워드 문서만 이어서 해요",
    stopped: "중단했어요",
    status: {
      pending: "대기",
      running: "변환 중",
      done: "완료",
      failed: "실패",
      skipped: "건너뜀",
      halted: "못 함",
    },
    reason: {
      halted: "앞 문서에서 엔진이 멈춰 손대지 못했어요.",
      stopped: "중단해서 손대지 못했어요.",
      skipped: "비밀번호를 건너뛰었어요.",
    },
  },

  edit: {
    start: "편집",
    stop: "편집 끝",
    undo: "되돌리기",
    redo: "다시 실행",
    save: "저장",
    unsaved: "저장하지 않은 편집이 있어요. 버리고 닫을까요?",
    stale: "편집한 내용이에요. 편집을 끝내면 여기도 다시 계산해요.",
    placeCaret: "글자를 누르면 커서가 놓여요",
  },

  flash: {
    saved: (name: string) => `${name} 저장했어요`,
    savedZip: (name: string) => `${name} 저장했어요 — 그림은 images/ 안에 있어요`,
    copied: "마크다운을 복사했어요",
  },

  find: {
    placeholder: "문서에서 찾기",
    count: (n: number) => `${n}곳`,
    none: "찾는 내용이 없어요",
    prev: "이전",
    next: "다음",
    close: "찾기 닫기",
  },

  password: {
    title: "비밀번호가 걸린 문서예요",
    wrong: "비밀번호가 맞지 않아요. 다시 입력해 주세요.",
    label: "비밀번호",
    submit: "열기",
    cancel: "취소",
  },

  engine: {
    // 한글 문서 렌더러(wasm)만 네트워크를 탄다 — 그 사실을 숨기지 않는다.
    loading: "한글 문서 엔진을 받는 중…",
    retry: "다시 시도",
    broken: "문서 엔진이 멈췄어요",
    reload: "새로고침",
  },

  notes: {
    title: "옮기며 달라진 것",
  },

  error: {
    title: "열지 못했어요",
    again: "다른 문서 열기",
  },

  install: {
    label: "설치",
    hint: ".hwp 더블클릭으로 바로 열려요",
  },
} as const;
