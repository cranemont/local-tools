/** 놓인 파일이 무엇인지 가른다.
 *
 * 확장자만 믿지 않는다 — 메일로 온 문서는 이름이 자주 틀리고, 반대로 이름은 맞는데
 * 속이 옛 형식인 경우도 있다. 그래서 앞 몇 바이트를 보고, **왜 못 여는지**까지 말해 준다.
 * "열 수 없습니다"만 뜨는 화면이 제일 답답하다.
 */

export type DocKind = "hwp" | "hwpx" | "docx";

export interface Unsupported {
  kind: null;
  /** 사람에게 보여 줄 이유 */
  reason: string;
}

export type Detected = { kind: DocKind } | Unsupported;

/**
 * `detect`에 건네야 할 앞부분 길이.
 *
 * 한글 문서를 가르는 데 필요한 것은 둘이다 — CFB 헤더(앞 512바이트)가 가리키는 **디렉터리
 * 섹터**, 그리고 그것이 앞부분 밖일 때의 두 번째 단서인 `FileHeader` 스트림 안의 서명.
 * rhwp가 쓴 12,800바이트 hwp에서 디렉터리는 512바이트째, 서명은 8192바이트째에 있다.
 * 예전 값(4096)은 서명을 못 봐서 이름이 틀린 진짜 hwp가 `kind: null`로 떨어졌다.
 * 16KB면 서명이 들어오고, 섹터가 4096바이트인 CFB(디렉터리가 4096바이트째)도 여유가 있다.
 * 늘린 값이 일괄 변환에 지우는 비용은 파일당 6µs 안팎이다(400KB 파일 200개를 여닫으며
 * 앞부분만 읽으면 4KB에서 8.5ms, 64KB에서 9.8ms — 대부분 파일을 여닫는 시간이다).
 *
 * 부르는 쪽마다 다른 숫자를 적으면 같은 파일이 자리에 따라 다르게 판별될 수 있어 한 곳에 둔다.
 */
export const HEAD_BYTES = 16384;

const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** HWP 5.0 서명 — `FileHeader` 스트림 첫 32바이트의 앞부분. */
const HWP5_SIGNATURE = "HWP Document File";
/** HWP 5.0의 CFB에 언제나 있는 이름. 둘 이상 보이면 한글 문서로 본다. */
const HWP5_ENTRIES = ["FileHeader", "DocInfo", "BodyText"];

/** CFB 헤더(MS-CFB 2.2)에서 읽는 자리 — 섹터 크기 지수와 디렉터리 첫 섹터 번호. */
const CFB_HEADER_BYTES = 512;
const SECTOR_SHIFT_AT = 30;
const FIRST_DIR_SECTOR_AT = 48;
/** 디렉터리 항목 하나의 크기와, 그 안에서 이름·이름 길이·종류가 있는 자리(MS-CFB 2.6.1). */
const DIR_ENTRY_BYTES = 128;
const DIR_NAME_LEN_AT = 64;
const DIR_TYPE_AT = 66;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

function ascii(bytes: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(from, from + length));
}

/** ZIP 첫 항목의 이름 — hwpx는 `mimetype`, docx는 `[Content_Types].xml`로 시작한다. */
function firstZipEntryName(bytes: Uint8Array): string {
  if (bytes.length < 30) return "";
  const nameLength = bytes[26] | (bytes[27] << 8);
  if (nameLength <= 0 || bytes.length < 30 + nameLength) return "";
  return ascii(bytes, 30, nameLength);
}

/** 앞부분 안에 이 ASCII 글자가 있는가. 훑는 양이 커서 문자열로 만들지 않고 바이트로 찾는다. */
function includesAscii(bytes: Uint8Array, text: string): boolean {
  const first = text.charCodeAt(0);
  for (let at = 0; at + text.length <= bytes.length; at++) {
    if (bytes[at] !== first) continue;
    let same = true;
    for (let i = 1; i < text.length; i++) {
      if (bytes[at + i] !== text.charCodeAt(i)) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

/** CFB 디렉터리 항목의 이름(UTF-16LE). 그 자리가 항목이 아니면 null. */
function dirEntryName(view: DataView, at: number): string | null {
  const type = view.getUint8(at + DIR_TYPE_AT); // 1=저장소 2=스트림 5=루트, 0=미사용
  if (type !== 1 && type !== 2 && type !== 5) return null;
  const nameBytes = view.getUint16(at + DIR_NAME_LEN_AT, true); // 끝의 널 문자까지 센 길이
  if (nameBytes < 4 || nameBytes > 64) return null;
  let name = "";
  for (let i = 0; i < nameBytes - 2; i += 2) {
    name += String.fromCharCode(view.getUint16(at + i, true));
  }
  return name;
}

/**
 * CFB 디렉터리에 한글 문서의 이름이 있는가.
 *
 * 서명과 달리 이 자리는 계산할 수 있다 — 헤더가 섹터 크기와 디렉터리 첫 섹터 번호를 적어 둔다.
 * 항목 하나가 128바이트이고 이름은 UTF-16LE이므로, 그 자리부터 앞부분 끝까지 훑어 이름을 읽는다.
 * 이름 두 개를 요구하는 것은 다른 CFB 문서(.doc·.xls) 안에 우연히 같은 글자가 있어도
 * 한글로 읽지 않기 위해서다. 디렉터리가 파일 뒤쪽에 있으면 앞부분에 안 들어와 false다.
 */
function hasHwp5Directory(bytes: Uint8Array): boolean {
  if (bytes.length < CFB_HEADER_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shift = view.getUint16(SECTOR_SHIFT_AT, true);
  if (shift !== 9 && shift !== 12) return false; // 섹터는 512·4096 두 가지뿐이다
  const start = (view.getUint32(FIRST_DIR_SECTOR_AT, true) + 1) * (1 << shift);
  const found = new Set<string>();
  for (let at = start; at + DIR_ENTRY_BYTES <= bytes.length; at += DIR_ENTRY_BYTES) {
    const name = dirEntryName(view, at);
    if (name === null || !HWP5_ENTRIES.includes(name)) continue;
    found.add(name);
    if (found.size >= 2) return true;
  }
  return false;
}

/**
 * CFB 안이 한글 문서인지. 이름이 `.docx`로 잘못 붙은 hwp도 여기서 갈린다(CLAUDE.md 30번).
 * 두 통로가 있다 — 디렉터리 항목 이름(자리를 계산할 수 있다)과 FileHeader 스트림의 서명
 * (미니 스트림 안이라 자리가 파일마다 다르다. rhwp가 쓴 파일에서는 8192바이트째다).
 */
function looksLikeHwp5(bytes: Uint8Array): boolean {
  return hasHwp5Directory(bytes) || includesAscii(bytes, HWP5_SIGNATURE);
}

const extensionOf = (name: string): string => (name.split(".").pop() ?? "").toLowerCase();

export function detect(fileName: string, head: Uint8Array): Detected {
  const ext = extensionOf(fileName);

  if (startsWith(head, ZIP)) {
    const first = firstZipEntryName(head);
    if (first.startsWith("mimetype") || ext === "hwpx") return { kind: "hwpx" };
    if (first.startsWith("[Content_Types]") || ext === "docx") return { kind: "docx" };
    if (ext === "xlsx" || ext === "pptx") {
      return { kind: null, reason: `${ext === "xlsx" ? "엑셀" : "파워포인트"} 문서는 이 도구가 다루지 않아요.` };
    }
    return { kind: null, reason: "압축 파일 같은데 한글·워드 문서가 아니에요." };
  }

  if (startsWith(head, CFB)) {
    if (ext === "hwp" || looksLikeHwp5(head)) return { kind: "hwp" };
    if (ext === "doc") {
      return {
        kind: null,
        reason: "워드 97~2003 형식(.doc)은 열 수 없어요. 워드에서 .docx로 저장한 뒤 다시 시도해 주세요.",
      };
    }
    if (ext === "xls" || ext === "ppt") {
      return { kind: null, reason: "옛 오피스 형식(.xls·.ppt)은 이 도구가 다루지 않아요." };
    }
    return { kind: null, reason: "옛 마이크로소프트 형식 같은데 무엇인지 알 수 없어요." };
  }

  // HWP 3.0 이하 — rhwp도 열지 못하는 경우가 많아 미리 갈라 준다.
  if (ascii(head, 0, 22).startsWith("HWP Document File V3")) {
    return {
      kind: null,
      reason: "한글 3.0 이하 형식이에요. 한글에서 최신 형식(.hwp·.hwpx)으로 저장한 뒤 다시 시도해 주세요.",
    };
  }

  if (ascii(head, 0, 5) === "%PDF-") {
    return { kind: null, reason: "PDF는 브라우저가 그대로 열어 줘요. 편집은 PDF 도구를 써 주세요." };
  }

  if (ext === "hwp" || ext === "hwpx" || ext === "docx") {
    return { kind: null, reason: "확장자는 맞는데 파일이 손상된 것 같아요." };
  }

  return { kind: null, reason: "한글(.hwp·.hwpx)이나 워드(.docx) 문서를 놓아 주세요." };
}

/** 드롭존·파일 선택창이 받는 목록. */
export const ACCEPT = ".hwp,.hwpx,.docx";
