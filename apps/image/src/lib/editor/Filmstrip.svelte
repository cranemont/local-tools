<script lang="ts">
  import { editor } from "./state.svelte";
  import ImageCard from "./ImageCard.svelte";
</script>

<div class="strip" role="list">
  {#each editor.items as item, i (item.id)}
    <div class="slot" role="listitem">
      <ImageCard {item} index={i} />
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
    min-height: 122px;
  }
  .slot {
    border-radius: var(--radius-sm);
  }
</style>
