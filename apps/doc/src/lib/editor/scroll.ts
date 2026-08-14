/** 원본 판을 굴리는 자리 — 쪽 이동·찾기·목차가 전부 여기를 지난다.
 *
 * `scrollIntoView`를 쓰지 않는다. 그건 창까지 함께 굴려 앱을 위로 밀어내고(아래 설명
 * 영역으로) 편집 화면이 잘린 것처럼 보인다. 그래서 판 안에서만 직접 셈한다.
 */

/** 원본 판은 곧 스크롤 상자다(Pages.svelte의 `.pages`가 `data-pane="original"`). */
function originalPane(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-pane="original"]');
}

/** 상자 안에서 이 요소가 어디쯤인가. offsetParent가 무엇이든 같은 답이 나온다. */
function offsetIn(box: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
}

/**
 * 페이지 SVG 사용자 좌표 → 화면 배율. 아직 안 그린 쪽에서는 이웃 쪽에서 가져온다
 * (쪽마다 폭이 같으므로 값이 같다). 하나도 안 그려져 있으면 null.
 */
function scaleIn(box: HTMLElement, page: HTMLElement): number | null {
  for (const svg of [page.querySelector("svg"), box.querySelector(".page svg")]) {
    const width = (svg as SVGSVGElement | null)?.viewBox?.baseVal?.width ?? 0;
    if (svg && width > 0) return svg.getBoundingClientRect().width / width;
  }
  return null;
}

/**
 * 그 쪽으로 간다. `y`(페이지 안 세로 좌표)를 주면 그 자리가 화면 위쪽 1/4에 오게 맞춘다 —
 * 맨 위에 딱 붙이면 무엇을 찾았는지 눈에 안 들어온다.
 */
export function scrollToPage(page: number, y?: number): void {
  const box = originalPane();
  const el = box?.querySelector<HTMLElement>(`[data-page="${page}"]`);
  if (!box || !el) return;

  let top = offsetIn(box, el);
  if (y !== undefined) {
    const scale = scaleIn(box, el);
    if (scale !== null) top += Math.max(0, y * scale - box.clientHeight * 0.25);
  }
  box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/** 워드 문서에는 쪽이 없다 — 요소 하나를 받아 같은 방식으로 굴린다. */
export function scrollToElement(el: HTMLElement): void {
  const box = el.closest<HTMLElement>("[data-pane]");
  if (!box) return;
  box.scrollTo({
    top: Math.max(0, offsetIn(box, el) - box.clientHeight * 0.1),
    behavior: "smooth",
  });
}
