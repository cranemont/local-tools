// qpdf-wasm 를 CDN에서 "지연 로드"하되, 검증된 고정 버전만 무결성 확인 후 실행한다.
//  - 글루 JS: <script integrity=...>(SRI)로 브라우저가 해시를 강제 → 불일치 시 로드 차단(fail-closed).
//  - .wasm: fetch 후 SHA-384를 직접 검증 → 불일치 시 실행 거부. 검증된 바이트로 만든
//           blob URL만 locateFile이 가리키게 하여, 엔진이 다른 것을 받지 못하게 한다.
//  - 이 탭은 그래서 인터넷 연결이 필요하다(핵심 병합/변환 기능은 오프라인 동작).

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

async function load(): Promise<{ factory: QpdfFactory; wasmUrl: string }> {
  await loadScriptWithSRI(GLUE_URL, GLUE_SRI);

  const factory = (globalThis as unknown as { Module?: QpdfFactory }).Module;
  if (typeof factory !== "function") {
    throw new Error("qpdf 로더 초기화에 실패했어요.");
  }

  let resp: Response;
  try {
    resp = await fetch(WASM_URL, { mode: "cors" });
  } catch {
    throw new Error(
      "qpdf 엔진을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.",
    );
  }
  if (!resp.ok) {
    throw new Error(
      `qpdf 엔진을 내려받지 못했어요 (HTTP ${resp.status}).`,
    );
  }

  const bytes = new Uint8Array(await resp.arrayBuffer());
  await verifySha384(bytes, WASM_SRI);

  const wasmUrl = URL.createObjectURL(
    new Blob([bytes], { type: "application/wasm" }),
  );
  return { factory, wasmUrl };
}

function loadScriptWithSRI(src: string, integrity: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-qpdf="1"]',
    );
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    script.dataset.qpdf = "1";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          "qpdf 엔진을 불러오지 못했어요. 인터넷 연결 또는 보안 검증에 실패했을 수 있어요.",
        ),
      );
    document.head.appendChild(script);
  });
}

async function verifySha384(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-384", bytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const actual = `sha384-${b64}`;
  if (actual !== expected) {
    throw new Error(
      "보안 검증 실패: qpdf 엔진 파일이 예상과 달라 실행을 중단했어요.",
    );
  }
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

function classifyError(stderr: string[], fallbackMsg: string): Error {
  const msg = stderr.join("\n");
  if (/password/i.test(msg)) {
    return new Error("비밀번호가 올바르지 않거나 필요해요.");
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
