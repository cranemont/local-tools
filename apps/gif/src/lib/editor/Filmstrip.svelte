<script lang="ts">
  import { editor } from "./state.svelte";
  import FrameCard from "./FrameCard.svelte";

  let stripEl: HTMLDivElement;
  let dragFrom = $state<number | null>(null);
  let dragTo = $state<number | null>(null);

  // 키보드로 프레임을 옮겨 다니면 보던 칸이 화면 밖으로 나간다 — 따라가게 한다.
  $effect(() => {
    const i = editor.current;
    const slot = stripEl?.children[i] as HTMLElement | undefined;
    slot?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  function cardDragStart(e: DragEvent, index: number) {
    // 딜레이 입력을 만지는 중이면 카드가 끌려가면 안 된다.
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") {
      e.preventDefault();
      return;
    }
    dragFrom = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }
  function cardDragOver(e: DragEvent, index: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    dragTo = index;
  }
  function cardDrop(index: number) {
    if (dragFrom !== null && dragFrom !== index) editor.move(dragFrom, index);
    dragFrom = null;
    dragTo = null;
  }
  function cardDragEnd() {
    dragFrom = null;
    dragTo = null;
  }
</script>

<div class="strip" role="list" bind:this={stripEl}>
  {#each editor.frames as frame, i (frame.id)}
    <div
      class="slot"
      class:target={dragTo === i && dragFrom !== null && dragFrom !== i}
      class:dragging={dragFrom === i}
      draggable="true"
      ondragstart={(e) => cardDragStart(e, i)}
      ondragover={(e) => cardDragOver(e, i)}
      ondrop={() => cardDrop(i)}
      ondragend={cardDragEnd}
      role="listitem"
    >
      <FrameCard {frame} index={i} />
    </div>
  {/each}
</div>

<style>
  .strip {
    flex: none;
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    min-height: 118px;
  }
  .slot {
    border-radius: var(--radius-sm);
    cursor: grab;
  }
  .slot.dragging {
    opacity: 0.4;
  }
  .slot.target {
    box-shadow: -3px 0 0 var(--accent);
  }
</style>
