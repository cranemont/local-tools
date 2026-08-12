/** rhwp 엔진(wasm) 배달 — 빌드 시점 처리.
 *
 * 이 앱의 한글 문서 렌더러는 `@rhwp/core`의 wasm 8MB(전송 시 brotli 약 2.1MB)다.
 * 단일 HTML 안에 넣을 수 있는 크기가 아니므로 **파일 하나로 따로 내보내고**,
 * 앱은 그것을 받아서 SHA-384로 검증한 뒤 실행한다.
 *
 * 여기서 하는 일은 셋이다.
 *  ① 글루 JS 안의 `new URL('rhwp_bg.wasm', import.meta.url)`를 끊는다.
 *     그대로 두면 Vite가 wasm을 자산으로 물고 들어가 단일 HTML이 10MB가 된다.
 *     우리는 언제나 검증된 바이트를 직접 넘기므로 이 경로는 쓰이지 않는다.
 *  ② PWA 빌드에서만 wasm을 `rhwp-<버전>.wasm`으로 내보낸다. 배포는 이 디렉터리를
 *     `/doc/`에 얹으므로, 단일 HTML도 같은 자리에서 받아 간다.
 *  ③ 파일 이름·해시·원격 주소를 `define` 상수로 굳혀 코드에 박는다 —
 *     **해시를 손으로 다시 계산할 일이 없다**(qpdf 로더와 다른 점).
 *
 * 버전을 올리면 파일 이름이 바뀌므로 옛 캐시와 충돌하지 않는다.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

/** 배포된 자리 — 단일 HTML을 내려받아 `file://`로 열었을 때의 폴백 주소. */
const REMOTE_BASE = "https://cranemont.github.io/local-tools/doc/";

export interface RhwpWasmInfo {
  /** 내보낼 파일 이름 (버전이 박힌다) */
  fileName: string;
  /** `sha384-...` 형식 — @local-tools/wasm-loader가 검증에 쓰는 꼴 그대로 */
  integrity: string;
  bytes: Buffer;
  version: string;
}

export function readRhwpWasm(): RhwpWasmInfo {
  const pkgPath = require.resolve("@rhwp/core/package.json");
  const version = String(JSON.parse(readFileSync(pkgPath, "utf8")).version);
  const bytes = readFileSync(pkgPath.replace(/package\.json$/, "rhwp_bg.wasm"));
  const integrity = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
  return { fileName: `rhwp-${version}.wasm`, integrity, bytes, version };
}

/** 코드에 박아 넣을 상수들 — vite의 `define`에 그대로 넘긴다. */
export function rhwpDefines(info: RhwpWasmInfo): Record<string, string> {
  return {
    __RHWP_WASM_FILE__: JSON.stringify(info.fileName),
    __RHWP_WASM_SHA384__: JSON.stringify(info.integrity),
    __RHWP_WASM_REMOTE__: JSON.stringify(REMOTE_BASE),
    __RHWP_VERSION__: JSON.stringify(info.version),
  };
}

export function rhwpWasm(info: RhwpWasmInfo, { emit }: { emit: boolean }): Plugin {
  return {
    name: "doc-rhwp-wasm",
    enforce: "pre",

    // ① 글루가 wasm을 자기 힘으로 찾으려는 경로를 끊는다.
    transform(code, id) {
      if (!id.includes("@rhwp/core") || !id.endsWith("rhwp.js")) return null;
      const cut = code.replace(
        /new URL\((['"])rhwp_bg\.wasm\1,\s*import\.meta\.url\)/g,
        `(() => { throw new Error("rhwp 엔진은 검증된 바이트를 직접 넘겨야 해요."); })()`,
      );
      return cut === code ? null : { code: cut, map: null };
    },

    // ② PWA 빌드에서만 wasm을 파일로 내보낸다(단일 HTML 쪽에 두면 dist가 두 파일이 된다).
    generateBundle() {
      if (!emit) return;
      this.emitFile({ type: "asset", fileName: info.fileName, source: info.bytes });
    },

    // 개발 서버에서도 같은 자리에서 받아지게 한다. 없으면 배포된 주소로 폴백하는데,
    // 그쪽 버전이 다르면 해시가 어긋나 엔진이 통째로 안 뜬다.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split("?")[0].endsWith(`/${info.fileName}`)) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Cache-Control", "no-cache");
        res.end(info.bytes);
      });
    },
  };
}
