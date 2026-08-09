<script lang="ts">
  import { t } from "../i18n";

  let { onfound, onclose }: { onfound: (text: string) => void; onclose: () => void } = $props();

  let video = $state<HTMLVideoElement | null>(null);
  let error = $state<string | null>(null);

  const supported = "BarcodeDetector" in globalThis;

  $effect(() => {
    if (!video || !supported) {
      if (!supported) error = t.scan.unsupported;
      return;
    }
    const el = video;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) return;
        el.srcObject = stream;
        await el.play();
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          if (cancelled || el.readyState < 2) return;
          try {
            const codes = await detector.detect(el);
            if (codes.length && !cancelled) {
              cancelled = true;
              onfound(codes[0].rawValue);
            }
          } catch {
            /* 프레임 단위 실패는 무시 */
          }
        }, 300);
      } catch {
        if (!cancelled) error = t.scan.cameraFail;
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  });
</script>

<div class="overlay" role="dialog" aria-label={t.scan.title}>
  <div class="box">
    {#if error}
      <p class="error">{error}</p>
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted></video>
      <p class="hint">{t.scan.hint}</p>
    {/if}
    <button class="btn" onclick={onclose}>{t.scan.cancel}</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in oklab, var(--bg) 60%, transparent);
    backdrop-filter: blur(4px);
  }
  .box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-1);
    max-width: min(420px, 92vw);
  }
  video {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius-md);
    background: #000;
  }
  .hint {
    margin: 0;
    font-size: 12.5px;
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
  .btn {
    padding: 7px 16px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .btn:hover {
    color: var(--text);
    background: var(--surface-2);
  }
</style>
