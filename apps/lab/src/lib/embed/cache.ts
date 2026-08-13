// 받아 둔 모델을 들여다보고 지운다.
//
// 실험장이라 이게 선택이 아니다 — 모델을 갈아 끼우는 게 이 앱의 용도이고,
// 한 벌이 200MB~2GB다. 목록과 삭제 버튼이 없으면 몇 번 놀다가 디스크가 찬다.

/** transformers.js가 쓰는 Cache API 이름 (라이브러리 소스의 `cacheKey`). */
const CACHE_NAME = "transformers-cache";

export interface CachedModel {
  /** HF 저장소 이름 — `onnx-community/embeddinggemma-300m-ONNX` */
  repo: string;
  bytes: number;
  files: number;
}

export interface StorageReport {
  models: CachedModel[];
  /** 런타임(onnxruntime-web의 wasm 등) — 모델과 나눠 센다 */
  runtimeBytes: number;
  /** 오리진 전체 사용량 — 브라우저가 알려 주는 값 */
  usage: number | null;
  quota: number | null;
}

/** `https://huggingface.co/<owner>/<name>/resolve/...` 에서 `<owner>/<name>`을 뽑는다. */
function repoOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "huggingface.co") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const at = parts.indexOf("resolve");
    if (at < 2) return null;
    return parts.slice(0, at).join("/");
  } catch {
    return null;
  }
}

/**
 * 캐시된 응답의 바이트 수.
 *
 * content-length를 먼저 본다 — 200MB짜리 blob을 실제로 읽으면 목록을 그리는 데만
 * 몇백 MB를 쓴다. 헤더가 없을 때만 blob으로 떨어진다.
 */
async function sizeOf(res: Response): Promise<number> {
  const len = res.headers.get("content-length");
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n)) return n;
  }
  try {
    return (await res.clone().blob()).size;
  } catch {
    return 0;
  }
}

export async function readStorage(): Promise<StorageReport> {
  const empty: StorageReport = { models: [], runtimeBytes: 0, usage: null, quota: null };
  if (!("caches" in globalThis)) return empty;

  let estimate: StorageEstimate = {};
  try {
    estimate = (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    // 권한이 없으면 그냥 모른다고 둔다
  }

  let cache: Cache;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    return { ...empty, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  }

  const byRepo = new Map<string, CachedModel>();
  let runtimeBytes = 0;

  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res) continue;
    const bytes = await sizeOf(res);
    const repo = repoOf(req.url);
    if (!repo) {
      runtimeBytes += bytes;
      continue;
    }
    const entry = byRepo.get(repo) ?? { repo, bytes: 0, files: 0 };
    entry.bytes += bytes;
    entry.files += 1;
    byRepo.set(repo, entry);
  }

  return {
    models: [...byRepo.values()].sort((a, b) => b.bytes - a.bytes),
    runtimeBytes,
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
  };
}

/** 한 모델의 캐시 항목만 지운다 — 런타임 wasm은 남겨 둔다(다음 모델도 쓴다). */
export async function deleteCachedModel(repo: string): Promise<void> {
  if (!("caches" in globalThis)) return;
  const cache = await caches.open(CACHE_NAME);
  for (const req of await cache.keys()) {
    if (repoOf(req.url) === repo) await cache.delete(req);
  }
}

export async function deleteAll(): Promise<void> {
  if (!("caches" in globalThis)) return;
  await caches.delete(CACHE_NAME);
}

export function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
