// 저장소 링크 — 지도의 모든 주장은 소스로 되돌아갈 수 있어야 한다.
const REPO = "https://github.com/cranemont/local-tools";

export const repoBlob = (path: string): string => `${REPO}/blob/main/${path}`;
export const repoHome = REPO;
