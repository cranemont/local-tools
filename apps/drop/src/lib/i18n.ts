// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "드롭",
  home: "홈",
  privacyNote: "파일은 두 기기 사이에서만 직접 이동해요 — 중간 서버가 없어요",

  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },

  common: {
    copy: "복사",
    copied: "복사됨",
    back: "처음으로",
  },

  intro: {
    title: "두 기기를 직접 연결해 파일을 보내요",
    sub: "연결 코드를 주고받으면 파일이 서버 없이 기기 간에 바로 이동해요",
    create: "연결 만들기",
    createDesc: "먼저 여는 쪽 — 코드를 만들어 상대에게 보여줘요",
    join: "연결 참여",
    joinDesc: "받은 코드를 붙여넣어 응답해요",
    stunNote:
      "같은 네트워크면 외부 접속이 없어요. 다른 네트워크 간에는 주소 확인용 STUN 서버(구글)에 IP만 전달돼요 — 파일은 언제나 기기 간 직접 이동",
  },

  host: {
    step1Qr: "① 상대 폰 카메라로 QR를 찍게 하거나, 링크를 전달하세요",
    step1: "① 이 코드를 상대 기기에 전달하세요",
    making: "코드 만드는 중…",
    step2: "② 상대의 응답을 스캔하거나 붙여넣으세요",
    answerPlaceholder: "응답 코드 붙여넣기",
    connect: "연결",
  },

  guest: {
    pasteLabel: "받은 코드를 붙여넣으세요",
    pastePlaceholder: "연결 코드·링크 붙여넣기",
    makeAnswer: "응답 만들기",
    step1Qr: "이 응답 QR를 상대 기기로 스캔하게 하거나, 코드를 전달하세요",
    waiting: "상대가 응답을 받으면 자동으로 연결돼요",
  },

  scan: {
    title: "QR 스캔",
    open: "QR 스캔",
    hint: "상대 화면의 QR를 비추세요",
    cameraFail: "카메라를 열 수 없어요 — 코드 붙여넣기로 진행해 주세요",
    unsupported: "이 브라우저는 QR 스캔을 지원하지 않아요",
    cancel: "닫기",
  },

  conn: {
    connecting: "연결하는 중…",
    connected: "연결됨",
    failed: "연결에 실패했어요 — 두 기기를 같은 네트워크에 두고 다시 시도해 보세요",
    closed: "연결이 끊어졌어요",
    badCode: "코드를 해석할 수 없어요 — 전체가 복사됐는지 확인해 주세요",
  },

  transfer: {
    drop: "파일을 끌어다 놓거나 클릭해서 선택",
    limitNote: "받은 파일은 메모리에 모였다가 저장돼요 — 수백 MB까지가 안정적이에요",
    sending: "보내는 중",
    receiving: "받는 중",
    done: "완료",
    error: "중단됨",
    save: "저장",
    dirIn: "받음",
    dirOut: "보냄",
    textPlaceholder: "텍스트·링크 보내기",
    textSend: "보내기",
    textLabel: "텍스트",
  },
} as const;

/** 사람 읽는 용량 표기. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
