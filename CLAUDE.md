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
packages/theme/tokens.css  # 공용 디자인 토큰(라이트/다크)
packages/vite-plugin-self-extracting/  # ★ 자가해제 압축 후처리 플러그인 (모든 앱 공용)
```

새 도구는 `apps/<name>/`로 추가하고 `@local-tools/theme` 재사용. 루트 스크립트 규칙:
`build`·`check`는 재귀(`pnpm -r`), `dev`·`preview`는 `dev:<app>` 식 앱별 스크립트.

## 스택 / 대상

- **크로미엄 전용**(Chrome/Edge 최신). File System Access·DecompressionStream 등 사용, FF/Safari 미검증.
- Vite 8 + `vite-plugin-singlefile` + **Svelte 5(runes)** + TypeScript.
- 라이브러리: `pdf-lib`(병합/회전/이미지임베드), `pdfjs-dist` v6(썸네일·래스터), `fflate`(ZIP), `@neslinesli93/qpdf-wasm`(암호, CDN 지연로드).

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

## 핵심 설계 결정 (그릴링 합의 요약)

- 개인 도구, **광고 없음**(iLovePDF류는 기능 참고만).
- 통합 캔버스 + 3탭: 대부분 기능이 "캔버스 위 동작"으로 흡수됨(병합·정리·이미지→PDF·추출).
- 내보낼 때 **파일 이름 지정** 가능(캔버스/암호/이미지 모두). 이미지 여러 장은 **ZIP 한 개**.
- 애널리틱스 없음(프라이버시 우선). 사용량은 호스팅 서버 접속 로그로 갈음.

## 검증 방법 (변경 후)

1. `pnpm check && pnpm build` → 0 errors, 자가해제 로그 확인.
2. `dist/index.html`를 정적 서버(`python3 -m http.server`)로 띄워 브라우저로 확인:
   드롭 → 썸네일 렌더 → 병합/회전/삭제/ZIP/암호 왕복. (`file://`는 확장 자동화가 접근 못 하니 정적 서버 사용.)
