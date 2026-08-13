// transformers.js 래퍼 — 모델을 열고, 문장을 벡터로 바꾸고, 걸린 시간을 잰다.
//
// ⚠️ 이 앱만 네트워크를 탄다. 접속하는 곳은 아래 NETWORK_HOSTS 두 곳뿐이고,
//    나가는 것은 모델을 받아 오는 GET 요청뿐이다 — 사용자가 넣은 문장은
//    어디로도 전송되지 않는다(임베딩은 전부 이 탭 안에서 계산된다).

import type { ModelSpec } from "./registry";
import { normalize } from "./vector";

/**
 * 이 앱이 접속하는 곳 전부. 화면 하단에 그대로 띄운다 —
 * "오프라인이 아니다"를 각주로 숨기지 않기 위해서다.
 *
 * ⚠️ apps/stack의 `Tech.net.hosts`가 이 값을 그대로 적고 있고,
 *    scripts/check-stack-sources.mjs가 두 곳이 일치하는지 검사한다.
 */
export const NETWORK_HOSTS = [
  // 모델 가중치(.onnx)와 토크나이저
  "huggingface.co",
  // onnxruntime-web의 .wasm/.mjs — transformers.js가 번들에 넣지 않고 여기서 받는다
  "cdn.jsdelivr.net",
] as const;

export type Device = "webgpu" | "wasm";

export interface FileProgress {
  file: string;
  loaded: number;
  total: number;
}

/** WebGPU를 실제로 쓸 수 있는지 — 어댑터까지 받아 본다(있다고 다 되는 게 아니다). */
export async function detectDevice(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

type Lib = typeof import("@huggingface/transformers");
type Model = Awaited<ReturnType<Lib["AutoModel"]["from_pretrained"]>>;
type Tokenizer = Awaited<ReturnType<Lib["AutoTokenizer"]["from_pretrained"]>>;

let libPromise: Promise<Lib> | null = null;

/** 라이브러리 자체도 지연 로드 — 모델을 안 고르면 받지 않는다. */
function lib(): Promise<Lib> {
  libPromise ??= import("@huggingface/transformers");
  return libPromise;
}

export interface OpenOptions {
  spec: ModelSpec;
  dtype: string;
  device: Device;
  onProgress?: (files: FileProgress[]) => void;
}

export interface EmbedResult {
  vectors: Float32Array[];
  /** 임베딩에만 걸린 시간(ms) — 모델 로드는 뺀다 */
  elapsedMs: number;
}

export class EmbedSession {
  readonly spec: ModelSpec;
  readonly dtype: string;
  readonly device: Device;
  /** 모델을 여는 데 걸린 시간(ms) — 캐시에 있으면 확 줄어든다 */
  readonly loadMs: number;

  #model: Model;
  #tokenizer: Tokenizer;
  #disposed = false;

  private constructor(
    spec: ModelSpec,
    dtype: string,
    device: Device,
    loadMs: number,
    model: Model,
    tokenizer: Tokenizer,
  ) {
    this.spec = spec;
    this.dtype = dtype;
    this.device = device;
    this.loadMs = loadMs;
    this.#model = model;
    this.#tokenizer = tokenizer;
  }

  static async open({ spec, dtype, device, onProgress }: OpenOptions): Promise<EmbedSession> {
    const { AutoModel, AutoTokenizer } = await lib();
    const started = performance.now();

    // 파일별 진행률을 합쳐 보여 준다 — 200MB짜리는 막대 하나로는 감이 안 온다
    const files = new Map<string, FileProgress>();
    const report = (e: unknown) => {
      const ev = e as { status?: string; file?: string; loaded?: number; total?: number };
      if (ev.status !== "progress" || !ev.file) return;
      files.set(ev.file, {
        file: ev.file,
        loaded: ev.loaded ?? 0,
        total: ev.total ?? 0,
      });
      onProgress?.([...files.values()]);
    };

    const [model, tokenizer] = await Promise.all([
      AutoModel.from_pretrained(spec.repo, {
        dtype,
        device,
        progress_callback: report,
      } as Parameters<typeof AutoModel.from_pretrained>[1]),
      AutoTokenizer.from_pretrained(spec.repo, { progress_callback: report }),
    ]);

    return new EmbedSession(spec, dtype, device, performance.now() - started, model, tokenizer);
  }

  /**
   * 문장들을 벡터로. **한 번에 한 문장씩** 돌린다.
   *
   * 배치로 묶으면 패딩이 들어가고, 그러면 풀링이 패딩 토큰을 함께 평균내거나
   * (mean) 마지막 토큰으로 패딩을 집는다(last_token). 마스크를 손으로 다루느니
   * 배치를 포기하는 쪽이 낫다 — 이 앱이 다루는 건 수십~수백 문장이고,
   * 무엇보다 여기서 나오는 숫자가 틀리면 앱 전체가 무의미해진다.
   */
  async embed(
    texts: string[],
    role: "query" | "doc",
    usePrefix: boolean,
    onEach?: (done: number, total: number) => void,
  ): Promise<EmbedResult> {
    const prefix = usePrefix && this.spec.prefix ? this.spec.prefix[role] : "";
    const vectors: Float32Array[] = [];
    const started = performance.now();

    for (let i = 0; i < texts.length; i++) {
      if (this.#disposed) throw new Error("세션이 이미 닫혔습니다.");
      vectors.push(await this.#one(prefix + texts[i]));
      onEach?.(i + 1, texts.length);
      // UI가 진행률을 그릴 틈을 준다 — 전부 await 안에서 도는 동안 프레임이 굶는다
      await new Promise((r) => setTimeout(r, 0));
    }

    return { vectors, elapsedMs: performance.now() - started };
  }

  async #one(text: string): Promise<Float32Array> {
    const inputs = await this.#tokenizer(text, { truncation: true });
    const out = (await this.#model(inputs)) as Record<string, { data: ArrayLike<number>; dims: number[] }>;

    // 그래프가 이미 풀링·정규화까지 한 모델(EmbeddingGemma)은 그대로 받는다.
    const baked = out.sentence_embedding;
    if (baked) return normalize(Float32Array.from(baked.data));

    const hidden = out.last_hidden_state ?? out.token_embeddings;
    if (!hidden) {
      throw new Error(
        `이 모델의 출력에서 문장 벡터를 찾지 못했습니다(받은 것: ${Object.keys(out).join(", ") || "없음"}).`,
      );
    }

    const [, seq, dim] = hidden.dims;
    const data = hidden.data;
    const vec = new Float32Array(dim);

    // 배치 1이라 패딩이 없다 — 마스크 없이 그대로 골라도 맞다.
    if (this.spec.head === "cls") {
      for (let d = 0; d < dim; d++) vec[d] = data[d];
    } else if (this.spec.head === "last_token") {
      const base = (seq - 1) * dim;
      for (let d = 0; d < dim; d++) vec[d] = data[base + d];
    } else {
      for (let s = 0; s < seq; s++) {
        const base = s * dim;
        for (let d = 0; d < dim; d++) vec[d] += data[base + d];
      }
      for (let d = 0; d < dim; d++) vec[d] /= seq;
    }

    return normalize(vec);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const disposable = this.#model as unknown as { dispose?: () => Promise<void> };
    try {
      await disposable.dispose?.();
    } catch {
      // 이미 풀린 세션 — 삼킨다
    }
  }
}
