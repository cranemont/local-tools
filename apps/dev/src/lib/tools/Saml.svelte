<script lang="ts">
  import { t, fmtDateTime, fmtRelative } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  let input = $state("");

  interface KV {
    key: string;
    value: string;
    chip?: { label: string; bad: boolean };
  }
  interface Summary {
    binding: string;
    rows: KV[];
    attrs: { name: string; values: string[] }[];
    notes: string[];
  }
  interface Result {
    xml: string;
    summary: Summary | null;
    error: string | null;
  }

  let result = $state<Result | null>(null);
  let seq = 0;

  $effect(() => {
    const raw = input.trim();
    const id = ++seq;
    if (!raw) {
      result = null;
      return;
    }
    decode(raw).then(
      (r) => {
        if (seq === id) result = r;
      },
      () => {
        if (seq === id) result = { xml: "", summary: null, error: t.saml.invalid };
      },
    );
  });

  async function inflate(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decode(raw: string): Promise<Result> {
    // URL·폼 본문에서 파라미터 값만 추출
    const m = /SAML(?:Request|Response)=([^&\s]+)/i.exec(raw);
    let val = m ? m[1] : raw;
    if (/%[0-9a-fA-F]{2}/.test(val)) {
      try {
        val = decodeURIComponent(val);
      } catch {
        /* 인코딩이 깨져 있으면 원문 그대로 시도 */
      }
    }
    val = val.trim();

    let xmlText: string | null = null;
    let binding: string = t.saml.bindingXml;
    if (val.startsWith("<")) {
      xmlText = val;
    } else {
      const b64 = val.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
      let bytes: Uint8Array;
      try {
        const pad = b64.length % 4 ? b64 + "=".repeat(4 - (b64.length % 4)) : b64;
        bytes = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
      } catch {
        return { xml: "", summary: null, error: t.saml.invalid };
      }
      if (bytes[0] === 0x3c) {
        xmlText = new TextDecoder().decode(bytes);
        binding = t.saml.bindingPost;
      } else {
        // Redirect 바인딩은 raw DEFLATE — zlib 헤더가 붙은 변종도 허용
        for (const fmt of ["deflate-raw", "deflate"] as const) {
          try {
            xmlText = new TextDecoder().decode(await inflate(bytes, fmt));
            binding = t.saml.bindingRedirect;
            break;
          } catch {
            /* 다음 포맷 시도 */
          }
        }
        if (xmlText === null) return { xml: "", summary: null, error: t.saml.invalid };
      }
    }

    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      return { xml: xmlText, summary: null, error: t.saml.invalidXml };
    return { xml: prettyXml(doc.documentElement), summary: summarize(doc, binding), error: null };
  }

  // ── 표시용 XML 정리 (원문 보존이 목적이라 라이브러리 재직렬화 대신 DOM 그대로) ──

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function prettyXml(el: Element, depth = 0): string {
    const pad = "  ".repeat(depth);
    const attrs = Array.from(el.attributes)
      .map((a) => ` ${a.name}="${esc(a.value).replace(/"/g, "&quot;")}"`)
      .join("");
    const kids = Array.from(el.childNodes).filter(
      (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent?.trim()),
    );
    if (!kids.length) return `${pad}<${el.tagName}${attrs}/>`;
    if (kids.length === 1 && kids[0].nodeType === 3)
      return `${pad}<${el.tagName}${attrs}>${esc(kids[0].textContent!.trim())}</${el.tagName}>`;
    const inner = kids
      .map((k) =>
        k.nodeType === 1
          ? prettyXml(k as Element, depth + 1)
          : `${"  ".repeat(depth + 1)}${esc(k.textContent!.trim())}`,
      )
      .join("\n");
    return `${pad}<${el.tagName}${attrs}>\n${inner}\n${pad}</${el.tagName}>`;
  }

  // ── 요약 ──

  const stripUrn = (s: string) => s.replace(/^urn:oasis:names:tc:SAML:[\d.]+:[a-z-]+:/, "");

  function summarize(doc: Document, binding: string): Summary {
    const root = doc.documentElement;
    const all = (name: string) => Array.from(doc.getElementsByTagNameNS("*", name));
    const first = (name: string) => all(name)[0] ?? null;
    const rows: KV[] = [];
    const notes: string[] = [];

    const typeDesc = t.saml.typeLabel[root.localName];
    rows.push({ key: root.localName, value: typeDesc ?? "", chip: undefined });

    const issuer = first("Issuer")?.textContent?.trim();
    if (issuer) rows.push({ key: "Issuer", value: issuer });
    const dest = root.getAttribute("Destination");
    if (dest) rows.push({ key: "Destination", value: dest });
    const instant = root.getAttribute("IssueInstant");
    if (instant && !Number.isNaN(Date.parse(instant)))
      rows.push({ key: "IssueInstant", value: fmtDateTime(Date.parse(instant)) });
    const inResponseTo = root.getAttribute("InResponseTo");
    if (inResponseTo) rows.push({ key: "InResponseTo", value: inResponseTo });

    const status = first("StatusCode")?.getAttribute("Value");
    if (status) {
      const short = stripUrn(status);
      rows.push({
        key: "Status",
        value: short,
        chip: short === "Success" ? { label: t.saml.valid, bad: false } : undefined,
      });
    }

    const nameId = first("NameID");
    if (nameId?.textContent?.trim()) {
      const fmt = nameId.getAttribute("Format");
      rows.push({
        key: "NameID",
        value: nameId.textContent.trim() + (fmt ? ` (${stripUrn(fmt)})` : ""),
      });
    }

    const cond = first("Conditions");
    if (cond) {
      const nb = cond.getAttribute("NotBefore");
      const na = cond.getAttribute("NotOnOrAfter");
      const nbMs = nb ? Date.parse(nb) : null;
      const naMs = na ? Date.parse(na) : null;
      let chip: KV["chip"];
      const now = Date.now();
      if (naMs !== null && now >= naMs) chip = { label: t.saml.expired, bad: true };
      else if (nbMs !== null && now < nbMs) chip = { label: t.saml.notYet, bad: true };
      else if (nbMs !== null || naMs !== null) chip = { label: t.saml.valid, bad: false };
      const parts = [
        nbMs !== null && !Number.isNaN(nbMs) ? fmtDateTime(nbMs) : "—",
        naMs !== null && !Number.isNaN(naMs) ? `${fmtDateTime(naMs)} (${fmtRelative(naMs)})` : "—",
      ];
      rows.push({ key: t.saml.validity, value: parts.join(" ~ "), chip });
    }

    const audience = first("Audience")?.textContent?.trim();
    if (audience) rows.push({ key: "Audience", value: audience });

    const sigParents = all("Signature")
      .map((s) => s.parentElement?.localName)
      .filter((n): n is string => !!n);
    rows.push({
      key: t.saml.signature,
      value: sigParents.length ? sigParents.join(" · ") : t.saml.signatureNone,
    });
    if (sigParents.length) notes.push(t.saml.signatureNote);
    if (all("EncryptedAssertion").length) notes.push(t.saml.encryptedNote);

    const attrs = all("Attribute")
      .filter((a) => a.getAttribute("Name"))
      .map((a) => ({
        name: a.getAttribute("Name")!,
        values: Array.from(a.getElementsByTagNameNS("*", "AttributeValue")).map(
          (v) => v.textContent?.trim() ?? "",
        ),
      }));

    return { binding, rows, attrs, notes };
  }
</script>

<div class="tool">
  <textarea
    class="t-textarea in"
    bind:value={input}
    placeholder={t.saml.placeholder}
    spellcheck="false"
  ></textarea>

  {#if result?.error}
    <p class="t-error">{result.error}</p>
  {/if}

  {#if result?.summary}
    <div class="body">
      <div class="card">
        <div class="head">
          <span class="t-label">{t.saml.summary}</span>
          <span class="binding">{result.summary.binding}</span>
        </div>
        <div class="kvs">
          {#each result.summary.rows as row, i (i)}
            <div class="kv">
              <span class="k">{row.key}</span>
              <span class="v">
                {row.value}
                {#if row.chip}
                  <span class="chip" class:bad={row.chip.bad}>{row.chip.label}</span>
                {/if}
              </span>
            </div>
          {/each}
        </div>
        {#each result.summary.notes as note, i (i)}
          <p class="t-note">{note}</p>
        {/each}
        {#if result.summary.attrs.length}
          <div class="attrs">
            <span class="t-label">{t.saml.attributes}</span>
            <table>
              <tbody>
                {#each result.summary.attrs as a, i (i)}
                  <tr>
                    <td><code>{a.name}</code></td>
                    <td class="av">{a.values.join(" · ")}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <div class="t-pane xmlpane">
        <div class="t-pane-head">
          <span class="t-label">{t.saml.xml}</span>
          <CopyButton text={result.xml} />
        </div>
        <pre class="xml">{result.xml}</pre>
      </div>
    </div>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .in {
    flex: none;
    min-height: 100px;
    margin-bottom: 12px;
    word-break: break-all;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: auto;
  }
  .card {
    flex: none;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .binding {
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .kvs {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .kv {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 10px;
    font-size: 13px;
  }
  .k {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    padding-top: 1px;
  }
  .v {
    word-break: break-all;
  }
  .chip {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .chip.bad {
    background: color-mix(in oklab, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .attrs {
    margin-top: 10px;
  }
  table {
    width: 100%;
    margin-top: 4px;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  td {
    padding: 4px 10px 4px 0;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  td code {
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
  }
  .av {
    word-break: break-all;
  }
  .xmlpane {
    flex: none;
  }
  .xml {
    margin: 0;
    padding: 12px;
    max-height: 420px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: auto;
  }
</style>
