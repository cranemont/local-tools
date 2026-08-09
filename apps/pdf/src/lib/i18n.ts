// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)

export const t = {
  brandName: "local-tools",
  appName: "PDF",
  home: "홈",
  privacyNote: "파일은 브라우저 밖으로 나가지 않아요",

  tabs: {
    edit: "편집·병합",
    toImage: "PDF→이미지",
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
  },

  toImg: {
    addPdf: "PDF 추가",
    dropHint: "PDF를 끌어다 놓거나 클릭해서 선택",
    dropSub: "페이지별 PNG로 변환 · PDF만",
    quality: "화질",
    q1: "빠름",
    q2: "권장",
    q3: "고화질",
    saveZip: "ZIP으로 저장",
    download: "다운로드",
    clear: "비우기",
    fileName: "저장 파일 이름",
    zipping: "ZIP으로 묶는 중…",
    rendering: (i: number, total: number, name: string) =>
      `이미지로 변환 중… (${i}/${total}) ${name}`,
    pageCount: (n: number) => `${n}장`,
    savedDl: (n: number) => `PNG 저장됨 · ${n}장`,
    savedZip: (n: number) => `ZIP 저장됨 · ${n}장`,
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
    note: "파일과 비밀번호는 브라우저 안에서만 처리돼요 — 검증된 암호 엔진만 최초 1회 내려받아요",
  },
} as const;
