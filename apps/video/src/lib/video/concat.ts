// 여러 구간을 한 파일로 잇는다.
//
// mediabunny 1.52.3에는 여러 입력 구간을 한 Output에 먹이는 API가 없다.
// `Conversion`은 입력 하나를 통째로 맡고 `trim`도 한 쌍뿐이며, `ConversionOptions.composable`은
// 같은 Output에 **트랙을 하나 더** 붙이는 옵션이라 이어붙이기가 아니다
// (node_modules/mediabunny/dist/mediabunny.d.ts:1120 주석). `SegmentedInput`은 HLS 전용이고
// export 되지도 않는다. 그래서 Output에 `EncodedVideoPacketSource`·`EncodedAudioPacketSource`를
// 직접 달고 패킷을 순서대로 밀어 넣는다.
//
// 두 갈래다.
//  · copyConcat   — 원본 패킷을 그대로 옮긴다. 재인코딩이 없다.
//                   조건은 `segments.checkLosslessConcat`이 판정한다.
//  · recodeConcat — 구간마다 Conversion(=transcodeMp4)을 돌려 중간 파일을 만들고,
//                   그 패킷을 같은 방식으로 잇는다. 인코더 설정이 구간마다 같으므로
//                   코덱 파라미터도 같다 — 그래도 첫 조각과 다르면 거부한다.
//
// 왜 무손실을 Conversion에 맡기지 않는가: conversion.ts의 `needsTranscode`에
// `firstTimestamp < this._startTimestamp`가 들어 있어서(src/conversion.ts:1362),
// 시작을 조금이라도 자른 순간 패킷 복사 경로가 꺼진다. 구간 잘라 잇기는 언제나 그 경우다.
import {
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  type AudioCodec,
  type EncodedPacket,
  type InputAudioTrack,
  type InputVideoTrack,
  type OutputFormat,
  type Rotation,
  type VideoCodec,
} from "mediabunny";
import { t } from "../i18n";
import { VIDEO_FORMATS } from "./probe";
import { overallProgress, segmentWeights, type Segment } from "./segments";
import {
  combineRotation,
  transcodeMp4,
  type ContainerId,
  type TranscodeOptions,
} from "./transcode";

/** 재인코딩 경로에서 1단계(구간별 인코딩)가 가져가는 진행률 몫. 2단계는 읽고 쓰기만 한다. */
const ENCODE_SHARE = 0.92;

export function makeOutputFormat(container: ContainerId): OutputFormat {
  return container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();
}

/** 이 컨테이너가 복사로 담을 수 있는 오디오 코덱인지 — mediabunny의 표를 그대로 묻는다. */
export function containerAcceptsAudio(
  audioCodec: string | null,
  container: ContainerId,
): boolean {
  if (audioCodec === null) return true; // 담을 소리가 없다
  return (makeOutputFormat(container).getSupportedAudioCodecs() as string[]).includes(
    audioCodec,
  );
}

export interface ConcatOptions {
  file: File;
  /** 정규화된 구간 목록. 목록 순서가 출력 순서다. */
  segments: readonly Segment[];
  container: ContainerId;
  mute: boolean;
  /** true면 패킷 복사, false면 구간마다 재인코딩한 뒤 잇는다. */
  copy: boolean;
  /** 복사 경로에서 컨테이너 회전 메타데이터에 더할 각도. */
  rotate: Rotation;
  /** 재인코딩 경로가 구간마다 쓸 옵션. 호출부(Panel)가 화면 설정을 그대로 넘긴다. */
  transcodeOptions: (
    seg: Segment,
  ) => Omit<TranscodeOptions, "onProgress" | "registerCancel">;
  onProgress?: (progress: number) => void;
  registerCancel?: (cancel: () => void) => void;
}

export interface ConcatResult {
  /** 취소되면 null. */
  blob: Blob | null;
  /** 오디오 트랙이 처리 불가로 제외됐는지. */
  audioDropped: boolean;
}

export async function concatSegments(opts: ConcatOptions): Promise<ConcatResult> {
  if (opts.segments.length === 0) throw new Error(t.errors.encodeFail);
  return opts.copy ? copyConcat(opts) : recodeConcat(opts);
}

function mimeOf(container: ContainerId): string {
  return container === "webm" ? "video/webm" : "video/mp4";
}

/** 취소 깃발 — 패킷 루프는 매 패킷마다 이걸 본다. */
class CancelFlag {
  canceled = false;
  cancel = (): void => {
    this.canceled = true;
  };
}

// ── 복사 경로 ────────────────────────────────────────────────────────────────

async function copyConcat(opts: ConcatOptions): Promise<ConcatResult> {
  const flag = new CancelFlag();
  opts.registerCancel?.(flag.cancel);

  const input = new Input({ source: new BlobSource(opts.file), formats: VIDEO_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    const videoCodec = await videoTrack?.getCodec();
    if (!videoTrack || !videoCodec) throw new Error(t.errors.encodeFail);

    const audioTrack = opts.mute ? null : await input.getPrimaryAudioTrack();
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
    const format = makeOutputFormat(opts.container);
    const useAudio =
      audioTrack !== null &&
      audioCodec !== null &&
      (format.getSupportedAudioCodecs() as string[]).includes(audioCodec);

    // 파일에 적힌 회전까지 더한 값이다. WebM은 회전 메타데이터를 안 쓰므로 0이 아니면
    // addVideoTrack이 던진다 — 그 조합은 복사로 담을 수 없으니 재인코딩으로 물러난다.
    // (호출부가 rotationBreaksCopy로 같은 판정을 하지만 여기서도 막아 둔다.)
    const rotation = combineRotation(await videoTrack.getRotation(), opts.rotate);
    if (rotation !== 0 && !format.supportsVideoRotationMetadata) {
      return await recodeConcat(opts);
    }

    const output = new Output({ format, target: new BufferTarget() });
    // 여기서부터는 던져도 Output을 닫고 나간다. 안 닫으면 트랙 소스가 열린 채 남는다.
    try {
      const videoSource = new EncodedVideoPacketSource(videoCodec);
      output.addVideoTrack(videoSource, { rotation });
      const audioSource =
        useAudio && audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
      if (audioSource) output.addAudioTrack(audioSource);
      await output.start();

      const videoMeta: EncodedVideoChunkMetadata = {
        decoderConfig: (await videoTrack.getDecoderConfig()) ?? undefined,
      };
      const audioMeta: EncodedAudioChunkMetadata | undefined =
        audioSource && audioTrack
          ? { decoderConfig: (await audioTrack.getDecoderConfig()) ?? undefined }
          : undefined;

      const videoSink = new EncodedPacketSink(videoTrack);
      const audioSink = audioSource && audioTrack ? new EncodedPacketSink(audioTrack) : null;
      const weights = segmentWeights(opts.segments);
      /** 출력 시간축에서 지금까지 쓴 끝. 다음 구간은 여기서 시작한다. */
      let cursor = 0;

      for (let i = 0; i < opts.segments.length; i++) {
        const seg = opts.segments[i];
        // 시작은 그 자리의 키프레임으로 내려간다. checkLosslessConcat이 통과한 목록이면
        // 이미 키프레임이라 같은 값이지만, 여기서 한 번 더 맞춰야 앞 GOP가 깨지지 않는다.
        const first = await videoSink.getKeyPacket(seg.start, { verifyKeyPackets: true });
        const from = first ? first.timestamp : 0;
        const offset = cursor - from;
        const span = Math.max(1e-6, seg.end - from);
        let lastEnd = from;

        // verifyKeyPackets: 컨테이너가 적어 둔 key/delta 표시가 틀릴 수 있어 비트스트림을 본다.
        // mediabunny의 복사 경로도 비디오에만 이 옵션을 건다(src/conversion.ts).
        for await (const packet of videoSink.packets(first ?? undefined, undefined, {
          verifyKeyPackets: true,
        })) {
          if (flag.canceled) return await abort(output);
          if (packet.timestamp >= seg.end) break;
          await videoSource.add(
            packet.clone({ timestamp: packet.timestamp + offset }),
            videoMeta,
          );
          lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
          opts.onProgress?.(
            overallProgress(weights, i, (packet.timestamp - from) / span),
          );
        }

        if (audioSink && audioSource) {
          // 오디오는 구간 시작을 걸친 패킷을 버린다 — 복사 경로에서는 패킷 안을 자를 수 없다.
          // 코덱에 따라 앞부분 20ms 안팎이 빠진다.
          const seed = await audioSink.getPacket(from);
          for await (const packet of audioSink.packets(seed ?? undefined)) {
            if (flag.canceled) return await abort(output);
            if (packet.timestamp >= seg.end) break;
            if (packet.timestamp < from - 1e-9) continue;
            await audioSource.add(
              packet.clone({ timestamp: packet.timestamp + offset }),
              audioMeta,
            );
            lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
          }
        }

        cursor = Math.max(cursor, lastEnd + offset);
        opts.onProgress?.(overallProgress(weights, i, 1));
      }

      videoSource.close();
      audioSource?.close();
      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer) throw new Error(t.errors.encodeFail);
      return {
        blob: new Blob([buffer], { type: mimeOf(opts.container) }),
        audioDropped: !opts.mute && audioTrack !== null && !useAudio,
      };
    } catch (err) {
      await output.cancel();
      throw err;
    }
  } finally {
    input.dispose();
  }
}

async function abort(output: Output): Promise<ConcatResult> {
  await output.cancel();
  return { blob: null, audioDropped: false };
}

// ── 재인코딩 경로 ────────────────────────────────────────────────────────────

async function recodeConcat(opts: ConcatOptions): Promise<ConcatResult> {
  const weights = segmentWeights(opts.segments);
  const parts: Blob[] = [];
  let audioDropped = false;
  let aborted = false;

  for (let i = 0; i < opts.segments.length; i++) {
    const seg = opts.segments[i];
    const res = await transcodeMp4(opts.file, {
      ...opts.transcodeOptions(seg),
      onProgress: (p) =>
        opts.onProgress?.(overallProgress(weights, i, p) * ENCODE_SHARE),
      registerCancel: (cancel) =>
        opts.registerCancel?.(() => {
          aborted = true;
          cancel();
        }),
    });
    if (!res.blob) return { blob: null, audioDropped };
    audioDropped ||= res.audioDropped;
    parts.push(res.blob);
    if (aborted) return { blob: null, audioDropped };
  }

  const blob = await remuxParts(parts, opts, (p) =>
    opts.onProgress?.(ENCODE_SHARE + p * (1 - ENCODE_SHARE)),
  );
  return { blob, audioDropped };
}

/** 디코더 설정이 조각마다 같은지 — 다르면 첫 조각의 설정으로 뒤 조각이 깨져 나간다. */
function sameDecoderConfig(
  a: VideoDecoderConfig | AudioDecoderConfig | null,
  b: VideoDecoderConfig | AudioDecoderConfig | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.codec !== b.codec) return false;
  const da = descriptionBytes(a.description);
  const db = descriptionBytes(b.description);
  if (da === null || db === null) return da === db;
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
  return true;
}

function descriptionBytes(
  desc: AllowSharedBufferSource | undefined,
): Uint8Array | null {
  if (!desc) return null;
  return ArrayBuffer.isView(desc)
    ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
    : new Uint8Array(desc);
}

/** 중간 파일들을 패킷 단위로 이어 한 파일로. 각 조각은 0에서 시작하는 완결된 파일이다. */
async function remuxParts(
  parts: readonly Blob[],
  opts: ConcatOptions,
  onProgress: (p: number) => void,
): Promise<Blob | null> {
  const flag = new CancelFlag();
  opts.registerCancel?.(flag.cancel);

  const inputs = parts.map(
    (blob) => new Input({ source: new BlobSource(blob), formats: VIDEO_FORMATS }),
  );
  try {
    const videoTracks: InputVideoTrack[] = [];
    const audioTracks: (InputAudioTrack | null)[] = [];
    for (const input of inputs) {
      const v = await input.getPrimaryVideoTrack();
      if (!v) throw new Error(t.errors.encodeFail);
      videoTracks.push(v);
      audioTracks.push(opts.mute ? null : await input.getPrimaryAudioTrack());
    }

    const videoCodec = await videoTracks[0].getCodec();
    if (!videoCodec) throw new Error(t.errors.encodeFail);
    const audioCodec = audioTracks[0] ? await audioTracks[0].getCodec() : null;
    const useAudio = audioTracks.every((a) => a !== null) && audioCodec !== null;

    const videoConfig = await videoTracks[0].getDecoderConfig();
    const audioConfig = useAudio ? await audioTracks[0]!.getDecoderConfig() : null;
    for (let i = 1; i < inputs.length; i++) {
      const vc = await videoTracks[i].getDecoderConfig();
      if ((await videoTracks[i].getCodec()) !== videoCodec) {
        throw new Error(t.errors.concatMismatch);
      }
      if (!sameDecoderConfig(videoConfig, vc)) throw new Error(t.errors.concatMismatch);
      if (useAudio) {
        const ac = await audioTracks[i]!.getDecoderConfig();
        if (!sameDecoderConfig(audioConfig, ac)) throw new Error(t.errors.concatMismatch);
      }
    }

    const output = new Output({
      format: makeOutputFormat(opts.container),
      target: new BufferTarget(),
    });
    // 던져도 Output을 닫고 나간다 — copyConcat과 같은 규약이다.
    try {
      const videoSource = new EncodedVideoPacketSource(videoCodec as VideoCodec);
      // 회전은 1단계에서 이미 걸렸다 — mp4면 메타데이터로, webm이면 픽셀에.
      // 메타데이터 쪽은 조각에만 남아 있으므로 여기서 다시 적어 준다.
      output.addVideoTrack(videoSource, {
        rotation: await videoTracks[0].getRotation(),
      });
      const audioSource = useAudio
        ? new EncodedAudioPacketSource(audioCodec as AudioCodec)
        : null;
      if (audioSource) output.addAudioTrack(audioSource);
      await output.start();

      const videoMeta: EncodedVideoChunkMetadata = {
        decoderConfig: videoConfig ?? undefined,
      };
      const audioMeta: EncodedAudioChunkMetadata | undefined = audioSource
        ? { decoderConfig: audioConfig ?? undefined }
        : undefined;

      const durations: number[] = [];
      for (const input of inputs) durations.push(await input.computeDuration());
      const weights = segmentWeights(durations.map((d) => ({ start: 0, end: d })));
      let cursor = 0;

      for (let i = 0; i < inputs.length; i++) {
        const offset = cursor;
        let lastEnd = 0;
        // 진행률은 비디오 쪽에서만 올린다 — 두 트랙이 각자 0에서 다시 세면 막대가 뒤로 간다.
        // key/delta 검증도 비디오에만 건다(mediabunny의 복사 경로와 같은 선택).
        const pump = async (
          track: InputVideoTrack | InputAudioTrack,
          add: (p: EncodedPacket) => Promise<void>,
          isVideo: boolean,
        ): Promise<boolean> => {
          const sink = new EncodedPacketSink(track);
          for await (const packet of sink.packets(undefined, undefined, {
            verifyKeyPackets: isVideo,
          })) {
            if (flag.canceled) return false;
            await add(packet.clone({ timestamp: packet.timestamp + offset }));
            lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
            if (isVideo) {
              onProgress(
                overallProgress(
                  weights,
                  i,
                  packet.timestamp / Math.max(1e-6, durations[i]),
                ),
              );
            }
          }
          return true;
        };

        if (!(await pump(videoTracks[i], (p) => videoSource.add(p, videoMeta), true))) {
          await output.cancel();
          return null;
        }
        if (audioSource && audioTracks[i]) {
          if (!(await pump(audioTracks[i]!, (p) => audioSource.add(p, audioMeta), false))) {
            await output.cancel();
            return null;
          }
        }
        cursor = offset + lastEnd;
        onProgress(overallProgress(weights, i, 1));
      }

      videoSource.close();
      audioSource?.close();
      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer) throw new Error(t.errors.encodeFail);
      return new Blob([buffer], { type: mimeOf(opts.container) });
    } catch (err) {
      await output.cancel();
      throw err;
    }
  } finally {
    for (const input of inputs) input.dispose();
  }
}
