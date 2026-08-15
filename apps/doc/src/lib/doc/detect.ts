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
 * `detect`에 건네야 할 앞부분 길이. HWP 5.0 서명이 헤더 스트림 안에 있어 512바이트 밖일 수
 * 있으므로 넉넉히 본다. 부르는 쪽마다 다른 숫자를 적으면 같은 파일이 자리에 따라 다르게
 * 판별될 수 있어 한 곳에 둔다.
 */
export const HEAD_BYTES = 4096;

const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

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

/** CFB 안이 한글 문서인지 — HWP 5.0은 FileHeader 스트림에 이 서명을 둔다. */
function looksLikeHwp5(bytes: Uint8Array): boolean {
  // 서명 "HWP Document File"은 헤더 스트림 안에 있어 앞 512바이트 밖일 수 있다.
  // 넉넉히 훑어서 있으면 hwp로 본다.
  const text = ascii(bytes, 0, Math.min(bytes.length, HEAD_BYTES));
  return text.includes("HWP Document File");
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
