// qpdf-wasm 를 CDN에서 "지연 로드"하되, 검증된 고정 버전만 무결성 확인 후 실행한다.
// 검증 로직은 @local-tools/wasm-loader 공용 패키지(SRI + SHA-384, fail-closed)를 쓴다.
//  - 이 탭은 그래서 인터넷 연결이 필요하다(핵심 병합/변환 기능은 오프라인 동작).
//  - ⚠️ 버전을 올리면 두 해시(GLUE_SRI, WASM_SRI)를 반드시 재계산할 것.
import { fetchVerified, loadScriptWithSri } from "@local-tools/wasm-loader";

const VERSION = "0.3.0";
const CDN = `https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@${VERSION}/dist`;

const GLUE_URL = `${CDN}/qpdf.js`;
const GLUE_SRI =
  "sha384-viHHfnvZlwDzjAQCrTUX3UR1zDr3OW9ItyLOqwH2wTHYHXWK8NdKi5LFp++BT8NL";

const WASM_URL = `${CDN}/qpdf.wasm`;
const WASM_SRI =
  "sha384-9ESKDLiqwqZ9ln5RdWhoE5TM/zLYG2UoW/AMa0KeND/fhDO5ZJsRH6FTJ3Dera+p";

interface QpdfFS {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile: (path: string) => Uint8Array;
}
interface QpdfModule {
  FS: QpdfFS;
  callMain: (args: string[]) => number;
}
interface QpdfConfig {
  locateFile: () => string;
  noInitialRun: boolean;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}
type QpdfFactory = (config: QpdfConfig) => Promise<QpdfModule>;

let ready: Promise<{ factory: QpdfFactory; wasmUrl: string }> | null = null;

/** 엔진(글루+wasm)을 준비. 이미 준비됐으면 즉시 반환. 실패는 던진다. */
export function ensureQpdfReady(): Promise<unknown> {
  if (!ready) ready = load();
  return ready;
}

const ENGINE_LABEL = "qpdf 엔진";

async function load(): Promise<{ factory: QpdfFactory; wasmUrl: string }> {
  await loadScriptWithSri(GLUE_URL, GLUE_SRI, { key: "qpdf", label: ENGINE_LABEL });

  const factory = (globalThis as unknown as { Module?: QpdfFactory }).Module;
  if (typeof factory !== "function") {
    throw new Error("qpdf 로더 초기화에 실패했어요.");
  }

  const bytes = await fetchVerified(WASM_URL, WASM_SRI, ENGINE_LABEL);
  const wasmUrl = URL.createObjectURL(
    new Blob([bytes], { type: "application/wasm" }),
  );
  return { factory, wasmUrl };
}

export type QpdfArgs = (inPath: string, outPath: string) => string[];

/** 입력 PDF에 qpdf를 실행하고 출력 PDF 바이트를 돌려준다. */
export async function runQpdf(
  input: Uint8Array,
  buildArgs: QpdfArgs,
  fallbackMsg = "PDF 처리에 실패했어요.",
): Promise<Uint8Array> {
  const { factory, wasmUrl } = (await ensureQpdfReady()) as {
    factory: QpdfFactory;
    wasmUrl: string;
  };

  const stderr: string[] = [];
  // qpdf main()은 인스턴스당 한 번만 실행되므로 작업마다 새 인스턴스를 만든다.
  const mod = await factory({
    locateFile: () => wasmUrl,
    noInitialRun: true,
    print: () => {},
    printErr: (m: string) => stderr.push(m),
  });

  mod.FS.writeFile("/in.pdf", input);

  // 이 빌드는 qpdf 오류(예: "invalid password")를 printErr가 아니라 console.error로
  // 내보내므로, 실행 동안 임시로 가로채 사용자 메시지 분류에 쓴다.
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    stderr.push(args.map((a) => String(a)).join(" "));
  };
  try {
    mod.callMain(buildArgs("/in.pdf", "/out.pdf"));
  } catch {
    // Emscripten ExitStatus — 아래에서 출력 유무로 성공/실패 판정.
  } finally {
    console.error = origConsoleError;
  }

  let out: Uint8Array;
  try {
    out = mod.FS.readFile("/out.pdf");
  } catch {
    throw classifyError(stderr, fallbackMsg);
  }
  if (!out || out.length === 0) throw classifyError(stderr, fallbackMsg);

  // 모듈 HEAP에서 복사(인스턴스 GC 후에도 안전).
  return new Uint8Array(out);
}

/** 비밀번호 때문에 실패했음을 부르는 쪽이 알아보게 하는 표시(다시 물을지 정한다). */
export const PASSWORD_ERROR_NAME = "QpdfPasswordError";

/** 이 실패가 "비밀번호가 틀렸다"인가. */
export function isPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === PASSWORD_ERROR_NAME;
}

function classifyError(stderr: string[], fallbackMsg: string): Error {
  const msg = stderr.join("\n");
  if (/password/i.test(msg)) {
    const err = new Error("비밀번호가 올바르지 않거나 필요해요.");
    err.name = PASSWORD_ERROR_NAME;
    return err;
  }
  return new Error(fallbackMsg);
}

/** AES-256으로 암호 설정(사용자·소유자 비밀번호 동일). */
export const encryptArgs =
  (password: string): QpdfArgs =>
  (inPath, outPath) =>
    ["--encrypt", password, password, "256", "--", inPath, outPath];

/** 알고 있는 비밀번호로 암호 해제. */
export const decryptArgs =
  (password: string): QpdfArgs =>
  (inPath, outPath) =>
    [`--password=${password}`, inPath, "--decrypt", outPath];

/**
 * 구조를 다시 써서 용량을 줄인다. 글자·글꼴·주석·책갈피는 손대지 않는다.
 *
 * 인자는 이 빌드(qpdf 12.2.0)에 `--help=transformation`으로 물어 고른 것이고,
 * 아래 수치는 node에서 이 wasm을 그대로 돌려 잰 값이다.
 *   - `--object-streams=generate --compression-level=9 --recompress-flate`
 *     4.19MB 논문 PDF → 3.20MB(76.4%), 2.27MB 그림 PDF → 2.26MB(99.4%).
 *   - `jpegQuality`를 주면 `--optimize-images --jpeg-quality=N`이 붙는다. 그림이
 *     Flate로 들어 있으면 여기서 크게 줄어든다 — 같은 2.27MB 문서가 q=75에서
 *     231kB(10.1%), q=40에서 150kB(6.6%). 글자 레이어는 그대로 남는다(확인함).
 *     qpdf는 다시 압축해서 작아질 때만 바꾼다.
 * `--linearize`는 뺐다 — 같은 문서에서 83.5%로 오히려 커진다.
 *
 * 품질을 25 아래로 내리면 libjpeg가 "quantization tables are too coarse" 경고를
 * 콘솔에 찍는다. 화면에서 고를 수 있는 값은 40 위로 잡았다.
 */
export const recompressArgs =
  (jpegQuality: number | null): QpdfArgs =>
  (inPath, outPath) => {
    const args = [
      inPath,
      "--object-streams=generate",
      "--compression-level=9",
      "--recompress-flate",
    ];
    if (jpegQuality !== null) {
      args.push("--optimize-images", `--jpeg-quality=${jpegQuality}`);
    }
    args.push(outPath);
    return args;
  };
