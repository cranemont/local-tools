<script lang="ts">
  // 프로토콜 시퀀스 — 참여자 레인과 시간순 메시지.
  // SVG가 아니라 격자다. 각 단계에 붙는 설명이 길어서, 글이 자연스럽게 접히는 쪽이 읽힌다.
  import type { SequenceSpec } from "./mechanisms";
  import { t } from "../i18n";
  import Icon from "../Icon.svelte";

  let { spec }: { spec: SequenceSpec } = $props();

  const index = (id: string) => spec.actors.findIndex((a) => a.id === id);

  /** 메시지 한 줄이 차지할 격자 범위와 방향 */
  function span(from: string, to: string) {
    const a = index(from);
    const b = index(to);
    const start = Math.min(a, b);
    const width = Math.abs(b - a) + 1;
    return { style: `grid-column: ${start + 1} / span ${width};`, back: b < a };
  }
</script>

<div class="seq" style="--lanes: {spec.actors.length}">
  <div class="heads">
    {#each spec.actors as actor (actor.id)}
      <div class="head" class:outside={actor.outside}>
        <strong>{actor.label}</strong>
        {#if actor.note}<span>{actor.note}</span>{/if}
      </div>
    {/each}
  </div>

  <div class="body">
    <!-- 생명선 — 참여자마다 세로로 흐르는 시간축 -->
    <div class="lifelines" aria-hidden="true">
      {#each spec.actors as actor (actor.id)}
        <span class="lifeline" class:outside={actor.outside}></span>
      {/each}
    </div>

    <ol class="rows">
      {#each spec.rows as row, i (i)}
        {#if row.to}
          {@const s = span(row.from, row.to)}
          <li class="msg" class:sealed={row.sealed} class:back={s.back} style={s.style}>
            <div class="arrow" aria-hidden="true">
              <span class="line"></span>
              <span class="tip"></span>
            </div>
            <p class="label">
              {#if row.sealed}<Icon name="lock" size={13} />{/if}
              {row.label}
            </p>
            {#if row.detail}<p class="detail">{row.detail}</p>{/if}
          </li>
        {:else}
          <li class="calc" style="grid-column: {index(row.from) + 1};">
            <p class="label">{row.label}</p>
            {#if row.detail}<p class="detail">{row.detail}</p>{/if}
          </li>
        {/if}
      {/each}
    </ol>
  </div>

  {#if spec.sees}
    <aside class="sees">
      <h3><Icon name="eye" size={15} />{spec.sees.title}</h3>
      <ul>
        {#each spec.sees.items as item (item)}
          <li>{item}</li>
        {/each}
      </ul>
      <p class="conclusion">{spec.sees.conclusion}</p>
    </aside>
  {/if}

  <p class="hint">{t.mech.seqHint}</p>
</div>

<style>
  .seq {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 0;
  }

  .heads {
    display: grid;
    grid-template-columns: repeat(var(--lanes), 1fr);
    gap: var(--space-sm);
    position: sticky;
    /* 상단바가 이미 0에 붙어 있다 — 그 아래로 */
    top: var(--topbar-h, 52px);
    z-index: var(--z-raised);
    padding: var(--space-sm) 0;
    background: var(--surface);
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-pill);
    text-align: center;
  }
  .head strong {
    font-size: var(--text-lg);
  }
  .head span {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  /* 성벽 밖 참여자 — 믿지 않는 쪽은 생김새로 구분한다 */
  .head.outside {
    border-style: dashed;
    border-color: var(--cat-4);
    color: var(--cat-4-ink);
  }
  .head.outside span {
    color: var(--cat-4-ink);
  }

  .body {
    position: relative;
  }

  .lifelines {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(var(--lanes), 1fr);
    gap: var(--space-sm);
    pointer-events: none;
  }
  .lifeline {
    justify-self: center;
    width: 0;
    height: 100%;
    border-left: 1px dashed var(--border-strong);
    opacity: 0.55;
  }
  .lifeline.outside {
    border-color: var(--cat-4);
  }

  .rows {
    display: grid;
    grid-template-columns: repeat(var(--lanes), 1fr);
    gap: var(--space-sm);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .msg,
  .calc {
    position: relative;
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  /* 자기 안에서 도는 계산 — 화살표 없이 레인 위에 얹힌다 */
  .calc {
    border-left: 3px solid var(--accent);
  }

  .msg .label,
  .calc .label {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    line-height: 1.5;
    word-break: break-word;
  }
  .detail {
    margin: var(--space-2xs) 0 0;
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--text-muted);
  }

  .arrow {
    position: relative;
    display: flex;
    align-items: center;
    height: 10px;
    margin-bottom: var(--space-2xs);
  }
  .arrow .line {
    flex: 1;
    height: 2px;
    border-radius: 2px;
    background: var(--border-strong);
  }
  .arrow .tip {
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 8px solid var(--border-strong);
  }
  .msg.back .arrow {
    flex-direction: row-reverse;
  }
  .msg.back .arrow .tip {
    border-left: 0;
    border-right: 8px solid var(--border-strong);
  }

  /* 봉인된 메시지 — 여기부터 중간에 앉은 쪽은 암호문만 본다 */
  .msg.sealed {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .msg.sealed .arrow .line,
  .msg.sealed .arrow .tip {
    background: var(--accent);
    border-left-color: var(--accent);
    border-right-color: var(--accent);
  }
  .msg.sealed .label {
    color: var(--accent-ink);
  }

  .sees {
    padding: var(--space-md) var(--space-lg);
    border: 1px solid var(--cat-4);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--cat-4) 8%, transparent);
  }
  .sees h3 {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin: 0 0 var(--space-sm);
    font-size: var(--text-xl);
    color: var(--cat-4-ink);
  }
  .sees ul {
    margin: 0;
    padding-left: var(--space-lg);
    font-size: var(--text-base);
    line-height: 1.7;
  }
  .conclusion {
    margin: var(--space-md) 0 0;
    font-size: var(--text-lg);
    line-height: 1.7;
    font-weight: 600;
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* 좁은 화면에선 레인을 접고 한 줄씩 읽는다 — 격자를 우겨넣으면 글자가 뭉갠다 */
  @media (max-width: 720px) {
    .heads,
    .rows,
    .lifelines {
      grid-template-columns: 1fr;
    }
    .lifelines {
      display: none;
    }
    .msg,
    .calc {
      grid-column: 1 !important;
    }
  }
</style>
