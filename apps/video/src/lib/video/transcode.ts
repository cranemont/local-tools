// 트랜스코드 — mediabunny Conversion + WebCodecs.
// 정확 컷: 비디오 재인코딩(프리셋/타깃 비트레이트/해상도). 오디오는 가능하면 복사.
// 무손실 컷: 트랙 옵션을 비워 스마트 패스스루(패킷 복사) — 재인코딩 없음.
import {
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  WavOutputFormat,
  WebMOutputFormat,
  type ConversionVideoOptions,
  type OutputFormat,
} from "mediabunny";
import { t } from "../i18n";
import { VIDEO_FORMATS } from "./probe";

export type CutMode = "exact" | "lossless";
export type PresetId = "small" | "balanced" | "high";
/** 출력 컨테이너. */
export type ContainerId = "mp4" | "webm";

/** 무손실(복사) 상태로 각 컨테이너에 담을 수 있는 비디오 코덱. */
const CONTAINER_VIDEO_CODECS: Record<ContainerId, readonly string[]> = {
  mp4: ["avc", "hevc", "vp9", "av1"],
  webm: ["vp8", "vp9", "av1"],
};

/** 무손실 모드에서 이 코덱을 복사로 담을 수 있는지 (아니면 재인코딩됨). */
export function losslessCompatible(
  videoCodec: string | null,
  container: ContainerId,
): boolean {
  return videoCodec !== null && CONTAINER_VIDEO_CODECS[container].includes(videoCodec);
}

const PRESET_QUALITY: Record<PresetId, Quality> = {
  small: QUALITY_LOW,
  balanced: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
};

/** 타깃 용량 역산 시 오디오 몫으로 잡아두는 추정 비트레이트(bps). */
const AUDIO_BPS_ESTIMATE = 128_000;
/** 컨테이너 오버헤드 몫 — 비디오 예산을 이만큼 깎는다. */
const MUX_OVERHEAD = 0.94;
/** 화질이 무의미해지는 하한(bps). */
const MIN_VIDEO_BPS = 100_000;

export interface TranscodeOptions {
  /** null이면 전체 구간. */
  trim: { start: number; end: number } | null;
  mode: CutMode;
  container: ContainerId;
  /** true면 오디오 트랙 제거. */
  mute: boolean;
  preset: PresetId;
  /** 출력 세로 픽셀 (null = 원본 크기). 정확 컷에서만 적용. */
  height: number | null;
  /** 타깃 용량(바이트). null이면 프리셋 화질. 정확 컷에서만 적용. */
  targetBytes: number | null;
  /** 인코딩되는 구간 길이(초) — 타깃 비트레이트 역산용. */
  clipDurationS: number;
  /** 원본 표시 크기 — 짝수 해상도 계산용. */
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  onProgress?: (progress: number) => void;
  /** 시작 직후 취소 함수를 넘겨준다. */
  registerCancel?: (cancel: () => void) => void;
}

export interface TranscodeResult {
  /** 취소되면 null. */
  blob: Blob | null;
  /** 오디오 트랙이 처리 불가로 제외됐는지. */
  audioDropped: boolean;
}

function exactVideoOptions(opts: TranscodeOptions): ConversionVideoOptions {
  const video: ConversionVideoOptions = {
    forceTranscode: true,
    codec: opts.container === "webm" ? "vp9" : "avc",
  };

  if (opts.targetBytes) {
    const totalBps = (opts.targetBytes * 8) / Math.max(0.1, opts.clipDurationS);
    const audioBps = opts.hasAudio ? AUDIO_BPS_ESTIMATE : 0;
    const bitrate = Math.max(
      MIN_VIDEO_BPS,
      Math.round((totalBps - audioBps) * MUX_OVERHEAD),
    );
    // CBR — VBR은 어려운 영상에서 타깃을 크게 넘길 수 있다(노이즈 영상 실측 +30%).
    video.quality = new Quality({ bitrate, bitrateMode: "constant" });
  } else {
    video.quality = PRESET_QUALITY[opts.preset];
  }

  if (opts.height && opts.height < opts.sourceHeight) {
    // H.264는 짝수 해상도가 안전 — 가로를 직접 짝수로 계산해 넘긴다.
    const w =
      Math.round(((opts.sourceWidth / opts.sourceHeight) * opts.height) / 2) * 2;
    video.width = Math.max(2, w);
    video.height = opts.height;
    video.fit = "fill"; // 비율은 위에서 이미 유지됨
  }
  return video;
}

export async function transcodeMp4(
  file: File,
  opts: TranscodeOptions,
): Promise<TranscodeResult> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const output = new Output({
      format:
        opts.container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    // 정확 모드 오디오는 컨테이너 표준 코덱을 명시한다(mp4→aac, webm→opus).
    // 코덱이 이미 맞으면 복사되고, 다르면 재인코딩 — opus-in-mp4처럼 크롬에서만
    // 재생되는 조합을 막는다. 무손실 모드는 복사 우선(호환성보다 원본 보존).
    const audio = opts.mute
      ? ({ discard: true } as const)
      : opts.mode === "exact"
        ? ({ codec: opts.container === "webm" ? "opus" : "aac" } as const)
        : undefined;
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: opts.trim ?? undefined,
      // 무손실: 옵션 없음 = 가능하면 패킷 복사.
      video: opts.mode === "exact" ? exactVideoOptions(opts) : {},
      audio,
      showWarnings: false,
    });
    const audioDropped =
      !opts.mute &&
      conversion.discardedTracks.some((d) => d.track.isAudioTrack());
    if (!conversion.isValid) throw new Error(t.errors.encodeFail);

    conversion.onProgress = (p) => opts.onProgress?.(p);
    opts.registerCancel?.(() => void conversion.cancel());
    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof ConversionCanceledError) return { blob: null, audioDropped };
      throw err;
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error(t.errors.encodeFail);
    const mime = opts.container === "webm" ? "video/webm" : "video/mp4";
    return { blob: new Blob([buffer], { type: mime }), audioDropped };
  } finally {
    input.dispose();
  }
}

// ── 소리 추출 — 비디오를 버리고 오디오 트랙을 (가능하면) 그대로 복사 ──

interface AudioContainer {
  makeFormat: () => OutputFormat;
  ext: string;
  mime: string;
}

/** 원본 오디오 코덱 → 재인코딩 없이 담을 수 있는 컨테이너. */
const AUDIO_CONTAINERS: Record<string, AudioContainer> = {
  aac: { makeFormat: () => new Mp4OutputFormat(), ext: "m4a", mime: "audio/mp4" },
  opus: { makeFormat: () => new OggOutputFormat(), ext: "ogg", mime: "audio/ogg" },
  vorbis: { makeFormat: () => new OggOutputFormat(), ext: "ogg", mime: "audio/ogg" },
  mp3: { makeFormat: () => new Mp3OutputFormat(), ext: "mp3", mime: "audio/mpeg" },
  flac: { makeFormat: () => new FlacOutputFormat(), ext: "flac", mime: "audio/flac" },
};

/** 그 외 코덱(pcm 등)의 폴백. wav는 무압축이지만 어떤 pcm이든 담긴다. */
const AUDIO_FALLBACK: AudioContainer = {
  makeFormat: () => new WavOutputFormat(),
  ext: "wav",
  mime: "audio/wav",
};

export interface ExtractAudioOptions {
  /** null이면 전체 구간. */
  trim: { start: number; end: number } | null;
  audioCodec: string | null;
  onProgress?: (progress: number) => void;
  registerCancel?: (cancel: () => void) => void;
}

export interface ExtractAudioResult {
  /** 취소되면 null. */
  blob: Blob | null;
  ext: string;
}

export async function extractAudio(
  file: File,
  opts: ExtractAudioOptions,
): Promise<ExtractAudioResult> {
  const container =
    opts.audioCodec && opts.audioCodec.startsWith("pcm")
      ? AUDIO_FALLBACK
      : (AUDIO_CONTAINERS[opts.audioCodec ?? ""] ??
        // 모르는 코덱은 m4a로 — 복사가 안 되면 Conversion이 aac로 재인코딩한다.
        AUDIO_CONTAINERS.aac);
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const output = new Output({
      format: container.makeFormat(),
      target: new BufferTarget(),
    });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: opts.trim ?? undefined,
      video: { discard: true },
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error(t.errors.encodeFail);

    conversion.onProgress = (p) => opts.onProgress?.(p);
    opts.registerCancel?.(() => void conversion.cancel());
    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof ConversionCanceledError)
        return { blob: null, ext: container.ext };
      throw err;
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error(t.errors.encodeFail);
    return {
      blob: new Blob([buffer], { type: container.mime }),
      ext: container.ext,
    };
  } finally {
    input.dispose();
  }
}
