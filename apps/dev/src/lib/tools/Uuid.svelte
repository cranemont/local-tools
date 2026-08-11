<script lang="ts">
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";
  import CopyButton from "../CopyButton.svelte";

  type Kind = "v4" | "v7" | "ulid";
  const KINDS: { id: Kind; label: string }[] = [
    { id: "v4", label: "UUID v4" },
    { id: "v7", label: "UUID v7" },
    { id: "ulid", label: "ULID" },
  ];
  const COUNTS = [1, 5, 10, 50];

  let kind = $state<Kind>("v4");
  let count = $state(5);
  let items = $state<string[]>([]);

  function uuidv7(): string {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    const ts = Date.now();
    b[0] = ts / 2 ** 40;
    b[1] = ts / 2 ** 32;
    b[2] = ts / 2 ** 24;
    b[3] = ts / 2 ** 16;
    b[4] = ts / 2 ** 8;
    b[5] = ts;
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex = "";
    for (const x of b) hex += x.toString(16).padStart(2, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Crockford Base32 — 48비트 시각 + 80비트 난수
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function ulid(): string {
    let ts = Date.now();
    let time = "";
    for (let i = 0; i < 10; i++) {
      time = B32[ts % 32] + time;
      ts = Math.floor(ts / 32);
    }
    const rand = new Uint8Array(10);
    crypto.getRandomValues(rand);
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const byte of rand) {
      buffer = (buffer << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        out += B32[(buffer >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    return time + out;
  }

  function generate() {
    const make = kind === "v4" ? () => crypto.randomUUID() : kind === "v7" ? uuidv7 : ulid;
    items = Array.from({ length: count }, make);
  }

  $effect(() => {
    void kind;
    void count;
    generate();
  });

  const text = $derived(items.join("\n"));
</script>

<div class="tool">
  <div class="t-controls">
    <div class="t-chiprow" role="group">
      {#each KINDS as k (k.id)}
        <button
          class="t-chip"
          class:active={kind === k.id}
          aria-pressed={kind === k.id}
          onclick={() => (kind = k.id)}
        >
          {k.label}
        </button>
      {/each}
    </div>
    <label class="t-label" for="uuid-count">{t.uuid.count}</label>
    <select id="uuid-count" class="t-select" bind:value={count}>
      {#each COUNTS as n (n)}
        <option value={n}>{n}</option>
      {/each}
    </select>
    <button class="regen" onclick={generate}>
      <Icon name="rotate" size={14} />
      <span>{t.uuid.generate}</span>
    </button>
    <CopyButton {text} />
  </div>

  <textarea class="t-textarea" readonly value={text} spellcheck="false"></textarea>
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .regen {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--accent-contrast);
    background: var(--accent);
    border: 0;
    border-radius: 999px;
  }
  .regen:hover {
    background: var(--accent-hover);
  }
</style>
