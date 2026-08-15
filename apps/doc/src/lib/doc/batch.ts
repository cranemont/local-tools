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
 *
 *    다만 **발이 묶이는 것은 rhwp를 타는 문서뿐이다**(`needsEngine`). 워드는 mammoth·
 *    turndown뿐인 순수 JS 경로라 엔진이 죽어도 멀쩡히 옮겨진다 — 스무 개 중 하나가 엔진을
 *    죽였다고 워드 열다섯 개까지 '못 함'으로 세면 그것도 거짓말이다.
 */

import type { DocKind } from "./detect";

export type BatchStatus = "pending" | "running" | "done" | "failed" | "skipped" | "halted";

/** 큐가 멈춘 이유. 화면이 새로고침을 권할지 말지가 여기서 갈린다. */
export type HaltCause = "panic" | "stopped";

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

/** 아직 손을 못 뗀 것 — 대기이거나 변환 중이거나. */
const unfinished = (item: BatchItem): boolean =>
  item.status === "pending" || item.status === "running";

function haltedItem(item: BatchItem, reason: string): BatchItem {
  return {
    id: item.id,
    name: item.name,
    folder: item.folder,
    path: item.path,
    status: "halted",
    reason,
  };
}

/**
 * 남은 것을 **'못 함'으로** 굳힌다. 이미 끝난 것(완료·실패·건너뜀)은 건드리지 않는다.
 * 엔진이 죽은 뒤 손대지도 못한 문서를 '실패'로 세면 화면이 거짓말을 한다.
 *
 * 큐 전체를 세우는 것은 **사용자가 중단했을 때**다. 엔진 패닉은 종류를 가려야 하므로
 * `haltEngineBound`로 간다.
 */
export function haltRest(items: readonly BatchItem[], reason: string): BatchItem[] {
  return items.map((item) => (unfinished(item) ? haltedItem(item, reason) : item));
}

/**
 * 이 종류를 옮기는 데 한글 엔진(rhwp)이 필요한가 — **패닉에 발이 묶이는 것은 이것뿐**이다.
 *
 * 워드는 mammoth+turndown, 즉 순수 JS 경로라 wasm 인스턴스가 죽어도 그대로 돌아간다.
 * 종류를 알 수 없는 파일(`null`)도 엔진을 기다리지 않는다 — 왜 못 여는지는 매직바이트만
 * 보고도 말할 수 있으니 그 항목은 평소처럼 '실패'로 간다.
 *
 * 새 종류를 붙일 땐 여기에 명시적으로 더할 것. 빠뜨리면 조용히 "엔진 없이 된다"가 된다.
 */
export function needsEngine(kind: DocKind | null): boolean {
  return kind === "hwp" || kind === "hwpx";
}

/**
 * 엔진이 죽었다 — 남은 것 중 **한글 문서만** '못 함'으로 굳히고 워드는 대기 그대로 둔다.
 * 그대로 남은 항목은 큐가 이어서 옮긴다(순차 규약은 `nextPending`이 그대로 지킨다).
 *
 * 종류는 확장자가 아니라 매직바이트로 가른 것이어야 한다(`detect`) — 메일로 온 문서는
 * 이름이 자주 틀리는데, `.docx`라고 적힌 한글 문서를 계속 돌리면 죽은 엔진을 또 부른다.
 */
export function haltEngineBound(
  items: readonly BatchItem[],
  kindOf: (item: BatchItem) => DocKind | null,
  reason: string,
): BatchItem[] {
  return items.map((item) =>
    unfinished(item) && needsEngine(kindOf(item)) ? haltedItem(item, reason) : item,
  );
}

/**
 * 멈춘 이유는 겹칠 수 있다 — 패닉으로 한글이 묶인 뒤 워드를 이어 옮기는 동안 사용자가
 * 중단을 누르는 경우다. 이때 **패닉이 이긴다**: 중단은 다시 놓으면 그만이지만 죽은 엔진은
 * 새로고침 말고 살릴 길이 없고(CLAUDE.md 17번), `stopped`로 덮으면 화면에서 그 사실과
 * 새로고침 버튼이 함께 사라진다.
 */
export function mergeHalt(current: HaltCause | null, next: HaltCause): HaltCause {
  return current === "panic" || next === "panic" ? "panic" : next;
}

/**
 * 다음에 손댈 항목(없으면 null). 순차 처리라 언제나 앞에서부터 하나씩이다.
 *
 * 일괄 변환 루프가 **실제로 이 차례를 따른다** — `nextStep`이 이 함수로 항목을 집고,
 * `runBatch`는 그 결과만 본다. 그래서 패닉으로 굳힌 한글 문서는 저절로 건너뛰고 그 뒤의
 * 워드가 다음 차례가 된다. 인덱스로 세는 루프로 되돌리면 "순차 처리다"라는 계약이
 * 이 파일에서 사라진다.
 */
export function nextPending(items: readonly BatchItem[]): BatchItem | null {
  return items.find((item) => item.status === "pending") ?? null;
}

/** 루프가 다음에 할 일. `nextStep`이 고른다. */
export type BatchStep =
  | { kind: "convert"; item: BatchItem }
  | { kind: "freeze" }
  | { kind: "halt"; cause: HaltCause }
  | { kind: "finish" };

/** 루프 바깥에서 들어오는 신호들 — 큐만 봐서는 알 수 없는 것. */
export interface BatchSignals {
  /** rhwp가 패닉으로 죽었는가(`engineStatus() === "broken"`). */
  engineBroken: boolean;
  /** 그 사실을 목록에 이미 굳혔는가 — 두 번 굳히면 같은 자리를 무한히 다시 밟는다. */
  frozen: boolean;
  /** 사용자가 중단을 눌렀는가. */
  stopping: boolean;
}

/**
 * 큐가 다음에 할 일 하나. **갈래의 순서가 이 상태 기계의 전부**라 런타임 대신 여기에 둔다
 * (`state.svelte.ts`의 `runBatch`가 이 함수로 갈래를 고른다).
 *
 *  - `finish` — 남은 것이 없다. 엔진이 죽었어도 굳힐 것이 없으면 그냥 끝이다.
 *  - `freeze` — 엔진이 죽었다. 남은 것을 **종류로 갈라** 굳힐 차례다(`haltEngineBound`).
 *  - `halt`   — 사용자가 중단했다. 남은 것을 종류 가리지 않고 굳힌다(`haltRest`).
 *  - `convert`— 평소. 이 항목을 옮긴다.
 *
 * **패닉이 중단보다 먼저 온다.** 중단을 누른 그 문서가 엔진을 죽인 경우 중단부터 처리하면,
 * 남은 한글 문서에 '중단해서 손대지 못했어요'라고 적히고 멈춘 이유도 `stopped`가 되어
 * 화면에서 새로고침 버튼이 사라진다 — 엔진은 여전히 죽어 있는데. 굳히고 나면 그다음 바퀴에서
 * 중단이 나머지를 마저 세우고, 이유는 `mergeHalt`가 패닉으로 지킨다.
 */
export function nextStep(items: readonly BatchItem[], signals: BatchSignals): BatchStep {
  const item = nextPending(items);
  if (!item) return { kind: "finish" };
  if (signals.engineBroken && !signals.frozen) return { kind: "freeze" };
  if (signals.stopping) return { kind: "halt", cause: "stopped" };
  return { kind: "convert", item };
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
