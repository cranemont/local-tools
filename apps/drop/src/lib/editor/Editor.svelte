<script lang="ts">
  import { t, formatBytes } from "../i18n";
  import { drop } from "./state.svelte";
  import CopyButton from "../CopyButton.svelte";
  import Icon from "../Icon.svelte";

  let offerInput = $state("");
  let answerInput = $state("");
  let fileInput: HTMLInputElement | null = $state(null);
  let dragOver = $state(false);

  function restart() {
    offerInput = "";
    answerInput = "";
    drop.reset();
  }

  function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    drop.sendFiles([...list]);
    if (fileInput) fileInput.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    pickFiles(e.dataTransfer?.files ?? null);
  }

  const statusLabel = (item: (typeof drop.transfers)[number]) =>
    item.status === "done"
      ? t.transfer.done
      : item.status === "error"
        ? t.transfer.error
        : item.dir === "out"
          ? t.transfer.sending
          : t.transfer.receiving;
</script>

<div class="editor">
  {#if drop.stage === "idle"}
    <div class="intro">
      <h1>{t.intro.title}</h1>
      <p class="sub">{t.intro.sub}</p>
      <div class="roles">
        <button class="role" onclick={() => drop.startHost()}>
          <Icon name="link" size={22} />
          <span class="role-title">{t.intro.create}</span>
          <span class="role-desc">{t.intro.createDesc}</span>
        </button>
        <button class="role" onclick={() => drop.startGuest()}>
          <Icon name="send" size={22} />
          <span class="role-title">{t.intro.join}</span>
          <span class="role-desc">{t.intro.joinDesc}</span>
        </button>
      </div>
      <p class="note">{t.intro.stunNote}</p>
    </div>
  {:else if drop.stage === "host"}
    <div class="panel">
      <div class="step">
        <div class="step-head">
          <span class="step-label">{t.host.step1}</span>
          <CopyButton text={drop.myCode} />
        </div>
        <textarea class="code" readonly value={drop.myCode || t.host.making} spellcheck="false"
        ></textarea>
      </div>
      <div class="step">
        <span class="step-label">{t.host.step2}</span>
        <textarea
          class="code"
          bind:value={answerInput}
          placeholder={t.host.answerPlaceholder}
          spellcheck="false"
        ></textarea>
        <div class="actions">
          <button
            class="btn"
            disabled={!answerInput.trim() || drop.busy}
            onclick={() => drop.acceptAnswer(answerInput)}
          >
            {t.host.connect}
          </button>
          <button class="btn ghost" onclick={restart}>{t.common.back}</button>
        </div>
      </div>
      {#if drop.error}<p class="error">{drop.error}</p>{/if}
    </div>
  {:else if drop.stage === "guest"}
    <div class="panel">
      {#if !drop.myCode}
        <div class="step">
          <span class="step-label">{t.guest.pasteLabel}</span>
          <textarea
            class="code"
            bind:value={offerInput}
            placeholder={t.guest.pastePlaceholder}
            spellcheck="false"
          ></textarea>
          <div class="actions">
            <button
              class="btn"
              disabled={!offerInput.trim() || drop.busy}
              onclick={() => drop.makeAnswer(offerInput)}
            >
              {t.guest.makeAnswer}
            </button>
            <button class="btn ghost" onclick={restart}>{t.common.back}</button>
          </div>
        </div>
      {:else}
        <div class="step">
          <div class="step-head">
            <span class="step-label">{t.guest.step1}</span>
            <CopyButton text={drop.myCode} />
          </div>
          <textarea class="code" readonly value={drop.myCode} spellcheck="false"></textarea>
          <p class="waiting">{t.guest.waiting}</p>
        </div>
      {/if}
      {#if drop.error}<p class="error">{drop.error}</p>{/if}
    </div>
  {:else if drop.stage === "connecting"}
    <div class="center">
      <p class="waiting">{t.conn.connecting}</p>
    </div>
  {:else if drop.stage === "failed" || drop.stage === "closed"}
    <div class="center">
      <p class="error">{drop.stage === "failed" ? t.conn.failed : t.conn.closed}</p>
      <button class="btn" onclick={restart}>{t.common.back}</button>
    </div>
  {:else}
    <div class="session">
      <div class="session-head">
        <span class="chip">{t.conn.connected}</span>
        <button class="btn ghost small" onclick={restart}>{t.common.back}</button>
      </div>

      <button
        class="dropzone"
        class:over={dragOver}
        onclick={() => fileInput?.click()}
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
      >
        <Icon name="file" size={22} />
        <span>{t.transfer.drop}</span>
      </button>
      <input
        class="hidden-input"
        type="file"
        multiple
        bind:this={fileInput}
        onchange={(e) => pickFiles(e.currentTarget.files)}
      />

      {#if drop.transfers.length}
        <ul class="list">
          {#each drop.transfers as item (item.id)}
            <li class="item">
              <span class="dir" class:in={item.dir === "in"}>
                {item.dir === "in" ? t.transfer.dirIn : t.transfer.dirOut}
              </span>
              <div class="meta">
                <span class="name">{item.name}</span>
                <span class="size">
                  {item.status === "active"
                    ? `${formatBytes(item.done)} / ${formatBytes(item.size)}`
                    : formatBytes(item.size)}
                  · {statusLabel(item)}
                </span>
                {#if item.status === "active"}
                  <progress max={item.size} value={item.done}></progress>
                {/if}
              </div>
              {#if item.dir === "in" && item.blob}
                <button class="save" title={t.transfer.save} onclick={() => drop.saveItem(item)}>
                  <Icon name="download" size={16} />
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor {
    width: 100%;
    max-width: 720px;
    display: flex;
    flex-direction: column;
  }

  .intro {
    text-align: center;
    margin-top: 8vh;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 22px;
    letter-spacing: -0.02em;
  }
  .sub {
    margin: 0 0 28px;
    color: var(--text-muted);
    font-size: 14px;
  }
  .roles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 560px) {
    .roles {
      grid-template-columns: 1fr;
    }
  }
  .role {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 26px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
  }
  .role:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--accent);
  }
  .role-title {
    font-size: 15px;
    font-weight: 700;
  }
  .role-desc {
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .note {
    margin: 24px auto 0;
    max-width: 520px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-top: 4vh;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .step-label {
    font-size: 13px;
    font-weight: 600;
  }
  .code {
    width: 100%;
    min-height: 110px;
    resize: vertical;
    padding: 12px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .code:read-only {
    background: var(--surface-2);
  }
  .code::placeholder {
    color: var(--text-muted);
    opacity: 0.7;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .btn {
    padding: 8px 18px;
    font-size: 13px;
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
  .btn.ghost {
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
  }
  .btn.ghost:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .btn.small {
    padding: 5px 12px;
    font-size: 12px;
  }
  .waiting {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
  }
  .error {
    margin: 0;
    padding: 8px 12px;
    font-size: 12.5px;
    color: var(--danger);
    background: color-mix(in oklab, var(--danger) 8%, transparent);
    border-radius: var(--radius-sm);
  }
  .center {
    margin-top: 14vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .session {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 12px;
  }
  .session-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .chip {
    padding: 3px 11px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    background: var(--accent-weak);
    color: var(--accent);
  }
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 34px 18px;
    color: var(--text-muted);
    font-size: 13px;
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .dropzone:hover,
  .dropzone.over {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }
  .hidden-input {
    display: none;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .dir {
    flex: none;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .dir.in {
    background: var(--accent-weak);
    border-color: transparent;
    color: var(--accent);
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .name {
    font-size: 13.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    font-size: 12px;
    color: var(--text-muted);
  }
  progress {
    width: 100%;
    height: 4px;
    accent-color: var(--accent);
  }
  .save {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .save:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
</style>
