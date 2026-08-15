/**
 * 암호가 걸린 PDF 표본 — 브라우저 층용.
 *
 * `tests/fixtures/pdf-password.ts`와 같은 일을 하지만 그 파일은 `node:module`을 쓰므로
 * 브라우저에서 안 돈다. 여기서는 같은 패키지(`@neslinesli93/qpdf-wasm@0.3.0`, 루트
 * devDependency)를 Vite로 들여온다. 판은 앱이 CDN에서 받는 것과 같다.
 *
 * 앱 코드(`qpdfLoader.ts`)를 안 거치는 이유는 2층 표본과 같다 — 표본이 검사 대상과
 * 독립이어야 무엇이 깨졌는지 가릴 수 있다. 여기서는 이유가 하나 더 있다: 앱 쪽은 CDN에서
 * 받으므로 인터넷이 필요하고, 이 층은 배포를 막는 자리라 남의 인프라에 기대면 안 된다.
 *
 * **암호화 결과는 결정적이지 않다**(qpdf가 난수로 키를 만든다). 바이트를 비교하지 말 것.
 */
import wasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import qpdfFactory from "@neslinesli93/qpdf-wasm";

interface QpdfModule {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
}

type QpdfFactory = (options: Record<string, unknown>) => Promise<QpdfModule>;

// qpdf main()은 인스턴스당 한 번만 돈다 — 호출마다 새로 만든다(앱의 runQpdf도 그렇다).
async function runQpdf(
  input: Uint8Array,
  args: (inPath: string, outPath: string) => string[],
): Promise<Uint8Array> {
  // 이 빌드는 진단을 console.error로 흘린다. 표본을 짓는 동안은 삼킨다.
  const orig = console.error;
  console.error = () => {};
  let mod: QpdfModule;
  try {
    mod = await (qpdfFactory as unknown as QpdfFactory)({
      locateFile: () => wasmUrl,
      noInitialRun: true,
    });
  } finally {
    console.error = orig;
  }

  mod.FS.writeFile("/in.pdf", input);
  try {
    mod.callMain(args("/in.pdf", "/out.pdf"));
  } catch {
    // Emscripten ExitStatus. 성공 여부는 출력 파일 유무로 가른다.
  }

  const out = mod.FS.readFile("/out.pdf");
  if (!out || out.length === 0) throw new Error("qpdf 출력이 비었다");
  return new Uint8Array(out);
}

/** AES-256으로 암호를 건다(사용자·소유자 비밀번호 동일). */
export function encryptPdf(
  bytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
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
