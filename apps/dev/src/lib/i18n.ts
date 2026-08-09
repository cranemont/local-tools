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
    codec: "인코딩",
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
} as const;
