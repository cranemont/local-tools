// AVIF 인코딩 — @jsquash/avif의 엠스크립튼 글루(자기완결 ESM)와 wasm을
// CDN에서 지연 로드하되 둘 다 SHA-384 검증(fail-closed) 후에만 실행한다.
// 래퍼(encode.js)는 동적 임포트 경로가 검증을 우회하므로 쓰지 않고 직접 조립한다.
// 이 경로만 인터넷이 필요하다(엔진 최초 1회). ⚠️ 버전을 올리면 두 해시를 반드시 재계산할 것.
import { fetchVerified, verifiedBlobUrl } from "@local-tools/wasm-loader";
import { t } from "../i18n";

const VERSION = "2.1.1";
const CDN = `https://cdn.jsdelivr.net/npm/@jsquash/avif@${VERSION}/codec/enc`;

const GLUE_URL = `${CDN}/avif_enc.js`;
const GLUE_SRI =
  "sha384-CSCv5W4tWhwNEV016b7Cf+Z7a+XAf4Z8tY/79BEKL+PJSO96cZrxu+ryYFU+den3";

const WASM_URL = `${CDN}/avif_enc.wasm`;
const WASM_SRI =
  "sha384-05Hrg6MAEOyGEl+DBp138l7mH4bs/srHNfuLKY1bXS0R9WI/amgsW509B8FkaZWr";

/** @jsquash/avif meta.js의 기본 인코딩 옵션 — quality만 슬라이더로 덮어쓴다. */
const DEFAULT_OPTIONS = {
  quality: 50,
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  speed: 6,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
  bitDepth: 8,
  lossless: false,
};

interface AvifEncModule {
  encode(
    data: Uint8Array,
    width: number,
    height: number,
    options: typeof DEFAULT_OPTIONS,
  ): { buffer: ArrayBuffer } | null;
}
type AvifEncFactory = (config: {
  noInitialRun: boolean;
  /** blob URL이 base가 되면 new URL()이 던지므로 이 분기를 우회하는 더미 —
   *  instantiateWasm이 있어 실제로는 참조되지 않는다. */
  locateFile: (path: string) => string;
  instantiateWasm: (
    imports: WebAssembly.Imports,
    callback: (instance: WebAssembly.Instance) => void,
  ) => WebAssembly.Exports;
}) => Promise<AvifEncModule>;

let ready: Promise<AvifEncModule> | null = null;

function ensureEncoder(): Promise<AvifEncModule> {
  if (!ready) {
    ready = load();
    ready.catch(() => (ready = null)); // 실패 시 재시도 가능하게
  }
  return ready;
}

async function load(): Promise<AvifEncModule> {
  const label = t.engines.avif;
  const glueUrl = await verifiedBlobUrl(GLUE_URL, GLUE_SRI, {
    type: "text/javascript",
    label,
  });
  const glue = (await import(/* @vite-ignore */ glueUrl)) as {
    default?: AvifEncFactory;
  };
  const factory = glue.default;
  if (typeof factory !== "function") throw new Error(t.errors.engineInit(label));

  const wasmBytes = await fetchVerified(WASM_URL, WASM_SRI, label);
  const wasmModule = await WebAssembly.compile(
    wasmBytes.buffer as ArrayBuffer,
  );

  return factory({
    noInitialRun: true,
    locateFile: (path) => path,
    instantiateWasm: (imports, callback) => {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      callback(instance);
      return instance.exports;
    },
  });
}

/** RGBA ImageData를 AVIF로 인코딩한다. quality 1–100. */
export async function encodeAvif(data: ImageData, quality: number): Promise<Blob> {
  const mod = await ensureEncoder();
  const out = mod.encode(new Uint8Array(data.data.buffer), data.width, data.height, {
    ...DEFAULT_OPTIONS,
    quality,
  });
  if (!out) throw new Error(t.errors.encodeFail);
  return new Blob([out.buffer], { type: "image/avif" });
}
