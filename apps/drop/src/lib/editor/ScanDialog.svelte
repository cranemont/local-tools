<script lang="ts">
  import { t } from "../i18n";

  let { onfound, onclose }: { onfound: (text: string) => void; onclose: () => void } = $props();

  let video = $state<HTMLVideoElement | null>(null);
  let error = $state<string | null>(null);
  let dialogEl = $state<HTMLDialogElement | null>(null);

  const supported = "BarcodeDetector" in globalThis;

  // showModal()이 포커스 트랩·배경 inert·Escape 닫기를 전부 켠다
  $effect(() => {
    const el = dialogEl;
    if (!el || el.open) return;
    el.showModal();
  });

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

<!-- 네이티브 dialog — Escape·포커스 트랩·배경 inert를 브라우저가 처리한다 -->
<dialog bind:this={dialogEl} class="overlay" aria-label={t.scan.title} onclose={onclose}>
  <div class="box">
    {#if error}
      <p class="error">{error}</p>
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted></video>
      <p class="hint">{t.scan.hint}</p>
    {/if}
    <button class="btn pill" onclick={() => dialogEl?.close()}>{t.scan.cancel}</button>
  </div>
</dialog>

<style>
  .overlay {
    /* dialog 기본값(border/padding/그림자)을 걷어내고 전체 화면 중앙 정렬로 */
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .overlay:not([open]) {
    display: none;
  }
  .overlay::backdrop {
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
    font-size: var(--text-md);
    color: var(--text-muted);
  }
  .error {
    margin: 0;
    padding: 8px 12px;
    font-size: var(--text-md);
    color: var(--danger);
    background: color-mix(in oklab, var(--danger) 8%, transparent);
    border-radius: var(--radius-sm);
  }
</style>
