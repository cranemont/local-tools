<script lang="ts">
  import { t } from "../i18n";
  import CopyButton from "../CopyButton.svelte";

  type Mode = "url" | "pkce";
  let mode = $state<Mode>("url");
  let input = $state("");

  interface Param {
    key: string;
    value: string;
    fromFragment: boolean;
  }

  function collect(qs: string, fromFragment: boolean): Param[] {
    const out: Param[] = [];
    for (const [key, value] of new URLSearchParams(qs)) out.push({ key, value, fromFragment });
    return out;
  }

  const parsed = $derived.by(() => {
    const raw = input.trim();
    if (!raw) return null;
    let params: Param[] = [];
    try {
      const u = new URL(raw);
      params = collect(u.search, false);
      const h = u.hash.replace(/^#/, "");
      if (h.includes("=")) params.push(...collect(h, true)); // 암시적 플로는 프래그먼트로 돌아온다
    } catch {
      if (!raw.includes("=")) return { params: [], kind: null, error: t.oauth.invalid };
      params = collect(raw.replace(/^[?#]/, ""), false);
    }
    if (!params.length) return { params, kind: null, error: t.oauth.invalid };
    const has = (k: string) => params.some((p) => p.key === k);
    let kind: string | null = null;
    if (has("error")) kind = t.oauth.kindError;
    else if (has("code") || has("access_token") || has("id_token")) kind = t.oauth.kindCallback;
    else if (has("response_type") || has("client_id")) kind = t.oauth.kindAuthz;
    return { params, kind, error: null };
  });

  const checks = $derived.by(() => {
    if (!parsed || parsed.error) return [];
    const get = (k: string) => parsed.params.find((p) => p.key === k)?.value;
    const out: { bad: boolean; msg: string }[] = [];
    if (get("client_secret") !== undefined) out.push({ bad: true, msg: t.oauth.checks.secretInUrl });
    const rt = get("response_type");
    if (rt?.split(" ").includes("token")) out.push({ bad: true, msg: t.oauth.checks.implicit });
    if (rt === "code" && get("code_challenge") === undefined)
      out.push({ bad: false, msg: t.oauth.checks.noPkce });
    if (get("code_challenge_method")?.toLowerCase() === "plain")
      out.push({ bad: false, msg: t.oauth.checks.plainMethod });
    return out;
  });

  const isJwt = (v: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v);

  // ── PKCE · state ──

  let pkce = $state<{ verifier: string; challenge: string; state: string; nonce: string } | null>(
    null,
  );

  function b64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  async function generate() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    pkce = {
      verifier,
      challenge: b64url(new Uint8Array(digest)),
      state: b64url(crypto.getRandomValues(new Uint8Array(16))),
      nonce: b64url(crypto.getRandomValues(new Uint8Array(16))),
    };
  }
  void generate();

  const pkceRows = $derived(
    pkce
      ? [
          { label: "code_verifier", value: pkce.verifier },
          { label: "code_challenge (S256)", value: pkce.challenge },
          { label: "state", value: pkce.state },
          { label: "nonce", value: pkce.nonce },
        ]
      : [],
  );
</script>

<div class="tool">
  <div class="t-controls">
    <div class="t-chiprow" role="group">
      <button class="t-chip" class:active={mode === "url"} onclick={() => (mode = "url")}>
        {t.oauth.modeUrl}
      </button>
      <button class="t-chip" class:active={mode === "pkce"} onclick={() => (mode = "pkce")}>
        {t.oauth.modePkce}
      </button>
    </div>
    {#if mode === "url" && parsed?.kind}
      <span class="kind">{parsed.kind}</span>
    {/if}
  </div>

  {#if mode === "url"}
    <textarea
      class="t-textarea in"
      bind:value={input}
      placeholder={t.oauth.placeholder}
      spellcheck="false"
    ></textarea>

    {#if parsed?.error}
      <p class="t-error">{parsed.error}</p>
    {:else if parsed}
      <div class="params">
        {#each parsed.params as p, i (i)}
          <div class="param">
            <div class="pkey">
              <code>{p.key}</code>
              {#if p.fromFragment}<span class="frag">{t.oauth.fragment}</span>{/if}
              <CopyButton text={p.value} />
            </div>
            {#if p.key === "scope"}
              <div class="scopes">
                {#each p.value.split(/\s+/).filter(Boolean) as s, j (j)}
                  <span class="scope">{s}</span>
                {/each}
              </div>
            {:else}
              <div class="pval">{p.value}</div>
            {/if}
            {#if t.oauth.paramDesc[p.key]}
              <div class="pdesc">
                {t.oauth.paramDesc[p.key]}{#if isJwt(p.value)}&nbsp;· {t.oauth.jwtHint}{/if}
              </div>
            {:else if isJwt(p.value)}
              <div class="pdesc">{t.oauth.jwtHint}</div>
            {/if}
          </div>
        {/each}
      </div>
      {#if checks.length}
        <ul class="issues">
          {#each checks as c, i (i)}
            <li class:bad={c.bad}>{c.msg}</li>
          {/each}
        </ul>
      {/if}
    {/if}
  {:else}
    <div class="rows">
      {#each pkceRows as row (row.label)}
        <div class="row">
          <span class="t-label">{row.label}</span>
          <div class="gen">
            <code>{row.value}</code>
            <CopyButton text={row.value} />
          </div>
        </div>
      {/each}
    </div>
    <div class="actions">
      <button class="btn" onclick={generate}>{t.oauth.generate}</button>
      <span class="t-note note">{t.oauth.pkceNote}</span>
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
  }
  .kind {
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .params {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    min-height: 0;
  }
  .param {
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .pkey {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pkey code {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
  }
  .pkey :global(button) {
    margin-left: auto;
  }
  .frag {
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 600;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .pval {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    word-break: break-all;
    max-height: 72px;
    overflow: auto;
  }
  .scopes {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 6px;
  }
  .scope {
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .pdesc {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .issues {
    margin: 10px 0 0;
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
  .rows {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .gen {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .gen code {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12.5px;
    word-break: break-all;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
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
  .btn:hover {
    background: var(--accent-hover);
  }
  .note {
    margin: 0;
  }
</style>
