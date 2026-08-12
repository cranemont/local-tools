// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "이미지",
  home: "홈",
  privacyNote: "파일은 브라우저 밖으로 나가지 않아요",

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
  },

  edit: {
    title: "선택한 장",
    cropStart: "영역 선택",
    cropCancel: "선택 취소",
    cropClear: "크롭 해제",
    cropRect: (w: number, h: number) => `크롭 ${w}×${h}px`,
    ratioFree: "자유",
    rotate: "90° 회전",
    reset: "편집 초기화",
    edited: "편집됨",
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
    keepUnsupportedNote: "PNG·AVIF 출력은 유지를 지원하지 않아요",
  },

  engines: {
    heic: "HEIC 엔진",
    avif: "AVIF 인코더",
  },

  panel: {
    format: "형식",
    quality: "품질",
    qualityPngNote: "PNG는 무손실이라 품질 조절이 없어요",

    size: "크기",
    sizeOriginal: "원본 크기",
    sizeScale: "배율",
    sizeWidth: "가로",
    sizeHeight: "세로",
    scaleUnit: "%",
    pxUnit: "px",
    sizeInfo: (ow: number, oh: number, tw: number, th: number) =>
      `원본 ${ow}×${oh}px → 출력 ${tw}×${th}px`,

    export: "내보내기",
    fileName: "저장 파일 이름",
    save: "저장",
    converting: (name: string, i: number, total: number) =>
      `변환 중… (${i}/${total}) ${name}`,
    zipping: "ZIP으로 묶는 중…",
    savedOne: (size: string) => `저장됨 · ${size}`,
    savedZip: (n: number, size: string) => `ZIP 저장됨 · ${n}장 · ${size}`,
  },

  errors: {
    unsupported: (name: string) => `지원하지 않는 형식이에요: ${name}`,
    decodeFail: (name: string) => `파일을 읽지 못했어요: ${name}`,
    encodeFail: "이미지를 인코딩하지 못했어요",
    canvasFail: "canvas 2d 컨텍스트를 만들 수 없어요",
    engineInit: (label: string) => `${label} 초기화에 실패했어요.`,
  },
} as const;
