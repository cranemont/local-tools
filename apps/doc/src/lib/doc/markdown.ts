/** HTML → 마크다운. hwp와 docx 두 경로가 여기서 만난다.
 *
 * 앞단(rhwp의 구역 HTML, mammoth의 시맨틱 HTML)이 서로 다른 HTML을 주지만, 마크다운으로
 * 옮기는 규칙은 하나만 두는 게 맞다 — 결과물이 입력 형식에 따라 달라 보이면 안 되기 때문이다.
 *
 * turndown 본체는 표를 모른다(GFM 확장이 따로 있다). 표는 이 도구에서 가장 중요한 구조라
 * **직접 규칙을 짰다** — 공문서·보고서는 표가 곧 내용이다. 병합된 셀은 마크다운 표가
 * 표현할 수 없어서 칸을 채우는 식으로 편다(잃는 것을 조용히 잃지 않게 아래 주석 참고).
 *
 * 그림은 문서 안에 base64로 박혀 오므로, 마크다운에는 `images/1.png` 상대경로만 남기고
 * 바이트는 따로 떼어 낸다. 그림이 하나라도 있으면 저장은 ZIP이 된다(md + images/).
 */

import TurndownService from "turndown";

export interface ExtractedImage {
  /** 마크다운이 가리키는 상대경로 — `images/1.png` */
  path: string;
  bytes: Uint8Array;
}

export interface MarkdownResult {
  markdown: string;
  images: ExtractedImage[];
  /** 마크다운으로 옮기며 잃은 것들 — 화면에 그대로 알린다. */
  notes: string[];
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * `data:image/png;base64,...` 를 파일로 떼어 낸다. 그 밖의 src는 손대지 않는다.
 *
 * 같은 그림이 여러 번 나오면(머리말 로고·도장처럼 쪽마다 박히는 것들) 파일은 하나만
 * 만들고 모두 그것을 가리키게 한다 — 안 그러면 ZIP이 같은 바이트로 부푼다.
 */
function extractImages(root: Document): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seen = new Map<string, { path: string; index: number }>();

  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(src);
    if (!match) continue;

    let found = seen.get(src);
    if (!found) {
      const ext = MIME_EXT[match[1].toLowerCase()] ?? "bin";
      const path = `images/${images.length + 1}.${ext}`;
      try {
        images.push({ path, bytes: base64ToBytes(match[2]) });
      } catch {
        continue; // 깨진 data URI — 원본 src를 그대로 둔다.
      }
      found = { path, index: images.length };
      seen.set(src, found);
    }

    img.setAttribute("src", found.path);
    if (!img.getAttribute("alt")) img.setAttribute("alt", `그림 ${found.index}`);
  }

  return images;
}

function cellText(service: TurndownService, cell: Element): string {
  // 셀 안에서는 줄바꿈이 표를 깨뜨리므로 한 줄로 편다.
  return service
    .turndown(cell.innerHTML)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

/**
 * GFM 파이프 표. 첫 행을 머리글로 삼고, 열 수는 가장 넓은 행에 맞춘다.
 * rowspan/colspan은 마크다운에 자리가 없어 편다 — colspan은 빈 칸으로 채우고,
 * rowspan은 첫 행에만 남는다. 잃은 게 있으면 호출부가 notes로 알린다.
 */
function tableToMarkdown(service: TurndownService, table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const grid: string[][] = [];
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("th, td"));
    if (cells.length === 0) continue;
    const line: string[] = [];
    for (const cell of cells) {
      line.push(cellText(service, cell));
      const span = Number(cell.getAttribute("colspan") ?? "1");
      for (let i = 1; i < span; i++) line.push("");
    }
    grid.push(line);
  }
  if (grid.length === 0) return "";

  const width = Math.max(...grid.map((line) => line.length));
  const pad = (line: string[]): string =>
    `| ${[...line, ...Array(width - line.length).fill("")].join(" | ")} |`;

  const [head, ...body] = grid;
  const divider = `| ${Array(width).fill("---").join(" | ")} |`;
  return `\n\n${[pad(head), divider, ...body.map(pad)].join("\n")}\n\n`;
}

function createService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  service.addRule("table", {
    filter: "table",
    replacement: (_content, node) => tableToMarkdown(service, node as HTMLTableElement),
  });

  service.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: (content) => (content.trim() ? `~~${content}~~` : ""),
  });

  // 표 안의 문단이 셀을 깨지 않도록, 셀 컨텍스트에서는 문단을 줄바꿈으로만 만든다.
  service.addRule("cellParagraph", {
    filter: (node) => node.nodeName === "P" && node.closest("td, th") !== null,
    replacement: (content) => `${content.trim()} `,
  });

  // 빈 문단(한글 문서에 흔한 여백용 빈 줄)이 마크다운을 성기게 만들지 않도록 걷어 낸다.
  service.addRule("emptyBlock", {
    filter: (node) =>
      ["P", "DIV"].includes(node.nodeName) &&
      node.textContent?.trim() === "" &&
      node.querySelector("img, table, hr, br") === null,
    replacement: () => "",
  });

  return service;
}

/** 잃은 것을 세어 화면에 알린다 — 조용히 사라지는 게 제일 나쁘다. */
function collectNotes(root: Document, images: ExtractedImage[]): string[] {
  const notes: string[] = [];

  const merged = root.querySelectorAll(
    "td[rowspan]:not([rowspan='1']), th[rowspan]:not([rowspan='1'])",
  ).length;
  if (merged > 0) notes.push(`병합된 셀 ${merged}개는 마크다운 표로 옮기며 펴졌어요.`);

  const remoteImages = Array.from(root.querySelectorAll("img")).filter(
    (img) => !(img.getAttribute("src") ?? "").startsWith("images/"),
  ).length;
  if (remoteImages > 0) notes.push(`그림 ${remoteImages}개는 파일로 떼어 내지 못했어요.`);

  if (images.length > 0) notes.push(`그림 ${images.length}개를 images/ 폴더로 함께 담아요.`);

  return notes;
}

export function htmlToMarkdown(html: string): MarkdownResult {
  const root = new DOMParser().parseFromString(html, "text/html");
  const images = extractImages(root);
  const notes = collectNotes(root, images);

  const markdown = createService()
    .turndown(root.body.innerHTML)
    // 빈 줄이 셋 이상 이어지면 둘로 줄인다.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown: `${markdown}\n`, images, notes };
}
