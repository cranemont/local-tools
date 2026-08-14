/** 이 도구의 상태 전부. 싱글턴 이름은 `editor`다 —
 * `state`로 두면 `$state` 룬과 충돌해 Svelte가 스토어 접근으로 파싱한다(시트에서 겪은 것).
 *
 * 한 번에 문서 하나만 다룬다(동영상 도구와 같은 규칙). 그래서 "열린 문서 = 보는 문서 =
 * 저장 대상"이 언제나 같고, 어긋날 상태가 없다.
 *
 * 문서 손잡이(HwpDocument)는 wasm 메모리를 쥐고 있어 반응성 대상이 아니다 — 일반 필드로
 * 두고, 새 문서를 열 때 반드시 free()로 놓아준다.
 */

import type { HwpDocument } from "../doc/engine";
import {
  ENGINE_VERSION,
  engineStatus,
  prefetchEngine,
  retryEngine,
  watchEngine,
} from "../doc/engine";
import type { EngineStatus } from "../doc/engine";
import { detect } from "../doc/detect";
import type { DocKind } from "../doc/detect";
import {
  PasswordRequiredError,
  closeHwp,
  documentContent,
  htmlToHwpx,
  openHwp,
  renderPage,
  searchAll,
  summarize,
  toHwpx,
} from "../doc/hwp";
import type { OutlineItem, SearchHit } from "../doc/hwp";
import type { Caret, CaretRect, RangeRect } from "../doc/edit";
import {
  History,
  backspace,
  caretAt,
  deleteForward,
  exportAs,
  insert,
  lengthAt,
  rectOf,
  rectsOfRange,
  caretOfHit,
  splitParagraph,
  step,
} from "../doc/edit";
import { docxHtml, renderDocx } from "../doc/docx";
import { headingsOf, htmlToMarkdown } from "../doc/markdown";
import type { ExtractedImage } from "../doc/markdown";
import { saveBytes, saveMarkdown, saveZip, withExtension } from "../doc/save";
import { haltRest, outputsOf, planBatch, setStatus, zipEntries } from "../doc/batch";
import type { BatchItem, ZipEntry } from "../doc/batch";
import { t } from "../i18n";

export type Stage = "empty" | "opening" | "locked" | "ready" | "error" | "batch";

/**
 * 화면이 목록을 다시 그릴 틈. 한 문서를 옮기는 동안 wasm 호출이 프레임을 통째로 잡으므로,
 * 다음 문서로 넘어가기 전에 한 번 양보하지 않으면 진행률이 끝나고 나서야 한꺼번에 움직인다.
 *
 * **타이머와 경주시킨다** — 탭이 뒤로 가면 크로미엄은 rAF를 아예 안 부르므로, 그것만
 * 기다리면 스무 개짜리 일괄 변환이 탭을 옮기는 순간 통째로 멈춰 선다.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const go = (): void => {
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(go, 50);
    requestAnimationFrame(go);
  });
}

/**
 * 배율 사다리. 1이 **폭 맞춤**(창 너비에 맞춘 크기)이고, 나머지는 그 배수다.
 * 자유로운 숫자 대신 눈금을 둔 이유는 버튼 한 번에 눈에 띄게 달라지게 하려는 것이다.
 */
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;

class EditorState {
  stage = $state<Stage>("empty");
  error = $state<string | null>(null);

  fileName = $state("");
  fileSize = $state(0);
  kind = $state<DocKind | null>(null);
  title = $state<string | null>(null);
  pageCount = $state(0);

  markdown = $state("");
  notes = $state<string[]>([]);

  engine = $state<EngineStatus>("idle");
  engineError = $state<string | null>(null);
  readonly engineVersion = ENGINE_VERSION;

  /** 지금 돌고 있는 오래 걸리는 일 — 버튼을 잠그고 이름을 보여 준다. */
  busy = $state<string | null>(null);
  /** 저장 직후 짧게 띄우는 알림. */
  flash = $state<string | null>(null);

  /** 비밀번호가 한 번 틀렸는가 — 물어보는 화면의 문구가 달라진다. */
  wrongPassword = $state(false);

  hits = $state<SearchHit[]>([]);
  query = $state("");
  /** 찾기에서 지금 보고 있는 결과(-1이면 없다). 하이라이트가 이 값으로 진해진다. */
  currentHit = $state(-1);
  /**
   * 자리를 알아낸 결과들의 사각형. **옮겨 다니며 쌓인다** — 결과가 수백 개인 문서에서
   * 전부 미리 재면 그 자리에서 손이 걸린다(엔진 호출이 결과 수만큼 든다).
   */
  private hitRects = $state(new Map<number, RangeRect[]>());

  /** 문서의 제목 줄들 — 왼쪽 목차가 이걸 그린다. */
  outline = $state<OutlineItem[]>([]);

  /** 보기 배율 — 1이 폭 맞춤이다. */
  zoom = $state(1);
  /** 지금 보고 있는 쪽(0부터). Pages가 스크롤을 따라 올린다. */
  currentPage = $state(0);

  /** 인쇄 중에는 페이지를 전부 그린다(가상 스크롤이 잘라 내면 안 되므로). */
  printing = $state(false);

  // ── 편집 ────────────────────────────────────────────────
  /** 원본 위에서 직접 고치는 중인가. 한글 문서에서만 켤 수 있다. */
  editing = $state(false);
  /** 고친 뒤 아직 저장하지 않았는가 — 닫기·새 문서 열기를 막는 신호. */
  dirty = $state(false);
  caret = $state<Caret | null>(null);
  caretRect = $state<CaretRect | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);
  /**
   * 페이지를 다시 그리라는 신호. 편집이 일어날 때마다 오른다 —
   * `pageSvg()`가 첫 줄에서 이 값을 읽으므로, 화면은 저절로 새로 그린다(시트와 같은 규약).
   */
  revision = $state(0);
  /** 편집 뒤 오른쪽 마크다운은 낡았다. 읽기로 돌아갈 때 다시 뽑는다. */
  markdownStale = $state(false);

  // ── 일괄 변환 ────────────────────────────────────────────
  /** 여러 개를 놓았을 때의 목록. 편집기 대신 이 목록이 화면을 차지한다. */
  batch = $state<BatchItem[]>([]);
  /** 왜 멈췄는가 — 엔진 패닉이면 새로고침을 권하고, 사용자가 멈춘 것이면 그냥 멈춘다. */
  batchHalt = $state<"panic" | "stopped" | null>(null);
  /** 지금 비밀번호를 묻고 있는 파일(일괄 변환 중). 이 파일 하나만 기다린다. */
  batchAsk = $state<{ name: string; wrong: boolean } | null>(null);

  private doc: HwpDocument | null = null;
  private bytes: Uint8Array | null = null;
  private images: ExtractedImage[] = [];
  private pageCache = new Map<number, string>();
  private history = new History();

  /** 문서별 결과. 성공한 것만 쌓이고, 멈춘 뒤에도 이만큼은 ZIP으로 내려받을 수 있다. */
  private batchOutputs = new Map<number, ZipEntry[]>();
  /** 비밀번호 물음에 답할 자리 — 화면이 부르면 기다리던 변환이 이어진다. */
  private batchAnswer: ((password: string | null) => void) | null = null;
  private batchStopped = false;
  /**
   * 몇 번째 일괄 변환인가. 도는 도중에 닫거나 새로 시작하면 이 값이 올라가고,
   * 뒤늦게 끝난 옛 작업은 자기 번호가 아닌 걸 보고 화면에 손대지 않는다.
   */
  private batchRun = 0;

  constructor() {
    watchEngine((status, error) => {
      this.engine = status;
      this.engineError = error?.message ?? null;
    });
  }

  /** 앱이 뜨자마자 — 엔진을 배경에서 미리 받아 둔다. */
  start(): void {
    prefetchEngine();
  }

  async retryEngineLoad(): Promise<void> {
    try {
      await retryEngine();
    } catch {
      // 상태는 watchEngine이 이미 반영했다.
    }
  }

  private reset(): void {
    closeHwp(this.doc);
    this.doc = null;
    this.bytes = null;
    this.images = [];
    this.pageCache.clear();
    this.markdown = "";
    this.notes = [];
    this.outline = [];
    this.title = null;
    this.pageCount = 0;
    this.currentPage = 0;
    this.clearFind();
    this.error = null;
    this.wrongPassword = false;
    this.history.reset();
    this.editing = false;
    this.dirty = false;
    this.caret = null;
    this.caretRect = null;
    this.canUndo = false;
    this.canRedo = false;
    this.markdownStale = false;
    this.resetBatch();
  }

  /** 돌던 일괄 변환이 있으면 그 자리에서 손을 뗀다(기다리던 비밀번호 물음도 풀어 준다). */
  private resetBatch(): void {
    this.batchRun++;
    this.batchAnswer?.(null);
    this.batchAnswer = null;
    this.batch = [];
    this.batchOutputs = new Map();
    this.batchHalt = null;
    this.batchAsk = null;
    this.batchStopped = false;
  }

  /** 고쳐 놓고 저장하지 않았으면 한 번 묻는다 — 되돌릴 수 없는 일이므로. */
  private confirmDiscard(): boolean {
    return !this.dirty || confirm(t.edit.unsaved);
  }

  async open(file: File): Promise<void> {
    if (!this.confirmDiscard()) return;
    this.reset();
    this.stage = "opening";
    this.fileName = file.name;
    this.fileSize = file.size;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const found = detect(file.name, bytes.subarray(0, 4096));
    if (found.kind === null) {
      this.kind = null;
      this.error = found.reason;
      this.stage = "error";
      return;
    }

    this.kind = found.kind;
    this.bytes = bytes;
    await this.load();
  }

  /** 비밀번호를 받아 다시 연다. */
  async unlock(password: string): Promise<void> {
    if (!this.bytes) return;
    await this.load(password);
  }

  private async load(password?: string): Promise<void> {
    const bytes = this.bytes;
    if (!bytes) return;

    this.stage = "opening";
    this.error = null;

    try {
      if (this.kind === "docx") {
        const html = await docxHtml(bytes);
        this.applyMarkdown(html);
        this.pageCount = 0; // 워드 쪽은 페이지 수를 렌더러가 잡는다.
      } else {
        const doc = await openHwp(bytes, password);
        closeHwp(this.doc);
        this.doc = doc;
        this.pageCache.clear();

        const summary = summarize(doc);
        this.pageCount = summary.pages;
        this.title = summary.title;
        const content = documentContent(doc);
        this.applyMarkdown(content.html, content.outline);
      }
      this.wrongPassword = false;
      this.stage = "ready";
    } catch (error) {
      if (error instanceof PasswordRequiredError) {
        this.wrongPassword = error.wrongPassword;
        this.stage = "locked";
        return;
      }
      this.error = error instanceof Error ? error.message : String(error);
      this.stage = "error";
    }
  }

  /**
   * 변환 결과를 화면에 건다. 목차는 한글 문서에서만 문단 자리와 함께 오고,
   * 워드 문서는 엔진이 없으므로 결과 마크다운의 제목 줄에서 뽑는다.
   */
  private applyMarkdown(html: string, outline?: OutlineItem[]): void {
    const result = htmlToMarkdown(html);
    this.markdown = result.markdown;
    this.images = result.images;
    this.notes = result.notes;
    this.outline = outline ?? headingsOf(result.markdown);
  }

  // ── 일괄 변환 ────────────────────────────────────────────
  //
  // 여러 개를 놓으면 편집기 대신 목록이 뜨고, 앞에서부터 **하나씩** 마크다운으로 옮긴다.
  // 순차인 이유는 wasm 인스턴스가 하나뿐이라서다 — 나란히 돌려 봐야 빨라지지 않고,
  // 어느 문서가 엔진을 죽였는지도 알 수 없게 된다.

  /**
   * 무엇으로 열지 가르는 **유일한** 자리 — 하나면 지금까지처럼 편집기, 여럿이면 일괄 변환.
   * 드롭·파일 선택·파일 연결(PWA 더블클릭)이 전부 여기를 지나므로 규칙이 갈라지지 않는다.
   */
  openFiles(files: File[]): void {
    if (files.length > 1) void this.openBatch(files);
    else if (files[0]) void this.open(files[0]);
  }

  /** 파일 여럿을 받아 목록을 세우고 곧바로 돌린다. */
  async openBatch(files: File[]): Promise<void> {
    if (!this.confirmDiscard()) return;
    this.reset();
    this.fileName = "";
    this.fileSize = 0;
    this.kind = null;
    this.stage = "batch";
    this.batch = planBatch(files.map((file) => file.name));

    const run = this.batchRun;
    await this.runBatch(files, run);
  }

  private async runBatch(files: File[], run: number): Promise<void> {
    for (let id = 0; id < files.length; id++) {
      if (run !== this.batchRun) return;
      if (this.batchStopped) {
        this.haltBatch("stopped", t.batch.reason.stopped);
        return;
      }
      // 엔진이 이미 죽었으면(앞 문서가 죽였다) 남은 것은 시도조차 못 한다.
      if (engineStatus() === "broken") {
        this.haltBatch("panic", t.batch.reason.halted);
        return;
      }

      this.batch = setStatus(this.batch, id, "running");
      await nextFrame();
      if (run !== this.batchRun) return;

      try {
        const outputs = await this.convertOne(files[id], this.batch[id]);
        if (run !== this.batchRun) return;
        if (outputs === null && this.batchStopped) {
          // 비밀번호를 묻던 중에 멈춘 것이다 — 이 문서도 '건너뜀'이 아니라 '못 함'이다.
          this.haltBatch("stopped", t.batch.reason.stopped);
          return;
        }
        if (outputs === null) {
          this.batch = setStatus(this.batch, id, "skipped", t.batch.reason.skipped);
        } else {
          this.batchOutputs.set(id, outputs);
          this.batch = setStatus(this.batch, id, "done");
        }
      } catch (error) {
        if (run !== this.batchRun) return;
        const message = error instanceof Error ? error.message : String(error);
        // 이 문서는 진짜로 실패했다. 다만 엔진까지 죽였다면 뒤는 손댈 수조차 없다 —
        // 그 문서들을 '실패'로 세면 거짓말이므로 여기서 멈추고 '못 함'으로 남긴다.
        this.batch = setStatus(this.batch, id, "failed", message);
        if (engineStatus() === "broken") {
          this.haltBatch("panic", t.batch.reason.halted);
          return;
        }
      }
    }
  }

  /**
   * 문서 하나를 ZIP 항목으로. 비밀번호를 물었는데 건너뛰면 null이다(실패가 아니다).
   * 워드 문서는 rhwp를 타지 않으므로 패닉과 무관하다.
   */
  private async convertOne(file: File, item: BatchItem): Promise<ZipEntry[] | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const found = detect(file.name, bytes.subarray(0, 4096));
    if (found.kind === null) throw new Error(found.reason);

    if (found.kind === "docx") {
      const result = htmlToMarkdown(await docxHtml(bytes));
      return outputsOf(item, result.markdown, result.images);
    }

    let doc: HwpDocument | null = null;
    let password: string | undefined;
    for (;;) {
      try {
        doc = await openHwp(bytes, password);
        break;
      } catch (error) {
        // 잠긴 문서 하나 때문에 나머지 열아홉 개가 멈추면 안 된다 — 이 파일만 묻는다.
        if (!(error instanceof PasswordRequiredError)) throw error;
        const answer = await this.askBatchPassword(file.name, error.wrongPassword);
        if (answer === null) return null;
        password = answer;
      }
    }

    try {
      const content = documentContent(doc);
      const result = htmlToMarkdown(content.html);
      return outputsOf(item, result.markdown, result.images);
    } finally {
      // free()를 맨몸으로 부르지 않는다 — 패닉 뒤에는 그 호출도 실패해 원인을 덮어쓴다.
      closeHwp(doc);
    }
  }

  private askBatchPassword(name: string, wrong: boolean): Promise<string | null> {
    this.batchAsk = { name, wrong };
    return new Promise<string | null>((resolve) => {
      this.batchAnswer = (password) => {
        this.batchAnswer = null;
        this.batchAsk = null;
        resolve(password);
      };
    });
  }

  /** 화면이 비밀번호를 건네거나(문자열) 건너뛴다(null). */
  answerBatchPassword(password: string | null): void {
    this.batchAnswer?.(password);
  }

  /** 남은 것을 '못 함'으로 굳힌다 — 이미 끝난 것은 그대로 남는다. */
  private haltBatch(cause: "panic" | "stopped", reason: string): void {
    this.batch = haltRest(this.batch, reason);
    this.batchHalt = cause;
    this.batchAsk = null;
    this.batchAnswer = null;
  }

  /** 사용자가 멈춘다. 기다리던 비밀번호 물음이 있으면 그것부터 풀어 준다. */
  stopBatch(): void {
    this.batchStopped = true;
    this.batchAnswer?.(null);
  }

  /** 지금까지 성공한 것만 ZIP 한 개로. 하나도 없으면 만들지 않는다. */
  saveBatchZip(): Promise<void> {
    return this.run(t.busy.zipping, async () => {
      const entries = zipEntries(this.batch, this.batchOutputs);
      if (!entries) {
        this.flash = t.batch.nothing;
        return;
      }
      saveZip(t.batch.zipName, entries);
      this.flash = t.flash.saved(t.batch.zipName);
    });
  }

  /** 한글 문서 페이지 한 장(SVG). 이미 그린 것은 다시 그리지 않는다. */
  pageSvg(index: number): string {
    this.revision; // 편집이 있었으면 여기서 의존이 걸려 다시 그려진다
    if (!this.doc) return "";
    const cached = this.pageCache.get(index);
    if (cached !== undefined) return cached;
    try {
      const svg = renderPage(this.doc, index);
      this.pageCache.set(index, svg);
      return svg;
    } catch {
      return "";
    }
  }

  /** 워드 문서를 컨테이너에 그린다(재현 뷰). */
  async renderDocxInto(container: HTMLElement): Promise<void> {
    if (this.kind !== "docx" || !this.bytes) return;
    await renderDocx(this.bytes, container);
  }

  /**
   * 결과 하나를 지금 결과로 삼고, 그 자리(쪽·세로 위치)를 돌려준다.
   *
   * 엔진이 쪽 번호를 안 주므로 그 자리에서 알아낸다 — 먼저 **선택 사각형**을 물어
   * 하이라이트까지 한 번에 얻고, 그게 안 되면 캐럿 좌표로 물러난다.
   */
  focusHit(index: number): { page: number; y: number } | null {
    const hit = this.hits[index];
    if (!hit || !this.doc) return null;
    this.currentHit = index;

    const rects = this.rectsOfHit(index);
    if (rects.length > 0) {
      hit.page = rects[0].page; // 한 번 알아낸 건 남겨 둔다
      return { page: rects[0].page, y: rects[0].y };
    }

    const rect = rectOf(this.doc, caretOfHit(hit));
    if (!rect) return null;
    hit.page = rect.page;
    return { page: rect.page, y: rect.y };
  }

  private rectsOfHit(index: number): RangeRect[] {
    const cached = this.hitRects.get(index);
    if (cached) return cached;
    const hit = this.hits[index];
    if (!hit || !this.doc) return [];
    const rects = rectsOfRange(this.doc, caretOfHit(hit), this.query.length);
    this.hitRects = new Map(this.hitRects).set(index, rects);
    return rects;
  }

  /** 원본 위에 칠할 것들 — 지금 결과는 진하게, 이미 자리를 알아낸 나머지는 옅게. */
  get highlights(): { rect: RangeRect; current: boolean }[] {
    const list: { rect: RangeRect; current: boolean }[] = [];
    for (const [index, rects] of this.hitRects) {
      for (const rect of rects) list.push({ rect, current: index === this.currentHit });
    }
    return list;
  }

  search(query: string): void {
    this.query = query;
    if (!this.doc || !query.trim()) {
      this.clearFind();
      this.query = query;
      return;
    }
    try {
      this.hits = searchAll(this.doc, query, false);
    } catch (error) {
      // 엔진이 패닉하면 여기까지 올라온다(searchAll은 패닉만 던진다). 상태는 engine이
      // 이미 굳혔으니 결과를 비우고 이유만 띄운다 — 타이핑 중에 예외가 새어 나가면
      // 콘솔에만 남고 화면은 "못 찾음"처럼 보인다.
      this.hits = [];
      this.flash = error instanceof Error ? error.message : String(error);
    }
    this.currentHit = -1;
    this.hitRects = new Map();
  }

  /** 찾기를 닫았다 — 칠해 둔 자리도 함께 걷는다. */
  clearFind(): void {
    this.hits = [];
    this.query = "";
    this.currentHit = -1;
    this.hitRects = new Map();
  }

  // ── 보기 ────────────────────────────────────────────────

  private setZoom(next: number): void {
    this.zoom = next;
    // 배율이 바뀌면 문서 좌표가 그대로여도 화면 좌표가 달라진다 — 다시 재는 건 Pages가 한다.
  }

  zoomIn(): void {
    const next = ZOOMS.find((value) => value > this.zoom + 0.001);
    if (next !== undefined) this.setZoom(next);
  }

  zoomOut(): void {
    const next = [...ZOOMS].reverse().find((value) => value < this.zoom - 0.001);
    if (next !== undefined) this.setZoom(next);
  }

  /** 창 너비에 맞춘 기본 크기로 되돌린다. */
  fitWidth(): void {
    this.setZoom(1);
  }

  get canZoomIn(): boolean {
    return this.zoom < ZOOMS[ZOOMS.length - 1] - 0.001;
  }

  get canZoomOut(): boolean {
    return this.zoom > ZOOMS[0] + 0.001;
  }

  /**
   * 목차 항목이 문서의 어디인가 — 누를 때 그 자리에서 알아낸다(찾기와 같은 방식).
   * 워드 문서는 문단 자리가 없어 null이고, 화면이 글자로 찾아간다.
   */
  placeOfOutline(item: OutlineItem): { page: number; y: number } | null {
    if (!this.doc || item.section === undefined || item.para === undefined) return null;
    const rect = rectOf(this.doc, {
      kind: "body",
      section: item.section,
      para: item.para,
      offset: 0,
    });
    return rect ? { page: rect.page, y: rect.y } : null;
  }

  // ── 편집 ────────────────────────────────────────────────

  /** 편집을 켤 수 있는 문서인가 — 워드는 rhwp가 다루지 않으므로 읽기만 된다. */
  get editable(): boolean {
    return this.doc !== null && this.kind !== "docx";
  }

  toggleEditing(): void {
    if (!this.editable) return;
    this.editing = !this.editing;
    if (!this.editing) {
      this.caret = null;
      this.caretRect = null;
      this.refreshMarkdown();
    }
  }

  /** 고친 내용을 오른쪽 판에 다시 반영한다 — 문서 전체를 다시 훑으므로 나갈 때 한 번만. */
  private refreshMarkdown(): void {
    if (!this.doc || !this.markdownStale) return;
    try {
      const content = documentContent(this.doc);
      this.applyMarkdown(content.html, content.outline);
      this.markdownStale = false;
    } catch (error) {
      this.flash = error instanceof Error ? error.message : String(error);
    }
  }

  /** 페이지 위의 한 점을 눌렀다 — 캐럿을 그리로 옮긴다. */
  placeCaret(page: number, x: number, y: number): void {
    if (!this.doc || !this.editing) return;
    const found = caretAt(this.doc, page, x, y);
    if (!found) return;
    this.history.breakRun(); // 자리를 옮겼으면 되돌리기도 새 묶음부터
    this.setCaret(found);
  }

  /**
   * 캐럿을 옮긴다. **문단 끝을 넘지 않게 자른다** — 되돌리기로 글자가 사라지면 캐럿이
   * 허공을 가리키게 되고, 그 자리에 친 글자는 엉뚱한 데로 간다(실제로 그랬다).
   */
  private setCaret(caret: Caret | null): void {
    if (!caret || !this.doc) {
      this.caret = caret;
      this.caretRect = null;
      return;
    }
    const clamped = { ...caret, offset: Math.min(caret.offset, lengthAt(this.doc, caret)) };
    this.caret = clamped;
    this.caretRect = rectOf(this.doc, clamped);
  }

  /**
   * 한 번의 편집. 스냅샷 → 고치기 → 화면 갱신을 한 자리에 모은다.
   * `kind`가 같은 편집이 이어지는 동안은 되돌리기 한 묶음으로 친다.
   */
  private edit(kind: string, change: (doc: HwpDocument, caret: Caret) => Caret): void {
    const doc = this.doc;
    const caret = this.caret;
    if (!doc || !caret || !this.editing) return;

    try {
      this.history.mark(doc, kind, performance.now());
      const next = change(doc, caret);

      // 쪽이 밀렸을 수 있으므로 그려 둔 것은 모두 버린다(한 쪽 다시 그리는 데 2ms대).
      this.pageCache.clear();
      // 칠해 둔 찾기 자리도 함께 버린다 — 글자가 밀렸으면 엉뚱한 데를 칠하고 있다.
      this.hitRects = new Map();
      this.revision++;
      this.pageCount = summarize(doc).pages;
      this.dirty = true;
      this.markdownStale = true;
      this.canUndo = this.history.canUndo;
      this.canRedo = this.history.canRedo;
      this.setCaret(next);
    } catch (error) {
      // 엔진이 멈춘 경우 — 더 고치게 두면 안 된다.
      this.editing = false;
      this.flash = error instanceof Error ? error.message : String(error);
    }
  }

  type(text: string): void {
    this.edit("type", (doc, caret) => insert(doc, caret, text));
  }

  backspace(): void {
    this.edit("erase", (doc, caret) => backspace(doc, caret));
  }

  deleteForward(): void {
    this.edit("erase", (doc, caret) => deleteForward(doc, caret));
  }

  newParagraph(): void {
    this.edit("split", (doc, caret) => splitParagraph(doc, caret));
  }

  moveCaret(delta: number): void {
    if (!this.doc || !this.caret) return;
    this.history.breakRun();
    this.setCaret(step(this.doc, this.caret, delta));
  }

  private restore(direction: "undo" | "redo"): void {
    const doc = this.doc;
    if (!doc) return;
    const moved = direction === "undo" ? this.history.undo(doc) : this.history.redo(doc);
    if (!moved) return;

    this.pageCache.clear();
    this.hitRects = new Map();
    this.revision++;
    this.pageCount = summarize(doc).pages;
    this.dirty = true;
    this.markdownStale = true;
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    // 되돌린 뒤 캐럿이 사라진 자리를 가리킬 수 있다 — 그릴 수 없으면 감춘다.
    this.setCaret(this.caret);
  }

  undo(): void {
    this.restore("undo");
  }

  redo(): void {
    this.restore("redo");
  }

  /** 고친 문서를 원래 형식으로 저장한다(.hwp는 .hwp로, .hwpx는 .hwpx로). */
  saveEdited(): Promise<void> {
    return this.run(t.busy.saving, async () => {
      const doc = this.doc;
      if (!doc) return;
      const format = this.kind === "hwpx" ? "hwpx" : "hwp";
      const bytes = exportAs(doc, format);
      const name = withExtension(this.fileName, format);
      saveBytes(name, bytes, format === "hwpx" ? "application/hwp+zip" : "application/x-hwp");
      this.dirty = false;
      this.flash = t.flash.saved(name);
    });
  }

  private async run(label: string, job: () => Promise<void>): Promise<void> {
    this.busy = label;
    try {
      await job();
    } catch (error) {
      this.flash = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = null;
    }
  }

  saveMarkdownFile(): Promise<void> {
    return this.run(t.busy.savingMarkdown, async () => {
      const { saved, zipped } = saveMarkdown(this.fileName, this.markdown, this.images);
      this.flash = zipped ? t.flash.savedZip(saved) : t.flash.saved(saved);
    });
  }

  copyMarkdown(): Promise<void> {
    return this.run(t.busy.copying, async () => {
      await navigator.clipboard.writeText(this.markdown);
      this.flash = t.flash.copied;
    });
  }

  /**
   * .hwpx로 저장. 한글 문서는 엔진이 그대로 내주고, 워드 문서는 시맨틱 HTML을 거쳐
   * 빈 한글 문서에 부어 만든다 — "워드로 받은 문서를 한글로"가 여기서 성립한다.
   */
  saveHwpx(): Promise<void> {
    return this.run(t.busy.converting, async () => {
      let bytes: Uint8Array;
      if (this.kind === "docx") {
        if (!this.bytes) return;
        bytes = await htmlToHwpx(await docxHtml(this.bytes), this.title ?? this.fileName);
      } else {
        if (!this.doc) return;
        bytes = toHwpx(this.doc);
      }
      const name = withExtension(this.fileName, "hwpx");
      saveBytes(name, bytes, "application/hwp+zip");
      this.flash = t.flash.saved(name);
    });
  }

  print(): void {
    this.printing = true;
    // 페이지를 전부 그린 다음 인쇄 대화상자를 띄운다.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        this.printing = false;
      });
    });
  }

  close(): void {
    if (!this.confirmDiscard()) return;
    this.reset();
    this.stage = "empty";
    this.fileName = "";
    this.fileSize = 0;
    this.kind = null;
  }
}

export const editor = new EditorState();
