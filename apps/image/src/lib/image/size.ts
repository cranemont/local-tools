// 크기 계산만 모은 자리 — 캔버스도 pica도 건드리지 않는 순수 함수들이다.
// pipeline.ts에서 갈라낸 이유는 둘이다: 화면 안내문(Panel)과 실제 파이프라인이 같은 함수를
// 부르게 하려는 것, 그리고 브라우저 없이 테스트할 수 있게 하려는 것(pipeline.ts는 최상단에서
// `new Pica()`를 부른다). 여기 규칙이 바뀌면 size.test.ts가 먼저 깨진다.

import type { FitMode, ImageItem, ResizeSpec } from "./types";

/** 회전만 적용한 크기 — 크롭 좌표계(CropRect)의 기준. */
export function rotatedSize(item: ImageItem): { w: number; h: number } {
  const swap = item.transform.rotation % 180 !== 0;
  return swap ? { w: item.height, h: item.width } : { w: item.width, h: item.height };
}

/** 장별 편집(회전·크롭) 적용 후 크기 — 리사이즈 입력의 기준. */
export function effectiveSize(item: ImageItem): { w: number; h: number } {
  const crop = item.transform.crop;
  return crop ? { w: crop.w, h: crop.h } : rotatedSize(item);
}

/** 리사이즈 설정을 적용한 목표 캔버스 크기. exact를 뺀 모드는 비율을 유지한다. */
export function targetSize(
  w: number,
  h: number,
  resize: ResizeSpec,
): { w: number; h: number } {
  const clamp = (n: number) => Math.max(1, Math.round(n));
  let out: { w: number; h: number };
  switch (resize.mode) {
    case "scale":
      // 배율은 사용자가 부른 배수 그 자체다 — 200%를 넣었으면 늘리는 게 맞아 noEnlarge를 타지 않는다.
      return { w: clamp((w * resize.scale) / 100), h: clamp((h * resize.scale) / 100) };
    case "width":
      out = { w: clamp(resize.width), h: clamp((h * resize.width) / w) };
      break;
    case "height":
      out = { w: clamp((w * resize.height) / h), h: clamp(resize.height) };
      break;
    case "longest":
      // 긴 변만 목표에 맞추고 짧은 변은 따라간다 — 위 두 분기를 방향만 골라 재사용.
      out =
        w >= h
          ? { w: clamp(resize.longest), h: clamp((h * resize.longest) / w) }
          : { w: clamp((w * resize.longest) / h), h: clamp(resize.longest) };
      break;
    case "exact":
      // 캔버스가 곧 목표다 — 원본이 작아도 줄이지 않는다(그림 배치는 fitPlan이 정한다).
      return { w: clamp(resize.width), h: clamp(resize.height) };
    default:
      return { w, h };
  }
  if (resize.noEnlarge && (out.w > w || out.h > h)) return { w, h };
  return out;
}

/** 목표 캔버스 위의 배치. 화면 안내문(Panel)도 같은 값을 읽어 도식과 결과가 어긋나지 않는다. */
export interface FitPlan {
  /** 캔버스에 실제로 그려지는 그림 크기 — contain이면 목표보다 작다(나머지는 여백). */
  draw: { w: number; h: number };
  /** 원본에서 쓰이는 영역 — cover면 원본보다 작다(나머지는 잘려 나간다). */
  src: { w: number; h: number };
}

/** 원본 bw×bh를 목표 tw×th에 어떻게 앉힐지 계산한다. */
export function fitPlan(
  bw: number,
  bh: number,
  tw: number,
  th: number,
  fit: FitMode,
): FitPlan {
  const clamp = (n: number) => Math.max(1, Math.round(n));
  if (fit === "contain") {
    const s = Math.min(tw / bw, th / bh);
    return { draw: { w: clamp(bw * s), h: clamp(bh * s) }, src: { w: bw, h: bh } };
  }
  if (fit === "cover") {
    // 목표 비율만큼만 남기고 원본을 깎는다 — 남은 쪽이 캔버스를 가득 채운다.
    const wide = bw / bh > tw / th;
    return {
      draw: { w: tw, h: th },
      src: wide
        ? { w: Math.min(bw, clamp((bh * tw) / th)), h: bh }
        : { w: bw, h: Math.min(bh, clamp((bw * th) / tw)) },
    };
  }
  return { draw: { w: tw, h: th }, src: { w: bw, h: bh } };
}

/** 이 설정에서 실제로 적용되는 맞춤 방식 — exact가 아니면 목표가 이미 비율을 지킨다. */
export function effectiveFit(resize: ResizeSpec): FitMode {
  return resize.mode === "exact" ? resize.fit : "stretch";
}
