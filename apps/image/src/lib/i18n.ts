// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "이미지",
  home: "홈",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  editor: {
    dropHint: "파일을 끌어다 놓거나 클릭해서 선택",
    dropSub: "JPG · PNG · WebP · AVIF · HEIC · GIF · BMP · SVG",
    addFiles: "파일 추가",
    clearAll: "모두 비우기",
    undo: "되돌리기",
    redo: "다시 실행",
    loading: (name: string, i: number, total: number) =>
      `불러오는 중… (${i}/${total}) ${name}`,
    imageCount: (n: number) => `${n}장`,
  },

  cards: {
    activate: "이 이미지 보기",
    remove: "삭제",
  },

  preview: {
    original: "원본",
    result: "결과",
    computing: "계산 중…",
    sizeBadge: (from: string, to: string, deltaPct: number) =>
      `${from} → ${to} · ${deltaPct > 0 ? "+" : ""}${deltaPct}%`,
    dims: (w: number, h: number) => `${w}×${h}px`,
    cropHint: "드래그해서 남길 영역을 잡으세요",
    cropAdjust: "모서리를 끌어 조정한 뒤 자르기",
    cropApply: "자르기",
    cropArea: "크롭 영역",
    /** 목표 용량 탐색이 도는 동안 — 몇 번째 시도인지 보인다. */
    searching: (i: number, max: number) => `맞추는 중… ${i}/${max}`,
    pickedQuality: (q: number) => `품질 ${q}`,
    pickedColors: (c: number | null, scale: number) => {
      const colors = c === null ? "원본 색" : `색 ${c}`;
      return scale === 100 ? colors : `${colors} · ${scale}%`;
    },
    targetMiss: "목표 초과",
    targetMissHint: (limit: string) => `${limit} 이하로는 못 줄여 가장 작은 결과를 뒀어요`,
  },

  edit: {
    title: "편집",
    cropStart: "영역 선택",
    cropCancel: "선택 취소",
    cropClear: "크롭 해제",
    cropRect: (w: number, h: number) => `크롭 ${w}×${h}px`,
    ratioGroup: "크롭 비율",
    ratioFree: "자유",
    ratioOriginal: "원본 비율",
    ratioOriginalShort: "원본",
    portrait: "세로로 뒤집기",
    portraitShort: "세로",
    rotateCw: "시계 방향 90° 회전",
    rotateCcw: "반시계 방향 90° 회전",
    flipX: "좌우 반전",
    flipY: "상하 반전",
    reset: "편집 초기화",
    applyAll: "모든 장에 적용",
    edited: "편집됨",
    failed: "변환 실패",
  },

  exif: {
    title: "EXIF",
    loading: "읽는 중…",
    none: "메타데이터 없음",
    date: "촬영일",
    camera: "카메라",
    exposure: "노출",
    gps: "GPS",
    keep: "내보낼 때 유지",
  },

  engines: {
    heic: "HEIC 엔진",
    avif: "AVIF 인코더",
  },

  panel: {
    format: "형식",
    quality: "품질",

    colors: "색 수",
    colorsOriginal: "원본",
    dither: "디더링",
    /** 색을 줄여도 브라우저가 팔레트 PNG를 못 만든다는 사실 — 배지 + 툴팁으로만 알린다. */
    palette24: "24비트로 저장",
    palette24Hint:
      "브라우저 PNG 인코더는 팔레트를 쓰지 않아요. 색을 줄이면 압축이 잘 돼 용량은 줄지만 팔레트 PNG만큼은 아니에요",
    /** 목표 용량이 켜져 있어 이 값을 자동으로 고른다는 표시. */
    auto: "자동",
    autoQualityHint: "목표 용량에 맞춰 이 값 이하에서 고릅니다",
    autoColorsHint: "목표 용량에 맞춰 색 수와 축소 배율을 고릅니다",
    /** PNG 탐색은 축소 배율까지 건드린다 — 아래 치수는 상한이지 확정값이 아니다. */
    autoSizeHint: "목표 용량에 맞춰 이 치수보다 작게 나올 수 있어요",

    target: "목표 용량",
    targetOff: "끔",
    targetSizeLabel: "목표 용량 값",
    targetUnitLabel: "목표 용량 단위",

    size: "크기",
    sizeOriginal: "원본 크기",
    sizeScale: "배율",
    sizeWidth: "가로",
    sizeHeight: "세로",
    sizeLongest: "긴 변",
    sizeExact: "정확히",
    sizeExactLabel: "가로 × 세로(px)",
    scaleUnit: "%",
    pxUnit: "px",
    lockRatio: "비율 고정",
    noEnlarge: "원본보다 크게 늘리지 않기",

    fit: "맞춤 방식",
    /** 늘리기로 비율이 실제로 어긋날 때만 뜬다. */
    fitStretchWarn: "비율 어긋남",
    fitStretchWarnHint: (ew: number, eh: number, tw: number, th: number) =>
      `${ew}×${eh}px 비율이 ${tw}×${th}px로 눌려요`,
    /** JPEG로 내보내 투명이 사라질 때만 뜬다. */
    alphaWarn: "투명 → 흰색",
    alphaWarnHint: "JPEG는 투명을 담지 못해 흰 배경에 합성돼요",
    fitStretch: "늘리기",
    fitContain: "여백",
    fitCover: "채우고 자르기",
    padColor: "여백 색",
    padWhite: "흰색",
    padBlack: "검정",
    padTransparent: "투명",
    padCustom: "여백 색 직접 고르기",

    sizeInfo: (ow: number, oh: number, tw: number, th: number) =>
      `원본 ${ow}×${oh}px → 출력 ${tw}×${th}px`,
    sizeInfoEdited: (ew: number, eh: number, tw: number, th: number) =>
      `편집 후 ${ew}×${eh}px → 출력 ${tw}×${th}px`,
    fitContainInfo: (w: number, h: number) => `그림은 ${w}×${h}px, 나머지는 여백`,
    fitCoverInfo: (w: number, h: number) => `원본에서 ${w}×${h}px만 쓰고 나머지는 잘려요`,

    export: "내보내기",
    fileName: "저장 파일 이름",
    save: "저장",
    converting: (name: string, i: number, total: number) =>
      `변환 중… (${i}/${total}) ${name}`,
    /** 장마다 따로 탐색하므로 시도 번호까지 보여 준다 — 안 그러면 멈춘 것처럼 보인다. */
    convertingSearch: (name: string, i: number, total: number, step: number, max: number) =>
      `변환 중… (${i}/${total}) ${name} · 맞추는 중 ${step}/${max}`,
    zipping: "ZIP으로 묶는 중…",
    savedOne: (size: string) => `저장됨 · ${size}`,
    savedOneMiss: (size: string) => `저장됨 · ${size} · 목표 초과`,
    savedZip: (n: number, size: string) => `ZIP 저장됨 · ${n}장 · ${size}`,
    savedZipPartial: (n: number, size: string, failed: number) =>
      `ZIP 저장됨 · ${n}장 · ${size} · ${failed}장 실패`,
    /** 실패와 함께 붙을 수 있으므로 앞 문구에 이어 붙인다 — 둘 중 하나만 말하면
     *  목표를 넘긴 장이 조용히 묻힌다. */
    savedZipMiss: (base: string, over: number) => `${base} · ${over}장 목표 초과`,
  },

  errors: {
    unsupported: (name: string) => `지원하지 않는 형식이에요: ${name}`,
    decodeFail: (name: string) => `파일을 읽지 못했어요: ${name}`,
    encodeFail: "이미지를 인코딩하지 못했어요",
    canvasFail: "canvas 2d 컨텍스트를 만들 수 없어요",
    engineInit: (label: string) => `${label} 초기화에 실패했어요.`,
    andMore: (first: string, rest: number) => `${first} 외 ${rest}건`,
  },
} as const;
