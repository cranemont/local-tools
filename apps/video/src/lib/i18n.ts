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
    // 단축키는 안내줄이 아니라 그 버튼의 title·aria-label로만 알린다.
    // 버튼 글자가 재생/정지로 바뀌므로 title도 같이 바뀐다(안 그러면 정지 버튼이 "구간 재생"이라 말한다).
    playRangeKey: "구간 재생 · Space",
    stopKey: "정지 · Space",
    stepBackKey: "이전 프레임 · ← (Shift+← 1초)",
    stepForwardKey: "다음 프레임 · → (Shift+→ 1초)",
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
    trimStartKey: "시작 · I",
    trimEndKey: "끝 · O",
    trimLength: (s: string) => `선택 ${s}`,
    trimReset: "전체 선택",
    trimResetWhy: "구간 목록을 지우고 영상 전체 하나로 되돌려요",
    segmentAdd: "구간 추가",
    segmentRemove: "이 구간 삭제",
    segmentUp: "앞으로",
    segmentDown: "뒤로",
    segmentPick: (n: number) => `${n}번 구간 선택`,
    segmentTotal: (n: number, s: string) => `구간 ${n}개 · 합계 ${s}`,
    exportOrder: "내보내는 순서",
    exportJoin: "이어 한 파일",
    exportEach: "구간마다 한 파일",
    joinAction: (n: number, fmt: string) => `${n}개 구간 ${fmt}로 잇기`,
    eachAction: (n: number, fmt: string) => `${n}개 구간 ${fmt}로 각각`,
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

    // ── 배지 — 조건이 참일 때만 컨트롤 옆에 붙는 경고 ──
    // 짧은 명사형이 화면에 보이고, 사정은 title(*Why)로만 보인다.
    badgeRecode: "재인코딩됨",
    badgeRecodeWhy: "원본 코덱을 이 형식에 담을 수 없어요",
    badgeRotateRecode: "회전은 재인코딩",
    badgeRotateRecodeWhy: "WebM은 회전 메타데이터를 쓰지 않아 픽셀을 다시 인코딩해요",
    badgeExactOnly: "정확 컷에서만",
    badgeExactOnlyWhy: "반전은 픽셀을 다시 그려야 해서 무손실 컷에는 없어요",
    badgeApprox: "근사",
    badgeApproxWhy: "1패스 역산이라 영상에 따라 오차가 있어요",
    badgeQueueFull: "큐는 구간 무시",
    badgeQueueFullWhy: "큐를 처리할 땐 구간 없이 파일 전체를 만들어요",
    badgeOverlap: "겹침",
    badgeOverlapWhy: "겹친 대목은 결과에 두 번 나와요",
    badgeReordered: "순서 뒤바뀜",
    badgeReorderedWhy: "목록에 적힌 순서대로 이어붙여요",
    // 무손실인데 패킷 복사가 안 되는 경우들 — 배지 글자는 badgeRecode 하나를 같이 쓰고
    // 사정만 title로 갈라 보인다.
    badgeKeyframeWhy: "구간 시작이 키프레임이 아니라 복사로 잇지 못해요",
    badgeKeyframeScanWhy: "키프레임을 아직 읽는 중이라 복사로 잇지 못해요",
    badgeAudioRecodeWhy: "이 형식에 원본 소리를 담을 수 없어 다시 인코딩해요",
    badgeTrimRecodeWhy: "시작을 자르면 엔진이 패킷 복사를 쓰지 못해요",
    badgeAudioOne: "구간 하나만",
    badgeAudioOneWhy: "소리만 저장은 고른 구간 하나만 담아요",
  },

  errors: {
    notVideo: (name: string) => `동영상 파일이 아니에요: ${name}`,
    noVideoTrack: (name: string) => `비디오 트랙을 찾을 수 없어요: ${name}`,
    decodeFail: (name: string) => `파일을 읽을 수 없어요: ${name}`,
    encodeFail: "인코딩에 실패했어요",
    concatMismatch: "구간마다 코덱 설정이 달라 이어붙일 수 없어요",
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
