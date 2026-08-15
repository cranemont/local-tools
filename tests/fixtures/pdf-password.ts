/** 암호가 걸린 PDF 표본 — qpdf wasm으로 만든다.
 *
 * 앱은 이 wasm을 CDN에서 지연 로드하지만(`apps/pdf/src/lib/pdf/qpdfLoader.ts`, SHA-384
 * 검증 포함) 표본은 루트 devDependency `@neslinesli93/qpdf-wasm@0.3.0`을 직접 부른다.
 * 판은 앱이 받는 것과 같다. 앱 코드를 안 거치는 이유는 표본이 검사 대상과 독립이어야
 * 해서다 — `qpdfLoader.ts`가 깨지면 표본도 같이 죽어 무엇이 원인인지 못 가린다.
 *
 * **암호화 결과는 결정적이지 않다.** qpdf가 난수로 키를 만들어 같은 입력에서도 매번
 * 다른 바이트가 나온다. 이 표본으로 바이트를 비교하지 말 것 — 잴 수 있는 것은
 * "그냥은 안 열리는가·암호를 주면 열리는가·푼 뒤 쪽 수가 맞는가"까지다.
 *
 * qpdf `main()`은 인스턴스당 한 번만 돈다. 그래서 호출마다 모듈을 새로 만든다
 * (앱의 `runQpdf`도 같은 이유로 그렇게 한다). 한 번에 300ms 안팎이 드니 테스트
 * 타임아웃을 늘려 잡을 것.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface QpdfModule {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
}

type QpdfFactory = (options: Record<string, unknown>) => Promise<QpdfModule>;

function newModule(): Promise<QpdfModule> {
  const factory = require("@neslinesli93/qpdf-wasm") as QpdfFactory;
  return factory({
    locateFile: () => require.resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm"),
    noInitialRun: true,
    // 이 빌드는 qpdf 오류를 stderr·console.error로 흘린다. 표본을 짓는 동안은 삼킨다.
    print: () => {},
    printErr: () => {},
  });
}

async function runQpdf(
  input: Uint8Array,
  buildArgs: (inPath: string, outPath: string) => string[],
): Promise<Uint8Array> {
  const mod = await newModule();
  mod.FS.writeFile("/in.pdf", input);
  try {
    mod.callMain(buildArgs("/in.pdf", "/out.pdf"));
  } catch {
    // Emscripten ExitStatus. 성공 여부는 출력 파일 유무로 가른다.
  }

  let out: Uint8Array;
  try {
    out = mod.FS.readFile("/out.pdf");
  } catch {
    throw new Error("qpdf가 출력 파일을 안 남겼다");
  }
  if (out.length === 0) throw new Error("qpdf 출력이 비었다");
  return new Uint8Array(out);
}

/** 사용자 암호와 소유자 암호를 같은 값으로 걸어 AES-256으로 암호화한다(앱과 같은 인자). */
export function encryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return runQpdf(bytes, (inPath, outPath) => [
    "--encrypt",
    password,
    password,
    "256",
    "--",
    inPath,
    outPath,
  ]);
}

/** 암호를 푼다. 암호가 틀리면 던진다. */
export function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return runQpdf(bytes, (inPath, outPath) => [
    `--password=${password}`,
    "--decrypt",
    inPath,
    outPath,
  ]);
}
