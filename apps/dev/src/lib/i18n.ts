// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)

export const t = {
  brandName: "local-tools",
  appName: "DEV",
  home: "홈",
  privacyNote: "입력한 내용은 브라우저 밖으로 나가지 않아요",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  sidebar: {
    search: "도구 검색",
    empty: "검색 결과 없음",
  },

  groups: {
    format: "포맷·변환",
    sec: "인코딩·보안",
    time: "시간",
    text: "텍스트",
  },

  common: {
    copy: "복사",
    copied: "복사됨",
    input: "입력",
    output: "출력",
    swap: "출력을 입력으로",
    encode: "인코딩",
    decode: "디코딩",
  },

  format: {
    title: "포맷터 · 변환",
    desc: "JSON · YAML · XML 정리, 압축, 상호 변환",
    placeholder: "JSON · YAML · XML 붙여넣기",
    detected: (fmt: string) => `입력: ${fmt}`,
    detectedNone: "입력: —",
    outFormat: "출력",
    indent: "들여쓰기",
    indent2: "2칸",
    indent4: "4칸",
    minify: "압축",
    xmlLossy: "XML 변환은 속성·순서 표현이 형식마다 달라 결과가 조금 다를 수 있어요",
  },

  diff: {
    title: "텍스트 비교",
    desc: "두 글의 차이를 줄 단위로 표시",
    left: "원본",
    right: "변경",
    ignoreWs: "공백 무시",
    same: "차이 없음",
    counts: (added: number, removed: number) => `+${added}줄 · −${removed}줄`,
    hint: "왼쪽에 원본, 오른쪽에 바뀐 글을 붙여넣으면 바로 비교돼요",
  },

  encode: {
    title: "Base64 · URL",
    desc: "텍스트 인코딩·디코딩 (UTF-8)",
    modeB64: "Base64",
    modeB64Url: "Base64 URL-safe",
    modeUrl: "URL",
    invalid: "디코딩할 수 없는 입력이에요",
  },

  chars: {
    title: "글자수 세기",
    desc: "자소서·SMS용 글자수와 바이트",
    placeholder: "글을 붙여넣으면 바로 계산돼요",
    withSpace: "공백 포함",
    withoutSpace: "공백 제외",
    words: "단어",
    lines: "줄",
    utf8: "UTF-8 바이트",
    twoByte: "2바이트 기준",
    twoByteNote: "2바이트 기준: 한글·전각 문자 2byte, 영문·숫자 1byte — 취업 사이트가 쓰는 계산식. UTF-8은 한글 한 글자가 3byte.",
  },

  jwt: {
    title: "JWT 디코더",
    desc: "토큰 디코드, 만료 확인, HS 서명 검증",
    placeholder: "JWT 붙여넣기",
    header: "헤더",
    payload: "페이로드",
    invalid: "JWT 형식이 아니에요",
    claims: "시간 클레임",
    expValid: "유효",
    expExpired: "만료됨",
    nbfPending: "활성화 전",
    secret: "비밀키",
    verify: "서명 확인",
    verifyOk: "서명 일치",
    verifyFail: "서명 불일치",
    verifyUnsupported: (alg: string) => `${alg} 서명은 여기서 확인할 수 없어요 (HS256·384·512만)`,
    secretNote: "비밀키도 브라우저 밖으로 나가지 않아요",
  },

  hash: {
    title: "해시",
    desc: "MD5 · SHA 체크섬 (텍스트·파일)",
    modeText: "텍스트",
    modeFile: "파일",
    textPlaceholder: "해시할 텍스트 입력",
    dropHint: "파일을 끌어다 놓거나 클릭해서 선택",
    changeFile: "다른 파일",
    computing: "계산 중…",
  },

  uuid: {
    title: "UUID · ULID",
    desc: "식별자 생성 (v4 · v7 · ULID)",
    count: "개수",
    generate: "새로 생성",
  },

  time: {
    title: "타임스탬프",
    desc: "Unix 시간 ↔ 날짜 변환",
    now: "지금",
    inputLabel: "타임스탬프·날짜",
    placeholder: "1791600000 · 2026-08-09 21:00 · 어제 날짜도 ISO로",
    local: "로컬 시간",
    iso: "ISO 8601 (UTC)",
    unixS: "Unix 초",
    unixMs: "Unix 밀리초",
    relative: "상대 시간",
    invalid: "시간으로 해석할 수 없어요",
  },

  regex: {
    title: "정규식 테스트",
    desc: "패턴 매칭 실시간 확인",
    pattern: "패턴",
    patternPlaceholder: "([a-z]+)@(\\w+\\.\\w+)",
    text: "테스트 문자열",
    matches: (n: number) => `${n}개 일치`,
    noMatch: "일치 없음",
    group: (i: number) => `그룹 ${i}`,
    capped: "1,000개까지만 표시돼요",
  },

  cron: {
    title: "cron 해석",
    desc: "표현식 설명과 다음 실행 시각",
    placeholder: "*/5 * * * *",
    next: "다음 실행",
    invalid: "cron 표현식이 아니에요",
  },

  qr: {
    title: "QR 코드",
    desc: "생성(텍스트·WiFi)과 이미지 스캔",
    modeText: "텍스트·URL",
    modeWifi: "WiFi",
    modeScan: "스캔",
    textPlaceholder: "https://example.com",
    ssid: "네트워크 이름(SSID)",
    password: "비밀번호",
    security: "보안",
    secNone: "없음",
    hidden: "숨김 네트워크",
    pngSize: "PNG 크기",
    download: "PNG 다운로드",
    copyImage: "이미지 복사",
    copiedImage: "복사됨",
    tooLong: "내용이 너무 길어요",
    scanDrop: "QR 이미지를 끌어다 놓거나 클릭해서 선택",
    scanResult: "인식 결과",
    scanNone: "QR 코드를 찾지 못했어요",
    scanFail: "이미지를 읽을 수 없어요",
    scanUnsupported: "이 브라우저는 QR 스캔을 지원하지 않아요 — 최신 크롬에서 열어 주세요",
  },

  color: {
    title: "컬러 변환",
    desc: "HEX · RGB · HSL · OKLCH 상호 변환",
    placeholder: "#0ea5e9 · rgb(14 165 233) · oklch(0.62 0.158 240)",
    invalid: "색으로 해석할 수 없어요",
    gamutNote: "sRGB 밖 색이라 HEX·RGB·HSL은 가장 가까운 색으로 표시돼요",
  },
} as const;

/** 밀리초 타임스탬프 → "2026. 08. 09. 21:45:12" (로컬). */
export function fmtDateTime(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ms);
}

/** 밀리초 타임스탬프 → "3시간 전" 식 상대 표기. */
export function fmtRelative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536e6],
    ["month", 2592e6],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  for (const [unit, size] of units) if (abs >= size) return rtf.format(Math.round(diff / size), unit);
  return rtf.format(Math.round(diff / 1e3), "second");
}
