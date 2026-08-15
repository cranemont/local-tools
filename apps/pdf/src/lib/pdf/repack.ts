import { PDFDocument } from "pdf-lib";
import { rasterizePdf } from "./rasterize";

/**
 * 쪽을 그림으로 그려 PDF 한 장으로 다시 담는다.
 *
 * 엔진은 이미 있는 둘을 잇는 것뿐이다 — 그리기는 rasterize.ts(pdf.js), 담기는
 * pdf-lib. 그래서 이 길은 인터넷이 필요 없다.
 *
 * 나온 PDF에는 **글자 정보가 없다.** 선택·검색·복사가 안 되고 되돌릴 수 없다.
 * 부르는 쪽이 원본에 글자 레이어가 있는지 먼저 재서(extract.ts의 `probePdf`)
 * 경고를 띄운다.
 *
 * 암호가 걸린 문서는 rasterizePdf가 `PdfPasswordError`를 던진다 — 여기서 삼키지
 * 않고 그대로 올린다(부르는 쪽이 비밀번호를 물어 풀고 다시 부른다).
 */
export interface RepackOptions {
  /** 72dpi가 배율 1이다. */
  dpi: number;
  /** JPEG 품질 0~100. */
  quality: number;
}

export async function repackAsImages(
  name: string,
  bytes: Uint8Array,
  options: RepackOptions,
  onProgress?: (page: number, total: number) => void,
): Promise<Uint8Array> {
  const pages = await rasterizePdf(
    name,
    bytes,
    {
      dpi: options.dpi,
      format: "jpeg",
      quality: Math.min(1, Math.max(0.05, options.quality / 100)),
    },
    onProgress,
  );

  try {
    const out = await PDFDocument.create();
    // 쪽 크기는 픽셀이 아니라 포인트다 — 72dpi가 배율 1이므로 픽셀을 그 배율로 되돌리면
    // 원본과 같은 종이 크기가 나온다. 이 환산을 빼면 200dpi 결과가 A4의 2.8배가 된다.
    const scale = 72 / options.dpi;
    for (const page of pages) {
      const jpg = await out.embedJpg(await page.blob.arrayBuffer());
      const w = page.width * scale;
      const h = page.height * scale;
      const sheet = out.addPage([w, h]);
      sheet.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    }
    return await out.save();
  } finally {
    // rasterizePdf가 미리보기용 object URL을 만들어 준다 — 여기서는 안 쓰므로 바로 거둔다.
    // 목표 용량 탐색은 이 함수를 여러 번 부르니, 안 거두면 시도마다 한 벌씩 쌓인다.
    for (const page of pages) URL.revokeObjectURL(page.url);
  }
}
