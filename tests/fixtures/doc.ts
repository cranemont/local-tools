/** 한글·워드 문서 표본 — hwp·hwpx는 `@rhwp/core`가, docx는 fflate가 짓는다.
 *
 * 공통 규약(바이너리를 커밋하지 않는다, import 경로가 두 갈래다, 같은 입력이면 같은 바이트)은
 * `./pdf.ts` 머리말이 정본이다. 여기서는 이 파일에만 있는 것을 적는다.
 *
 * ## 이 표본이 재지 못하는 것
 *
 * **rhwp가 쓰고 rhwp가 읽는다.** 그래서 형식 상호운용성은 이 표본으로 못 잰다 — 한컴이
 * 만든 hwp의 글꼴 표·스타일·개체가 어떻게 생겼는지 여기에는 없고, 회귀를 얼마나 놓치는지도
 * 재지 못했다. 검사 대상은 `apps/doc`의 `hwp.ts`·`batch.ts`·`state.svelte.ts`이고, 그 코드에게
 * 이 바이트는 **독립된 입력**이다(문단 걷기·컨트롤 걷기·매직바이트 판별은 누가 썼든 같다).
 *
 * ## wasm을 여기서 켠다
 *
 * `apps/doc`은 wasm을 네트워크로 받고 SHA-384로 검증하지만(`doc/engine.ts`), 표본은 그 길을
 * 타지 않는다 — `node_modules`의 `.wasm`을 직접 읽어 `init`에 넣는다. 앱의 `engine.ts`와
 * **같은 `@rhwp/core` 모듈 인스턴스**를 켜는 것이라(pnpm이 한 자리로 풀어 준다) 이 파일을
 * import한 테스트에서는 `openHwp`가 곧바로 문서를 연다. 대신 테스트가 `ensureEngine`을
 * 갈아 끼워 네트워크 경로를 막아야 한다.
 *
 * wasm은 글자 폭을 브라우저에 물어 온다(`measureTextWidth`). node에는 캔버스가 없으므로
 * 글자 수로 어림한 값을 준다 — 쪽 나눔이 실제 한글과 다를 수 있다는 뜻이라, **쪽 수에
 * 기대는 단언을 이 표본으로 쓰지 말 것**.
 */

import { readFileSync } from "node:fs";

import init, { HwpDocument } from "@rhwp/core/rhwp.js";

import { buildHwp, type HwpSpec } from "./hwp-build";

// docx 표본은 wasm이 필요 없어 따로 산다. 부르는 자리를 안 바꾸려고 여기서 다시 내보낸다.
export { docFile, makeDocx } from "./docx";

export type { HwpSpec };

/** 이 층의 짓는 절차 — 클래스만 끼워 준다. */
const build = (spec: HwpSpec): HwpDocument => buildHwp(HwpDocument, spec);

// 바이트를 직접 읽는 자리라 별칭이 안 통한다(`import`가 아니라 `new URL`이다).
const WASM = new URL(
  "../../apps/doc/node_modules/@rhwp/core/rhwp_bg.wasm",
  import.meta.url,
);

// wasm은 줄바꿈을 계산할 때 글자 폭을 밖에 묻는다. init 전에 등록해야 첫 렌더가 어긋나지
// 않는다(engine.ts의 registerTextMeasure와 같은 자리). 값은 결정적이어야 하므로 상수배다.
(globalThis as unknown as { measureTextWidth?: unknown }).measureTextWidth = (
  _font: string,
  text: string,
): number => text.length * 10;

await init({ module_or_path: readFileSync(WASM) });

/** 명세대로 지은 .hwp 바이트(HWP 5.0, CFB). */
export function makeHwp(spec: HwpSpec = { paragraphs: ["첫 문단입니다"] }): Uint8Array {
  const doc = build(spec);
  try {
    return doc.exportHwp();
  } finally {
    doc.free();
  }
}

/** 같은 명세의 .hwpx 바이트(ZIP). */
export function makeHwpx(spec: HwpSpec = { paragraphs: ["첫 문단입니다"] }): Uint8Array {
  const doc = build(spec);
  try {
    return doc.exportHwpx();
  } finally {
    doc.free();
  }
}

/**
 * 비밀번호가 걸린 .hwp. **바이트는 결정적이지 않다**(암호화가 난수를 쓴다) —
 * 이 표본으로 바이트를 비교하지 말 것.
 */
export function makeEncryptedHwp(
  password: string,
  spec: HwpSpec = { paragraphs: ["잠긴 문서"] },
): Uint8Array {
  const doc = build(spec);
  try {
    return doc.exportHwpWithPassword(password);
  } finally {
    doc.free();
  }
}

/**
 * 뒤를 잘라 낸 바이트 — CFB 헤더는 남고 내용이 사라져 rhwp가 열지 못한다.
 * 매직바이트는 그대로라 `detect`는 여전히 hwp로 읽는다(그래서 '실패'로 가는 갈래다).
 */
export function truncateHwp(bytes: Uint8Array, keep = 0.6): Uint8Array {
  return bytes.slice(0, Math.max(1, Math.floor(bytes.length * keep)));
}

/**
 * rhwp를 패닉시킨다(CLAUDE.md 17번). 흉내가 아니라 진짜 패닉이라,
 * 던져지는 것은 wasm이 내는 `RuntimeError: unreachable`이다.
 *
 * 제목·문단·표가 섞인 HTML을 `pasteHtml`에 넣으면 `rendering.rs:3495`에서
 * `insertion index (is 3) should be <= len (is 1)`로 패닉한다. 이 말을 `isEnginePanic`이
 * 알아보는지가 곧 그 규격이 맞는지다.
 *
 * **패닉을 맞은 문서 손잡이는 되살릴 수 없다** — 그 뒤 어떤 호출도 "recursive use of an
 * object"로 실패하고 `free()`조차 "while it was borrowed"로 실패한다. 여기서는 손잡이를
 * 버리므로 wasm 모듈 자체는 다음 문서를 계속 열지만, 앱은 이 자리에서 상태를 `broken`으로
 * 굳히고 새로고침을 권한다(살릴 길이 없다는 판단은 앱 쪽 규약이다). 이 함수를 `guard`에
 * 통과시키는 테스트는 그 순간부터 엔진 상태를 되돌릴 수 없으므로 **파일 뒤쪽**에 둘 것.
 */
export function panicRhwp(): void {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  doc.pasteHtml(0, 0, 0, "<h1>제목</h1><p>문단</p><table><tr><td>가</td></tr></table><p>끝</p>");
  doc.free();
  throw new Error("rhwp가 패닉하지 않았다 — 표본이 낡았다(CLAUDE.md 17번을 다시 볼 것)");
}

