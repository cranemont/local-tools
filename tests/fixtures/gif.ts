/** GIF 표본 — gifenc로 짓고, LZW를 안 푸는 판독기로 되읽는다.
 *
 * 공통 규약(import 경로·바이너리 금지·결정성)은 `tests/fixtures/pdf.ts` 머리말에 있다.
 *
 * 판독기가 픽셀을 안 푸는 이유는 재는 것이 픽셀이 아니라 **구조**라서다 — 논리 화면 크기,
 * 루프 횟수, 프레임 수, 프레임별 딜레이·disposal·투명 플래그. LZW 압축 자료는 서브블록
 * 길이만 따라 건너뛴다. 딜레이는 1/100초 눈금이라 되읽으면 10ms 배수로 돌아온다
 * (CLAUDE.md 24번).
 */

import * as gifenc from "../../apps/gif/node_modules/gifenc";

import { makeRgba, type ImageSpec, type Rgba } from "./image";

/**
 * gifenc 1.0.3에는 타입 선언이 없다. 앱은 `apps/gif/src/lib/gif/gifenc.d.ts`의
 * `declare module "gifenc"`로 메우는데, 그 선언은 **이름으로 부를 때만** 걸린다 —
 * 경로로 부르는 여기서는 안 걸리므로 쓰는 세 함수의 모양만 여기 적는다.
 */
interface GifencApi {
  GIFEncoder: () => {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette?: number[][];
        delay?: number;
        dispose?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  quantize: (rgba: Uint8Array | Uint8ClampedArray, maxColors: number) => number[][];
  applyPalette: (
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
  ) => Uint8Array;
}

const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as GifencApi;

/**
 * 앱이 부르는 것과 같은 gifenc 세 함수. 여기서 내보내는 이유는 타입 하나 때문이다 —
 * 경로로 부르면 `gifenc.d.ts`가 안 걸리므로 위 GifencApi가 유일한 모양이고,
 * 그것을 테스트마다 다시 적으면 세 벌이 갈라진다.
 */
export { GIFEncoder, quantize, applyPalette };
export type GifEncoderInstance = ReturnType<GifencApi["GIFEncoder"]>;

export interface GifFrameSpec {
  /** 이 프레임의 픽셀. 안 주면 `seed`만 다른 잔 무늬를 그린다. */
  image?: Rgba;
  /** 화면에 머무는 시간(ms). 1/100초 눈금으로 반올림돼 들어간다. */
  delayMs?: number;
  /** 처리 방식 — 0 지정 안 함, 1 그대로 두기, 2 배경으로 지우기, 3 이전으로 되돌리기. */
  dispose?: number;
}

export interface GifOptions {
  /** 반복 횟수. 0이면 무한, 음수면 NETSCAPE 확장을 안 쓴다(한 번만 재생). */
  loop?: number;
  /** 프레임 픽셀을 안 줄 때 쓸 무늬 명세. */
  spec?: ImageSpec;
}

/**
 * 프레임 여러 장짜리 GIF.
 *
 * 팔레트는 첫 프레임에서 한 번 뽑아 모든 프레임이 함께 쓴다 — 전역 색표 하나만 있고
 * 지역 색표는 없는 형태다. 프레임마다 색표를 따로 넣으면 구조가 흔들려 판독기 테스트가
 * 무엇을 재는지 흐려진다.
 */
export function makeGif(frames: GifFrameSpec[], options: GifOptions = {}): Uint8Array {
  if (frames.length === 0) throw new Error("makeGif: 프레임이 없다");

  const images = frames.map(
    (frame, i) => frame.image ?? makeRgba({ seed: i + 1, ...options.spec }),
  );
  const { width, height } = images[0];
  for (const image of images) {
    if (image.width !== width || image.height !== height) {
      throw new Error("makeGif: 프레임 크기가 서로 다르다");
    }
  }

  const palette = quantize(new Uint8Array(images[0].data.buffer.slice(0)), 256);
  const gif = GIFEncoder();

  images.forEach((image, i) => {
    const bytes = new Uint8Array(image.data.buffer.slice(0));
    const index = applyPalette(bytes, palette);
    gif.writeFrame(index, width, height, {
      palette: i === 0 ? palette : undefined,
      delay: frames[i].delayMs ?? 100,
      dispose: frames[i].dispose ?? -1,
      repeat: options.loop ?? 0,
    });
  });

  gif.finish();
  return gif.bytes();
}

/** 프레임 `count`장, 딜레이는 전부 같은 GIF. */
export function makeGifFrames(count: number, delayMs = 100, options: GifOptions = {}): Uint8Array {
  const frames: GifFrameSpec[] = [];
  for (let i = 0; i < count; i++) frames.push({ delayMs });
  return makeGif(frames, options);
}

// ── 판독기 ────────────────────────────────────────────────────────

export interface GifFrameInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 되읽은 딜레이(ms). 1/100초 눈금이라 10의 배수다. */
  delayMs: number;
  dispose: number;
  transparent: boolean;
  transparentIndex: number;
  /** 이 프레임이 지역 색표를 들고 있나. */
  localPalette: boolean;
  /** 지역 색표의 칸 수(없으면 0). 팔레트 길이가 아니라 **파일이 잡아 둔 칸 수**다 —
   *  GIF 색표는 2의 거듭제곱이라 255색을 넘기면 256칸이 된다. */
  localPaletteSize: number;
}

export interface GifInfo {
  /** "87a" 또는 "89a". */
  version: string;
  width: number;
  height: number;
  globalPalette: boolean;
  /** 전역 색표의 칸 수(색표가 없으면 0). */
  globalPaletteSize: number;
  /** 반복 횟수. NETSCAPE 확장이 없으면 null이다. */
  loop: number | null;
  frames: GifFrameInfo[];
}

/** 헤더만 읽는다. 압축 자료는 서브블록 길이를 따라 건너뛴다. */
export function readGif(bytes: Uint8Array): GifInfo {
  const u16 = (at: number): number => bytes[at] | (bytes[at + 1] << 8);
  const ascii = (at: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(at, at + length));

  if (ascii(0, 3) !== "GIF") throw new Error("readGif: GIF 서명이 아니다");
  const version = ascii(3, 3);

  const width = u16(6);
  const height = u16(8);
  const packed = bytes[10];
  const globalPalette = (packed & 0x80) !== 0;
  const globalPaletteSize = globalPalette ? 1 << ((packed & 7) + 1) : 0;

  let at = 13 + globalPaletteSize * 3;

  /** 서브블록 사슬을 건너뛰고 끝 다음 자리를 준다. */
  const skipBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length && bytes[p] !== 0) p += 1 + bytes[p];
    return p + 1;
  };

  let loop: number | null = null;
  const frames: GifFrameInfo[] = [];
  let pending: { delayMs: number; dispose: number; transparent: boolean; transparentIndex: number } | null =
    null;

  while (at < bytes.length) {
    const marker = bytes[at++];

    if (marker === 0x3b) break; // 트레일러

    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        const size = bytes[at++];
        const flags = bytes[at];
        pending = {
          delayMs: u16(at + 1) * 10,
          dispose: (flags >> 2) & 7,
          transparent: (flags & 1) === 1,
          transparentIndex: bytes[at + 3],
        };
        at = skipBlocks(at + size);
      } else if (label === 0xff) {
        const size = bytes[at++];
        const id = ascii(at, size);
        at += size;
        if (id === "NETSCAPE2.0") {
          const length = bytes[at];
          if (length >= 3 && bytes[at + 1] === 1) loop = u16(at + 2);
        }
        at = skipBlocks(at);
      } else {
        at = skipBlocks(at);
      }
      continue;
    }

    if (marker === 0x2c) {
      const x = u16(at);
      const y = u16(at + 2);
      const frameWidth = u16(at + 4);
      const frameHeight = u16(at + 6);
      const framePacked = bytes[at + 8];
      at += 9;
      const localPalette = (framePacked & 0x80) !== 0;
      const localPaletteSize = localPalette ? 1 << ((framePacked & 7) + 1) : 0;
      at += localPaletteSize * 3;
      at += 1; // LZW 최소 코드 크기
      at = skipBlocks(at);

      frames.push({
        x,
        y,
        width: frameWidth,
        height: frameHeight,
        delayMs: pending?.delayMs ?? 0,
        dispose: pending?.dispose ?? 0,
        transparent: pending?.transparent ?? false,
        transparentIndex: pending?.transparentIndex ?? 0,
        localPalette,
        localPaletteSize,
      });
      pending = null;
      continue;
    }

    throw new Error(`readGif: 모르는 블록 0x${marker.toString(16)} (${at - 1}바이트째)`);
  }

  return { version, width, height, globalPalette, globalPaletteSize, loop, frames };
}

// ── 복원기 ────────────────────────────────────────────────────────
//
// readGif가 픽셀을 안 푸는 것은 그 함수가 구조만 재기 때문이고, 여기서는 LZW를 푼다.
// 재는 것이 "차분을 켠 파일과 끈 파일이 같은 그림인가"라서 화면에 얹은 뒤의 픽셀이
// 있어야 답이 나온다(CLAUDE.md 34번). 파서를 둘로 나눠 둔 이유도 그것이다 —
// 구조만 볼 때 LZW를 돌리면 500프레임짜리에서 쓸데없이 느려진다.
//
// 프레임 좌표(x·y)와 disposal 1·2·3을 다 따른다. gifenc는 x·y를 0으로 박아 쓰지만
// 크기는 프레임마다 다를 수 있고(1×1 건너뛰기 프레임), 그것이 화면의 어디를 덮는지는
// 복원기가 알아야 한다.

/** GIF LZW 한 덩어리를 푼다. 서브블록 사슬을 이어 읽고 끝난 자리를 함께 준다. */
function inflateLzw(
  bytes: Uint8Array,
  from: number,
  pixelCount: number,
): { pixels: Uint8Array; next: number } {
  const minCodeSize = bytes[from];
  let p = from + 1;
  const chunks: Uint8Array[] = [];
  while (p < bytes.length && bytes[p] !== 0) {
    chunks.push(bytes.subarray(p + 1, p + 1 + bytes[p]));
    p += 1 + bytes[p];
  }
  const next = p + 1;

  let size = 0;
  for (const chunk of chunks) size += chunk.length;
  const data = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.length;
  }

  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  for (let i = 0; i < clearCode; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }

  const pixels = new Uint8Array(pixelCount);
  let out = 0;
  let codeSize = minCodeSize + 1;
  let slot = endCode + 1;
  let previous = -1;
  let first = 0;
  let bits = 0;
  let bitCount = 0;
  let pos = 0;

  while (out < pixelCount) {
    while (bitCount < codeSize) {
      if (pos >= data.length) return { pixels, next };
      bits |= data[pos++] << bitCount;
      bitCount += 8;
    }
    const code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize;
    bitCount -= codeSize;

    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      slot = endCode + 1;
      previous = -1;
      continue;
    }
    if (code === endCode) break;

    let top = 0;
    let cur = code;
    if (code >= slot) {
      // 아직 사전에 없는 코드 — 앞 낱말 + 그 첫 글자다(KwKwK).
      if (previous < 0) break;
      stack[top++] = first;
      cur = previous;
    }
    while (cur >= clearCode) {
      stack[top++] = suffix[cur];
      cur = prefix[cur];
    }
    first = suffix[cur];
    stack[top++] = first;
    while (top > 0 && out < pixelCount) pixels[out++] = stack[--top];

    if (previous >= 0 && slot < 4096) {
      prefix[slot] = previous;
      suffix[slot] = first;
      slot++;
      if ((slot & (slot - 1)) === 0 && codeSize < 12) codeSize++;
    }
    previous = code;
  }
  return { pixels, next };
}

/**
 * 프레임을 차례로 얹으며 매번 화면 전체를 떠 준다 — 결과 길이는 프레임 수와 같고
 * 각 원소는 그 프레임까지 재생했을 때 보이는 그림이다.
 * 처음 화면은 알파 0이라, 첫 프레임이 덮지 않은 자리는 투명으로 남는다.
 */
export function decodeGifFrames(bytes: Uint8Array): Rgba[] {
  const u16 = (at: number): number => bytes[at] | (bytes[at + 1] << 8);
  if (String.fromCharCode(...bytes.subarray(0, 3)) !== "GIF") {
    throw new Error("decodeGifFrames: GIF 서명이 아니다");
  }

  const width = u16(6);
  const height = u16(8);
  const packed = bytes[10];
  let at = 13;
  let globalPalette: Uint8Array | null = null;
  if ((packed & 0x80) !== 0) {
    const size = 1 << ((packed & 7) + 1);
    globalPalette = bytes.subarray(at, at + size * 3);
    at += size * 3;
  }

  const skipBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length && bytes[p] !== 0) p += 1 + bytes[p];
    return p + 1;
  };

  const screen = new Uint8ClampedArray(width * height * 4);
  const out: Rgba[] = [];
  let control = { dispose: 0, transparent: false, transparentIndex: 0 };

  while (at < bytes.length) {
    const marker = bytes[at++];
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        const size = bytes[at++];
        const flags = bytes[at];
        control = {
          dispose: (flags >> 2) & 7,
          transparent: (flags & 1) === 1,
          transparentIndex: bytes[at + 3],
        };
        at = skipBlocks(at + size);
      } else {
        const size = bytes[at++];
        at = skipBlocks(at + size);
      }
      continue;
    }

    if (marker !== 0x2c) {
      throw new Error(`decodeGifFrames: 모르는 블록 0x${marker.toString(16)}`);
    }

    const fx = u16(at);
    const fy = u16(at + 2);
    const fw = u16(at + 4);
    const fh = u16(at + 6);
    const framePacked = bytes[at + 8];
    at += 9;
    let palette = globalPalette;
    if ((framePacked & 0x80) !== 0) {
      const size = 1 << ((framePacked & 7) + 1);
      palette = bytes.subarray(at, at + size * 3);
      at += size * 3;
    }
    if (!palette) throw new Error("decodeGifFrames: 색표가 없다");

    // disposal 3(이전으로 되돌리기)은 얹기 전 화면을 떠 둬야 한다.
    const saved = control.dispose === 3 ? Uint8ClampedArray.from(screen) : null;

    const { pixels, next } = inflateLzw(bytes, at, fw * fh);
    at = next;

    for (let y = 0; y < fh; y++) {
      const sy = fy + y;
      if (sy < 0 || sy >= height) continue;
      for (let x = 0; x < fw; x++) {
        const sx = fx + x;
        if (sx < 0 || sx >= width) continue;
        const index = pixels[y * fw + x];
        if (control.transparent && index === control.transparentIndex) continue;
        const to = (sy * width + sx) * 4;
        screen[to] = palette[index * 3];
        screen[to + 1] = palette[index * 3 + 1];
        screen[to + 2] = palette[index * 3 + 2];
        screen[to + 3] = 255;
      }
    }

    out.push({ width, height, data: Uint8ClampedArray.from(screen) });

    if (control.dispose === 2) {
      for (let y = fy; y < Math.min(height, fy + fh); y++) {
        for (let x = fx; x < Math.min(width, fx + fw); x++) {
          const to = (y * width + x) * 4;
          screen[to] = 0;
          screen[to + 1] = 0;
          screen[to + 2] = 0;
          screen[to + 3] = 0;
        }
      }
    } else if (control.dispose === 3 && saved) {
      screen.set(saved);
    }
    control = { dispose: 0, transparent: false, transparentIndex: 0 };
  }

  return out;
}
