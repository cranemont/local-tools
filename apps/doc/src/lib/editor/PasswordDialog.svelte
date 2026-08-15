<script lang="ts">
  /** 암호가 걸린 한글 문서 — 엔진이 비밀번호와 함께 다시 열어 준다.
   * 비밀번호는 wasm 안으로만 들어가고 어디에도 저장하지 않는다.
   *
   * 문서 하나를 열 때와 일괄 변환 중 한 파일이 잠겼을 때가 같은 물음이라 한 벌만 둔다.
   * 다른 것은 취소가 무엇을 뜻하는가뿐이다 — 하나일 땐 닫기, 일괄일 땐 그 파일만 건너뛰기.
   */
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";

  let {
    wrong,
    submit,
    cancel,
    cancelLabel = t.password.cancel,
    fileName = null,
  }: {
    /** 한 번 틀렸는가 — 문구가 달라진다 */
    wrong: boolean;
    submit: (password: string) => void;
    cancel: () => void;
    cancelLabel?: string;
    /** 일괄 변환에서 지금 묻고 있는 파일. 하나만 열 때는 없다(이미 위에 떠 있다). */
    fileName?: string | null;
  } = $props();

  let password = $state("");
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    input?.focus();
  });

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    if (!password) return;
    submit(password);
    password = "";
  }

  /**
   * Esc는 취소와 같다 — 일괄 변환에서는 이 물음이 목록 위를 덮고 있어서, 빠져나갈 길이
   * 버튼 하나뿐이면 갇힌 것처럼 느껴진다. 셸의 단축키는 `ready` 단계에서만 도므로 겹치지 않는다.
   */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="wrap">
  <form class="card" onsubmit={onSubmit}>
    <Icon name="lock" size={28} />
    <h2>{t.password.title}</h2>
    {#if fileName}
      <p class="file" title={fileName}>{fileName}</p>
    {/if}
    {#if wrong}
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
      <button type="button" class="btn" onclick={cancel}>{cancelLabel}</button>
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
  .file {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-weight: 600;
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
