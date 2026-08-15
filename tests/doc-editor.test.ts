/** 문서 도구의 상태 기계 — 일괄 큐가 어느 갈래를 밟는가, 패닉이 어디까지 번지는가.
 *
 * `doc/batch.ts`의 순수 함수(`nextStep`·`haltEngineBound`·`mergeHalt`) 규격은
 * `tests/doc-batch.test.ts`에 있다. 이 파일이 재는 것은 런타임이 그 규격을 지나는지다.
 * 규격이 맞아도 호출부가 그 규격을 안 지날 수 있다 — `runBatch`가 인덱스로 세는 루프였다면
 * `nextStep`은 그대로 초록인 채 굳힌 항목을 다시 밟는다.
 *
 * 재는 자리는 CLAUDE.md 세 곳이다.
 *   · 30번 — 패닉에 발이 묶이는 것은 rhwp를 타는 문서뿐이다. 종류는 확장자가 아니라
 *     매직바이트로 가르고, 패닉이 중단을 이기고, 새로고침 배너는 목록이 다 끝난 뒤에만 뜬다.
 *   · 17번 — 패닉의 말을 알아보고 상태를 `broken`으로 굳힌다. 되살리는 길은 새로고침뿐이다.
 *   · 18번 — 표는 문단 텍스트가 아니라 문단에 앵커된 컨트롤이다. 선택 영역만 내보내면
 *     표만 든 문서가 빈 마크다운이 된다.
 *
 * ## 부르는 방법
 *
 * `state.svelte.ts`는 룬 모듈이라 svelte 플러그인을 거쳐야 값이 된다(`vitest.config.ts`).
 * 테스트 파일에서는 룬을 못 쓰고, 싱글턴 `editor`의 메서드를 부르고 필드를 읽는다.
 *
 * import이 **동적**인 이유는 브라우저 자리를 먼저 메워야 하기 때문이다. `engine.ts`는
 * 빌드가 박아 주는 `__RHWP_*` 상수를 모듈 첫 줄에서 읽고, `markdown.ts`·`hwp.ts`는
 * `DOMParser`를, `save.ts`는 `document`와 `URL.createObjectURL`을 쓴다. 정적 import는
 * 이 대역이 놓이기 전에 평가된다.
 *
 * ## 이 층이 재지 못하는 것
 *
 * · **wasm을 받아 오는 길**(`ensureEngine` → SHA-384 검증 → `init`). 표본이 `.wasm`을
 *   파일에서 직접 읽어 켜므로 여기서는 `ensureEngine`을 빈 약속으로 갈아 끼운다.
 *   그래서 `editor.engine`은 `broken`이 되기 전까지 `idle`에 머문다 — 그 값에 기대지 말 것.
 * · **쪽 렌더(SVG)와 화면**. `pageSvg`·스크롤·인쇄는 브라우저가 있어야 하는 층의 몫이다.
 * · **크로미엄의 HTML 파서**. `DOMParser` 자리에는 turndown이 node에서 쓰는 것과 같은
 *   파서(domino)를 끼웠다. 표·문단처럼 잘 정의된 마크업은 같게 읽지만, 깨진 마크업의
 *   복구 규칙까지 같다고 보면 안 된다.
 * · **한컴이 만든 hwp**. 표본은 rhwp가 쓰고 rhwp가 읽는다(`tests/fixtures/doc.ts` 머리말).
 *
 * ## 순서가 있다
 *
 * 엔진의 `broken`은 **되돌릴 수 없다**(그것이 17번의 요지다). 이 파일도 그 규칙을 따라
 * 성한 엔진을 쓰는 명세를 앞에, 패닉 뒤의 명세를 뒤에 둔다. describe 순서를 바꾸면
 * 앞쪽이 멈춘 엔진을 만난다.
 */

import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unzipSync } from "../apps/doc/node_modules/fflate";
import {
  docFile,
  makeDocx,
  makeEncryptedHwp,
  makeHwp,
  makeHwpx,
  panicRhwp,
  truncateHwp,
} from "./fixtures/doc";

// ── 브라우저 자리 메우기 ────────────────────────────────────────────────

const globals = globalThis as unknown as Record<string, unknown>;

/** turndown이 node에서 쓰는 파서를 그 자리에서 꺼내 `DOMParser` 자리에 끼운다. */
const requireFromTurndown = createRequire(
  new URL("../apps/doc/node_modules/turndown/package.json", import.meta.url),
);
const domino = requireFromTurndown("@mixmark-io/domino") as {
  createDocument(html: string, force?: boolean): Document;
};
globals.DOMParser = class {
  parseFromString(html: string): Document {
    return domino.createDocument(html, true);
  }
};

// 빌드가 박아 주는 상수 넷. 여기서는 wasm을 받지 않으므로 값 자체는 쓰이지 않는다.
globals.__RHWP_VERSION__ = "0.8.4";
globals.__RHWP_WASM_FILE__ = "rhwp-0.8.4.wasm";
globals.__RHWP_WASM_REMOTE__ = "https://tools.invalid/doc/";
globals.__RHWP_WASM_SHA384__ = "sha384-테스트에서는 안 쓴다";

// 일괄 변환 루프가 문서 사이에서 화면에 양보하는 자리. 곧바로 돌려준다.
globals.requestAnimationFrame = (fn: () => void): number =>
  setTimeout(fn, 0) as unknown as number;

/** 내려받은 것 — `save.ts`가 `<a download>`로 내보내는 것을 여기서 붙잡는다. */
const downloads: { name: string; blob: Blob }[] = [];
let lastBlob: Blob | null = null;

globals.URL = Object.assign(globalThis.URL, {
  createObjectURL: (blob: Blob): string => {
    lastBlob = blob;
    return "blob:doc-test";
  },
  revokeObjectURL: (): void => {},
});
globals.document = {
  createElement: () => {
    const anchor = {
      href: "",
      download: "",
      click: (): void => {
        if (lastBlob) downloads.push({ name: anchor.download, blob: lastBlob });
      },
      remove: (): void => {},
    };
    return anchor;
  },
  body: { appendChild: (): void => {} },
};

// 엔진은 표본이 이미 켰다(파일에서 읽은 wasm). 네트워크로 가는 길만 막는다 —
// 나머지(`isEnginePanic`·`markEngineBroken`·`engineStatus`·`watchEngine`)는 진짜다.
vi.mock("../apps/doc/src/lib/doc/engine", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ensureEngine: (): Promise<void> => Promise.resolve(),
  prefetchEngine: (): void => {},
}));

const { editor } = await import("../apps/doc/src/lib/editor/state.svelte");
const { documentContent, guard, openHwp, closeHwp, summarize } = await import(
  "../apps/doc/src/lib/doc/hwp"
);
const { htmlToMarkdown } = await import("../apps/doc/src/lib/doc/markdown");
const { docxHtml } = await import("../apps/doc/src/lib/doc/docx");
const { detect, HEAD_BYTES } = await import("../apps/doc/src/lib/doc/detect");
const { engineStatus, isEnginePanic } = await import("../apps/doc/src/lib/doc/engine");

// ── 도우미 ──────────────────────────────────────────────────────────────

/** 밖에서 열어 주는 문 하나. `Promise.withResolvers`를 쓰면 lib를 ES2024로 올려야 한다. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 조건이 참이 될 때까지 기다린다. 목록이 도는 도중을 붙잡는 자리에서만 쓴다. */
async function waitFor(fn: () => boolean, label: string, ms = 3000): Promise<void> {
  const limit = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > limit) throw new Error(`기다리던 일이 일어나지 않았다: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** 큐의 상태를 한 줄로 — 이름과 상태만 본다. */
function queue(): [string, string][] {
  return editor.batch.map((item) => [item.name, item.status]);
}

function reasonOf(name: string): string | undefined {
  return editor.batch.find((item) => item.name === name)?.reason;
}

/** 방금 내려받은 ZIP을 풀어 경로→글자로. */
async function lastZip(): Promise<Record<string, string>> {
  const last = downloads[downloads.length - 1];
  const files = unzipSync(new Uint8Array(await last.blob.arrayBuffer()));
  const out: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files)) out[path] = new TextDecoder().decode(bytes);
  return out;
}

/** `arrayBuffer()`를 밖에서 열어 주는 파일 — 목록이 도는 도중을 붙잡는 데 쓴다. */
class GatedFile extends File {
  constructor(
    name: string,
    bytes: Uint8Array,
    private gate: Promise<void>,
  ) {
    super([bytes as BlobPart], name);
  }
  override async arrayBuffer(): Promise<ArrayBuffer> {
    await this.gate;
    return super.arrayBuffer();
  }
}

/**
 * 이 파일을 여는 동안 rhwp가 패닉한다.
 *
 * 패닉은 rhwp가 내는 진짜 오류이고(`panicRhwp`), 그것을 알아보고 상태를 굳히는 것도
 * 실제 경로(`hwp.ts`의 `guard`)다. 흉내 낸 것은 **멈추는 시점** 하나뿐이다 — 목록의 어느
 * 문서에서 엔진이 멈추는지를 골라야 뒤따르는 갈래를 잴 수 있다.
 */
class PanicFile extends File {
  override async arrayBuffer(): Promise<ArrayBuffer> {
    try {
      guard(panicRhwp);
    } catch {
      // guard가 `markEngineBroken`으로 상태를 굳혔다 — 여기서 할 일은 그것뿐이다.
    }
    return super.arrayBuffer();
  }
}

beforeEach(() => {
  editor.close();
  downloads.length = 0;
});

afterEach(() => {
  editor.close();
});

// ── ① 표본 ──────────────────────────────────────────────────────────────

describe("표본은 같은 명세면 같은 바이트다", () => {
  it("hwp는 두 번 지어도 바이트가 같다 — 흔들리면 빨간 불이 코드 탓인지 표본 탓인지 못 가른다", () => {
    const spec = { paragraphs: ["첫 문단"], table: [["가", "나"]] };
    expect(makeHwp(spec)).toEqual(makeHwp(spec));
  });

  it("docx도 두 번 지어도 같다 — ZIP에 지금 시각을 박지 않는다", () => {
    const spec = { paragraphs: ["본문"] };
    expect(makeDocx(spec)).toEqual(makeDocx(spec));
  });

  it("hwp는 CFB, hwpx와 docx는 ZIP이다 — 판별이 이 앞 여덟 바이트에 걸린다", () => {
    expect([...makeHwp().subarray(0, 8)]).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect([...makeHwpx().subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...makeDocx().subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("hwpx와 docx는 이름을 안 보고 ZIP 첫 항목으로 갈린다", () => {
    // 이름이 틀려도 종류가 나와야 한다(CLAUDE.md 30번). ZIP 첫 항목 이름은 30바이트째에
    // 있어 앞 4096바이트 안에 언제나 들어온다.
    //
    // .hwp는 여기 못 넣는다. `looksLikeHwp5`가 찾는 "HWP Document File" 서명이 rhwp가 쓴
    // 파일에서는 8192바이트째에 있어 `HEAD_BYTES`(4096) 밖이다 — 이름이 틀린 .hwp는
    // 지금 `kind: null`로 떨어진다(보고서에 적었다).
    expect(detect("이름.txt", makeHwpx().subarray(0, HEAD_BYTES))).toEqual({ kind: "hwpx" });
    expect(detect("이름.txt", makeDocx().subarray(0, HEAD_BYTES))).toEqual({ kind: "docx" });
  });
});

// ── ② 문단과 컨트롤을 함께 걷는다 (CLAUDE.md 18번) ──────────────────────

describe("표는 문단 텍스트가 아니라 문단에 앵커된 컨트롤이다", () => {
  it("표만 든 문서는 문단 길이가 모두 0이다 — 선택 영역만 내보내면 빈 결과가 나온다", async () => {
    const doc = await openHwp(makeHwp({ table: [["가", "나"]] }));
    try {
      const sections = doc.getSectionCount();
      const lengths: number[] = [];
      for (let section = 0; section < sections; section++) {
        for (let para = 0; para < doc.getParagraphCount(section); para++) {
          lengths.push(doc.getParagraphLength(section, para));
        }
      }
      expect(lengths.length).toBeGreaterThan(0);
      expect(lengths.every((length) => length === 0)).toBe(true);
    } finally {
      closeHwp(doc);
    }
  });

  it("그런 문서에서도 documentContent는 표를 들고 나온다", async () => {
    const doc = await openHwp(makeHwp({ table: [["가", "나"]] }));
    try {
      const html = documentContent(doc).html;
      expect(html).toContain("<table");
      expect(html).toContain("가");
      expect(html).toContain("나");
    } finally {
      closeHwp(doc);
    }
  });

  it("그 표가 마크다운에서도 표로 남는다 — 표만 든 문서가 빈 마크다운이 된 적이 있다", async () => {
    const doc = await openHwp(makeHwp({ table: [["이름", "값"], ["가", "1"]] }));
    try {
      const { markdown } = htmlToMarkdown(documentContent(doc).html);
      expect(markdown).toContain("| 이름 | 값 |");
      expect(markdown).toContain("| --- | --- |");
      expect(markdown).toContain("| 가 | 1 |");
    } finally {
      closeHwp(doc);
    }
  });

  it("내용이 없는 컨트롤(구역·단 정의)은 걷다가 건너뛴다", async () => {
    const doc = await openHwp(makeHwp({ table: [["가"]] }));
    try {
      // 엔진은 이 컨트롤을 "내용 생략됨" 주석 하나로만 내준다. 세는 데는 들어가지만
      // 결과 HTML에는 남지 않아야 한다 — 남으면 마크다운에 주석이 그대로 실린다.
      const positions = JSON.parse(doc.getControlTextPositions(0, 0)) as unknown[];
      expect(positions.length).toBeGreaterThan(1);
      const html = documentContent(doc).html;
      expect(html).not.toContain("내용 생략됨");
      expect(html).not.toContain("<!--");
    } finally {
      closeHwp(doc);
    }
  });

  it("문단 글자와 표가 문서 순서대로 이어진다 — 표가 글 앞으로 튀어나오지 않는다", async () => {
    const doc = await openHwp(makeHwp({ paragraphs: ["앞선 문단"], table: [["칸"]] }));
    try {
      const html = documentContent(doc).html;
      expect(html.indexOf("앞선 문단")).toBeGreaterThanOrEqual(0);
      expect(html.indexOf("앞선 문단")).toBeLessThan(html.indexOf("<table"));
    } finally {
      closeHwp(doc);
    }
  });

  it("걸을 문단이 여럿이면 순서대로 다 나온다", async () => {
    const doc = await openHwp(makeHwp({ paragraphs: ["첫째 줄", "둘째 줄", "셋째 줄"] }));
    try {
      const { markdown } = htmlToMarkdown(documentContent(doc).html);
      expect(markdown.indexOf("첫째 줄")).toBeLessThan(markdown.indexOf("둘째 줄"));
      expect(markdown.indexOf("둘째 줄")).toBeLessThan(markdown.indexOf("셋째 줄"));
    } finally {
      closeHwp(doc);
    }
  });

  it("제목을 못 찾은 문서의 목차는 비어 있다 — 글자 크기로 짐작하지 않는다", async () => {
    const doc = await openHwp(makeHwp({ paragraphs: ["그냥 본문 한 줄"] }));
    try {
      expect(documentContent(doc).outline).toEqual([]);
      expect(summarize(doc).title).toBe(null);
    } finally {
      closeHwp(doc);
    }
  });

  it("워드 문서의 표도 같은 마크다운 규칙을 지난다 — 두 경로가 여기서 만난다", async () => {
    const html = await docxHtml(makeDocx({ table: [["이름", "값"], ["가", "1"]] }));
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("| 이름 | 값 |");
    expect(markdown).toContain("| 가 | 1 |");
  });
});

// ── ③ 하나면 편집기, 여럿이면 목록 ──────────────────────────────────────

describe("무엇으로 열지는 파일 개수 하나로 갈린다", () => {
  it("한 개면 편집기로 연다", async () => {
    editor.openFiles([docFile("보고서.hwp", makeHwp({ paragraphs: ["본문"] }))]);
    await waitFor(() => editor.stage === "ready", "문서가 열리기");
    expect(editor.fileName).toBe("보고서.hwp");
    expect(editor.kind).toBe("hwp");
    expect(editor.markdown).toContain("본문");
    expect(editor.batch).toEqual([]);
  });

  it("여럿이면 목록이 화면을 차지한다", async () => {
    const running = editor.openBatch([
      docFile("가.hwp", makeHwp({ paragraphs: ["첫째"] })),
      docFile("나.docx", makeDocx({ paragraphs: ["둘째"] })),
    ]);
    expect(editor.stage).toBe("batch");
    expect(editor.batchRunning).toBe(true);
    await running;
    expect(queue()).toEqual([
      ["가.hwp", "done"],
      ["나.docx", "done"],
    ]);
    expect(editor.batchRunning).toBe(false);
  });
});

// ── ④ 일괄 큐 — 엔진이 성한 동안 ────────────────────────────────────────

describe("일괄 변환은 앞에서부터 하나씩 옮긴다", () => {
  it("문서마다 자기 폴더를 갖고, 마크다운 이름은 폴더 이름을 그대로 쓴다", async () => {
    await editor.openBatch([
      docFile("보고서.hwp", makeHwp({ paragraphs: ["한글 본문"] })),
      docFile("보고서.docx", makeDocx({ paragraphs: ["워드 본문"] })),
    ]);
    await editor.saveBatchZip();

    const zip = await lastZip();
    expect(Object.keys(zip).sort()).toEqual(["보고서-2/보고서-2.md", "보고서/보고서.md"]);
    expect(zip["보고서/보고서.md"]).toContain("한글 본문");
    expect(zip["보고서-2/보고서-2.md"]).toContain("워드 본문");
    expect(downloads[downloads.length - 1].name).toBe("문서-마크다운.zip");
  });

  it("표만 든 문서도 ZIP 안에서 빈 파일이 아니다", async () => {
    await editor.openBatch([
      docFile("표.hwp", makeHwp({ table: [["이름", "값"]] })),
      docFile("글.docx", makeDocx({ paragraphs: ["워드"] })),
    ]);
    await editor.saveBatchZip();
    expect((await lastZip())["표/표.md"]).toContain("| 이름 | 값 |");
  });

  it("못 여는 파일은 그 문서만 실패하고 나머지는 이어 간다", async () => {
    await editor.openBatch([
      docFile("깨진.hwp", truncateHwp(makeHwp({ paragraphs: ["본문"] }))),
      docFile("멀쩡한.docx", makeDocx({ paragraphs: ["워드"] })),
    ]);
    expect(queue()).toEqual([
      ["깨진.hwp", "failed"],
      ["멀쩡한.docx", "done"],
    ]);
    expect(reasonOf("깨진.hwp")).toMatch(/문서를 여는 데 실패했어요/);
    expect(editor.batchHalt).toBe(null);
  });

  it("실패한 것은 ZIP에 안 담기고, 하나도 성공 못 하면 ZIP을 아예 안 만든다", async () => {
    await editor.openBatch([
      docFile("깨진1.hwp", truncateHwp(makeHwp())),
      docFile("깨진2.hwp", truncateHwp(makeHwp())),
    ]);
    await editor.saveBatchZip();
    expect(downloads).toEqual([]);
    expect(editor.flash).toBe("저장할 결과가 없어요");
  });

  it("잠긴 문서는 그 파일 하나만 묻고, 답을 주면 이어 간다", async () => {
    const running = editor.openBatch([
      docFile("잠김.hwp", makeEncryptedHwp("비밀1234", { paragraphs: ["숨은 본문"] })),
      docFile("뒤.docx", makeDocx({ paragraphs: ["워드"] })),
    ]);
    await waitFor(() => editor.batchAsk !== null, "비밀번호 물음");
    expect(editor.batchAsk).toEqual({ name: "잠김.hwp", wrong: false });
    editor.answerBatchPassword("비밀1234");
    await running;

    expect(queue()).toEqual([
      ["잠김.hwp", "done"],
      ["뒤.docx", "done"],
    ]);
    expect(editor.batchAsk).toBe(null);
  });

  it("틀린 비밀번호는 틀렸다고 알리고 다시 묻는다", async () => {
    const running = editor.openBatch([
      docFile("잠김.hwp", makeEncryptedHwp("비밀1234")),
    ]);
    await waitFor(() => editor.batchAsk !== null, "첫 물음");
    editor.answerBatchPassword("엉뚱한암호");
    await waitFor(() => editor.batchAsk?.wrong === true, "다시 묻기");
    editor.answerBatchPassword(null);
    await running;

    expect(queue()).toEqual([["잠김.hwp", "skipped"]]);
    expect(reasonOf("잠김.hwp")).toBe("비밀번호를 건너뛰었어요.");
  });

  it("비밀번호를 건너뛴 것은 '실패'가 아니라 '건너뜀'이다 — 뒤 문서는 그대로 돈다", async () => {
    const running = editor.openBatch([
      docFile("잠김.hwp", makeEncryptedHwp("비밀1234")),
      docFile("뒤.docx", makeDocx({ paragraphs: ["워드"] })),
    ]);
    await waitFor(() => editor.batchAsk !== null, "비밀번호 물음");
    editor.answerBatchPassword(null);
    await running;

    expect(queue()).toEqual([
      ["잠김.hwp", "skipped"],
      ["뒤.docx", "done"],
    ]);
    expect(editor.batchHalt).toBe(null);
  });

  it("비밀번호를 묻는 중에 중단하면 그 문서는 '건너뜀'이 아니라 '못 함'이다", async () => {
    const running = editor.openBatch([
      docFile("잠김.hwp", makeEncryptedHwp("비밀1234")),
      docFile("뒤.docx", makeDocx({ paragraphs: ["워드"] })),
    ]);
    await waitFor(() => editor.batchAsk !== null, "비밀번호 물음");
    editor.stopBatch();
    await running;

    expect(queue()).toEqual([
      ["잠김.hwp", "halted"],
      ["뒤.docx", "halted"],
    ]);
    expect(editor.batchHalt).toBe("stopped");
    expect(reasonOf("뒤.docx")).toBe("중단해서 손대지 못했어요.");
  });

  it("중단하면 남은 것은 종류를 가리지 않고 '못 함'이 되고, 이미 끝난 것은 그대로 남는다", async () => {
    const gate = deferred();
    const running = editor.openBatch([
      docFile("앞.docx", makeDocx({ paragraphs: ["먼저"] })),
      new GatedFile("가운데.docx", makeDocx({ paragraphs: ["나중"] }), gate.promise),
      docFile("뒤.hwp", makeHwp({ paragraphs: ["한글"] })),
    ]);
    await waitFor(() => editor.batch[0].status === "done", "첫 문서가 끝나기");
    editor.stopBatch();
    expect(editor.batchStopping).toBe(true);
    gate.resolve();
    await running;

    expect(queue()).toEqual([
      ["앞.docx", "done"],
      ["가운데.docx", "done"],
      ["뒤.hwp", "halted"],
    ]);
    expect(editor.batchHalt).toBe("stopped");
  });

  it("돌던 목록을 닫으면 그 자리에서 손을 뗀다 — 뒤늦게 끝난 옛 작업이 화면을 안 건드린다", async () => {
    const gate = deferred();
    const running = editor.openBatch([
      new GatedFile("느린.docx", makeDocx({ paragraphs: ["느림"] }), gate.promise),
      docFile("뒤.docx", makeDocx({ paragraphs: ["뒤"] })),
    ]);
    await waitFor(() => editor.batch[0].status === "running", "첫 문서가 돌기 시작");
    editor.close();
    expect(editor.stage).toBe("empty");
    gate.resolve();
    await running;
    // 옛 작업이 자기 번호가 아닌 걸 보고 물러났다.
    expect(editor.batch).toEqual([]);
    expect(editor.stage).toBe("empty");
  });
});

// ── ⑤ 패닉이 목록 한가운데서 났을 때 (CLAUDE.md 30번) ───────────────────
//
// 여기서 rhwp가 진짜로 패닉한다. 아래 두 describe는 멈춘 엔진 위에서 돈다.

describe("패닉에 발이 묶이는 것은 rhwp를 타는 문서뿐이다", () => {
  it("남은 한글은 '못 함'으로 굳고 워드는 이어 돈다 — 새로고침 배너는 그동안 안 뜬다", async () => {
    const gate = deferred();
    const running = editor.openBatch([
      new PanicFile([makeHwp({ paragraphs: ["첫 문서"] }) as BlobPart], "패닉.hwp"),
      new GatedFile("워드.docx", makeDocx({ paragraphs: ["워드 본문"] }), gate.promise),
      // 이름은 워드인데 속은 한글이다. 확장자로 갈랐다면 이 문서가 멈춘 엔진을 또 부른다.
      docFile("이름만워드.docx", makeHwpx({ paragraphs: ["사실은 한글"] })),
      docFile("한글.hwp", makeHwp({ paragraphs: ["또 한글"] })),
    ]);

    await waitFor(() => editor.batchHalt === "panic", "패닉을 목록에 굳히기");
    // 굳힌 그 순간에도 워드는 아직 남아 있다. 이때 새로고침을 권하면 이미 옮긴 것을 잃는다.
    expect(editor.batchRunning).toBe(true);
    expect(editor.batch.filter((item) => item.status === "halted").map((item) => item.name)).toEqual(
      ["이름만워드.docx", "한글.hwp"],
    );

    gate.resolve();
    await running;

    expect(queue()).toEqual([
      ["패닉.hwp", "done"],
      ["워드.docx", "done"],
      ["이름만워드.docx", "halted"],
      ["한글.hwp", "halted"],
    ]);
    // 이제야 배너를 띄울 때다.
    expect(editor.batchRunning).toBe(false);
    expect(editor.batchHalt).toBe("panic");
    expect(reasonOf("한글.hwp")).toBe("앞 문서에서 엔진이 멈춰 손대지 못했어요.");

    // 멈췄어도 이미 옮긴 둘은 그대로 남아 내려받힌다 — 그래서 새로고침이 급하지 않다.
    await editor.saveBatchZip();
    const zip = await lastZip();
    expect(Object.keys(zip).sort()).toEqual(["워드/워드.md", "패닉/패닉.md"]);
    expect(zip["패닉/패닉.md"]).toContain("첫 문서");
  });
});

// ── ⑥ 멈춘 엔진 (CLAUDE.md 17번) ────────────────────────────────────────

describe("한 번 패닉하면 새로고침 말고는 살릴 길이 없다", () => {
  it("상태가 broken으로 굳고 화면에 사람 말이 올라온다", () => {
    expect(engineStatus()).toBe("broken");
    expect(editor.engine).toBe("broken");
    expect(editor.engineError).toMatch(/새로고침하면 다시 열 수 있어요/);
  });

  it("다시 받기를 눌러도 broken은 안 풀린다 — 다시 받아도 살아나지 않기 때문이다", async () => {
    await editor.retryEngineLoad();
    expect(engineStatus()).toBe("broken");
  });

  it("rhwp가 패닉할 때 던지는 말을 알아본다", () => {
    let message = "";
    try {
      panicRhwp();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/unreachable/);
    expect(isEnginePanic(message)).toBe(true);
  });

  it("패닉을 맞은 문서 손잡이는 그 뒤 어떤 호출도 실패한다 — 그 말도 알아본다", () => {
    expect(isEnginePanic("recursive use of an object detected which would lead to unsafe aliasing in rust")).toBe(true);
    expect(isEnginePanic("attempted to take ownership of Rust value while it was borrowed")).toBe(true);
    expect(isEnginePanic("null pointer passed to rust")).toBe(true);
  });

  it("평범한 실패는 패닉이 아니다 — 여기서 잘못 잡으면 멀쩡한 엔진이 멈춘 것으로 굳는다", () => {
    expect(isEnginePanic("유효하지 않은 파일: 헤더 오류: FileHeader 크기 부족")).toBe(false);
    expect(isEnginePanic("비밀번호가 일치하지 않거나 암호화 데이터가 손상되었습니다")).toBe(false);
    expect(isEnginePanic("렌더링 오류: 지정된 컨트롤이 표, 글상자 또는 그림이 아닙니다")).toBe(false);
  });

  it("guard는 패닉만 사람 말로 바꿔 던지고, 나머지는 그대로 올려보낸다", () => {
    expect(() =>
      guard(() => {
        throw new Error("unreachable");
      }),
    ).toThrow(/문서 엔진이 멈췄어요/);
    expect(() =>
      guard(() => {
        throw new Error("유효하지 않은 파일: 헤더 오류");
      }),
    ).toThrow("유효하지 않은 파일: 헤더 오류");
  });

  it("멈춘 엔진 위에서도 워드 문서는 그대로 열린다 — 순수 JS 경로라 무관하다", async () => {
    const html = await docxHtml(makeDocx({ paragraphs: ["엔진과 무관한 본문"] }));
    expect(htmlToMarkdown(html).markdown).toContain("엔진과 무관한 본문");
  });
});

describe("엔진이 멈춘 뒤 새 목록", () => {
  it("한글은 손도 못 대고 굳고, 워드만 옮겨진다", async () => {
    await editor.openBatch([
      docFile("한글.hwp", makeHwp({ paragraphs: ["한글"] })),
      docFile("워드.docx", makeDocx({ paragraphs: ["워드 본문"] })),
      docFile("한글도.hwpx", makeHwpx({ paragraphs: ["한글x"] })),
    ]);

    expect(queue()).toEqual([
      ["한글.hwp", "halted"],
      ["워드.docx", "done"],
      ["한글도.hwpx", "halted"],
    ]);
    expect(editor.batchHalt).toBe("panic");
  });

  it("패닉이 중단을 이긴다 — stopped로 덮으면 화면에서 새로고침 버튼이 사라진다", async () => {
    const gate = deferred();
    const running = editor.openBatch([
      new GatedFile("워드.docx", makeDocx({ paragraphs: ["워드"] }), gate.promise),
      docFile("한글.hwp", makeHwp({ paragraphs: ["한글"] })),
      docFile("뒤워드.docx", makeDocx({ paragraphs: ["뒤"] })),
    ]);
    await waitFor(() => editor.batchHalt === "panic", "패닉을 목록에 굳히기");
    // 워드를 이어 옮기는 동안 사용자가 중단을 눌렀다.
    editor.stopBatch();
    gate.resolve();
    await running;

    expect(editor.batchHalt).toBe("panic");
    expect(queue()).toEqual([
      ["워드.docx", "done"],
      ["한글.hwp", "halted"],
      ["뒤워드.docx", "halted"],
    ]);
  });
});
