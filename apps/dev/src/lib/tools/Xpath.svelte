<script lang="ts">
  import { t } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  let xml = $state("");
  let expr = $state("");

  const CAP = 200;

  const parsed = $derived.by(() => {
    const src = xml.trim();
    if (!src) return null;
    const doc = new DOMParser().parseFromString(src, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      return { doc: null, error: t.xpath.invalidXml };
    return { doc, error: null };
  });

  // XPath 1.0은 기본 네임스페이스를 무접두사 이름에 묶어 주지 않는다 — 안내만 하고 접두사는 문서에서 해석
  const hasDefaultNs = $derived(
    !!parsed?.doc && !!parsed.doc.documentElement.namespaceURI && !parsed.doc.documentElement.prefix,
  );

  interface NodeRow {
    label: string;
    text: string;
  }
  interface EvalResult {
    kind: "nodes" | "value" | "error" | null;
    nodes: NodeRow[];
    capped: boolean;
    value: string;
    error: string;
  }

  function describe(node: Node): NodeRow {
    if (node.nodeType === Node.ELEMENT_NODE) {
      let text = new XMLSerializer().serializeToString(node);
      if (text.length > 500) text = `${text.slice(0, 500)}…`;
      return { label: `<${(node as Element).tagName}>`, text };
    }
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      const a = node as Attr;
      return { label: `@${a.name}`, text: `${a.name}="${a.value}"` };
    }
    return { label: node.nodeName, text: node.textContent?.trim() ?? "" };
  }

  const result = $derived.by((): EvalResult => {
    const empty: EvalResult = { kind: null, nodes: [], capped: false, value: "", error: "" };
    if (!parsed?.doc || !expr.trim()) return empty;
    const doc = parsed.doc;
    try {
      const r = doc.evaluate(
        expr,
        doc,
        (prefix) => (prefix ? doc.documentElement.lookupNamespaceURI(prefix) : null),
        XPathResult.ANY_TYPE,
        null,
      );
      if (r.resultType === XPathResult.NUMBER_TYPE)
        return { ...empty, kind: "value", value: String(r.numberValue) };
      if (r.resultType === XPathResult.STRING_TYPE)
        return { ...empty, kind: "value", value: r.stringValue };
      if (r.resultType === XPathResult.BOOLEAN_TYPE)
        return { ...empty, kind: "value", value: String(r.booleanValue) };
      const nodes: NodeRow[] = [];
      let capped = false;
      for (let n = r.iterateNext(); n; n = r.iterateNext()) {
        if (nodes.length >= CAP) {
          capped = true;
          break;
        }
        nodes.push(describe(n));
      }
      return { ...empty, kind: "nodes", nodes, capped };
    } catch {
      return { ...empty, kind: "error", error: t.xpath.invalidExpr };
    }
  });
</script>

<div class="tool">
  <div class="exprrow">
    <label class="t-label" for="xpath-expr">{t.xpath.expr}</label>
    <input
      id="xpath-expr"
      class="expr"
      type="text"
      bind:value={expr}
      placeholder={t.xpath.exprPlaceholder}
      spellcheck="false"
      autocomplete="off"
    />
  </div>

  <div class="t-panes">
    <div class="t-pane">
      <div class="t-pane-head"><span class="t-label">XML</span></div>
      <textarea
        class="t-textarea"
        bind:value={xml}
        placeholder={t.xpath.xmlPlaceholder}
        spellcheck="false"
      ></textarea>
    </div>
    <div class="t-pane">
      <div class="t-pane-head">
        <span class="t-label">
          {#if result.kind === "nodes"}
            {result.nodes.length ? t.xpath.matches(result.nodes.length) : t.xpath.noMatch}
          {:else}
            {t.xpath.result}
          {/if}
        </span>
        {#if result.kind === "nodes" && result.nodes.length}
          <CopyButton text={result.nodes.map((n) => n.text).join("\n")} />
        {:else if result.kind === "value"}
          <CopyButton text={result.value} />
        {/if}
      </div>
      <div class="out">
        {#if parsed?.error}
          <p class="t-error inout">{parsed.error}</p>
        {:else if result.kind === "error"}
          <p class="t-error inout">{result.error}</p>
        {:else if result.kind === "value"}
          <pre class="single">{result.value}</pre>
        {:else if result.kind === "nodes"}
          {#each result.nodes as n, i (i)}
            <div class="node">
              <span class="nlabel">{n.label}</span>
              <pre class="ntext">{n.text}</pre>
            </div>
          {/each}
          {#if result.capped}
            <p class="t-note">{t.xpath.capped}</p>
          {/if}
        {/if}
      </div>
    </div>
  </div>

  {#if hasDefaultNs}
    <p class="t-note">{t.xpath.defaultNsNote}</p>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .exprrow {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .expr {
    flex: 1;
    padding: 8px 12px;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .expr::placeholder {
    color: var(--text-muted);
    opacity: 0.7;
  }
  .out {
    flex: 1;
    min-height: 240px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: auto;
  }
  .inout {
    margin: 0;
  }
  .single {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .node {
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .nlabel {
    display: block;
    margin-bottom: 3px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--accent-ink);
  }
  .ntext {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
