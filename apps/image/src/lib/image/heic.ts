// HEIC/HEIF 디코딩 — libheif wasm을 CDN에서 지연 로드(fail-closed 검증).
// 이 경로만 인터넷이 필요하다(엔진 최초 1회). 나머지 기능은 완전 오프라인.
// ⚠️ 버전을 올리면 두 해시(GLUE_SRI, WASM_SRI)를 반드시 재계산할 것.
import { fetchVerified, loadScriptWithSri } from "@local-tools/wasm-loader";
import { t } from "../i18n";

const VERSION = "1.19.8";
const CDN = `https://cdn.jsdelivr.net/npm/libheif-js@${VERSION}/libheif-wasm`;

const GLUE_URL = `${CDN}/libheif.js`;
const GLUE_SRI =
  "sha384-4aewVAT9+1ZrswinEAr3J9FURRUOTzNChbMxwoKnNfRLOM0xnyAMS39olsIggmAa";

const WASM_URL = `${CDN}/libheif.wasm`;
const WASM_SRI =
  "sha384-xmS8+K8b2fmPa6h+3ZzriEH9UpypqzBcJxeQPsI0rOyWmiYDEXUnt6QqspvyNfvC";

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: ImageData, done: (result: ImageData | null) => void): void;
  free(): void;
}
interface LibheifModule {
  HeifDecoder: new () => { decode: (bytes: Uint8Array) => HeifImage[] };
}
// 이 빌드는 locateFile 경로가 동기 XHR이라 실패한다 — 검증된 바이트를 wasmBinary로 직접 주입.
type LibheifFactory = (config: {
  wasmBinary: ArrayBuffer;
}) => Promise<LibheifModule>;

export function isHeicMime(mime: string): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

let ready: Promise<LibheifModule> | null = null;

function ensureLibheif(): Promise<LibheifModule> {
  if (!ready) {
    ready = load();
    ready.catch(() => (ready = null)); // 실패 시 재시도 가능하게
  }
  return ready;
}

async function load(): Promise<LibheifModule> {
  const label = t.engines.heic;
  await loadScriptWithSri(GLUE_URL, GLUE_SRI, { key: "libheif", label });

  const factory = (globalThis as unknown as { libheif?: LibheifFactory }).libheif;
  if (typeof factory !== "function") throw new Error(t.errors.engineInit(label));

  const bytes = await fetchVerified(WASM_URL, WASM_SRI, label);
  return factory({ wasmBinary: bytes.buffer as ArrayBuffer });
}

/** HEIC 바이트를 디코딩해 ImageBitmap으로 돌려준다(첫 이미지만). */
export async function decodeHeic(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<ImageBitmap> {
  const lib = await ensureLibheif();
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(bytes);
  if (!images.length) throw new Error(t.errors.engineInit(t.engines.heic));
  try {
    const image = images[0];
    const w = image.get_width();
    const h = image.get_height();
    const target = new ImageData(w, h);
    const filled = await new Promise<ImageData | null>((resolve) =>
      image.display(target, resolve),
    );
    if (!filled) throw new Error(t.errors.engineInit(t.engines.heic));
    return await createImageBitmap(filled);
  } finally {
    for (const image of images) image.free();
  }
}
