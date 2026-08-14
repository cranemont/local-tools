// 모든 사용자 노출 문구는 여기 한 곳에 모은다.
// (지금은 한국어 전용. 나중에 영어를 붙일 때 이 구조만 확장하면 됨.)
// 톤: 짧고 담백하게. 감탄사·이모지·두 문장짜리 안내문 금지.

export const t = {
  brandName: "local-tools",
  appName: "드롭",
  home: "홈",

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
    create: "연결 만들기",
    createDesc: "먼저 여는 쪽 — 코드를 만들어 상대에게 보여줘요",
    join: "연결 참여",
    joinDesc: "받은 코드를 붙여넣어 응답해요",
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

  rz: {
    hostLabel: "① 상대 기기에서 드롭을 열고 이 코드를 입력하세요",
    hostWaiting: "상대가 코드를 입력하면 자동으로 연결돼요 · 코드는 5분간 유효",
    hostFailed: "짧은 코드를 쓸 수 없어요(릴레이 연결 실패) — 아래 QR·링크로 연결하세요",
    altHost: "QR·링크로도 연결할 수 있어요",
    guestLabel: "받은 코드 6자리를 입력하세요",
    codePlaceholder: "000 000",
    join: "연결",
    altGuest: "QR·긴 코드로도 연결할 수 있어요",
    noRelay: "릴레이에 연결할 수 없어요 — QR·긴 코드 방식으로 연결해 주세요",
    notFound: "코드를 찾을 수 없어요 — 자리수를 확인하거나 새 코드로 다시 시도해 주세요",
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
    timeout: "상대가 응답하지 않아요 — 코드를 새로 만들어 다시 시도해 주세요",
    closed: "연결이 끊어졌어요",
    badCode: "코드를 해석할 수 없어요 — 전체가 복사됐는지 확인해 주세요",
    cancel: "연결 그만두기",
  },

  transfer: {
    drop: "파일을 끌어다 놓거나 클릭해서 선택",
    sending: "보내는 중",
    receiving: "받는 중",
    waiting: "수락 대기",
    accept: "받기",
    decline: "거절",
    /**
     * 조건부 배지 — 디스크에 바로 못 쓸 때만 뜬다. 자세한 사정은 title로.
     * 사정은 두 가지다(브라우저가 못 묻거나, 사용자가 위치 고르기를 취소했거나) —
     * 문구가 둘 다에 참이어야 하므로 "이 브라우저는…"으로 못 박지 않는다.
     */
    memBadge: "메모리에 담김",
    memNote: "저장 위치를 정하지 못해 메모리에 담아요 — 큰 파일은 탭이 멈출 수 있어요",
    done: "완료",
    error: "중단됨",
    cancelled: "취소됨",
    stalled: "정체됨",
    cancel: "전송 중단",
    remain: "남음",
    save: "저장",
    dirIn: "받음",
    dirOut: "보냄",
    total: "전체",
    clear: "끝난 항목 비우기",
    textPlaceholder: "텍스트·링크 보내기",
    textSend: "보내기",
    textLabel: "텍스트",
  },
} as const;

/** 상대가 보내겠다고 알려 온 묶음 한 줄 — "파일 3개 · 1.2 GB". */
export function formatOffer(count: number, bytes: number): string {
  return `파일 ${count}개 · ${formatBytes(bytes)}`;
}

/** 사람 읽는 용량 표기. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 초당 속도. 0이면 표기하지 않는다(빈 문자열). */
export function formatRate(bytesPerSec: number): string {
  if (!(bytesPerSec > 0)) return "";
  return `${formatBytes(Math.round(bytesPerSec))}/s`;
}

/** 남은 시간. 알 수 없으면 빈 문자열. */
export function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  // 초로 먼저 올림한 뒤 나눈다 — 분과 초를 따로 반올림하면 "1분 60초"가 나온다.
  const total = Math.ceil(sec);
  if (total < 60) return `${total}초`;
  const min = Math.floor(total / 60);
  if (min < 60) return `${min}분 ${total % 60}초`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}
