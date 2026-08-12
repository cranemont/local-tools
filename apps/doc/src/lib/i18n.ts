// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "문서",
  home: "홈",
  privacyNote: "파일은 브라우저 밖으로 나가지 않아요",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  drop: {
    hint: "문서를 끌어다 놓거나 클릭해서 선택",
    sub: "한글 .hwp · .hwpx · 워드 .docx",
    open: "문서 열기",
    overlay: "여기에 놓으면 열려요",
  },

  file: {
    opening: "여는 중…",
    close: "닫기",
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
    syncScrollOn: "왼쪽을 따라 오른쪽도 움직여요",
    syncScrollOff: "각각 따로 움직여요",
    empty: "옮길 내용이 없어요",
  },

  actions: {
    saveMarkdown: "마크다운 저장",
    saveMarkdownHint: "그림이 있으면 images/ 폴더와 함께 ZIP으로 저장해요",
    copyMarkdown: "마크다운 복사",
    saveHwpx: "hwpx로 저장",
    saveHwpxFromDocx: "한글(.hwpx)로 저장",
    saveHwpxHint: "한글에서 그대로 열리는 개방형 형식이에요",
    print: "인쇄 · PDF로 저장",
    printHint: "크롬 인쇄 대화상자에서 “PDF로 저장”을 고르면 돼요",
    find: "문서에서 찾기",
  },

  busy: {
    savingMarkdown: "마크다운 만드는 중…",
    copying: "복사하는 중…",
    converting: ".hwpx로 바꾸는 중…",
    saving: "저장하는 중…",
  },

  edit: {
    start: "편집",
    stop: "편집 끝",
    hint: "원본 위에서 바로 고칠 수 있어요",
    docxHint: "워드 문서는 아직 편집할 수 없어요",
    undo: "되돌리기",
    redo: "다시 실행",
    save: "저장",
    saveHint: "고친 내용을 원래 형식으로 내려받아요",
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
    hint: "원본은 그림으로 그려져서 브라우저 찾기가 닿지 않아요",
  },

  password: {
    title: "비밀번호가 걸린 문서예요",
    body: "문서를 열려면 비밀번호가 필요해요. 비밀번호는 이 브라우저 밖으로 나가지 않아요.",
    wrong: "비밀번호가 맞지 않아요. 다시 입력해 주세요.",
    label: "비밀번호",
    submit: "열기",
    cancel: "취소",
  },

  engine: {
    // 한글 문서 렌더러(wasm)만 네트워크를 탄다 — 그 사실을 숨기지 않는다.
    loading: "한글 문서 엔진을 받는 중…",
    loadingHint: "처음 한 번만 받아요 (약 2.1MB). 워드 문서는 엔진 없이 열려요.",
    failed: "한글 문서 엔진을 받지 못했어요",
    retry: "다시 시도",
    ready: (version: string) => `한글 엔진 ${version}`,
    broken: "문서 엔진이 멈췄어요",
    reload: "새로고침",
    offlineHint: "설치하면 엔진이 기기에 남아 인터넷 없이도 열려요",
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
