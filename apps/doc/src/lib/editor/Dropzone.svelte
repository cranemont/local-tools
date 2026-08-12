<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { ACCEPT } from "../doc/detect";

  let { open }: { open: (file: File) => void } = $props();

  let input = $state<HTMLInputElement | null>(null);

  function pick(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) open(file);
    if (input) input.value = ""; // 같은 파일을 다시 골라도 열리게
  }
</script>

<div class="zone">
  <button class="target" onclick={() => input?.click()}>
    <Icon name="doc" size={40} />
    <span class="hint">{t.drop.hint}</span>
    <span class="sub">{t.drop.sub}</span>
  </button>
  <input
    bind:this={input}
    class="sr-only"
    type="file"
    accept={ACCEPT}
    onchange={pick}
    aria-label={t.drop.open}
  />
</div>

<style>
  .zone {
    flex: 1;
    display: grid;
    place-items: center;
    padding: var(--space-lg);
  }

  .target {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2xs);
    width: min(560px, 100%);
    padding: var(--space-2xl) var(--space-lg);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color var(--dur-short) var(--ease-out),
      color var(--dur-short) var(--ease-out),
      background-color var(--dur-short) var(--ease-out);
  }
  .target:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
    background: var(--surface-2);
  }

  .hint {
    font-size: var(--text-lg);
    color: var(--text);
  }
  .sub {
    font-size: var(--text-sm);
  }
</style>
