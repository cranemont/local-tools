/** 한글 문서(.hwp·.hwpx)를 여는 얇은 래퍼.
 *
 * rhwp의 API 표면은 편집기까지 포함해 아주 넓지만(메서드 700개 남짓), 이 도구가 쓰는 것은
 * **읽기 쪽 몇 개**뿐이다. 여기서 그 몇 개만 추려 우리 말로 감싸고, 바깥(에디터·변환기)이
 * rhwp를 직접 만지지 않게 한다 — 0.x라 시그니처가 바뀔 수 있으므로 갈아탈 자리를
 * 이 파일 하나로 묶어 두는 것이다.
 *
 * wasm 쪽 오류는 Error가 아니라 문자열로 튀어나오기도 해서, 전부 여기서 사람 말로 옮긴다.
 */

import { HwpDocument, ensureEngine, isEnginePanic, markEngineBroken } from "./engine";

/** 암호가 필요해서 못 연 경우 — 화면이 비밀번호를 물어보는 신호로 쓴다. */
export class PasswordRequiredError extends Error {
  constructor(readonly wrongPassword: boolean) {
    super(
      wrongPassword
        ? "비밀번호가 맞지 않아요."
        : "비밀번호가 걸린 문서예요. 비밀번호를 입력해 주세요.",
    );
    this.name = "PasswordRequiredError";
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * 엔진 호출을 감싼다. 패닉은 다른 실패와 성질이 다르다 — 그 뒤로는 무엇을 불러도 안 되므로
 * 조용히 삼키면 화면이 "빈 문서"처럼 보이게 된다. 만나는 즉시 상태를 굳히고 위로 던진다.
 */
export function guard<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    const message = messageOf(error);
    if (isEnginePanic(message)) throw markEngineBroken(message);
    throw error;
  }
}

function isPasswordProblem(message: string): boolean {
  return /비밀번호|암호|password|encrypt/i.test(message);
}

/** 파일 바이트로 문서를 연다. 비밀번호가 필요하면 PasswordRequiredError를 던진다. */
export async function openHwp(bytes: Uint8Array, password?: string): Promise<HwpDocument> {
  await ensureEngine();
  try {
    return password
      ? HwpDocument.openWithPassword(bytes, password)
      : new HwpDocument(bytes);
  } catch (error) {
    const message = messageOf(error);
    if (isPasswordProblem(message)) {
      throw new PasswordRequiredError(Boolean(password));
    }
    if (isEnginePanic(message)) throw markEngineBroken(message);
    throw new Error(`문서를 여는 데 실패했어요. ${message}`);
  }
}

export interface DocumentSummary {
  pages: number;
  title: string | null;
}

export function summarize(doc: HwpDocument): DocumentSummary {
  let title: string | null = null;
  try {
    const info = JSON.parse(doc.getDocumentInfo()) as { title?: unknown };
    if (typeof info.title === "string" && info.title.trim()) title = info.title.trim();
  } catch {
    // 문서 정보가 없거나 모양이 다르면 제목 없이 간다 — 표시용일 뿐이다.
  }
  return { pages: guard(() => doc.pageCount()), title };
}

/** 페이지 한 장을 SVG 문자열로. 그림은 data URI로 박혀 오므로 자기완결이다. */
export function renderPage(doc: HwpDocument, index: number): string {
  return guard(() => doc.renderPageSvg(index));
}

/** 클립보드용 HTML 껍데기를 벗긴다 — 조각마다 <html><body>가 붙어 나온다. */
function unwrapFragment(html: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return (body ? body[1] : html)
    .replace(/<!--\s*(Start|End)Fragment\s*-->/g, "")
    .trim();
}

/**
 * 문단 하나에 앵커된 컨트롤(표·그림·수식)들의 HTML.
 *
 * 표가 문단 **텍스트**가 아니라 컨트롤이라는 게 핵심이다 — 선택 영역만 내보내면
 * 표는 통째로 사라진다(실제로 표만 든 문서는 빈 마크다운이 나왔다).
 * 컨트롤 개수는 `getControlTextPositions`가 돌려주는 배열의 길이로 안다.
 */
function controlsOf(doc: HwpDocument, section: number, paragraph: number): string[] {
  let count = 0;
  try {
    const positions: unknown = JSON.parse(
      guard(() => doc.getControlTextPositions(section, paragraph)),
    );
    count = Array.isArray(positions) ? positions.length : 0;
  } catch (error) {
    if (isEnginePanic(messageOf(error))) throw error;
    return [];
  }

  const parts: string[] = [];
  for (let index = 0; index < count; index++) {
    try {
      const html = unwrapFragment(
        guard(() => doc.exportControlHtml(section, paragraph, "[]", index)),
      );
      // 구역·단 정의처럼 내용이 없는 컨트롤은 "내용 생략됨" 주석만 남기고 온다.
      if (!html || html.startsWith("<!--")) continue;
      parts.push(html);
    } catch (error) {
      // 이 컨트롤 하나를 못 옮겨도 문서 전체를 버리지는 않는다. 패닉만은 예외다.
      if (isEnginePanic(messageOf(error))) throw error;
    }
  }
  return parts;
}

/**
 * 문서 전체를 HTML로 — 마크다운으로 가는 중간 산물이다.
 *
 * rhwp에는 "문서 전체를 HTML로"가 없다. 있는 것은 **선택 영역**과 **컨트롤** 두 가지라,
 * 문단을 따라 걸으며 둘을 번갈아 모은다. 문단 텍스트 → 그 문단에 달린 표·그림 순서다.
 */
export function documentHtml(doc: HwpDocument): string {
  const parts: string[] = [];
  const sections = doc.getSectionCount();

  for (let section = 0; section < sections; section++) {
    const paragraphs = doc.getParagraphCount(section);

    for (let paragraph = 0; paragraph < paragraphs; paragraph++) {
      const length = doc.getParagraphLength(section, paragraph);
      if (length > 0) {
        try {
          const html = unwrapFragment(
            guard(() => doc.exportSelectionHtml(section, paragraph, 0, paragraph, length)),
          );
          if (html) parts.push(html);
        } catch (error) {
          // 문단 하나가 실패해도 나머지는 보여 준다 — 전부 잃는 것보다 낫다. 패닉만은 예외다.
          if (isEnginePanic(messageOf(error))) throw error;
        }
      }
      parts.push(...controlsOf(doc, section, paragraph));
    }
  }

  return parts.join("\n");
}

/** 개방 포맷(.hwpx) 바이트. 바이너리 .hwp를 표준 쪽으로 옮길 때 쓴다. */
export function toHwpx(doc: HwpDocument): Uint8Array {
  return guard(() => doc.exportHwpx());
}

export interface SearchHit {
  section: number;
  paragraph: number;
  offset: number;
  page: number | null;
  /**
   * 표 안에서 찾은 것이면 그 셀 자리. 엔진이 `cellContext`로 함께 준다.
   * 캐럿을 만들 때 이게 있어야 쪽을 제대로 짚는다(표가 많은 공문서에서 대부분이 여기 걸린다).
   */
  cell?: { parentPara: number; control: number; cell: number; cellPara: number };
}

/**
 * 문서 전체에서 찾는다. 왼쪽은 SVG라 브라우저 Ctrl+F가 안 먹으므로 이게 그 자리를 메운다.
 * 반환 JSON의 모양이 버전마다 흔들릴 수 있어 느슨하게 읽는다.
 */
export function searchAll(doc: HwpDocument, query: string, caseSensitive: boolean): SearchHit[] {
  if (!query.trim()) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(guard(() => doc.searchAllText(query, caseSensitive, true)));
  } catch (error) {
    if (isEnginePanic(messageOf(error))) throw error;
    return [];
  }

  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { matches?: unknown }).matches)
      ? (raw as { matches: unknown[] }).matches
      : [];

  const hits: SearchHit[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const num = (...keys: string[]): number | null => {
      for (const key of keys) {
        const value = row[key];
        if (typeof value === "number") return value;
      }
      return null;
    };
    // 0.8.4 기준 엔진은 쪽 번호를 주지 않는다(sec·para·charOffset·cellContext뿐).
    // 그래서 page는 대개 null이고, 이동할 때 caretOfHit + rectOf로 그 자리에서 알아낸다.
    const ctx = row.cellContext as Record<string, unknown> | undefined;
    const ctxNum = (...keys: string[]): number | null => {
      if (!ctx) return null;
      for (const key of keys) {
        const value = ctx[key];
        if (typeof value === "number") return value;
      }
      return null;
    };
    const control = ctxNum("ctrlIdx", "controlIndex");
    const cell = ctxNum("cellIdx", "cellIndex");

    hits.push({
      section: num("sectionIdx", "section", "sec") ?? 0,
      paragraph: num("paraIdx", "paragraph", "para") ?? 0,
      offset: num("charOffset", "offset", "char") ?? 0,
      page: num("pageIndex", "page"),
      ...(control !== null && cell !== null
        ? {
            cell: {
              parentPara: ctxNum("parentPara", "parentParaIdx") ?? 0,
              control,
              cell,
              cellPara: ctxNum("cellPara", "cellParaIdx") ?? 0,
            },
          }
        : {}),
    });
  }
  return hits;
}

/**
 * HTML을 한글이 여는 .hwpx로. 워드 문서를 한글로 옮기는 경로가 여기 하나다.
 *
 * **rhwp가 아니라 hwp-convert(순수 TS)를 쓴다.** 원래는 rhwp의 `createEmpty()` +
 * `pasteHtml()` + `exportHwpx()`로 라이브러리 하나 안에서 닫으려 했는데, 실제로 넣어 보니
 * 제목·문단·표가 섞인 평범한 문서에서 엔진이 패닉했다:
 *
 *   panicked at src/document_core/queries/rendering.rs:3495:36:
 *   insertion index (is 3) should be <= len (is 1)
 *
 * 표만·문단만은 통과하지만 섞이면 죽고, 한 번 패닉하면 wasm 모듈 전체가 못 쓰게 된다.
 * hwp-convert는 같은 입력을 그대로 처리하고, 그 산출물을 rhwp가 정상으로 읽어 그린다
 * (두 엔진 교차 검증). 무게(gzip 152KB)는 지연 로드로 미룬다 — hwp만 보는 사람은 안 받는다.
 */
export async function htmlToHwpx(html: string, title: string): Promise<Uint8Array> {
  try {
    const { htmlToHwpx: convert } = await import("hwp-convert");
    return await convert(html, { title });
  } catch (error) {
    throw new Error(`.hwpx로 바꾸지 못했어요. ${messageOf(error)}`);
  }
}

/** 다 쓴 문서를 놓아준다 — wasm 메모리는 GC가 걷어 가지 않는다. */
export function closeHwp(doc: HwpDocument | null): void {
  if (!doc) return;
  try {
    doc.free();
  } catch {
    // 이미 놓아준 경우.
  }
}
