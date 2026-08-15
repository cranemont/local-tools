/** 동영상 표본 — mediabunny로 WebM·MP4를 짓는다. 읽는 쪽도 mediabunny면 된다.
 *
 * 공통 규약(import 경로·바이너리 금지·결정성)은 `tests/fixtures/pdf.ts` 머리말에 있다.
 *
 * ## 이 표본에 없는 것: 픽셀
 *
 * 패킷 안은 프레임 번호로 채운 바이트고 VP9 비트스트림이 아니다. **디코딩은 못 잰다** —
 * 프레임을 그려 보는 자리(썸네일·재인코딩)는 WebCodecs가 필요하니 브라우저 층 몫이다.
 * 대신 컨테이너를 지나는 것은 잴 수 있다 — 메타데이터·키프레임 자리·패킷 복사.
 *
 * 채움 바이트가 곧 프레임 번호(`marker`)라서, 복사 경로가 **어느 패킷을 어느 순서로
 * 옮겼는지**를 바이트로 알아볼 수 있다. 구간 목록의 순서가 결과 순서인지(CLAUDE.md 33번)를
 * 재는 것이 이 표본의 첫 용도다. 프레임 수가 256을 넘으면 번호가 한 바퀴 돌아 겹친다.
 *
 * ## 회전은 MP4에만
 *
 * WebM에 0이 아닌 회전을 주면 mediabunny가 던진다("WebM does not support video rotation
 * metadata."). CLAUDE.md 25번이 말하는 그 자리이고, 표본 생성기가 그 사실을 감추지 않는다 —
 * 던지는 것 자체가 명세라서 `tests/video-editor.test.ts`가 그것을 못 박는다.
 *
 * ## 첫 패킷은 언제나 키프레임
 *
 * mediabunny가 "First packet must be a key packet."로 막는다. 그래서 키프레임 목록이
 * 0에서 시작하지 않는 파일은 이 생성기로 못 만든다.
 */

import {
  BlobSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  WEBM,
  WebMOutputFormat,
} from "mediabunny";

export type VideoContainer = "webm" | "mp4";
export type VideoRotation = 0 | 90 | 180 | 270;

export interface VideoSpec {
  /** 기본 webm. mp4는 회전 메타데이터를 실을 수 있다. */
  container?: VideoContainer;
  /** 총 프레임 수. 기본 20 — fps 10에서 2초짜리다. */
  frames?: number;
  fps?: number;
  /** 키프레임 간격(프레임). 기본 5 — fps 10이면 0·0.5·1·1.5초에 키프레임이 선다. */
  keyEvery?: number;
  width?: number;
  height?: number;
  /** 파일에 적어 둘 회전. **MP4에서만 쓸 수 있다.** */
  rotation?: VideoRotation;
}

const DEFAULTS = {
  container: "webm" as VideoContainer,
  frames: 20,
  fps: 10,
  keyEvery: 5,
  width: 320,
  height: 240,
  rotation: 0 as VideoRotation,
};

/** 패킷 한 개의 바이트 수. 내용은 프레임 번호로 채운다. */
const PACKET_BYTES = 64;

function formatOf(container: VideoContainer) {
  return container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();
}

export function mimeOf(container: VideoContainer): string {
  return container === "webm" ? "video/webm" : "video/mp4";
}

/**
 * 명세대로 동영상 한 개.
 *
 * 프레임 i는 `i/fps`초에 서고 길이는 `1/fps`초다. `i % keyEvery === 0`이면 키프레임이다.
 */
export async function makeVideo(spec: VideoSpec = {}): Promise<Uint8Array> {
  const { container, frames, fps, keyEvery, width, height, rotation } = {
    ...DEFAULTS,
    ...spec,
  };
  const output = new Output({ format: formatOf(container), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource("vp9");
  output.addVideoTrack(source, { frameRate: fps, rotation });
  await output.start();

  // 디코더 설정은 첫 패킷에만 붙인다 — 컨테이너가 트랙 머리에 한 번 적는 값이다.
  const meta: EncodedVideoChunkMetadata = {
    decoderConfig: { codec: "vp09.00.10.08", codedWidth: width, codedHeight: height },
  };
  for (let i = 0; i < frames; i++) {
    const data = new Uint8Array(PACKET_BYTES).fill(i & 0xff);
    const packet = new EncodedPacket(
      data,
      i % keyEvery === 0 ? "key" : "delta",
      i / fps,
      1 / fps,
    );
    await source.add(packet, i === 0 ? meta : undefined);
  }
  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("표본을 짓지 못했다");
  return new Uint8Array(buffer);
}

/** 바이트를 File로. 앱은 File만 받는다(`probeVideo`·`openFile`). */
export function videoFile(bytes: Uint8Array, name: string, type?: string): File {
  const ext = name.toLowerCase().endsWith(".mp4") ? "mp4" : "webm";
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([buffer], name, { type: type ?? mimeOf(ext as VideoContainer) });
}

/** 명세대로 지어 File까지. 이름은 컨테이너를 따른다. */
export async function makeVideoFile(spec: VideoSpec = {}, name?: string): Promise<File> {
  const container = spec.container ?? DEFAULTS.container;
  const bytes = await makeVideo(spec);
  return videoFile(bytes, name ?? `sample.${container}`, mimeOf(container));
}

/** 표본 확인용 — 비디오 패킷의 시각·종류와 채움 바이트(=원본 프레임 번호). */
export interface PacketInfo {
  timestamp: number;
  duration: number;
  type: "key" | "delta";
  /** 패킷 첫 바이트 = 이 패킷이 원본의 몇 번째 프레임이었는가. */
  marker: number;
}

/** 만들어진(또는 도구가 내놓은) 동영상의 비디오 패킷을 순서대로 읽는다. */
export async function readPackets(bytes: Uint8Array): Promise<PacketInfo[]> {
  const input = new Input({
    source: new BlobSource(videoFile(bytes, "read.webm")),
    formats: [MP4, QTFF, WEBM, MATROSKA],
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const sink = new EncodedPacketSink(track);
    const out: PacketInfo[] = [];
    for await (const packet of sink.packets()) {
      out.push({
        timestamp: packet.timestamp,
        duration: packet.duration,
        type: packet.type,
        marker: packet.data[0],
      });
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** 소수점 오차를 걷어낸 시각 목록 — 시각 비교는 이 값으로 한다. */
export function roundTimes(values: readonly number[], digits = 3): number[] {
  const scale = 10 ** digits;
  return values.map((v) => Math.round(v * scale) / scale);
}
