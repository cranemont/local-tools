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
    // PDF 한 개가 들어가 PDF 한 개가 나오는 탭. 압축과 암호가 같은 모양이고
    // 같은 엔진(qpdf)을 쓴다.
    password: "압축·암호",
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
      `암호가 걸려 있어 내보낼 수 없어요 — 압축·암호 탭에서 먼저 풀어 주세요: ${name}`,
  },

  // 용량 줄이기 — 압축·암호 탭의 첫 모드.
  shrink: {
    mode: "용량 줄이기",
    dropHint: "PDF를 끌어다 놓거나 클릭해서 선택",
    dropSub: "한 번에 한 개 · PDF만",
    change: "다른 파일",
    checking: "문서 살펴보는 중…",

    way: "방식",
    wayRepack: "다시 압축",
    wayRaster: "이미지로",
    wayRepackHint: "글자·글꼴은 그대로 두고 구조와 그림만 다시 압축해요",
    wayRasterHint: "쪽을 그림으로 다시 그려요",

    images: "그림",
    imagesKeep: "그대로",
    imagesNormal: "보통",
    imagesStrong: "강하게",

    resolution: "해상도",
    dpi: (n: number) => `${n}dpi`,
    quality: "품질",

    target: "목표 용량",
    targetPlaceholder: "MB",

    fileName: "저장 파일 이름",
    // 모드 칩이 "용량 줄이기"라 실행 버튼은 다른 말이어야 한다 — 한 화면에 같은
    // 글자의 버튼이 둘이면 무엇을 누르는지 알 수 없다.
    run: "줄여서 저장",
    preparing: "압축 엔진 준비 중… (최초 1회)",
    processing: "다시 압축하는 중…",
    rendering: (i: number, total: number) => `이미지로 그리는 중… (${i}/${total})`,
    renderingTry: (i: number, total: number, n: number, max: number) =>
      `이미지로 그리는 중… (${i}/${total}) · 시도 ${n}/${max}`,

    // 조건부 배지 — 문단으로 늘어놓지 않고 title에 사정을 담는다.
    netBadge: "인터넷 필요",
    netDetail: "qpdf 엔진을 최초 1회 내려받아요 — 파일은 네트워크로 나가지 않아요",
    textBadge: "글자 사라짐",
    textDetail: "이 PDF에는 글자가 들어 있어요 — 이미지로 다시 만들면 선택·검색·복사가 안 돼요",
    scanBadge: "글자 없음",
    scanDetail: "모든 쪽에 글자가 없어요 — 이미지로 다시 만들어도 잃을 것이 없어요",
    // 큰 문서는 시간 상한에 걸려 다 못 훑는다. 그때는 훑은 범위를 배지에 적는다.
    scanPartBadge: (scanned: number, total: number) =>
      `${scanned}/${total}쪽에 글자 없음`,
    scanPartDetail:
      "훑어본 쪽에는 글자가 없었어요 — 나머지 쪽은 확인하지 않았어요",
    probeFailBadge: "살펴보기 실패",
    probeFailDetail:
      "이 문서를 열어 보지 못했어요 — 이미지로 다시 그릴 수 없지만 다시 압축은 할 수 있어요",
    missedBadge: "목표 못 맞춤",
    missedDetail: "이보다 더 줄이려면 해상도나 품질을 낮춰 주세요",

    result: (from: string, to: string, pct: number) => `${from} → ${to} · ${pct}%`,
    resultSame: (size: string) => `${size} → 그대로`,
    noGain: "줄지 않아서 원본을 그대로 내려받았어요.",
    done: "줄인 파일을 다운로드했어요.",
    encrypted: "암호가 걸린 PDF예요 — 암호 해제를 먼저 해 주세요.",
    failed: "용량 줄이기에 실패했어요.",
    canceled: "비밀번호 입력을 취소했어요.",
    onlyPdf: "PDF 파일만 선택할 수 있어요.",
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
