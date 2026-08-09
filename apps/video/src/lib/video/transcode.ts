// 트랜스코드 — mediabunny Conversion + WebCodecs.
// 정확 컷: 비디오 재인코딩(프리셋/타깃 비트레이트/해상도). 오디오는 가능하면 복사.
// 무손실 컷: 트랙 옵션을 비워 스마트 패스스루(패킷 복사) — 재인코딩 없음.
import {
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  type ConversionVideoOptions,
} from "mediabunny";
import { t } from "../i18n";
import { VIDEO_FORMATS } from "./probe";

export type CutMode = "exact" | "lossless";
export type PresetId = "small" | "balanced" | "high";

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
  const video: ConversionVideoOptions = { forceTranscode: true, codec: "avc" };

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
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: opts.trim ?? undefined,
      // 무손실: 옵션 없음 = 가능하면 패킷 복사. 오디오는 두 모드 모두 복사 우선.
      video: opts.mode === "exact" ? exactVideoOptions(opts) : {},
      showWarnings: false,
    });
    const audioDropped = conversion.discardedTracks.some((d) =>
      d.track.isAudioTrack(),
    );
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
    return { blob: new Blob([buffer], { type: "video/mp4" }), audioDropped };
  } finally {
    input.dispose();
  }
}
