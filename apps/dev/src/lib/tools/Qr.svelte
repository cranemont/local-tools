<script lang="ts">
  import { encode } from "uqr";
  import { t } from "../i18n";
  import { persisted } from "../persist.svelte";
  import Icon from "../Icon.svelte";
  import CopyButton from "../CopyButton.svelte";
  import { downloadBlob } from "../save";

  type Mode = "text" | "wifi" | "scan";
  const PNG_SIZES = [256, 512, 1024];

  const mode = persisted<Mode>("qr.mode", "text");
  const input = persisted("qr.input", "");
  const ssid = persisted("qr.ssid", "");
  let password = $state("");
  const security = persisted<"WPA" | "WEP" | "nopass">("qr.security", "WPA");
  const hidden = persisted("qr.hidden", false);
  const pngSize = persisted("qr.pngSize", 512);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let imageCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  // WIFI: 페이로드 특수문자 이스케이프 (\ ; , : ")
  const esc = (s: string) => s.replace(/[\\;,:"]/g, "\\$&");

  const payload = $derived.by(() => {
    if (mode.current === "wifi") {
      if (!ssid.current) return "";
      const pass = security.current === "nopass" ? "" : `P:${esc(password)};`;
      return `WIFI:T:${security.current};S:${esc(ssid.current)};${pass}${hidden.current ? "H:true;" : ""};`;
    }
    return input.current.trim();
  });

  const qr = $derived.by(() => {
    if (!payload || mode.current === "scan") return null;
    try {
      return { code: encode(payload, { border: 2 }), error: null };
    } catch {
      return { code: null, error: t.qr.tooLong };
    }
  });

  function paint(canvas: HTMLCanvasElement, scale: number): HTMLCanvasElement {
    const code = qr?.code;
    if (!code) return canvas;
    const { size, data } = code;
    canvas.width = canvas.height = size * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (data[y][x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    return canvas;
  }

  $effect(() => {
    if (canvasEl && qr?.code) paint(canvasEl, 4);
  });

  async function exportPng(): Promise<Blob> {
    const code = qr!.code!;
    const scale = Math.max(1, Math.round(pngSize.current / code.size));
    const canvas = paint(document.createElement("canvas"), scale);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
  }

  async function download() {
    downloadBlob(await exportPng(), "qr.png");
  }

  async function copyImage() {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": await exportPng() })]);
    imageCopied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (imageCopied = false), 1500);
  }

  // ── 스캔 ──────────────────────────────────────────────
  const scanSupported = "BarcodeDetector" in globalThis;
  let scanResult = $state<string | null>(null);
  let scanError = $state<string | null>(null);
  let dragOver = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function scanFile(f: File) {
    scanResult = null;
    scanError = null;
    try {
      const bitmap = await createImageBitmap(f);
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      let codes = await detector.detect(bitmap);
      // 작은 이미지는 인식이 불안정 — 업스케일해서 한 번 더
      if (!codes.length && bitmap.width < 800) {
        const scale = Math.ceil(800 / bitmap.width);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width * scale;
        canvas.height = bitmap.height * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        codes = await detector.detect(canvas);
      }
      if (codes.length) scanResult = codes.map((c) => c.rawValue).join("\n");
      else scanError = t.qr.scanNone;
    } catch {
      scanError = t.qr.scanFail;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void scanFile(f);
  }
</script>

<div class="tool">
  <div class="t-controls">
    <div class="t-chiprow" role="group">
      <button
        class="t-chip"
        class:active={mode.current === "text"}
        aria-pressed={mode.current === "text"}
        onclick={() => (mode.current = "text")}
      >
        {t.qr.modeText}
      </button>
      <button
        class="t-chip"
        class:active={mode.current === "wifi"}
        aria-pressed={mode.current === "wifi"}
        onclick={() => (mode.current = "wifi")}
      >
        {t.qr.modeWifi}
      </button>
      <button
        class="t-chip"
        class:active={mode.current === "scan"}
        aria-pressed={mode.current === "scan"}
        onclick={() => (mode.current = "scan")}
      >
        {t.qr.modeScan}
      </button>
    </div>
  </div>

  {#if mode.current === "scan"}
    {#if !scanSupported}
      <p class="t-note">{t.qr.scanUnsupported}</p>
    {:else}
      <input
        type="file"
        accept="image/*"
        bind:this={fileInput}
        onchange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void scanFile(f);
        }}
        hidden
      />
      <button
        class="drop"
        class:over={dragOver}
        onclick={() => fileInput?.click()}
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
      >
        <span>{t.qr.scanDrop}</span>
      </button>
      {#if scanError}
        <p class="t-error">{scanError}</p>
      {:else if scanResult !== null}
        <div class="scan-result">
          <div class="t-pane-head">
            <span class="t-label">{t.qr.scanResult}</span>
            <CopyButton text={scanResult} />
          </div>
          <pre class="scan-text">{scanResult}</pre>
        </div>
      {/if}
    {/if}
  {:else}
    <div class="gen">
      <div class="fields">
        {#if mode.current === "text"}
          <textarea
            class="t-textarea text"
            bind:value={input.current}
            placeholder={t.qr.textPlaceholder}
            spellcheck="false"
          ></textarea>
        {:else}
          <label class="field">
            <span class="t-label">{t.qr.ssid}</span>
            <input class="fin" type="text" bind:value={ssid.current} spellcheck="false" autocomplete="off" />
          </label>
          <label class="field">
            <span class="t-label">{t.qr.security}</span>
            <select class="t-select" bind:value={security.current}>
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">{t.qr.secNone}</option>
            </select>
          </label>
          {#if security.current !== "nopass"}
            <label class="field">
              <span class="t-label">{t.qr.password}</span>
              <input class="fin" type="text" bind:value={password} spellcheck="false" autocomplete="off" />
            </label>
          {/if}
          <label class="t-checkrow">
            <input type="checkbox" bind:checked={hidden.current} />
            {t.qr.hidden}
          </label>
        {/if}
      </div>

      <div class="preview">
        {#if qr?.error}
          <p class="t-error">{qr.error}</p>
        {:else if qr?.code}
          <canvas bind:this={canvasEl} class="qr"></canvas>
          <div class="actions">
            <label class="t-label" for="qr-size">{t.qr.pngSize}</label>
            <select id="qr-size" class="t-select" bind:value={pngSize.current}>
              {#each PNG_SIZES as s (s)}
                <option value={s}>{s}px</option>
              {/each}
            </select>
            <button class="act" onclick={download}>
              <Icon name="download" size={14} />
              <span>{t.qr.download}</span>
            </button>
            <button class="act" class:done={imageCopied} onclick={copyImage}>
              <Icon name={imageCopied ? "check" : "copy"} size={14} />
              <span>{imageCopied ? t.qr.copiedImage : t.qr.copyImage}</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .gen {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .gen {
      grid-template-columns: 1fr;
    }
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .text {
    min-height: 140px;
    flex: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-width: 360px;
  }
  .fin {
    padding: 8px 11px;
    font-family: inherit;
    font-size: var(--text-lg);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .fin:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field .t-select {
    align-self: flex-start;
  }
  .preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .qr {
    width: 232px;
    height: 232px;
    image-rendering: pixelated;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: #fff;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    justify-content: center;
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .act:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .act.done {
    color: var(--accent-ink);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 36px 20px;
    font-family: inherit;
    font-size: var(--text-lg);
    color: var(--text-muted);
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .drop:hover,
  .drop.over {
    border-color: var(--accent);
    color: var(--text);
    background: var(--accent-weak);
  }
  .scan-result {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 14px;
  }
  .scan-text {
    margin: 0;
    padding: 12px;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
</style>
