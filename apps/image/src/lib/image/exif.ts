// EXIF 추출·주입 — 순수 TS, wasm 없음.
// 유지 옵션: 원본(JPEG APP1 / WebP EXIF 청크 / PNG eXIf 청크)에서 TIFF 블록을 뽑아
// Orientation을 1로 중화한 뒤(디코딩 시 회전이 이미 픽셀에 구워지므로)
// 출력(JPEG APP1 / WebP VP8X+EXIF 청크)에 다시 심는다.
import exifr from "exifr";
import type { ImageItem } from "./types";

// ── 추출: 원본 바이트 → TIFF 블록 ─────────────────────────

export function extractExif(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Uint8Array<ArrayBuffer> | null {
  switch (mime) {
    case "image/jpeg":
      return fromJpeg(bytes);
    case "image/webp":
      return fromWebp(bytes);
    case "image/png":
      return fromPng(bytes);
    default:
      return null;
  }
}

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function hasExifPrefix(b: Uint8Array, o: number): boolean {
  return EXIF_PREFIX.every((v, i) => b[o + i] === v);
}

function fromJpeg(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const marker = b[o + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI/SOS — 이후엔 메타 없음
    const len = (b[o + 2] << 8) | b[o + 3];
    if (len < 2) break;
    if (marker === 0xe1 && len >= 8 && hasExifPrefix(b, o + 4)) {
      return b.slice(o + 10, o + 2 + len);
    }
    o += 2 + len;
  }
  return null;
}

function fromWebp(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (b.length < 16 || readFourCC(b, 0) !== "RIFF" || readFourCC(b, 8) !== "WEBP")
    return null;
  let o = 12;
  while (o + 8 <= b.length) {
    const four = readFourCC(b, o);
    const size = u32leRead(b, o + 4);
    if (four === "EXIF") {
      const start = o + 8;
      // 일부 라이터는 청크 안에 "Exif\0\0" 접두를 넣는다 — 있으면 벗긴다.
      const skip = hasExifPrefix(b, start) ? 6 : 0;
      return b.slice(start + skip, start + size);
    }
    o += 8 + size + (size % 2); // 홀수 크기는 패딩 1바이트
  }
  return null;
}

function fromPng(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  let o = 8;
  while (o + 8 <= b.length) {
    const len = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const type = readFourCC(b, o + 4);
    if (type === "eXIf") return b.slice(o + 8, o + 8 + len);
    if (type === "IEND") break;
    o += 12 + len; // len + type(4) + crc(4)
  }
  return null;
}

// ── Orientation 중화 (IFD0 tag 0x0112 → 1) ───────────────

export function neutralizeOrientation(tiff: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const b = tiff.slice();
  if (b.length < 8) return b;
  const little = b[0] === 0x49 && b[1] === 0x49; // "II"
  if (!little && !(b[0] === 0x4d && b[1] === 0x4d)) return b;
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) =>
    little
      ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
      : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  const ifd = u32(4);
  if (ifd + 2 > b.length) return b;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > b.length) break;
    if (u16(entry) === 0x0112) {
      // SHORT 값 4바이트 필드 — 1로 덮어쓴다.
      const v = entry + 8;
      b[v] = little ? 1 : 0;
      b[v + 1] = little ? 0 : 1;
      b[v + 2] = 0;
      b[v + 3] = 0;
      break;
    }
  }
  return b;
}

// ── 주입: 출력 바이트 + TIFF → 새 파일 바이트 ─────────────

/** JPEG 출력에 APP1(Exif) 삽입. TIFF가 세그먼트 한도를 넘으면 null. */
export function embedJpegExif(
  out: Uint8Array<ArrayBuffer>,
  tiff: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> | null {
  const payloadLen = tiff.length + 8; // len(2) + "Exif\0\0"(6)
  if (payloadLen > 0xffff) return null;
  if (out.length < 2 || out[0] !== 0xff || out[1] !== 0xd8) return null;

  // SOI 뒤, 연속된 APP0(JFIF) 뒤에 넣는다.
  let o = 2;
  while (o + 4 <= out.length && out[o] === 0xff && out[o + 1] === 0xe0) {
    o += 2 + ((out[o + 2] << 8) | out[o + 3]);
  }

  const seg = new Uint8Array(2 + payloadLen);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg[2] = (payloadLen >> 8) & 0xff;
  seg[3] = payloadLen & 0xff;
  seg.set(EXIF_PREFIX, 4);
  seg.set(tiff, 10);

  const result = new Uint8Array(out.length + seg.length);
  result.set(out.subarray(0, o));
  result.set(seg, o);
  result.set(out.subarray(o), o + seg.length);
  return result;
}

/** WebP 출력을 VP8X 확장 포맷으로 감싸 EXIF 청크를 덧붙인다. */
export function embedWebpExif(
  out: Uint8Array<ArrayBuffer>,
  tiff: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> | null {
  if (out.length < 16 || readFourCC(out, 0) !== "RIFF" || readFourCC(out, 8) !== "WEBP")
    return null;

  // 크롬 캔버스 출력이 이미 확장 포맷일 수 있다(ICCP 동봉 시 VP8X 존재) —
  // 그땐 EXIF 플래그만 세우고 청크를 끝에 덧붙인다.
  if (readFourCC(out, 12) === "VP8X") {
    const exifChunk = chunk("EXIF", tiff);
    const file = new Uint8Array(out.length + exifChunk.length);
    file.set(out);
    file.set(exifChunk, out.length);
    file[20] |= 0x08; // VP8X flags: EXIF
    u32leWrite(file, 4, file.length - 8);
    return file;
  }

  const hasLossless = readFourCC(out, 12) === "VP8L";
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x08 | (hasLossless ? 0x10 : 0); // EXIF (+ Alpha: VP8L은 알파 가능)
  u24le(vp8x, 4, width - 1);
  u24le(vp8x, 7, height - 1);

  const body = concat([
    chunk("VP8X", vp8x),
    out.slice(12), // 기존 이미지 청크 그대로
    chunk("EXIF", tiff),
  ]);
  const file = new Uint8Array(12 + body.length);
  file.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  u32leWrite(file, 4, 4 + body.length);
  file.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  file.set(body, 12);
  return file;
}

// ── 표시용 파싱 (exifr) ──────────────────────────────────

export interface ExifDisplay {
  date?: string;
  camera?: string;
  exposure?: string;
  gps?: string;
}

const PICK = [
  "Make",
  "Model",
  "DateTimeOriginal",
  "CreateDate",
  "FNumber",
  "ExposureTime",
  "ISO",
  "FocalLength",
];

export async function readExifDisplay(item: ImageItem): Promise<ExifDisplay | null> {
  let tags: Record<string, unknown> | undefined;
  let gps: { latitude?: number; longitude?: number } | null = null;
  try {
    tags = await exifr.parse(item.bytes, { pick: PICK });
  } catch {
    return null;
  }
  try {
    gps = await exifr.gps(item.bytes);
  } catch {
    gps = null;
  }
  if (!tags && !gps) return null;

  const display: ExifDisplay = {};
  const date = (tags?.DateTimeOriginal ?? tags?.CreateDate) as Date | undefined;
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    display.date = formatDate(date);
  }
  const make = typeof tags?.Make === "string" ? tags.Make.trim() : "";
  const model = typeof tags?.Model === "string" ? tags.Model.trim() : "";
  if (model) display.camera = model.startsWith(make) ? model : `${make} ${model}`.trim();
  else if (make) display.camera = make;

  const exposure: string[] = [];
  if (typeof tags?.FNumber === "number") exposure.push(`f/${tags.FNumber}`);
  if (typeof tags?.ExposureTime === "number") {
    exposure.push(
      tags.ExposureTime < 1
        ? `1/${Math.round(1 / tags.ExposureTime)}s`
        : `${tags.ExposureTime}s`,
    );
  }
  if (typeof tags?.ISO === "number") exposure.push(`ISO ${tags.ISO}`);
  if (typeof tags?.FocalLength === "number") exposure.push(`${tags.FocalLength}mm`);
  if (exposure.length) display.exposure = exposure.join(" · ");

  if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
    display.gps = `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}`;
  }

  return Object.keys(display).length ? display : null;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 바이트 유틸 ──────────────────────────────────────────

function readFourCC(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function u32leRead(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function u32leWrite(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
  b[o + 3] = (v >> 24) & 0xff;
}

function u24le(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
}

function chunk(fourcc: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const padded = data.length + (data.length % 2);
  const buf = new Uint8Array(8 + padded);
  for (let i = 0; i < 4; i++) buf[i] = fourcc.charCodeAt(i);
  u32leWrite(buf, 4, data.length);
  buf.set(data, 8);
  return buf;
}

function concat(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return buf;
}
