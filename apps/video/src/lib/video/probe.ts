// 파일 판별 + 메타데이터 읽기 — mediabunny(순수 TS) 디먹싱.
import {
  BlobSource,
  EncodedPacketSink,
  Input,
  MATROSKA,
  MP4,
  QTFF,
  WEBM,
  type Rotation,
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
  /** 평균 프레임레이트 — 프레임 단위 이동의 보폭. 잴 수 없으면 null. */
  fps: number | null;
  /**
   * 파일에 적힌 회전(시계 방향). 화면 크기(width·height)에는 이미 반영돼 있다.
   * 패킷 복사 판정에 쓴다 — 사용자가 회전을 안 걸어도 이 값이 0이 아니면 회전 메타데이터를
   * 쓸 수 없는 컨테이너에서 복사가 깨진다.
   */
  rotation: Rotation;
}

/** fps 추정에 쓸 패킷 수 — 앞부분만 훑어도 평균 프레임레이트는 충분히 정확하다. */
const FPS_SAMPLE_PACKETS = 120;

export async function probeVideo(file: File): Promise<VideoMeta> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error(t.errors.noVideoTrack(file.name));
    const audio = await input.getPrimaryAudioTrack();
    const durationS = await input.computeDuration();
    let fps: number | null = null;
    try {
      const stats = await video.computePacketStats(FPS_SAMPLE_PACKETS);
      if (stats.averagePacketRate > 0) fps = stats.averagePacketRate;
    } catch {
      // fps는 보폭 계산용 부가 정보 — 못 재도 편집은 계속한다.
    }
    return {
      width: video.displayWidth,
      height: video.displayHeight,
      durationS,
      videoCodec: video.codec,
      audioCodec: audio?.codec ?? null,
      hasAudio: audio !== null,
      fps,
      rotation: await video.getRotation(),
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
