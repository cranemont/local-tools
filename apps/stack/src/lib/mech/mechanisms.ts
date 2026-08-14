// 건물 안 — 실제로 무슨 계산이 도는가.
//
// 지도와 도시는 "무엇이 무엇 위에 서 있나"까지만 답한다. 여기는 그 안의 기계다:
// 키 합의의 메시지 순서, 검증이 실패했을 때 어디서 멈추는가, 바이트가 어떻게 쌓이는가.
// 단순 파싱·직렬화처럼 그림이 설명을 더하지 못하는 것은 일부러 넣지 않았다.
//
// 모든 수치(반복 횟수·바이트 수·플래그)는 소스에서 확인한 값이다. src 경로는
// check-stack-sources.mjs가 실재를 강제한다.

export type MechKind = "sequence" | "flow" | "bytes";

// ── 시퀀스(프로토콜) ────────────────────────────────────────────
export interface Actor {
  id: string;
  label: string;
  note?: string;
  /** 성벽 밖 — 믿지 않는 참여자 */
  outside?: boolean;
}

export interface SeqRow {
  from: string;
  /** 없으면 자기 안에서 계산하는 단계 */
  to?: string;
  label: string;
  detail?: string;
  /** 봉인된(암호화된) 메시지 */
  sealed?: boolean;
}

export interface SequenceSpec {
  actors: Actor[];
  rows: SeqRow[];
  /** 중간에 앉은 쪽이 실제로 볼 수 있는 것 — 이 도식의 결론 */
  sees?: { actor: string; title: string; items: string[]; conclusion: string };
}

// ── 흐름(분기·게이트) ──────────────────────────────────────────
export interface FlowNode {
  id: string;
  label: string;
  note?: string;
  kind?: "input" | "step" | "gate" | "output" | "reject";
  col: number;
  row: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  kind?: "ok" | "fail";
}

export interface FlowSpec {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ── 바이트 배치 ────────────────────────────────────────────────
export interface ByteField {
  label: string;
  /** 막대 폭의 근거 — 실제 바이트 수(가변이면 대표값) */
  size: number;
  sub?: string;
  kind?: "magic" | "header" | "meta" | "payload" | "repeat";
}

export interface BytesSpec {
  fields: ByteField[];
  note: string;
}

export interface Mechanism {
  id: string;
  title: string;
  subtitle: string;
  kind: MechKind;
  /** 이 기계가 도는 기능·기술 — 상세 패널에서 여기로 들어간다 */
  features: string[];
  techs: string[];
  src: string[];
  sequence?: SequenceSpec;
  flow?: FlowSpec;
  bytes?: BytesSpec;
}

export const MECHANISMS: Mechanism[] = [
  // ────────────────────────────────────────────────────────────
  {
    id: "spake2",
    title: "SPAKE2로 6자리에서 키 만들기",
    subtitle:
      "숫자 6자리는 100만 가지뿐이다. 그런데도 릴레이가 본 기록만으로는 코드를 대입해 볼 수 없다 — 그 이유가 이 순서에 들어 있다.",
    kind: "sequence",
    features: ["drop-spake2", "drop-code"],
    techs: ["spake2", "noble", "subtlecrypto", "websocket"],
    src: ["apps/drop/src/lib/rtc/spake2.ts", "apps/drop/src/lib/rtc/rendezvous.ts"],
    sequence: {
      actors: [
        { id: "host", label: "호스트", note: "코드를 만든 쪽" },
        {
          id: "relay",
          label: "공개 릴레이 6곳",
          note: "만남의 장소일 뿐",
          outside: true,
        },
        { id: "guest", label: "게스트", note: "코드를 입력한 쪽" },
      ],
      rows: [
        {
          from: "host",
          label: "w = PBKDF2(코드, 21만 회) mod n",
          detail:
            "6자리가 곡선 스칼라 하나가 된다. 48바이트를 뽑아 위수로 나눠 편향을 지운다. 게스트도 똑같이 계산하므로 코드가 같으면 w가 같다.",
        },
        {
          from: "host",
          label: "x ← 난수 · pA = w·M + x·G",
          detail:
            "M은 RFC 9382 §6이 못 박아 둔 고정점. w를 M에 실어 보내므로 pA만 봐서는 w도 x도 뽑아낼 수 없다.",
        },
        { from: "host", to: "relay", label: "pA (65B)", detail: "방 태그 …a 에 게시" },
        { from: "relay", to: "guest", label: "pA" },
        {
          from: "guest",
          label: "y ← 난수 · pB = w·N + y·G · K = y·(pA − w·M)",
          detail: "w를 알아야 M 성분을 걷어낼 수 있다. 코드가 틀리면 여기서 다른 K가 나온다.",
        },
        {
          from: "guest",
          label: "TT = idA‖idB‖pA‖pB‖K‖w → SHA-256 → Ke‖Ka",
          detail:
            "각 조각 앞에 8바이트 길이를 붙여 이어 붙인다(RFC §3.3). Ka에서 HKDF로 확인용 키를 뽑아 confA·confB를 만든다.",
        },
        {
          from: "guest",
          to: "relay",
          label: "pB ‖ confB (65+32B)",
          detail: "방 태그 …b",
        },
        { from: "relay", to: "host", label: "pB ‖ confB" },
        {
          from: "host",
          label: "K = x·(pB − w·N) → 같은 TT → confB 상수시간 비교",
          detail:
            "여기서 처음으로 '코드가 맞았나'가 판가름 난다. 틀렸으면 조용히 무시하고 다음 후보를 기다린다.",
        },
        {
          from: "host",
          to: "relay",
          label: "confA ‖ AES-256-GCM(청약 SDP)",
          detail: "전송 키는 HKDF(Ke). 방 태그 …o",
          sealed: true,
        },
        { from: "relay", to: "guest", label: "confA ‖ 봉인된 청약", sealed: true },
        {
          from: "guest",
          to: "relay",
          label: "AES-256-GCM(응답 SDP)",
          detail: "방 태그 …r",
          sealed: true,
        },
        { from: "relay", to: "host", label: "봉인된 응답", sealed: true },
      ],
      sees: {
        actor: "relay",
        title: "릴레이가 볼 수 있는 것 전부",
        items: [
          "pA · pB — 공개 설계값. w가 고정점에 가려져 있다",
          "confA · confB — HMAC 태그. 코드를 넣어 봐야 맞는지 알 수 있다",
          "AES-256-GCM 암호문 — 열 수 없다",
          "코드에서만 유도되는 방 태그. 5분 뒤 만료(NIP-40)",
        ],
        conclusion:
          "코드 후보 하나를 검증하려면 매번 새 세션을 열어 상대의 응답을 받아내야 한다. 기록을 아무리 들여다봐도 맞았는지 알 수 없다 — 오프라인 대입이 막히는 지점이 바로 여기다.",
      },
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "webrtc-connect",
    title: "중간 서버 없이 통로 뚫기",
    subtitle:
      "연결 정보를 한 덩어리로 만들어 한 번에 교환한다. 파일은 이 통로가 열린 뒤에야 움직인다.",
    kind: "sequence",
    features: ["drop-peer", "drop-sdp", "drop-transfer"],
    techs: ["webrtc", "compressionstream", "sdpcodec"],
    src: [
      "apps/drop/src/lib/rtc/peer.ts",
      "apps/drop/src/lib/rtc/signal.ts",
      "apps/drop/src/lib/rtc/transfer.ts",
    ],
    sequence: {
      actors: [
        { id: "host", label: "호스트" },
        { id: "stun", label: "STUN", note: "주소 확인용", outside: true },
        { id: "guest", label: "게스트" },
      ],
      rows: [
        { from: "host", label: "RTCPeerConnection 생성 · 청약 SDP 작성" },
        {
          from: "host",
          to: "stun",
          label: "내 공인 주소가 뭐죠",
          detail:
            "같은 네트워크면 이 왕복이 아예 없다. 다른 네트워크일 때만 IP가 전달되고, 그때도 파일은 지나지 않는다.",
        },
        { from: "stun", to: "host", label: "당신은 203.0.113.x:54321" },
        {
          from: "host",
          label: "후보를 다 모을 때까지 기다린다 (non-trickle)",
          detail:
            "후보를 하나씩 흘려보내지 않아야 연결 정보가 코드 한 덩어리로 떨어진다. QR 한 장에 담기는 전제.",
        },
        {
          from: "host",
          label: "SDP → deflate-raw → base64url",
          detail: "브라우저 내장 CompressionStream. 긴 SDP가 복붙 한 줄로 줄어든다.",
        },
        { from: "host", to: "guest", label: "봉인된 청약", detail: "SPAKE2 키로 암호화", sealed: true },
        { from: "guest", label: "응답 SDP 작성 · 같은 방식으로 압축·봉인" },
        { from: "guest", to: "host", label: "봉인된 응답", sealed: true },
        {
          from: "host",
          to: "guest",
          label: "DTLS 핸드셰이크 → DataChannel 열림",
          detail:
            "여기서부터 중간이 없다. 받는 쪽이 수락하면 64KB 청크로 쪼개 보내고, 버퍼가 차거나 상대 디스크가 밀리면 멈췄다 잇는다.",
        },
      ],
      sees: {
        actor: "stun",
        title: "STUN 서버가 볼 수 있는 것",
        items: ["요청한 쪽의 공인 IP와 포트", "그게 전부 — SDP도 파일도 이쪽으로 가지 않는다"],
        conclusion:
          "STUN은 '내 주소가 밖에서 어떻게 보이나'를 되돌려 주는 거울일 뿐이다. 통로가 뚫린 뒤에는 아무 역할이 없다.",
      },
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "wasm-verify",
    title: "CDN에서 온 것을 실행하기 전에",
    subtitle:
      "이 저장소가 인터넷을 타는 세 지점은 전부 이 문을 지난다. 해시가 어긋나면 기능을 포기할지언정 실행하지 않는다.",
    kind: "flow",
    features: ["common-wasmloader", "pdf-password", "image-decode", "image-pipeline"],
    techs: ["wasmloader", "qpdf", "libheif", "libavif", "subtlecrypto"],
    src: [
      "packages/wasm-loader/index.js",
      "apps/pdf/src/lib/pdf/qpdfLoader.ts",
      "apps/image/src/lib/image/heic.ts",
    ],
    flow: {
      nodes: [
        {
          id: "need",
          label: "엔진이 필요해진 순간",
          note: "PDF 암호 탭·HEIC 열기·AVIF 굽기에서만. 그전에는 아무것도 받지 않는다",
          kind: "input",
          col: 0,
          row: 1,
        },
        {
          id: "glue",
          label: "글루 JS · <script integrity>",
          note: "브라우저가 SRI로 강제한다 — 어긋나면 스크립트가 아예 실행되지 않는다",
          col: 1,
          row: 0,
        },
        {
          id: "fetch",
          label: ".wasm 내려받기",
          note: "고정 버전 URL. 최신을 자동으로 따라가지 않는다",
          col: 1,
          row: 2,
        },
        {
          id: "digest",
          label: "SHA-384 계산",
          note: "crypto.subtle.digest — 받은 바이트 전체",
          col: 2,
          row: 2,
        },
        {
          id: "cmp",
          label: "소스에 박아 둔 해시와 같은가",
          kind: "gate",
          col: 3,
          row: 2,
        },
        {
          id: "blob",
          label: "검증된 바이트로 blob URL",
          note: "엔진의 locateFile이 이것만 가리킨다 — 다른 걸 받을 길이 없다",
          col: 4,
          row: 1,
        },
        { id: "run", label: "실행", kind: "output", col: 5, row: 1 },
        {
          id: "deny",
          label: "실행 거부",
          note: "버전을 올리고 해시를 다시 계산하지 않으면 여기로 떨어진다",
          kind: "reject",
          col: 4,
          row: 3,
        },
      ],
      edges: [
        { from: "need", to: "glue" },
        { from: "need", to: "fetch" },
        { from: "fetch", to: "digest" },
        { from: "digest", to: "cmp" },
        { from: "glue", to: "blob" },
        { from: "cmp", to: "blob", label: "일치", kind: "ok" },
        { from: "cmp", to: "deny", label: "불일치", kind: "fail" },
        { from: "blob", to: "run" },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "pdf-encrypt",
    title: "PDF 암호는 무엇을 잠그나",
    subtitle:
      "qpdf에 `--encrypt 암호 암호 256`으로 넘긴다 — PDF 2.0의 AES-256(R6). 파일 자체를 잠그는 것이지 뷰어에 부탁하는 게 아니다.",
    kind: "flow",
    features: ["pdf-password"],
    techs: ["qpdf", "wasmloader"],
    src: ["apps/pdf/src/lib/pdf/qpdfLoader.ts", "apps/pdf/src/lib/password/Password.svelte"],
    flow: {
      nodes: [
        {
          id: "in",
          label: "PDF + 암호",
          note: "사용자·소유자 암호를 같은 값으로 넘긴다",
          kind: "input",
          col: 0,
          row: 0,
        },
        {
          id: "fek",
          label: "파일 암호화 키 생성",
          note: "난수 256비트. 암호에서 직접 만들지 않는다",
          col: 1,
          row: 0,
        },
        {
          id: "wrap",
          label: "암호에서 유도한 키로 감싸기",
          note: "감싼 결과가 /U /O /UE /OE 로 문서에 들어간다",
          col: 2,
          row: 0,
        },
        {
          id: "enc",
          label: "스트림·문자열을 AES-256으로 암호화",
          note: "페이지 내용·글꼴·이미지가 대상. 구조는 열려 있어야 뷰어가 찾아간다",
          col: 3,
          row: 0,
        },
        { id: "out", label: "암호 PDF", kind: "output", col: 4, row: 0 },
        {
          id: "open",
          label: "열 때는 반대로",
          note: "암호로 감싼 걸 풀어 파일 키를 되찾고 스트림을 복호화한다",
          col: 2,
          row: 1,
        },
      ],
      edges: [
        { from: "in", to: "fek" },
        { from: "fek", to: "wrap" },
        { from: "wrap", to: "enc" },
        { from: "enc", to: "out" },
        { from: "out", to: "open", label: "해제", kind: "ok" },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "pkce",
    title: "가로챈 인가 코드가 쓸모없어지는 이유",
    subtitle: "비밀을 먼저 감춰 두고 나중에 원본을 내민다. 순서가 전부인 장치.",
    kind: "flow",
    features: ["dev-oauth"],
    techs: ["subtlecrypto", "cryptorandom"],
    src: ["apps/dev/src/lib/tools/OAuthTool.svelte"],
    flow: {
      nodes: [
        {
          id: "v",
          label: "verifier ← 난수",
          note: "43~128자. 이 값은 내 브라우저 밖으로 나가지 않는다",
          kind: "input",
          col: 0,
          row: 0,
        },
        {
          id: "c",
          label: "challenge = base64url(SHA-256(verifier))",
          note: "되돌릴 수 없는 방향으로 한 번 접는다",
          col: 1,
          row: 0,
        },
        {
          id: "auth",
          label: "인가 요청에 challenge 동봉",
          note: "code_challenge_method=S256",
          col: 2,
          row: 0,
        },
        {
          id: "code",
          label: "인가 코드 수신",
          note: "리다이렉트로 돌아온다 — 가로채기 쉬운 구간",
          col: 3,
          row: 0,
        },
        {
          id: "tok",
          label: "토큰 요청에 verifier 동봉",
          note: "이제서야 원본을 내민다",
          col: 4,
          row: 0,
        },
        {
          id: "chk",
          label: "서버가 SHA-256(verifier)를 다시 계산해 대조",
          kind: "gate",
          col: 5,
          row: 0,
        },
        { id: "ok", label: "토큰 발급", kind: "output", col: 6, row: 0 },
        {
          id: "no",
          label: "거부",
          note: "코드만 훔친 쪽은 verifier를 모른다 — 여기서 걸린다",
          kind: "reject",
          col: 6,
          row: 1,
        },
      ],
      edges: [
        { from: "v", to: "c" },
        { from: "c", to: "auth" },
        { from: "auth", to: "code" },
        { from: "code", to: "tok" },
        { from: "tok", to: "chk" },
        { from: "chk", to: "ok", label: "일치", kind: "ok" },
        { from: "chk", to: "no", label: "불일치", kind: "fail" },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "video-cut",
    title: "자르는 방식이 둘인 이유",
    subtitle:
      "영상은 아무 데서나 잘리지 않는다. 키프레임 경계를 존중할지, 다시 구워서 정확히 자를지를 고르는 것.",
    kind: "flow",
    features: ["video-exact", "video-lossless", "video-probe"],
    techs: ["mediabunny", "webcodecs"],
    src: ["apps/video/src/lib/video/probe.ts", "apps/video/src/lib/video/transcode.ts"],
    flow: {
      nodes: [
        {
          id: "probe",
          label: "probe — 키프레임 위치 읽기",
          note: "여기서 '어디서 자를 수 있나'가 정해진다",
          kind: "input",
          col: 0,
          row: 1,
        },
        { id: "mode", label: "컷 방식", kind: "gate", col: 1, row: 1 },
        {
          id: "exact",
          label: "정확 컷 — 디코드 → 재인코딩",
          note: "지정한 지점에서 정확히 잘린다. 대신 화질이 한 번 깎이고 느리다. 오디오는 가능하면 복사",
          col: 2,
          row: 0,
        },
        {
          id: "loss",
          label: "무손실 컷 — 패킷 복사",
          note: "트랙 옵션을 비우면 스마트 패스스루. 빠르고 손실이 없지만 키프레임 경계로만 잘린다",
          col: 2,
          row: 2,
        },
        { id: "mux", label: "먹싱 → MP4 · WebM", kind: "output", col: 3, row: 1 },
      ],
      edges: [
        { from: "probe", to: "mode" },
        { from: "mode", to: "exact", label: "정확", kind: "ok" },
        { from: "mode", to: "loss", label: "무손실", kind: "ok" },
        { from: "exact", to: "mux" },
        { from: "loss", to: "mux" },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "gif-quantize",
    title: "1600만 색을 256색으로 줄이기",
    subtitle: "GIF가 감당하는 건 프레임당 256색뿐이다. 무엇을 버릴지 고르는 과정이 화질을 정한다.",
    kind: "flow",
    features: ["gif-encode"],
    techs: ["gifenc", "offscreencanvas"],
    src: ["apps/gif/src/lib/gif/encode.ts", "apps/gif/src/lib/gif/transform.ts"],
    flow: {
      nodes: [
        {
          id: "frame",
          label: "렌더된 프레임 (RGBA)",
          note: "회전·크롭까지 적용된 최종 픽셀",
          kind: "input",
          col: 0,
          row: 0,
        },
        { id: "hist", label: "색 분포 수집", col: 1, row: 0 },
        {
          id: "pal",
          label: "256색 팔레트 선정",
          note: "프레임마다 새로 뽑는다 — 장면이 바뀌면 쓸 색도 달라지므로",
          col: 2,
          row: 0,
        },
        {
          id: "map",
          label: "가장 가까운 팔레트 색으로 매핑",
          note: "여기서 그라데이션이 계단으로 변한다",
          col: 3,
          row: 0,
        },
        {
          id: "lzw",
          label: "LZW 인코딩",
          note: "같은 색이 이어질수록 잘 줄어든다 — 디더를 세게 넣으면 용량이 커지는 이유",
          col: 4,
          row: 0,
        },
        { id: "out", label: "GIF 프레임 + 딜레이", kind: "output", col: 5, row: 0 },
      ],
      edges: [
        { from: "frame", to: "hist" },
        { from: "hist", to: "pal" },
        { from: "pal", to: "map" },
        { from: "map", to: "lzw" },
        { from: "lzw", to: "out" },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "webp-anmf",
    title: "애니메이션 WebP를 손으로 조립하기",
    subtitle:
      "정지 프레임은 브라우저가 굽는다. 직접 짠 건 그것들을 이어 붙이는 이 컨테이너뿐이라 libwebp wasm이 필요 없다.",
    kind: "bytes",
    features: ["gif-webp"],
    techs: ["webpmux", "converttoblob"],
    src: ["apps/gif/src/lib/gif/webp.ts"],
    bytes: {
      fields: [
        { label: "RIFF", size: 4, sub: "매직", kind: "magic" },
        { label: "파일 크기", size: 4, sub: "LE32", kind: "header" },
        { label: "WEBP", size: 4, sub: "폼 타입", kind: "magic" },
        {
          label: "VP8X",
          size: 18,
          sub: "청크 헤더 8B + 페이로드 10B — 애니메이션·알파 플래그, 캔버스 크기",
          kind: "meta",
        },
        { label: "ANIM", size: 14, sub: "헤더 8B + 배경색 4B + 반복 횟수 2B", kind: "meta" },
        {
          label: "ANMF 헤더",
          size: 24,
          sub: "프레임마다 — 위치·크기·딜레이·합성 방식(전체 프레임을 매번 쓰므로 블렌딩 안 함)",
          kind: "repeat",
        },
        {
          label: "프레임 비트스트림",
          size: 90,
          sub: "정지 WebP에서 뽑아낸 VP8/VP8L (+ALPH). 여기가 실제 그림",
          kind: "payload",
        },
      ],
      note: "ANMF 헤더 + 비트스트림이 프레임 수만큼 반복된다. 막대 폭은 실제 바이트 수에 비례하되 마지막 두 칸은 프레임 한 장 기준이다 — 실제 파일에서는 이 두 칸이 거의 전부를 차지한다.",
    },
  },

  // ────────────────────────────────────────────────────────────
  {
    id: "exif-embed",
    title: "재인코딩하고도 촬영 정보를 지키기",
    subtitle:
      "다시 구우면 EXIF는 통째로 사라진다. 원본에서 떼어 둔 세그먼트를 정확한 자리에 도로 끼워 넣는 일.",
    kind: "bytes",
    features: ["image-exif"],
    techs: ["exifbytes", "exifr"],
    src: ["apps/image/src/lib/image/exif.ts"],
    bytes: {
      fields: [
        { label: "SOI", size: 2, sub: "FF D8 — 파일 시작", kind: "magic" },
        { label: "APP1 마커", size: 2, sub: "FF E1", kind: "header" },
        { label: "길이", size: 2, sub: "빅엔디언 16비트 — 세그먼트가 64KB를 못 넘는 이유", kind: "header" },
        { label: "Exif\\0\\0", size: 6, sub: "식별자", kind: "magic" },
        { label: "TIFF 헤더 + IFD", size: 40, sub: "바이트 순서·촬영 정보·방향 태그", kind: "meta" },
        { label: "나머지 JPEG", size: 120, sub: "양자화 테이블·허프만 테이블·스캔 데이터", kind: "payload" },
      ],
      note: "끼워 넣는 자리는 SOI 바로 뒤다. WebP는 RIFF의 EXIF 청크, PNG는 eXIf 청크로 같은 일을 한다 — 컨테이너만 다르고 원리는 같다. 방향 태그는 미리 픽셀에 반영해 중립화한 뒤 다시 심는다(안 그러면 두 번 회전된다).",
    },
  },
];

export const MECH_BY_ID = new Map(MECHANISMS.map((m) => [m.id, m]));

/** 기능·기술 id → 그 안을 설명하는 기계들 */
export function mechanismsFor(id: string): Mechanism[] {
  return MECHANISMS.filter((m) => m.features.includes(id) || m.techs.includes(id));
}

/** 기계가 딸린 기능 id 전부 — 도시에서 표식을 세울 때 쓴다 */
export const FEATURES_WITH_MECH = new Set(MECHANISMS.flatMap((m) => m.features));
