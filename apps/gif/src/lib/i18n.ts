// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)

export const t = {
  brandName: "local-tools",
  appName: "GIF",
  privacyNote: "모든 처리는 이 브라우저 안에서만 이뤄지고, 파일은 서버로 전송되지 않습니다.",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  editor: {
    dropHint: "GIF·이미지를 여기에 끌어다 놓거나 클릭해서 선택하세요",
    dropSub: "GIF를 편집하거나, 이미지 여러 장으로 GIF를 만들 수 있어요 · GIF, PNG, JPG, WebP",
    addFiles: "파일 추가",
    clearAll: "모두 비우기",
    loading: (name: string, i: number, total: number) =>
      `불러오는 중… (${i}/${total}) ${name}`,
    decodingFrames: (name: string, i: number, total: number) =>
      `프레임 읽는 중… (${i}/${total}) ${name}`,
    frameCount: (n: number) => `${n}프레임`,
    selectedCount: (n: number) => `${n}개 선택됨`,
  },

  player: {
    play: "재생",
    pause: "일시정지",
    prevFrame: "이전 프레임",
    nextFrame: "다음 프레임",
    frameOf: (i: number, n: number) => `${i} / ${n}`,
  },

  frames: {
    activate: "이 프레임 보기",
    select: "선택/해제",
    delete: "삭제",
    duplicate: "복제",
    selectAll: "전체 선택",
    selectNone: "선택 해제",
    deleteSelected: "선택 삭제",
    keepSelected: "선택만 남기기",
    duplicateSelected: "선택 복제",
    reverse: "순서 뒤집기",
    delayBadge: (ms: number) => `${ms}ms`,
  },

  panel: {
    speed: "속도",
    speedChip: (x: number) => `${x}×`,
    delayLabel: "프레임 딜레이(ms)",
    delayApplySelected: "선택에 적용",
    delayApplyAll: "전체에 적용",

    size: "크기",
    outputSize: (w: number, h: number) => `출력 ${w}×${h}px`,
    originalSize: (w: number, h: number) => `원본 ${w}×${h}px`,
    scaleChip: (pct: number) => `${pct}%`,
    widthLabel: "가로(px)",

    crop: "크롭",
    cropStart: "영역 선택",
    cropCancel: "선택 취소",
    cropClear: "크롭 해제",
    cropHint: "미리보기에서 드래그해 남길 영역을 선택하세요",
    cropRect: (w: number, h: number) => `크롭됨 · ${w}×${h}px`,

    rotateFlip: "회전·뒤집기",
    rotate: "90° 회전",
    flipH: "좌우 뒤집기",
    flipV: "상하 뒤집기",
    resetTransform: "변형 초기화",

    loop: "반복",
    loopForever: "무한 반복",
    loopCount: "횟수 지정",
    loopTimes: (n: number) => `${n}회`,

    export: "내보내기",
    fileName: "저장 파일 이름",
    encodeGif: "GIF 만들기",
    encoding: (i: number, total: number) => `GIF 인코딩 중… (${i}/${total})`,
    resultReady: (size: string) => `완성! 용량 ${size}`,
    resultStale: "편집 내용이 바뀌었어요. 다시 만들어 주세요.",
    download: "다운로드",
    reEncode: "다시 만들기",

    extractPng: "프레임 PNG 추출",
    extracting: (i: number, total: number) => `PNG로 변환 중… (${i}/${total})`,
    zipping: "ZIP으로 묶는 중…",
    savedPng: "프레임 1장을 PNG로 다운로드했어요.",
    savedZip: (n: number) => `${n}장을 ZIP으로 저장했어요.`,
  },

  banner: {
    large: (w: number, h: number) =>
      `원본이 ${w}×${h}px로 커요. 출력 크기를 줄이면 파일이 훨씬 가벼워져요.`,
    shrinkTo: (pct: number) => `${pct}%로 줄이기`,
    dismiss: "그대로 둘게요",
  },

  errors: {
    unsupported: (name: string) => `지원하지 않는 형식이에요: ${name}`,
    decodeFail: (name: string) => `파일을 읽지 못했어요: ${name}`,
    noImageDecoder:
      "이 브라우저는 GIF 디코딩(ImageDecoder)을 지원하지 않아요. 최신 Chrome/Edge에서 열어 주세요.",
    canvasFail: "canvas 2d 컨텍스트를 만들 수 없어요.",
  },
} as const;
