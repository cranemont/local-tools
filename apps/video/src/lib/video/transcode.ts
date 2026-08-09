// 트랜스코드 — mediabunny Conversion + WebCodecs.
// 비디오는 재인코딩(정확 컷), 오디오는 가능하면 원본 패킷 복사.
import {
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import { t } from "../i18n";
import { VIDEO_FORMATS } from "./probe";

export interface TranscodeOptions {
  /** null이면 전체 구간. */
  trim: { start: number; end: number } | null;
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
      // 정확 컷: 비디오는 항상 재인코딩. 오디오는 옵션 없음 = 가능하면 복사.
      video: { forceTranscode: true, codec: "avc", quality: QUALITY_HIGH },
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
