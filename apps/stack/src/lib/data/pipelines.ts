// 파일 한 개가 도구를 지나며 무엇이 되는가 — 이 페이지가 답하는 유일한 질문.
// stack.ts의 Feature.pipeline이 여기 id를 가리킨다.
//
// ⚠️ src 경로와 "모든 단계가 유닛에 닿는가"를 scripts/check-stack-sources.mjs가 검증한다.
//    닿지 않는 단계가 하나라도 있으면 CI가 깨진다 — 도시에 끊긴 관이 생기기 때문이다.

/**
 * 이 단계를 지나면 화물이 어떤 모습이 되는가 — 도시가 이걸 보고 궤짝을 바꾼다.
 *
 * 글로 "여기서 프레임으로 쪼개진다"라고 적는 대신 궤짝이 실제로 여러 개가 되고,
 * 압축되는 단계에서 작아지고, 양자화되는 단계에서 색이 줄어든다.
 *
 * ⚠️ 구조적으로 참인 것만 적는다 — 쪼갬·합침·작아짐·색 줄임. 바이트 수나 프레임 수는
 *    입력에 따라 달라져 소스에서 확정할 수 없으므로 숫자를 쓰지 않는다(개수는 시늉).
 */
export interface Cargo {
  /** 몇 덩어리인가. 1이면 파일 하나, N이면 쪼개진 상태 */
  count: number;
  /** 상대 크기 0..1 — 작아지는 단계에서만 줄인다 */
  scale: number;
  /** 색이 팔레트로 줄어드는 단계인가 */
  palette?: boolean;
  /** 궤짝을 따라다니는 한 마디 — 문장이 아니라 이름표 */
  form: string;
}

export interface Step {
  label: string;
  /** stack.ts의 Tech.id — 단계 배지로 표시된다 */
  tech?: string;
  note: string;
  src?: string;
  /**
   * 이 단계가 벌어지는 유닛(=Feature.id)을 손으로 지정한다.
   *
   * 보통은 src 하나가 기능 하나에 속해서 저절로 정해진다. 한 파일을 여러 기능이
   * 나눠 쓰거나(transcode.ts는 정확 컷·무손실 컷·소리 추출 셋이 함께 쓴다) 어느
   * 기능에도 안 적힌 파일일 때만 여기서 못 박는다. 비워 두면 src로 찾는다.
   */
  feat?: string;
  /** 이 단계를 마친 뒤의 화물 모습 */
  cargo?: Cargo;
}

export interface Pipeline {
  id: string;
  label: string;
  input: string;
  output: string;
  steps: Step[];
}

/** 어느 앱이든 저장은 같은 문으로 나간다 — 다섯 앱에 같은 save.ts가 복제돼 있다. */
const exitStep = (src: string, form: string): Step => ({
  label: "다운로드",
  tech: "adownload",
  note: "<a download>로 브라우저 다운로드 목록에 올린다. 저장 위치를 묻지 않는 대신 어디로 갔는지가 분명하다.",
  src,
  feat: "common-save",
  cargo: { count: 1, scale: 0.7, form },
});

export const PIPELINES: Pipeline[] = [
  // ── PDF ──────────────────────────────────────────────────────
  {
    id: "pdf-merge",
    label: "여러 PDF → 한 개",
    input: ".pdf 여러 개 · .png · .jpg",
    output: ".pdf",
    steps: [
      {
        label: "워커에서 문서 열기",
        tech: "worker",
        note: "pdf.js를 인라인 워커로 돌린다. 메인 스레드가 멈추지 않고, 외부 워커 파일을 받아오지 않아 단일 HTML이 유지된다.",
        src: "apps/pdf/src/lib/pdf/pdfjs.ts",
        feat: "pdf-canvas",
        cargo: { count: 3, scale: 0.85, form: "문서 여러 개" },
      },
      {
        label: "페이지 썸네일",
        tech: "pdfjs",
        note: "모든 페이지를 한 캔버스에 펼친다. 여기서부터 문서 경계가 사라지고 페이지 낱장만 남는다.",
        src: "apps/pdf/src/lib/pdf/engine.ts",
        cargo: { count: 9, scale: 0.3, form: "페이지 낱장" },
      },
      {
        label: "순서·회전·삭제",
        tech: "canvas2d",
        note: "원본 바이트는 그대로 두고 목록만 고친다. 되돌리기가 싼 이유.",
        src: "apps/pdf/src/lib/canvas/Canvas.svelte",
        cargo: { count: 6, scale: 0.3, form: "고른 페이지만" },
      },
      {
        label: "새 PDF로 굽기",
        tech: "pdflib",
        note: "페이지를 복사해 새 문서에 얹는다. 이미지는 이 단계에서 페이지로 임베드된다.",
        src: "apps/pdf/src/lib/pdf/exporter.ts",
        cargo: { count: 1, scale: 0.8, form: "PDF 하나" },
      },
      exitStep("apps/pdf/src/lib/pdf/save.ts", "PDF 하나"),
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
        feat: "pdf-toimage",
        cargo: { count: 1, scale: 1, form: "PDF 한 덩어리" },
      },
      {
        label: "페이지 래스터화",
        tech: "pdfjs",
        note: "선택한 배율로 페이지를 캔버스에 그린다.",
        src: "apps/pdf/src/lib/pdf/rasterize.ts",
        cargo: { count: 6, scale: 0.5, form: "페이지마다 한 장" },
      },
      {
        label: "PNG 인코딩",
        tech: "canvas2d",
        note: "캔버스를 그대로 PNG blob으로 굽는다.",
        src: "apps/pdf/src/lib/pdf/rasterize.ts",
        cargo: { count: 6, scale: 0.42, form: "PNG 여러 장" },
      },
      {
        label: "ZIP 묶기",
        tech: "fflate",
        note: "여러 장이면 파일 하나로 묶는다 — 다운로드가 여러 번 뜨지 않게.",
        src: "apps/pdf/src/lib/pdf/save.ts",
        feat: "pdf-toimage",
        cargo: { count: 1, scale: 0.7, form: "ZIP 하나" },
      },
      exitStep("apps/pdf/src/lib/pdf/save.ts", "ZIP 하나"),
    ],
  },
  {
    id: "pdf-password",
    label: "PDF 암호 걸기",
    input: ".pdf + 암호",
    output: "암호 걸린 .pdf",
    steps: [
      {
        label: "엔진 받아서 해시 대조",
        tech: "wasmloader",
        note: "이 저장소에서 유일하게 인터넷이 필요한 자리. 글루 JS는 <script integrity>로 브라우저가 강제하고, .wasm은 받아서 SHA-384를 직접 맞춰 본다. 어긋나면 실행하지 않는다.",
        src: "packages/wasm-loader/index.js",
        cargo: { count: 1, scale: 1, form: "파일은 대기 · 엔진만 받는다" },
      },
      {
        label: "메모리 파일시스템에 올리기",
        tech: "qpdf",
        note: "wasm 안의 가상 파일시스템에 /in.pdf로 쓴다. 진짜 디스크도, 네트워크도 아니다.",
        src: "apps/pdf/src/lib/pdf/qpdfLoader.ts",
        cargo: { count: 1, scale: 1, form: "/in.pdf" },
      },
      {
        label: "qpdf 실행",
        tech: "qpdf",
        note: "--encrypt 암호 암호 256 -- /in.pdf /out.pdf. AES-256으로 걸고 결과를 다시 읽어 온다.",
        src: "apps/pdf/src/lib/pdf/qpdfLoader.ts",
        cargo: { count: 1, scale: 1, form: "잠긴 /out.pdf" },
      },
      exitStep("apps/pdf/src/lib/pdf/save.ts", "잠긴 PDF"),
    ],
  },

  // ── 이미지 ───────────────────────────────────────────────────
  {
    id: "image-convert",
    label: "이미지 변환·압축",
    input: ".jpg · .png · .webp · .heic",
    output: ".webp · .jpg · .avif · .zip",
    steps: [
      {
        label: "디코딩",
        tech: "createimagebitmap",
        note: "브라우저가 여는 포맷은 바로 연다. HEIC일 때만 wasm 디코더로 넘어간다.",
        src: "apps/image/src/lib/image/decode.ts",
        cargo: { count: 1, scale: 1, form: "픽셀로 펼침" },
      },
      {
        label: "회전·크롭",
        tech: "canvas2d",
        note: "EXIF 방향을 픽셀에 반영해 중립화한 뒤 크롭을 적용한다.",
        src: "apps/image/src/lib/image/pipeline.ts",
        cargo: { count: 1, scale: 0.78, form: "잘린 픽셀" },
      },
      {
        label: "리샘플",
        tech: "pica",
        note: "canvas 기본 축소보다 결과가 나은 고품질 필터.",
        src: "apps/image/src/lib/image/pipeline.ts",
        cargo: { count: 1, scale: 0.52, form: "작아진 픽셀" },
      },
      {
        label: "인코딩",
        tech: "canvas2d",
        note: "WebP·JPEG·PNG는 브라우저가 굽고, AVIF만 wasm 인코더가 맡는다.",
        src: "apps/image/src/lib/image/pipeline.ts",
        cargo: { count: 1, scale: 0.38, form: "압축된 파일" },
      },
      {
        label: "EXIF 재삽입",
        tech: "exifbytes",
        note: "재인코딩하면 촬영 정보가 사라진다. 보존을 켜면 세그먼트를 직접 다시 심는다.",
        src: "apps/image/src/lib/image/exif.ts",
        cargo: { count: 1, scale: 0.42, form: "+ 촬영 정보" },
      },
      {
        label: "여러 장이면 ZIP",
        tech: "fflate",
        note: "필름스트립에 여러 장을 올려 두면 한 파일로 묶는다.",
        src: "apps/image/src/lib/editor/Panel.svelte",
        cargo: { count: 1, scale: 0.6, form: "ZIP 하나" },
      },
      exitStep("apps/image/src/lib/image/save.ts", "내 컴퓨터로"),
    ],
  },

  // ── GIF ──────────────────────────────────────────────────────
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
        cargo: { count: 1, scale: 1, form: "영상 한 덩어리" },
      },
      {
        label: "프레임 디코딩",
        tech: "webcodecs",
        note: "선택 구간을 fps 간격으로만 샘플링한다. 전체를 풀지 않아 긴 영상도 메모리가 터지지 않는다.",
        src: "apps/gif/src/lib/gif/video.ts",
        cargo: { count: 8, scale: 0.5, form: "프레임 여러 장" },
      },
      {
        label: "WebP 정지 이미지로 고정",
        tech: "converttoblob",
        note: "프레임을 편집용 중간 표현으로 바꾼다. 여기서부터는 기존 정지 이미지 파이프라인과 완전히 같은 길이고, 원본 영상 바이트는 버려진다.",
        src: "apps/gif/src/lib/gif/video.ts",
        cargo: { count: 8, scale: 0.42, form: "낱장 WebP · 원본은 버림" },
      },
      {
        label: "프레임 편집",
        tech: "offscreencanvas",
        note: "회전·크롭·순서·딜레이를 렌더 시점에 적용한다.",
        src: "apps/gif/src/lib/gif/transform.ts",
        cargo: { count: 8, scale: 0.42, form: "프레임 여러 장" },
      },
      {
        label: "팔레트 양자화·인코딩",
        tech: "gifenc",
        note: "프레임마다 팔레트를 뽑아 256색으로 줄이고 GIF로 굽는다.",
        src: "apps/gif/src/lib/gif/encode.ts",
        cargo: { count: 1, scale: 0.55, palette: true, form: "GIF 하나 · 256색" },
      },
      exitStep("apps/gif/src/lib/gif/save.ts", "GIF 하나"),
    ],
  },
  {
    id: "gif-to-webp",
    label: "프레임 → 애니메이션 WebP",
    input: "프레임 목록",
    output: ".webp",
    steps: [
      {
        label: "필요한 프레임만 디코딩",
        tech: "imagedecoder",
        note: "전체를 메모리에 펼치지 않고 요청받은 프레임만 뽑아 LRU로 들고 있는다.",
        src: "apps/gif/src/lib/gif/decode.ts",
        cargo: { count: 8, scale: 0.6, form: "프레임 여러 장" },
      },
      {
        label: "프레임 렌더",
        tech: "offscreencanvas",
        note: "편집 상태를 적용해 최종 픽셀을 만든다.",
        src: "apps/gif/src/lib/gif/transform.ts",
        cargo: { count: 8, scale: 0.5, form: "편집 반영됨" },
      },
      {
        label: "정지 WebP 인코딩",
        tech: "converttoblob",
        note: "낱장 인코딩은 브라우저가 한다 — libwebp wasm을 넣지 않는 대신 얻은 것.",
        src: "apps/gif/src/lib/gif/webp.ts",
        cargo: { count: 8, scale: 0.4, form: "낱장 WebP" },
      },
      {
        label: "VP8X·ANIM 헤더 조립",
        tech: "webpmux",
        note: "애니메이션 WebP임을 알리는 확장 헤더를 직접 쓴다.",
        src: "apps/gif/src/lib/gif/webp.ts",
        cargo: { count: 1, scale: 0.45, form: "헤더 한 장" },
      },
      {
        label: "ANMF 청크로 이어붙이기",
        tech: "webpmux",
        note: "프레임마다 딜레이·합성 방식을 담은 청크를 붙인다. 이 muxing만 직접 하면 wasm 없이 애니메이션 WebP가 완성된다.",
        src: "apps/gif/src/lib/gif/webp.ts",
        cargo: { count: 1, scale: 0.62, form: "WebP 하나" },
      },
      exitStep("apps/gif/src/lib/gif/save.ts", "WebP 하나"),
    ],
  },
  {
    id: "gif-to-mp4",
    label: "프레임 → MP4",
    input: "프레임 목록",
    output: ".mp4",
    steps: [
      {
        label: "필요한 프레임만 디코딩",
        tech: "imagedecoder",
        note: "GIF든 임포트한 영상이든 여기서 같은 모양의 프레임이 된다.",
        src: "apps/gif/src/lib/gif/decode.ts",
        cargo: { count: 8, scale: 0.6, form: "프레임 여러 장" },
      },
      {
        label: "짝수 캔버스에 다시 얹기",
        tech: "offscreencanvas",
        note: "H.264는 짝수 치수만 안전해서 렌더 캔버스를 짝수 캔버스에 한 번 더 그린다. MP4는 투명이 없어 흰 배경을 먼저 깐다.",
        src: "apps/gif/src/lib/gif/mp4.ts",
        cargo: { count: 8, scale: 0.58, form: "짝수 치수 · 흰 배경" },
      },
      {
        label: "WebCodecs 인코딩",
        tech: "webcodecs",
        note: "실제 영상 압축은 전부 브라우저 인코더가 한다 — ffmpeg wasm이 필요 없는 이유.",
        src: "apps/gif/src/lib/gif/mp4.ts",
        cargo: { count: 8, scale: 0.3, form: "압축된 프레임" },
      },
      {
        label: "mediabunny로 muxing",
        tech: "mediabunny",
        note: "압축된 샘플을 MP4 컨테이너에 담는다. 순수 TS라 여기도 wasm이 없다.",
        src: "apps/gif/src/lib/gif/mp4.ts",
        cargo: { count: 1, scale: 0.5, form: "MP4 하나" },
      },
      exitStep("apps/gif/src/lib/gif/save.ts", "MP4 하나"),
    ],
  },
  {
    id: "gif-extract",
    label: "프레임 → PNG 낱장",
    input: "프레임 목록",
    output: ".zip",
    steps: [
      {
        label: "필요한 프레임만 디코딩",
        tech: "imagedecoder",
        note: "추출도 편집과 같은 디코더를 쓴다 — 한 번 푼 프레임은 LRU에 남는다.",
        src: "apps/gif/src/lib/gif/decode.ts",
        cargo: { count: 8, scale: 0.6, form: "프레임 여러 장" },
      },
      {
        label: "변형 적용해 PNG로",
        tech: "converttoblob",
        note: "화면에서 보던 회전·크롭이 그대로 반영된 PNG가 나온다. 이름은 frame-01 식으로 자릿수를 맞춘다.",
        src: "apps/gif/src/lib/gif/extract.ts",
        cargo: { count: 8, scale: 0.5, form: "PNG 낱장" },
      },
      {
        label: "ZIP 묶기",
        tech: "fflate",
        note: "낱장 다운로드가 수십 번 뜨지 않게 한 파일로 묶는다.",
        src: "apps/gif/src/lib/gif/extract.ts",
        cargo: { count: 1, scale: 0.72, form: "ZIP 하나" },
      },
      exitStep("apps/gif/src/lib/gif/save.ts", "ZIP 하나"),
    ],
  },

  // ── 동영상 ───────────────────────────────────────────────────
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
        cargo: { count: 1, scale: 1, form: "영상 한 덩어리" },
      },
      {
        label: "타임라인 스트립",
        tech: "webcodecs",
        note: "구간을 균등 샘플링해 캔버스 하나에 이어 그린다. 어디를 자를지 눈으로 고르는 근거.",
        src: "apps/video/src/lib/video/thumbs.ts",
        cargo: { count: 1, scale: 1, form: "영상 + 훑어본 그림" },
      },
      {
        label: "정확 컷이면 재인코딩",
        tech: "webcodecs",
        note: "지정 지점에서 정확히 자르되 비디오를 다시 굽는다. 오디오는 가능하면 복사한다.",
        src: "apps/video/src/lib/video/transcode.ts",
        feat: "video-exact",
        cargo: { count: 1, scale: 0.48, form: "구간만 · 다시 구움" },
      },
      {
        label: "무손실 컷이면 패킷 복사",
        tech: "mediabunny",
        note: "트랙 옵션을 비우면 패킷이 그대로 옮겨진다. 빠르고 화질 손실이 없지만 키프레임 경계로 잘린다.",
        src: "apps/video/src/lib/video/transcode.ts",
        feat: "video-lossless",
        cargo: { count: 1, scale: 0.55, form: "구간만 · 그대로" },
      },
      exitStep("apps/video/src/lib/video/save.ts", "잘린 영상"),
    ],
  },
  {
    id: "video-audio",
    label: "동영상 → 소리만",
    input: ".mp4 · .webm",
    output: ".mp3 · .m4a · .wav · .flac · .ogg",
    steps: [
      {
        label: "트랙 살펴보기",
        tech: "mediabunny",
        note: "오디오 코덱이 무엇인지에 따라 담을 컨테이너가 정해진다.",
        src: "apps/video/src/lib/video/probe.ts",
        cargo: { count: 1, scale: 1, form: "영상 한 덩어리" },
      },
      {
        label: "오디오 트랙만 컨버전",
        tech: "mediabunny",
        note: "비디오를 버리고 오디오만 옮긴다. 코덱이 그대로 담기면 복사, 아니면 재인코딩한다.",
        src: "apps/video/src/lib/video/transcode.ts",
        feat: "video-audio",
        cargo: { count: 1, scale: 0.2, form: "소리만 남음" },
      },
      exitStep("apps/video/src/lib/video/save.ts", "소리 파일"),
    ],
  },

  // ── 시트 ─────────────────────────────────────────────────────
  // 표는 크기가 아니라 모양이 바뀌는 화물이다 — 바이트 → 글자 → 격자 → 값 → 다시 바이트.
  // 그래서 scale은 거의 그대로 두고 count와 form으로만 변화를 말한다.
  {
    id: "sheet-csv",
    label: "CSV 열기·편집·저장",
    input: ".csv · .tsv",
    output: ".csv · .tsv",
    steps: [
      {
        label: "인코딩 판별",
        tech: "textdecoder",
        note: "BOM을 먼저 보고, 없으면 UTF-8로 엄격하게 읽어 본다. 여기서 실패하면 cp949다 — 한국에서 받는 CSV의 절반이 그렇다.",
        src: "apps/sheet/src/lib/sheet/csv.ts",
        feat: "sheet-open",
        cargo: { count: 1, scale: 1, form: "글자로 펼침" },
      },
      {
        label: "구분자 추론·파싱",
        note: "쉼표·탭·세미콜론·파이프를 후보로 두고 줄마다 개수가 가장 일정한 것을 고른다. 따옴표 안의 쉼표와 줄바꿈은 지킨다(RFC 4180).",
        src: "apps/sheet/src/lib/sheet/csv.ts",
        feat: "sheet-open",
        cargo: { count: 6, scale: 1, form: "칸으로 쪼갬" },
      },
      {
        label: "값 해석",
        tech: "numfmt",
        note: "칸마다 수·날짜·불리언·수식을 가른다. 010으로 시작하는 전화번호는 수로 바꾸지 않는다 — 이게 엑셀에서 제일 자주 데이는 자리라서.",
        src: "apps/sheet/src/lib/sheet/model.ts",
        feat: "sheet-format",
        cargo: { count: 6, scale: 1, form: "값이 된 칸" },
      },
      {
        label: "수식 계산",
        tech: "formula-engine",
        note: "참조를 뽑아 그래프를 세우고 위상 순서로 훑는다. 순환은 여기서 잡혀 #CIRC!가 된다.",
        src: "apps/sheet/src/lib/formula/engine.ts",
        feat: "sheet-formula",
        cargo: { count: 6, scale: 1, form: "계산된 칸" },
      },
      {
        label: "표시 형식 적용",
        tech: "numfmt",
        note: "저장된 값과 보이는 글자는 다르다. 45000이 2023-03-15로 보이는 것도, 0.125가 12.5%로 보이는 것도 이 단계다.",
        src: "apps/sheet/src/lib/sheet/numfmt.ts",
        feat: "sheet-format",
        cargo: { count: 6, scale: 1, form: "읽히는 글자" },
      },
      {
        label: "CSV로 되돌리기",
        note: "화면에 보이는 글자 그대로 쓴다. 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM을 앞에 붙이는 게 기본값이다.",
        src: "apps/sheet/src/lib/sheet/csv.ts",
        feat: "sheet-open",
        cargo: { count: 1, scale: 1, form: "다시 한 파일" },
      },
      exitStep("apps/sheet/src/lib/sheet/save.ts", "내 컴퓨터로"),
    ],
  },
  {
    id: "sheet-xlsx",
    label: "엑셀 열기·저장",
    input: ".xlsx",
    output: ".xlsx · .csv",
    steps: [
      {
        label: "엔진 내려받기",
        tech: "exceljs",
        note: "압축 전 848kB라 번들에 늘 얹지 않는다. xlsx를 실제로 열거나 저장할 때만 import()로 가져온다 — CSV만 쓰는 사람은 받지 않는다.",
        src: "apps/sheet/src/lib/sheet/xlsx.ts",
        feat: "sheet-xlsx",
        cargo: { count: 1, scale: 1, form: "zip 그대로" },
      },
      {
        label: "시트·셀 읽기",
        tech: "exceljs",
        note: "값·수식 원문·글꼴·채우기·테두리·표시 형식·병합·틀 고정·열 너비를 우리 자료구조로 옮긴다. 날짜는 여기서 엑셀 일련번호가 된다.",
        src: "apps/sheet/src/lib/sheet/xlsx.ts",
        feat: "sheet-xlsx",
        cargo: { count: 8, scale: 1, form: "격자 + 서식" },
      },
      {
        label: "수식 재계산",
        tech: "formula-engine",
        note: "파일에 든 계산 결과를 믿지 않고 다시 센다. 열자마자 맞는지 확인되고, 편집한 뒤에도 같은 경로로 갱신된다.",
        src: "apps/sheet/src/lib/formula/engine.ts",
        feat: "sheet-formula",
        cargo: { count: 8, scale: 1, form: "계산된 격자" },
      },
      {
        label: "화면에 그리기",
        tech: "numfmt",
        note: "보이는 행·열만 DOM에 올린다. 머리글과 틀 고정은 네이티브 sticky라 스크롤에서 떨리지 않는다.",
        src: "apps/sheet/src/lib/sheet/numfmt.ts",
        feat: "sheet-format",
        cargo: { count: 8, scale: 1, form: "읽히는 표" },
      },
      {
        label: "다시 xlsx로",
        tech: "exceljs",
        note: "수식은 원문과 마지막 계산값을 함께 써서 엑셀에서 열자마자 값이 보이게 한다. 서식·병합·틀 고정도 같이 돌아간다.",
        src: "apps/sheet/src/lib/sheet/xlsx.ts",
        feat: "sheet-xlsx",
        cargo: { count: 1, scale: 1, form: "zip 한 개" },
      },
      exitStep("apps/sheet/src/lib/sheet/save.ts", "내 컴퓨터로"),
    ],
  },
  {
    id: "sheet-convert",
    label: "표 → JSON·마크다운",
    input: "열려 있는 표",
    output: ".json · 마크다운 표",
    steps: [
      {
        label: "보이는 글자로 굳히기",
        tech: "numfmt",
        note: "내보내는 건 저장된 값이 아니라 화면에 보이던 글자다. ₩1,500으로 보이던 칸은 ₩1,500으로 나간다.",
        src: "apps/sheet/src/lib/sheet/numfmt.ts",
        feat: "sheet-format",
        cargo: { count: 6, scale: 1, form: "굳은 글자" },
      },
      {
        label: "머리글을 키로",
        note: "첫 줄을 키 이름으로 삼아 객체 배열을 만든다. 같은 이름이 겹치면 뒤에 번호를 붙인다.",
        src: "apps/sheet/src/lib/sheet/convert.ts",
        feat: "sheet-export",
        cargo: { count: 1, scale: 0.9, form: "객체 배열" },
      },
      exitStep("apps/sheet/src/lib/sheet/save.ts", "내 컴퓨터로"),
    ],
  },

  // ── 드롭 ─────────────────────────────────────────────────────
  // 이 흐름만 궤짝이 아니라 전용 무대(랑데부)로 재생된다 — 단계마다 장소가 바뀌는 게
  // 아니라 등장인물의 역할이 바뀌기 때문이다. cargo를 적지 않는 이유.
  {
    id: "drop-connect",
    label: "파일이 상대 기기까지 가는 길",
    input: "보낼 파일 + 숫자 6자리",
    output: "상대 기기에 저장된 파일",
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
        feat: "drop-code",
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
];

export const PIPELINE_BY_ID = new Map(PIPELINES.map((pipe) => [pipe.id, pipe]));
