import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * onnxruntime-web이 번들 안에 남겨 둔 wasm 자기참조를 끊는다.
 *
 * ort의 웹 번들에는 `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url)`이
 * 들어 있다. Vite는 이 형태를 **정적으로 알아보고 자산으로 끌어온다** — 그 파일이
 * 23.5MB다(jsep는 26MB). 그대로 두면 vite-plugin-singlefile이 그걸 통째로 HTML에
 * 인라인해서 산출물이 63MB가 된다(자가해제 후에도 23MB). 실제로 그렇게 나왔다.
 *
 * 끊어도 되는 이유: transformers.js는 실행 시점에 `ONNX_ENV.wasm.wasmPaths`를
 * jsDelivr CDN으로 직접 지정한다(dist/transformers.web.js에서 확인). 그래서 저
 * `new URL` 갈래는 우리 경로에선 죽은 코드다. 다만 죽은 채로 두지 않고 같은 CDN
 * 주소로 바꿔 놓아, 혹시 그쪽으로 흐르더라도 동작이 같게 만든다.
 *
 * ⚠️ apps/doc의 rhwp-wasm.ts와 같은 부류의 처방이다. 다른 점은 이쪽은 해시를
 *    검증하지 않는다는 것 — 우리가 호스팅하는 자산이 아니라 CDN이 SRI 없이
 *    주는 실행기라서다. 무결성이 필요해지면 자체 호스팅으로 바꿔야 한다.
 */
/**
 * 모듈 경로에서 그 모듈이 속한 onnxruntime-web 패키지의 버전을 읽는다.
 *
 * `require("onnxruntime-web/package.json")`으로는 안 된다 — 이건 우리 의존성이 아니라
 * @huggingface/transformers의 것이라 pnpm의 엄격한 트리에서 apps/lab에선 안 보인다.
 * 대신 실제로 번들되고 있는 파일의 경로를 거슬러 올라가 package.json을 읽는다
 * (pnpm·hoisted 어느 배치든 통한다).
 */
function versionFrom(id: string): string {
  const marker = `${path.sep}onnxruntime-web${path.sep}`;
  const at = id.lastIndexOf(marker);
  if (at < 0) return "";
  const root = id.slice(0, at + marker.length);
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
}

export function ortWasm(): Plugin {
  const pattern = /new URL\("(ort-wasm-[\w.-]+\.wasm)",\s*import\.meta\.url\)/g;
  let replaced = 0;

  return {
    name: "lab-ort-wasm",
    apply: "build",
    enforce: "pre",

    transform(code, id) {
      if (!id.includes("onnxruntime-web")) return null;
      if (!pattern.test(code)) return null;
      pattern.lastIndex = 0;

      const version = versionFrom(id);
      if (!version) {
        this.warn(
          `onnxruntime-web 버전을 읽지 못해 wasm 자기참조를 끊지 못했습니다(${id}) — 산출물이 20MB 넘게 부풉니다.`,
        );
        return null;
      }

      const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
      return {
        code: code.replace(pattern, (_m, file: string) => {
          replaced++;
          return `new URL(${JSON.stringify(base + file)})`;
        }),
        map: null,
      };
    },

    // 조용히 안 먹는 게 이 플러그인의 유일한 실패 방식이라 끝에서 못을 박는다
    closeBundle() {
      if (replaced === 0) {
        this.warn("ort wasm 자기참조를 하나도 바꾸지 못했습니다 — 산출물 크기를 확인하세요.");
      }
    },
  };
}
