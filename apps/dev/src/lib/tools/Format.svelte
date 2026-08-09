<script lang="ts">
  import { load as yamlLoad, dump as yamlDump } from "js-yaml";
  import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
  import { t } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  type Fmt = "json" | "yaml" | "xml";
  const FMT_LABEL: Record<Fmt, string> = { json: "JSON", yaml: "YAML", xml: "XML" };

  let input = $state("");
  let outFmt = $state<Fmt | null>(null); // null = 입력 형식 그대로(정리)
  let indent = $state(2);
  let minify = $state(false);

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
    if (fmt === "json") return JSON.stringify(value, null, minify ? 0 : indent) ?? "";
    if (fmt === "yaml") return yamlDump(value, { indent, lineWidth: 120, noRefs: true });
    return new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: !minify,
      indentBy: " ".repeat(indent),
      suppressBooleanAttributes: false,
    }).build(toXmlInput(value));
  }

  const detected = $derived(detect(input));
  const target = $derived(outFmt ?? detected ?? "json");

  const result = $derived.by(() => {
    if (!detected) return { text: "", error: null as string | null };
    try {
      return { text: serialize(parse(input.trim(), detected), target), error: null };
    } catch (e) {
      return { text: "", error: e instanceof Error ? e.message : String(e) };
    }
  });

  const xmlInvolved = $derived(
    detected !== null && detected !== target && (detected === "xml" || target === "xml"),
  );
</script>

<div class="tool">
  <div class="t-controls">
    <span class="t-label">{detected ? t.format.detected(FMT_LABEL[detected]) : t.format.detectedNone}</span>
    <span class="t-label">{t.format.outFormat}</span>
    <div class="t-chiprow" role="group" aria-label={t.format.outFormat}>
      {#each ["json", "yaml", "xml"] as const as fmt (fmt)}
        <button
          class="t-chip"
          class:active={target === fmt}
          aria-pressed={target === fmt}
          onclick={() => (outFmt = fmt)}
        >
          {FMT_LABEL[fmt]}
        </button>
      {/each}
    </div>
    <label class="t-label" for="fmt-indent">{t.format.indent}</label>
    <select id="fmt-indent" class="t-select" bind:value={indent}>
      <option value={2}>{t.format.indent2}</option>
      <option value={4}>{t.format.indent4}</option>
    </select>
    {#if target !== "yaml"}
      <label class="t-checkrow">
        <input type="checkbox" bind:checked={minify} />
        {t.format.minify}
      </label>
    {/if}
  </div>

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">{t.common.input}</span></div>
      <textarea
        class="t-textarea"
        bind:value={input}
        placeholder={t.format.placeholder}
        spellcheck="false"
      ></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head">
        <span class="t-label">{t.common.output}</span>
        <CopyButton text={result.text} />
      </div>
      <textarea class="t-textarea" readonly value={result.text} spellcheck="false"></textarea>
    </div>
  </div>

  {#if result.error}
    <p class="t-error">{result.error}</p>
  {:else if xmlInvolved}
    <p class="t-note">{t.format.xmlLossy}</p>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
