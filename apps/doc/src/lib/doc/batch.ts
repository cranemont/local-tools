/** 여러 문서를 한 번에 옮길 때의 **계산만** 모아 둔 곳 — wasm도 DOM도 만지지 않는다.
 *
 * 폴더에 쌓인 hwp를 마크다운으로 옮기는 게 이 도구의 가장 큰 쓰임인데, 여기서 정해야 할 것이
 * 둘 있다. 둘 다 순수 계산이라 실행 가능한 명세(`tests/doc-batch.test.ts`)로 못 박아 두었다.
 *
 *  ① **ZIP 안의 자리** — 문서마다 폴더를 하나씩 준다. 마크다운이 가리키는 그림 경로는
 *    `images/1.png`라 문서마다 똑같으므로(markdown.ts가 문서 단위로 1부터 센다), 한 폴더에
 *    쏟으면 두 번째 문서의 그림이 첫 번째 것을 덮는다. 폴더로 가르면 상대경로가 그 안에서
 *    닫히고, 같은 이름의 hwp 두 개도 자기 자리를 갖는다.
 *
 *  ② **큐의 상태** — 대기·변환 중·완료·실패·건너뜀, 그리고 **못 함**.
 *    마지막 하나가 이 파일이 있는 이유다. rhwp는 한 번 패닉하면 wasm 인스턴스가 통째로
 *    죽어서 그 뒤 모든 호출이 실패한다(CLAUDE.md 17번). 3번째 파일에서 죽었는데 4~20번을
 *    "실패"로 세면 거짓말이다 — 그 문서들은 시도조차 못 했다. 그래서 손대지 못한 것은
 *    `halted`로 따로 세고, 이미 성공한 것은 그대로 남겨 ZIP으로 내려받게 한다.
 */

export type BatchStatus = "pending" | "running" | "done" | "failed" | "skipped" | "halted";

export interface BatchItem {
  /** 목록에서의 자리이자 안정된 키 — 큐는 순서를 바꾸지 않는다. */
  readonly id: number;
  /** 놓인 그대로의 파일 이름 */
  readonly name: string;
  /** ZIP 안 이 문서의 폴더(끝에 `/` 없음) */
  readonly folder: string;
  /** ZIP 안 마크다운 경로 */
  readonly path: string;
  readonly status: BatchStatus;
  /** 실패·건너뜀·못 함의 이유. 화면은 배지의 `title`로만 보여 준다. */
  readonly reason?: string;
}

/** 마크다운에서 떼어낸 그림 한 장(markdown.ts의 `ExtractedImage`와 같은 모양). */
export interface BatchImage {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  halted: number;
  /** 손을 뗀 것 전부(완료·실패·건너뜀·못 함) */
  finished: number;
  /** 0..100 정수 */
  percent: number;
}

/**
 * 폴더·파일 이름 한 마디의 최대 글자 수. 한글은 UTF-8로 세 바이트라 60자면 180바이트고,
 * 대부분의 파일 시스템이 한 마디에 허용하는 255바이트 안이다.
 */
const MAX_SEGMENT = 60;

/** 이름이 통째로 날아갔을 때 쓸 이름. */
const FALLBACK = "문서";

/** 윈도우가 장치 이름으로 잡아 두어 폴더로 만들 수 없는 것들. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 마지막 경로 구분자 뒤만 — 폴더째 끌어다 놓으면 이름에 경로가 섞여 온다. */
function baseName(name: string): string {
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return cut >= 0 ? name.slice(cut + 1) : name;
}

/** 확장자를 뗀다. 맨 앞 점은 확장자가 아니라 숨김 표시라 건드리지 않는다(`.보고서`). */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 글자 수로 자른다(코드 단위가 아니라 — 서로게이트 쌍을 반으로 가르지 않게). */
function clip(value: string, max: number): string {
  const chars = Array.from(value);
  const cut = chars.length > max ? chars.slice(0, max).join("") : value;
  return cut.replace(/[. ]+$/, "");
}

/**
 * 경로 한 마디로 쓸 수 있게 다듬는다.
 *
 * 제어문자는 **공백으로 바꾼 뒤 접는다** — 그냥 지우면 `보고\n서`가 `보고서`로 붙어 버려
 * 원래 이름과 달라진 사실이 안 보인다. 윈도우에서 못 쓰는 글자는 `_`로 바꾸고,
 * 끝의 점·공백은 떼며(윈도우가 조용히 잘라 낸다), 앞의 점은 숨김 폴더가 되지 않게 뗀다.
 */
export function safeSegment(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");

  const clipped = clip(cleaned, MAX_SEGMENT);
  if (!clipped) return FALLBACK;
  return RESERVED.test(clipped) ? `_${clipped}` : clipped;
}

/** 이미 쓴 이름이면 `-2`, `-3`… 을 붙인다. 대소문자만 다른 것도 같은 이름으로 친다. */
function unique(wanted: string, used: Set<string>): string {
  let candidate = wanted;
  let next = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = `-${next++}`;
    candidate = `${clip(wanted, MAX_SEGMENT - suffix.length) || FALLBACK}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * 파일 이름 목록 → ZIP 안의 자리 + 대기 상태의 큐.
 *
 * 마크다운 파일 이름은 폴더 이름을 그대로 쓴다 — 압축을 풀고 md만 한 군데로 모아도
 * `보고서.md`가 둘이 되지 않는다.
 */
export function planBatch(names: readonly string[]): BatchItem[] {
  const used = new Set<string>();
  return names.map((name, id) => {
    const folder = unique(safeSegment(stripExtension(baseName(name))), used);
    return { id, name, folder, path: `${folder}/${folder}.md`, status: "pending" as const };
  });
}

/** 항목 하나의 상태를 갈아 끼운다(이유를 안 주면 앞서 달린 이유는 떨어진다). */
export function setStatus(
  items: readonly BatchItem[],
  id: number,
  status: BatchStatus,
  reason?: string,
): BatchItem[] {
  return items.map((item) =>
    item.id === id
      ? {
          id: item.id,
          name: item.name,
          folder: item.folder,
          path: item.path,
          status,
          ...(reason === undefined ? {} : { reason }),
        }
      : item,
  );
}

/**
 * 남은 것을 **'못 함'으로** 굳힌다. 이미 끝난 것(완료·실패·건너뜀)은 건드리지 않는다.
 * 엔진이 죽은 뒤 손대지도 못한 문서를 '실패'로 세면 화면이 거짓말을 한다.
 */
export function haltRest(items: readonly BatchItem[], reason: string): BatchItem[] {
  return items.map((item) =>
    item.status === "pending" || item.status === "running"
      ? {
          id: item.id,
          name: item.name,
          folder: item.folder,
          path: item.path,
          status: "halted" as const,
          reason,
        }
      : item,
  );
}

/** 다음에 손댈 항목(없으면 null). 순차 처리라 언제나 앞에서부터 하나씩이다. */
export function nextPending(items: readonly BatchItem[]): BatchItem | null {
  return items.find((item) => item.status === "pending") ?? null;
}

/** 아직 손댈 것이 남았는가. */
export function isRunning(items: readonly BatchItem[]): boolean {
  return items.some((item) => item.status === "pending" || item.status === "running");
}

export function progressOf(items: readonly BatchItem[]): BatchProgress {
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let halted = 0;
  for (const item of items) {
    if (item.status === "done") done++;
    else if (item.status === "failed") failed++;
    else if (item.status === "skipped") skipped++;
    else if (item.status === "halted") halted++;
  }
  const finished = done + failed + skipped + halted;
  const total = items.length;
  return {
    total,
    done,
    failed,
    skipped,
    halted,
    finished,
    percent: total === 0 ? 0 : Math.round((finished / total) * 100),
  };
}

/**
 * 그림 경로를 문서 폴더 **안쪽**으로만 붙인다. 마크다운이 들고 온 상대경로가 폴더 밖을
 * 가리키면 ZIP 안에서 남의 문서를 덮어쓰게 된다.
 */
function joinIn(folder: string, relative: string): string {
  const parts = relative
    .split(/[\\/]+/)
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .map((part) => safeSegment(part));
  // 남는 마디가 하나도 없으면(`..`·`/`처럼) 폴더 이름 자체가 파일 경로가 된다 —
  // ZIP 안에 폴더와 같은 이름의 파일이 생겨 푸는 쪽이 둘 중 하나를 잃는다.
  if (parts.length === 0) return `${folder}/${FALLBACK}`;
  return [folder, ...parts].join("/");
}

/** 문서 하나가 내놓는 ZIP 항목들 — 마크다운 한 장과 그 문서의 그림들. */
export function outputsOf(
  item: BatchItem,
  markdown: string,
  images: readonly BatchImage[] = [],
): ZipEntry[] {
  const entries: ZipEntry[] = [{ path: item.path, bytes: new TextEncoder().encode(markdown) }];
  for (const image of images) {
    entries.push({ path: joinIn(item.folder, image.path), bytes: image.bytes });
  }
  return entries;
}

/**
 * 내려받을 ZIP의 내용물. **완료된 문서만** 담고, 하나도 없으면 null이다 —
 * 전부 실패했는데 빈 ZIP을 내려 주면 "뭔가 받았다"는 거짓 신호가 된다.
 */
export function zipEntries(
  items: readonly BatchItem[],
  outputs: ReadonlyMap<number, readonly ZipEntry[]>,
): Record<string, Uint8Array> | null {
  const files: Record<string, Uint8Array> = {};
  let count = 0;
  for (const item of items) {
    if (item.status !== "done") continue;
    for (const entry of outputs.get(item.id) ?? []) {
      files[entry.path] = entry.bytes;
      count++;
    }
  }
  return count > 0 ? files : null;
}
