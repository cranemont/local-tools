// 이 페이지의 내용물 전체 — 앱·기능·기술과 그 사이의 연결.
//
// i18n.ts에는 UI 껍데기 문구만 두고, 지도에 그려지는 내용은 데이터라서 여기 모았다
// (한국어 전용 정책은 i18n.ts와 동일 — 영어를 붙일 땐 label/note만 갈래를 늘리면 된다).
//
// ⚠️ src 경로는 장식이 아니다. scripts/check-stack-sources.mjs가 `pnpm check`에서
//    모든 경로의 실재를 검증한다 — 파일을 옮기면 CI가 빨갛게 뜬다. 설명이 코드보다
//    먼저 낡는 걸 막는 유일한 장치이므로 경로를 지우지 말 것.

/**
 * 기술의 성격.
 *
 * 예전엔 "빌드·기반"이 하나 더 있었다(Vite·Svelte·토큰·자가해제). 뺐다 —
 * 이 지도는 **데이터가 어디로 흐르는가**를 말하는 곳이고, 빌드 도구는 그 흐름에
 * 등장하지 않는다. 무엇으로 컴파일했는지는 저장소를 열면 보이지만, 파일이 무엇으로
 * 바뀌어 어디로 나가는지는 코드를 읽어도 잘 안 보이니까.
 */
export type TechKind = "native" | "lib" | "own" | "wasm";

export type AppId =
  | "pdf"
  | "gif"
  | "video"
  | "image"
  | "sheet"
  | "doc"
  | "drop"
  | "dev"
  | "lab"
  | "stack"
  | "common";

/** 통로 한 겹 — 아래(전송)에서 위(앱 프로토콜)로 쌓는다. */
export interface NetLayer {
  label: string;
  note: string;
}

/**
 * 네트워크를 타는 기술만 채운다 — 실제로 어디에 붙고 그 위에 무엇이 얹히는가.
 *
 * ⚠️ hosts는 장식이 아니다. check-stack-sources.mjs가 각 문자열이 src의 파일에
 *    실제로 적혀 있는지 대조한다 — 릴레이 목록이나 CDN이 바뀌면 CI가 잡는다.
 */
export interface NetLink {
  /** 붙는 곳 — 소스에 적힌 호스트 그대로 */
  hosts: string[];
  /** 아래에서 위로 쌓은 계층. 마지막이 앱 프로토콜. */
  layers: NetLayer[];
  /** 이 통로로 무엇이 지나가는가 — 파일이 지나는지 아닌지가 요점 */
  carries: string;
}

export interface Tech {
  id: string;
  label: string;
  kind: TechKind;
  /** 번들에 들어가는 서드파티만 — npm 패키지 이름.
   *  check-stack-sources.mjs가 각 앱 package.json의 dependencies와 양방향으로 대조한다
   *  (의존성을 새로 넣고 지도에 안 적으면 CI가 잡는다). */
  pkg?: string;
  /** 네트워크를 타는 것만 채운다 — 짧은 사유. 나머지는 전부 오프라인. */
  network?: string;
  /** network가 있으면 같이 채운다 — 도시가 성벽 밖 설비를 이걸로 세운다. */
  net?: NetLink;
  note: string;
  /** 저장소 기준 상대 경로 (실재 검증 대상) */
  src: string[];
}

export interface Feature {
  id: string;
  app: AppId;
  label: string;
  note: string;
  /** Tech.id 목록 */
  techs: string[];
  src: string[];
  /** 있으면 상세 패널에서 파이프라인 뷰로 들어갈 수 있다 */
  pipeline?: string;
}

export interface AppMeta {
  id: AppId;
  label: string;
  blurb: string;
  /** 배포 경로 — 출입구는 앱이 아니라서 없다 */
  path: string | null;
  /** 도구가 아니라 이 페이지 자신 — "도구 N개" 셈에서 빠진다 */
  meta?: boolean;
}

export const KIND_LABEL: Record<TechKind, string> = {
  native: "브라우저 네이티브",
  lib: "순수 JS 라이브러리",
  own: "직접 구현",
  wasm: "wasm (지연 로드)",
};

export const KIND_NOTE: Record<TechKind, string> = {
  native: "브라우저가 이미 갖고 있어서 가져다 쓰기만 한 것",
  lib: "번들에 들어가는 서드파티 — 전부 순수 JS",
  own: "쓸 만한 게 없거나 너무 무거워서 직접 짠 것",
  wasm: "유일하게 인터넷이 필요한 지점 — 엔진 최초 1회(그 뒤로는 캐시)",
};

/**
 * 도구 이름·한 줄 설명은 **랜딩(site/index.html)의 카드가 정본**이다.
 * 여기서 따로 짓지 말 것 — 예전엔 dev가 "개발자 유틸 / 도구 16종"이라 홈과 달랐고,
 * 같은 도구가 화면마다 다른 이름으로 불렸다. 카드 문구를 고치면 여기도 같이 고친다.
 */
export const APPS: AppMeta[] = [
  { id: "pdf", label: "PDF", blurb: "병합 · 정리 · 텍스트 추출 · 암호", path: "../pdf/" },
  { id: "gif", label: "GIF", blurb: "프레임 편집 · 자막 · 동영상 변환 · WebP·MP4", path: "../gif/" },
  { id: "video", label: "동영상", blurb: "자르기 · 압축 · 변환 · 소리 추출", path: "../video/" },
  { id: "image", label: "이미지", blurb: "변환 · 압축 · 리사이즈 · EXIF", path: "../image/" },
  { id: "sheet", label: "시트", blurb: "CSV · 엑셀 · 수식 · 필터", path: "../sheet/" },
  { id: "doc", label: "문서", blurb: "한글 · 워드 열기 · 마크다운 변환", path: "../doc/" },
  { id: "drop", label: "드롭", blurb: "기기 간 직접 전송 · 서버 없음", path: "../drop/" },
  { id: "dev", label: "개발자 도구", blurb: "JSON 변환 · diff · QR · 해시", path: "../dev/" },
  { id: "lab", label: "실험장", blurb: "임베딩 모델 비교 · 한국어 프로브", path: "../lab/" },
  {
    id: "stack",
    label: "기술 지도",
    blurb: "도구 아홉 개가 어떤 기술 위에 서 있는지 3D 도시로. 무엇이 네트워크를 타는지도 표시",
    path: "../stack/",
    meta: true,
  },
  // 도구가 아니라 파일이 드나드는 자리 — 나가는 출구(다운로드)와
  // 바깥에서 들어오는 것을 검사하는 문(wasm 검증) 둘뿐이다.
  { id: "common", label: "출입구", blurb: "파일이 나가는 곳 · 바깥에서 들어오는 것", path: null },
];

/**
 * wasm 엔진 셋은 받는 경로만 다르고 통로가 똑같다 — 한 번만 적고 셋이 나눠 쓴다.
 * (packages/wasm-loader/index.js가 세 곳 모두의 검증을 맡는다.)
 */
const cdnLink = (what: string): NetLink => ({
  hosts: ["cdn.jsdelivr.net"],
  layers: [
    { label: "TCP/IP", note: "https:// 라서 443." },
    { label: "TLS", note: "버전은 브라우저가 협상한다." },
    { label: "HTTPS", note: "버전을 박아 둔 URL만 부른다 — latest 태그를 안 쓴다." },
    {
      label: "SHA-384 검증",
      note: "글루 JS는 <script integrity>로 브라우저가 강제하고, .wasm은 받아서 직접 해시를 맞춰 본다. 어긋나면 실행하지 않는다(fail-closed).",
    },
  ],
  carries: `${what} — 최초 1회만, 사용자 파일은 올라가지 않는다`,
});

export const TECHS: Tech[] = [
  // ── 브라우저 네이티브 ────────────────────────────────────────
  {
    id: "imagedecoder",
    label: "ImageDecoder",
    kind: "native",
    note: "GIF 프레임을 필요할 때만 하나씩 디코딩한다. 브라우저 내장 디코더라 GIF 파서를 직접 짤 일이 없었다.",
    src: ["apps/gif/src/lib/gif/decode.ts"],
  },
  {
    id: "webcodecs",
    label: "WebCodecs",
    kind: "native",
    note: "실제 영상 인코딩·디코딩은 전부 여기서 한다. mediabunny는 그 위에서 컨테이너만 다룬다 — ffmpeg wasm이 필요 없는 이유.",
    src: ["apps/gif/src/lib/gif/mp4.ts", "apps/video/src/lib/video/transcode.ts"],
  },
  {
    id: "offscreencanvas",
    label: "OffscreenCanvas",
    kind: "native",
    note: "프레임 렌더·회전·크롭의 작업대.",
    src: ["apps/gif/src/lib/gif/transform.ts", "apps/gif/src/lib/gif/mp4.ts"],
  },
  {
    id: "converttoblob",
    label: "canvas.convertToBlob",
    kind: "native",
    note: "WebP·PNG 인코딩을 브라우저에 맡긴다. libwebp wasm을 번들에 넣지 않는 대신 이걸 쓴다.",
    src: ["apps/gif/src/lib/gif/webp.ts", "apps/gif/src/lib/gif/extract.ts"],
  },
  {
    id: "canvas2d",
    label: "Canvas 2D · toBlob",
    kind: "native",
    note: "PDF 래스터와 이미지 파이프라인의 출력단.",
    src: ["apps/pdf/src/lib/pdf/rasterize.ts", "apps/image/src/lib/image/pipeline.ts"],
  },
  {
    id: "createimagebitmap",
    label: "createImageBitmap",
    kind: "native",
    note: "디코딩된 픽셀을 GPU 친화적인 형태로 들고 있는다. LRU 캐시의 저장 단위.",
    src: ["apps/image/src/lib/image/decode.ts", "apps/gif/src/lib/gif/decode.ts"],
  },
  {
    id: "compressionstream",
    label: "CompressionStream · DecompressionStream",
    kind: "native",
    note: "deflate-raw 하나로 세 군데를 해결한다 — 번들 자가해제, 드롭의 연결정보 압축, SAML 디코드.",
    src: [
      "packages/vite-plugin-self-extracting/index.js",
      "apps/drop/src/lib/rtc/signal.ts",
      "apps/dev/src/lib/tools/Saml.svelte",
    ],
  },
  {
    id: "subtlecrypto",
    label: "Web Crypto · SubtleCrypto",
    kind: "native",
    note: "SHA·HMAC·PBKDF2·P-256. 해시 도구부터 SPAKE2 키 합의까지 전부 브라우저 구현을 쓴다.",
    src: [
      "apps/dev/src/lib/tools/Hash.svelte",
      "apps/drop/src/lib/rtc/spake2.ts",
      "packages/wasm-loader/index.js",
    ],
  },
  {
    id: "cryptorandom",
    label: "crypto.randomUUID · getRandomValues",
    kind: "native",
    note: "UUID v4와 드롭의 6자리 코드가 같은 CSPRNG에서 나온다.",
    src: ["apps/dev/src/lib/tools/Uuid.svelte", "apps/drop/src/lib/rtc/rendezvous.ts"],
  },
  {
    id: "webrtc",
    label: "RTCPeerConnection · DataChannel",
    kind: "native",
    network: "기기 간 직접 (P2P·DTLS)",
    net: {
      hosts: ["stun.l.google.com:19302"],
      layers: [
        { label: "UDP/IP", note: "ICE가 고른 주소 한 쌍. 그 사이에 중계 서버가 없다." },
        {
          label: "ICE",
          note: "STUN 바인딩으로 공인 주소(srflx)를 알아낸다. TURN은 적지 않았다 — 중계로 물러설 곳이 없다는 뜻이고, 대신 파일이 남의 서버를 지나지 않는다.",
        },
        { label: "DTLS", note: "채널 암호화. 인증서 지문은 SDP에 실려 상대에게 간다." },
        { label: "SCTP", note: "DataChannel의 전송 계층 — ordered · reliable." },
        {
          label: 'DataChannel "drop"',
          note: "파일이 지나가는 유일한 통로. 이름까지 이 하나뿐이다.",
        },
        {
          label: "직접 정한 프레임 11종",
          note: "hello · offer/accept/decline/withdraw · file/eof/ack · flow · cancel · text — JSON 한 줄이 프레임 하나다. 파일은 64KB 청크로 보내다 송신 버퍼가 8MB를 넘으면 멈추고 1MB로 빠지면 잇고, 받는 쪽은 디스크에 앉힌 만큼을 ack로 되알린다. 모르는 프레임은 조용히 버리는 규칙이라 예전 판 상대와도 깨지지 않는다 — ack를 나중에 얹을 수 있었던 자리가 여기다.",
        },
      ],
      carries: "파일 본체 — 이 통로에만 흐른다",
    },
    note: "파일이 지나가는 유일한 통로. 중간 서버가 없고 전송은 DTLS로 암호화된다.",
    src: [
      "apps/drop/src/lib/rtc/peer.ts",
      "apps/drop/src/lib/rtc/transfer.ts",
      "apps/drop/src/lib/rtc/frames.ts",
    ],
  },
  {
    id: "websocket",
    label: "WebSocket",
    kind: "native",
    network: "공개 Nostr 릴레이 6곳",
    net: {
      hosts: [
        "relay.damus.io",
        "nos.lol",
        "relay.primal.net",
        "offchain.pub",
        "nostr.mom",
        "relay.nostr.band",
      ],
      layers: [
        { label: "TCP/IP", note: "wss:// 라서 443. 여섯 곳에 동시에 건다." },
        { label: "TLS", note: "버전은 브라우저가 협상한다 — 코드가 정하지 않는다." },
        { label: "WebSocket", note: "핸드셰이크 뒤엔 프레임 단위 양방향." },
        {
          label: "NIP-01",
          note: 'JSON 배열 세 가지뿐이다 — ["EVENT", 이벤트] · ["REQ", 구독id, 필터] · ["CLOSE", 구독id].',
        },
        {
          label: "kind 30078",
          note: "NIP-78 앱 데이터. 태그 #d에 코드에서 유도한 방 이름을 걸고, expiration으로 5분 뒤 만료시킨다.",
        },
      ],
      carries: "SPAKE2 공개값과 암호문 — 파일은 지나지 않는다",
    },
    note: "6자리 코드로 서로를 찾는 만남의 장소. 릴레이가 보는 건 SPAKE2 공개값과 암호문뿐이고 파일은 지나지 않는다.",
    src: ["apps/drop/src/lib/rtc/nostr.ts"],
  },
  {
    id: "barcodedetector",
    label: "BarcodeDetector",
    kind: "native",
    note: "QR 인식. 크로미엄 내장이라 zxing 같은 라이브러리를 안 넣는다.",
    src: ["apps/dev/src/lib/tools/Qr.svelte", "apps/drop/src/lib/editor/ScanDialog.svelte"],
  },
  {
    id: "mediadevices",
    label: "getUserMedia",
    kind: "native",
    note: "드롭의 QR 스캔 카메라. 영상은 화면 밖으로 나가지 않는다.",
    src: ["apps/drop/src/lib/editor/ScanDialog.svelte"],
  },
  {
    id: "xpath",
    label: "document.evaluate · XPath 1.0",
    kind: "native",
    note: "XPath 엔진이 브라우저에 이미 들어 있다. 평가기를 직접 만들 이유가 없었다.",
    src: ["apps/dev/src/lib/tools/Xpath.svelte"],
  },
  {
    id: "worker",
    label: "Web Worker · 인라인 번들",
    kind: "native",
    note: "pdf.js 워커를 `?worker&inline`으로 번들에 넣는다. 외부 워커 파일을 받아오지 않아야 단일 HTML이 유지된다.",
    src: ["apps/pdf/src/lib/pdf/pdfjs.ts"],
  },
  {
    id: "webgl",
    label: "WebGL2",
    kind: "native",
    note: "도시를 실제로 그리는 창구. 브라우저가 GPU를 열어 준다.",
    src: ["apps/stack/src/lib/city/scene.ts"],
  },
  {
    id: "pointerlock",
    label: "Pointer Lock",
    kind: "native",
    note: "거리 시점에서 마우스를 화면에 가둔다. 걸어 다니는 시점의 전제.",
    src: ["apps/stack/src/lib/city/scene.ts"],
  },
  {
    id: "textdecoder",
    label: "TextDecoder",
    kind: "native",
    note: "브라우저가 euc-kr(cp949)를 이미 안다. UTF-8로 엄격하게 읽어 보고 실패하면 cp949로 넘어가는 두 줄이 인코딩 라이브러리를 통째로 대신한다.",
    src: ["apps/sheet/src/lib/sheet/csv.ts"],
  },
  {
    id: "filehandler",
    label: "File Handling API",
    kind: "native",
    note: "설치된 PWA가 .csv·.xlsx의 열기 대상이 된다. 맥에서 CSV 더블클릭이 Numbers로 가는 걸 브라우저 안에서 바꿀 수 있는 유일한 방법이라, 시트만 PWA 빌드를 따로 낸다.",
    src: ["apps/sheet/src/lib/launch.ts", "apps/sheet/pwa.ts"],
  },
  {
    id: "filesystemaccess",
    label: "File System Access",
    kind: "native",
    note: "받은 파일을 메모리에 쌓지 않고 디스크로 흘려보낸다(드롭 수신 전용). 피커는 사용자 제스처 안에서만 열려서, 저장 위치는 '받기'를 누른 그 클릭에서 미리 받아 둔다. 못 쓰면 <a download>로 물러난다.",
    src: ["apps/drop/src/lib/rtc/sink.ts"],
  },
  {
    id: "adownload",
    label: "<a download>",
    kind: "native",
    note: "만들어 낸 결과물은 전부 표준 다운로드로 나간다. 크롬 다운로드 목록에 뜨고 저장 위치가 헷갈리지 않는다는 이유로 되돌린 결정(용량을 모르는 드롭 수신만 예외).",
    src: ["apps/pdf/src/lib/pdf/save.ts", "apps/gif/src/lib/gif/save.ts"],
  },

  // ── 순수 JS 라이브러리 ───────────────────────────────────────
  {
    id: "pdflib",
    label: "pdf-lib",
    kind: "lib",
    pkg: "pdf-lib",
    note: "페이지 조립·회전·이미지 임베드. 내보내기 담당.",
    src: ["apps/pdf/src/lib/pdf/exporter.ts"],
  },
  {
    id: "pdfjs",
    label: "pdfjs-dist v6",
    kind: "lib",
    pkg: "pdfjs-dist",
    note: "읽기 담당 — 썸네일과 래스터. 보조 디코더(JBIG2·JPEG2000)는 번들에 없다.",
    src: ["apps/pdf/src/lib/pdf/engine.ts", "apps/pdf/src/lib/pdf/rasterize.ts"],
  },
  {
    id: "mediabunny",
    label: "mediabunny",
    kind: "lib",
    pkg: "mediabunny",
    note: "순수 TS 디먹싱·먹싱. 코덱은 WebCodecs가 하고 이쪽은 컨테이너만 만진다 — 그래서 wasm이 없다.",
    src: ["apps/video/src/lib/video/transcode.ts", "apps/gif/src/lib/gif/video.ts"],
  },
  {
    id: "exceljs",
    label: "ExcelJS",
    kind: "lib",
    pkg: "exceljs",
    note: "xlsx 읽기·쓰기. 서식(글꼴·채우기·테두리·표시 형식)까지 왕복하는 게 선택 이유다 — SheetJS 무료판은 스타일 쓰기가 빠져 있다. 압축 전 848kB라 xlsx를 실제로 열 때만 동적 로드한다.",
    src: ["apps/sheet/src/lib/sheet/xlsx.ts"],
  },
  {
    id: "formulajs",
    label: "@formulajs/formulajs",
    kind: "lib",
    pkg: "@formulajs/formulajs",
    note: "엑셀 함수 300여 개의 구현체. 계산 순서와 오류 전파는 이쪽이 모르므로 직접 짠 엔진이 감싼다.",
    src: ["apps/sheet/src/lib/formula/functions.ts"],
  },
  {
    id: "gifenc",
    label: "gifenc",
    kind: "lib",
    pkg: "gifenc",
    note: "팔레트 양자화와 GIF 인코딩.",
    src: ["apps/gif/src/lib/gif/encode.ts"],
  },
  {
    id: "pica",
    label: "pica",
    kind: "lib",
    pkg: "pica",
    note: "고품질 리샘플. canvas 기본 축소보다 결과가 낫다.",
    src: ["apps/image/src/lib/image/pipeline.ts"],
  },
  {
    id: "exifr",
    label: "exifr",
    kind: "lib",
    pkg: "exifr",
    note: "EXIF 읽기 전용 — 보여주기용 파싱만 맡는다. 쓰기는 직접 한다.",
    src: ["apps/image/src/lib/image/exif.ts"],
  },
  {
    id: "fflate",
    label: "fflate",
    kind: "lib",
    pkg: "fflate",
    note: "ZIP 묶기. 세 앱이 공유하는 유일한 저장 포맷 라이브러리.",
    src: ["apps/gif/src/lib/gif/extract.ts", "apps/image/src/lib/image/save.ts"],
  },
  {
    id: "noble",
    label: "@noble/curves",
    kind: "lib",
    pkg: "@noble/curves",
    note: "P-256(SPAKE2)과 secp256k1(Nostr 서명). 감사받은 순수 TS 구현.",
    src: ["apps/drop/src/lib/rtc/spake2.ts", "apps/drop/src/lib/rtc/nostr.ts"],
  },
  {
    id: "uqr",
    label: "uqr",
    kind: "lib",
    pkg: "uqr",
    note: "QR 생성. 읽기는 브라우저 내장 BarcodeDetector가 한다.",
    src: ["apps/drop/src/lib/editor/QrCode.svelte", "apps/dev/src/lib/tools/Qr.svelte"],
  },
  {
    id: "culori",
    label: "culori",
    kind: "lib",
    pkg: "culori",
    note: "OKLCH 변환과 sRGB 가멋 판정. 테마 토큰이 OKLCH라 도구도 같은 좌표계를 쓴다.",
    src: ["apps/dev/src/lib/tools/Color.svelte"],
  },
  {
    id: "diff",
    label: "diff",
    kind: "lib",
    pkg: "diff",
    note: "줄·단어 단위 텍스트 비교.",
    src: ["apps/dev/src/lib/tools/Diff.svelte"],
  },
  {
    id: "jsyaml",
    label: "js-yaml",
    kind: "lib",
    pkg: "js-yaml",
    note: "YAML 파싱·직렬화.",
    src: ["apps/dev/src/lib/tools/Format.svelte"],
  },
  {
    id: "fxp",
    label: "fast-xml-parser",
    kind: "lib",
    pkg: "fast-xml-parser",
    note: "XML ↔ JSON 변환.",
    src: ["apps/dev/src/lib/tools/Format.svelte"],
  },
  {
    id: "croner",
    label: "croner",
    kind: "lib",
    pkg: "croner",
    note: "크론 식에서 다음 실행 시각을 계산한다.",
    src: ["apps/dev/src/lib/tools/CronTool.svelte"],
  },
  {
    id: "cronstrue",
    label: "cronstrue",
    kind: "lib",
    pkg: "cronstrue",
    note: "크론 식을 한국어 문장으로 풀어 준다.",
    src: ["apps/dev/src/lib/tools/CronTool.svelte"],
  },

  {
    id: "three",
    label: "three.js",
    kind: "lib",
    pkg: "three",
    note: "도시 뷰의 렌더링·카메라·그림자. 이 저장소에서 유일하게 무거운 의존성이라, 이 앱만 단일 HTML을 포기하고 도시를 열 때만 내려받도록 떼어 놨다.",
    src: ["apps/stack/src/lib/city/scene.ts"],
  },

  // ── 직접 구현 ────────────────────────────────────────────────
  {
    id: "webpmux",
    label: "WebP ANMF muxer",
    kind: "own",
    note: "VP8X·ANIM·ANMF 청크를 순수 TS로 조립한다. 정지 프레임 인코딩은 브라우저가 하니 muxing만 직접 하면 libwebp wasm이 필요 없다.",
    src: ["apps/gif/src/lib/gif/webp.ts"],
  },
  {
    id: "overlaytext",
    label: "텍스트 오버레이 배치",
    kind: "own",
    note: "9방향 프리셋 좌표·줄바꿈·외곽선 두께를 출력 배율에 맞춰 계산한다. 캔버스도 DOM도 만지지 않는 순수 계산이라, 미리보기와 네 내보내기(GIF·WebP·MP4·PNG)가 같은 숫자를 받아 같은 자리에 글자를 찍는다.",
    src: ["apps/gif/src/lib/gif/overlay.ts"],
  },
  {
    id: "textlayout",
    label: "글줄 재구성",
    kind: "own",
    note: "PDF에는 글줄이 없다 — pdf.js가 주는 것은 좌표가 붙은 글자 조각뿐이다. 기준선 y로 줄을 묶고, 앞 조각의 글자 한 개 폭에 견줘 틈이 벌어진 자리에 공백을 끼우고, 줄 간격이 그 쪽 중앙값의 1.5배를 넘으면 문단을 나눈다. pdf.js를 부르지 않는 순수 계산이다.",
    src: ["apps/pdf/src/lib/pdf/text.ts"],
  },
  {
    id: "spake2",
    label: "SPAKE2 · RFC 9382",
    kind: "own",
    note: "숫자 6자리로 키를 합의한다. 릴레이가 본 기록만으로는 코드를 오프라인 대입할 수 없고 공격자는 세션당 한 번만 추측할 수 있다. RFC 시험 벡터로 검증됨.",
    src: ["apps/drop/src/lib/rtc/spake2.ts"],
  },
  {
    id: "webgpu",
    label: "WebGPU",
    kind: "native",
    note: "임베딩 모델의 행렬 연산이 도는 곳. 어댑터를 실제로 받아 보고 없으면 WASM으로 물러난다 — 되긴 하지만 열 배 넘게 느려서 화면에 그 사실을 적는다.",
    src: ["apps/lab/src/lib/embed/runtime.ts"],
  },
  {
    id: "cacheapi",
    label: "Cache API",
    kind: "native",
    note: "받아 둔 모델이 남는 곳. 한 벌이 200MB~2GB라 목록·용량·삭제를 직접 보여 준다 — 실험장은 모델을 갈아 끼우는 게 용도라 안 그러면 디스크가 찬다.",
    src: ["apps/lab/src/lib/embed/cache.ts"],
  },
  {
    id: "transformers",
    label: "transformers.js",
    kind: "lib",
    pkg: "@huggingface/transformers",
    network: "모델·실행기 최초 1회",
    net: {
      hosts: ["huggingface.co", "cdn.jsdelivr.net"],
      layers: [
        { label: "TCP/IP", note: "https:// 라서 443." },
        { label: "TLS", note: "버전은 브라우저가 협상한다." },
        {
          label: "HTTPS",
          note: "가중치(.onnx)는 huggingface.co에서, onnxruntime-web의 .wasm·.mjs는 cdn.jsdelivr.net에서 받는다. 실행기 주소는 버전이 박힌 URL이고, 빌드가 그 URL을 코드에 심는다(apps/lab/ort-wasm.ts).",
        },
        {
          label: "Cache API",
          note: "받은 것은 transformers-cache에 남아 다음부터는 오프라인으로 열린다. 해시 검증은 없다 — 우리가 호스팅하는 자산이 아니라서 rhwp·qpdf와 다르다.",
        },
      ],
      carries: "모델 가중치와 실행기 — 나가는 것은 GET뿐, 사용자 문장은 올라가지 않는다",
    },
    note: "브라우저에서 임베딩 모델을 돌린다. 모델을 실행 시점에 받으므로 이 앱만 단일 HTML 안에 엔진이 없다 — 열두 개를 자체 호스팅할 방법이 없어 실험장에는 이게 맞다.",
    src: ["apps/lab/src/lib/embed/runtime.ts", "apps/lab/ort-wasm.ts"],
  },
  {
    id: "embedmath",
    label: "벡터·비교 지표",
    kind: "own",
    note: "코사인 행렬, Matryoshka 절단(자른 뒤 재정규화), 이웃 겹침 overlap@k, 순위 상관 Spearman ρ, 설명분산을 같이 내는 PCA. 그림은 거들 뿐이고 결정을 바꾸는 건 이 숫자들이라 직접 짰다.",
    src: ["apps/lab/src/lib/embed/vector.ts", "apps/lab/src/lib/embed/score.ts"],
  },
  {
    id: "bm25",
    label: "BM25 (문자 2-gram)",
    kind: "own",
    note: "내려받을 것이 없는 기준선. 한글은 형태소 분석기 없이 문자 2-gram으로 색인한다(Lucene의 CJK 방식). 글자가 겹치지 않으면 0점이라 치과↔이빨을 원리상 못 잡는 대신, 200MB짜리 모델이 값을 하는지 재는 잣대가 된다.",
    src: ["apps/lab/src/lib/embed/bm25.ts"],
  },
  {
    id: "irstats",
    label: "검정·판정 채점",
    kind: "own",
    note: "Wilson 신뢰구간, McNemar 정확검정(엇갈린 문장만 센다), 판정 풀링과 Recall·NDCG·MRR. 40문장에서 100%는 [91%, 100%]라 97.5%와 겹친다 — 이 계산이 없으면 큰 숫자가 없는 차이를 만들어 낸다.",
    src: ["apps/lab/src/lib/embed/stats.ts", "apps/lab/src/lib/embed/judge.ts"],
  },
  {
    id: "nostrclient",
    label: "Nostr NIP-01 클라이언트",
    kind: "own",
    note: "릴레이에 붙어 이벤트를 주고받는 최소 구현. 만남의 장소만 빌리는 용도라 라이브러리를 통째로 들일 이유가 없었다.",
    src: ["apps/drop/src/lib/rtc/nostr.ts"],
  },
  {
    id: "exifbytes",
    label: "EXIF 바이트 조작",
    kind: "own",
    note: "JPEG APP1·WebP RIFF·PNG eXIf 세그먼트를 직접 넣고 뺀다. 재인코딩 후에도 촬영 정보를 지키거나 완전히 지우기 위해.",
    src: ["apps/image/src/lib/image/exif.ts"],
  },
  {
    id: "quantize",
    label: "색 수 축소 (median cut)",
    kind: "own",
    note: "5비트 히스토그램에서 상자를 갈라 팔레트를 뽑고 가장 가까운 색으로 매핑한다(원하면 Floyd–Steinberg 확산). GIF 쪽은 gifenc가 해 주는 일이지만 이미지 앱에는 그 의존성이 없고, 이것 하나 때문에 런타임 의존성을 늘리지 않기로 했다. 알파는 완전 투명·완전 불투명 둘로만 남는다.",
    src: ["apps/image/src/lib/image/quantize.ts"],
  },
  {
    id: "sizesearch",
    label: "목표 용량 탐색",
    kind: "own",
    note: "\"이 용량 이하\"를 받으면 그 이하로 떨어지는 가장 좋은 설정을 이진 탐색으로 찾는다 — 양 끝을 먼저 짚고 안쪽을 좁히며 최대 아홉 번. 재인코딩은 값이 클수록 크다는 가정이 깨질 수 있어 맞춘 것 중 가장 좋은 것과 전체에서 가장 작은 것을 함께 들고 가고, \"맞췄다\"는 표시는 실제로 잰 바이트가 목표 이하일 때만 붙는다.",
    src: ["apps/image/src/lib/image/target.ts"],
  },
  {
    id: "formula-engine",
    label: "수식 엔진",
    kind: "own",
    note: "렉서 → 파서 → 의존성 그래프 → 위상 순서 계산. 완성품(HyperFormula)은 GPLv3라 저장소 전체가 전염되고, 직접 짜야 IF의 지연 평가·순환 참조·날짜 서식 물려받기를 우리 값 체계에 맞출 수 있었다.",
    src: [
      "apps/sheet/src/lib/formula/tokenize.ts",
      "apps/sheet/src/lib/formula/parse.ts",
      "apps/sheet/src/lib/formula/evaluate.ts",
      "apps/sheet/src/lib/formula/engine.ts",
      "apps/sheet/src/lib/formula/adjust.ts",
    ],
  },
  {
    id: "numfmt",
    label: "표시 형식",
    kind: "own",
    note: '엑셀 형식 코드("#,##0.00"·"yyyy-mm-dd"·"₩#,##0;(₩#,##0)")를 해석해 화면 문자열을 만든다. 날짜는 값이 아니라 형식이라, 이게 없으면 46276 같은 일련번호만 보인다.',
    src: ["apps/sheet/src/lib/sheet/numfmt.ts", "apps/sheet/src/lib/sheet/serial.ts"],
  },
  {
    id: "sheetfilter",
    label: "자동 필터 술어",
    kind: "own",
    note: "값 고르기 또는 조건 11가지로 보이는 행을 추린다. 고유값 목록과 글자 조건은 화면에 보이는 문자열을, 크기 비교는 계산된 값을 본다 — 파일에서 읽은 원문이 남은 칸은 값이 1.5여도 화면에는 \"1.50\"이라, 둘을 갈라 두지 않으면 같은 칸을 두 이름으로 부르게 된다. 문서 객체를 모르는 순수 계산이다.",
    src: ["apps/sheet/src/lib/sheet/filter.ts"],
  },
  {
    id: "md5",
    label: "MD5 · RFC 1321",
    kind: "own",
    note: "Web Crypto가 지원하지 않는 유일한 해시라 직접 구현했다(체크섬 용도).",
    src: ["apps/dev/src/lib/tools/md5.ts"],
  },
  {
    id: "sdpcodec",
    label: "연결정보 압축 코덱",
    kind: "own",
    note: "WebRTC SDP를 deflate-raw + base64url로 줄여 QR 한 장·복붙 한 줄에 담는다. deflate-raw에는 체크섬이 없어 앞에 SHA-256 3바이트를 붙였다 — 한 글자만 어긋나도 거부된다.",
    src: ["apps/drop/src/lib/rtc/signal.ts"],
  },
  {
    id: "ackledger",
    label: "ack 장부 · 속도 창",
    kind: "own",
    note: "받는 쪽이 디스크에 앉힌 바이트를 되알리면 그 숫자만 진행률이 된다. 장부는 뒤로 가지 않고 파일 크기를 넘지 않으며, 취소된 파일에 늦게 도착한 ack는 갈 곳이 없어 버려진다. 속도는 3초 창의 기울기로 재되 창이 0.4초보다 짧으면 아직 말하지 않는다 — 지수평균은 첫 표본이 그대로 속도가 돼서 64KB가 32MB/s로 보였다.",
    src: ["apps/drop/src/lib/rtc/progress.ts"],
  },
  {
    id: "oklchconv",
    label: "OKLCH → sRGB 변환",
    kind: "own",
    note: "테마 토큰이 전부 oklch인데 three.js 색 파서는 CSS Color 4를 모른다. 3D용 색을 따로 만들지 않으려고 변환식을 직접 넣었다.",
    src: ["apps/stack/src/lib/city/palette.ts"],
  },
  {
    id: "wasmloader",
    label: "SHA-384 fail-closed 로더",
    kind: "own",
    note: "CDN에서 받은 wasm을 실행 전에 직접 검증한다. 해시가 어긋나면 그냥 거부 — 검증된 바이트로 만든 blob URL만 엔진에 넘긴다.",
    src: ["packages/wasm-loader/index.js"],
  },

  {
    id: "docx-preview",
    label: "docx-preview",
    kind: "lib",
    pkg: "docx-preview",
    note: "워드 문서를 페이지 모양 그대로 HTML로 그린다. 서식·표·머리말을 CSS로 옮기므로 '문서처럼' 보이지만, 구조를 뽑아내기엔 나쁜 소스라 마크다운은 mammoth 쪽으로 간다.",
    src: ["apps/doc/src/lib/doc/docx.ts"],
  },
  {
    id: "mammoth",
    label: "mammoth",
    kind: "lib",
    pkg: "mammoth",
    note: "같은 워드 문서에서 서식을 버리고 의미 구조(제목·목록·표)만 남긴 HTML을 준다. 마크다운의 재료는 이쪽이다. 무거워서 실제로 변환할 때만 내려받는다.",
    src: ["apps/doc/src/lib/doc/docx.ts"],
  },
  {
    id: "turndown",
    label: "turndown",
    kind: "lib",
    pkg: "turndown",
    note: "HTML → 마크다운. 한글 쪽과 워드 쪽이 서로 다른 HTML을 주지만 마크다운으로 옮기는 규칙은 하나만 둔다 — 입력 형식에 따라 결과가 달라 보이면 안 되니까.",
    src: ["apps/doc/src/lib/doc/markdown.ts"],
  },
  {
    id: "hwp-convert",
    label: "hwp-convert",
    kind: "lib",
    pkg: "hwp-convert",
    note: "HTML을 한글이 여는 .hwpx로 쓴다. 원래 rhwp 하나로 닫으려 했는데 제목·문단·표가 섞이면 엔진이 패닉해서(rendering.rs) 이 경로만 순수 TS로 갈랐다. 만든 파일은 rhwp가 정상으로 읽는다.",
    src: ["apps/doc/src/lib/doc/hwp.ts"],
  },
  {
    id: "md-table",
    label: "표 → 마크다운 표",
    kind: "own",
    note: "turndown 본체는 표를 모른다. 공문서·보고서는 표가 곧 내용이라 GFM 파이프 표 규칙을 직접 짰다. 병합된 셀은 마크다운에 자리가 없어 펴고, 편 사실을 화면에 알린다.",
    src: ["apps/doc/src/lib/doc/markdown.ts"],
  },
  {
    id: "batchqueue",
    label: "일괄 변환 큐",
    kind: "own",
    note: "문서마다 ZIP 안 폴더를 하나씩 준다 — 마크다운이 가리키는 그림 경로가 문서마다 images/1.png로 같아서 한 폴더에 쏟으면 뒤엣것이 앞엣것을 덮는다. 상태는 여섯이다: 대기·변환 중·완료·실패·건너뜀에 '못 함'이 더 있는데, 엔진이 죽어 손대지도 못한 문서를 실패로 세면 화면이 거짓말을 하기 때문이다. 그 '못 함'도 한글 엔진이 필요한 종류에만 찍는다.",
    src: ["apps/doc/src/lib/doc/batch.ts"],
  },

  // ── wasm (여기만 인터넷이 필요하다) ──────────────────────────
  {
    id: "rhwp",
    label: "@rhwp/core",
    kind: "wasm",
    pkg: "@rhwp/core",
    network: "우리 서버 최초 1회",
    net: {
      hosts: ["tools.cranemont.com"],
      layers: [
        { label: "TCP/IP", note: "https:// 라서 443." },
        { label: "TLS", note: "버전은 브라우저가 협상한다." },
        {
          label: "HTTPS",
          note: "서드파티 CDN이 아니라 이 사이트가 직접 준다. 호스팅에서 열었으면 상대경로로, 내려받은 단일 HTML로 열었으면 이 주소로 받는다.",
        },
        {
          label: "SHA-384 검증",
          note: "받은 바이트의 해시를 맞춰 보고 어긋나면 실행하지 않는다(fail-closed). 해시는 빌드가 계산해 박으므로 사람이 다시 셀 일이 없다.",
        },
      ],
      carries: "한글 렌더러 바이트 2.1MB — 최초 1회만, 사용자 문서는 올라가지 않는다",
    },
    note: "한글 문서(.hwp·.hwpx)를 파싱하고 페이지를 SVG로 그린다. 표·수식·도형·각주·다단까지 그리는 유일한 선택지였다. 8MB라 단일 HTML에 못 넣어 파일 하나로 따로 내보낸다.",
    src: ["apps/doc/src/lib/doc/engine.ts", "apps/doc/rhwp-wasm.ts"],
  },
  {
    id: "qpdf",
    label: "qpdf-wasm",
    kind: "wasm",
    network: "CDN 최초 1회",
    net: cdnLink("qpdf 엔진 바이트"),
    note: "PDF 암호 설정·해제. 순수 JS로 대체할 만한 게 없어 유일하게 wasm을 쓴다.",
    src: ["apps/pdf/src/lib/pdf/qpdfLoader.ts"],
  },
  {
    id: "libheif",
    label: "libheif-js",
    kind: "wasm",
    network: "CDN 최초 1회",
    net: cdnLink("libheif 디코더 바이트"),
    note: "아이폰 HEIC 디코딩. 크로미엄이 HEIC를 못 열어서 이때만 내려받는다.",
    src: ["apps/image/src/lib/image/heic.ts"],
  },
  {
    id: "libavif",
    label: "@jsquash/avif",
    kind: "wasm",
    network: "CDN 최초 1회",
    net: cdnLink("AVIF 인코더 바이트"),
    note: "AVIF 인코딩. 브라우저는 AVIF를 읽지만 쓰지는 못한다.",
    src: ["apps/image/src/lib/image/avif.ts"],
  },

  // ── 빌드·기반 ───────────────────────────────────────────────
];

export const FEATURES: Feature[] = [
  // ── PDF ──────────────────────────────────────────────────────
  {
    id: "pdf-canvas",
    app: "pdf",
    label: "페이지 캔버스",
    note: "여러 PDF를 한 캔버스에 펼쳐 병합·회전·삭제·재배열한다. 쪽 범위(\"1-5, 8, 12-\")로 골라도 된다. 암호가 걸린 문서만 qpdf로 한 번 풀고 들어온다.",
    techs: ["pdfjs", "worker", "canvas2d", "qpdf"],
    src: [
      "apps/pdf/src/lib/canvas/Canvas.svelte",
      "apps/pdf/src/lib/pdf/engine.ts",
      "apps/pdf/src/lib/pdf/pdfjs.ts",
    ],
    pipeline: "pdf-merge",
  },
  {
    id: "pdf-export",
    app: "pdf",
    label: "PDF 내보내기",
    note: "캔버스 상태를 그대로 새 PDF로 굽는다. 이미지도 여기서 페이지로 임베드된다. 나누기는 같은 코드의 반대 방향 — 묶음마다 한 번씩 굽고 여러 개면 ZIP으로 묶는다.",
    techs: ["pdflib", "fflate", "adownload"],
    src: ["apps/pdf/src/lib/pdf/exporter.ts", "apps/pdf/src/lib/pdf/range.ts"],
  },
  // 아래 둘은 화면에서 탭 하나("이미지·텍스트")를 나눠 쓴다. 쪽 범위·암호 경로가 같고
  // 나가는 것만 다르다 — 그림이냐 글자냐, 쪽마다 한 장이냐 문서마다 한 장이냐.
  {
    id: "pdf-toimage",
    app: "pdf",
    label: "PDF → 이미지",
    note: "고른 쪽을 지정한 dpi로 PNG·JPG·WebP 중 하나로 래스터화하고 여러 장이면 ZIP 하나로 묶는다. 이름이 같은 PDF를 함께 넣으면 ZIP 항목 이름이 부딪히므로 번호를 붙여 비켜 둔다 — 안 그러면 뒤엣것이 앞엣것을 덮어 화면이 세는 장 수와 ZIP 속 장 수가 어긋난다.",
    techs: ["pdfjs", "worker", "canvas2d", "fflate", "adownload"],
    src: [
      "apps/pdf/src/lib/pdf/rasterize.ts",
      "apps/pdf/src/lib/pdf/zipnames.ts",
      "apps/pdf/src/lib/toimage/ToImage.svelte",
    ],
    pipeline: "pdf-to-image",
  },
  {
    id: "pdf-text",
    app: "pdf",
    label: "PDF → 텍스트",
    note: "쪽에 박힌 글자를 꺼내 .txt로 낸다. 화면에서는 이미지 갈래와 탭 하나(\"이미지·텍스트\")를 나눠 쓴다 — 쪽 범위 표기도 암호 푸는 길도 같아서다. 저장 단위만 다르다: 이미지는 쪽마다 한 장이지만 텍스트는 문서마다 한 장이다(200쪽짜리가 파일 200개가 되지 않게). 글자가 한 자도 없으면 스캔본이라는 뜻이라 배지로 알린다.",
    techs: ["pdfjs", "worker", "textlayout", "fflate", "adownload"],
    src: [
      "apps/pdf/src/lib/pdf/extract.ts",
      "apps/pdf/src/lib/pdf/text.ts",
      "apps/pdf/src/lib/pdf/zipnames.ts",
    ],
    pipeline: "pdf-to-text",
  },
  {
    id: "pdf-password",
    app: "pdf",
    label: "암호 설정·해제",
    note: "이 앱에서 유일하게 인터넷이 필요한 기능. 엔진을 최초 1회만 받고 파일은 브라우저 안에 머문다.",
    techs: ["qpdf", "wasmloader", "adownload"],
    src: ["apps/pdf/src/lib/pdf/qpdfLoader.ts", "apps/pdf/src/lib/password/Password.svelte"],
    pipeline: "pdf-password",
  },

  // ── GIF ──────────────────────────────────────────────────────
  {
    id: "gif-decode",
    app: "gif",
    label: "GIF 디코딩",
    note: "전체를 메모리에 펼치지 않고 필요한 프레임만 뽑아 LRU로 들고 있는다.",
    techs: ["imagedecoder", "createimagebitmap", "cryptorandom"],
    src: ["apps/gif/src/lib/gif/decode.ts"],
  },
  {
    id: "gif-transform",
    app: "gif",
    label: "프레임 편집",
    note: "회전·크롭·리사이즈를 렌더 시점에 적용한다. 원본 프레임은 건드리지 않는다.",
    techs: ["offscreencanvas"],
    src: ["apps/gif/src/lib/gif/transform.ts"],
  },
  {
    id: "gif-encode",
    app: "gif",
    label: "GIF 내보내기",
    note: "프레임마다 팔레트를 뽑아 양자화한 뒤 인코딩한다.",
    techs: ["gifenc", "offscreencanvas", "adownload"],
    src: ["apps/gif/src/lib/gif/encode.ts"],
  },
  {
    id: "gif-webp",
    app: "gif",
    label: "애니메이션 WebP",
    note: "정지 프레임 인코딩은 브라우저가, 애니메이션 컨테이너 조립은 직접 짠 muxer가 한다.",
    techs: ["converttoblob", "offscreencanvas", "webpmux", "adownload"],
    src: ["apps/gif/src/lib/gif/webp.ts"],
    pipeline: "gif-to-webp",
  },
  {
    id: "gif-mp4",
    app: "gif",
    label: "MP4 내보내기",
    note: "H.264는 짝수 치수만 안전해서 렌더 캔버스를 한 번 더 짝수로 맞춰 넘긴다.",
    techs: ["webcodecs", "mediabunny", "offscreencanvas", "adownload"],
    src: ["apps/gif/src/lib/gif/mp4.ts"],
    pipeline: "gif-to-mp4",
  },
  {
    id: "gif-video-import",
    app: "gif",
    label: "동영상 임포트",
    note: "선택 구간을 fps 간격으로 샘플링해 프레임별 WebP 정지 이미지로 바꾼다. 원본 영상 바이트는 임포트 후 버려진다.",
    techs: ["mediabunny", "webcodecs", "converttoblob", "cryptorandom"],
    src: ["apps/gif/src/lib/gif/video.ts"],
    pipeline: "video-to-gif",
  },
  {
    id: "gif-text",
    app: "gif",
    label: "텍스트 얹기",
    note: "프레임 위에 글자를 얹는다. 실제로 그리는 자리는 renderFrame 하나뿐이라 미리보기와 네 내보내기가 같은 그림을 만든다(딜레이 눈금과 같은 이유로 갈라 두지 않았다 — 크롭을 고르는 동안만 미리보기에서 뺀다. 변형 전 좌표계라 자리가 다르다). 변형을 되돌린 뒤 출력 캔버스 좌표에 찍으므로 그림이 90° 돌아도 글자는 화면 기준 수평이다. 전체·선택한 프레임·번호 구간 중 하나에 붙는다.",
    techs: ["overlaytext", "offscreencanvas"],
    src: ["apps/gif/src/lib/gif/overlay.ts"],
  },
  {
    id: "gif-extract",
    app: "gif",
    label: "프레임 PNG 추출",
    note: "프레임을 낱장 PNG로 굽고 ZIP 하나로 묶는다.",
    techs: ["converttoblob", "offscreencanvas", "fflate", "adownload"],
    src: ["apps/gif/src/lib/gif/extract.ts"],
    pipeline: "gif-extract",
  },

  // ── 동영상 ───────────────────────────────────────────────────
  {
    id: "video-probe",
    app: "video",
    label: "메타·키프레임 탐지",
    note: "길이·해상도·코덱·평균 프레임레이트와 키프레임 위치를 읽는다. 무손실 컷이 어디서 잘릴 수 있는지도, 한 프레임씩 움직이는 보폭도 여기서 정해진다.",
    techs: ["mediabunny"],
    src: ["apps/video/src/lib/video/probe.ts"],
  },
  {
    id: "video-thumbs",
    app: "video",
    label: "타임라인 스트립",
    note: "구간을 훑어 썸네일을 뽑아 타임라인에 깐다. 보고 있는 한 프레임을 원본 해상도 PNG로 꺼내는 것도 같은 싱크다.",
    techs: ["mediabunny", "webcodecs"],
    src: ["apps/video/src/lib/video/thumbs.ts"],
  },
  {
    id: "video-exact",
    app: "video",
    label: "정확 컷 · 재인코딩",
    note: "지정한 지점에서 정확히 자른다. 비디오를 다시 인코딩하므로 반전·프레임레이트·비트레이트가 이 경로에서만 걸린다. 오디오는 가능하면 복사한다.",
    techs: ["mediabunny", "webcodecs"],
    src: ["apps/video/src/lib/video/transcode.ts"],
    pipeline: "video-trim",
  },
  {
    id: "video-lossless",
    app: "video",
    label: "무손실 컷 · 패킷 복사",
    note: "트랙 옵션을 비워 패킷을 그대로 옮긴다. 재인코딩이 없어 빠르고 화질 손실이 없는 대신 키프레임 경계로 잘린다. 회전은 MP4면 메타데이터로 적어 복사를 유지하지만, WebM은 그 값을 안 써서 다시 굽는다.",
    techs: ["mediabunny"],
    src: ["apps/video/src/lib/video/transcode.ts"],
  },
  {
    id: "video-audio",
    app: "video",
    label: "소리 추출",
    note: "m4a·mp3·ogg·wav·flac로 오디오 트랙만 꺼낸다. 자동이면 원본 코덱이 담기는 컨테이너를 골라 복사하고, 형식·비트레이트·채널을 지정하면 그 값으로 다시 인코딩한다.",
    techs: ["mediabunny", "adownload"],
    src: ["apps/video/src/lib/video/transcode.ts"],
    pipeline: "video-audio",
  },

  // ── 이미지 ───────────────────────────────────────────────────
  {
    id: "image-decode",
    app: "image",
    label: "디코딩",
    note: "브라우저가 여는 포맷은 바로 열고, HEIC만 wasm 디코더에 위임한다.",
    techs: ["createimagebitmap", "libheif", "wasmloader", "cryptorandom"],
    src: ["apps/image/src/lib/image/decode.ts", "apps/image/src/lib/image/heic.ts"],
  },
  {
    id: "image-pipeline",
    app: "image",
    label: "변환·압축·리사이즈",
    note: "회전·반전 → 크롭 → 맞춤(여백·잘라내기) → 리샘플 → 인코딩 순서로 한 번에 굽는다. 슬라이더를 움직이면 디바운스 후 다시 굽고 용량 배지가 갱신된다. 목표 용량을 켜면 그리기는 한 번만 하고 인코딩만 여러 번 돈다 — PNG는 축소 배율이 바뀌는 칸에서만 다시 그린다.",
    techs: ["pica", "canvas2d", "libavif", "wasmloader"],
    src: ["apps/image/src/lib/image/pipeline.ts", "apps/image/src/lib/image/size.ts"],
    pipeline: "image-convert",
  },
  {
    id: "image-quantize",
    app: "image",
    label: "PNG 색 수 줄이기",
    note: "PNG에는 품질 손잡이가 없어 색을 줄이는 것이 용량을 낮추는 손잡이다. 다만 브라우저 인코더는 팔레트 PNG를 쓰지 않아 24비트로 저장되므로 줄어드는 폭이 팔레트 PNG만큼은 아니고, 그 사실을 화면 배지로 적어 둔다. 기본은 꺼짐이다 — 색을 줄이면 안티에일리어싱된 가장자리가 계단이 된다.",
    techs: ["quantize", "canvas2d"],
    src: ["apps/image/src/lib/image/quantize.ts"],
  },
  {
    id: "image-target",
    app: "image",
    label: "목표 용량 맞추기",
    note: "\"1MB 이하\"를 정해 두면 품질을(PNG면 색 수·축소 배율 사다리를) 짚어 가며 그 이하로 떨어지는 가장 좋은 설정을 고른다. 못 맞추면 가장 작은 결과를 두고 '목표 초과'라고 적는다 — 맞췄다는 말은 실제로 잰 바이트가 목표 이하일 때만 한다.",
    techs: ["sizesearch", "canvas2d"],
    src: ["apps/image/src/lib/image/target.ts"],
  },
  {
    id: "image-exif",
    app: "image",
    label: "EXIF 보기·보존·제거",
    note: "읽기는 라이브러리, 쓰기는 바이트 조작. 재인코딩하면 사라지는 촬영 정보를 다시 심거나 완전히 지운다.",
    techs: ["exifr", "exifbytes"],
    src: ["apps/image/src/lib/image/exif.ts"],
  },
  {
    id: "image-save",
    app: "image",
    label: "일괄 저장",
    note: "여러 장이면 ZIP 하나로 묶는다. 묶는 자리는 필름스트립 패널이고 내보내는 자리는 공용 save다.",
    techs: ["fflate", "adownload"],
    src: ["apps/image/src/lib/image/save.ts", "apps/image/src/lib/editor/Panel.svelte"],
  },

  // ── 시트 ─────────────────────────────────────────────────────
  {
    id: "sheet-open",
    app: "sheet",
    label: "CSV 열기",
    note: "인코딩을 먼저 판별하고(UTF-8 실패 → cp949) 구분자를 추론한 다음 RFC 4180으로 읽는다. 추론이 빗나가면 둘 다 손으로 골라 다시 읽는다. 설치해 두면 파일 더블클릭이 여기로 들어온다.",
    techs: ["textdecoder", "filehandler"],
    src: ["apps/sheet/src/lib/sheet/csv.ts", "apps/sheet/src/lib/launch.ts"],
    pipeline: "sheet-csv",
  },
  {
    id: "sheet-xlsx",
    app: "sheet",
    label: "엑셀 열기·저장",
    note: "값·수식 원문·서식·병합·틀 고정·열 너비까지 왕복시킨다. 엔진이 무거워서 xlsx를 실제로 만질 때만 내려받는다.",
    techs: ["exceljs"],
    src: ["apps/sheet/src/lib/sheet/xlsx.ts"],
    pipeline: "sheet-xlsx",
  },
  {
    id: "sheet-formula",
    app: "sheet",
    label: "수식 계산",
    note: "셀마다 참조를 뽑아 그래프를 세우고 위상 순서로 계산한다. 순환은 #CIRC!로 끊고, IF·IFERROR는 고른 가지만 계산한다.",
    techs: ["formula-engine", "formulajs"],
    src: [
      "apps/sheet/src/lib/formula/engine.ts",
      "apps/sheet/src/lib/formula/evaluate.ts",
      "apps/sheet/src/lib/formula/functions.ts",
    ],
  },
  {
    id: "sheet-format",
    app: "sheet",
    label: "값 해석·표시 형식",
    note: "사람이 친 글자를 수·날짜·불리언·수식으로 가른 뒤(앞자리 0과 안전 정수를 넘는 긴 번호는 글자로 지킨다) 형식 코드로 다시 화면 문자열을 만든다. 날짜는 엑셀처럼 일련번호로 담고, 표기가 달라지는 칸은 파일 원문을 함께 들고 있다가 그대로 내보낸다.",
    techs: ["numfmt"],
    src: ["apps/sheet/src/lib/sheet/numfmt.ts", "apps/sheet/src/lib/sheet/model.ts"],
  },
  {
    id: "sheet-filter",
    app: "sheet",
    label: "자동 필터",
    note: "열 머리글에서 값을 고르거나 조건을 걸어 행을 숨긴다. 숨겨도 행 번호는 문서의 것 그대로다 — 화면이 매기는 순번으로 갈아 끼우면 수식·이름이 가리키는 자리와 어긋난다. 저장은 기본이 표 전체이고, 보이는 행만 내보내려면 저장 메뉴에서 따로 켠다(그렇게 나간 파일은 '저장했다'로 세지 않는다 — 걸러진 줄은 아직 어느 파일에도 없다). 그 스위치는 CSV·JSON·표 복사에만 걸린다 — 엑셀 저장은 통합문서를 통째로 넘기는 길이라 언제나 표 전체다(화면에도 그렇게 적어 두었다).",
    techs: ["sheetfilter", "numfmt"],
    src: ["apps/sheet/src/lib/sheet/filter.ts", "apps/sheet/src/lib/editor/FilterMenu.svelte"],
  },
  {
    id: "sheet-export",
    app: "sheet",
    label: "형식 변환",
    note: "같은 표를 CSV·TSV·JSON·마크다운 표·HTML 표로 내보낸다. 첫 줄을 머리글로 볼지가 유일한 설정이다.",
    techs: ["adownload"],
    src: ["apps/sheet/src/lib/sheet/convert.ts"],
    pipeline: "sheet-convert",
  },

  // ── 문서 ─────────────────────────────────────────────────────
  {
    id: "doc-hwp",
    app: "doc",
    label: "한글 문서 보기",
    note: "엔진을 받아 문서를 열고 페이지를 SVG로 그린다. 비밀번호가 걸린 문서도 받아 열고, 원본이 그림이라 브라우저 찾기가 안 닿으므로 문서 안 찾기를 따로 붙였다. 설치해 두면 .hwp 더블클릭이 여기로 들어온다.",
    techs: ["rhwp", "filehandler"],
    src: [
      "apps/doc/src/lib/doc/engine.ts",
      "apps/doc/src/lib/doc/hwp.ts",
      "apps/doc/src/lib/launch.ts",
    ],
    pipeline: "doc-hwp",
  },
  {
    id: "doc-docx",
    app: "doc",
    label: "워드 문서 보기",
    note: "페이지 모양은 docx-preview가 그리고, 옮길 내용은 mammoth가 따로 뽑는다. 한 라이브러리로 둘 다 하려 하면 어느 쪽이든 나빠져서 갈랐다. 워드 쪽은 엔진 없이 완전히 오프라인이다.",
    techs: ["docx-preview", "mammoth"],
    src: ["apps/doc/src/lib/doc/docx.ts"],
    pipeline: "doc-docx",
  },
  {
    id: "doc-markdown",
    app: "doc",
    label: "마크다운 변환",
    note: "원본 옆에 저장될 마크다운을 그대로 띄운다 — 보이는 글자가 곧 내려받을 글자다. 그림은 본문에서 떼어 내 images/로 담고, 옮기며 잃은 것(병합 셀 등)은 결과 위에 적는다.",
    techs: ["turndown", "md-table", "fflate"],
    src: ["apps/doc/src/lib/doc/markdown.ts", "apps/doc/src/lib/doc/save.ts"],
  },
  {
    id: "doc-batch",
    app: "doc",
    label: "여러 개 한꺼번에",
    note: "파일을 두 개 이상 놓으면 하나씩 차례로 마크다운으로 옮겨 ZIP 한 개로 준다. 문서마다 폴더를 하나씩 주는 것은 그림 경로가 문서마다 같아서다. 잠긴 문서는 그것 하나만 묻고(나머지 열아홉 개가 멈추지 않게), 한글 엔진이 패닉하면 그 엔진이 필요한 문서만 '못 함'으로 적는다 — 시도조차 못 한 것을 실패로 세지 않으려는 것이다. 워드는 순수 JS 경로라 그 뒤로도 이어서 옮겨지고, 이미 끝난 것은 그대로 내려받는다.",
    techs: ["batchqueue", "fflate", "adownload"],
    src: ["apps/doc/src/lib/doc/batch.ts", "apps/doc/src/lib/editor/BatchPane.svelte"],
    pipeline: "doc-batch",
  },
  {
    id: "doc-hwpx",
    app: "doc",
    label: "hwpx로 저장",
    note: "한글 문서는 엔진이 그대로 내주고, 워드 문서는 시맨틱 HTML을 거쳐 새 hwpx로 쓴다 — 워드로 받은 문서를 한글에서 열 수 있게 하는 자리다.",
    techs: ["rhwp", "hwp-convert"],
    src: ["apps/doc/src/lib/doc/hwp.ts"],
  },

  // ── 드롭 ─────────────────────────────────────────────────────
  {
    id: "drop-code",
    app: "drop",
    label: "6자리 코드 랑데부",
    note: "공개 릴레이 6곳을 만남의 장소로 빌린다. 방은 5분짜리 일회용이고 파일은 여기를 지나지 않는다.",
    techs: ["nostrclient", "websocket", "subtlecrypto", "cryptorandom"],
    src: ["apps/drop/src/lib/rtc/rendezvous.ts"],
    pipeline: "drop-connect",
  },
  {
    id: "drop-spake2",
    app: "drop",
    label: "SPAKE2 키 합의",
    note: "짧은 코드로 강한 키를 만든다. 코드를 오프라인으로 대입할 수 없게 만드는 핵심.",
    techs: ["spake2", "noble", "subtlecrypto"],
    src: ["apps/drop/src/lib/rtc/spake2.ts"],
  },
  {
    id: "drop-sdp",
    app: "drop",
    label: "연결정보 압축",
    note: "긴 SDP를 압축해 QR 한 장이나 복붙 한 줄로 줄인다. 릴레이 없이 수동으로 연결할 때 쓰인다.",
    techs: ["compressionstream", "sdpcodec"],
    src: ["apps/drop/src/lib/rtc/signal.ts"],
  },
  {
    id: "drop-peer",
    app: "drop",
    label: "P2P 연결",
    note: "후보를 다 모은 뒤 한 번에 교환한다(non-trickle). 그래야 연결정보가 코드 한 덩어리로 떨어진다.",
    techs: ["webrtc"],
    src: ["apps/drop/src/lib/rtc/peer.ts"],
  },
  {
    id: "drop-transfer",
    app: "drop",
    label: "파일 전송",
    note: "보낼 목록을 먼저 알리고(offer), 받는 쪽이 수락한 뒤에야 64KB 청크가 나간다. 청크는 메모리를 거치지 않고 디스크로 바로 쓰이고, 받는 쪽은 앉힌 만큼을 ack로 되알린다 — 보내는 쪽의 진행률과 '완료'는 그 숫자에서만 나온다. 상대가 확인해 주는 판인지는 채널이 열리자마자 오는 hello로 알고, 그것도 ack도 안 오면 다 보낸 뒤 20초를 더 기다렸다 예전처럼 낙관 모드로 닫는다(그동안 막대는 건넨 바이트로 그린다 — 0에 붙어 있는 것보다 낫다).",
    techs: ["webrtc", "ackledger", "filesystemaccess", "adownload"],
    src: [
      "apps/drop/src/lib/rtc/transfer.ts",
      "apps/drop/src/lib/rtc/sink.ts",
      "apps/drop/src/lib/rtc/progress.ts",
      "apps/drop/src/lib/rtc/frames.ts",
    ],
  },
  {
    id: "drop-qr",
    app: "drop",
    label: "QR 생성·스캔",
    note: "생성은 라이브러리, 인식은 브라우저 내장. 폰 기본 카메라로 찍어도 바로 진입된다.",
    techs: ["uqr", "barcodedetector", "mediadevices"],
    src: ["apps/drop/src/lib/editor/QrCode.svelte", "apps/drop/src/lib/editor/ScanDialog.svelte"],
  },

  // ── 개발자 유틸 ──────────────────────────────────────────────
  {
    id: "dev-format",
    app: "dev",
    label: "JSON·YAML·XML",
    note: "세 포맷을 서로 변환하고 정리·압축한다.",
    techs: ["jsyaml", "fxp"],
    src: ["apps/dev/src/lib/tools/Format.svelte"],
  },
  {
    id: "dev-xpath",
    app: "dev",
    label: "XPath 평가",
    note: "브라우저 XPath 엔진을 그대로 노출한다.",
    techs: ["xpath"],
    src: ["apps/dev/src/lib/tools/Xpath.svelte"],
  },
  {
    id: "dev-diff",
    app: "dev",
    label: "텍스트 비교",
    note: "줄·단어 단위 diff.",
    techs: ["diff"],
    src: ["apps/dev/src/lib/tools/Diff.svelte"],
  },
  {
    id: "dev-hash",
    app: "dev",
    label: "해시",
    note: "SHA 계열은 브라우저가, MD5만 직접 구현이 처리한다.",
    techs: ["subtlecrypto", "md5"],
    src: ["apps/dev/src/lib/tools/Hash.svelte", "apps/dev/src/lib/tools/md5.ts"],
  },
  {
    id: "dev-jwt",
    app: "dev",
    label: "JWT 디코드·검증",
    note: "페이로드를 풀고 HS 서명을 검증한다. 토큰은 입력창 밖으로 나가지 않는다.",
    techs: ["subtlecrypto"],
    src: ["apps/dev/src/lib/tools/Jwt.svelte"],
  },
  {
    id: "dev-oauth",
    app: "dev",
    label: "OAuth·PKCE",
    note: "인증 URL을 분해하고 PKCE 챌린지를 만든다.",
    techs: ["subtlecrypto", "cryptorandom"],
    src: ["apps/dev/src/lib/tools/OAuthTool.svelte"],
  },
  {
    id: "dev-saml",
    app: "dev",
    label: "SAML 디코드",
    note: "base64 + deflate로 눌린 요청을 브라우저 내장 해제기로 푼다.",
    techs: ["compressionstream"],
    src: ["apps/dev/src/lib/tools/Saml.svelte"],
  },
  {
    id: "dev-qr",
    app: "dev",
    label: "QR 생성·읽기",
    note: "만들기와 읽기가 서로 다른 출처 — 하나는 라이브러리, 하나는 브라우저.",
    techs: ["uqr", "barcodedetector", "createimagebitmap"],
    src: ["apps/dev/src/lib/tools/Qr.svelte"],
  },
  {
    id: "dev-color",
    app: "dev",
    label: "색 변환",
    note: "hex·rgb·hsl·OKLCH 왕복과 sRGB 가멋 판정.",
    techs: ["culori"],
    src: ["apps/dev/src/lib/tools/Color.svelte"],
  },
  {
    id: "dev-cron",
    app: "dev",
    label: "크론 해석",
    note: "다음 실행 시각과 한국어 설명을 같이 보여준다.",
    techs: ["croner", "cronstrue"],
    src: ["apps/dev/src/lib/tools/CronTool.svelte"],
  },
  {
    id: "dev-id",
    app: "dev",
    label: "UUID·ULID",
    note: "v4·v7·ULID 생성. 전부 브라우저 CSPRNG에서 나온다.",
    techs: ["cryptorandom"],
    src: ["apps/dev/src/lib/tools/Uuid.svelte"],
  },

  // ── 실험장 ───────────────────────────────────────────────────
  {
    id: "lab-embed",
    app: "lab",
    label: "문장 → 벡터",
    note: "모델을 받아 문장을 한 개씩 벡터로 만든다. 배치로 묶으면 패딩이 섞여 풀링이 틀어지므로 일부러 하나씩 돌린다 — 여기 숫자가 틀리면 화면의 모든 주장이 무너진다.",
    techs: ["transformers", "webgpu"],
    src: ["apps/lab/src/lib/embed/runtime.ts", "apps/lab/src/lib/embed/registry.ts"],
    pipeline: "lab-embed",
  },
  {
    id: "lab-baseline",
    app: "lab",
    label: "BM25 기준선",
    note: "아무것도 내려받지 않고 같은 코퍼스를 색인해 점수판을 만든다. 임베딩이 값을 하는지 재려면 0MB짜리가 옆에 있어야 한다 — 검색 논문이 언제나 BM25를 같이 싣는 이유다.",
    techs: ["bm25"],
    src: ["apps/lab/src/lib/embed/bm25.ts"],
    pipeline: "lab-bm25",
  },
  {
    id: "lab-compare",
    app: "lab",
    label: "두 설정 비교",
    note: "차원을 자르거나 정밀도·프리픽스를 바꾼 두 결과를 나란히 놓는다. 절단은 다시 계산하지 않고 이미 만든 벡터를 잘라 쓰므로 공짜다. 총점 차이가 아니라 엇갈린 문장만 세서(McNemar) 그 차이가 진짜인지까지 답한다.",
    techs: ["embedmath", "irstats"],
    src: ["apps/lab/src/lib/editor/state.svelte.ts", "apps/lab/src/lib/embed/vector.ts"],
  },
  {
    id: "lab-judge",
    app: "lab",
    label: "판정 풀링",
    note: "돌린 모든 설정의 상위 결과를 합집합으로 모아 한 번만 관련성을 매긴다. 그러면 나중에 붙인 설정까지 같은 정답으로 소급 채점된다 — 리더보드가 하는 계산을 내 문장으로 하는 자리이고, 비용–품질 그림의 y축이 여기서 나온다.",
    techs: ["irstats"],
    src: ["apps/lab/src/lib/embed/judge.ts", "apps/lab/src/lib/editor/Judge.svelte"],
  },
  {
    id: "lab-probe",
    app: "lab",
    label: "한국어 프로브 채점",
    note: "존댓말·띄어쓰기·한자어·오타·영어 혼용을 같은 뜻의 짝으로 묶어 두고, 각 문장의 1순위 이웃이 제 짝인지 센다. 영어권 리더보드가 답해 주지 않는 것을 재는 자리다.",
    techs: ["embedmath"],
    src: ["apps/lab/src/lib/corpus/samples.ts", "apps/lab/src/lib/embed/score.ts"],
  },
  {
    id: "lab-storage",
    app: "lab",
    label: "받아 둔 모델 관리",
    note: "모델별 용량과 삭제. 한 벌이 200MB~2GB이고 계속 갈아 끼우는 앱이라 목록이 없으면 지운 줄 알고 계속 쌓인다.",
    techs: ["cacheapi"],
    src: ["apps/lab/src/lib/embed/cache.ts"],
  },

  // ── 기술 지도 (이 페이지) ────────────────────────────────────
  {
    id: "stack-city",
    app: "stack",
    label: "3D 기계 도시",
    note: "같은 데이터를 지형으로 본다. 유닛 하나가 기능 하나인데, 흐름이 한 번도 지나지 않는 기능은 아예 세우지 않는다 — 이름표만 단 상자가 늘어서면 무엇을 보라는 건지 알 수 없기 때문이다. 왼쪽 면의 포트 수 = 기대는 기술 수, 앞면 눈금·높이 = 흐름이 여기를 몇 번 지나는가, 지붕 안테나 = 바깥과 통함. 배관도 손으로 긋지 않고 파이프라인이 실제로 거치는 유닛 순서에서 나온다 — 세어서 맞출 수 있어야 지형이 데이터와 어긋나지 않는다.",
    techs: ["three", "webgl", "pointerlock", "oklchconv"],
    src: [
      "apps/stack/src/lib/city/layout3d.ts",
      "apps/stack/src/lib/city/scene.ts",
      "apps/stack/src/lib/city/parts.ts",
    ],
  },
  {
    id: "stack-net",
    app: "stack",
    label: "네트워크 계층 도식",
    note: "성벽 밖 설비마다 붙는 곳(중계탑)과 그 위에 얹히는 계층이 기둥으로 쌓인다. 호스트 문자열은 검사 스크립트가 실제 소스와 대조하므로 릴레이가 바뀌면 CI가 잡는다.",
    techs: ["three"],
    src: ["apps/stack/src/lib/city/layout3d.ts", "scripts/check-stack-sources.mjs"],
  },

  // ── 공통 기반 ────────────────────────────────────────────────
  {
    id: "common-wasmloader",
    app: "common",
    label: "wasm 무결성 검증",
    note: "CDN에서 오는 것은 전부 실행 전에 해시를 확인한다. 어긋나면 기능을 포기하지 절대 실행하지 않는다.",
    techs: ["wasmloader", "subtlecrypto"],
    src: ["packages/wasm-loader/index.js"],
  },
  {
    id: "common-save",
    app: "common",
    label: "표준 다운로드",
    note: "어느 도구에서 만든 것이든 여기로 나간다. 일곱 앱에 같은 save.ts가 복제돼 있고, 전부 <a download> 한 가지 방식이다.",
    techs: ["adownload"],
    src: [
      "apps/pdf/src/lib/pdf/save.ts",
      "apps/gif/src/lib/gif/save.ts",
      "apps/video/src/lib/video/save.ts",
      "apps/image/src/lib/image/save.ts",
      "apps/sheet/src/lib/sheet/save.ts",
      "apps/doc/src/lib/doc/save.ts",
      "apps/drop/src/lib/rtc/save.ts",
    ],
  },
];

// ── 파생 인덱스 ─────────────────────────────────────────────────

export const TECH_BY_ID = new Map(TECHS.map((tech) => [tech.id, tech]));
export const FEATURE_BY_ID = new Map(FEATURES.map((feat) => [feat.id, feat]));

/** tech.id → 그 기술을 쓰는 feature.id 목록 (역방향 조회의 근거) */
export const USERS_OF_TECH = new Map<string, string[]>(
  TECHS.map((tech) => [
    tech.id,
    FEATURES.filter((feat) => feat.techs.includes(tech.id)).map((feat) => feat.id),
  ]),
);

export const KIND_ORDER: TechKind[] = ["native", "lib", "own", "wasm"];

/** 상단 요약 숫자 — 데이터에서 세므로 항목을 늘리면 저절로 맞는다. */
export const SUMMARY = {
  apps: APPS.filter((app) => app.path !== null && !app.meta).length,
  features: FEATURES.length,
  techs: TECHS.length,
  thirdParty: TECHS.filter((tech) => tech.kind === "lib").length,
  wasm: TECHS.filter((tech) => tech.kind === "wasm").length,
  network: TECHS.filter((tech) => tech.network).length,
};
