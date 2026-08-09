<script lang="ts">
  import { encode } from "uqr";

  let { text, px = 220 }: { text: string; px?: number } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  // 코드가 QR 용량을 넘으면 조용히 숨긴다 (텍스트 코드가 항상 병행 표시됨)
  const qr = $derived.by(() => {
    if (!text) return null;
    try {
      return encode(text, { border: 2 });
    } catch {
      return null;
    }
  });

  $effect(() => {
    if (!canvas || !qr) return;
    const { size, data } = qr;
    const scale = Math.max(2, Math.floor((px * devicePixelRatio) / size));
    canvas.width = canvas.height = size * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (data[y][x]) ctx.fillRect(x * scale, y * scale, scale, scale);
  });
</script>

{#if qr}
  <canvas bind:this={canvas} style:width="{px}px" style:height="{px}px"></canvas>
{/if}

<style>
  canvas {
    display: block;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: #fff;
    padding: 4px;
  }
</style>
