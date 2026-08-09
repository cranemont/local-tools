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

  xpath: {
    title: "XPath 테스트",
    desc: "XML에 XPath 식 실시간 실행",
    expr: "XPath",
    exprPlaceholder: "//book[@lang='ko']/title",
    xmlPlaceholder: "XML 붙여넣기",
    result: "결과",
    matches: (n: number) => `${n}개 일치`,
    noMatch: "일치 없음",
    invalidXml: "XML로 해석할 수 없어요",
    invalidExpr: "XPath 식을 실행할 수 없어요",
    capped: "200개까지만 표시돼요",
    defaultNsNote:
      "기본 네임스페이스가 있는 문서예요 — 접두사 없는 이름은 매칭되지 않으니 *[local-name()='태그'] 형태를 쓰세요",
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

  cookie: {
    title: "쿠키 분석",
    desc: "Set-Cookie · Cookie 헤더 파싱과 진단",
    placeholder:
      "Set-Cookie: sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax\nCookie: a=1; b=2 — document.cookie 값도 붙여넣을 수 있어요",
    invalid: "쿠키로 해석할 수 없어요",
    reqHeader: "요청 쿠키",
    reqSummary: (n: number, bytes: number) => `${n}개 · ${bytes} bytes`,
    value: "값",
    expiry: "만료",
    session: "세션 쿠키",
    deletion: "과거 만료 — 삭제 지시",
    issues: {
      sameSiteNone: "SameSite=None에는 Secure가 필요해요 — 크롬이 저장을 거부해요",
      badSameSite: (v: string) => `SameSite=${v}는 유효한 값이 아니에요 (Strict·Lax·None)`,
      securePrefix: "__Secure- 이름에는 Secure 속성이 필요해요",
      hostPrefix: "__Host- 이름에는 Secure·Path=/가 필요하고 Domain이 없어야 해요",
      tooBig: "이름+값이 4096바이트를 넘어요 — 브라우저가 저장을 거부해요",
      noSameSite: "SameSite 미지정 — 크롬은 Lax로 취급해요",
      longExpiry: "만료가 400일을 넘어요 — 크롬은 400일로 줄여요",
    },
  },

  oauth: {
    title: "OAuth 헬퍼",
    desc: "인가·콜백 URL 분석, PKCE·state 생성",
    modeUrl: "URL 분석",
    modePkce: "PKCE 생성",
    placeholder:
      "https://auth.example.com/authorize?response_type=code&client_id=…\n인가 요청·콜백 URL, 쿼리 문자열만도 돼요",
    invalid: "URL이나 쿼리 문자열로 해석할 수 없어요",
    kindAuthz: "인가 요청",
    kindCallback: "콜백",
    kindError: "오류 콜백",
    fragment: "# 프래그먼트",
    jwtHint: "JWT — JWT 디코더에서 확인할 수 있어요",
    paramDesc: {
      response_type: "응답 방식 — code는 인가 코드 플로",
      client_id: "클라이언트 식별자",
      client_secret: "클라이언트 비밀키",
      redirect_uri: "인가 후 돌아올 주소",
      scope: "요청 권한 범위",
      state: "CSRF 방지용 무작위 값 — 콜백에서 일치 확인",
      nonce: "ID 토큰 재사용 방지 값 (OIDC)",
      code_challenge: "PKCE 챌린지 — verifier의 해시",
      code_challenge_method: "챌린지 방식 — S256 권장",
      code: "인가 코드 — 토큰 엔드포인트에서 교환",
      error: "인가 실패 코드",
      error_description: "실패 설명",
      access_token: "액세스 토큰",
      token_type: "토큰 종류",
      expires_in: "만료까지 남은 초",
      id_token: "ID 토큰 (OIDC)",
      refresh_token: "리프레시 토큰",
      grant_type: "토큰 요청 방식",
      prompt: "로그인·동의 화면 표시 방식 (OIDC)",
      login_hint: "로그인 계정 힌트",
      audience: "토큰 대상 API",
      resource: "토큰 대상 리소스",
    } as Record<string, string>,
    checks: {
      secretInUrl: "client_secret이 URL에 있어요 — 비밀키는 URL로 보내면 안 돼요",
      implicit: "response_type에 token — 암시적 플로는 더 이상 권장되지 않아요 (code + PKCE 권장)",
      noPkce: "code_challenge가 없어요 — 공개 클라이언트라면 PKCE를 쓰세요",
      plainMethod: "code_challenge_method=plain — S256을 권장해요",
    },
    generate: "새로 생성",
    pkceNote: "crypto.getRandomValues로 생성돼요 — 브라우저 밖으로 나가지 않아요",
  },

  saml: {
    title: "SAML 디코더",
    desc: "SAMLRequest·SAMLResponse 디코드와 요약",
    placeholder: "SAMLRequest·SAMLResponse 값 붙여넣기 — URL 전체나 XML 원문도 돼요",
    invalid: "SAML 메시지로 해석할 수 없어요 — base64·deflate·XML 어느 쪽도 아니에요",
    invalidXml: "XML로 해석할 수 없어요",
    bindingRedirect: "Redirect 바인딩 (deflate + base64)",
    bindingPost: "POST 바인딩 (base64)",
    bindingXml: "XML 원문",
    summary: "요약",
    typeLabel: {
      AuthnRequest: "인증 요청 (SP → IdP)",
      Response: "인증 응답 (IdP → SP)",
      LogoutRequest: "로그아웃 요청",
      LogoutResponse: "로그아웃 응답",
      ArtifactResolve: "아티팩트 조회",
      AttributeQuery: "속성 조회",
    } as Record<string, string>,
    validity: "유효 기간",
    valid: "유효",
    expired: "만료됨",
    notYet: "활성화 전",
    signature: "서명",
    signatureNone: "없음",
    signatureNote: "서명 위치만 표시해요 — 서명 검증은 하지 않아요",
    encryptedNote: "암호화된 Assertion이 있어요 — 여기서는 복호화할 수 없어요",
    attributes: "Attributes",
    xml: "XML",
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
