<script lang="ts">
  /** 암호가 걸린 한글 문서 — 엔진이 비밀번호와 함께 다시 열어 준다.
   * 비밀번호는 wasm 안으로만 들어가고 어디에도 저장하지 않는다. */
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { editor } from "./state.svelte";

  let password = $state("");
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    input?.focus();
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!password) return;
    void editor.unlock(password);
    password = "";
  }
</script>

<div class="wrap">
  <form class="card" onsubmit={submit}>
    <Icon name="lock" size={28} />
    <h2>{t.password.title}</h2>
    {#if editor.wrongPassword}
      <p>{t.password.wrong}</p>
    {/if}

    <input
      bind:this={input}
      bind:value={password}
      type="password"
      autocomplete="off"
      aria-label={t.password.label}
      placeholder={t.password.label}
    />

    <div class="row">
      <button type="button" class="btn" onclick={() => editor.close()}>{t.password.cancel}</button>
      <button type="submit" class="btn primary" disabled={!password}>{t.password.submit}</button>
    </div>
  </form>
</div>

<style>
  .wrap {
    flex: 1;
    display: grid;
    place-items: center;
    padding: var(--space-lg);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
    width: min(420px, 100%);
    padding: var(--space-xl) var(--space-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    text-align: center;
    color: var(--text-muted);
  }
  .card :global(.icon) {
    color: var(--accent-ink);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--text);
  }
  p {
    margin: 0;
    font-size: var(--text-sm);
  }

  input {
    width: 100%;
    padding: var(--space-2xs) var(--space-xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-base);
  }

  .row {
    display: flex;
    gap: var(--space-2xs);
    margin-top: var(--space-2xs);
  }
</style>
