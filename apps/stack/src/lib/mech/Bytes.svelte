<script lang="ts">
  // 바이트 배치 — 파일이 실제로 어떤 순서로 쌓이는지.
  // 막대 폭은 바이트 수에 비례하되, 2바이트짜리도 이름은 읽혀야 하므로 최소 폭을 준다.
  import type { BytesSpec } from "./mechanisms";
  import { t } from "../i18n";

  let { spec }: { spec: BytesSpec } = $props();

  const total = $derived(spec.fields.reduce((sum, f) => sum + f.size, 0));
</script>

<div class="bytes">
  <div class="bar">
    {#each spec.fields as field, i (i)}
      <div class="field {field.kind ?? 'payload'}" style="flex-grow: {field.size}">
        <span class="name">{field.label}</span>
        <span class="size">{t.mech.bytes(field.size)}</span>
      </div>
    {/each}
  </div>

  <ol class="legend">
    {#each spec.fields as field, i (i)}
      <li class="{field.kind ?? 'payload'}">
        <span class="swatch"></span>
        <strong>{field.label}</strong>
        {#if field.sub}<span class="sub">{field.sub}</span>{/if}
      </li>
    {/each}
  </ol>

  <p class="note">{spec.note}</p>
  <p class="scale">{t.mech.bytesScale(total)}</p>
</div>

<style>
  .bytes {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .bar {
    display: flex;
    gap: 2px;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .field {
    flex-basis: 0;
    min-width: 76px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-sm) var(--space-xs);
    background: var(--k, var(--surface-2));
    color: var(--kink, var(--text));
    overflow: hidden;
  }
  .name {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .size {
    font-size: var(--text-2xs);
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
  }

  /* 성격별 색 — 새 색을 만들지 않고 공용 범주형 팔레트를 쓴다 */
  .magic {
    --k: color-mix(in srgb, var(--cat-5) 22%, transparent);
    --kink: var(--cat-5-ink);
  }
  .header {
    --k: color-mix(in srgb, var(--cat-1) 18%, transparent);
    --kink: var(--cat-1-ink);
  }
  .meta {
    --k: color-mix(in srgb, var(--cat-3) 18%, transparent);
    --kink: var(--cat-3-ink);
  }
  .repeat {
    --k: color-mix(in srgb, var(--cat-4) 20%, transparent);
    --kink: var(--cat-4-ink);
  }
  .payload {
    --k: color-mix(in srgb, var(--cat-2) 18%, transparent);
    --kink: var(--cat-2-ink);
  }

  .legend {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-sm) var(--space-lg);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .legend li {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: var(--space-xs);
    font-size: var(--text-sm);
    line-height: 1.55;
  }
  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--kink);
  }
  .legend strong {
    grid-column: 2;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .sub {
    grid-column: 2;
    color: var(--text-muted);
  }

  .note {
    margin: 0;
    font-size: var(--text-base);
    line-height: 1.7;
  }
  .scale {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
