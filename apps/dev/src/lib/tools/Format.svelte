<script lang="ts">
  import { load as yamlLoad, dump as yamlDump } from "js-yaml";
  import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
  import { t } from "../i18n";
  import CopyButton from "../CopyButton.svelte";
  import Icon from "../Icon.svelte";
  import { persisted } from "../persist.svelte";
  import JsonTree, { searchTree } from "./JsonTree.svelte";

  type Fmt = "json" | "yaml" | "xml";
  type View = "text" | "tree";
  const FMT_LABEL: Record<Fmt, string> = { json: "JSON", yaml: "YAML", xml: "XML" };

  const input = persisted("format.input", "");
  const outFmt = persisted<Fmt | null>("format.outFmt", null); // null = 입력 형식 그대로(정리)
  const indent = persisted("format.indent", 2);
  const minify = persisted("format.minify", false);
  const sortKeys = persisted("format.sortKeys", false);
  const view = persisted<View>("format.view", "text");

  let treeQuery = $state("");

  // YAML은 JSON의 상위집합이라 순서가 중요: XML → JSON → YAML.
  function detect(src: string): Fmt | null {
    const s = src.trim();
    if (!s) return null;
    if (s.startsWith("<")) return "xml";
    try {
      JSON.parse(s);
      return "json";
    } catch {
      return "yaml";
    }
  }

  function parse(src: string, fmt: Fmt): unknown {
    if (fmt === "json") return JSON.parse(src);
    if (fmt === "yaml") return yamlLoad(src);
    const valid = XMLValidator.validate(src);
    if (valid !== true) throw new Error(`${valid.err.msg} (${valid.err.line}행)`);
    return new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: true,
    }).parse(src);
  }

  /** 키를 재귀로 정렬한다 — 두 응답을 텍스트 비교로 맞대기 전에 한 번 통과시키는 용도. */
  function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value === null || typeof value !== "object") return value;
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortDeep(src[key]);
    return out;
  }

  // XML은 루트 요소가 정확히 하나여야 한다 — 아니면 root로 감싼다.
  function toXmlInput(value: unknown): Record<string, unknown> {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1
    )
      return value as Record<string, unknown>;
    return { root: value };
  }

  function serialize(value: unknown, fmt: Fmt): string {
    if (value === undefined) return "";
    if (fmt === "json") return JSON.stringify(value, null, minify.current ? 0 : indent.current) ?? "";
    if (fmt === "yaml") return yamlDump(value, { indent: indent.current, lineWidth: 120, noRefs: true });
    return new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: !minify.current,
      indentBy: " ".repeat(indent.current),
      suppressBooleanAttributes: false,
    }).build(toXmlInput(value));
  }

  const detected = $derived(detect(input.current));
  const target = $derived(outFmt.current ?? detected ?? "json");

  // 파싱과 직렬화를 갈라 둔다 — 트리는 값을, 텍스트는 문자열을 본다.
  const parsed = $derived.by(() => {
    if (!detected) return { value: undefined as unknown, error: null as string | null };
    try {
      const value = parse(input.current.trim(), detected);
      return { value: sortKeys.current ? sortDeep(value) : value, error: null };
    } catch (e) {
      return { value: undefined as unknown, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const result = $derived.by(() => {
    if (parsed.error || !detected) return { text: "", error: parsed.error };
    try {
      return { text: serialize(parsed.value, target), error: null as string | null };
    } catch (e) {
      return { text: "", error: e instanceof Error ? e.message : String(e) };
    }
  });

  const treeable = $derived(
    !parsed.error && parsed.value !== undefined && typeof parsed.value === "object" && parsed.value !== null,
  );
  const search = $derived(treeable ? searchTree(parsed.value, treeQuery) : null);

  function copyPath(path: string) {
    void navigator.clipboard.writeText(path);
  }
</script>

<div class="tool">
  <div class="t-controls">
    <span class="t-label">
      {detected ? t.format.detected(FMT_LABEL[detected]) : t.format.detectedNone}
    </span>
    <span class="t-label">{t.format.outFormat}</span>
    <div class="t-chiprow" role="group" aria-label={t.format.outFormat}>
      {#each ["json", "yaml", "xml"] as const as fmt (fmt)}
        <button
          class="t-chip"
          class:active={target === fmt}
          aria-pressed={target === fmt}
          onclick={() => (outFmt.current = fmt)}
        >
          {FMT_LABEL[fmt]}
        </button>
      {/each}
    </div>
    <label class="t-label" for="fmt-indent">{t.format.indent}</label>
    <select id="fmt-indent" class="t-select" bind:value={indent.current}>
      <option value={2}>{t.format.indent2}</option>
      <option value={4}>{t.format.indent4}</option>
    </select>
    {#if target !== "yaml"}
      <label class="t-checkrow">
        <input type="checkbox" bind:checked={minify.current} />
        {t.format.minify}
      </label>
    {/if}
    <label class="t-checkrow">
      <input type="checkbox" bind:checked={sortKeys.current} />
      {t.format.sortKeys}
    </label>
  </div>

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.common.input}</span></div>
      <textarea
        class="t-textarea"
        bind:value={input.current}
        placeholder={t.format.placeholder}
        spellcheck="false"
      ></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head">
        <span class="t-label">{t.common.output}</span>
        <div class="t-chiprow" role="group" aria-label={t.common.output}>
          <button
            class="t-chip"
            class:active={view.current === "text"}
            aria-pressed={view.current === "text"}
            onclick={() => (view.current = "text")}
          >
            {t.format.viewText}
          </button>
          <button
            class="t-chip"
            class:active={view.current === "tree"}
            aria-pressed={view.current === "tree"}
            onclick={() => (view.current = "tree")}
          >
            {t.format.viewTree}
          </button>
        </div>
        <CopyButton text={result.text} />
      </div>

      {#if view.current === "tree"}
        <div class="treebox">
          <div class="treebar">
            <div class="search">
              <Icon name="search" size={13} />
              <input
                type="search"
                bind:value={treeQuery}
                placeholder={t.format.treeSearch}
                aria-label={t.format.treeSearch}
                spellcheck="false"
              />
            </div>
            {#if search}
              <span class="t-label count">
                {search.count ? t.format.treeMatches(search.count) : t.format.treeNoMatch}
              </span>
            {/if}
          </div>
          <div class="tree">
            {#if treeable}
              <JsonTree value={parsed.value} {search} onpath={copyPath} />
            {:else if !parsed.error && input.current.trim()}
              <p class="t-note">{t.format.treeOnlyJson}</p>
            {/if}
          </div>
          {#if search?.capped}
            <p class="t-note">{t.format.treeCapped}</p>
          {/if}
        </div>
      {:else}
        <textarea class="t-textarea" readonly value={result.text} spellcheck="false"></textarea>
      {/if}
    </div>
  </div>

  {#if result.error}
    <p class="t-error">{result.error}</p>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .treebox {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    flex: 1;
    min-height: 240px;
  }
  .treebar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .search {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2xs);
    min-width: 0;
    padding: 4px var(--space-sm);
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-family: inherit;
    font-size: var(--text-md);
    color: var(--text);
    outline: none;
  }
  .count {
    flex: none;
  }

  .tree {
    flex: 1;
    min-height: 200px;
    padding: var(--space-sm);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: auto;
  }
</style>
