<script lang="ts">
  import { t } from "./i18n";
  import Icon from "./Icon.svelte";

  let { text }: { text: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1500);
  }
</script>

<button class="copy" class:copied onclick={copy} disabled={!text}>
  <Icon name={copied ? "check" : "copy"} size={14} />
  <span>{copied ? t.common.copied : t.common.copy}</span>
</button>

<style>
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .copy:hover:enabled {
    color: var(--text);
    background: var(--surface-2);
  }
  .copy:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .copy.copied {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  }
</style>
