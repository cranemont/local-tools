/** 클래식 스크립트를 SRI로 로드한다. 같은 key로는 한 번만 삽입된다. */
export function loadScriptWithSri(
  src: string,
  integrity: string,
  opts: { key: string; label: string },
): Promise<void>;

/** URL을 fetch해 SHA-384를 검증한 바이트를 돌려준다. 불일치 시 던진다(fail-closed). */
export function fetchVerified(
  url: string,
  sha384: string,
  label: string,
): Promise<Uint8Array<ArrayBuffer>>;

/** fetch+검증한 바이트로 blob URL을 만든다. URL당 한 번만 받아 캐시한다. */
export function verifiedBlobUrl(
  url: string,
  sha384: string,
  opts: { type: string; label: string },
): Promise<string>;
