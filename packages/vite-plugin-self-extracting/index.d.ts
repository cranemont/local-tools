import type { Plugin } from "vite";

export interface SelfExtractingHtmlOptions {
  /** 부트 스플래시 스피너 색 (기본: 브랜드 스카이 블루) */
  accentColor?: string;
  /** DecompressionStream 미지원 브라우저 안내 문구 (HTML 허용) */
  unsupportedHtml?: string;
  /** 해제 실패 시 오류 메시지 접두어 */
  loadErrorPrefix?: string;
}

export declare function selfExtractingHtml(
  options?: SelfExtractingHtmlOptions,
): Plugin;
