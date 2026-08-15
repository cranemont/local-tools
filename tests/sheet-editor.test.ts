/** 시트 편집기 상태 기계 — 필터가 걸린 표에서 조작이 어디까지 닿는가.
 *
 * `tests/sheet-filter.test.ts`가 `sheet/filter.ts`의 규격(`OP_SCOPE`·`rowsForOp`)을
 * 못 박는다면, 이 파일은 그 규격을 **화면 상태가 실제로 지키는가**를 잰다.
 * 두 파일이 나뉘는 이유는 규격이 맞아도 호출부가 그 규격을 안 지날 수 있어서다 —
 * `fillDown`이 `OP_SCOPE.fillDown`을 안 보고 선택 영역을 통째로 채우던 때가 그랬다.
 *
 * 재는 자리는 CLAUDE.md 29번의 좌표계 둘이다. 행 머리글·커서·선택·복사·수식 참조는
 * 원래 행 번호로 남고, 조작이 닿는 줄은 `OP_SCOPE`가 정한다. 두 좌표계가 섞이면
 * 화면에 없는 칸을 조작하게 된다.
 *
 * ## 부르는 방법
 *
 * `state.svelte.ts`는 `$state`·`$derived`를 쓰는 룬 모듈이라 svelte 플러그인을 거쳐야
 * 값이 된다(`vitest.config.ts`). 테스트 파일 자체에서는 룬을 못 쓴다 — 모듈 싱글턴
 * `editor`의 메서드를 부르고 파생값(`visibleRows`·`cursor`·`notice`)을 읽는 모양이다.
 * 싱글턴이라 테스트마다 `newBook()`으로 문서를 새로 연다.
 *
 * 클립보드는 node에 없다. `navigator`를 통째로 갈아 끼워 붙여넣기 경로를 연다
 * (`stubClipboard`). 앱은 클립보드 실패를 삼키고 내부 버퍼로 물러나므로, 안 갈아
 * 끼우면 붙여넣기가 조용히 아무 일도 안 한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { editor } from "../apps/sheet/src/lib/editor/state.svelte";
import type { ColumnFilter } from "../apps/sheet/src/lib/sheet/filter";

/**
 * 표본 표. A열은 수, B열은 글자다.
 *
 * A열이 수라서 `guessHeaderRows`가 0을 준다 — 머리글 줄이 없으므로 0행부터 걸러진다.
 * 첫 줄을 글자로 두면 그 줄이 머리글로 굳어 필터에서 빠지고, 재려는 경계가 한 줄 밀린다.
 */
const TABLE: [string, string][] = [
  ["1", "사과"],
  ["2", "배"],
  ["3", "감"],
  ["4", "귤"],
  ["5", "포도"],
  ["6", "배추"],
];

function seedTable(rows: [string, string][] = TABLE): void {
  editor.newBook();
  editor.notice = "";
  editor.error = "";
  rows.forEach(([a, b], r) => {
    editor.setCellText(r, 0, a);
    editor.setCellText(r, 1, b);
  });
  editor.select(0, 0);
}

/** 값 목록 필터. 고르는 것은 화면에 보이는 문자열이다. */
function pickValues(col: number, values: string[]): void {
  const filter: ColumnFilter = { kind: "values", picked: new Set(values) };
  editor.setColumnFilter(col, filter);
}

/** 표본 표에서 1·3·5행만 남기는 필터 — 문서 행 번호로는 0·2·4가 남는다. */
function keepOddRows(): void {
  pickValues(0, ["1", "3", "5"]);
}

/** B열 여섯 줄의 표시 문자열. */
function columnB(): string[] {
  return [0, 1, 2, 3, 4, 5].map((r) => editor.displayAt(r, 1));
}

let clipboard = "";

function stubClipboard(text = ""): void {
  clipboard = text;
  vi.stubGlobal("navigator", {
    clipboard: {
      readText: async () => clipboard,
      writeText: async (value: string) => {
        clipboard = value;
      },
    },
  });
}

beforeEach(() => {
  seedTable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("필터가 걸리면 커서는 보이는 줄로 내려온다", () => {
  it("걸러진 줄에 있던 커서가 바로 아래 보이는 줄로 옮겨진다", () => {
    editor.select(1, 1);
    keepOddRows();
    expect(editor.cursor).toEqual({ row: 2, col: 1 });
  });

  it("선택의 반대쪽 끝도 함께 옮겨진다 — 한쪽만 옮기면 선택이 숨은 줄을 문다", () => {
    editor.select(1, 0);
    editor.extendTo(3, 1);
    keepOddRows();
    expect(editor.cursor.row).toBe(2);
    expect(editor.anchor.row).toBe(4);
  });

  it("보이는 줄에 있던 커서는 안 움직인다", () => {
    editor.select(4, 1);
    keepOddRows();
    expect(editor.cursor).toEqual({ row: 4, col: 1 });
  });

  it("필터를 건 뒤 숨은 줄로 커서를 옮겨도 편집은 보이는 줄에서 열린다", () => {
    keepOddRows();
    editor.select(1, 1);
    editor.beginEdit("가");
    // 걸러진 줄에는 편집 상자가 안 그려진다. 그 상태로 확정하면 화면에 없는 칸이 바뀐다.
    expect(editor.editing?.row).toBe(2);
    expect(editor.cursor.row).toBe(2);
  });

  it("세로 이동은 숨은 줄을 세지 않는다", () => {
    keepOddRows();
    editor.select(0, 0);
    editor.move(1, 0);
    expect(editor.cursor.row).toBe(2);
    editor.move(1, 0);
    expect(editor.cursor.row).toBe(4);
    editor.move(-1, 0);
    expect(editor.cursor.row).toBe(2);
  });

  it("필터를 풀어도 커서는 옮겨진 자리에 남는다 — 되돌리는 조작이 아니다", () => {
    editor.select(1, 1);
    keepOddRows();
    editor.setColumnFilter(0, null);
    expect(editor.visibleRows).toBe(null);
    expect(editor.cursor.row).toBe(2);
  });
});

describe("필터가 데이터 줄을 하나도 안 남길 때", () => {
  it("표 아래 빈 줄은 안 걸러지므로 커서가 표 밖으로 내려간다", () => {
    editor.select(1, 0);
    pickValues(0, ["없는 값"]);
    const rows = editor.visibleRows;
    expect(rows?.[0]).toBe(6);
    expect(editor.hiddenRowCount).toBe(6);
    expect(editor.cursor.row).toBe(6);
  });

  it("표가 시트 끝까지 차 있으면 보이는 줄이 하나도 없고, 그때 커서는 안 움직인다", () => {
    // 200행짜리 시트의 마지막 줄에 값을 둬서 아래쪽 빈 줄을 없앤다.
    editor.setCellText(199, 0, "7");
    editor.select(3, 0);
    pickValues(0, ["없는 값"]);
    expect(editor.visibleRows).toEqual([]);
    expect(editor.isRowVisible(0)).toBe(false);
    expect(editor.cursor.row).toBe(3);
  });

  it("보이는 줄이 없으면 채우기는 아무 칸도 안 건드린다", () => {
    editor.setCellText(199, 0, "7");
    pickValues(0, ["없는 값"]);
    editor.select(0, 1);
    editor.extendTo(5, 1);
    editor.fillDown();
    expect(columnB()).toEqual(["사과", "배", "감", "귤", "포도", "배추"]);
  });
});

describe("Delete는 보이는 칸만 지운다", () => {
  it("숨은 줄의 값은 남는다", () => {
    keepOddRows();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    editor.clearSelection();
    expect(columnB()).toEqual(["", "배", "", "귤", "", "배추"]);
  });

  it("필터가 없으면 선택 영역을 통째로 지운다", () => {
    editor.select(0, 1);
    editor.extendTo(4, 1);
    editor.clearSelection();
    expect(columnB()).toEqual(["", "", "", "", "", "배추"]);
  });
});

describe("Ctrl+D 채우기", () => {
  it("원본은 선택 영역의 첫 줄이 아니라 화면에서 보이는 첫 줄이다", () => {
    keepOddRows();
    // 1행(숨음)에서 5행까지 고른다. 보이는 줄은 2·4행뿐이므로 원본은 2행이다.
    editor.select(1, 1);
    editor.extendTo(5, 1);
    editor.fillDown();
    expect(columnB()).toEqual(["사과", "배", "감", "귤", "감", "배추"]);
  });

  it("숨은 줄은 채우기가 지나가지 않는다", () => {
    keepOddRows();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    editor.fillDown();
    expect(columnB()).toEqual(["사과", "배", "사과", "귤", "사과", "배추"]);
  });

  it("수식은 원본과의 실제 행 차이만큼 옮긴다 — 건너뛴 숨은 줄만큼 어긋나면 안 된다", () => {
    editor.setCellText(0, 1, "=A1");
    keepOddRows();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    editor.fillDown();
    // 0행의 =A1이 2행에서는 =A3, 4행에서는 =A5여야 한다.
    expect(editor.displayAt(2, 1)).toBe("3");
    expect(editor.displayAt(4, 1)).toBe("5");
    expect(editor.editTextAt(2, 1)).toBe("=A3");
    expect(editor.editTextAt(4, 1)).toBe("=A5");
    // 숨은 줄은 그대로다.
    expect(editor.displayAt(1, 1)).toBe("배");
    expect(editor.displayAt(3, 1)).toBe("귤");
  });

  it("보이는 줄이 둘도 안 되면 아무것도 안 채운다", () => {
    pickValues(0, ["1"]);
    editor.select(0, 1);
    editor.extendTo(5, 1);
    editor.fillDown();
    expect(columnB()).toEqual(["사과", "배", "감", "귤", "포도", "배추"]);
  });

  it("필터가 없으면 선택 영역의 첫 줄을 아래로 통째로 채운다", () => {
    editor.select(1, 1);
    editor.extendTo(3, 1);
    editor.fillDown();
    expect(columnB()).toEqual(["사과", "배", "배", "배", "포도", "배추"]);
  });
});

describe("붙여넣기는 숨은 줄을 덮고, 덮었다고 알린다", () => {
  it("숨은 줄도 덮는다 — 건너뛰면 붙인 블록의 모양이 원본과 달라진다", async () => {
    keepOddRows();
    stubClipboard("가\n나\n다");
    editor.select(0, 1);
    await editor.paste();
    expect(columnB()).toEqual(["가", "나", "다", "귤", "포도", "배추"]);
  });

  it("덮은 숨은 줄 수를 상태줄에 알린다 — 이 알림이 없으면 조용한 데이터 손실이다", async () => {
    keepOddRows();
    stubClipboard("가\n나\n다");
    editor.select(0, 1);
    await editor.paste();
    expect(editor.notice).toBe("숨은 1행에도 붙여 넣었어요");
  });

  it("숨은 줄을 하나도 안 덮으면 알리지 않는다", async () => {
    keepOddRows();
    stubClipboard("가");
    editor.select(4, 1);
    await editor.paste();
    expect(editor.notice).toBe("");
  });

  it("세는 시점은 붙이기 전이다 — 붙인 뒤엔 그 줄이 걸릴지가 이미 달라져 있다", async () => {
    keepOddRows();
    // 필터가 걸린 A열에 1을 세 줄 붙인다. 붙고 나면 0·1·2행이 전부 보이게 되므로,
    // 붙인 뒤에 세면 0행이 나온다. 덮은 시점의 숨은 줄은 1행 하나다.
    stubClipboard("1\n1\n1");
    editor.select(0, 0);
    await editor.paste();
    expect(editor.visibleRows?.slice(0, 4)).toEqual([0, 1, 2, 4]);
    expect(editor.notice).toBe("숨은 1행에도 붙여 넣었어요");
  });

  it("필터가 없으면 알리지 않는다", async () => {
    stubClipboard("가\n나\n다");
    editor.select(0, 1);
    await editor.paste();
    expect(editor.notice).toBe("");
    expect(columnB()).toEqual(["가", "나", "다", "귤", "포도", "배추"]);
  });
});

describe("복사는 보이는 줄만 내보낸다", () => {
  it("숨은 줄은 클립보드 글자에 안 들어간다", async () => {
    keepOddRows();
    stubClipboard();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    await editor.copy();
    expect(clipboard).toBe("사과\n감\n포도");
  });

  it("우리가 복사한 것을 그대로 붙이면 숨은 줄을 건너뛴 세 줄이 이어 붙는다", async () => {
    keepOddRows();
    stubClipboard();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    await editor.copy();
    editor.select(0, 2);
    await editor.paste();
    expect([0, 1, 2].map((r) => editor.displayAt(r, 2))).toEqual(["사과", "감", "포도"]);
  });

  it("우리가 복사한 것을 붙여도 덮은 숨은 줄 수를 알린다 — 알림은 붙이는 두 길에 다 있어야 한다", async () => {
    // 위 두 갈래(글자 붙이기·우리 것 붙이기)는 코드가 갈라져 있다. 알림은 글자 쪽에만
    // 있어도 이 파일의 다른 단언은 전부 초록이라, 여기서 우리 것 쪽을 따로 밟는다.
    keepOddRows();
    stubClipboard();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    await editor.copy();
    editor.notice = "";

    editor.select(0, 2); // 0·1·2행을 덮는다 — 1행은 필터가 감춘 줄이다
    await editor.paste();
    expect(editor.notice).toBe("숨은 1행에도 붙여 넣었어요");
  });

  it("우리가 복사한 것이라도 숨은 줄을 안 덮으면 알리지 않는다", async () => {
    keepOddRows();
    stubClipboard();
    editor.select(0, 1);
    await editor.copy();
    editor.notice = "";

    editor.select(4, 2); // 한 칸짜리, 보이는 줄에 앉는다
    await editor.paste();
    expect(editor.notice).toBe("");
  });
});

describe("서식과 텍스트로 굳히기도 보이는 칸만 본다", () => {
  it("굵게는 숨은 칸에 안 걸린다", () => {
    keepOddRows();
    editor.select(0, 1);
    editor.extendTo(4, 1);
    editor.toggleFormat("bold");
    expect(editor.cellAt(0, 1)?.s?.bold).toBe(true);
    expect(editor.cellAt(2, 1)?.s?.bold).toBe(true);
    expect(editor.cellAt(1, 1)?.s?.bold).toBeUndefined();
    expect(editor.cellAt(3, 1)?.s?.bold).toBeUndefined();
  });

  it("텍스트로 굳히기는 보이는 칸만 바꾸고 그 수를 알린다", () => {
    keepOddRows();
    editor.select(0, 0);
    editor.extendTo(4, 0);
    editor.forceSelectionText();
    expect(editor.notice).toBe("3칸을 텍스트로 바꿨어요");
    expect(editor.cellAt(0, 0)?.v).toBe("1");
    expect(editor.cellAt(2, 0)?.v).toBe("3");
    // 숨은 줄은 수인 채로 남는다.
    expect(editor.cellAt(1, 0)?.v).toBe(2);
    expect(editor.cellAt(3, 0)?.v).toBe(4);
  });
});

describe("행 삭제는 보이는 줄만 지운다", () => {
  it("걸러진 줄은 남고 그만큼 위로 당겨진다", () => {
    keepOddRows();
    editor.select(0, 0);
    editor.extendTo(4, 0);
    editor.deleteRowsAt();
    expect([0, 1, 2].map((r) => editor.displayAt(r, 1))).toEqual(["배", "귤", "배추"]);
  });
});

describe("되돌리기와 필터", () => {
  it("되돌리기는 셀만 되돌린다 — 지금 걸어 둔 필터가 이긴다", () => {
    keepOddRows();
    editor.setCellText(0, 1, "바꿈");
    editor.undo();
    expect(editor.displayAt(0, 1)).toBe("사과");
    expect(editor.filterCount).toBe(1);
    expect(editor.visibleRows?.slice(0, 3)).toEqual([0, 2, 4]);
  });

  it("스냅샷이 필터를 들고 있어도 지금 풀어 둔 상태가 이긴다", () => {
    keepOddRows();
    editor.setCellText(0, 1, "바꿈");
    editor.clearFilters();
    editor.undo();
    expect(editor.displayAt(0, 1)).toBe("사과");
    expect(editor.filterCount).toBe(0);
    expect(editor.visibleRows).toBe(null);
  });

  it("되돌린 커서가 걸러진 줄이면 보이는 줄로 데려온다", () => {
    editor.select(1, 1);
    editor.setCellText(1, 1, "수정");
    keepOddRows();
    editor.undo();
    expect(editor.displayAt(1, 1)).toBe("배");
    expect(editor.cursor.row).toBe(2);
  });

  it("장 수가 달라지는 되돌리기에서는 스냅샷이 든 필터를 그대로 쓴다", () => {
    // 자리로 옮기면 2장의 필터가 1장에 얹혀 엉뚱한 줄이 사라진다.
    editor.newBook();
    editor.addSheet();
    TABLE.forEach(([a, b], r) => {
      editor.setCellText(r, 0, a);
      editor.setCellText(r, 1, b);
    });
    keepOddRows();
    editor.removeSheet(0);
    expect(editor.sheetNames).toEqual(["Sheet2"]);

    editor.undo();
    expect(editor.sheetNames).toEqual(["Sheet1", "Sheet2"]);
    expect(editor.activeSheet).toBe(1);
    expect(editor.filterCount).toBe(1);

    editor.switchSheet(0);
    expect(editor.filterCount).toBe(0);
    expect(editor.visibleRows).toBe(null);
  });
});

describe("요약과 찾기도 보이는 줄만 센다", () => {
  it("선택 요약의 합계와 줄 수에서 숨은 줄이 빠진다", () => {
    keepOddRows();
    editor.select(0, 0);
    editor.extendTo(5, 0);
    expect(editor.summary.sum).toBe(9); // 1 + 3 + 5
    expect(editor.summary.rows).toBe(3);
  });

  it("찾기 결과에 걸러진 줄은 안 들어간다", () => {
    keepOddRows();
    expect(editor.findMatches("배", false)).toEqual([]);
    expect(editor.findMatches("사과", false)).toEqual([{ row: 0, col: 1 }]);
  });

  it("모두 바꾸기는 찾기가 센 자리만 바꾼다", () => {
    // 같은 글자를 숨을 줄(1행)과 보이는 줄(2행)에 하나씩 둔다.
    editor.setCellText(1, 2, "표시");
    editor.setCellText(2, 2, "표시");
    keepOddRows();
    expect(editor.replaceAll("표시", "바뀜", false)).toBe(1);
    expect(editor.displayAt(2, 2)).toBe("바뀜");
    expect(editor.displayAt(1, 2)).toBe("표시");
  });
});
