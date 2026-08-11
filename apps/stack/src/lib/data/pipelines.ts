// 기능을 하나 골랐을 때 보여주는 드릴다운 — 데이터가 실제로 거치는 단계들.
// stack.ts의 Feature.pipeline이 여기 id를 가리킨다.
// ⚠️ src 경로는 scripts/check-stack-sources.mjs가 검증한다.

export interface Step {
  label: string;
  /** stack.ts의 Tech.id — 단계 배지로 표시된다 */
  tech?: string;
  note: string;
  src?: string;
}

export interface Pipeline {
  id: string;
  label: string;
  input: string;
  output: string;
  steps: Step[];
}

export const PIPELINES: Pipeline[] = [
  {
    id: "video-to-gif",
    label: "동영상 → GIF",
    input: ".mp4 · .webm · .mov",
    output: ".gif",
    steps: [
      {
        label: "컨테이너 디먹싱",
        tech: "mediabunny",
        note: "트랙 목록과 샘플 위치를 읽는다. 순수 TS라 wasm이 끼지 않는다.",
        src: "apps/gif/src/lib/gif/video.ts",
      },
      {
        label: "프레임 디코딩",
        tech: "webcodecs",
        note: "선택 구간을 fps 간격으로만 샘플링한다. 전체를 풀지 않아 긴 영상도 메모리가 터지지 않는다.",
        src: "apps/gif/src/lib/gif/video.ts",
      },
      {
        label: "WebP 정지 이미지로 고정",
        tech: "converttoblob",
        note: "프레임을 편집용 중간 표현으로 바꾼다. 여기서부터는 기존 정지 이미지 파이프라인과 완전히 같은 길이고, 원본 영상 바이트는 버려진다.",
        src: "apps/gif/src/lib/gif/video.ts",
      },
      {
        label: "프레임 편집",
        tech: "offscreencanvas",
        note: "회전·크롭·순서·딜레이를 렌더 시점에 적용한다.",
        src: "apps/gif/src/lib/gif/transform.ts",
      },
      {
        label: "팔레트 양자화·인코딩",
        tech: "gifenc",
        note: "프레임마다 팔레트를 뽑아 256색으로 줄이고 GIF로 굽는다.",
        src: "apps/gif/src/lib/gif/encode.ts",
      },
    ],
  },
  {
    id: "gif-to-webp",
    label: "프레임 → 애니메이션 WebP",
    input: "프레임 목록",
    output: ".webp",
    steps: [
      {
        label: "프레임 렌더",
        tech: "offscreencanvas",
        note: "편집 상태를 적용해 최종 픽셀을 만든다.",
        src: "apps/gif/src/lib/gif/transform.ts",
      },
      {
        label: "정지 WebP 인코딩",
        tech: "converttoblob",
        note: "낱장 인코딩은 브라우저가 한다 — libwebp wasm을 넣지 않는 대신 얻은 것.",
        src: "apps/gif/src/lib/gif/webp.ts",
      },
      {
        label: "VP8X·ANIM 헤더 조립",
        tech: "webpmux",
        note: "애니메이션 WebP임을 알리는 확장 헤더를 직접 쓴다.",
        src: "apps/gif/src/lib/gif/webp.ts",
      },
      {
        label: "ANMF 청크로 이어붙이기",
        tech: "webpmux",
        note: "프레임마다 딜레이·합성 방식을 담은 청크를 붙인다. 이 muxing만 직접 하면 wasm 없이 애니메이션 WebP가 완성된다.",
        src: "apps/gif/src/lib/gif/webp.ts",
      },
    ],
  },
  {
    id: "pdf-to-image",
    label: "PDF → 이미지",
    input: ".pdf",
    output: ".png · .zip",
    steps: [
      {
        label: "워커에서 문서 파싱",
        tech: "worker",
        note: "pdf.js를 인라인 워커로 돌린다. 외부 워커 파일을 받아오지 않아야 단일 HTML이 유지된다.",
        src: "apps/pdf/src/lib/pdf/pdfjs.ts",
      },
      {
        label: "페이지 래스터화",
        tech: "pdfjs",
        note: "선택한 배율로 페이지를 캔버스에 그린다.",
        src: "apps/pdf/src/lib/pdf/rasterize.ts",
      },
      {
        label: "PNG 인코딩",
        tech: "canvas2d",
        note: "캔버스를 그대로 PNG blob으로 굽는다.",
        src: "apps/pdf/src/lib/pdf/rasterize.ts",
      },
      {
        label: "ZIP 묶기",
        tech: "fflate",
        note: "여러 장이면 파일 하나로 묶는다 — 다운로드가 여러 번 뜨지 않게.",
        src: "apps/pdf/src/lib/pdf/save.ts",
      },
    ],
  },
  {
    id: "image-convert",
    label: "이미지 변환·압축",
    input: ".jpg · .png · .webp · .heic",
    output: ".webp · .jpg · .avif",
    steps: [
      {
        label: "디코딩",
        tech: "createimagebitmap",
        note: "브라우저가 여는 포맷은 바로 연다. HEIC일 때만 wasm 디코더로 넘어간다.",
        src: "apps/image/src/lib/image/decode.ts",
      },
      {
        label: "회전·크롭",
        tech: "canvas2d",
        note: "EXIF 방향을 픽셀에 반영해 중립화한 뒤 크롭을 적용한다.",
        src: "apps/image/src/lib/image/pipeline.ts",
      },
      {
        label: "리샘플",
        tech: "pica",
        note: "canvas 기본 축소보다 결과가 나은 고품질 필터.",
        src: "apps/image/src/lib/image/pipeline.ts",
      },
      {
        label: "인코딩",
        tech: "canvas2d",
        note: "WebP·JPEG·PNG는 브라우저가 굽고, AVIF만 wasm 인코더가 맡는다.",
        src: "apps/image/src/lib/image/pipeline.ts",
      },
      {
        label: "EXIF 재삽입",
        tech: "exifbytes",
        note: "재인코딩하면 촬영 정보가 사라진다. 보존을 켜면 세그먼트를 직접 다시 심는다.",
        src: "apps/image/src/lib/image/exif.ts",
      },
    ],
  },
  {
    id: "video-trim",
    label: "동영상 자르기",
    input: ".mp4 · .webm",
    output: ".mp4 · .webm",
    steps: [
      {
        label: "메타·키프레임 탐지",
        tech: "mediabunny",
        note: "키프레임 위치가 무손실 컷의 절단 가능 지점을 정한다.",
        src: "apps/video/src/lib/video/probe.ts",
      },
      {
        label: "정확 컷이면 재인코딩",
        tech: "webcodecs",
        note: "지정 지점에서 정확히 자르되 비디오를 다시 굽는다. 오디오는 가능하면 복사한다.",
        src: "apps/video/src/lib/video/transcode.ts",
      },
      {
        label: "무손실 컷이면 패킷 복사",
        tech: "mediabunny",
        note: "트랙 옵션을 비우면 패킷이 그대로 옮겨진다. 빠르고 화질 손실이 없지만 키프레임 경계로 잘린다.",
        src: "apps/video/src/lib/video/transcode.ts",
      },
      {
        label: "먹싱",
        tech: "mediabunny",
        note: "결과를 컨테이너로 다시 묶는다.",
        src: "apps/video/src/lib/video/transcode.ts",
      },
    ],
  },
  {
    id: "drop-connect",
    label: "6자리 코드로 연결",
    input: "숫자 6자리",
    output: "P2P 파일 전송",
    steps: [
      {
        label: "방 태그 유도",
        tech: "subtlecrypto",
        note: "코드에서 릴레이용 공개 식별자를 만든다. 방은 5분짜리 일회용.",
        src: "apps/drop/src/lib/rtc/rendezvous.ts",
      },
      {
        label: "릴레이 접속",
        tech: "websocket",
        note: "공개 릴레이 6곳에 동시에 붙는다. 여기가 이 기능에서 유일하게 네트워크를 타는 지점.",
        src: "apps/drop/src/lib/rtc/nostr.ts",
      },
      {
        label: "SPAKE2 4메시지 왕복",
        tech: "spake2",
        note: "짧은 코드로 강한 공유키를 만든다. 릴레이가 본 기록만으로는 코드를 오프라인 대입할 수 없다.",
        src: "apps/drop/src/lib/rtc/spake2.ts",
      },
      {
        label: "연결정보 봉인",
        tech: "subtlecrypto",
        note: "공유키로 SDP를 암호화해 올린다. 릴레이는 암호문만 본다.",
        src: "apps/drop/src/lib/rtc/rendezvous.ts",
      },
      {
        label: "P2P 연결 수립",
        tech: "webrtc",
        note: "후보를 다 모은 뒤 한 번에 교환한다(non-trickle).",
        src: "apps/drop/src/lib/rtc/peer.ts",
      },
      {
        label: "64KB 청크 전송",
        tech: "webrtc",
        note: "버퍼가 차면 멈췄다 이어 보낸다. 파일은 두 기기 사이만 지난다.",
        src: "apps/drop/src/lib/rtc/transfer.ts",
      },
    ],
  },
  {
    id: "build",
    label: "소스 → 단일 HTML",
    input: "src/**",
    output: "index.html",
    steps: [
      {
        label: "Svelte 컴파일",
        tech: "svelte",
        note: "룬 기반 컴포넌트를 얇은 런타임 코드로 바꾼다.",
        src: "apps/stack/svelte.config.js",
      },
      {
        label: "번들",
        tech: "vite",
        note: "여섯 앱이 같은 설정을 공유한다.",
        src: "apps/stack/vite.config.ts",
      },
      {
        label: "HTML에 인라인",
        tech: "singlefile",
        note: "JS·CSS를 전부 HTML 안으로 밀어 넣는다. 이 시점 산출물이 가장 크다.",
        src: "apps/stack/vite.config.ts",
      },
      {
        label: "deflate-raw 압축",
        tech: "selfextract",
        note: "인라인 덩어리를 압축해 base64로 다시 심는다. 빌드 로그에 크기 줄이 안 찍히면 후처리가 조용히 건너뛴 것.",
        src: "packages/vite-plugin-self-extracting/index.js",
      },
      {
        label: "로드 시 자가해제",
        tech: "compressionstream",
        note: "브라우저가 열자마자 풀어서 실행한다. 압축·해제 양쪽 다 내장 API라 해제기를 따로 안 싣는다.",
        src: "packages/vite-plugin-self-extracting/index.js",
      },
    ],
  },
];

export const PIPELINE_BY_ID = new Map(PIPELINES.map((pipe) => [pipe.id, pipe]));
