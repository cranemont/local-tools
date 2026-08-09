<script lang="ts">
  import { t, fmtDateTime, fmtRelative } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  let input = $state("");
  let secret = $state("");
  let verified = $state<"ok" | "fail" | null>(null);

  function b64urlToBytes(s: string): Uint8Array {
    let v = s.replace(/-/g, "+").replace(/_/g, "/");
    if (v.length % 4) v += "=".repeat(4 - (v.length % 4));
    const bin = atob(v);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  function decodePart(s: string): unknown {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlToBytes(s)));
  }

  interface Decoded {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    alg: string;
  }

  const decoded = $derived.by((): { jwt: Decoded | null; error: string | null } => {
    const token = input.trim();
    if (!token) return { jwt: null, error: null };
    const parts = token.split(".");
    if (parts.length !== 3) return { jwt: null, error: t.jwt.invalid };
    try {
      const header = decodePart(parts[0]) as Record<string, unknown>;
      const payload = decodePart(parts[1]) as Record<string, unknown>;
      if (typeof header !== "object" || header === null) throw new Error();
      return { jwt: { header, payload, alg: String(header.alg ?? "") }, error: null };
    } catch {
      return { jwt: null, error: t.jwt.invalid };
    }
  });

  // 시간 클레임 (exp·iat·nbf) 요약
  const claims = $derived.by(() => {
    const payload = decoded.jwt?.payload;
    if (!payload) return [];
    const rows: { key: string; ms: number; status?: { label: string; bad: boolean } }[] = [];
    for (const key of ["exp", "iat", "nbf"]) {
      const v = payload[key];
      if (typeof v !== "number") continue;
      const ms = v * 1000;
      let status: { label: string; bad: boolean } | undefined;
      if (key === "exp")
        status =
          ms < Date.now() ? { label: t.jwt.expExpired, bad: true } : { label: t.jwt.expValid, bad: false };
      if (key === "nbf" && ms > Date.now()) status = { label: t.jwt.nbfPending, bad: true };
      rows.push({ key, ms, status });
    }
    return rows;
  });

  const hsAlg = $derived.by(() => {
    const alg = decoded.jwt?.alg ?? "";
    const m = /^HS(256|384|512)$/.exec(alg);
    return m ? `SHA-${m[1]}` : null;
  });

  async function verify() {
    const token = input.trim();
    const parts = token.split(".");
    if (!hsAlg || parts.length !== 3) return;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: hsAlg },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(parts[2]) as BufferSource,
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    verified = ok ? "ok" : "fail";
  }

  $effect(() => {
    // 토큰이나 비밀키가 바뀌면 이전 검증 결과는 무효
    void input;
    void secret;
    verified = null;
  });

  const pretty = (v: unknown) => JSON.stringify(v, null, 2);
</script>

<div class="tool">
  <textarea
    class="t-textarea token"
    bind:value={input}
    placeholder={t.jwt.placeholder}
    spellcheck="false"
  ></textarea>

  {#if decoded.error}
    <p class="t-error">{decoded.error}</p>
  {:else if decoded.jwt}
    <div class="t-panes">
      <div class="t-pane">
        <div class="t-pane-head">
          <span class="t-label">{t.jwt.header}</span>
          <CopyButton text={pretty(decoded.jwt.header)} />
        </div>
        <pre class="json">{pretty(decoded.jwt.header)}</pre>
      </div>
      <div class="t-pane">
        <div class="t-pane-head">
          <span class="t-label">{t.jwt.payload}</span>
          <CopyButton text={pretty(decoded.jwt.payload)} />
        </div>
        <pre class="json">{pretty(decoded.jwt.payload)}</pre>
      </div>
    </div>

    {#if claims.length}
      <div class="claims">
        <span class="t-label">{t.jwt.claims}</span>
        {#each claims as row (row.key)}
          <div class="claim">
            <code class="key">{row.key}</code>
            <span>{fmtDateTime(row.ms)}</span>
            <span class="muted">{fmtRelative(row.ms)}</span>
            {#if row.status}
              <span class="status" class:bad={row.status.bad}>{row.status.label}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <div class="verify">
      {#if hsAlg}
        <input
          class="secret"
          type="text"
          bind:value={secret}
          placeholder={t.jwt.secret}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="btn" onclick={verify} disabled={!secret}>{t.jwt.verify}</button>
        {#if verified === "ok"}<span class="status">{t.jwt.verifyOk}</span>{/if}
        {#if verified === "fail"}<span class="status bad">{t.jwt.verifyFail}</span>{/if}
        <span class="muted note">{t.jwt.secretNote}</span>
      {:else if decoded.jwt.alg}
        <span class="muted note">{t.jwt.verifyUnsupported(decoded.jwt.alg)}</span>
      {/if}
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
  .token {
    min-height: 96px;
    margin-bottom: 12px;
    word-break: break-all;
  }
  .json {
    margin: 0;
    padding: 12px;
    flex: 1;
    min-height: 160px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: auto;
  }
  .claims {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
  }
  .claim {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .key {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    padding: 2px 7px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .muted {
    color: var(--text-muted);
    font-size: 12.5px;
  }
  .status {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .status.bad {
    background: color-mix(in oklab, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .verify {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }
  .secret {
    flex: 0 1 280px;
    padding: 7px 10px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .btn {
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent-contrast);
    background: var(--accent);
    border: 0;
    border-radius: 999px;
  }
  .btn:hover:enabled {
    background: var(--accent-hover);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
