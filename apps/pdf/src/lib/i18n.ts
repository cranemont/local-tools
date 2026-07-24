// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)

export const t = {
  brandName: "local-tools",
  appName: "PDF",
  tagline: "브라우저 안에서만 처리 · 파일은 어디로도 전송되지 않아요",
  privacyNote: "모든 처리는 이 브라우저 안에서만 이뤄지고, 파일은 서버로 전송되지 않습니다.",

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

  placeholders: {
    edit: "PDF·이미지를 여기에 끌어다 놓으면 페이지를 합치고 정리할 수 있어요.",
    toImage: "PDF를 페이지별 이미지(PNG)로 저장합니다.",
    password: "PDF에 암호를 걸거나 해제합니다. (이 기능은 인터넷 연결이 필요해요)",
    comingSoon: "곧 만들 예정",
  },

  canvas: {
    addFiles: "파일 추가",
    dropHint: "PDF·이미지를 여기에 끌어다 놓거나 클릭해서 선택하세요",
    dropSub: "여러 개를 한 번에 올릴 수 있어요 · PDF, JPG, PNG",
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
    dropHint: "PDF를 여기에 끌어다 놓거나 클릭해서 선택하세요",
    dropSub: "각 페이지가 PNG 이미지로 변환돼요 · PDF만",
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
    savedDl: (n: number) => `${n}장을 다운로드했어요.`,
    savedZip: (n: number) => `${n}장을 ZIP으로 저장했어요.`,
  },

  pw: {
    encrypt: "암호 설정",
    decrypt: "암호 해제",
    dropHint: "PDF를 여기에 끌어다 놓거나 클릭해서 선택하세요",
    dropSub: "한 번에 한 개 · 이 기능은 인터넷 연결이 필요해요",
    passwordLabel: "비밀번호",
    passwordPlaceholderSet: "설정할 비밀번호",
    passwordPlaceholderRemove: "현재 비밀번호",
    fileName: "저장 파일 이름",
    runSet: "암호 걸기",
    runRemove: "암호 풀기",
    change: "다른 파일",
    preparing: "암호 엔진 준비 중… (최초 1회, 안전하게 검증)",
    processing: "처리 중…",
    doneSet: "암호를 설정한 파일을 다운로드했어요.",
    doneRemove: "암호를 해제한 파일을 다운로드했어요.",
    needPw: "비밀번호를 입력해 주세요.",
    wrongPw: "비밀번호가 올바르지 않거나 필요해요.",
    note: "🔒 파일과 비밀번호는 이 브라우저 안에서만 처리돼요. 검증된 고정 버전의 qpdf 엔진만 최초 1회 CDN에서 내려받습니다.",
  },
} as const;
