<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import { MODELS } from "../embed/registry";
  import {
    deleteAll,
    deleteCachedModel,
    formatBytes,
    readStorage,
    type StorageReport,
  } from "../embed/cache";
  import { lab } from "./state.svelte";

  let { open, onClose }: { open: boolean; onClose: () => void } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let report = $state<StorageReport | null>(null);
  let working = $state(false);

  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      void refresh();
    } else if (!open && el.open) {
      el.close();
    }
  });

  async function refresh() {
    report = await readStorage();
  }

  /** 캐시를 지웠으면 메모리에 열려 있는 세션도 닫는다 — 안 그러면 "지웠는데 계속 돈다". */
  async function afterDelete() {
    await lab.closeSessions();
    await refresh();
  }

  async function removeOne(repo: string) {
    working = true;
    try {
      await deleteCachedModel(repo);
      await afterDelete();
    } finally {
      working = false;
    }
  }

  async function removeAll() {
    if (!confirm(t.storage.confirmAll)) return;
    working = true;
    try {
      await deleteAll();
      await afterDelete();
    } finally {
      working = false;
    }
  }

  function labelOf(repo: string): string {
    return MODELS.find((m) => m.repo === repo)?.label ?? repo;
  }
</script>

<dialog bind:this={dialog} onclose={onClose} onclick={(e) => e.target === dialog && onClose()}>
  <div class="sheet">
    <header>
      <h2>{t.storage.title}</h2>
      <button class="icon-btn" title={t.storage.close} onclick={onClose}>
        <Icon name="x" size={16} />
      </button>
    </header>

    {#if report}
      {#if report.usage !== null && report.quota !== null}
        <p class="usage">{t.storage.usage(formatBytes(report.usage), formatBytes(report.quota))}</p>
      {/if}

      {#if report.models.length}
        <ul class="list">
          {#each report.models as m (m.repo)}
            <li>
              <span class="name">
                <span class="label">{labelOf(m.repo)}</span>
                <span class="repo">{m.repo}</span>
              </span>
              <span class="size">{formatBytes(m.bytes)}</span>
              <span class="files">{t.storage.files(m.files)}</span>
              <button class="btn small ghost danger" disabled={working} onclick={() => removeOne(m.repo)}>
                <Icon name="trash" size={13} />
                <span>{t.storage.remove}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{t.storage.empty}</p>
      {/if}

      {#if report.runtimeBytes > 0}
        <p class="runtime">{t.storage.runtime} · {formatBytes(report.runtimeBytes)}</p>
      {/if}

      <footer>
        <p class="note">{t.storage.note}</p>
        {#if report.models.length}
          <button class="btn small danger" disabled={working} onclick={removeAll}>
            {t.storage.removeAll}
          </button>
        {/if}
      </footer>
    {:else}
      <p class="empty"><span class="spinner"></span></p>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    max-width: min(680px, 92vw);
  }
  dialog::backdrop {
    background: oklch(0 0 0 / 0.45);
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  h2 {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: 600;
  }

  .usage,
  .runtime,
  .note,
  .empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }
  .list li {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) 0;
    border-bottom: 1px solid var(--border);
  }
  .name {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label {
    font-size: var(--text-base);
    font-weight: 600;
  }
  .repo {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .size {
    font-family: var(--font-mono);
    font-size: var(--text-base);
  }
  .files {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
  }

  @media (max-width: 560px) {
    .list li {
      grid-template-columns: 1fr auto;
    }
    .files {
      display: none;
    }
  }
</style>
