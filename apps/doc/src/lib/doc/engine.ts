/** 한글 문서 엔진(@rhwp/core, Rust→wasm)을 받아서 켠다.
 *
 * 이 앱에서 유일하게 네트워크를 타는 곳이다. wasm이 8MB(전송 시 2.1MB)라 단일 HTML에
 * 넣을 수 없어서, 빌드가 `rhwp-<버전>.wasm`으로 따로 내보내고 여기서 받아 온다.
 *
 *  - **자체 호스팅**이다. 서드파티 CDN을 타지 않으므로 방문 사실이 남의 서버에 남지 않는다.
 *  - 받은 바이트는 SHA-384로 검증하고, 어긋나면 실행하지 않는다(fail-closed).
 *    해시는 빌드가 계산해 박으므로(`__RHWP_WASM_SHA384__`) 버전을 올려도 손댈 게 없다.
 *  - 주소는 같은 자리(상대경로)를 먼저 본다. 단일 HTML을 내려받아 `file://`로 열었으면
 *    상대경로가 없으므로 배포 주소로 폴백한다.
 *  - 설치형(PWA)에서는 서비스 워커가 받아 온 wasm을 캐시에 남겨, 그 다음부터는
 *    인터넷 없이 열린다. `file://`은 오리진이 불투명해 캐시 저장소를 못 쓰므로
 *    브라우저 디스크 캐시에 기댄다.
 *
 * docx만 보는 사람은 이 파일이 하는 일과 무관하다 — 엔진 없이 전부 동작한다.
 */

import init, { HwpDocument } from "@rhwp/core";
import { fetchVerifiedFrom } from "@local-tools/wasm-loader";

const LABEL = "한글 문서 엔진";

/**
 * `broken`은 "받지 못했다"(failed)와 다르다 — 엔진 안에서 Rust 패닉이 나면 wasm 인스턴스가
 * 통째로 못 쓰게 되고(이후 모든 호출이 `unreachable`), 다시 받아도 살아나지 않는다.
 * 되살리는 방법은 새로고침뿐이라 상태를 따로 둔다.
 */
export type EngineStatus = "idle" | "loading" | "ready" | "failed" | "broken";

let status: EngineStatus = "idle";
let ready: Promise<void> | null = null;
let lastError: Error | null = null;

const watchers = new Set<(status: EngineStatus, error: Error | null) => void>();

/** 엔진 상태가 바뀔 때마다 부른다. 해제 함수를 돌려준다. */
export function watchEngine(fn: (status: EngineStatus, error: Error | null) => void): () => void {
  watchers.add(fn);
  fn(status, lastError);
  return () => watchers.delete(fn);
}

function setStatus(next: EngineStatus, error: Error | null = null): void {
  status = next;
  lastError = error;
  for (const fn of watchers) fn(status, lastError);
}

export function engineStatus(): EngineStatus {
  return status;
}

export const ENGINE_VERSION = __RHWP_VERSION__;

/**
 * wasm 안에서 줄바꿈·정렬을 계산할 때 글자 폭을 물어 온다. wasm은 브라우저 폰트에
 * 접근할 수 없으므로 Canvas의 measureText를 콜백으로 내어 준다.
 * **init 전에 등록해야 한다** — 늦으면 첫 렌더의 줄바꿈이 어긋난다.
 */
function registerTextMeasure(): void {
  const global = globalThis as unknown as {
    measureTextWidth?: (font: string, text: string) => number;
  };
  if (global.measureTextWidth) return;

  let ctx: CanvasRenderingContext2D | null = null;
  let lastFont = "";
  global.measureTextWidth = (font, text) => {
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 0;
    if (font !== lastFont) {
      ctx.font = font;
      lastFont = font;
    }
    return ctx.measureText(text).width;
  };
}

/** 같은 자리 → 배포 주소 순서. 해시가 어긋나면 폴백 없이 멈춘다(로더 쪽 규칙). */
function wasmUrls(): string[] {
  const urls: string[] = [];
  if (location.protocol !== "file:") {
    urls.push(new URL(__RHWP_WASM_FILE__, location.href).href);
  }
  const remote = __RHWP_WASM_REMOTE__ + __RHWP_WASM_FILE__;
  if (!urls.includes(remote)) urls.push(remote);
  return urls;
}

async function load(): Promise<void> {
  setStatus("loading");
  try {
    registerTextMeasure();
    const bytes = await fetchVerifiedFrom(wasmUrls(), __RHWP_WASM_SHA384__, LABEL);
    await init({ module_or_path: bytes });
    setStatus("ready");
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    setStatus("failed", wrapped);
    // 다음 시도에서 다시 받을 수 있도록 약속을 버린다.
    ready = null;
    throw wrapped;
  }
}

/** 엔진을 준비한다(이미 준비됐으면 즉시 반환). 실패는 던진다. */
export function ensureEngine(): Promise<void> {
  ready ??= load();
  return ready;
}

/**
 * 앱이 뜨자마자 배경에서 미리 받아 둔다 — .hwp를 놓는 순간 기다리지 않게.
 * 데이터 절약 모드에서는 2.1MB를 몰래 받지 않고, 실제로 hwp를 열 때 받는다.
 */
export function prefetchEngine(): void {
  if (ready) return;

  const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;

  const start = (): void => {
    void ensureEngine().catch(() => {
      // 배경 시도의 실패는 조용히 넘긴다 — 실제로 열 때 다시 시도하고, 그때 알린다.
    });
  };

  const idle = (globalThis as unknown as { requestIdleCallback?: typeof setTimeout })
    .requestIdleCallback;
  if (idle) idle(start);
  else setTimeout(start, 1200);
}

/** 실패한 뒤 사용자가 다시 누를 때. 패닉으로 죽은 엔진은 새로고침 말고 살릴 길이 없다. */
export function retryEngine(): Promise<void> {
  if (status === "broken") return Promise.reject(lastError ?? new Error("엔진이 멈췄어요."));
  ready = null;
  return ensureEngine();
}

/**
 * 엔진이 패닉했을 때 나오는 말들. wasm 인스턴스가 깨진 뒤에는 어떤 호출이든
 * 이 중 하나로 실패하므로, 여기서 한 번에 알아본다.
 */
const PANIC = /unreachable|recursive use of an object|while it was borrowed|null pointer passed to rust/i;

export function isEnginePanic(message: string): boolean {
  return PANIC.test(message);
}

/** 패닉을 확인했다 — 이 뒤로는 어떤 호출도 소용없으니 상태를 굳혀 둔다. */
export function markEngineBroken(message: string): Error {
  const error = new Error(
    "문서 엔진이 멈췄어요. 이 문서에서 엔진이 감당하지 못하는 부분을 만난 것 같아요 — 새로고침하면 다시 열 수 있어요.",
  );
  if (status !== "broken") setStatus("broken", error);
  // 원인은 콘솔에 남긴다(엔진 쪽 버그 신고에 쓸 수 있게).
  console.error("[doc] 엔진 패닉:", message);
  return error;
}

export { HwpDocument };
