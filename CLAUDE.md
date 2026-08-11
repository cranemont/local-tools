# CLAUDE.md — local-tools

브라우저 안에서만 동작하는 개인 도구 모음. 첫 도구는 **PDF**(`apps/pdf`).

## 한 줄 정체성

각 도구는 **자기완결 단일 HTML 파일**로 빌드된다. 더블클릭(오프라인)으로도, 호스팅 URL로도 쓴다.
**모든 처리는 브라우저 안에서만** 일어나고 파일은 네트워크로 나가지 않는다(예외: PDF 암호 탭 → 아래 참고).

## 명령어

```bash
pnpm install
pnpm dev:pdf  # apps/pdf 개발 서버 (vite)
pnpm build    # 전체 앱 빌드 — 자가해제형 단일 HTML 산출 → apps/*/dist/index.html
pnpm check    # 전체 svelte-check 타입 체크 (0 errors/warnings 유지할 것)
```

배포: main에 푸시하면 GitHub Actions가 빌드해 **https://cranemont.github.io/local-tools/** 로 올린다(`/pdf/`·`/gif/`·`/video/`·`/dev/`·`/image/`·`/drop/`·`/stack/`). 별도 배포 명령 없음.

## 구조 (경량 pnpm 모노레포)

```
apps/pdf/            # PDF 도구 (Svelte 5 + TS)
  src/App.svelte     # 셸 + 3탭 라우팅
  src/lib/i18n.ts    # 모든 사용자 문구 (한국어 전용, 여기 한 곳에 모음)
  src/lib/Icon.svelte# 라인 SVG 아이콘 세트(이모지 안 씀)
  src/lib/canvas/    # 탭① 편집·병합 (통합 캔버스)
  src/lib/toimage/   # 탭② PDF→이미지
  src/lib/password/  # 탭③ 암호
  src/lib/pdf/       # 엔진: engine(썸네일)·exporter(병합)·rasterize(PNG)·
                     #        save(다운로드)·qpdfLoader(암호)·pdfjs(워커)
  vite.config.ts     # 자가해제 플러그인 사용 (공용 패키지)
apps/gif/            # GIF 에디터 (Svelte 5 + TS) — 단일 에디터 뷰(탭 없음)
  src/lib/editor/    # state.svelte.ts(상태 싱글턴)·Preview·Filmstrip·Panel·ImportDialog
  src/lib/gif/       # 엔진: decode(ImageDecoder 온디맨드+LRU)·encode(gifenc)·
                     #        webp(ANMF muxer)·mp4(WebCodecs 내보내기)·
                     #        video(동영상 임포트)·transform·extract(PNG ZIP)·save
apps/video/          # 동영상 도구 (Svelte 5 + TS) — 트림·압축·변환·소리, 파일 한 개씩
  src/lib/editor/    # state.svelte.ts·Player(<video>+구간재생)·Timeline(스트립+핸들+kf눈금)·Panel
  src/lib/video/     # 엔진: probe(메타·키프레임)·thumbs(스트립)·transcode(mediabunny
                     #        Conversion — 정확=재인코딩/무손실=패킷복사·소리추출)·save
apps/image/          # 이미지 도구 (Svelte 5 + TS) — 변환·압축·리사이즈·크롭·EXIF, 필름스트립 일괄
  src/lib/editor/    # state.svelte.ts·Preview(디바운스 재인코딩+용량 배지+크롭)·Panel
  src/lib/image/     # 엔진: decode(LRU+HEIC 위임)·pipeline(회전→크롭→pica→인코딩)·
                     #        exif(APP1/RIFF/eXIf 바이트 조작)·heic/avif(CDN wasm)·save
apps/drop/           # 드롭 (Svelte 5 + TS) — 서버 없는 P2P 파일 전송, 단일 플로 뷰
  src/lib/rtc/       # 엔진: signal(SDP deflate-raw+base64url)·peer(non-trickle RTCPeerConnection)·
                     #        transfer(64KB 청크+백프레셔 file/eof/text 프로토콜)·save·
                     #        rendezvous(6자리 코드 — 공개 Nostr 릴레이 6곳 랑데부, 4메시지)·
                     #        spake2(RFC 9382 P-256 — 코드 오프라인 대입 불가, 벡터 검증됨)·
                     #        nostr(NIP-01 최소 클라이언트, @noble/curves 서명)
  src/lib/editor/    # state.svelte.ts(스테이지 머신)·Editor·QrCode(uqr)·ScanDialog(카메라 스캔)
apps/dev/            # 개발자 유틸 (Svelte 5 + TS) — 사이드바+검색 셸, 도구 16종
  src/lib/tools/     # registry(도구 목록·그룹)·Format(JSON/YAML/XML 변환)·Diff·Encode·
                     #   Jwt(HS 검증)·Hash(+md5.ts 직접 구현)·Uuid(v4/v7/ULID)·Timestamp·
                     #   Regex·CronTool·Color(culori)·Qr(uqr+BarcodeDetector)·Chars·
                     #   Cookie(Set-Cookie 진단)·OAuthTool(URL 분석+PKCE)·
                     #   Saml(디코드+요약, DecompressionStream)·Xpath(네이티브 evaluate)
apps/stack/          # 기술 지도 (Svelte 5 + TS) — ★ 이 앱만 단일 HTML이 아니다(아래 10번)
  src/lib/data/      # ★ 페이지 내용물: stack.ts(앱·기능·기술·연결, 각 항목에 소스 경로와
                     #    서드파티 pkg 이름)·pipelines.ts(단계별 흐름). 문구가 여기 있는 예외.
  src/lib/graph/     # 셸 — state.svelte.ts(필터·검색·강조)·Controls(요약·레인 필터·검색)·
                     #    List(검색 결과 목록 — WebGL 없을 때의 유일한 통로)·Detail·Pipeline
  src/lib/city/      # 본 화면(3D 기계 도시) — layout3d(유닛·포트·배관·성벽·성문·통신 설비
                     #    배치, three 의존 없음)·parts(격자탑·덕트·안테나·궤짝·배관 지오메트리)·
                     #    scene(three.js 씬·인스턴스 뱅크·픽킹·화물 재생·걷기 모드)·
                     #    palette(테마 토큰→sRGB)·route(파이프라인 단계 → 유닛, 소스 경로로 유도)
  src/lib/mech/      # ★ 건물 안 — mechanisms.ts(프로토콜·검증·바이트 배치 도식 데이터)와
                     #    Sequence·Flow·Bytes 렌더러. 도식의 수치는 전부 소스에서 확인한 값.
packages/theme/tokens.css  # 공용 디자인 토큰 — 색(OKLCH, 라이트/다크)·타입·간격·모션·z 스케일
                           #    + 범주형 팔레트 --cat-1..5(-ink) — 갈래가 다른 것들을 나란히 놓을 때
packages/theme/base.css    # ★ 공용 리셋 + UI 프리미티브(.btn 8상태·.icon-btn·.spinner·
                           #    reduced-motion·.sr-only). main.ts에서 tokens 다음에 로드.
packages/wasm-loader/      # 공용 CDN wasm 로더(SRI+SHA-384 fail-closed) — image·pdf 암호 탭 사용
packages/vite-plugin-self-extracting/  # ★ 자가해제 압축 후처리 플러그인 (모든 앱 공용)
site/                # Pages 정적 파일 — 랜딩·404·sitemap.xml·og/(OG 이미지)
.github/workflows/deploy.yml  # main 푸시마다 check+build → GitHub Pages 배포
scripts/og-template.html      # OG 이미지(1200×630) 재생성용 템플릿(비배포)
scripts/check-stack-sources.mjs  # ★ 기술 지도가 코드와 어긋났는지 검사 (apps/stack의 check가 실행)
```

새 도구는 `apps/<name>/`로 추가하고 `@local-tools/theme` 재사용. 루트 스크립트 규칙:
`build`·`check`는 재귀(`pnpm -r`), `dev`·`preview`는 `dev:<app>` 식 앱별 스크립트.

## 스택 / 대상

- **크로미엄 전용**(Chrome/Edge 최신). File System Access·DecompressionStream 등 사용, FF/Safari 미검증.
- Vite 8 + `vite-plugin-singlefile` + **Svelte 5(runes)** + TypeScript.
- 라이브러리: `pdf-lib`(병합/회전/이미지임베드), `pdfjs-dist` v6(썸네일·래스터), `fflate`(ZIP), `@neslinesli93/qpdf-wasm`(암호, CDN 지연로드), `gifenc`(GIF 인코딩), `mediabunny`(순수 TS — 동영상 디먹싱·MP4 muxing), 개발자 유틸은 `js-yaml`·`fast-xml-parser`·`diff`·`cronstrue`(ko)·`croner`·`culori`·`uqr` — 전부 순수 JS, wasm 없음.
- apps/dev 주의: `@tsconfig/svelte`가 target을 es2017로 낮춰 최신 API(matchAll 등) 타입 에러가 남 — 앱 tsconfig에 `"target"/"lib": ES2022` 명시로 해결(다른 앱도 동일 증상 시 같은 처리).

## ⚠️ 주의사항 (놓치기 쉬움 — 꼭 읽기)

1. **TypeScript는 5.x로 핀 고정.** pnpm이 최신을 물면 TS 7이 깔리는데 `svelte-check`가 아직 비호환이라 `pnpm check`가 크래시한다. `typescript`를 7로 올리지 말 것.

2. **qpdf 무결성 해시.** `src/lib/pdf/qpdfLoader.ts`는 `@neslinesli93/qpdf-wasm@0.3.0`을 CDN에서 지연 로드하며:
   - 글루 JS: `<script integrity=...>`(SRI)로 브라우저가 강제 검증.
   - `.wasm`: fetch 후 **SHA-384 직접 검증**(불일치 시 실행 거부, fail-closed) → 검증된 바이트로 blob URL 만들어 `locateFile`이 그것만 가리킴(이 빌드는 `wasmBinary` 미지원).
   - **버전을 올리면 두 해시(GLUE_SRI, WASM_SRI)를 반드시 재계산**해야 한다. 안 하면 암호 기능이 통째로 안 됨.
   - **암호 탭만 인터넷이 필요**하다(엔진 최초 1회 다운로드). 나머지 기능은 완전 오프라인.

3. **자가해제형 빌드.** `@local-tools/vite-plugin-self-extracting`(packages/)의 `selfExtractingHtml()`가 빌드 후 인라인 JS/CSS를 deflate-raw+base64로 넣고, 로드 시 `DecompressionStream`으로 푼다(2.1MB→~0.9MB). 스플래시 색·문구는 옵션 인자로 커스텀 가능.
   - 이 후처리는 `vite-plugin-singlefile` 출력 태그 형태(`<style rel="stylesheet" crossorigin>`, `<script type="module" crossorigin>`)에 **정규식으로 의존**한다. Vite/플러그인 업그레이드로 태그가 바뀌면 후처리가 **조용히 건너뛴다(early return)** → 파일이 안 줄어듦.
   - 확인법: 빌드 로그에 `self-extracting-html: dist/index.html → NNN kB`가 찍히는지 볼 것. 안 찍히면 정규식 갱신 필요.

4. **다운로드는 표준 `<a download>` 방식**(`src/lib/pdf/save.ts`). File System Access(`showSaveFilePicker`/`showDirectoryPicker`)로 되돌리지 말 것 — 그건 크롬 "다운로드" 목록에 안 뜨고 저장 위치가 헷갈린다는 사용자 피드백으로 표준 다운로드로 바꾼 것.

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

9. **apps/stack(기술 지도)는 손으로 쓴 설명이라 코드보다 먼저 낡는다.** 그래서 `scripts/check-stack-sources.mjs`가 `pnpm check`에서 세 가지를 강제한다:
   - `src/lib/data/*.ts`가 적은 **모든 저장소 경로가 실재**하는지 → 파일을 옮기면 CI가 깨진다. 경로를 지워서 검사를 피하지 말 것.
   - 지도의 **서드파티 목록(`pkg`)이 각 앱 `package.json`의 dependencies와 정확히 일치**하는지 → 의존성을 새로 넣거나 빼면 지도도 같이 고쳐야 통과한다.
   - **`Tech.net.hosts`에 적은 접속 상대가 그 소스에 실제로 있는지** → 릴레이 목록·STUN·CDN 호스트가 바뀌면 CI가 잡는다. 도시가 성벽 밖에 세우는 중계탑이 이 값에서 나오므로, 여기가 낡으면 그림이 거짓말을 한다.
   - 다른 앱 코드를 고칠 때 엔진·API가 바뀌었다면 `TECHS`/`FEATURES`의 설명도 같이 손볼 것. 경로 검사는 파일 이동만 잡지 내용의 거짓말은 못 잡는다.
   - `src/lib/mech/mechanisms.ts`와 `Tech.net.layers`는 특히 조심할 것: PBKDF2 반복 횟수·청크 크기·워터마크·qpdf 인자 같은 **실측치가 도식에 박혀 있다**. 해당 코드를 고치면 도식도 함께 고쳐야 한다.

   도시가 그리는 것도 전부 데이터에서 유도된다 — 유닛의 **포트 수 = `Feature.techs.length`**, 계기판 눈금 = 소스 줄 수, 지붕 안테나 = `network`가 붙은 기술을 쓰는가, **배관 = 파이프라인이 실제로 거치는 유닛 순서**(`route.ts`), 성문·중계탑 = `network`·`net.hosts`. 손으로 놓는 좌표를 새로 만들지 말 것 — 세어서 맞출 수 없게 되는 순간 지도가 장식이 된다.

10. **apps/stack만 단일 HTML이 아니다.** 도구가 아니라 저장소를 설명하는 메타 페이지라서 오프라인 더블클릭 요구가 없다. three.js(도시)가 들어가 단일 파일로 묶으면 300kB대가 되므로, 이 앱만 `vite-plugin-singlefile`·자가해제를 빼고 일반 번들 + 코드 분할로 간다. 셸·목록(~135kB, gzip 48kB)이 먼저 뜨고 three.js 청크(562kB)는 뒤따라 붙는다 — 도시가 유일한 화면이라 결국 받긴 하지만, WebGL이 없어도 목록으로 다 둘러볼 수 있다.
   - 배포도 다르다: 다른 앱은 `dist/index.html` 한 장만 복사하지만 stack은 `cp -R apps/stack/dist/. _site/stack/`으로 디렉터리째 옮긴다. 랜딩 카드에 다운로드 링크·용량 표기가 없는 것도 같은 이유.
   - `vite.config.ts`에 `stackLoc()` 플러그인이 있다 — 도시 건물 높이의 근거인 **소스 줄 수를 빌드 시점에 세어** 가상 모듈(`virtual:stack-loc`)로 넣는다. 커밋되는 생성 파일이 없으므로 손으로 맞출 것도 없다.

## 핵심 설계 결정 (그릴링 합의 요약)

- 개인 도구, **광고 없음**(iLovePDF류는 기능 참고만).
- 통합 캔버스 + 3탭: 대부분 기능이 "캔버스 위 동작"으로 흡수됨(병합·정리·이미지→PDF·추출).
- 내보낼 때 **파일 이름 지정** 가능(캔버스/암호/이미지 모두). 이미지 여러 장은 **ZIP 한 개**.
- 애널리틱스 없음(프라이버시 우선). 사용량은 호스팅 서버 접속 로그로 갈음.

## 검증 방법 (변경 후)

1. `pnpm check && pnpm build` → 0 errors, 자가해제 로그 확인.
2. `dist/index.html`를 정적 서버(`python3 -m http.server`)로 띄워 브라우저로 확인:
   드롭 → 썸네일 렌더 → 병합/회전/삭제/ZIP/암호 왕복. (`file://`는 확장 자동화가 접근 못 하니 정적 서버 사용.)
