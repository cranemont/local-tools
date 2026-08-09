// 파일 판별 + 메타데이터 읽기 — mediabunny(순수 TS) 디먹싱.
import { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } from "mediabunny";
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
