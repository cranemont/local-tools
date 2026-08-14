// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "GIF",
  home: "홈",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  editor: {
    dropHint: "파일을 끌어다 놓거나 클릭해서 선택",
    dropSub: "GIF · PNG · JPG · WebP · MP4 · WebM",
    addFiles: "파일 추가",
    clearAll: "모두 비우기",
    undo: "되돌리기",
    redo: "다시 실행",
    cancel: "취소",
    loading: (name: string, i: number, total: number) =>
      `불러오는 중… (${i}/${total}) ${name}`,
    decodingFrames: (name: string, i: number, total: number) =>
      `프레임 읽는 중… (${i}/${total}) ${name}`,
    frameCount: (n: number) => `${n}프레임`,
    selectedCount: (n: number) => `${n}개 선택`,
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
    move: "순서 바꾸기",
    select: "선택/해제",
    delete: "삭제",
    duplicate: "복제",
    selectAll: "전체 선택",
    selectNone: "선택 해제",
    deleteSelected: "선택 삭제",
    keepSelected: "선택만 남기기",
    duplicateSelected: "선택 복제",
    reverse: "순서 뒤집기",
    delayInput: (i: number) => `${i}번 프레임 딜레이(ms)`,
    delayUnit: "ms",
  },

  panel: {
    speed: "속도",
    speedChip: (x: number) => `${x}×`,
    /** 지금 배속·형식에서 입력한 딜레이가 그대로 안 나가는 프레임이 있을 때만 뜬다. */
    delayFloor: (ms: number) => `${ms}ms 하한`,
    delayFloorHint: (n: number, ms: number, fmt: string) =>
      `${fmt}는 ${ms}ms 미만을 담지 못해 ${n}개 프레임이 ${ms}ms로 저장돼요`,
    delayLabel: "프레임 딜레이(ms)",
    delayApplySelected: "선택에 적용",
    delayApplyAll: "전체에 적용",
    delayModeSet: "덮어쓰기",
    delayModeAdd: "가감",
    delayModeScale: "비율",
    delayValueSet: "값(ms)",
    delayValueAdd: "증감(ms)",
    delayValueScale: "비율(%)",

    range: "프레임 구간",
    rangeFrom: "시작 번호",
    rangeTo: "끝 번호",
    rangeSelect: "구간 선택",
    rangeKeep: "구간만 남기기",

    size: "크기",
    outputSize: (w: number, h: number) => `출력 ${w}×${h}px`,
    originalSize: (w: number, h: number) => `원본 ${w}×${h}px`,
    scaleChip: (pct: number) => `${pct}%`,
    widthLabel: "가로(px)",

    crop: "크롭",
    cropStart: "영역 선택",
    cropCancel: "선택 취소",
    cropClear: "크롭 해제",
    cropHint: "드래그로 남길 영역 선택",
    cropRect: (w: number, h: number) => `크롭 ${w}×${h}px`,

    rotateFlip: "회전·뒤집기",
    rotate: "90° 회전",
    flipH: "좌우 뒤집기",
    flipV: "상하 뒤집기",
    resetTransform: "변형 초기화",

    text: "텍스트",
    textAdd: "추가",
    textRemove: "삭제",
    textEmpty: "(빈 글자)",
    textItem: (i: number) => `${i}번 텍스트`,
    textPlaceholder: "글자 (Enter로 줄바꿈)",
    textVAlign: "세로 위치",
    textVTop: "위",
    textVMiddle: "가운데",
    textVBottom: "아래",
    textAlign: "정렬",
    textAlignLeft: "왼쪽",
    textAlignCenter: "가운데",
    textAlignRight: "오른쪽",
    textSize: "글자 크기(px)",
    textColor: "글자색",
    textStrokeColor: "외곽선 색",
    textStrokeWidth: "외곽선(px)",
    textOffsetX: "가로 이동(px)",
    textOffsetY: "세로 이동(px)",
    textScope: "적용 범위",
    textScopeAll: "전체",
    textScopeSelected: "선택",
    textScopeRange: "구간",
    /** 범위가 '선택'인데 선택된 프레임이 없을 때만 뜬다 — 아무 프레임에도 안 나온다는 뜻. */
    textNoSelection: "선택 없음",
    textNoSelectionHint: "선택한 프레임이 없어 이 텍스트는 어디에도 안 나와요",

    loop: "반복",
    loopForever: "무한 반복",
    loopCount: "횟수 지정",
    loopTimes: (n: number) => `${n}회`,

    quality: "화질",
    presetSmall: "작게",
    presetBalanced: "권장",
    presetHigh: "고화질",
    advanced: "고급",
    colors: "색상 수",
    dither: "디더링",
    webpQuality: "품질",

    export: "내보내기",
    format: "형식",
    fileName: "저장 파일 이름",
    encodeAction: (fmt: string) => `${fmt} 만들기`,
    encoding: (i: number, total: number) => `인코딩 중… (${i}/${total})`,
    resultReady: (fmt: string, size: string) => `${fmt} · ${size}`,
    resultStale: "편집 내용이 바뀌었어요",
    download: "다운로드",
    reEncode: "다시 만들기",

    extractPng: "프레임 PNG 추출",
    extracting: (i: number, total: number) => `PNG 변환 중… (${i}/${total})`,
    zipping: "ZIP으로 묶는 중…",
    savedPng: "PNG 1장 저장됨",
    savedZip: (n: number) => `ZIP 저장됨 · ${n}장`,
    canceled: "취소했어요",
  },

  keys: {
    play: "Space",
    step: "← →",
    move: "Alt + ← →",
    range: "Shift + 클릭",
    del: "Delete",
    selectAll: "Ctrl+A",
    undo: "Ctrl+Z",
    redo: "Ctrl+Shift+Z",
  },

  video: {
    dialogTitle: "프레임 가져오기",
    meta: (w: number, h: number, s: string) => `${w}×${h}px · ${s}초`,
    fps: "초당 프레임(fps)",
    scale: "해상도",
    scaleOption: (pct: number, w: number) => `${pct}% · ${w}px`,
    range: "구간(초)",
    rangeStart: "시작",
    rangeEnd: "끝",
    estFrames: (n: number) => `약 ${n}프레임`,
    import: "가져오기",
    cancel: "취소",
    probing: (name: string) => `동영상 읽는 중… ${name}`,
    extracting: (name: string, i: number, total: number) =>
      total ? `프레임 추출 중… (${i}/${total}) ${name}` : `프레임 추출 준비 중… ${name}`,
  },

  banner: {
    large: (w: number, h: number) =>
      `원본 ${w}×${h}px — 출력 크기를 줄이면 훨씬 가벼워져요`,
    shrinkTo: (pct: number) => `${pct}%로 줄이기`,
    dismiss: "유지",
  },

  errors: {
    unsupported: (name: string) => `지원하지 않는 형식이에요: ${name}`,
    decodeFail: (name: string) => `파일을 읽지 못했어요: ${name}`,
    noVideoTrack: (name: string) => `영상 트랙을 찾을 수 없어요: ${name}`,
    noImageDecoder: "이 브라우저는 GIF 디코딩을 지원하지 않아요 — 최신 Chrome/Edge가 필요해요",
    canvasFail: "canvas 2d 컨텍스트를 만들 수 없어요",
  },
} as const;
