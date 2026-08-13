# local-tools

**https://tools.cranemont.com/**

브라우저 안에서만 동작하는 도구 모음. PDF를 합치고, 한글(.hwp) 문서를 열고, 엑셀을 고치고,
사진과 동영상 용량을 줄이고, 폰과 PC 사이로 파일을 보낸다.

**파일은 서버로 올라가지 않는다.** 브라우저가 받은 파일을 그 자리에서 열고 고치고 저장한다.
그래서 용량 제한도, 하루 처리 횟수 제한도, 워터마크도 없다. 광고와 사용량 추적도 없다.

각 도구는 **자기완결 단일 HTML 파일** 한 개로 빌드된다. 내려받아 두면 인터넷이 없는 곳이나
폐쇄망에서 더블클릭만으로 열린다.

## 도구

| | 무엇을 |
|---|---|
| [PDF](https://tools.cranemont.com/pdf/) | 합치기 · 필요한 쪽만 뽑아 나누기 · 순서·회전 · 이미지→PDF · PDF→PNG · 암호 걸기와 풀기 |
| [문서](https://tools.cranemont.com/doc/) | 한글 프로그램 없이 .hwp·.hwpx 열고 편집해 원래 형식으로 저장 · 마크다운 변환 · 워드(.docx)는 보기와 변환까지 |
| [시트](https://tools.cranemont.com/sheet/) | 엑셀(.xlsx)·CSV 열어 편집 · 수식 300여 개 · 서식 유지 · cp949 한글 깨짐 자동 인식 |
| [이미지](https://tools.cranemont.com/image/) | JPG·PNG·WebP·AVIF 변환 · 용량 줄이기 · 크기 조절·자르기 · HEIC 입력 · EXIF 제거 |
| [동영상](https://tools.cranemont.com/video/) | 구간 자르기 · 용량 줄이기(타깃 MB) · 무손실 컷 · MP4·WebM · 소리 추출 |
| [GIF](https://tools.cranemont.com/gif/) | 동영상·사진으로 움짤 만들기 · 프레임 편집 · GIF·WebP·MP4 내보내기 |
| [드롭](https://tools.cranemont.com/drop/) | 폰↔PC 파일 전송 · 코드 6자리나 QR · 서버 없는 P2P · 용량 제한 없음 |
| [개발자 도구](https://tools.cranemont.com/dev/) | JSON·YAML·XML · diff · JWT · 해시 · UUID · 정규식 · cron · 색 · QR 등 16종 |
| [실험장](https://tools.cranemont.com/lab/) | 한국어 임베딩 모델 비교 (도구가 아니라 실험장 — 모델을 실행 시점에 내려받는다) |
| [기술 지도](https://tools.cranemont.com/stack/) | 무엇으로 만들었나 — 저장소를 3D 도시로 그린 메타 페이지 |

내려받으려면 [랜딩](https://tools.cranemont.com/)에서 카드 오른쪽 위의 내려받기 아이콘을 누른다.
도구 하나가 HTML 파일 한 개(47 KB ~ 910 KB)로 저장된다.

## "서버로 안 간다"를 확인하는 법

주장만 하면 소용이 없으니 확인할 수 있게 해 뒀다.

- **직접 보기** — 도구를 열고 DevTools 네트워크 탭을 연 채 파일을 끌어다 놓는다. 요청이 늘지 않는다.
- **[기술 지도](https://tools.cranemont.com/stack/)** — 어떤 기능이 어떤 API 위에 서 있고 무엇이
  네트워크를 타는지 도구별로 그려 둔다. 도시가 성벽 밖에 세우는 중계탑이 실제 접속 상대다.
- **인터넷을 끊고 써 보기** — 단일 HTML을 내려받아 비행기 모드에서 더블클릭하면 그대로 동작한다.

**인터넷이 필요한 예외 넷**을 먼저 밝힌다. PDF의 암호 설정·해제(qpdf), 이미지의 HEIC·AVIF 처리,
문서의 한글 렌더러(rhwp)는 각각 처리 엔진(wasm)을 최초 1회 내려받는다 — 받아온 바이트는
SHA-384로 검증한 뒤에만 실행하고(불일치 시 실행 거부), 파일 자체는 나가지 않는다.
드롭은 두 기기가 서로를 찾는 순간에만 공개 릴레이와 STUN을 거치고, 코드는
[SPAKE2(RFC 9382)](https://www.rfc-editor.org/rfc/rfc9382.html)로 검증해 릴레이가 코드를 알아도
대신 접속할 수 없다. 실험장만은 예외로 모델을 실행할 때 내려받는다.

## 구조

```
apps/pdf  gif  video  image  sheet  doc  drop  dev  lab  stack
packages/
  theme/                        # 공용 디자인 토큰 + UI 프리미티브
  wasm-loader/                  # SRI + SHA-384 fail-closed 로더
  pwa-kit/                      # PNG 인코더·아이콘·서비스 워커 (sheet·doc)
  vite-plugin-self-extracting/  # 자가해제형 빌드 후처리
site/                           # 랜딩·robots·sitemap·OG 이미지
scripts/                        # 지도 정합성·사이트 자산·파비콘·사이트맵 검사와 생성
```

## 개발

```bash
pnpm install
pnpm dev:pdf    # 앱별 개발 서버 (dev:gif, dev:doc, …)
pnpm build      # 전체 빌드 — apps/*/dist/index.html
pnpm check      # 타입 체크 + 사이트 자산·기술 지도 정합성 검사
```

- **pnpm** 모노레포, **Vite** + `vite-plugin-singlefile` + **Svelte 5(runes)** + TypeScript
- 대상: 크로미엄(Chrome·Edge) 최신. File System Access·DecompressionStream·WebCodecs 등을 쓴다
- 산출물은 **자가 해제형** — 인라인 JS/CSS를 deflate로 압축해 두고 로드 시
  `DecompressionStream`으로 푼다. 파일이 절반 이하로 줄어든다
- main에 푸시하면 GitHub Actions가 빌드해 GitHub Pages로 배포한다

## License

MIT — see [LICENSE](LICENSE).

---

## In English

**Browser-only file tools. Nothing is uploaded.**

A collection of utilities that run entirely in the browser: merge and split PDFs, open and edit
Korean HWP documents without the Hangul word processor, edit Excel and CSV files, convert and
shrink images (including iPhone HEIC) and videos, make GIFs, and send files phone-to-PC over
WebRTC with no server in the middle.

Each tool builds to a **single self-contained HTML file** — download it and it works offline by
double-clicking, no install and no network. No ads, no analytics, no accounts, no file size caps,
no watermarks. Korean UI only; Chromium (Chrome/Edge) only.

Four honest exceptions where the network is used: PDF encryption (qpdf), HEIC/AVIF handling, and
the HWP renderer each fetch their wasm engine once — verified by SHA-384 before running, and your
files never leave the browser. The file-transfer tool contacts a public relay and STUN only to let
two devices find each other. The embedding playground downloads models at run time.

MIT licensed.
