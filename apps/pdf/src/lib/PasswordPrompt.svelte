<script lang="ts">
  /** 암호가 걸린 PDF를 만났을 때 비밀번호를 묻는 창.
   * 비밀번호는 qpdf(wasm) 안으로만 들어가고 어디에도 저장하지 않는다. */
  import Icon from "./Icon.svelte";
  import { t } from "./i18n";
  import { unlockPrompt } from "./pdf/unlock.svelte";

  let password = $state("");
  let input = $state<HTMLInputElement | null>(null);

  // 창이 열릴 때마다 입력을 비우고 포커스를 준다.
  $effect(() => {
    if (unlockPrompt.open) {
      password = "";
      input?.focus();
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!password) return;
    const value = password;
    password = "";
    unlockPrompt.submit(value);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      unlockPrompt.cancel();
    }
  }
</script>

<svelte:window onkeydown={unlockPrompt.open ? onKeydown : undefined} />

{#if unlockPrompt.open}
  <div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
    <form class="card" onsubmit={submit}>
      <span class="badge"><Icon name="lock" size={22} /></span>
      <h2 id="unlock-title">{t.unlock.title}</h2>
      <p class="name" title={unlockPrompt.fileName}>{unlockPrompt.fileName}</p>
      <p class="body" class:wrong={unlockPrompt.wrong}>
        {unlockPrompt.wrong ? t.unlock.wrong : t.unlock.body}
      </p>

      <input
        bind:this={input}
        bind:value={password}
        type="password"
        autocomplete="off"
        aria-label={t.unlock.label}
        placeholder={t.unlock.label}
      />

      <div class="row">
        <button type="button" class="btn ghost" onclick={() => unlockPrompt.cancel()}>
          {t.unlock.cancel}
        </button>
        <button type="submit" class="btn primary" disabled={!password}>
          {t.unlock.submit}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: var(--space-lg);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(2px);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2xs);
    width: min(400px, 100%);
    padding: var(--space-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    text-align: center;
    color: var(--text-muted);
  }

  .badge {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-weak);
    color: var(--accent-ink);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--text);
  }
  .name {
    margin: 0;
    max-width: 100%;
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    margin: 0;
    font-size: var(--text-sm);
  }
  .body.wrong {
    color: var(--danger);
  }

  input {
    width: 100%;
    margin-top: var(--space-2xs);
    padding: var(--space-2xs) var(--space-xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-base);
    font-family: inherit;
  }
  input:focus {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }

  .row {
    display: flex;
    gap: var(--space-2xs);
    margin-top: var(--space-2xs);
  }
</style>
