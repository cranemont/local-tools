/** vite.config.ts의 stackLoc() 플러그인이 빌드 시점에 만들어 넣는다. */
declare module "virtual:stack-loc" {
  /** 저장소 상대 경로 → 줄 수 */
  export const LOC: Record<string, number>;
}
