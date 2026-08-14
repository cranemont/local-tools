<script module lang="ts">
  // 값 하나를 접었다 펴는 트리. 자기 자신을 불러 재귀한다.
  //
  // 규칙 둘:
  //  ① 접힌 노드는 그리지 않는다 — 수천 줄 응답에서도 첫 화면이 즉시 뜬다.
  //  ② 한 번에 그리는 형제는 CHUNK개까지 — 배열 5,000개짜리를 펴도 창이 멎지 않는다.
  export const CHUNK = 200;

  /** 큰 배열은 눌러 두는 게 기본 — 펴 봐야 화면을 채우기만 한다. */
  const AUTO_OPEN_DEPTH = 2;
  const AUTO_OPEN_MAX = 100;

  export type Kind = "object" | "array" | "string" | "number" | "boolean" | "null";

  export function kindOf(v: unknown): Kind {
    if (v === null || v === undefined) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v === "object") return "object";
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    return "string";
  }

  /** a.b[0].c — 키가 식별자가 아니면 대괄호 표기로 떨어진다. */
  export function joinPath(parent: string, key: string | number): string {
    if (typeof key === "number") return `${parent}[${key}]`;
    if (/^[A-Za-z_$][\w$]*$/.test(key)) return parent ? `${parent}.${key}` : key;
    return `${parent}[${JSON.stringify(key)}]`;
  }

  export interface TreeSearch {
    /** 결과까지 가는 길 — 여기 있는 경로만 그린다 */
    open: Set<string>;
    /** 질의가 실제로 걸린 노드 */
    hit: Set<string>;
    count: number;
    capped: boolean;
  }

  const VISIT_CAP = 200_000;
  const HIT_CAP = 500;

  /** 키·값에 질의가 든 노드를 찾고, 거기까지의 조상 경로를 함께 모은다. */
  export function searchTree(root: unknown, query: string): TreeSearch | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const open = new Set<string>();
    const hit = new Set<string>();
    let visited = 0;
    let capped = false;

    const walk = (value: unknown, path: string, key: string, trail: string[]) => {
      if (capped) return;
      if (++visited > VISIT_CAP || hit.size >= HIT_CAP) {
        capped = true;
        return;
      }
      const kind = kindOf(value);
      const self =
        key.toLowerCase().includes(q) ||
        (kind !== "object" && kind !== "array" && String(value).toLowerCase().includes(q));
      if (self) {
        hit.add(path);
        for (const p of trail) open.add(p);
        open.add(path);
      }
      if (kind === "array" || kind === "object") {
        const next = [...trail, path];
        if (kind === "array")
          (value as unknown[]).forEach((child, i) => walk(child, joinPath(path, i), String(i), next));
        else
          for (const [k, child] of Object.entries(value as Record<string, unknown>))
            walk(child, joinPath(path, k), k, next);
      }
    };

    walk(root, "", "", []);
    return { open, hit, count: hit.size, capped };
  }
</script>

<script lang="ts">
  import Self from "./JsonTree.svelte";
  import Icon from "../Icon.svelte";
  import { t } from "../i18n";

  interface Props {
    value: unknown;
    /** 부모가 이 값을 부르는 이름 — 루트는 없다 */
    label?: string | number | null;
    path?: string;
    depth?: number;
    search?: TreeSearch | null;
    onpath?: (path: string) => void;
  }

  let { value, label = null, path = "", depth = 0, search = null, onpath }: Props = $props();

  const kind = $derived(kindOf(value));
  const container = $derived(kind === "object" || kind === "array");
  const entries = $derived.by((): [string | number, unknown][] => {
    if (kind === "array") return (value as unknown[]).map((v, i) => [i, v]);
    if (kind === "object") return Object.entries(value as Record<string, unknown>);
    return [];
  });

  /** 손으로 접었다 편 것 — 안 건드렸으면 null이고 기본값을 따른다 */
  let override = $state<boolean | null>(null);
  let shown = $state(CHUNK);

  // 얕은 곳은 펴 두되, 형제가 많은 덩어리는 눌러 둔다 — 펴 봐야 화면만 채운다.
  const autoOpen = $derived(depth < AUTO_OPEN_DEPTH && entries.length <= AUTO_OPEN_MAX);
  // 검색 중에는 결과까지 가는 길이 열림을 대신한다 — 접힌 채로 결과를 숨기지 않는다.
  const expanded = $derived(search ? search.open.has(path) : (override ?? autoOpen));
  const hit = $derived(!!search?.hit.has(path));
  const kept = $derived.by(() => {
    if (!expanded) return [];
    // 이 노드 자체가 결과면(키가 걸린 경우) 자식을 거르지 않는다 —
    // 거르면 걸린 키가 내용 없는 `{ 5 }` 한 줄로만 남고, 검색 중엔 펼 수도 없다.
    if (!search || hit) return entries;
    return entries.filter(([k]) => {
      const p = joinPath(path, k);
      return search.open.has(p) || search.hit.has(p);
    });
  });
  const visible = $derived(kept.slice(0, shown));
  const hiddenCount = $derived(kept.length - visible.length);

  const summary = $derived(
    kind === "array" ? `[ ${entries.length} ]` : `{ ${entries.length} }`,
  );

  function toggle() {
    override = !expanded;
    if (override) shown = CHUNK; // 다시 펼 때는 처음 CHUNK개부터
  }

  function display(v: unknown): string {
    if (typeof v === "string") return JSON.stringify(v); // 줄바꿈·따옴표는 이스케이프해서 한 줄로
    if (v === undefined) return "null";
    return String(v);
  }
</script>

<div class="node" class:root={depth === 0}>
  <div class="row" class:hit>
    {#if container}
      <button
        class="twist"
        class:open={expanded}
        onclick={toggle}
        disabled={!!search}
        aria-expanded={expanded}
        aria-label={expanded ? t.format.collapse : t.format.expand}
      >
        <Icon name="chevron" size={12} />
      </button>
    {:else}
      <span class="twist"></span>
    {/if}

    {#if label !== null}
      <span class="key">{label}</span><span class="colon">:</span>
    {/if}

    {#if container}
      <span class="count">{summary}</span>
    {:else}
      <span class="value {kind}">{display(value)}</span>
    {/if}

    <button
      class="path"
      onclick={() => onpath?.(path || "$")}
      aria-label={t.format.copyPath}
      title={t.format.copyPath}
    >
      <Icon name="copy" size={12} />
    </button>
  </div>

  {#if container && expanded}
    <div class="children">
      {#each visible as [k, child] (k)}
        <Self value={child} label={k} path={joinPath(path, k)} depth={depth + 1} {search} {onpath} />
      {/each}
      {#if hiddenCount}
        <button class="more" onclick={() => (shown += CHUNK)}>{t.format.more(hiddenCount)}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .node {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1.5;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: 1px 0;
    border-radius: var(--radius-sm);
  }
  .row.hit {
    background: var(--accent-weak);
  }
  .row:hover .path {
    opacity: 1;
  }

  .twist {
    display: flex;
    flex: none;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    transition: transform var(--dur-short) var(--ease-out);
  }
  button.twist:hover {
    color: var(--text);
  }
  .twist.open {
    transform: rotate(90deg);
  }

  .key {
    color: var(--cat-3-ink);
    font-weight: 600;
  }
  .colon {
    color: var(--text-muted);
    margin-left: -2px;
  }
  .count {
    color: var(--text-muted);
  }

  .value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .value.string {
    color: var(--cat-2-ink);
  }
  .value.number {
    color: var(--cat-4-ink);
  }
  .value.boolean,
  .value.null {
    color: var(--cat-5-ink);
  }

  .path {
    flex: none;
    padding: 0 2px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--dur-short) var(--ease-out);
  }
  .path:hover,
  .path:focus-visible {
    opacity: 1;
    color: var(--accent-ink);
  }

  .children {
    margin-left: 8px;
    padding-left: 8px;
    border-left: 1px solid var(--border);
  }

  .more {
    margin: 2px 0 2px 16px;
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--text-muted);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .more:hover {
    color: var(--text);
  }
</style>
