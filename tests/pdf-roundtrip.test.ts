import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EncryptedPDFError, PDFDocument } from "../apps/pdf/node_modules/pdf-lib";
import { buildPdf, buildPdfParts, type LibCache } from "../apps/pdf/src/lib/pdf/exporter";
import { chunkEvery, resolveRange } from "../apps/pdf/src/lib/pdf/range";
import {
  decryptArgs,
  encryptArgs,
  ensureQpdfReady,
  isPasswordError,
  recompressArgs,
  runQpdf,
} from "../apps/pdf/src/lib/pdf/qpdfLoader";
import type { PageItem, Rotation, SourceDoc } from "../apps/pdf/src/lib/pdf/types";

import { makeJpeg, makePng } from "./fixtures/image";
import {
  makePdf,
  makeRotatedPdf,
  makeTextPdf,
  pdfPageCount,
  pdfPageSizes,
  pdfRotations,
  truncatePdf,
} from "./fixtures/pdf";
import { encryptPdf } from "./fixtures/pdf-password";
import { pdfDrawnText } from "./fixtures/pdf-content";

/**
 * apps/pdf 엔진의 실물 파일 왕복 명세.
 *
 * 1층(`tests/pdf-range.test.ts`·`tests/pdf-compress.test.ts`)은 순수 함수의 답을 잰다.
 * 여기서 재는 것은 그 답이 실물 PDF에 적용됐을 때 나오는 파일이다 — 코드로 지은 PDF를
 * `exporter.ts`·`qpdfLoader.ts`에 태우고, 나온 바이트를 pdf-lib으로 되읽어 쪽 수·쪽 크기·
 * 회전값·쪽 순서·쪽에 그려진 글자를 확인한다.
 *
 * ## 바이트로 단언하지 않는다
 *
 * `buildPdf`가 만드는 문서에는 pdf-lib이 `/CreationDate`·`/ModDate`에 현재 시각을 넣는다.
 * 같은 입력을 두 번 태워도 바이트 수가 583과 584로 갈린다(실측). qpdf 암호화는 난수 키라
 * 더 심하다. 그래서 단언은 구조로만 한다.
 *
 * ## 글자 추출(`extract.ts`)은 여기서 못 잰다
 *
 * `extract.ts`는 `./pdfjs`를 거치고 그 파일 5번 줄이 모듈을 읽는 순간 `new PdfjsWorker()`를
 * 실행한다. node에는 전역 `Worker`가 없어 `ReferenceError: Worker is not defined`가 난다.
 * 그 앞에도 하나 더 있다 — `pdfjs-dist` 기본 진입점은 브라우저 빌드라 `display/canvas.js:71`이
 * `DOMMatrix`를 읽고 `ReferenceError`를 낸다("Please use the `legacy` build in Node.js
 * environments" 경고가 같이 나온다). 앞의 것은 `@napi-rs/canvas`의 `DOMMatrix`를 전역에
 * 끼우면 넘어가지만 뒤의 것은 못 넘는다. vite는 SSR 변환에서 `?worker&inline`을 인라인하지
 * 않고 개발 서버 주소
 * (`/node_modules/.../pdf.worker.min.mjs?worker_file&type=module`, `{type:"module"}`)를
 * `new Worker(...)`에 넘긴다. node에서 그것을 살리려면 worker_threads 위에 웹 워커 흉내를
 * 얹고 그 안에 브라우저 전역을 다시 깔아야 한다 — 그때 재는 것은 앱이 아니라 그 흉내다.
 * 같은 이유로 `engine.ts`(썸네일)·`rasterize.ts`·`extract.ts` 셋 다 import 단계에서 막힌다.
 * 3층(브라우저 모드) 몫이다.
 *
 * 그래서 쪽의 정체는 `tests/fixtures/pdf-content.ts`가 내용 스트림에서 직접 읽는다.
 *
 * ## qpdf 판
 *
 * 루트 devDependency `@neslinesli93/qpdf-wasm@0.3.0`은 `qpdfLoader.ts`가 CDN에 못 박은 판과
 * 같다. 판만 같은 것이 아니라 바이트도 같아서 `qpdfLoader.ts`의 `GLUE_SRI`·`WASM_SRI`가
 * 이 파일에 그대로 맞는다(아래 "엔진 무결성" 절이 그것을 재확인한다). CDN에 다녀오는 길
 * 자체는 여기서 재지 않는다 — 4층 몫이다.
 */

// ── 표본을 앱의 자료 구조로 감싸는 헬퍼 ──────────────────────────────────────

function pdfSource(id: string, bytes: Uint8Array, pageCount: number): SourceDoc {
  return {
    id,
    kind: "pdf",
    name: `${id}.pdf`,
    mime: "application/pdf",
    bytes,
    pageCount,
  };
}

function imageSource(id: string, bytes: Uint8Array, mime: string): SourceDoc {
  return { id, kind: "image", name: `${id}`, mime, bytes, pageCount: 1 };
}

let seq = 0;
function page(sourceId: string, pageIndex: number, rotation: Rotation = 0): PageItem {
  return {
    id: `item-${seq++}`,
    sourceId,
    pageIndex,
    rotation,
    selected: false,
    thumb: "",
    label: "",
  };
}

function sourceMap(...docs: SourceDoc[]): Map<string, SourceDoc> {
  return new Map(docs.map((d) => [d.id, d]));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("병합 — 쪽 목록을 적은 순서 그대로 한 문서로 굽는다", () => {
  it("쪽 순서는 목록 순서다 — 3·1쪽만 이 순서로 적으면 결과도 그 순서다", async () => {
    const src = pdfSource("a", await makeTextPdf(3), 3);
    const out = await buildPdf([page("a", 2), page("a", 0)], sourceMap(src));

    expect(await pdfPageCount(out)).toBe(2);
    expect(await pdfDrawnText(out)).toEqual(["Page 3", "Page 1"]);
  });

  it("같은 쪽을 두 번 적으면 두 장이 된다 — 목록은 집합이 아니다", async () => {
    const src = pdfSource("a", await makeTextPdf(2), 2);
    const out = await buildPdf([page("a", 1), page("a", 1), page("a", 0)], sourceMap(src));

    expect(await pdfDrawnText(out)).toEqual(["Page 2", "Page 2", "Page 1"]);
  });

  it("소스가 여럿이어도 한 문서로 섞이고 순서는 목록이 정한다", async () => {
    const first = pdfSource("a", await makePdf([{ lines: ["AAA"] }, { lines: ["BBB"] }]), 2);
    const second = pdfSource("b", await makePdf([{ lines: ["CCC"] }]), 1);
    const out = await buildPdf(
      [page("b", 0), page("a", 1), page("a", 0)],
      sourceMap(first, second),
    );

    expect(await pdfDrawnText(out)).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("쪽 크기는 원본을 따라간다 — 크기가 다른 쪽을 섞어도 각자 크기를 지킨다", async () => {
    const src = pdfSource(
      "a",
      await makePdf([
        { size: [200, 300], lines: ["small"] },
        { size: [400, 100], lines: ["wide"] },
      ]),
      2,
    );
    const out = await buildPdf([page("a", 1), page("a", 0)], sourceMap(src));

    expect(await pdfPageSizes(out)).toEqual([
      [400, 100],
      [200, 300],
    ]);
  });

  it("목록에 있는데 소스에 없는 항목은 조용히 빠진다 — 나머지는 그대로 굽는다", async () => {
    const src = pdfSource("a", await makeTextPdf(3), 3);
    const out = await buildPdf(
      [page("a", 0), page("사라진 소스", 0), page("a", 2)],
      sourceMap(src),
    );

    expect(await pdfPageCount(out)).toBe(2);
    expect(await pdfDrawnText(out)).toEqual(["Page 1", "Page 3"]);
  });

  it("고른 쪽이 없으면 빈 A4 한 장이 나온다 — 그래서 화면이 먼저 막는다", async () => {
    // pdf-lib은 쪽이 하나도 없는 문서를 저장할 때 빈 A4를 한 장 끼워 넣는다.
    // 사용자가 받는 것은 "0쪽 PDF"가 아니라 백지 한 장이므로,
    // Canvas.svelte의 `if (!items.length) return`과 splitGroups의 "noPages"가 필요하다.
    const src = pdfSource("a", await makeTextPdf(2), 2);
    const out = await buildPdf([], sourceMap(src));

    expect(await pdfPageCount(out)).toBe(1);
    expect(await pdfDrawnText(out)).toEqual([""]);
    expect((await pdfPageSizes(out))[0].map(Math.round)).toEqual([595, 842]);
  });

  it("열 수 없는 바이트는 던진다 — 뒤가 잘린 PDF에서 색인이 사라진 경우", async () => {
    const cut = truncatePdf(await makeTextPdf(3), 0.6);
    const src = pdfSource("a", cut, 3);

    await expect(buildPdf([page("a", 0)], sourceMap(src))).rejects.toThrow();
  });
});

describe("회전 — 사용자 회전은 원본 /Rotate에 더해진다", () => {
  it("원본이 0이면 사용자가 고른 값이 그대로 결과다", async () => {
    const src = pdfSource("a", await makeTextPdf(1), 1);
    const out = await buildPdf([page("a", 0, 90)], sourceMap(src));

    expect(await pdfRotations(out)).toEqual([90]);
  });

  it("원본 회전에 더한다 — /Rotate 90인 쪽에 90을 더하면 180이다", async () => {
    const src = pdfSource("r", await makeRotatedPdf(), 4);
    const out = await buildPdf([page("r", 1, 90)], sourceMap(src));

    expect(await pdfRotations(out)).toEqual([180]);
  });

  it("한 바퀴를 넘으면 360으로 나눈 나머지다 — 270 + 180은 90이다", async () => {
    const src = pdfSource("r", await makeRotatedPdf(), 4);
    const out = await buildPdf([page("r", 3, 180)], sourceMap(src));

    expect(await pdfRotations(out)).toEqual([90]);
  });

  it("쪽마다 회전이 따로 붙는다 — 원본 0·90·180·270에 각각 90을 더한다", async () => {
    const src = pdfSource("r", await makeRotatedPdf(), 4);
    const out = await buildPdf(
      [page("r", 0, 90), page("r", 1, 90), page("r", 2, 90), page("r", 3, 90)],
      sourceMap(src),
    );

    expect(await pdfRotations(out)).toEqual([90, 180, 270, 0]);
    // 회전이 붙어도 어느 쪽인지는 안 바뀐다.
    expect(await pdfDrawnText(out)).toEqual([
      "Rotate 0",
      "Rotate 90",
      "Rotate 180",
      "Rotate 270",
    ]);
  });

  it("회전은 MediaBox를 안 건드린다 — 90도를 걸어도 폭·높이는 그대로다", async () => {
    const src = pdfSource("a", await makePdf([{ size: [200, 300], lines: ["x"] }]), 1);
    const out = await buildPdf([page("a", 0, 90)], sourceMap(src));

    expect(await pdfRotations(out)).toEqual([90]);
    expect(await pdfPageSizes(out)).toEqual([[200, 300]]);
  });
});

describe("분할 — 묶음 하나가 파일 하나다", () => {
  it("묶음마다 파일이 하나 나오고 그 묶음의 쪽만 든다", async () => {
    const src = pdfSource("a", await makeTextPdf(5), 5);
    const groups = [
      [page("a", 0), page("a", 1)],
      [page("a", 4)],
    ];
    const parts = await buildPdfParts(groups, sourceMap(src), "문서");

    expect(parts.map((p) => p.name)).toEqual(["문서-1.pdf", "문서-2.pdf"]);
    expect(await pdfDrawnText(parts[0].bytes)).toEqual(["Page 1", "Page 2"]);
    expect(await pdfDrawnText(parts[1].bytes)).toEqual(["Page 5"]);
  });

  it("파일 이름은 전체 개수의 자릿수만큼 0으로 채운다 — 10묶음이면 두 자리다", async () => {
    const src = pdfSource("a", await makeTextPdf(10), 10);
    const groups = Array.from({ length: 10 }, (_, i) => [page("a", i)]);
    const parts = await buildPdfParts(groups, sourceMap(src), "쪽");

    expect(parts[0].name).toBe("쪽-01.pdf");
    expect(parts[9].name).toBe("쪽-10.pdf");
    expect(await pdfDrawnText(parts[9].bytes)).toEqual(["Page 10"]);
  });

  it("아홉 묶음까지는 한 자리다 — 자릿수는 묶음 수에서만 나온다", async () => {
    const src = pdfSource("a", await makeTextPdf(9), 9);
    const groups = Array.from({ length: 9 }, (_, i) => [page("a", i)]);
    const parts = await buildPdfParts(groups, sourceMap(src), "쪽");

    expect(parts[0].name).toBe("쪽-1.pdf");
    expect(parts[8].name).toBe("쪽-9.pdf");
  });

  it("진행 신호는 묶음을 굽기 전에 온다 — 마지막 굽기가 끝났다는 신호는 없다", async () => {
    const src = pdfSource("a", await makeTextPdf(3), 3);
    const groups = [[page("a", 0)], [page("a", 1)], [page("a", 2)]];
    const seen: [number, number][] = [];

    await buildPdfParts(groups, sourceMap(src), "x", (done, total) => {
      seen.push([done, total]);
    });

    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("신호와 굽기가 번갈아 온다 — 굽고 나서 알리면 화면이 한 묶음씩 늦게 센다", async () => {
    // 위 단언은 값만 보므로 신호를 굽기 뒤로 옮겨도 통과한다. 여기서는 순서를 잰다 —
    // `buildPdf`가 소스 표를 읽는 순간을 굽기의 시작으로 삼고 신호와 엮어 본다.
    const src = pdfSource("a", await makeTextPdf(3), 3);
    const log: string[] = [];
    const watched = new Map<string, SourceDoc>(sourceMap(src));
    const plain = watched.get.bind(watched);
    watched.get = (id: string): SourceDoc | undefined => {
      log.push("굽기");
      return plain(id);
    };

    const groups = [[page("a", 0)], [page("a", 1)], [page("a", 2)]];
    await buildPdfParts(groups, watched, "x", (done) => log.push(`신호${done}`));

    expect(log).toEqual(["신호1", "굽기", "신호2", "굽기", "신호3", "굽기"]);
  });

  it("빈 묶음도 파일이 된다 — 백지 한 장짜리라, 부르기 전에 걸러야 한다", async () => {
    // Canvas.svelte의 splitGroups가 `.filter((g) => g.length > 0)`을 거는 이유다.
    const src = pdfSource("a", await makeTextPdf(2), 2);
    const parts = await buildPdfParts([[], [page("a", 0)]], sourceMap(src), "x");

    expect(parts).toHaveLength(2);
    expect(await pdfPageCount(parts[0].bytes)).toBe(1);
    expect(await pdfDrawnText(parts[0].bytes)).toEqual([""]);
  });

  it("소스 파싱은 캐시에 남는다 — 소스 하나를 열 번 나눠도 항목은 하나다", async () => {
    const src = pdfSource("a", await makeTextPdf(4), 4);
    const cache: LibCache = new Map();

    await buildPdf([page("a", 0)], sourceMap(src), cache);
    await buildPdf([page("a", 1)], sourceMap(src), cache);

    expect([...cache.keys()]).toEqual(["a"]);
  });

  it("캐시에 든 문서가 소스 바이트를 이긴다 — 두 번 파싱하지 않는다는 뜻이다", async () => {
    // 캐시를 쓰는지 확인하는 방법: 소스 바이트와 다른 문서를 미리 넣어 두고
    // 결과가 어느 쪽에서 나오는지 본다. 캐시를 무시하면 "Page 1"이 나온다.
    const src = pdfSource("a", await makeTextPdf(3), 3);
    const other = await PDFDocument.load(await makePdf([{ lines: ["CACHED"] }]));
    const cache: LibCache = new Map([["a", other]]);

    const out = await buildPdf([page("a", 0)], sourceMap(src), cache);

    expect(await pdfDrawnText(out)).toEqual(["CACHED"]);
  });
});

describe("쪽 범위 표기가 실제 파일로 이어진다", () => {
  it("'1-3, 5'는 파일 둘이 되고 쪽은 조각이 적힌 대로 들어간다", async () => {
    const bytes = await makeTextPdf(6);
    const src = pdfSource("a", bytes, 6);
    const { groups, problem } = resolveRange("1-3, 5", 6);
    expect(problem).toBeNull();

    const parts = await buildPdfParts(
      groups.map((g) => g.map((i) => page("a", i))),
      sourceMap(src),
      "범위",
    );

    expect(parts.map((p) => p.name)).toEqual(["범위-1.pdf", "범위-2.pdf"]);
    expect(await pdfDrawnText(parts[0].bytes)).toEqual(["Page 1", "Page 2", "Page 3"]);
    expect(await pdfDrawnText(parts[1].bytes)).toEqual(["Page 5"]);
  });

  it("조각을 적은 순서가 파일 순서다 — '3, 1'은 3쪽 파일이 먼저다", async () => {
    const src = pdfSource("a", await makeTextPdf(4), 4);
    const { groups } = resolveRange("3, 1", 4);

    const parts = await buildPdfParts(
      groups.map((g) => g.map((i) => page("a", i))),
      sourceMap(src),
      "순서",
    );

    expect(await pdfDrawnText(parts[0].bytes)).toEqual(["Page 3"]);
    expect(await pdfDrawnText(parts[1].bytes)).toEqual(["Page 1"]);
  });

  it("문서 끝을 넘긴 범위는 잘려서 나간다 — 10쪽 문서의 '8-99'는 세 장이다", async () => {
    const src = pdfSource("a", await makeTextPdf(10), 10);
    const { groups, problem } = resolveRange("8-99", 10);
    expect(problem).toBeNull();

    const parts = await buildPdfParts(
      groups.map((g) => g.map((i) => page("a", i))),
      sourceMap(src),
      "끝",
    );

    expect(parts).toHaveLength(1);
    expect(await pdfDrawnText(parts[0].bytes)).toEqual(["Page 8", "Page 9", "Page 10"]);
  });

  it("'N쪽마다'는 마지막 묶음만 짧아진다 — 5쪽을 2씩 끊으면 2·2·1이다", async () => {
    const src = pdfSource("a", await makeTextPdf(5), 5);
    const chunks = chunkEvery([0, 1, 2, 3, 4], 2);

    const parts = await buildPdfParts(
      chunks.map((g) => g.map((i) => page("a", i))),
      sourceMap(src),
      "묶음",
    );

    expect(await Promise.all(parts.map((p) => pdfPageCount(p.bytes)))).toEqual([2, 2, 1]);
    expect(await pdfDrawnText(parts[2].bytes)).toEqual(["Page 5"]);
  });

  it("낱장은 쪽 수만큼 파일이 된다", async () => {
    const src = pdfSource("a", await makeTextPdf(3), 3);
    const chunks = chunkEvery([0, 1, 2], 1);

    const parts = await buildPdfParts(
      chunks.map((g) => g.map((i) => page("a", i))),
      sourceMap(src),
      "낱장",
    );

    expect(parts.map((p) => p.name)).toEqual(["낱장-1.pdf", "낱장-2.pdf", "낱장-3.pdf"]);
    expect(await pdfDrawnText(parts[1].bytes)).toEqual(["Page 2"]);
  });
});

describe("이미지를 쪽으로 — 픽셀 수가 그대로 pt가 된다", () => {
  it("PNG 한 장은 그림 크기와 같은 쪽 하나가 된다", async () => {
    const png = makePng({ width: 120, height: 90, seed: 3 });
    const out = await buildPdf([page("p", 0)], sourceMap(imageSource("p", png, "image/png")));

    expect(await pdfPageCount(out)).toBe(1);
    expect(await pdfPageSizes(out)).toEqual([[120, 90]]);
    expect(await pdfRotations(out)).toEqual([0]);
  });

  it("JPEG도 같은 규칙이다", async () => {
    const jpeg = makeJpeg({ width: 200, height: 150, seed: 4 }, 90);
    const out = await buildPdf([page("j", 0)], sourceMap(imageSource("j", jpeg, "image/jpeg")));

    expect(await pdfPageSizes(out)).toEqual([[200, 150]]);
  });

  it("그림 쪽에도 회전이 붙고 MediaBox는 안 바뀐다", async () => {
    const png = makePng({ width: 120, height: 90, seed: 3 });
    const out = await buildPdf(
      [page("p", 0, 270)],
      sourceMap(imageSource("p", png, "image/png")),
    );

    expect(await pdfRotations(out)).toEqual([270]);
    expect(await pdfPageSizes(out)).toEqual([[120, 90]]);
  });

  it("PDF 쪽과 그림이 한 문서에 섞인다", async () => {
    const doc = pdfSource("a", await makeTextPdf(2), 2);
    const png = imageSource("p", makePng({ width: 64, height: 64, seed: 5 }), "image/png");
    const out = await buildPdf([page("a", 0), page("p", 0), page("a", 1)], sourceMap(doc, png));

    expect(await pdfPageCount(out)).toBe(3);
    expect(await pdfDrawnText(out)).toEqual(["Page 1", "", "Page 2"]);
    expect((await pdfPageSizes(out))[1]).toEqual([64, 64]);
  });

  it("무엇으로 심을지는 mime이 정한다 — PNG 바이트에 image/jpeg를 달면 던진다", async () => {
    const png = makePng({ width: 32, height: 32, seed: 6 });
    const wrong = sourceMap(imageSource("p", png, "image/jpeg"));

    await expect(buildPdf([page("p", 0)], wrong)).rejects.toThrow();
  });
});

// ── qpdf ────────────────────────────────────────────────────────────────────
//
// 앱의 `runQpdf`는 CDN에서 글루 스크립트를 받고(`document`에 <script>를 붙인다) wasm을
// fetch해 SHA-384를 검증한 뒤 blob URL로 넘긴다. node에는 그 셋이 다 없으므로 전송로만
// 로컬 파일로 갈아 끼운다. 갈아 끼우지 않는 것은 검증이다 — 해시는 `qpdfLoader.ts`가
// 못 박은 값 그대로 돌고, 지금 깔린 판이 그 값과 어긋나면 로더가 거부해 이 절이 빨개진다.
// CDN에 다녀오는 길 자체(주소·SRI 속성을 브라우저가 강제하는가)는 4층 몫이다.

const require = createRequire(import.meta.url);
const GLUE_PATH = require.resolve("@neslinesli93/qpdf-wasm/dist/qpdf.js");
const WASM_PATH = require.resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm");

function sha384(bytes: Uint8Array): string {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

/** 로더가 <script>에 건 값 — 무결성 검사가 살아 있는지 여기서 본다. */
let scriptAttrs: { src?: string; integrity?: string; crossOrigin?: string } = {};

describe("qpdf 엔진 — 암호와 재압축", () => {
  const saved: Record<string, unknown> = {};

  beforeAll(async () => {
    saved.document = (globalThis as Record<string, unknown>).document;
    saved.fetch = globalThis.fetch;
    saved.createObjectURL = URL.createObjectURL;

    (globalThis as Record<string, unknown>).document = {
      querySelector: () => null,
      createElement: () => ({ dataset: {} as Record<string, string> }),
      head: {
        appendChild: (script: Record<string, unknown>) => {
          scriptAttrs = {
            src: script.src as string,
            integrity: script.integrity as string,
            crossOrigin: script.crossOrigin as string,
          };
          // CDN이 내주는 클래식 스크립트가 하는 일은 전역 Module 하나를 남기는 것이다.
          (globalThis as Record<string, unknown>).Module = require("@neslinesli93/qpdf-wasm");
          (script.onload as () => void)();
        },
      },
    };
    (globalThis as Record<string, unknown>).fetch = async (url: string) => {
      const bytes = readFileSync(url.endsWith(".wasm") ? WASM_PATH : GLUE_PATH);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    };
    // emscripten 글루는 node에서 wasm을 fs로 읽는다. blob URL은 못 읽으므로 경로를 준다.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => WASM_PATH;
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).document = saved.document;
    globalThis.fetch = saved.fetch as typeof fetch;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = saved.createObjectURL;
  });

  describe("엔진 무결성 — 못 박은 해시가 지금 깔린 판과 맞는가", () => {
    it("글루에는 이 판의 SHA-384를 integrity로 건다", async () => {
      // 두 해시가 어긋나면 CLAUDE.md 2번이 말하는 일이 일어난 것이다 —
      // qpdf 판을 올리면서 해시를 다시 계산하지 않았다.
      // 글루 쪽은 값을 눈으로 비교할 수 있고, wasm 쪽은 로더가 스스로 검증해
      // 어긋나면 "보안 검증 실패"로 던지므로 아래 `resolves`가 그 검사다.
      await expect(ensureQpdfReady()).resolves.toBeTruthy();

      expect(scriptAttrs.integrity).toBe(sha384(readFileSync(GLUE_PATH)));
      expect(scriptAttrs.crossOrigin).toBe("anonymous");
    }, 60_000);

    it("표본이 쓰는 판과 앱이 CDN에 적은 판이 같다", async () => {
      await ensureQpdfReady();
      const installed = (require("@neslinesli93/qpdf-wasm/package.json") as { version: string })
        .version;

      expect(scriptAttrs.src).toBe(
        `https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@${installed}/dist/qpdf.js`,
      );
    }, 60_000);
  });

  describe("암호 왕복", () => {
    it("암호를 걸면 pdf-lib이 못 열고, 풀면 쪽 수와 글자가 돌아온다", async () => {
      const src = await makeTextPdf(4);
      const locked = await runQpdf(src, encryptArgs("열려라"));

      await expect(pdfPageCount(locked)).rejects.toThrow();

      const opened = await runQpdf(locked, decryptArgs("열려라"));
      expect(await pdfPageCount(opened)).toBe(4);
      expect(await pdfDrawnText(opened)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    }, 60_000);

    it("암호 왕복은 쪽 크기와 회전을 안 건드린다", async () => {
      const src = await makeRotatedPdf();
      const opened = await runQpdf(await runQpdf(src, encryptArgs("pw")), decryptArgs("pw"));

      expect(await pdfRotations(opened)).toEqual([0, 90, 180, 270]);
      expect(await pdfPageSizes(opened)).toEqual(await pdfPageSizes(src));
    }, 60_000);

    it("틀린 암호면 출력이 없어서 던진다", async () => {
      const locked = await runQpdf(await makeTextPdf(1), encryptArgs("맞는 암호"));

      // 여기서 `isPasswordError(err)`가 참인지는 안 본다 — 지금은 거짓이고,
      // 그 이유는 아래 "qpdf 진단은 모듈을 만드는 순간의 console.error로 나간다" 절에 있다.
      // 그 자리를 고치면 이 단언에 `isPasswordError`를 한 줄 더할 것.
      await expect(runQpdf(locked, decryptArgs("틀린 암호"), "폴백 문구")).rejects.toThrow();
    }, 60_000);

    it("암호를 안 주고 열려 하면 던진다", async () => {
      const locked = await runQpdf(await makeTextPdf(1), encryptArgs("pw"));

      await expect(runQpdf(locked, decryptArgs(""))).rejects.toThrow();
    }, 60_000);

    it("`isPasswordError`는 이름으로 가른다 — 메시지는 안 본다", () => {
      const named = new Error("아무 문구");
      named.name = "QpdfPasswordError";
      expect(isPasswordError(named)).toBe(true);
      expect(isPasswordError(new Error("비밀번호가 올바르지 않거나 필요해요."))).toBe(false);
      expect(isPasswordError("문자열")).toBe(false);
    });
  });

  describe("재압축", () => {
    it("글자만 든 문서는 작아지고 쪽마다 글자가 남는다", async () => {
      const src = await makeTextPdf(6);
      const out = await runQpdf(src, recompressArgs(null));

      expect(out.length).toBeLessThan(src.length);
      expect(await pdfDrawnText(out)).toEqual(await pdfDrawnText(src));
      expect(await pdfPageCount(out)).toBe(6);
    }, 60_000);

    it("품질을 주면 그림이 든 문서가 크게 준다 — 글자 레이어는 남는다", async () => {
      const jpeg = imageSource("j", makeJpeg({ width: 256, height: 256, seed: 11 }, 90), "image/jpeg");
      const text = pdfSource("t", await makeTextPdf(1), 1);
      const withImage = await buildPdf([page("j", 0), page("t", 0)], sourceMap(jpeg, text));

      const out = await runQpdf(withImage, recompressArgs(40));

      expect(out.length).toBeLessThan(withImage.length / 2);
      expect(await pdfDrawnText(out)).toEqual(["", "Page 1"]);
    }, 60_000);

    it("품질을 안 주면 그림은 그대로다 — 이미 압축된 문서는 오히려 커진다", async () => {
      // `chooseSmaller`가 "같거나 크면 원본을 돌려준다"로 되어 있는 이유다
      // (compress.ts의 주석이 적은 실측과 같은 방향).
      const jpeg = makeJpeg({ width: 256, height: 256, seed: 11 }, 90);
      const withImage = await buildPdf(
        [page("j", 0)],
        sourceMap(imageSource("j", jpeg, "image/jpeg")),
      );

      const out = await runQpdf(withImage, recompressArgs(null));

      expect(out.length).toBeGreaterThanOrEqual(withImage.length);
    }, 60_000);

    it("인자는 품질 유무로만 갈린다", () => {
      expect(recompressArgs(null)("/in.pdf", "/out.pdf")).toEqual([
        "/in.pdf",
        "--object-streams=generate",
        "--compression-level=9",
        "--recompress-flate",
        "/out.pdf",
      ]);
      expect(recompressArgs(40)("/in.pdf", "/out.pdf")).toEqual([
        "/in.pdf",
        "--object-streams=generate",
        "--compression-level=9",
        "--recompress-flate",
        "--optimize-images",
        "--jpeg-quality=40",
        "/out.pdf",
      ]);
    });
  });

  describe("소유자 암호만 걸린 문서", () => {
    it("pdf.js는 열지만 pdf-lib은 못 여는 문서에서 내보내기가 던진다", async () => {
      // 사용자 암호가 빈 문서다. 편집 탭은 pdf.js로 열어 두었으므로 화면에는 쪽이 보이고,
      // 내보내기에서 pdf-lib이 처음으로 막는다 — `exporter.ts`의 loadSource가 그 자리다.
      const owned = await runQpdf(await makeTextPdf(2), () => [
        "--encrypt",
        "",
        "소유자만",
        "256",
        "--",
        "/in.pdf",
        "/out.pdf",
      ]);
      const src = pdfSource("o", owned, 2);

      await expect(buildPdf([page("o", 0)], sourceMap(src))).rejects.toThrow();
    }, 60_000);
  });
});

// ── qpdf가 오류를 알리는 통로 ────────────────────────────────────────────────
//
// `qpdfLoader.ts`의 `classifyError`는 qpdf가 남긴 말에 "password"가 있는지로 갈린다.
// 그 말이 어디로 나오는지는 이 wasm 빌드가 정하므로, 여기서 그 통로를 잰다.
// (`classifyError` 자체는 module private이라 직접 못 부른다.)

interface QpdfModule {
  callMain: (args: string[]) => number;
  FS: { writeFile: (path: string, data: Uint8Array) => void; readFile: (path: string) => Uint8Array };
}

function newQpdf(): Promise<QpdfModule> {
  const factory = require("@neslinesli93/qpdf-wasm") as (
    o: Record<string, unknown>,
  ) => Promise<QpdfModule>;
  return factory({ locateFile: () => WASM_PATH, noInitialRun: true });
}

describe("qpdf 진단은 모듈을 만드는 순간의 console.error로 나간다", () => {
  it("모듈을 만들기 전에 바꿔 끼우면 '…invalid password'가 잡힌다", async () => {
    const src = await makeTextPdf(1);
    const enc = await newQpdf();
    enc.FS.writeFile("/in.pdf", src);
    enc.callMain(encryptArgs("pw")("/in.pdf", "/out.pdf"));
    const locked = enc.FS.readFile("/out.pdf");

    const said: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => said.push(args.map(String).join(" "));
    let mod: QpdfModule;
    try {
      mod = await newQpdf();
      mod.FS.writeFile("/in.pdf", locked);
      mod.callMain(decryptArgs("아님")("/in.pdf", "/out.pdf"));
    } finally {
      console.error = original;
    }

    expect(said.join("\n")).toMatch(/invalid password/i);
    // classifyError가 보는 것은 이 정규식이다.
    expect(/password/i.test(said.join("\n"))).toBe(true);
  }, 60_000);

  it("모듈을 만든 뒤에 바꿔 끼우면 하나도 안 잡힌다", async () => {
    // 글루가 `console.error.bind(console)`을 모듈 생성 시점에 붙들기 때문이다.
    // `qpdfLoader.ts`의 runQpdf가 바꿔 끼우는 자리가 여기라, 분류가 못 걸린다.
    // 자세한 것은 이 작업의 결함 보고를 볼 것.
    const src = await makeTextPdf(1);
    const enc = await newQpdf();
    enc.FS.writeFile("/in.pdf", src);
    enc.callMain(encryptArgs("pw")("/in.pdf", "/out.pdf"));
    const locked = enc.FS.readFile("/out.pdf");

    const mod = await newQpdf();
    mod.FS.writeFile("/in.pdf", locked);

    const said: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => said.push(args.map(String).join(" "));
    try {
      mod.callMain(decryptArgs("아님")("/in.pdf", "/out.pdf"));
    } finally {
      console.error = original;
    }

    expect(said).toEqual([]);
  }, 60_000);

  it("print·printErr 설정은 이 빌드에서 아무 일도 안 한다", async () => {
    // 글루 안에 그 두 이름이 없다. 설정으로 조용히 만들 수 없으므로,
    // qpdf가 오류를 내보내는 통로는 console 하나뿐이다.
    const glue = readFileSync(GLUE_PATH, "utf8");
    expect(glue).not.toContain("printErr");
    expect(glue).toContain("console.error.bind(console)");
  });
});

// ── pdf-lib 오류를 종류로 가를 수 있는가 ─────────────────────────────────────

describe("pdf-lib이 던지는 오류는 instanceof로 못 가른다", () => {
  it("EncryptedPDFError는 자기 자신의 instanceof도 거짓이다", () => {
    // pdf-lib 1.17.1은 ES5로 내려 컴파일돼 있고, tslib의 __extends가 Error를 상속할 때
    // `_super.call(this, msg)`가 돌려주는 평범한 Error를 그대로 쓴다. 그래서 던져지는
    // 것도 새로 만든 것도 `Error`다 — `exporter.ts:79`의 갈림길이 여기 걸린다.
    expect(new EncryptedPDFError() instanceof EncryptedPDFError).toBe(false);
    expect(new EncryptedPDFError().constructor.name).toBe("Error");
  });

  it("암호 걸린 문서를 열면 나오는 것도 평범한 Error다", async () => {
    const locked = await encryptPdf(await makeTextPdf(1), "pw");

    const err = await PDFDocument.load(locked).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err instanceof EncryptedPDFError).toBe(false);
    expect((err as Error).message).toContain("encrypted");
  }, 60_000);
});
