// 파일 판별 + 메타데이터 읽기 — mediabunny(순수 TS) 디먹싱.
import {
  BlobSource,
  EncodedPacketSink,
  Input,
  MATROSKA,
  MP4,
  QTFF,
  WEBM,
} from "mediabunny";
import { t } from "../i18n";

export const VIDEO_FORMATS = [MP4, QTFF, WEBM, MATROSKA];
const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXT.has(ext);
}

export interface VideoMeta {
  width: number;
  height: number;
  durationS: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

export async function probeVideo(file: File): Promise<VideoMeta> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error(t.errors.noVideoTrack(file.name));
    const audio = await input.getPrimaryAudioTrack();
    const durationS = await input.computeDuration();
    return {
      width: video.displayWidth,
      height: video.displayHeight,
      durationS,
      videoCodec: video.codec,
      audioCodec: audio?.codec ?? null,
      hasAudio: audio !== null,
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error(t.errors.decodeFail(file.name));
  } finally {
    input.dispose();
  }
}

/** 폭주 방지 상한 — 이보다 많으면 스냅·눈금 용도로는 이미 충분하다. */
const MAX_KEYFRAMES = 5000;

/** 비디오 트랙의 키프레임 시각(초) 목록 — 무손실 컷 스냅·타임라인 눈금용. */
export async function getKeyframeTimes(file: File): Promise<number[]> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const sink = new EncodedPacketSink(track);
    const times: number[] = [];
    let packet = await sink.getFirstKeyPacket({ metadataOnly: true });
    while (packet && times.length < MAX_KEYFRAMES) {
      times.push(packet.timestamp);
      packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
    }
    return times;
  } catch {
    return []; // 스냅은 부가 기능 — 실패해도 편집은 계속
  } finally {
    input.dispose();
  }
}
