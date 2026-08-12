/// <reference types="svelte" />
/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드가 박아 넣는 값들 — rhwp-wasm.ts 참고.
// 해시는 빌드가 계산하므로 사람이 손댈 일이 없다.

/** 내보낸 wasm 파일 이름 (`rhwp-0.8.4.wasm` 꼴 — 버전이 박힌다) */
declare const __RHWP_WASM_FILE__: string;
/** 그 파일의 `sha384-...` 무결성 값 */
declare const __RHWP_WASM_SHA384__: string;
/** 단일 HTML을 `file://`로 열었을 때 받아 갈 배포 주소 */
declare const __RHWP_WASM_REMOTE__: string;
/** @rhwp/core 버전 — 화면에 표기한다 */
declare const __RHWP_VERSION__: string;

/**
 * mammoth는 npm 기본 진입점이 노드용(`fs`를 문다)이라 미리 묶인 브라우저 번들을 쓴다.
 * 타입은 패키지가 주는 것을 그대로 빌려 온다.
 */
declare module "mammoth/mammoth.browser.js" {
  const mammoth: typeof import("mammoth");
  export default mammoth;
}
