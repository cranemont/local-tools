import { describe, expect, it } from "vitest";

import {
  haltRest,
  isRunning,
  nextPending,
  outputsOf,
  planBatch,
  progressOf,
  safeSegment,
  setStatus,
  zipEntries,
} from "../apps/doc/src/lib/doc/batch";
import type { BatchItem, ZipEntry } from "../apps/doc/src/lib/doc/batch";

// ─────────────────────────────────────────────────────────────────────────────
// apps/doc의 일괄 변환 명세.
//
// 두 가지를 못 박는다.
//  ① ZIP 안의 자리 — 문서마다 폴더 하나. 마크다운이 가리키는 그림 경로는 문서마다
//    똑같이 `images/1.png`라, 폴더로 가르지 않으면 뒤 문서가 앞 문서의 그림을 덮는다.
//  ② 큐의 상태 — 특히 rhwp가 패닉한 뒤 **손대지 못한 문서를 '실패'로 세지 않는 것**
//    (CLAUDE.md 17번). 시도조차 못 한 것을 실패로 세면 화면이 거짓말을 한다.
//
// 기대값은 구현을 베끼지 않고 손으로 적은 것이다.
// ─────────────────────────────────────────────────────────────────────────────

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

/** 큐를 만든 뒤 상태를 한꺼번에 찍어 준다 — 상태 기계 테스트의 준비물. */
function queue(names: string[], statuses: Partial<Record<number, BatchItem["status"]>>): BatchItem[] {
  let items = planBatch(names);
  for (const [id, status] of Object.entries(statuses)) {
    if (status) items = setStatus(items, Number(id), status);
  }
  return items;
}

describe("ZIP 안의 자리: 문서마다 폴더 하나", () => {
  it("평범한 이름은 확장자만 갈아 끼운 폴더와 마크다운이 된다", () => {
    const [item] = planBatch(["보고서.hwp"]);
    expect(item.folder).toBe("보고서");
    expect(item.path).toBe("보고서/보고서.md");
    expect(item.name).toBe("보고서.hwp"); // 화면에는 놓인 그대로의 이름이 남는다
  });

  it("확장자가 무엇이든 상관없다 — hwpx·docx도 같은 규칙이다", () => {
    const items = planBatch(["가.hwpx", "나.docx"]);
    expect(items.map((item) => item.path)).toEqual(["가/가.md", "나/나.md"]);
  });

  it("확장자가 없는 이름은 이름 전체가 폴더가 된다", () => {
    const [item] = planBatch(["보고서"]);
    expect(item.folder).toBe("보고서");
    expect(item.path).toBe("보고서/보고서.md");
  });

  it("맨 앞 점은 확장자가 아니라 숨김 표시다 — 떼어 내되 이름은 지키지 않는다", () => {
    // `.보고서`의 점은 확장자 구분자가 아니므로 이름이 통째로 살아남고,
    // 숨김 폴더가 되지 않도록 앞 점만 떨어진다.
    expect(planBatch([".보고서"])[0].folder).toBe("보고서");
  });

  it("점으로만 된 이름은 남는 글자가 없어 기본 이름으로 물러난다", () => {
    expect(planBatch(["..."])[0].folder).toBe("문서");
    expect(planBatch(["   "])[0].folder).toBe("문서");
  });

  it("id는 놓인 순서 그대로다 — 순차 처리의 차례이자 목록의 키다", () => {
    expect(planBatch(["가.hwp", "나.hwp", "다.hwp"]).map((item) => item.id)).toEqual([0, 1, 2]);
  });
});

describe("이름 충돌: 같은 이름이 여럿일 때", () => {
  it("같은 이름 셋은 -2·-3으로 갈린다 — 첫 번째는 그대로 둔다", () => {
    const items = planBatch(["보고서.hwp", "보고서.hwp", "보고서.hwp"]);
    expect(items.map((item) => item.folder)).toEqual(["보고서", "보고서-2", "보고서-3"]);
  });

  it("마크다운 이름도 함께 갈린다 — 압축을 풀어 md만 모아도 겹치지 않는다", () => {
    const items = planBatch(["보고서.hwp", "보고서.hwp"]);
    expect(items.map((item) => item.path)).toEqual(["보고서/보고서.md", "보고서-2/보고서-2.md"]);
  });

  it("확장자만 다른 것도 같은 이름이다 — .hwp와 .hwpx가 한 폴더로 겹치지 않는다", () => {
    const items = planBatch(["계약.hwp", "계약.hwpx"]);
    expect(items.map((item) => item.folder)).toEqual(["계약", "계약-2"]);
  });

  it("대소문자만 다른 이름도 같은 것으로 친다 — 맥·윈도우 파일 시스템이 그렇다", () => {
    const items = planBatch(["Report.hwp", "report.hwp", "REPORT.hwp"]);
    expect(items.map((item) => item.folder)).toEqual(["Report", "report-2", "REPORT-3"]);
  });

  it("번호를 붙였더니 뒤에 오는 진짜 이름과 겹치면 다시 번호를 올린다", () => {
    // `보고서-2.hwp`가 이미 목록에 있는데 같은 이름 둘이 섞인 경우.
    const items = planBatch(["보고서.hwp", "보고서-2.hwp", "보고서.hwp"]);
    expect(items.map((item) => item.folder)).toEqual(["보고서", "보고서-2", "보고서-3"]);
    // 폴더 이름이 겹치지 않는다는 것이 이 계획의 전부다.
    expect(new Set(items.map((item) => item.folder)).size).toBe(3);
  });

  it("다듬고 나서 같아진 이름도 충돌로 본다", () => {
    // `가:나`와 `가?나`는 둘 다 `가_나`가 된다.
    const items = planBatch(["가:나.hwp", "가?나.hwp"]);
    expect(items.map((item) => item.folder)).toEqual(["가_나", "가_나-2"]);
  });
});

describe("이름 다듬기: 경로 구분자·제어문자·못 쓰는 글자", () => {
  it("경로가 섞여 오면 마지막 마디만 쓴다 — 폴더째 끌어다 놓으면 그렇게 온다", () => {
    expect(planBatch(["2026/1분기/보고서.hwp"])[0].folder).toBe("보고서");
    expect(planBatch(["C:\\문서\\보고서.hwp"])[0].folder).toBe("보고서");
  });

  it("상위로 거슬러 올라가는 이름도 마지막 마디만 남는다", () => {
    expect(planBatch(["../../etc/passwd.hwp"])[0].folder).toBe("passwd");
  });

  it("제어문자는 지우지 않고 공백으로 바꾼다 — 지우면 없던 글자가 붙어 버린다", () => {
    expect(safeSegment("보고\u0000서")).toBe("보고 서");
    expect(safeSegment("보고\t서")).toBe("보고 서");
    expect(safeSegment("보고\u007f서")).toBe("보고 서");
  });

  it("줄바꿈이 든 이름은 한 줄로 접힌다", () => {
    expect(planBatch(["보고\n서.hwp"])[0].folder).toBe("보고 서");
  });

  it("파일 이름에 못 쓰는 글자는 밑줄이 된다", () => {
    expect(safeSegment('가<나>다:라"마|바?사*아')).toBe("가_나_다_라_마_바_사_아");
  });

  it("끝의 점과 공백은 뗀다 — 윈도우가 조용히 잘라 내는 자리다", () => {
    expect(safeSegment("보고서...")).toBe("보고서");
    expect(safeSegment("보고서   ")).toBe("보고서");
  });

  it("윈도우 장치 이름은 폴더가 될 수 없어 밑줄을 앞에 단다", () => {
    expect(planBatch(["NUL.hwp"])[0].folder).toBe("_NUL");
    expect(planBatch(["com1.hwp"])[0].folder).toBe("_com1");
    // 장치 이름이 이름의 일부일 뿐이면 건드리지 않는다.
    expect(planBatch(["console.hwp"])[0].folder).toBe("console");
  });

  it("이름이 통째로 날아가면 기본 이름으로 물러난다 — 빈 폴더 이름은 만들지 않는다", () => {
    expect(planBatch(["\u0000\u0001.hwp"])[0].folder).toBe("문서");
    expect(planBatch(["2026/   .hwp"])[0].folder).toBe("문서");
  });

  it("이름이 `.hwp` 하나뿐이면 그건 확장자가 아니라 이름이다", () => {
    // 유닉스에서 `.hwp`는 확장자 없는 숨김 파일이다. 앞 점만 떼고 이름으로 쓴다.
    expect(planBatch(["/.hwp"])[0].folder).toBe("hwp");
  });

  it("이름이 전부 날아간 파일이 여럿이면 그것들도 번호로 갈린다", () => {
    const items = planBatch(["...", "   ", "\u0000"]);
    expect(items.map((item) => item.folder)).toEqual(["문서", "문서-2", "문서-3"]);
  });
});

describe("아주 긴 이름", () => {
  it("한 마디는 60자로 자른다 — 한글 60자면 UTF-8로 180바이트다", () => {
    const long = "가".repeat(200);
    const folder = planBatch([`${long}.hwp`])[0].folder;
    expect(Array.from(folder).length).toBe(60);
    expect(folder).toBe("가".repeat(60));
  });

  it("잘린 뒤 같아진 긴 이름들도 번호로 갈린다", () => {
    const head = "나".repeat(70);
    const items = planBatch([`${head}A.hwp`, `${head}B.hwp`]);
    expect(items[0].folder).toBe("나".repeat(60));
    expect(items[1].folder).toBe(`${"나".repeat(58)}-2`);
    // 번호를 붙여도 한 마디는 60자를 넘지 않는다.
    expect(Array.from(items[1].folder).length).toBe(60);
  });

  it("긴 이름의 마크다운 경로도 두 마디 모두 60자 안이다", () => {
    const item = planBatch([`${"다".repeat(120)}.hwp`])[0];
    for (const part of item.path.split("/")) {
      expect(Array.from(part.replace(/\.md$/, "")).length).toBeLessThanOrEqual(60);
    }
  });
});

describe("큐 상태: 대기 → 변환 중 → 완료·실패·건너뜀", () => {
  it("갓 만든 큐는 전부 대기다", () => {
    expect(planBatch(["가.hwp", "나.hwp"]).every((item) => item.status === "pending")).toBe(true);
  });

  it("다음에 손댈 것은 언제나 앞에서부터 하나다 — 순차 처리다", () => {
    const items = queue(["가.hwp", "나.hwp", "다.hwp"], { 0: "done", 1: "failed" });
    expect(nextPending(items)?.id).toBe(2);
  });

  it("남은 것이 없으면 다음도 없다", () => {
    const items = queue(["가.hwp"], { 0: "done" });
    expect(nextPending(items)).toBeNull();
    expect(isRunning(items)).toBe(false);
  });

  it("상태를 갈아 끼워도 다른 항목은 그대로다", () => {
    const before = planBatch(["가.hwp", "나.hwp"]);
    const after = setStatus(before, 1, "running");
    expect(after[0]).toBe(before[0]); // 손대지 않은 항목은 같은 객체다
    expect(after[1].status).toBe("running");
    expect(after[1].folder).toBe("나");
  });

  it("이유는 실패·건너뜀에만 달리고, 다시 시작하면 떨어진다", () => {
    const failed = setStatus(planBatch(["가.hwp"]), 0, "failed", "열지 못했어요");
    expect(failed[0].reason).toBe("열지 못했어요");
    expect(setStatus(failed, 0, "running")[0].reason).toBeUndefined();
  });

  it("목록에 없는 id로 상태를 바꾸려 하면 아무 일도 없다", () => {
    // 옛 일괄 변환이 뒤늦게 끝나 남의 큐를 건드리는 경우를 흉내 낸 것이다.
    const items = planBatch(["가.hwp"]);
    expect(setStatus(items, 7, "done").map((item) => item.status)).toEqual(["pending"]);
  });

  it("비밀번호를 건너뛴 문서는 실패가 아니라 건너뜀이다", () => {
    const items = setStatus(planBatch(["가.hwp"]), 0, "skipped", "비밀번호를 건너뛰었어요");
    expect(progressOf(items).failed).toBe(0);
    expect(progressOf(items).skipped).toBe(1);
  });
});

describe("패닉 뒤: 손대지 못한 것은 '실패'가 아니라 '못 함'이다", () => {
  const names = ["가.hwp", "나.hwp", "다.hwp", "라.hwp", "마.hwp"];

  it("세 번째에서 엔진이 죽으면 그 문서만 실패고 나머지는 못 함이다", () => {
    // 0·1은 끝났고, 2가 엔진을 죽였다(그 문서는 진짜로 실패했다).
    let items = queue(names, { 0: "done", 1: "done", 2: "running" });
    items = setStatus(items, 2, "failed", "문서 엔진이 멈췄어요");
    items = haltRest(items, "앞 문서에서 엔진이 멈췄어요");

    expect(items.map((item) => item.status)).toEqual([
      "done",
      "done",
      "failed",
      "halted",
      "halted",
    ]);
    expect(progressOf(items).failed).toBe(1); // 4~5번을 실패로 세지 않는다
    expect(progressOf(items).halted).toBe(2);
  });

  it("이미 끝난 것은 무엇이든 그대로 둔다", () => {
    const items = haltRest(
      queue(names, { 0: "done", 1: "failed", 2: "skipped", 3: "running" }),
      "멈췄어요",
    );
    expect(items.map((item) => item.status)).toEqual([
      "done",
      "failed",
      "skipped",
      "halted",
      "halted",
    ]);
  });

  it("변환 중이던 것도 못 함으로 간다 — 사용자가 중단한 경우가 그렇다", () => {
    const items = haltRest(queue(names, { 0: "running" }), "중단했어요");
    expect(items[0].status).toBe("halted");
    expect(items[0].reason).toBe("중단했어요");
  });

  it("멈춘 뒤에는 남은 일이 없다", () => {
    const items = haltRest(queue(names, { 0: "done" }), "멈췄어요");
    expect(isRunning(items)).toBe(false);
    expect(nextPending(items)).toBeNull();
    expect(progressOf(items).finished).toBe(5);
  });
});

describe("진행률", () => {
  it("손을 뗀 것을 전부 센다 — 완료·실패·건너뜀·못 함", () => {
    const items = queue(["1", "2", "3", "4", "5", "6", "7", "8"], {
      0: "done",
      1: "done",
      2: "failed",
      3: "skipped",
      4: "halted",
      5: "running",
    });
    const progress = progressOf(items);
    expect(progress).toMatchObject({
      total: 8,
      done: 2,
      failed: 1,
      skipped: 1,
      halted: 1,
      finished: 5,
    });
    expect(progress.percent).toBe(63); // 5/8 = 62.5 → 반올림
  });

  it("빈 큐는 0%다 — 0으로 나누지 않는다", () => {
    expect(progressOf([])).toMatchObject({ total: 0, finished: 0, percent: 0 });
  });

  it("전부 끝나면 100%다", () => {
    expect(progressOf(queue(["가.hwp", "나.hwp"], { 0: "done", 1: "failed" })).percent).toBe(100);
  });
});

describe("문서 하나가 내놓는 ZIP 항목", () => {
  it("마크다운은 계획된 자리에, 그림은 그 폴더 안 images/에 들어간다", () => {
    const item = planBatch(["보고서.hwp"])[0];
    const entries = outputsOf(item, "# 제목\n", [
      { path: "images/1.png", bytes: bytes(1) },
      { path: "images/2.jpg", bytes: bytes(2) },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual([
      "보고서/보고서.md",
      "보고서/images/1.png",
      "보고서/images/2.jpg",
    ]);
  });

  it("마크다운은 UTF-8 바이트로 나간다", () => {
    const entries = outputsOf(planBatch(["가.hwp"])[0], "가");
    expect(Array.from(entries[0].bytes)).toEqual([0xea, 0xb0, 0x80]);
  });

  it("그림이 없으면 마크다운 한 장뿐이다", () => {
    expect(outputsOf(planBatch(["가.hwp"])[0], "글")).toHaveLength(1);
  });

  it("그림 경로가 폴더 밖을 가리켜도 폴더 안으로 접어 넣는다", () => {
    const entries = outputsOf(planBatch(["가.hwp"])[0], "", [
      { path: "../../나/images/1.png", bytes: bytes(1) },
      { path: "/images/2.png", bytes: bytes(2) },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual([
      "가/가.md",
      "가/나/images/1.png",
      "가/images/2.png",
    ]);
  });

  it("남는 마디가 없는 그림 경로도 폴더 자체를 파일로 만들지 않는다", () => {
    // `..`만 든 경로는 걸러 내면 아무것도 안 남는다. 그대로 두면 ZIP 안에
    // 폴더 `가/`와 같은 이름의 **파일** `가`가 생겨 푸는 쪽이 둘 중 하나를 잃는다.
    const entries = outputsOf(planBatch(["가.hwp"])[0], "", [
      { path: "..", bytes: bytes(1) },
      { path: "/", bytes: bytes(2) },
    ]);
    for (const entry of entries) {
      expect(entry.path.startsWith("가/")).toBe(true);
      expect(entry.path).not.toBe("가");
    }
  });

  it("같은 이름의 두 문서는 그림까지 자기 폴더 안에서 닫힌다", () => {
    // 이게 폴더로 가르는 이유다 — 문서마다 그림이 1부터 다시 번호를 받는다.
    const items = planBatch(["보고서.hwp", "보고서.hwp"]);
    const first = outputsOf(items[0], "가", [{ path: "images/1.png", bytes: bytes(1) }]);
    const second = outputsOf(items[1], "나", [{ path: "images/1.png", bytes: bytes(2) }]);
    expect(first[1].path).not.toBe(second[1].path);
    expect(second[1].path).toBe("보고서-2/images/1.png");
  });
});

describe("ZIP 만들기: 완료된 것만, 하나도 없으면 만들지 않는다", () => {
  /** 항목마다 md 한 장 + 그림 한 장을 내놓았다고 치고 결과 표를 만든다. */
  function outputs(items: BatchItem[]): Map<number, ZipEntry[]> {
    const table = new Map<number, ZipEntry[]>();
    for (const item of items) {
      table.set(item.id, outputsOf(item, item.folder, [{ path: "images/1.png", bytes: bytes(1) }]));
    }
    return table;
  }

  it("전부 실패했으면 ZIP을 만들지 않는다", () => {
    const items = queue(["가.hwp", "나.hwp"], { 0: "failed", 1: "failed" });
    expect(zipEntries(items, outputs(items))).toBeNull();
  });

  it("실패·건너뜀·못 함이 섞여 성공이 하나도 없어도 만들지 않는다", () => {
    const items = queue(["가.hwp", "나.hwp", "다.hwp"], {
      0: "failed",
      1: "skipped",
      2: "halted",
    });
    expect(zipEntries(items, outputs(items))).toBeNull();
  });

  it("빈 큐도 null이다", () => {
    expect(zipEntries([], new Map())).toBeNull();
  });

  it("부분 성공이면 성공한 것만 담는다 — 패닉으로 멈춰도 여기까지는 건진다", () => {
    let items = planBatch(["가.hwp", "나.hwp", "다.hwp", "라.hwp"]);
    const table = outputs(items);
    items = setStatus(items, 0, "done");
    items = setStatus(items, 1, "done");
    items = setStatus(items, 2, "failed", "엔진이 멈췄어요");
    items = haltRest(items, "손대지 못했어요");

    const files = zipEntries(items, table);
    expect(files).not.toBeNull();
    expect(Object.keys(files ?? {}).sort()).toEqual([
      "가/images/1.png",
      "가/가.md",
      "나/images/1.png",
      "나/나.md",
    ].sort());
  });

  it("결과를 남기지 않은 완료 항목은 아무것도 더하지 않는다", () => {
    const items = queue(["가.hwp", "나.hwp"], { 0: "done", 1: "done" });
    const table = new Map<number, ZipEntry[]>([[0, outputsOf(items[0], "가")]]);
    expect(Object.keys(zipEntries(items, table) ?? {})).toEqual(["가/가.md"]);
  });
});
