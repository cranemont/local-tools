// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)

export const t = {
  brandName: "local-tools",
  appName: "PDF",
  home: "홈",

  tabs: {
    edit: "편집·병합",
    // 이 탭은 "PDF를 다른 것으로 바꾸는" 자리다 — 이미지에 텍스트가 더해졌다.
    toImage: "이미지·텍스트",
    password: "암호",
  },

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  canvas: {
    addFiles: "파일 추가",
    dropHint: "파일을 끌어다 놓거나 클릭해서 선택",
    dropSub: "PDF · JPG · PNG",
    selectAll: "전체 선택",
    selectNone: "선택 해제",
    rotate: "90° 회전",
    delete: "삭제",
    rotateSelected: "선택 회전",
    deleteSelected: "선택 삭제",
    clearAll: "모두 비우기",
    select: "선택/해제",
    exportAll: "전체 PDF로 내보내기",
    exportSelected: "선택만 내보내기",
    exporting: "PDF 만드는 중…",
    fileName: "저장 파일 이름",
    pageCount: (n: number) => `${n}쪽`,
    selectedCount: (n: number) => `${n}쪽 선택됨`,
    loading: (name: string, i: number, total: number) =>
      `불러오는 중… (${i}/${total}) ${name}`,

    rangeLabel: "쪽 범위",
    rangePlaceholder: "1-5, 8, 12-",
    rangeApply: "선택",
    rangeOdd: "홀수",
    rangeEven: "짝수",
    splitLabel: "나누기 규칙",
    splitByRange: "쪽 범위마다",
    splitEvery: "N쪽마다",
    splitSingle: "낱장",
    splitSize: "묶을 쪽 수",
    split: "나누기",
    splitting: (i: number, total: number) => `나누는 중… (${i}/${total})`,
    splitDone: (n: number) => `${n}개 파일로 나눴어요`,
  },

  toImg: {
    addPdf: "PDF 추가",
    dropHint: "PDF를 끌어다 놓거나 클릭해서 선택",
    dropSub: "페이지별 이미지 · 텍스트로 변환 · PDF만",
    format: "형식",
    resolution: "해상도",
    dpi: (n: number) => `${n}dpi`,
    pages: "대상 쪽",
    pagesPlaceholder: "전체",
    saveZip: "ZIP으로 저장",
    download: "다운로드",
    clear: "비우기",
    fileName: "저장 파일 이름",
    zipping: "ZIP으로 묶는 중…",
    rendering: (i: number, total: number, name: string) =>
      `이미지로 변환 중… (${i}/${total}) ${name}`,
    pageCount: (n: number) => `${n}장`,
    savedDl: (n: number) => `이미지 저장됨 · ${n}장`,
    savedZip: (n: number) => `ZIP 저장됨 · ${n}장`,
    onlyPdf: "PDF 파일만 변환할 수 있어요.",
    defaultName: "images",
  },

  // 같은 탭의 출력 형식 하나 — 이미지 대신 텍스트 레이어를 꺼낸다.
  toText: {
    defaultName: "text",
    extracting: (i: number, total: number, name: string) =>
      `텍스트 추출 중… (${i}/${total}) ${name}`,
    pageNo: (n: number) => `${n}쪽`,
    pageCount: (n: number) => `${n}쪽`,
    savedDl: (n: number) => `텍스트 저장됨 · ${n}쪽`,
    savedZip: (n: number) => `ZIP 저장됨 · 파일 ${n}개`,
    // 스캔 PDF 경고 — 배지 한 개와 title, 문단으로 늘어놓지 않는다.
    noTextBadge: "텍스트 없음",
    noTextDetail: "글자 정보가 없어요 — 스캔한 PDF는 그림만 들어 있어요",
    emptyBadge: (n: number) => `빈 쪽 ${n}`,
    emptyDetail: "글자가 없는 쪽이 있어요 — 스캔한 쪽일 수 있어요",
    pageEmpty: "빈 쪽",
  },

  // 암호 걸린 PDF를 편집·이미지 탭에서 바로 여는 경로.
  unlock: {
    title: "암호가 걸린 PDF",
    body: "비밀번호를 입력하면 이 탭에서 바로 열어요",
    wrong: "비밀번호가 올바르지 않아요",
    label: "비밀번호",
    submit: "열기",
    cancel: "취소",
    preparing: "암호 엔진 준비 중… (최초 1회)",
    unlocking: "암호 푸는 중…",
    canceled: (name: string) => `${name} — 비밀번호 입력을 취소했어요`,
  },

  errors: {
    rangeInvalid: "쪽 범위를 읽을 수 없어요",
    rangeNoPages: "대상 쪽에 해당하는 쪽이 없어요",
    // 입력란 옆에 붙는 짧은 배지 — 자세한 사정은 위 두 문구를 title에 넣는다.
    rangeBadge: {
      syntax: "표기 오류",
      noPages: "고를 쪽 없음",
    },
    encryptedSource: (name: string) =>
      `암호가 걸려 있어 내보낼 수 없어요 — 암호 탭에서 먼저 풀어 주세요: ${name}`,
  },

  pw: {
    encrypt: "암호 설정",
    decrypt: "암호 해제",
    dropHint: "PDF를 끌어다 놓거나 클릭해서 선택",
    dropSub: "한 번에 한 개 · 인터넷 연결 필요",
    passwordLabel: "비밀번호",
    passwordPlaceholderSet: "설정할 비밀번호",
    passwordPlaceholderRemove: "현재 비밀번호",
    fileName: "저장 파일 이름",
    runSet: "암호 걸기",
    runRemove: "암호 풀기",
    change: "다른 파일",
    preparing: "암호 엔진 준비 중… (최초 1회)",
    processing: "처리 중…",
    doneSet: "암호를 설정한 파일을 다운로드했어요.",
    doneRemove: "암호를 해제한 파일을 다운로드했어요.",
    needPw: "비밀번호를 입력해 주세요.",
    wrongPw: "비밀번호가 올바르지 않거나 필요해요.",
  },
} as const;
