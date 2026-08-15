# CLAUDE.md — local-tools

브라우저 안에서만 동작하는 개인 도구 모음. 첫 도구는 **PDF**(`apps/pdf`).

## 한 줄 정체성

각 도구는 **자기완결 단일 HTML 파일**로 빌드된다. 더블클릭(오프라인)으로도, 호스팅 URL로도 쓴다.
**모든 처리는 브라우저 안에서만** 일어나고 파일은 네트워크로 나가지 않는다(예외: 암호 걸린 PDF → 아래 참고).

## 명령어

```bash
pnpm install
pnpm dev:pdf  # apps/pdf 개발 서버 (vite)
pnpm build    # 전체 앱 빌드 — 자가해제형 단일 HTML 산출 → apps/*/dist/index.html
pnpm check    # 전체 svelte-check 타입 체크 (0 errors/warnings 유지할 것)
```

배포: main에 푸시하면 GitHub Actions가 빌드해 **https://tools.cranemont.com/** 로 올린다(`/pdf/`·`/gif/`·`/video/`·`/dev/`·`/image/`·`/sheet/`·`/doc/`·`/drop/`·`/lab/` + `/guide/`). 별도 배포 명령 없음.
**`apps/stack`(기술 지도)은 배포하지 않는다** — 저장소를 설명하는 개발용 화면이라 `pnpm dev:stack`으로 로컬에서만 띄운다. 빌드·`pnpm check`(정합성 검사)는 그대로 돈다.

## 구조 (경량 pnpm 모노레포)

```
apps/pdf/            # PDF 도구 (Svelte 5 + TS)
  src/App.svelte     # 셸 + 3탭 라우팅
  src/lib/i18n.ts    # 모든 사용자 문구 (한국어 전용, 여기 한 곳에 모음)
  src/lib/Icon.svelte# 라인 SVG 아이콘 세트(이모지 안 씀)
  src/lib/canvas/    # 탭① 편집·병합 (통합 캔버스)
  src/lib/toimage/   # 탭② 이미지·텍스트 (한 탭이 두 형식 축을 가진다 — 아래 27번)
  src/lib/password/  # 탭③ 압축·암호 — 암호 걸기·풀기
  src/lib/compress/  # 탭③ 압축·암호 — 용량 줄이기(아래 32번)
  src/lib/pdf/       # 엔진: engine(썸네일)·exporter(병합·분할)·rasterize(PNG/JPG/WebP)·
                     #        save(다운로드)·qpdfLoader(암호·재압축)·pdfjs(워커)·
                     #        compress(목표 용량 탐색·조사 순서·글자 판정, 순수)·
                     #        repack(쪽을 이미지로 다시 그려 새 PDF)·
                     #        range(쪽 범위 "1-5, 8, 12-" 파서 — 세 탭이 공유)·
                     #        unlock.svelte.ts(암호 PDF를 만나면 프롬프트를 띄우고 다시 연다)·
                     #        extract(pdf.js getTextContent 호출부 — 뷰포트 행렬로 쪽 회전을
                     #          걷어내 순수 함수에 넘긴다)·text(줄 묶기·공백 추론·문단 나누기,
                     #          pdf.js를 import하지 않는다)·zipnames(ZIP 항목 이름 겹침 회피)
  src/lib/PasswordPrompt.svelte  # 암호 입력 모달(편집·이미지 탭 공용)
  vite.config.ts     # 자가해제 플러그인 사용 (공용 패키지)
apps/gif/            # GIF 에디터 (Svelte 5 + TS) — 단일 에디터 뷰(탭 없음)
  src/lib/editor/    # state.svelte.ts(상태 싱글턴)·Preview·Filmstrip·Panel·ImportDialog
  src/lib/gif/       # 엔진: decode(ImageDecoder 온디맨드+LRU)·encode(gifenc)·
                     #        webp(ANMF muxer)·mp4(WebCodecs 내보내기)·
                     #        video(동영상 임포트)·transform·extract(PNG ZIP)·save·
                     #        timing(형식별 딜레이 하한·눈금 — 미리보기와 결과를 일치시킨다)·
                     #        overlay(텍스트 오버레이 — 프레임 범위 판정·프리셋 좌표·줄바꿈 계획)·
                     #        plan(내보내기 시작 시점의 상태 스냅샷 — 아래 28번)·
                     #        redact(모자이크·블러 영역 — 좌표계 변환·손잡이 끌기, 순수)·
                     #        diff(프레임 차분 — 바뀐 사각형·투명 인덱스·적용 판정, 아래 34번)
apps/video/          # 동영상 도구 (Svelte 5 + TS) — 트림·압축·변환·소리, 파일 한 개씩
  src/lib/editor/    # state.svelte.ts·Player(<video>+구간재생)·Timeline(스트립+핸들+kf눈금)·Panel
  src/lib/video/     # 엔진: probe(메타·키프레임)·thumbs(스트립)·transcode(mediabunny
                     #        Conversion — 정확=재인코딩/무손실=패킷복사·소리추출)·save·
                     #        segments(구간 목록 정규화·진행률 가중치·무손실 판정, 순수)·
                     #        concat(구간 잇기 — Output에 패킷을 직접 옮긴다, 아래 33번)
apps/image/          # 이미지 도구 (Svelte 5 + TS) — 변환·압축·리사이즈·크롭·EXIF, 필름스트립 일괄
  src/lib/editor/    # state.svelte.ts(크롭 후보·되돌리기 스택)·Preview(디바운스 재인코딩+
                     #   용량 배지+크롭 오버레이)·Panel
  src/lib/image/     # 엔진: decode(LRU+HEIC 위임)·pipeline(회전→반전→크롭→맞춤→pica→인코딩,
                     #        targetSize=목표 캔버스 / fitPlan=그 위 배치로 갈라 둠)·
                     #        size(그 두 순수 함수)·exif(APP1/RIFF/eXIf 바이트 조작)·
                     #        heic/avif(CDN wasm)·save·
                     #        target(목표 용량 이진 탐색 — 인코더를 주입받는 순수 상태 기계)·
                     #        quantize(median cut 직접 구현 — PNG 색 수 축소)
apps/sheet/          # 시트 (Svelte 5 + TS) — CSV·엑셀 편집기. ★ 이 앱만 두 벌로 빌드한다(아래 13번)
  src/lib/sheet/     # 문서: types(셀·시트·통합문서 — 셀의 `raw`가 가져온 원문이다)·
                     #   model(조작·입력해석·정렬 — 정렬은 표 전체 행을 안정 정렬)·a1(A1↔좌표)·
                     #   csv(인코딩 판별+구분자 추론+RFC4180)·xlsx(ExcelJS 어댑터, 지연 로드)·
                     #   numfmt(엑셀 표시형식 해석)·serial(날짜 일련번호)·convert(JSON/MD/HTML)·save·
                     #   filter(자동 필터 — 술어·고유값·보이는 행 + OP_SCOPE 표, 아래 29번)·
                     #   condformat(조건부 서식 — 규칙 판정·색조 보간·우선순위 합성)·
                     #   validation(데이터 유효성 — 입력 판정·목록 원본 해석)
  src/lib/formula/   # ★ 수식 엔진(직접 구현): tokenize→parse→evaluate,
                     #   engine(의존성 그래프+위상 재계산+순환 감지)·adjust(참조 보정)·
                     #   functions(@formulajs/formulajs 바인딩)
  src/lib/editor/    # state.svelte.ts(문서는 일반 객체 + revision 하나만 $state)·
                     #   Grid(행·열 가상화, 머리글·틀고정은 네이티브 sticky)·Toolbar·
                     #   FormulaBar·SheetTabs·StatusBar·FindBar·Dropdown·FilterMenu
  src/lib/launch.ts  # PWA 파일 연결(launchQueue) + 설치 프롬프트
  pwa.ts             # PWA 빌드 후처리 — 매니페스트·아이콘(PNG 직접 인코딩)·서비스 워커
apps/doc/            # 문서 (Svelte 5 + TS) — 한글·워드 읽기. ★ 이 앱도 두 벌로 빌드한다(아래 13번)
  src/lib/doc/       # 엔진: engine(rhwp wasm 자체 호스팅+SHA-384 검증·프리페치)·
                     #   hwp(열기·페이지 SVG·문단/컨트롤 걷기·찾기·hwpx)·docx(docx-preview 재현
                     #   + mammoth 시맨틱 HTML 지연 로드)·markdown(turndown + 직접 짠 GFM 표 규칙,
                     #   그림 떼어내기)·detect(매직바이트 판별)·save(md 한 장 또는 ZIP)·
                     #   batch(일괄 변환 — ZIP 경로 계획 + 큐 상태 기계, 아래 30번)
  src/lib/editor/    # state.svelte.ts(스테이지 머신)·Editor(좌우 분할·스크롤 비율 동기화)·
                     #   Pages(SVG 쪽 가상 스크롤 — 배율은 쪽의 실제 폭으로 건다)·
                     #   MarkdownPane(저장될 원문 그대로)·Outline(목차 — 문단 걷기에서 함께 나온다)·
                     #   scroll.ts(쪽 이동·찾기 하이라이트 좌표 계산)·
                     #   Toolbar·FindBar·PasswordDialog·Dropzone
  rhwp-wasm.ts       # ★ 빌드 플러그인 — wasm을 rhwp-<버전>.wasm으로 내보내고 SHA-384를 코드에 주입
apps/drop/           # 드롭 (Svelte 5 + TS) — 서버 없는 P2P 파일 전송, 단일 플로 뷰
  src/lib/rtc/       # 엔진: signal(SDP deflate-raw+base64url)·peer(non-trickle RTCPeerConnection)·
                     #        transfer(64KB 청크+백프레셔, ack 기반 진행률)·save·
                     #        frames(프레임 인코딩·파싱을 한 자리로)·
                     #        progress(ack 이력 → 이동 평균 속도)·
                     #        rendezvous(6자리 코드 — 공개 Nostr 릴레이 6곳 랑데부, 4메시지)·
                     #        spake2(RFC 9382 P-256 — 코드 오프라인 대입 불가, 벡터 검증됨)·
                     #        nostr(NIP-01 최소 클라이언트, @noble/curves 서명)
  src/lib/editor/    # state.svelte.ts(스테이지 머신)·Editor·QrCode(uqr)·ScanDialog(카메라 스캔)
apps/dev/            # 개발자 유틸 (Svelte 5 + TS) — 사이드바+검색 셸, 도구 16종
  src/lib/persist.svelte.ts  # ★ 도구별 입력 보존 — persisted() 하나로 16종을 닫는다.
                     #   도구를 옮겼다 와도, 새로고침해도 남는다(디바운스 후 sessionStorage 1회 직렬화).
  src/lib/tools/     # registry(도구 목록·그룹)·search(한글 어미·초성 관용 — 어미 떼기는 2음절까지)·
                     #   JsonTree(접힌 노드는 DOM에 없다)·Format(JSON/YAML/XML 변환)·Diff·Encode·
                     #   Jwt(HS 검증)·Hash(+md5.ts 직접 구현)·Uuid(v4/v7/ULID)·Timestamp·
                     #   Regex·CronTool·Color(culori)·Qr(uqr+BarcodeDetector)·Chars·
                     #   Cookie(Set-Cookie 진단)·OAuthTool(URL 분석+PKCE)·
                     #   Saml(디코드+요약, DecompressionStream)·Xpath(네이티브 evaluate)
apps/lab/            # 실험장 (Svelte 5 + TS) — 임베딩 모델 비교. ★ 도구가 아니라 실험장이고,
                     #   ★ 유일하게 오프라인이 아니다(아래 20번)
  src/lib/embed/     # 엔진: registry(모델 5종의 용량·차원·프리픽스·풀링 위치·MRL 여부)·
                     #   runtime(transformers.js 래퍼 — 장치 협상·한 문장씩 임베딩)·
                     #   bm25(문자 2-gram 기준선, 0 MB)·
                     #   vector(코사인·MRL 절단·overlap@k·Spearman·PCA)·score(짝짓기 채점)·
                     #   stats(Wilson·McNemar 정확검정·평균 신뢰구간)·
                     #   judge(판정 풀링 + Recall·NDCG·MRR, localStorage)·
                     #   results(파레토 점 누적, localStorage)·cache(Cache API 저장소)
  src/lib/corpus/    # samples.ts — 한국어 프로브(존댓말·띄어쓰기·한자어·오타·영어 혼용 짝)
  src/lib/editor/    # state.svelte.ts(실행 목록 + A/B 슬롯 + 판정)·Panel·Matrix(캔버스 히트맵)·
                     #   Bump(순위 이동)·Neighbors·Judge(판정)·Pareto(비용–품질)·
                     #   ScoreCard·Storage·paint(토큰→sRGB)
  ort-wasm.ts        # ★ 빌드 플러그인 — ort의 wasm 자기참조를 끊는다. 빼면 산출물이 63MB
apps/stack/          # 기술 지도 (Svelte 5 + TS) — ★ 이 앱만 단일 HTML이 아니다(아래 11번)
  src/lib/data/      # ★ 페이지 내용물: stack.ts(앱·기능·기술·연결, 각 항목에 소스 경로·
                     #    서드파티 pkg·네트워크 상대)·pipelines.ts(단계별 흐름 + 단계마다
                     #    화물이 어떻게 변하는지 cargo). 문구가 여기 있는 예외.
  src/lib/graph/     # 셸 — state.svelte.ts(필터·검색·강조)·Controls(요약·레인 필터·검색)·
                     #    List(검색 결과 목록 — WebGL 없을 때의 유일한 통로)·Detail·Pipeline
  src/lib/city/      # 본 화면(3D 기계 도시) — layout3d(유닛·포트·배관·성벽·성문·통신 설비
                     #    배치, three 의존 없음)·parts(격자탑·덕트·안테나·궤짝·배관 지오메트리)·
                     #    scene(three.js 씬·인스턴스 뱅크·픽킹·화물 재생·걷기 모드)·
                     #    palette(테마 토큰→sRGB)·route(파이프라인 단계 → 유닛, 소스 경로로 유도)·
                     #    rendezvous(드롭 전용 무대 — 게시판=릴레이·거울=STUN·직결 관, 10박자)
  src/lib/mech/      # ★ 건물 안 — mechanisms.ts(프로토콜·검증·바이트 배치 도식 데이터)와
                     #    Sequence·Flow·Bytes 렌더러. 도식의 수치는 전부 소스에서 확인한 값.
packages/theme/tokens.css  # 공용 디자인 토큰 — 색(OKLCH, 라이트/다크)·타입·간격·모션·z 스케일
                           #    + 범주형 팔레트 --cat-1..5(-ink) — 갈래가 다른 것들을 나란히 놓을 때
packages/theme/base.css    # ★ 공용 리셋 + UI 프리미티브(.btn 8상태·.icon-btn·.spinner·
                           #    reduced-motion·.sr-only). main.ts에서 tokens 다음에 로드.
packages/wasm-loader/      # 공용 wasm 로더(SRI+SHA-384 fail-closed, 후보 URL 폴백) — image·pdf·doc 사용
packages/pwa-kit/          # 공용 PWA 자산 도구 — OKLCH→sRGB·PNG 인코더·아이콘 캔버스·서비스 워커
                           #    소스. 시트와 문서 두 앱이 쓴다(글리프·매니페스트만 앱에 남김).
packages/vite-plugin-self-extracting/  # ★ 자가해제 압축 후처리 플러그인 (모든 앱 공용)
site/                # Pages 정적 파일 — 랜딩·404·sitemap.xml·og/(OG 이미지)
.github/workflows/deploy.yml  # main 푸시마다 check+build → GitHub Pages 배포
scripts/og-template.html      # OG 이미지(1200×630) 재생성용 템플릿(비배포)
scripts/check-stack-sources.mjs  # ★ 기술 지도가 코드와 어긋났는지 검사 (apps/stack의 check가 실행)
```

새 도구는 `apps/<name>/`로 추가하고 `@local-tools/theme` 재사용. 루트 스크립트 규칙:
`build`·`check`는 재귀(`pnpm -r`), `dev`·`preview`는 `dev:<app>` 식 앱별 스크립트.

## 스택 / 대상

- **크로미엄 전용**(Chrome/Edge 최신). File System Access·DecompressionStream·WebGPU 등 사용, FF/Safari 미검증.
- Vite 8 + `vite-plugin-singlefile` + **Svelte 5(runes)** + TypeScript.
- 라이브러리: `pdf-lib`(병합/회전/이미지임베드), `pdfjs-dist` v6(썸네일·래스터), `fflate`(ZIP), `@neslinesli93/qpdf-wasm`(암호, CDN 지연로드), `gifenc`(GIF 인코딩), `mediabunny`(순수 TS — 동영상 디먹싱·MP4 muxing), `exceljs`+`@formulajs/formulajs`(시트), `@rhwp/core`(한글 렌더러 — 유일한 wasm 자체 호스팅)+`docx-preview`+`mammoth`+`turndown`+`hwp-convert`(문서), 개발자 유틸은 `js-yaml`·`fast-xml-parser`·`diff`·`cronstrue`(ko)·`croner`·`culori`·`uqr` — 전부 순수 JS, wasm 없음. 실험장은 `@huggingface/transformers`(임베딩 — 모델·실행기를 실행 시점에 내려받는다).
- apps/dev 주의: `@tsconfig/svelte`가 target을 es2017로 낮춰 최신 API(matchAll 등) 타입 에러가 남 — 앱 tsconfig에 `"target"/"lib": ES2022` 명시로 해결(다른 앱도 동일 증상 시 같은 처리).

## ⚠️ 주의사항 (놓치기 쉬움 — 꼭 읽기)

1. **TypeScript는 5.x로 핀 고정.** pnpm이 최신을 물면 TS 7이 깔리는데 `svelte-check`가 아직 비호환이라 `pnpm check`가 크래시한다. `typescript`를 7로 올리지 말 것.

2. **qpdf 무결성 해시.** `src/lib/pdf/qpdfLoader.ts`는 `@neslinesli93/qpdf-wasm@0.3.0`을 CDN에서 지연 로드하며:
   - 글루 JS: `<script integrity=...>`(SRI)로 브라우저가 강제 검증.
   - `.wasm`: fetch 후 **SHA-384 직접 검증**(불일치 시 실행 거부, fail-closed) → 검증된 바이트로 blob URL 만들어 `locateFile`이 그것만 가리킴(이 빌드는 `wasmBinary` 미지원).
   - **버전을 올리면 두 해시(GLUE_SRI, WASM_SRI)를 반드시 재계산**해야 한다. 안 하면 암호 기능이 통째로 안 됨.
   - **암호 걸린 PDF를 다룰 때만 인터넷이 필요**하다(엔진 최초 1회 다운로드). 암호 탭뿐 아니라
     편집·이미지 탭도 암호 걸린 문서를 만나면 qpdf를 받아 푼다(`unlock.svelte.ts`가 프롬프트를
     맡고, 엔진은 `PdfPasswordError`만 던진다). 나머지 기능은 완전 오프라인.

3. **자가해제형 빌드.** `@local-tools/vite-plugin-self-extracting`(packages/)의 `selfExtractingHtml()`가 빌드 후 인라인 JS/CSS를 deflate-raw+base64로 넣고, 로드 시 `DecompressionStream`으로 푼다(2.1MB→~0.9MB). 스플래시 색·문구는 옵션 인자로 커스텀 가능.
   - 이 후처리는 `vite-plugin-singlefile` 출력 태그 형태(`<style rel="stylesheet" crossorigin>`, `<script type="module" crossorigin>`)에 **정규식으로 의존**한다. Vite/플러그인 업그레이드로 태그가 바뀌면 후처리가 **조용히 건너뛴다(early return)** → 파일이 안 줄어듦.
   - 확인법: 빌드 로그에 `self-extracting-html: dist/index.html → NNN kB`가 찍히는지 볼 것. 안 찍히면 정규식 갱신 필요.

4. **도구가 만든 파일을 내려받는 것은 표준 `<a download>` 방식**(`src/lib/pdf/save.ts` 등 일곱 앱의 `save.ts` — pdf·gif·video·image·sheet·doc·drop).
   File System Access(`showSaveFilePicker`/`showDirectoryPicker`)로 되돌리지 말 것 — 그건 크롬 "다운로드"
   목록에 안 뜨고 저장 위치가 헷갈린다는 사용자 피드백으로 표준 다운로드로 바꾼 것이다.
   - **예외는 `apps/drop`의 수신 경로 하나다**(2026-08-14 판단으로 뒤집었다). 받는 파일은 우리가 만든
     결과물이 아니라 **크기를 모르는 남의 파일**이라서, 다 모아 놓고 내려받으면 큰 파일에서 탭이 죽는다.
     그래서 여기서만 청크를 디스크로 흘려보낸다.
   - **`showSaveFilePicker`는 사용자 제스처를 요구하는데 청크는 제스처 없이 도착한다.** 그래서 수신
     **수락 단계**가 구조상 필요하다 — "받기"를 누른 그 클릭이 저장 위치를 묻는 제스처다. 수락 단계를
     없애면 스트리밍도 같이 죽는다.
   - API가 없거나 사용자가 고르기를 취소하면 **메모리 + `<a download>`로 물러난다**. 이 폴백을 지우지 말 것.

5. **pdf.js 워커는 `?worker&inline`으로 인라인**(`src/lib/pdf/pdfjs.ts`). 단일 파일 유지의 핵심. 외부 workerSrc URL로 바꾸지 말 것.
   - 단, pdf.js 보조 디코더(JBIG2/JPEG2000/QCMS)는 번들에 없다. 그런 희귀 인코딩 이미지가 든 PDF는 썸네일/래스터에서 문제될 수 있음(일반 PDF는 무관).

6. **문구는 전부 `i18n.ts`에** 모은다(한국어 전용). 컴포넌트에 하드코딩 금지 — 나중 영어 확장 대비.

7. **버튼·색·크기는 `packages/theme`에서만 정의한다.** 예전엔 `.btn`이 15개 파일에, 스피너가
   6개 파일에 복제돼 있어 disabled 투명도(0.45/0.5)·커서가 앱마다 갈렸다. 지금은 전부
   `base.css`의 `.btn`(+`.primary .ghost .danger .active .small .large .pill`)·`.icon-btn`·
   `.spinner` 하나뿐이다. **컴포넌트에서 `.btn`을 다시 정의하지 말 것** — 변형이 필요하면
   modifier를 쓰거나 새 modifier를 `base.css`에 추가한다.
   - 색은 **역할별로** 갈라져 있다: `--accent`는 **면(배경·테두리)** 전용, 글자·아이콘은
     `--accent-ink`. 라이트 테마에서 `--accent` 위에 `--accent`색 글자를 올리면 3.17:1로
     WCAG 미달이라 나눈 것이다. 컨트롤 경계선은 `--border`(장식용 헤어라인)가 아니라
     `--border-strong`(표면 대비 3:1). 새 색을 인라인으로 쓰지 말고 토큰을 추가할 것.
   - `font-size`·`z-index`·transition duration/easing도 전부 토큰이다(`--text-*`·`--z-*`·
     `--dur-*`·`--ease-*`). 원시 px나 브라우저 기본 `ease`를 다시 넣지 말 것.
   - 간격(`--space-*`, 4pt)은 **신규/수정 코드에만** 적용돼 있다. 기존 앱의 7·10·14·18px 등
     레거시 패딩은 시각적 리플로를 피하려고 그대로 뒀다 — 손대는 김에 점진 이관.

8. **apps/gif 엔진은 전부 wasm 없이 돌아간다.** WebP 내보내기는 크로미엄 네이티브 `canvas.convertToBlob("image/webp")` + 순수 TS muxer(`webp.ts`, VP8X+ANIM+ANMF), 동영상 임포트·MP4 내보내기는 WebCodecs + `mediabunny`(순수 TS), GIF 디코딩은 네이티브 `ImageDecoder`. libwebp/ffmpeg류 wasm을 인라인하지 말 것 — 단일 HTML을 ~170kB로 유지하는 핵심(크로미엄 전용 전제).
   - 동영상 임포트는 선택 구간을 fps 간격으로 샘플링해 **프레임별 WebP 정지 이미지 소스**로 변환한다(기존 still 파이프라인 재사용). 원본 영상 바이트는 임포트 후 버려짐.

9. **apps/stack이 답하는 질문은 "데이터가 어디로 흐르는가" 하나다.** 빌드 도구·디자인 토큰·자가해제 같은 **코드레벨 항목은 의도적으로 빼 놨다**(예전엔 `build` 성격과 "공통 기반" 구역이 있었다). 새 기능을 지도에 올릴 땐 "이게 파일이 지나는 길에 등장하나?"를 먼저 물을 것 — 아니면 넣지 않는다.
   - **도시에는 흐름이 지나는 유닛만 세운다**(`layout3d.ts`의 `featsOf`). 파이프라인에 한 번도 안 걸리는 기능(개발자 유틸 11종·이 페이지 자신 등 15개)은 지형이 없고 오른쪽 목록에만 있다 — 목록에서 점선 밑줄이 그 표시다(`FEATURES_ON_FLOW`). 예전엔 납작한 슬래브로 세웠는데 이름표만 단 상자밭이 돼서 "무엇을 보라는 건지" 알 수 없었다. 되살리지 말 것.
   - 그래서 **기능을 지도에 올리는 정상 경로는 파이프라인을 적는 것**이다. `pipelines.ts`에 단계를 쓰면 유닛이 서고 배관이 생긴다. 유닛만 세우고 싶어서 가짜 흐름을 지어내지 말 것.
   - 어느 흐름이든 마지막은 `common-save`(출입구)로 나간다 — 다섯 앱에 같은 `save.ts`가 복제돼 있다는 사실이 도시에서는 가운데로 모이는 배관으로 보인다.

10. **apps/stack(기술 지도)는 손으로 쓴 설명이라 코드보다 먼저 낡는다.** 그래서 `scripts/check-stack-sources.mjs`가 `pnpm check`에서 다섯 가지를 강제한다:
   - `src/lib/data/*.ts`가 적은 **모든 저장소 경로가 실재**하는지 → 파일을 옮기면 CI가 깨진다. 경로를 지워서 검사를 피하지 말 것.
   - 지도의 **서드파티 목록(`pkg`)이 각 앱 `package.json`의 dependencies와 정확히 일치**하는지 → 의존성을 새로 넣거나 빼면 지도도 같이 고쳐야 통과한다.
   - **`Tech.net.hosts`에 적은 접속 상대가 그 소스에 실제로 있는지** → 릴레이 목록·STUN·CDN 호스트가 바뀌면 CI가 잡는다. 도시가 성벽 밖에 세우는 중계탑이 이 값에서 나오므로, 여기가 낡으면 그림이 거짓말을 한다.
   - **파이프라인의 모든 단계가 유닛 하나에 착지**하는지 → 안 닿는 단계가 있으면 도시에서 배관이 끊긴 채 그려진다(예전에 `pdfjs.ts`·`nostr.ts`가 그랬다). 해석 규칙은 `city/route.ts`와 같다: `Step.feat`이 있으면 그것, 없으면 그 `src`를 가진 기능. 한 파일을 여러 기능이 나눠 쓰면(`transcode.ts`) `feat`으로 못 박을 것.
   - **도구 이름·한 줄 설명이 랜딩 카드(`site/index.html`)와 같은지** → 도구 이름의 정본은 랜딩 카드다. 같은 도구가 홈과 지도에서 다른 이름이면(예전 `개발자 유틸` ↔ `개발자 도구`) 다른 물건으로 읽힌다. 카드를 고치면 `APPS`도 같이 고쳐야 통과한다.
   - 다른 앱 코드를 고칠 때 엔진·API가 바뀌었다면 `TECHS`/`FEATURES`의 설명도 같이 손볼 것. 경로 검사는 파일 이동만 잡지 내용의 거짓말은 못 잡는다.
   - `src/lib/mech/mechanisms.ts`와 `Tech.net.layers`는 특히 조심할 것: PBKDF2 반복 횟수·청크 크기·워터마크·qpdf 인자 같은 **실측치가 도식에 박혀 있다**. 해당 코드를 고치면 도식도 함께 고쳐야 한다.

   도시가 그리는 것도 전부 데이터에서 유도된다 — 유닛의 **포트 수 = `Feature.techs.length`**, **높이·앞면 눈금 = 흐름이 여기를 몇 번 지나는가**, 지붕 안테나 = `network`가 붙은 기술을 쓰는가, **배관 = 파이프라인이 실제로 거치는 유닛 순서**(`route.ts`), 성문·중계탑 = `network`·`net.hosts`. 손으로 놓는 좌표를 새로 만들지 말 것 — 세어서 맞출 수 없게 되는 순간 지도가 장식이 된다.

11. **apps/stack만 단일 HTML이 아니다.** 도구가 아니라 저장소를 설명하는 메타 페이지라서 오프라인 더블클릭 요구가 없다. three.js(도시)가 들어가 단일 파일로 묶으면 300kB대가 되므로, 이 앱만 `vite-plugin-singlefile`·자가해제를 빼고 일반 번들 + 코드 분할로 간다. 셸·목록(~135kB, gzip 48kB)이 먼저 뜨고 three.js 청크(562kB)는 뒤따라 붙는다 — 도시가 유일한 화면이라 결국 받긴 하지만, WebGL이 없어도 목록으로 다 둘러볼 수 있다.
   - 배포도 다르다: 다른 앱은 `dist/index.html` 한 장만 복사하지만 stack은 `cp -R apps/stack/dist/. _site/stack/`으로 디렉터리째 옮긴다. 랜딩 카드에 다운로드 링크·용량 표기가 없는 것도 같은 이유.
   - 유닛 높이는 **소스 줄 수가 아니라 흐름 단계 수**다(`stepsPerBuilding()`). 예전엔 빌드 시점에 줄 수를 세는 `stackLoc()` 플러그인이 있었는데, "코드가 얼마나 큰가"는 이 지도가 답하는 질문이 아니라서 통째로 뺐다 — 되살리지 말 것.
   - 카메라: 처음 화면은 **성벽 안**만 잡는다(`HOME = wallRadius * 1.55`). 재생을 누르면 그 흐름이 지나는 것들의 상자를 재서 그리로 활공한다(`frameOf`) — 랑데부처럼 성벽 밖까지 가는 흐름이면 저절로 물러나 게시판·거울까지 담긴다. 예전처럼 처음부터 전부 담으려고 물러나면 공장 바닥이 손톱만 해진다.
   - 재생 속도는 `CARGO_SPEED`·`DWELL_MS`·`BEAT_MS`에 있고 화면의 **속도** 셀렉트가 배속을 곱한다(`setSpeed`). 기준값은 "카드 한 장을 읽을 수 있는가"로 잡은 것이라 더 빠르게 되돌리지 말 것.

12. **apps/image 크롭은 2단계다.** 드래그는 `cropDraft`(점선)만 만들고, **자르기**를 눌러야(또는 Enter) 실제 편집이 된다. 손을 떼는 순간 잘라 버리던 예전 동작은 되살리지 말 것 — 조정할 틈이 없다는 피드백으로 바꾼 것이다. Esc는 취소.
   - 크롭 오버레이는 **그려진 그림 위에만** 깔린다(`measurePaint()` — `object-fit:contain` 여백을 뺀 상자, stagebox 테두리만큼 `clientLeft/Top` 보정). 여백에서는 드래그가 시작되지 않고, 손잡이를 밖으로 끌어도 그림 경계에서 멈춘다. 레이어를 다시 `inset:0`으로 되돌리면 여백이 이미지처럼 잡힌다.
   - 되돌리기(Ctrl+Z / Shift+Ctrl+Z·Ctrl+Y)는 **장 목록과 장별 편집만** 다룬다(`EditorState`의 스냅샷 스택, 최대 30). 형식·품질·리사이즈는 패널에 그대로 보이니 제외한 것이고, 입력란 안에서는 브라우저 기본 되돌리기에 양보한다(`Editor.svelte`의 `typingIn`).

13. **apps/sheet·apps/doc은 두 벌로 빌드한다.** `pnpm build`가 `vite build`(→`dist/index.html`, 자가해제 단일
   HTML 440kB)와 `vite build --mode pwa`(→`dist-pwa/`)를 잇달아 돌린다. 배포는 `/sheet/`에
   **PWA를 얹고** 단일 HTML은 그 옆에 `local-tools-sheet.html`로 내려받기용으로 둔다.
   - apps/doc도 같은 구조다(`dist/index.html` 495kB + `dist-pwa/`). 배포는 `/doc/`에 PWA를
     얹고 단일 HTML은 `local-tools-doc.html`로 옆에 둔다 — 다만 문서 쪽은 이유가 하나 더 있다(16번).
   - PWA가 따로 있는 이유는 **파일 연결 하나**다. 매니페스트의 `file_handlers` + `launchQueue`로
     설치된 앱이 `.csv`·`.xlsx`의 열기 대상이 된다(Chromium 데스크톱 전용) — 맥에서 CSV
     더블클릭이 Numbers로 가는 걸 브라우저 안에서 바꿀 수 있는 유일한 수단이고, 매니페스트와
     서비스 워커는 단일 파일에 넣을 수 없다. 이 요구가 없어지면 PWA 빌드를 지워도 된다.
   - **아이콘은 `pwa.ts`가 직접 그려 PNG로 인코딩한다**(zlib + CRC32 + IHDR/IDAT). 저장소에
     바이너리를 두지 않으려는 것이고, 색은 `--brand-600`의 OKLCH 값을 sRGB로 변환해 쓴다 —
     손으로 고른 hex를 새로 만들지 않기 위해서다. 토큰 값이 바뀌면 `pwa.ts` 상수도 같이 고칠 것.
   - **ExcelJS는 `await import()`로만 부른다**(`sheet/xlsx.ts`). 압축 전 848kB라 정적 import로
     바꾸면 CSV만 쓰는 사람도 통째로 받게 된다. `vite.config.ts`가 `exceljs` → `exceljs.bare.min.js`로
     별칭을 걸어 core-js 폴리필(+82kB)을 뺀다 — 크로미엄 전용이라 죽은 무게다.
   - **SheetJS가 아니라 ExcelJS인 이유**: SheetJS 무료판은 **스타일 쓰기가 Pro 전용**이고 npm
     레지스트리도 0.18.5에서 멈춰 있다. 서식 왕복이 요구사항이라 탈락했다. ExcelJS는 정체돼
     있으므로 갈아탈 수 있게 `sheet/xlsx.ts` 한 파일 안에 가둬 뒀다.

14. **시트의 수식 엔진은 직접 짰다.** 완성품인 HyperFormula가 **GPLv3**(상용은 유료)라
   저장소 전체가 전염되기 때문이다. 함수 구현만 `@formulajs/formulajs`(MIT)에서 가져오고,
   렉서·파서·의존성 그래프·재계산은 `src/lib/formula/`에 있다.
   - **경계에서 값을 바꿔 넘긴다**: formulajs는 오류를 `message`가 `"#DIV/0!"`인 Error로,
     날짜를 JS `Date`로 돌려준다 → `CellError`와 엑셀 일련번호로 변환(`functions.ts`).
   - **formulajs에 맡기면 틀리는 것은 직접 구현한다**(`evaluate.ts`의 `NATIVE`): 오류 판별
     함수(`ISERROR`류)는 formulajs 자기 오류 클래스만 참으로 보고, `TEXT`는 날짜를 일련번호로
     담는 우리 규약을 모른다. 여기 손대면 두 경우를 꼭 다시 확인할 것.
   - `IF`·`IFERROR`·`IFS`·`SWITCH`·`CHOOSE`는 **고른 가지만 계산한다**(`LAZY`). 안 그러면
     `IF(B1=0,"",A1/B1)`이 죽는다.
   - **재계산은 매번 전체**다. 부분 재계산보다 "언제나 맞다"가 이 규모에선 값싸다.
   - 재계산은 셀을 제자리에서 고치지 않고 **새 객체로 갈아 끼운다**. 그래야 되돌리기 스냅샷이
     `new Map(cells)` 한 줄로 끝난다(셀은 공유, Map만 복사). 이 불변 규약을 깨지 말 것.

15. **시트의 반응성 규약**: 문서(`WorkbookDoc`)는 **일반 객체**이고 `revision` 하나만 `$state`다.
   셀 수십만 개에 세밀한 구독을 걸면 편집 한 번이 그만큼의 작업이 된다. 문서를 읽는 메서드는
   전부 첫 줄에서 `this.revision`을 건드리므로, `$derived` 안에서 부르면 의존이 저절로 걸린다.
   - 그리드는 **머리글·틀 고정을 네이티브 `position: sticky`로** 붙인다. 스크롤 위치를 JS로 읽어
     좌표를 다시 찍는 방식은 브라우저가 스크롤을 그리는 시점과 어긋나 한 프레임씩 떨린다.
     그래서 셀을 절대 배치하지 않고 행을 실제 흐름 요소로 두었다(가상화는 빈 상자로 메우는 방식).
   - 커서를 따라가는 `$effect`는 **의존이 커서 하나뿐**이어야 한다(나머지는 `untrack`). 예전엔
     `rowY`까지 딸려 들어가서, 셀 하나만 고쳐도 보던 위치가 커서 쪽으로 홱 끌려갔다.
   - 싱글턴 이름은 `editor`다 — `state`로 두면 `$state` 룬과 충돌해 Svelte가 스토어 접근으로
     파싱한다(에러 37개가 이것 하나였다).

16. **apps/doc의 한글 렌더러(rhwp)는 이 저장소에서 유일하게 "우리가 호스팅하는 wasm"이다.**
   8MB(전송 시 brotli 2.1MB)라 단일 HTML에 못 넣는다. `rhwp-wasm.ts`(빌드 플러그인)가
   `rhwp-<버전>.wasm`으로 따로 내보내고, **SHA-384를 빌드 시점에 계산해 코드에 주입**한다 —
   qpdf와 달리 버전을 올려도 해시를 손으로 다시 계산할 일이 없다. 대신 지켜야 할 것들:
   - 글루 JS 안의 `new URL('rhwp_bg.wasm', import.meta.url)`을 플러그인이 **끊는다**. 안 끊으면
     Vite가 wasm을 자산으로 물고 들어가 단일 HTML이 10MB가 된다.
   - 주소는 상대경로 → 배포 주소(`tools.cranemont.com/doc/`) 순으로 시도한다.
     내려받은 단일 HTML을 `file://`로 열면 후자를 탄다. **해시 불일치는 폴백 없이 즉시 거부**다.
   - 프리페치는 앱이 뜨자마자 idle에 시작하되 `saveData`가 켜져 있으면 미룬다.
   - PWA 빌드의 서비스 워커는 wasm을 **프리캐시하지 않는다**(설치 순간 8MB를 받게 된다).
     처음 hwp를 열 때 받아서 런타임 캐시에 남고, 그 뒤로는 오프라인에서도 열린다.

17. **rhwp는 0.8.x이고 실제로 패닉한다.** 제목·문단·표가 섞인 HTML을 `pasteHtml`에 넣으면
   `rendering.rs`에서 패닉하고(`insertion index (is 3) should be <= len (is 1)`), **한 번 패닉하면
   wasm 인스턴스 전체가 죽어** 이후 모든 호출이 `unreachable`로 실패한다. 그래서:
   - `engine.ts`의 `isEnginePanic()`으로 그 말들을 알아보고 상태를 `broken`으로 굳힌 뒤
     새로고침을 권한다. 되살리는 방법은 새로고침뿐이다(다시 받아도 안 된다).
   - hwp.ts의 조용한 catch들은 **패닉만은 삼키지 않는다**. 삼키면 화면이 "빈 문서"처럼 보인다.
   - `finally`에서 `free()`를 맨몸으로 부르지 말 것 — 패닉 뒤에는 그 호출도 실패해서
     ("...while it was borrowed") 진짜 원인을 덮어쓴다. `closeHwp()`가 삼키게 되어 있다.
   - 그래서 **docx→hwpx는 rhwp가 아니라 `hwp-convert`(순수 TS)로 간다.** 원래는 rhwp 하나로
     닫으려 했으나 위 패닉으로 갈랐다. hwp-convert가 만든 파일은 rhwp가 정상으로 읽는다(교차 검증).

18. **한글 문서에서 표는 문단 텍스트가 아니라 "문단에 앵커된 컨트롤"이다.**
   `exportSelectionHtml`만 부르면 표가 통째로 사라진다(실제로 표만 든 문서가 빈 마크다운이 됐다).
   `documentHtml()`은 문단을 걸으며 텍스트와 컨트롤을 번갈아 모은다 —
   컨트롤 개수는 `getControlTextPositions()`가 돌려주는 배열의 길이이고, 내용은
   `exportControlHtml()`이 준다(구역·단 정의는 "내용 생략됨" 주석만 오므로 건너뛴다).
   여기를 단순화하려다 표를 잃지 말 것.

19. **apps/doc의 두 판은 언제나 DOM에 있고, CSS로만 감춘다.** `{#if}`로 떼어내면 두 가지가
   깨진다 — ① **인쇄**는 원본만 내보내는데, 마크다운만 보다가 인쇄를 누르면 내보낼 원본이
   아예 없다(빈 종이가 나왔다). ② 판을 오갈 때마다 페이지 SVG·docx 재현을 다시 그린다.
   그래서 `.pane.hidden { display: none }`이고, 인쇄 순간에는 `editor.printing`이 그 클래스를
   벗긴다(`showOriginal`).
   - **스크롤 맞춤은 `event.target`으로 어느 판인지 가른다.** 스크롤은 위로 올라오지 않아
     (`bubbles: false`) 캡처로 받는데, 캡처 핸들러의 `currentTarget`은 언제나 리스너가 붙은
     상자(`.panes`)다. 예전에 `currentTarget`을 읽어 판을 가르는 바람에 맞춤이 통째로
     안 먹었다 — 마크다운을 굴리면 원본이 맨 위로 튀어 올랐다.
   - 좁은 화면(≤900px)에서는 `view`를 고쳐 쓰지 않고 `effectiveView`로만 한 판을 고른다.
     상태를 덮어쓰면 창을 다시 넓혔을 때 보던 배치가 사라진다.

20. **apps/lab은 도구가 아니라 실험장이고, 저장소에서 유일하게 오프라인이 아니다.**
   "파일이 네트워크로 나가지 않는다"는 여전히 참이지만 — 문장은 이 탭 안에서만 벡터가 된다 —
   **모델은 실행 시점에 받는다**(`huggingface.co` 가중치, `cdn.jsdelivr.net` 실행기 wasm).
   모델을 갈아 끼우는 게 이 앱의 용도라 열두 개를 자체 호스팅할 방법이 없어서다. 그래서
   rhwp·qpdf와 달리 **해시 검증이 없다** — 우리가 호스팅하는 자산이 아니다. 두 호스트는
   `runtime.ts`의 `NETWORK_HOSTS`에 있고 화면 하단에 그대로 띄운다(각주로 숨기지 말 것).
   - **`ort-wasm.ts`를 빼면 산출물이 273kB → 63MB가 된다.** onnxruntime-web 번들 안에
     `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url)`이 있고 Vite가 이걸
     정적으로 알아봐 23.5MB짜리 wasm을 자산으로 끌어온다(단일 HTML이라 통째로 인라인된다).
     rhwp와 같은 부류의 함정이다. 빌드 로그의 자가해제 줄이 **1MB 근처인지** 꼭 볼 것.
   - **`pnpm-workspace.yaml`의 `allowBuilds`를 지우지 말 것.** transformers.js가 딸고 오는
     `onnxruntime-node`·`sharp`·`protobufjs`는 브라우저 경로에서 안 쓰이는데, false로 못 박지
     않으면 pnpm이 "승인 안 됨"으로 **install 자체를 실패시켜** CI가 통째로 멈춘다.
   - **임베딩은 한 번에 한 문장씩** 돌린다(`runtime.ts`). 배치로 묶으면 패딩이 섞여 평균
     풀링이 빈칸을 세거나 `last_token`이 패딩을 집는다. 여기 숫자가 틀리면 화면의 모든
     주장이 무너지므로 속도를 포기했다 — 배치로 되돌리려면 어텐션 마스크를 직접 다룰 것.
   - **문장 벡터가 나오는 자리는 모델마다 다르다**(`registry.ts`의 `head`). EmbeddingGemma는
     ONNX 그래프가 풀링·정규화까지 해서 `sentence_embedding`으로 주고, BGE는 첫 토큰,
     e5는 평균, Qwen3는 마지막 토큰이다. 모델을 추가하면 이걸 먼저 확인할 것.
   - **레지스트리의 dtype 목록은 실물 파일 크기다**(HF 저장소에서 잰 값). EmbeddingGemma에서
     `fp16`·`q4f16`을 뺀 건 실수가 아니다 — 이 모델은 활성값이 fp16을 지원하지 않는다.
     q4f16이 175MB로 제일 작아 솔깃하지만 결과가 깨진다. BGE-M3의 `fp16`도 저장소에 2바이트로
     올라와 있어(내보내기 실패) 뺐다.
   - **절단은 다시 계산하지 않는다.** 실행은 원본 차원 벡터만 저장하고(`Run.vectors`),
     차원은 볼 때 잘라 쓴다(`state.svelte.ts`의 `#slotView`). 그래서 모델을 한 번만 받아도
     "768을 256으로 자르면 이웃이 얼마나 바뀌나"가 즉시 나온다 — 이 앱의 첫 실험이 이것이다.
   - 캔버스 색은 `paint.ts`가 **토큰 값을 실행 시점에 읽어** 쓴다(1×1 캔버스에 칠해 픽셀을
     읽는다). 히트맵에 hex를 새로 심지 말 것 — 그 색만 테마를 안 따라간다.
   - 파이프라인이 `common-save`로 나가지 않는 **유일한 흐름**이다. 이 앱이 만드는 건 파일이
     아니라 화면이라서다(9번의 "마지막은 출입구" 규칙에 대한 의도적 예외).

21. **실험장이 재는 것은 "다름"이 아니라 "나음"이다.** 겹침(overlap@k)·순위 상관은 무엇이
   바뀌었는지만 말한다. 어느 쪽이 맞는지는 정답이 있어야 나오고, 정답은 두 군데서 온다 —
   프로브 짝(자동)과 사용자가 매긴 판정(`judge.ts`). 새 지표를 붙일 땐 어느 쪽인지 먼저
   가를 것.
   - **BM25 점수판은 대칭이 아니다.** 질의 쪽 용어로만 훑고 문서 쪽 길이로 정규화하므로
     `score(i→j) ≠ score(j→i)`다. 코사인 행렬처럼 위 삼각형만 채우고 거울로 베끼지 말 것
     (`similarityMatrix`를 재사용하려다 이걸 깨뜨리기 쉽다). 이웃 순위는 행 단위로 읽으니
     비대칭 그대로가 맞다.
   - **`meanCI`는 표본분산이 0이면 Wilson으로 물러난다.** 40개 질의가 전부 만점이면 정규구간이
     [1.00, 1.00]으로 붕괴해 오차막대가 사라지고, 그림에서 확실한 승자처럼 보인다. 값이
     0..1로 갇혀 있다는 걸 이용한 보수적 대체다 — 이 분기를 지우지 말 것.
   - **판정은 풀링이라 편향이 있다.** 아무 설정도 데려오지 않은 문장은 판정될 기회가 없어서,
     나중에 붙인 모델이 아무도 못 찾은 정답을 찾아오면 "무관"으로 세어진다. 화면에 이
     한계를 적어 두었다(`t.judge.bias`) — 지우지 말 것.
   - **판정과 파레토 점은 localStorage에 코퍼스별로 남는다**(FNV-1a 해시가 저장소 키).
     벡터는 저장하지 않는다 — 모델 한 벌이 200MB~2.4GB인데 결과 점은 100바이트도 안 되고,
     그래서 IndexedDB가 필요 없다. 코퍼스가 바뀌면 점수가 비교 불가라 저장소를 가른 것이다.
   - `Run.kind`가 `dense`면 벡터를, `lexical`이면 점수판을 들고 있다. 뷰는 전부 `SlotView.matrix`
     하나만 보므로 BM25도 기존 화면이 그대로 그린다 — 새 모델 종류를 붙일 때도 이 경계를 지킬 것.
   - 파레토에서 **같은 용량의 점들은 표시상 좌우로 벌려 둔다**(`dodged`). 절단만 다른 조합은
     x가 완전히 같아(자른다고 다운로드가 줄지 않는다) 그대로 두면 셋 중 하나만 보인다.

22. **이미지의 크기 계산은 두 함수로 갈라져 있다** — `targetSize()`는 결과 캔버스가 얼마인지,
   `fitPlan()`은 그 캔버스 위에 원본을 어떻게 앉힐지(늘리기·여백·채우고 자르기)를 답한다.
   패널의 안내 문구가 파이프라인과 **같은 두 함수를 부르게** 되어 있다 — 화면이 말하는 치수와
   실제 산출물이 갈라지지 않게 하려는 것이니, 안내용 계산을 따로 만들지 말 것.
   - **`noEnlarge`(확대 안 함)는 배율 모드에 걸지 않는다.** 한 번 걸었다가 "배율 200%"가
     통째로 죽었다(원본을 그대로 돌려줬다). 배율은 사용자가 확대를 명시한 것이므로 예외다.
     체크박스도 `width`·`height`·`longest`에서만 뜬다.

23. **시트의 셀은 가져온 원문(`raw`)을 들고 있고, 편집 전까지 그대로 다시 나간다.**
   예전엔 값+표시형식으로 재생성해서 **손대지도 않은 칸이 저장하면 달라졌다**(`"1.50"` → `1.5`,
   `+8210…` → 부호 없는 수, 19자리 번호 → 지수 표기). 지금은 CSV 왕복이 바이트 단위로 같다.
   - **표시형식을 한 번이라도 고르면 그 칸은 `raw`를 놓는다** — 사용자가 표현을 정한 것이니
     원문이 이긴다는 규약이 그때부터 뒤집힌다. 이 전이를 없애면 형식 변경이 먹지 않는다.
   - **xlsx 저장은 `raw`가 아니라 값+표시형식으로 나간다**(알려진 경계). 원문을 문자열로 밀어
     넣으면 `"1.50"` 칸이 엑셀에서 수가 아니게 되기 때문이다. 고치려면 원문에서 numFmt를
     역산해야 한다.
   - 안전 정수(2^53) 밖의 숫자열은 **수로 해석하지 않고 글자로 남긴다**. 전화번호·주민번호·
     카드번호·긴 ID가 망가지던 원인이라, 이 검사를 "숫자면 숫자로"로 되돌리지 말 것.

24. **GIF·WebP·MP4는 프레임 딜레이의 하한과 눈금이 서로 다르다**(`gif/timing.ts`).
   GIF는 1/100초 눈금에 20ms 하한(0·1은 브라우저가 100ms로 올린다). 그래서 **미리보기가
   내보내기 형식 칩을 따라간다** — 형식을 바꾸면 재생 속도도 바뀌는 것이 의도된 동작이다.
   미리보기를 형식과 무관하게 되돌리면 "화면과 결과가 다르다"는 원래 문제로 돌아간다.

25. **동영상에서 무손실(패킷 복사)은 회전과 함께 쓰면 조건부로 깨진다.** MP4는 회전을
   메타데이터로 실어 복사를 유지하지만, **WebM(Matroska)은 회전 메타데이터를 쓰지 않아**
   mediabunny가 조용히 재인코딩한다. 화면이 그 조건에서만 안내를 띄우게 되어 있다
   (`rotateBreaksCopy`) — 무손실 표시가 거짓말이 되지 않게 하려는 것이니 지울 것 없다.

26. **드롭의 취소 프레임은 양방향 멱등이다.** 한쪽만 정리하면 상대가 영원히 기다린다.
   취소 뒤 남아서 도착하는 청크가 **다음 파일에 섞이지 않는지**가 이 프로토콜의 급소다.
   같은 이유로 파일 한가운데서 접을 때는 반드시 `cancel`을 보내고 던진다 — 안 보내면
   받는 쪽이 쓰다 만 파일을 연 채 영영 남는다.
   - **진행률·완료는 상대의 `ack` 기준이다**(2026-08-15에 붙였다). 데이터 채널에 건넨 바이트를
     세면 백프레셔 버퍼에 쌓인 것까지 "보냈다"가 되어 첫 구간 속도가 실제보다 높게 나왔다가
     가라앉는다. 최종 ack는 받는 쪽이 **디스크 쓰기(sink close)까지 끝낸 뒤** 보낸다 —
     그래야 "완료"가 진실이다. ack는 256KB·0.5초 간격 + eof 직후 한 번.
   - **하위 호환은 handshake의 `hello`로 가른다.** 상대가 ack를 안다고 말해 놓고 한 장도
     안 보내면 30초 뒤 오류다(낙관 완료로 물러나지 않는다). 상대가 어떤 판인지 **모를 때만**
     20초 유예 뒤 낙관 모드로 물러난다 — 구버전 단일 HTML을 내려받아 쓰는 사람이 있어서다.
     이 두 갈래를 하나로 합치지 말 것. 합치면 둘 중 하나가 반드시 거짓말이 된다.
   - **랑데부 방 태그가 6자리 코드를 새게 한다 — 미해결.** 태그가 코드만의 결정적 함수이고
     salt가 고정이라, 표를 한 번 만들면 릴레이에서 본 태그로 코드를 즉시 얻는다. SPAKE2는
     전사(transcript)를 지킬 뿐 이 통로를 막지 못한다.
     자세한 내용과 고려한 선택지는 [`docs/security/rendezvous-code-tag.md`](docs/security/rendezvous-code-tag.md).
     **랑데부를 손대기 전에 그 문서를 먼저 읽을 것.**

27. **PDF 텍스트 추출은 화면 좌표(y 아래로)만 안다.** 쪽 회전(`/Rotate`)과 y 방향은
   `extract.ts`가 뷰포트 행렬을 왼쪽에서 곱해 걷어낸 뒤 `text.ts`에 넘긴다 — 이 계약 덕에
   회전 처리까지 node에서 테스트된다. PDF 사용자 좌표를 그대로 넘기면 줄 순서가 거꾸로 나온다.
   - **뷰포트 변환만으로는 모자란다 — 회전을 두 번 잰다**(`uprightCorrection`). 뷰포트가
     `/Rotate`를 걷어내는 것은 **글이 그 회전에 맞춰 그려졌을 때뿐**인데, 회전 도구는 내용
     스트림은 놔둔 채 `/Rotate`만 바꾼다 — **우리 편집 탭이 바로 그렇다.** 그런 문서에서는
     뷰포트 변환이 오히려 글을 눕힌다(90·270°는 줄이 세로로 흩어지고 180°는 줄·조각 순서가
     통째로 뒤집힌다). 그래서 기준을 쪽이 아니라 **글 자신**에 둔다: 조각의 기준선이 전부
     한쪽을 가리키면 그쪽을 되돌리고, 방향이 섞여 있으면(똑바른 본문 위에 눕힌 도장 하나)
     손대지 않는다. 이 2차 보정을 빼면 우리 도구로 회전시킨 PDF의 텍스트가 깨진다.
   - **다단(2단) 조판·표·세로쓰기는 범위 밖이고, 그 한계를 `tests/pdf-text.test.ts`가 명세로
     못 박고 있다.** 좌우 단이 한 줄로 이어진다. 고칠 때 테스트부터 고쳐 무엇을 바꾸는지 밝힐 것.
   - **저장 단위가 형식마다 다르다** — 이미지는 쪽마다 한 장, 텍스트는 **문서마다 `.txt` 한 장**.
     200쪽짜리가 200개가 되지 않게 한 것이다. 쪽 경계는 폼 피드(`\f`, pdftotext 관례).
   - 탭 이름은 "이미지·텍스트"다. txt를 내는 탭이 "PDF→이미지"로 남으면 거짓말이 된다.

28. **GIF 내보내기는 시작 시점의 상태를 스냅샷으로 굳혀 끝까지 그것만 본다**(`gif/plan.ts`).
   예전엔 인코딩 중에 프레임을 고르거나 딜레이를 고치면 **결과 파일 하나가 자기 안에서 앞뒤가
   달랐다**(앞쪽 프레임엔 자막이 있고 뒤쪽엔 없는 식). 입력을 잠그는 대신 스냅샷을 고른 것은
   인코딩 중에도 다음 편집을 하고 싶기 때문이다. 살아 있는 배열을 인코더에 넘기지 말 것.
   - 필름스트립 썸네일에는 자막이 안 나온다(임포트 때 굳는 문자열이라 `renderFrame`을 안 지난다).
     알려진 한계다.

29. **시트에 필터가 걸리면 좌표계가 둘로 갈린다** — "문서의 행 번호"와 "보이는 행 목록의 순번".
   행 머리글·커서·선택·복사·수식 참조는 전부 **원래 행 번호**로 남아야 한다(엑셀이 그렇다).
   두 좌표계를 뒤섞으면 안 보이는 칸을 조작하게 된다 — 실제로 커서가 걸러진 줄에 남아
   보이지도 않는 칸의 내용을 지우는 결함이 한 번 났다.
   - **조작이 닿는 범위는 `sheet/filter.ts`의 `OP_SCOPE` 표 하나가 정한다.** 화면 상태는
     `rowsFor(op, area)`로 물어보기만 한다. 새 조작을 붙이면 표에 한 줄 적는 것이 그 조작을
     필터에 이어 붙이는 방법이다 — 갈래를 컴포넌트에서 다시 판단하지 말 것.
   - **붙여넣기는 숨은 줄을 덮는다(엑셀과 같다)** — 건너뛰면 붙인 블록의 모양이 원본과 달라진다.
     대신 **덮은 숨은 줄 수를 상태줄에 알린다**. 이 알림을 지우면 조용한 데이터 손실이 된다.
     세는 시점은 붙이기 **전**이다(붙인 뒤엔 그 줄이 필터에 걸릴지가 이미 달라져 있다).
   - 필터가 걸린 채 행을 삽입하면 새 빈 줄이 곧바로 걸러진다. 라이브 필터의 귀결이고,
     엑셀처럼 "다시 적용까지 남기기"를 하려면 결과 캐시가 필요해 "언제나 맞다"와 부딪힌다.
     알려진 한계로 테스트에 못 박혀 있다.
   - CSV로 "보이는 행만" 내보낸 경우 **dirty를 내리지 않는다** — 걸러진 줄은 어느 파일에도 없다.

30. **문서 일괄 변환에서 패닉에 발이 묶이는 것은 rhwp를 타는 문서뿐이다**(`doc/batch.ts`).
   17번대로 rhwp는 한 번 패닉하면 인스턴스가 통째로 죽지만, **docx는 순수 JS 경로라 무관하다** —
   남은 워드 문서까지 "못 함"으로 세우면 거짓말이다. 종류는 확장자가 아니라 **매직바이트**로
   가른다(`needsEngine` + `detect`). 이름이 `.docx`인 한글 문서가 죽은 엔진을 또 부르지 않게.
   - **패닉이 중단을 이긴다**(`mergeHalt`). 중단은 다시 놓으면 그만이지만 죽은 엔진은 새로고침
     말고 살릴 길이 없는데, `stopped`로 덮으면 화면에서 그 사실과 새로고침 버튼이 함께 사라진다.
     같은 이유로 `nextStep`은 **중단보다 패닉을 먼저** 처리한다.
   - **새로고침 배너·버튼은 목록이 다 끝난 뒤에만 뜬다.** 도는 중에 띄우면 누른 사람이
     이미 옮긴 워드 결과를 잃는다.
   - 순차 규약은 `nextPending`이 지킨다 — 인덱스로 세는 루프로 되돌리면 굳힌 항목을 건너뛰는
     규칙이 런타임에 또 생기고, 갈래의 순서가 테스트에 안 잡힌다.
   - `batchOutputs`가 결과 바이트를 전부 메모리에 쥔다(4번대로 `<a download>`를 지켜야 해서
     스트리밍으로 못 바꾼다). 문서 수십 개에 그림이 많으면 탭 메모리가 커진다.

31. **이미지의 목표 용량은 사용자가 고른 설정보다 더 줄이기만 한다 — 더 좋게(=더 크게) 만들지
   않는다.** 두 축이 같은 약속을 지킨다: 품질 축은 구간 `[1, 사용자 품질]`, PNG 축은 사용자가
   고른 색 수를 상한으로 **눌러 세운 사다리**(`pngLadder(cap)`). 상한 위 칸을 걸러 내면 축이
   통째로 사라져서(색 4는 3칸, 색 2는 1칸만 남는다) 버리지 않고 누른 것이다.
   - PNG 축은 고정 인덱스가 아니다 — 칸 수는 `pngSteps(cap)`, 칸은 `pngStepAt(value, cap)`으로만
     얻는다. `cap`은 필수 인자다(안 넘기면 컴파일이 막힌다).
   - **목표 용량을 켜도 품질·색 수 컨트롤을 잠그지 않는다.** 잠그면 "자동이 정한다"로 읽히는데
     실제로는 사용자가 고른 값이 탐색의 **상한**이라 화면이 거짓말이 된다.
   - **`Stage.pixels()`는 캔버스를 한 번만 읽고 그 결과를 계속 돌려준다 — 제자리에서 고치지 말 것.**
     탐색이 같은 스테이지를 최대 아홉 번 인코딩하는데 `getImageData`를 되풀이하면 크로미엄이
     매번 GPU에서 되읽으며 `willReadFrequently` 경고를 띄운다. 컨텍스트 옵션으로는 못 고친다
     (`getContext`는 처음 준 옵션만 쓰고, 소프트웨어 캔버스로 떨어지면 pica가 느려진다).

32. **PDF 용량 줄이기는 두 갈래이고 성질이 반대다.**
   - **다시 압축** — qpdf가 구조를 다시 쓴다. 글자·글꼴·주석·책갈피를 지킨다.
     인자는 `--object-streams=generate --compression-level=9 --recompress-flate`이고
     `jpegQuality`를 주면 `--optimize-images --jpeg-quality=N`이 붙는다.
     `--linearize`는 뺐다 — 같은 문서에서 83.5%로 오히려 커진다.
     **2번대로 인터넷이 필요하다**(qpdf 최초 1회). 실측치는 `qpdfLoader.ts` 주석에 있고,
     `apps/pdf/index.html`의 FAQ와 `apps/stack`이 그 값을 인용한다 — 고치면 세 곳을 맞출 것.
   - **이미지로** — 쪽을 그려 JPEG로 새 PDF에 심는다(`repack.ts`). 오프라인이고 더 줄지만
     **글자 선택·검색을 영구히 잃는다.** 되돌릴 수 없다.
   - **그래서 글자 유무 판정이 안전 장치다.** `probePdf`는 앞 N쪽이 아니라 **전 쪽**을 훑는다 —
     순서는 `probeOrder()`가 정하고(첫 쪽·마지막 쪽 → 남은 구간의 가운데) 1500ms에서 끊는다.
     앞 5쪽만 보던 예전 방식으로 되돌리지 말 것: 6쪽부터 글자가 시작하는 문서에 "글자 없음"이
     붙어 되돌릴 수 없는 래스터를 안심하고 누르게 된다.
   - **배지는 근거의 범위를 넘겨 말하지 않는다.** 전 쪽을 봤을 때만 "글자 없음"이고, 끊겼으면
     "48/120쪽에 글자 없음"이다. 판정은 `textVerdict()` 한 곳에서 나온다.
   - **pdf.js가 못 여는 문서라도 qpdf 경로는 연다.** 재압축은 쪽 수도 글자 유무도 안 쓴다.
     조사 실패로 파일을 버리지 말 것.
   - 목표 용량은 문서별 값이 아니라 **설정**이다(apps/image와 같은 규약). 그래서 원본이 이미
     목표보다 작은 경우가 흔하고, 그때도 실행은 파일을 내놓아야 한다.

33. **mediabunny에는 여러 구간을 한 파일로 잇는 API가 없다**(1.52.3 기준 확인).
   `Conversion`은 입력 하나에 `trim` 한 쌍만 받고, `ConversionOptions.composable`은 같은
   Output에 트랙을 하나 더 붙이는 옵션이지 이어붙이기가 아니다. `SegmentedInput`은 HLS 전용에
   export되지 않는다. 그래서 `video/concat.ts`가 `Output` + `EncodedVideoPacketSource`에
   `EncodedPacketSink`의 패킷을 직접 옮긴다.
   - **무손실(패킷 복사)은 시작을 자르면 꺼진다.** mediabunny `conversion.js`의 `needsTranscode`에
     `firstTimestamp < startTimestamp`가 있어서 `trim.start > 0`이면 언제나 재인코딩으로 넘어간다.
     구간 하나만 자르는 경로가 여기 걸리므로 `trimStartBreaksCopy`가 판정해 배지에 사유를 적는다.
     25번(WebM 회전)과 같은 부류다 — 무손실 표시가 거짓이 되지 않게 하려는 것이니 지우지 말 것.
   - **구간 목록의 순서가 곧 이어붙이는 순서다.** 겹치는 구간도, 시작 시각이 뒤바뀐 순서도
     고치지 않는다 — 뒤 대목을 앞에 놓거나 같은 대목을 두 번 쓰는 것이 정당한 편집이다.
     `normalizeSegments`가 하는 일은 경계 clamp, 뒤집힌 start/end 교환, 0.1초 미만 제거뿐이고
     겹침·순서는 배지로 알린다.
   - `copyConcat`은 회전 메타데이터를 **컨테이너가 받을 때만** 넘긴다. WebM에 0이 아닌 회전을
     넘기면 mediabunny가 던진다(`output.js`의 `supportsVideoRotationMetadata`).
   - 알려진 한계: B프레임이 든 파일에서 구간 끝 프레임이 몇 장 어긋날 수 있다(디코드 순서로
     끊는다). 복사 경로의 오디오는 구간 시작을 걸친 패킷을 버려 앞 20ms 안팎이 빠진다.

34. **GIF 프레임 차분은 색 하나를 판다.** 안 바뀐 픽셀을 투명 인덱스로 두고 바뀐 사각형만 넣으면
   파일이 크게 주는데, 투명 인덱스가 팔레트 한 칸을 쓰므로 색을 꽉 쓰는 그림에서는 손해다.
   `diff.ts`가 색 예산·바뀐 넓이 비율·원본 알파 유무를 보고 쓸지 정한다.
   - **disposal을 틀리면 잔상이나 깜빡임이 남는다.** 투명으로 비워 둔 자리가 앞 프레임을 보이려면
     "이전 화면 유지"여야 한다.
   - 차분은 픽셀 네 바이트가 하나라도 다르면 다시 그린다. ±1 노이즈가 섞인 영상 프레임은
     변경률이 1에 가까워져 차분이 통째로 꺼진다(허용 오차를 두면 화면과 결과가 갈릴 위험이 있다).

35. **가리기(모자이크·블러)는 원본 위에 덧그리지 않는다.** `source-over`로 얹으면 영역 안에
   투명한 데가 있을 때 가려야 할 그림이 밑에서 비친다 — 가리는 기능에서는 이것이 기능 실패다.
   - 영역 좌표는 한 좌표계에만 산다. 화면의 크기 표시도 `redact.ts`의 같은 변환 함수를 거쳐야
     한다(22번과 같은 규약 — 안내용 계산을 따로 만들지 말 것).
   - 오버레이는 **그려진 그림 위에만** 깔린다(12번). `object-fit:contain` 여백을 빼고
     `clientLeft/Top`을 보정한다. `inset:0`으로 되돌리면 여백이 이미지처럼 잡힌다.
   - 알려진 한계: 블러 영역이 캔버스 가장자리에 붙으면 그 줄의 흐림이 약하다(표본을 반경만큼
     못 뜬다). 필름스트립 썸네일에는 가리기도 자막도 안 나온다(임포트 때 굳는다).

36. **`apps/stack`의 데이터 문자열을 저장소 경로로 시작하지 말 것.**
   `scripts/check-stack-sources.mjs`의 경로 정규식이 따옴표 바로 뒤의 `apps/`·`packages/`·
   `scripts/`·`site/`를 잡는다. `note: "apps/pdf가 …"`로 쓰면 그 문장 전체가 파일 경로로 읽혀
   검사가 깨진다. 경로를 적어야 하면 문장 가운데에 둘 것.
   - **한 파일을 여러 기능이 나눠 쓰게 되는 순간, 그 파일을 쓰던 기존 단계에도 `feat`을 못 박아야
     한다.** `route.ts`는 `feat`이 없으면 그 `src`를 가진 기능 중 첫 번째로 떨어뜨리고,
     검사 ④는 "어딘가에 착지했다"만 보므로 배관이 조용히 다른 유닛으로 옮겨간다.

37. **표본 파일은 코드로 만들고, 두 번 만들면 바이트가 같아야 한다**(`tests/fixtures/`).
   저장소에 바이너리를 커밋하지 않는다(`packages/pwa-kit`이 PNG를 코드로 인코딩하는 관행과 같다).
   - **pdf-lib은 `setCreationDate`·`setModificationDate`를 안 박으면 실행 시각을 넣는다.**
     두 번 지어 비교하는 것만으로는 같은 초 안에 지으면 못 잡으므로 날짜 문자열을 직접 단언한다.
     난수는 시드를 고정한다(`mulberry32`). qpdf 암호화만 결정적이지 않다(난수 키).
   - 이미지 표본에 **균일한 사각형을 쓰지 마라** — 모자이크·블러를 재려면 잔 무늬가 있어야 한다.
     균일한 면은 모자이크 뒤에도 같은 색이라 정상 동작에서 단언이 실패한다.
   - **골든 이미지를 쓰지 않는다.** 같은 캔버스 연산이 Chrome과 node Skia에서 최대 8/255
     어긋난다. 성질로 단언한다 — 영역 안이 원본과 다른가, 밖은 그대로인가.
   - 앱 의존성(`pdf-lib`·`gifenc`)은 pnpm 격리 때문에 루트에서 이름으로 안 풀린다.
     `../../apps/<앱>/node_modules/<pkg>`로 경로 지목한다(루트에 같은 이름을 또 달면 앱이 쓰는
     판과 갈라진다). 규약의 정본은 `tests/fixtures/pdf.ts` 머리말이다.

38. **시간대에 기대는 코드는 시간대를 바꿔 가며 재라.** CI 러너가 UTC라 안 그러면 안 보인다.
   실제로 xlsx 날짜가 열 때마다 오프셋만큼 밀려 왕복 세 번에 하루가 어긋났는데 CI는 초록이었다.
   - **ExcelJS는 일련번호를 UTC 기준 `Date`로 푼다.** 그 `Date`를 로컬 시각으로 읽는
     `toSerial`에 넘기지 마라 — `serial.ts`의 `serialFromExcelJsDate`가 그 경계를 지킨다
     (`getTime()`만 본다). ExcelJS는 1900년 윤년 버그를 흉내 내지 않으므로 그 보정도 얹지 않는다.
   - 명세는 `process.env.TZ`를 대입해 시간대를 세운다(node가 그때 시간대 캐시를 버린다).
     오늘 날짜를 읽는 명세도 로컬 필드가 아니라 값이 적힌 기준으로 읽는다(zip은 UTC).

39. **CSV로 나가는 표의 범위는 "글자가 나가는 칸"이 정한다**(`model.ts`의 `hasContent` —
   값·수식·원문 중 하나). 서식만 든 칸은 줄도 열도 만들지 않는다. 빈 칸에 셀을 만드는
   `applyStyle`은 그대로 둔다 — 그 칸이 xlsx 파일에는 나가기 때문이다.
   `csv.ts`와 `convert.ts`가 같은 판정을 지난다. 한쪽만 고치면 마크다운·JSON에 빈 줄이 는다.
   - **원문(`raw`)을 되살리는 자리는 `cellText` 하나다**(23번). 내보내기 쪽에 `raw` 분기를
     다시 만들지 마라 — 규약이 두 자리에 적히면 한쪽만 고쳐 놓고 고쳤다고 여기게 된다.

## 핵심 설계 결정 (그릴링 합의 요약)

- 개인 도구, **광고 없음**(iLovePDF류는 기능 참고만).
- 통합 캔버스 + 3탭: 대부분 기능이 "캔버스 위 동작"으로 흡수됨(병합·정리·이미지→PDF·추출).
- 내보낼 때 **파일 이름 지정** 가능(캔버스/암호/이미지 모두). 이미지 여러 장은 **ZIP 한 개**.
- 애널리틱스 없음(프라이버시 우선). 사용량은 호스팅 서버 접속 로그로 갈음.

## 검증 방법 (변경 후)

1. `pnpm check && pnpm build` → 0 errors, 자가해제 로그 확인.
   `check`가 `vitest run`을 물고 있어 테스트가 배포를 막는다.
2. `dist/index.html`를 정적 서버(`python3 -m http.server`)로 띄워 브라우저로 확인:
   드롭 → 썸네일 렌더 → 병합/회전/삭제/ZIP/암호 왕복. (`file://`는 확장 자동화가 접근 못 하니 정적 서버 사용.)

### 테스트가 명세다

산문 설명 대신 테스트로 동작을 못 박는다. `describe`/`it`은 동작을 서술하는 한국어로 쓴다.
테스트는 앱 밖 `tests/`에 둔다 — 앱 소스에 섞으면 `svelte-check`가 같이 훑고 앱마다 vitest를
devDependency로 달아야 한다. 새 의존성은 **루트 devDependencies**에만 넣는다
(`scripts/check-stack-sources.mjs`는 앱 `dependencies`만 보므로 지도와 얽히지 않는다).

지금 재는 것은 두 층이다.

- **1층 — node 순수 함수.** 브라우저 없이 도는 계산.
- **2층 — 룬 상태 기계와 실물 파일 왕복.** `vitest.config.ts`의 `svelte()` 플러그인 한 줄로 열린다.
  `.svelte.ts` 싱글턴은 `import { editor } from "../apps/<앱>/src/lib/editor/state.svelte"`로
  부른다(확장자 없이). 테스트 파일에서는 룬을 못 쓰지만 메서드를 부르고 `$derived` 게터를
  그냥 읽으면 값이 나온다.

캔버스·WebCodecs·wasm·DOM이 필요한 코드는 아직 사각지대이고 손으로 브라우저를 연다.
설계와 다음 층 계획은 `docs/local/test-harness-plan.md`에 있다(gitignore — 저장소에 안 올린다).

