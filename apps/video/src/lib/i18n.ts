// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)

export const t = {
  brandName: "local-tools",
  appName: "VIDEO",
  home: "홈",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  editor: {
    dropHint: "동영상을 끌어다 놓거나 클릭해서 선택",
    dropSub: "MP4 · MOV · WebM · MKV · 여러 개 가능",
    changeFile: "다른 파일",
    clear: "비우기",
    loading: "불러오는 중…",
    queueCount: (n: number) => `대기 ${n}개`,
    queueClear: "대기 비우기",
  },

  player: {
    playRange: "구간 재생",
    stop: "정지",
    stepBack: "이전 프레임",
    stepForward: "다음 프레임",
    saveFrame: "프레임 저장",
    savingFrame: "프레임 뽑는 중…",
    noFrame: "이 위치의 프레임을 뽑을 수 없어요",
  },

  panel: {
    info: "정보",
    resolution: (w: number, h: number) => `${w}×${h}`,
    trim: "구간",
    trimStart: "시작",
    trimEnd: "끝",
    trimLength: (s: string) => `선택 ${s}`,
    trimReset: "전체 선택",
    cutMode: "컷 방식",
    cutExact: "정확",
    cutLossless: "무손실(빠름)",
    quality: "화질",
    presetSmall: "작게",
    presetBalanced: "균형",
    presetHigh: "고화질",
    targetSize: "타깃 용량(MB)",
    bitrate: "비트레이트(kbps)",
    fps: "프레임레이트",
    auto: "자동",
    sourceFps: (v: number) => `원본 ${v}`,
    transform: "회전·반전",
    rotateCw: "오른쪽으로 90°",
    rotateNone: "회전 없음",
    rotateState: (deg: number) => `${deg}° 회전`,
    flipH: "좌우 반전",
    flipV: "상하 반전",
    size: "크기",
    resOriginal: "원본",
    resChip: (h: number) => `${h}p`,
    outputSize: (w: number, h: number) => `출력 ${w}×${h}`,
    export: "내보내기",
    format: "형식",
    fileName: "저장 파일 이름",
    encodeAction: (fmt: string) => `${fmt} 만들기`,
    reEncode: "다시 만들기",
    download: "다운로드",
    mute: "소리 제거",
    audio: "소리만 저장",
    audioFormat: "형식",
    audioAuto: "자동",
    audioMono: "모노로 합치기",
    extractAudio: "소리만 저장",
    savedAudio: (fmt: string, size: string) => `${fmt} · ${size} 저장됨`,
    extracting: "소리 추출 중…",
    batch: (n: number) => `파일 ${n}개`,
    batchAction: (n: number, fmt: string) => `${n}개 ${fmt}로 만들기`,
    batchProgress: (done: number, total: number) => `${done}/${total} 처리 중…`,
    batchDone: (n: number) => `${n}개 저장됨`,
    batchFailed: (name: string) => `건너뜀: ${name}`,
    resultReady: (fmt: string, size: string) => `${fmt} · ${size}`,
    resultStale: "편집 내용이 바뀌었어요",
    audioDropped: "오디오 트랙은 처리할 수 없어 제외돼요",
    encoding: (pct: number) => `인코딩 중… ${pct}%`,
    cancel: "취소",
    canceled: "취소됨",
  },

  errors: {
    notVideo: (name: string) => `동영상 파일이 아니에요: ${name}`,
    noVideoTrack: (name: string) => `비디오 트랙을 찾을 수 없어요: ${name}`,
    decodeFail: (name: string) => `파일을 읽을 수 없어요: ${name}`,
    encodeFail: "인코딩에 실패했어요",
  },
} as const;

/** 초 → "m:ss.t" (한 시간 넘으면 "h:mm:ss"). */
export function fmtTime(s: number): string {
  const total = Math.max(0, s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    const ss = String(Math.floor(sec)).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  const ss = sec.toFixed(1).padStart(4, "0");
  return `${m}:${ss}`;
}
