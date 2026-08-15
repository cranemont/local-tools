/**
 * hwp·docx 표본 — 브라우저 층용.
 *
 * `tests/fixtures/doc.ts`와 짓는 절차는 같다(`hwp-build.ts`를 함께 쓴다). 다른 것은 wasm을
 * 켜는 방법 하나다 — 그 파일은 `node_modules`의 `.wasm`을 읽어 직접 `init`하고, 여기서는
 * 앱의 `ensureEngine()`을 그대로 부른다. **그것이 이 층에서 재려는 것이기도 하다**:
 * 받아 오기 → SHA-384 검증 → `init`이 실제로 도는지는 node에서 볼 수 없다.
 */
import { HwpDocument } from "@rhwp/core";
import { buildHwp, type HwpSpec } from "../../../../tests/fixtures/hwp-build";
import { ensureEngine } from "../../src/lib/doc/engine";

export type { HwpSpec };
export { makeDocx, docFile } from "../../../../tests/fixtures/docx";

async function build(spec: HwpSpec) {
  await ensureEngine();
  return buildHwp(HwpDocument, spec);
}

/** 명세대로 지은 .hwp 바이트(HWP 5.0, CFB). */
export async function makeHwp(
  spec: HwpSpec = { paragraphs: ["첫 문단입니다"] },
): Promise<Uint8Array> {
  const doc = await build(spec);
  try {
    return doc.exportHwp();
  } finally {
    doc.free();
  }
}

/** 같은 명세의 .hwpx 바이트(ZIP). */
export async function makeHwpx(
  spec: HwpSpec = { paragraphs: ["첫 문단입니다"] },
): Promise<Uint8Array> {
  const doc = await build(spec);
  try {
    return doc.exportHwpx();
  } finally {
    doc.free();
  }
}

/** 비밀번호가 걸린 .hwp. 바이트는 결정적이지 않다(암호화가 난수를 쓴다). */
export async function makeEncryptedHwp(
  password: string,
  spec: HwpSpec = { paragraphs: ["잠긴 문서"] },
): Promise<Uint8Array> {
  const doc = await build(spec);
  try {
    return doc.exportHwpWithPassword(password);
  } finally {
    doc.free();
  }
}
