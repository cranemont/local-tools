<script lang="ts">
  import { t, fmtDateTime, fmtRelative } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  let input = $state("");

  const ATTR_KEYS = new Set([
    "domain",
    "path",
    "expires",
    "max-age",
    "samesite",
    "secure",
    "httponly",
    "partitioned",
    "priority",
  ]);
  const SAMESITE_OK = new Set(["strict", "lax", "none"]);
  const MAX_BYTES = 4096; // 크롬 이름+값 상한
  const MAX_AGE_CAP_S = 400 * 86400; // 크롬 만료 상한 400일(초)

  interface Issue {
    bad: boolean;
    msg: string;
  }
  interface SetCookie {
    name: string;
    value: string;
    attrs: { key: string; value: string | null }[];
    expiresMs: number | null;
    size: number;
    issues: Issue[];
  }
  interface Pair {
    name: string;
    value: string;
    size: number;
  }

  const byteLen = (s: string) => new TextEncoder().encode(s).length;

  function splitPair(seg: string): { name: string; value: string } {
    const i = seg.indexOf("=");
    if (i < 0) return { name: seg.trim(), value: "" };
    return { name: seg.slice(0, i).trim(), value: seg.slice(i + 1).trim() };
  }

  function parseSetCookie(segs: string[]): SetCookie {
    const { name, value } = splitPair(segs[0]);
    const attrs = segs.slice(1).map((seg) => {
      const i = seg.indexOf("=");
      if (i < 0) return { key: seg.trim(), value: null };
      return { key: seg.slice(0, i).trim(), value: seg.slice(i + 1).trim() };
    });
    const get = (k: string) => attrs.find((a) => a.key.toLowerCase() === k)?.value ?? null;
    const has = (k: string) => attrs.some((a) => a.key.toLowerCase() === k);

    const secure = has("secure");
    const sameSite = get("samesite");
    const domain = get("domain");
    const path = get("path");
    const maxAgeRaw = get("max-age");
    const expiresRaw = get("expires");

    // Max-Age가 Expires보다 우선한다 (RFC 6265)
    let expiresMs: number | null = null;
    let maxAgeSec: number | null = null;
    if (maxAgeRaw !== null && /^-?\d+$/.test(maxAgeRaw)) {
      maxAgeSec = Number(maxAgeRaw);
      expiresMs = Date.now() + maxAgeSec * 1000;
    } else if (expiresRaw !== null) {
      const ms = Date.parse(expiresRaw);
      if (!Number.isNaN(ms)) expiresMs = ms;
    }

    const size = byteLen(`${name}=${value}`);
    const issues: Issue[] = [];
    if (sameSite !== null && !SAMESITE_OK.has(sameSite.toLowerCase()))
      issues.push({ bad: true, msg: t.cookie.issues.badSameSite(sameSite) });
    if (sameSite?.toLowerCase() === "none" && !secure)
      issues.push({ bad: true, msg: t.cookie.issues.sameSiteNone });
    if (name.startsWith("__Secure-") && !secure)
      issues.push({ bad: true, msg: t.cookie.issues.securePrefix });
    if (name.startsWith("__Host-") && (!secure || path !== "/" || domain !== null))
      issues.push({ bad: true, msg: t.cookie.issues.hostPrefix });
    if (size > MAX_BYTES) issues.push({ bad: true, msg: t.cookie.issues.tooBig });
    if (sameSite === null) issues.push({ bad: false, msg: t.cookie.issues.noSameSite });
    if (
      (maxAgeSec !== null && maxAgeSec > MAX_AGE_CAP_S) ||
      (maxAgeSec === null && expiresMs !== null && expiresMs - Date.now() > MAX_AGE_CAP_S * 1000)
    )
      issues.push({ bad: false, msg: t.cookie.issues.longExpiry });

    return { name, value, attrs, expiresMs, size, issues };
  }

  const parsed = $derived.by(() => {
    const setCookies: SetCookie[] = [];
    const pairs: Pair[] = [];
    for (const rawLine of input.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const setM = /^set-cookie\s*:\s*/i.exec(line);
      const reqM = setM ? null : /^cookie\s*:\s*/i.exec(line);
      const body = line.slice((setM ?? reqM)?.[0].length ?? 0);
      const segs = body
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!segs.length) continue;
      // 접두사가 없으면 속성 이름 존재 여부로 Set-Cookie/요청 쿠키를 가른다
      const looksSet =
        setM !== null ||
        (!reqM && segs.slice(1).some((s) => ATTR_KEYS.has(splitPair(s).name.toLowerCase())));
      if (looksSet) setCookies.push(parseSetCookie(segs));
      else
        for (const seg of segs) {
          const p = splitPair(seg);
          pairs.push({ ...p, size: byteLen(`${p.name}=${p.value}`) });
        }
    }
    return { setCookies, pairs };
  });

  const pairTotal = $derived(parsed.pairs.reduce((sum, p) => sum + p.size, 0));
  const nothing = $derived(
    input.trim() !== "" && !parsed.setCookies.length && !parsed.pairs.length,
  );
</script>

<div class="tool">
  <textarea
    class="t-textarea in"
    bind:value={input}
    placeholder={t.cookie.placeholder}
    spellcheck="false"
  ></textarea>

  {#if nothing}
    <p class="t-error">{t.cookie.invalid}</p>
  {/if}

  <div class="cards">
    {#each parsed.setCookies as c, i (i)}
      <div class="card">
        <div class="head">
          <code class="name">{c.name || "—"}</code>
          <span class="muted">{c.size} bytes</span>
          <CopyButton text={`${c.name}=${c.value}`} />
        </div>
        <div class="value">{c.value || "—"}</div>
        {#if c.attrs.length}
          <div class="attrs">
            {#each c.attrs as a, j (j)}
              <span class="attr">{a.value === null ? a.key : `${a.key}=${a.value}`}</span>
            {/each}
          </div>
        {/if}
        <div class="expiry">
          <span class="k">{t.cookie.expiry}</span>
          {#if c.expiresMs === null}
            <span class="chip">{t.cookie.session}</span>
          {:else if c.expiresMs <= Date.now()}
            <span>{fmtDateTime(c.expiresMs)}</span>
            <span class="chip bad">{t.cookie.deletion}</span>
          {:else}
            <span>{fmtDateTime(c.expiresMs)}</span>
            <span class="muted">{fmtRelative(c.expiresMs)}</span>
          {/if}
        </div>
        {#if c.issues.length}
          <ul class="issues">
            {#each c.issues as issue, j (j)}
              <li class:bad={issue.bad}>{issue.msg}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    {#if parsed.pairs.length}
      <div class="card">
        <div class="head">
          <span class="t-label">{t.cookie.reqHeader}</span>
          <span class="muted">{t.cookie.reqSummary(parsed.pairs.length, pairTotal)}</span>
        </div>
        <table>
          <tbody>
            {#each parsed.pairs as p, i (i)}
              <tr>
                <td><code class="name">{p.name || "—"}</code></td>
                <td class="pv">{p.value}</td>
                <td class="muted num">{p.size} B</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
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
    min-height: 120px;
    margin-bottom: 12px;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: auto;
    min-height: 0;
  }
  .card {
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head :global(button) {
    margin-left: auto;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
  }
  .value {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--text-muted);
    word-break: break-all;
    max-height: 60px;
    overflow: auto;
  }
  .attrs {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }
  .attr {
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    word-break: break-all;
  }
  .expiry {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    font-size: 12.5px;
  }
  .k {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .chip {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .chip.bad {
    background: color-mix(in oklab, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .issues {
    margin: 8px 0 0;
    padding: 0 0 0 18px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .issues li.bad {
    color: var(--danger);
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  table {
    width: 100%;
    margin-top: 8px;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  td {
    padding: 4px 10px 4px 0;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  .pv {
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
  }
  .num {
    text-align: right;
    white-space: nowrap;
    padding-right: 0;
  }
</style>
