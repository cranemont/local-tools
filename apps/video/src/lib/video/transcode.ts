// 트랜스코드 — mediabunny Conversion + WebCodecs.
// 정확 컷: 비디오 재인코딩(프리셋/타깃 비트레이트/해상도). 오디오는 가능하면 복사.
// 무손실 컷: 트랙 옵션을 비워 스마트 패스스루(패킷 복사) — 재인코딩 없음.
import {
  BlobSource,
  BufferTarget,
  canEncodeAudio,
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
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type OutputFormat,
  type Rotation,
  type VideoSample,
} from "mediabunny";
import { t } from "../i18n";
import { VIDEO_FORMATS } from "./probe";

export type CutMode = "exact" | "lossless";
export type PresetId = "small" | "balanced" | "high";
/** 출력 컨테이너. */
export type ContainerId = "mp4" | "webm";
/** 시계 방향 회전 각도. */
export type { Rotation };

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

/**
 * 좌우·상하 반전 처리기 — mediabunny에 반전 옵션이 없어 프레임을 직접 그린다.
 * 회전·크기 조정이 끝난 샘플이 들어오므로(rotate 옵션이 process와 함께 오면
 * 엔진이 회전을 픽셀에 굽는다) 여기서는 뒤집기만 한다.
 */
function flipProcessor(
  flipH: boolean,
  flipV: boolean,
): (sample: VideoSample) => OffscreenCanvas {
  // 캔버스는 한 장을 재사용한다 — mediabunny가 반환 즉시 VideoFrame으로 복사한다.
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  return (sample) => {
    const w = sample.displayWidth;
    const h = sample.displayHeight;
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h);
      ctx = canvas.getContext("2d");
    }
    if (!ctx) throw new Error(t.errors.encodeFail);
    ctx.setTransform(flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, flipH ? w : 0, flipV ? h : 0);
    sample.draw(ctx, 0, 0, w, h);
    return canvas;
  };
}

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
  /** 지정 비트레이트(kbps). targetBytes가 없을 때만 프리셋을 대신한다. */
  bitrateKbps: number | null;
  /** 출력 프레임레이트(null = 원본). 정확 컷에서만 적용. */
  fps: number | null;
  /** 시계 방향 회전. 무손실 컷에선 메타데이터 회전(복사 유지). */
  rotate: Rotation;
  /** 좌우·상하 반전 — 픽셀을 다시 그리므로 정확 컷에서만 적용. */
  flipH: boolean;
  flipV: boolean;
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

/** 회전을 반영한 원본 크기 — 90·270에선 가로세로가 바뀐다. */
export function rotatedSize(
  width: number,
  height: number,
  rotate: Rotation,
): { w: number; h: number } {
  return rotate % 180 === 0 ? { w: width, h: height } : { w: height, h: width };
}

function exactVideoOptions(opts: TranscodeOptions): ConversionVideoOptions {
  const video: ConversionVideoOptions = {
    forceTranscode: true,
    codec: opts.container === "webm" ? "vp9" : "avc",
  };

  if (opts.rotate) video.rotate = opts.rotate;
  if (opts.flipH || opts.flipV) video.process = flipProcessor(opts.flipH, opts.flipV);
  if (opts.fps) video.frameRate = opts.fps;

  if (opts.targetBytes) {
    const totalBps = (opts.targetBytes * 8) / Math.max(0.1, opts.clipDurationS);
    const audioBps = opts.hasAudio ? AUDIO_BPS_ESTIMATE : 0;
    const bitrate = Math.max(
      MIN_VIDEO_BPS,
      Math.round((totalBps - audioBps) * MUX_OVERHEAD),
    );
    // CBR — VBR은 어려운 영상에서 타깃을 크게 넘길 수 있다(노이즈 영상 실측 +30%).
    video.quality = new Quality({ bitrate, bitrateMode: "constant" });
  } else if (opts.bitrateKbps) {
    video.quality = new Quality({
      bitrate: Math.round(opts.bitrateKbps * 1000),
      bitrateMode: "constant",
    });
  } else {
    video.quality = PRESET_QUALITY[opts.preset];
  }

  // 리사이즈는 회전이 끝난 크기를 기준으로 한다(엔진도 회전→크롭→리사이즈 순서다).
  const src = rotatedSize(opts.sourceWidth, opts.sourceHeight, opts.rotate);
  if (opts.height && opts.height < src.h) {
    // H.264는 짝수 해상도가 안전 — 가로를 직접 짝수로 계산해 넘긴다.
    const w = Math.round(((src.w / src.h) * opts.height) / 2) * 2;
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
      // 무손실: 회전 말고는 옵션 없음 = 가능하면 패킷 복사.
      // (rotate만 있으면 엔진이 컨테이너 회전 메타데이터를 써서 복사를 유지한다.)
      video:
        opts.mode === "exact"
          ? exactVideoOptions(opts)
          : opts.rotate
            ? { rotate: opts.rotate }
            : {},
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
  /** 이 컨테이너에 담을 코덱 — 형식을 직접 고를 때 명시한다. */
  codec: AudioCodec;
}

/** 소리 저장 형식. auto는 원본 코덱을 그대로 담을 수 있는 컨테이너를 고른다. */
export type AudioFormatId = "auto" | "m4a" | "mp3" | "ogg" | "wav" | "flac";
export const AUDIO_FORMAT_IDS = ["auto", "m4a", "mp3", "ogg", "wav", "flac"] as const;

/** 형식 → 컨테이너·확장자·코덱. auto는 원본 코덱을 키로 이 표를 조회한다. */
const AUDIO_CONTAINERS: Record<Exclude<AudioFormatId, "auto">, AudioContainer> = {
  m4a: {
    makeFormat: () => new Mp4OutputFormat(),
    ext: "m4a",
    mime: "audio/mp4",
    codec: "aac",
  },
  ogg: {
    makeFormat: () => new OggOutputFormat(),
    ext: "ogg",
    mime: "audio/ogg",
    codec: "opus",
  },
  mp3: {
    makeFormat: () => new Mp3OutputFormat(),
    ext: "mp3",
    mime: "audio/mpeg",
    codec: "mp3",
  },
  flac: {
    makeFormat: () => new FlacOutputFormat(),
    ext: "flac",
    mime: "audio/flac",
    codec: "flac",
  },
  /** 무압축이지만 어떤 pcm이든 담긴다 — 모르는 코덱의 폴백이기도 하다. */
  wav: {
    makeFormat: () => new WavOutputFormat(),
    ext: "wav",
    mime: "audio/wav",
    codec: "pcm-s16",
  },
};

/** 원본 오디오 코덱 → 재인코딩 없이 담을 수 있는 형식. */
const CODEC_FORMAT: Record<string, Exclude<AudioFormatId, "auto">> = {
  aac: "m4a",
  opus: "ogg",
  vorbis: "ogg",
  mp3: "mp3",
  flac: "flac",
};

/** auto가 고르는 형식 — pcm은 wav, 모르는 코덱은 m4a(재인코딩)로. */
export function autoAudioFormat(
  audioCodec: string | null,
): Exclude<AudioFormatId, "auto"> {
  if (audioCodec?.startsWith("pcm")) return "wav";
  return CODEC_FORMAT[audioCodec ?? ""] ?? "m4a";
}

/** 형식이 실제로 쓰는 코덱. */
export function audioFormatCodec(
  format: AudioFormatId,
  audioCodec: string | null,
): AudioCodec {
  return AUDIO_CONTAINERS[format === "auto" ? autoAudioFormat(audioCodec) : format]
    .codec;
}

/** 브라우저가 인코딩할 수 있는 오디오 코덱만 남긴다(크롬엔 mp3 인코더가 없다). */
export async function encodableAudioCodecs(): Promise<Set<AudioCodec>> {
  const codecs = Object.values(AUDIO_CONTAINERS).map((c) => c.codec);
  const flags = await Promise.all(codecs.map((c) => canEncodeAudio(c)));
  return new Set(codecs.filter((_, i) => flags[i]));
}

/** 비트레이트 지정이 무의미한(무손실) 코덱. */
export function isLosslessAudioCodec(codec: AudioCodec): boolean {
  return codec === "flac" || codec.startsWith("pcm") || codec === "ulaw" || codec === "alaw";
}

export interface ExtractAudioOptions {
  /** null이면 전체 구간. */
  trim: { start: number; end: number } | null;
  audioCodec: string | null;
  /** 저장 형식. auto면 원본 코덱에 맞춰 고른다. */
  format: AudioFormatId;
  /** 지정 비트레이트(kbps). null이면 엔진 기본값(복사 가능하면 복사). */
  bitrateKbps: number | null;
  /** true면 1채널로 합친다. */
  mono: boolean;
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
  const formatId =
    opts.format === "auto" ? autoAudioFormat(opts.audioCodec) : opts.format;
  const container = AUDIO_CONTAINERS[formatId];
  // 코덱은 형식을 직접 고른 경우에만 못 박는다 — auto는 복사 가능성을 열어 둔다.
  const audio: ConversionAudioOptions = {};
  if (opts.format !== "auto") audio.codec = container.codec;
  if (opts.mono) audio.numberOfChannels = 1;
  if (opts.bitrateKbps && !isLosslessAudioCodec(container.codec)) {
    audio.quality = new Quality({ bitrate: Math.round(opts.bitrateKbps * 1000) });
  }
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
      audio,
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
