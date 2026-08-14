/** 원본 위에서 직접 고치기 — rhwp의 편집 API를 **캐럿 하나**로 감싼다.
 *
 * 이 파일이 있는 이유: rhwp는 편집 명령이 자리마다 갈려 있다. 본문은 `insertText`,
 * 표 셀은 `insertTextInCell`, 각주·머리말은 또 다른 이름이고 인자도 다르다. 화면이
 * 그 갈래를 알아야 한다면 키 하나 누를 때마다 분기가 생긴다. 그래서 "지금 캐럿이
 * 어디에 서 있는가"만 Caret 타입에 담고, 갈래는 전부 여기서 흡수한다.
 *
 * 좌표 이야기 하나: rhwp가 주는 `hitTest`·`getCursorRect` 좌표는 **페이지 SVG의
 * 사용자 좌표와 같은 자**다(확인함 — 첫 글자 x=6.8이 SVG `<text x="6.8">`과 일치).
 * 그래서 화면 → 문서는 SVG 표시 배율 하나만 나누면 되고, 문서 → 화면은 곱하면 된다.
 *
 * 여기서는 본문과 표 셀 두 자리만 다룬다. 각주·머리말은 아직 캐럿이 들어가지 않는다.
 */

import type { HwpDocument } from "./engine";
import { guard, messageOf } from "./hwp";
import type { SearchHit } from "./hwp";
import { isEnginePanic } from "./engine";

/** 캐럿이 설 수 있는 자리. 본문 문단이거나, 표 안의 셀 문단이다. */
export type Caret =
  | { kind: "body"; section: number; para: number; offset: number }
  | {
      kind: "cell";
      section: number;
      parentPara: number;
      control: number;
      cell: number;
      cellPara: number;
      offset: number;
    };

/** 캐럿을 그릴 자리 — 페이지 SVG 사용자 좌표다(화면 좌표가 아니다). */
export interface CaretRect {
  page: number;
  x: number;
  y: number;
  height: number;
}

function withOffset(caret: Caret, offset: number): Caret {
  return { ...caret, offset: Math.max(0, offset) };
}

/**
 * 편집 명령이 돌려주는 것 — **고친 뒤 캐럿이 서야 할 자리**다.
 * 직접 계산하지 않고 이 값을 쓴다. 예를 들어 문단을 잇는 `mergeParagraph`는 이어붙인
 * 자리를 알려 주는데, 그건 앞 문단의 길이를 미리 재어 두는 것보다 정확하다(표·서식이
 * 끼면 길이만으로는 어긋난다).
 */
interface EditResult {
  ok?: boolean;
  charOffset?: number;
  paraIdx?: number;
  cellParaIdx?: number;
}

/** 엔진이 준 자리로 캐럿을 옮긴다. 못 알아들으면 부른 쪽이 셈한 자리로 간다. */
function caretFrom(caret: Caret, json: string | null, fallback: Caret): Caret {
  const result = parse<EditResult>(json);
  if (!result || result.ok === false) return fallback;

  const offset = typeof result.charOffset === "number" ? result.charOffset : fallback.offset;
  if (caret.kind === "body") {
    const para = typeof result.paraIdx === "number" ? result.paraIdx : (fallback as { para: number }).para;
    return { ...caret, para, offset };
  }
  const cellPara =
    typeof result.cellParaIdx === "number"
      ? result.cellParaIdx
      : typeof result.paraIdx === "number"
        ? result.paraIdx
        : (fallback as { cellPara: number }).cellPara;
  return { ...caret, cellPara, offset };
}

/** 엔진 호출이 실패해도 편집기가 멈추지는 않게 — 패닉만 위로 올린다. */
function attempt<T>(run: () => T, fallback: T): T {
  try {
    return guard(run);
  } catch (error) {
    if (isEnginePanic(messageOf(error))) throw error;
    return fallback;
  }
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** 이 문단(또는 셀 문단)의 글자 수. 캐럿이 끝을 넘지 않게 하는 데 쓴다. */
export function lengthAt(doc: HwpDocument, caret: Caret): number {
  return attempt(
    () =>
      caret.kind === "body"
        ? doc.getParagraphLength(caret.section, caret.para)
        : doc.getCellParagraphLength(
            caret.section,
            caret.parentPara,
            caret.control,
            caret.cell,
            caret.cellPara,
          ),
    0,
  );
}

/** 페이지 위의 한 점이 문서의 어디인지. 표 안이면 셀 캐럿으로 돌아온다. */
export function caretAt(doc: HwpDocument, page: number, x: number, y: number): Caret | null {
  const hit = parse<Record<string, number>>(attempt(() => doc.hitTest(page, x, y), null));
  if (!hit || typeof hit.sectionIndex !== "number") return null;

  if (typeof hit.controlIndex === "number" && typeof hit.cellIndex === "number") {
    return {
      kind: "cell",
      section: hit.sectionIndex,
      parentPara: hit.parentParaIndex ?? hit.paragraphIndex ?? 0,
      control: hit.controlIndex,
      cell: hit.cellIndex,
      cellPara: hit.cellParaIndex ?? 0,
      offset: hit.charOffset ?? 0,
    };
  }
  return {
    kind: "body",
    section: hit.sectionIndex,
    para: hit.paragraphIndex ?? 0,
    offset: hit.charOffset ?? 0,
  };
}

/**
 * 검색 결과 한 건이 문서의 어느 자리인가 — 찾기가 그 쪽으로 넘어가려면 이게 필요하다.
 * (엔진의 searchAllText는 쪽 번호를 주지 않는다. sec·para·charOffset·cellContext뿐이다.)
 */
export function caretOfHit(hit: SearchHit): Caret {
  if (hit.cell) {
    return {
      kind: "cell",
      section: hit.section,
      parentPara: hit.cell.parentPara,
      control: hit.cell.control,
      cell: hit.cell.cell,
      cellPara: hit.cell.cellPara,
      offset: hit.offset,
    };
  }
  return { kind: "body", section: hit.section, para: hit.paragraph, offset: hit.offset };
}

/** 캐럿을 그릴 자리. 범위를 벗어난 위치에서는 엔진이 실패하므로 null로 돌아온다. */
export function rectOf(doc: HwpDocument, caret: Caret): CaretRect | null {
  const json = attempt(
    () =>
      caret.kind === "body"
        ? doc.getCursorRect(caret.section, caret.para, caret.offset)
        : doc.getCursorRectInCell(
            caret.section,
            caret.parentPara,
            caret.control,
            caret.cell,
            caret.cellPara,
            caret.offset,
          ),
    null,
  );
  const rect = parse<{ pageIndex: number; x: number; y: number; height: number }>(json);
  if (!rect || typeof rect.x !== "number") return null;
  return { page: rect.pageIndex, x: rect.x, y: rect.y, height: rect.height };
}

export function insert(doc: HwpDocument, caret: Caret, text: string): Caret {
  if (!text) return caret;
  const json = attempt(
    () =>
      caret.kind === "body"
        ? doc.insertText(caret.section, caret.para, caret.offset, text)
        : doc.insertTextInCell(
            caret.section,
            caret.parentPara,
            caret.control,
            caret.cell,
            caret.cellPara,
            caret.offset,
            text,
          ),
    null,
  );
  return caretFrom(caret, json, withOffset(caret, caret.offset + text.length));
}

function removeRange(doc: HwpDocument, caret: Caret, offset: number, count: number): string | null {
  return attempt(
    () =>
      caret.kind === "body"
        ? doc.deleteText(caret.section, caret.para, offset, count)
        : doc.deleteTextInCell(
            caret.section,
            caret.parentPara,
            caret.control,
            caret.cell,
            caret.cellPara,
            offset,
            count,
          ),
    null,
  );
}

/**
 * 문단 잇기. **`mergeParagraph(sec, i)`는 i번 문단을 i-1번 뒤에 붙인다** — 이름만 보면
 * 어느 쪽으로 붙는지 알 수 없어 실제로 재 보고 확정했다(반환값이 이어붙인 자리를 준다).
 */
function mergeInto(doc: HwpDocument, caret: Caret, index: number): string | null {
  return attempt(
    () =>
      caret.kind === "body"
        ? doc.mergeParagraph(caret.section, index)
        : doc.mergeParagraphInCell(
            caret.section,
            caret.parentPara,
            caret.control,
            caret.cell,
            index,
          ),
    null,
  );
}

const paraIndexOf = (caret: Caret): number => (caret.kind === "body" ? caret.para : caret.cellPara);

/** 백스페이스. 문단 첫머리에서는 앞 문단과 잇는다(셀 안에서도 같다). */
export function backspace(doc: HwpDocument, caret: Caret): Caret {
  if (caret.offset > 0) {
    const json = removeRange(doc, caret, caret.offset - 1, 1);
    return caretFrom(caret, json, withOffset(caret, caret.offset - 1));
  }

  const index = paraIndexOf(caret);
  if (index === 0) return caret; // 첫 문단의 첫머리 — 더 지울 것이 없다

  const previous =
    caret.kind === "body"
      ? { ...caret, para: index - 1, offset: 0 }
      : { ...caret, cellPara: index - 1, offset: 0 };
  const fallback = { ...previous, offset: lengthAt(doc, previous) };
  return caretFrom(caret, mergeInto(doc, caret, index), fallback);
}

/** Delete — 문단 끝에서는 **다음** 문단을 끌어올린다(그래서 인덱스가 하나 뒤다). */
export function deleteForward(doc: HwpDocument, caret: Caret): Caret {
  const length = lengthAt(doc, caret);
  if (caret.offset < length) {
    const json = removeRange(doc, caret, caret.offset, 1);
    return caretFrom(caret, json, caret);
  }
  return caretFrom(caret, mergeInto(doc, caret, paraIndexOf(caret) + 1), caret);
}

/** Enter — 문단을 캐럿 자리에서 가른다. */
export function splitParagraph(doc: HwpDocument, caret: Caret): Caret {
  const json = attempt(
    () =>
      caret.kind === "body"
        ? doc.splitParagraph(caret.section, caret.para, caret.offset)
        : doc.splitParagraphInCell(
            caret.section,
            caret.parentPara,
            caret.control,
            caret.cell,
            caret.cellPara,
            caret.offset,
          ),
    null,
  );
  const fallback =
    caret.kind === "body"
      ? { ...caret, para: caret.para + 1, offset: 0 }
      : { ...caret, cellPara: caret.cellPara + 1, offset: 0 };
  return caretFrom(caret, json, fallback);
}

/** ←/→ 한 글자. 문단 경계를 넘으면 이웃 문단의 끝·처음으로 간다. */
export function step(doc: HwpDocument, caret: Caret, delta: number): Caret {
  const next = caret.offset + delta;
  if (next >= 0 && next <= lengthAt(doc, caret)) return withOffset(caret, next);

  if (caret.kind === "body") {
    const para = caret.para + (delta < 0 ? -1 : 1);
    if (para < 0 || para >= attempt(() => doc.getParagraphCount(caret.section), 0)) return caret;
    const moved: Caret = { ...caret, para, offset: 0 };
    return delta < 0 ? { ...moved, offset: lengthAt(doc, moved) } : moved;
  }

  const cellPara = caret.cellPara + (delta < 0 ? -1 : 1);
  if (cellPara < 0) return caret;
  const moved: Caret = { ...caret, cellPara, offset: 0 };
  const length = lengthAt(doc, moved);
  if (length === 0 && delta > 0) return caret; // 더 갈 곳이 없다
  return delta < 0 ? { ...moved, offset: length } : moved;
}

/**
 * 되돌리기 — 엔진의 스냅샷을 쌓는다.
 *
 * 스냅샷은 싸다(0.1ms, 100개 9ms). 그래도 타자마다 한 칸씩 쌓으면 "한 글자씩 되돌아가는"
 * 답답한 되돌리기가 되므로, **같은 종류의 편집이 이어지는 동안은 한 묶음**으로 본다
 * (엑셀·한글의 감각). 묶음을 끊는 것은 시간(1초)과 편집 종류가 바뀌는 순간이다.
 */
export class History {
  private undoIds: number[] = [];
  private redoIds: number[] = [];
  private lastKind = "";
  private lastAt = 0;

  private static readonly LIMIT = 60;
  private static readonly COALESCE_MS = 1000;

  /** 편집을 하기 **직전에** 부른다. */
  mark(doc: HwpDocument, kind: string, now: number): void {
    const sameRun = kind === this.lastKind && now - this.lastAt < History.COALESCE_MS;
    this.lastKind = kind;
    this.lastAt = now;
    if (sameRun && this.undoIds.length > 0) return;

    this.undoIds.push(attempt(() => doc.saveSnapshot(), -1));
    if (this.undoIds.length > History.LIMIT) this.undoIds.shift();
    this.redoIds = [];
  }

  get canUndo(): boolean {
    return this.undoIds.length > 0;
  }
  get canRedo(): boolean {
    return this.redoIds.length > 0;
  }

  undo(doc: HwpDocument): boolean {
    const id = this.undoIds.pop();
    if (id === undefined || id < 0) return false;
    this.redoIds.push(attempt(() => doc.saveSnapshot(), -1));
    attempt(() => doc.restoreSnapshot(id), null);
    this.breakRun();
    return true;
  }

  redo(doc: HwpDocument): boolean {
    const id = this.redoIds.pop();
    if (id === undefined || id < 0) return false;
    this.undoIds.push(attempt(() => doc.saveSnapshot(), -1));
    attempt(() => doc.restoreSnapshot(id), null);
    this.breakRun();
    return true;
  }

  /** 다음 편집은 새 묶음으로 — 캐럿을 옮겼거나 되돌린 뒤에 부른다. */
  breakRun(): void {
    this.lastKind = "";
    this.lastAt = 0;
  }

  reset(): void {
    this.undoIds = [];
    this.redoIds = [];
    this.breakRun();
  }
}

/** 고친 문서를 원래 형식으로 — .hwp는 .hwp로, .hwpx는 .hwpx로 나간다. */
export function exportAs(doc: HwpDocument, format: "hwp" | "hwpx"): Uint8Array {
  return guard(() => (format === "hwp" ? doc.exportHwp() : doc.exportHwpx()));
}
