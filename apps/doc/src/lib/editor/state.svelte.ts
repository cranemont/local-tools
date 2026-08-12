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
import { ENGINE_VERSION, prefetchEngine, retryEngine, watchEngine } from "../doc/engine";
import type { EngineStatus } from "../doc/engine";
import { detect } from "../doc/detect";
import type { DocKind } from "../doc/detect";
import {
  PasswordRequiredError,
  closeHwp,
  documentHtml,
  htmlToHwpx,
  openHwp,
  renderPage,
  searchAll,
  summarize,
  toHwpx,
} from "../doc/hwp";
import type { SearchHit } from "../doc/hwp";
import { docxHtml, renderDocx } from "../doc/docx";
import { htmlToMarkdown } from "../doc/markdown";
import type { ExtractedImage } from "../doc/markdown";
import { saveBytes, saveMarkdown, withExtension } from "../doc/save";
import { t } from "../i18n";

export type Stage = "empty" | "opening" | "locked" | "ready" | "error";

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

  /** 인쇄 중에는 페이지를 전부 그린다(가상 스크롤이 잘라 내면 안 되므로). */
  printing = $state(false);

  private doc: HwpDocument | null = null;
  private bytes: Uint8Array | null = null;
  private images: ExtractedImage[] = [];
  private pageCache = new Map<number, string>();

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
    this.title = null;
    this.pageCount = 0;
    this.hits = [];
    this.query = "";
    this.error = null;
    this.wrongPassword = false;
  }

  async open(file: File): Promise<void> {
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
        this.applyMarkdown(documentHtml(doc));
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

  private applyMarkdown(html: string): void {
    const result = htmlToMarkdown(html);
    this.markdown = result.markdown;
    this.images = result.images;
    this.notes = result.notes;
  }

  /** 한글 문서 페이지 한 장(SVG). 이미 그린 것은 다시 그리지 않는다. */
  pageSvg(index: number): string {
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

  search(query: string): void {
    this.query = query;
    if (!this.doc || !query.trim()) {
      this.hits = [];
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
    this.reset();
    this.stage = "empty";
    this.fileName = "";
    this.fileSize = 0;
    this.kind = null;
  }
}

export const editor = new EditorState();
