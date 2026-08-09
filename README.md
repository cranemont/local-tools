# local-tools

브라우저 안에서만 동작하는 개인 도구 모음. 각 도구는 **자기완결 단일 HTML 파일**로 빌드되어, 더블클릭으로도(오프라인) 호스팅 URL로도 쓸 수 있다. 파일은 브라우저 안에서만 처리되고 네트워크로 나가지 않는다.

## 구조 (경량 모노레포)

```
apps/         # 도구들 (첫 입주자: pdf)
  pdf/        # PDF — 병합·정리·변환·암호
packages/
  theme/      # 공용 디자인 토큰 (라이트/다크)
  vite-plugin-self-extracting/  # 자가해제형 빌드 후처리 플러그인
```

새 도구는 `apps/<name>/`로 추가하고 `@local-tools/theme`를 재사용한다.

## 개발

```bash
pnpm install
pnpm dev:pdf    # apps/pdf 개발 서버
pnpm build      # 전체 앱 빌드 — 자기완결 단일 .html 산출 (apps/*/dist/)
pnpm check      # 전체 타입 체크
```

- 패키지 매니저: **pnpm**
- 스택: Vite + `vite-plugin-singlefile` + Svelte + TypeScript
- 대상 브라우저: 크로미엄(Chrome/Edge) 최신
- 빌드 산출물은 **자가 해제형(self-extracting)** — 인라인 JS/CSS를 deflate로 압축해 두고
  로드 시 `DecompressionStream`으로 풀어 실행한다. 파일 크기를 절반 이하로 줄인다.
