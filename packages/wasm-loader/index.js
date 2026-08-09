// CDN 지연 로드 엔진(wasm 글루·바이너리)의 fail-closed 무결성 검증 로더.
//  - 클래식 스크립트: <script integrity=...>(SRI)로 브라우저가 해시를 강제 → 불일치 시 로드 차단.
//  - 그 외(wasm·ESM 글루): fetch 후 SHA-384를 직접 검증 → 불일치 시 실행 거부.
//    검증된 바이트로 만든 blob URL만 소비자에게 넘겨, 엔진이 다른 것을 받지 못하게 한다.
// 검증된 고정 버전만 사용할 것 — 버전을 올리면 해시를 반드시 재계산해야 한다.

/**
 * 클래식 스크립트를 SRI로 로드한다. 같은 key로는 한 번만 삽입된다.
 * @param {string} src
 * @param {string} integrity `sha384-...`
 * @param {{ key: string, label: string }} opts
 * @returns {Promise<void>}
 */
export function loadScriptWithSri(src, integrity, { key, label }) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-wasm-loader="${key}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    script.dataset.wasmLoader = key;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          `${label} 로드에 실패했어요. 인터넷 연결 또는 보안 검증에 실패했을 수 있어요.`,
        ),
      );
    document.head.appendChild(script);
  });
}

/**
 * URL을 fetch해 SHA-384를 검증한 바이트를 돌려준다. 불일치 시 던진다(fail-closed).
 * @param {string} url
 * @param {string} sha384 `sha384-...`
 * @param {string} label
 * @returns {Promise<Uint8Array>}
 */
export async function fetchVerified(url, sha384, label) {
  let resp;
  try {
    resp = await fetch(url, { mode: "cors" });
  } catch {
    throw new Error(`${label} 다운로드에 실패했어요. 인터넷 연결을 확인해 주세요.`);
  }
  if (!resp.ok) {
    throw new Error(`${label} 다운로드에 실패했어요 (HTTP ${resp.status}).`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-384", bytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  if (`sha384-${b64}` !== sha384) {
    throw new Error(`보안 검증 실패: ${label} 파일이 예상과 달라 실행을 중단했어요.`);
  }
  return bytes;
}

/** @type {Map<string, Promise<string>>} */
const blobUrls = new Map();

/**
 * fetch+검증한 바이트로 blob URL을 만든다. URL당 한 번만 받아 캐시한다.
 * @param {string} url
 * @param {string} sha384 `sha384-...`
 * @param {{ type: string, label: string }} opts
 * @returns {Promise<string>}
 */
export function verifiedBlobUrl(url, sha384, { type, label }) {
  let cached = blobUrls.get(url);
  if (!cached) {
    cached = fetchVerified(url, sha384, label).then((bytes) =>
      URL.createObjectURL(new Blob([bytes], { type })),
    );
    // 실패한 시도는 캐시에서 지워 재시도할 수 있게 한다.
    cached.catch(() => blobUrls.delete(url));
    blobUrls.set(url, cached);
  }
  return cached;
}
