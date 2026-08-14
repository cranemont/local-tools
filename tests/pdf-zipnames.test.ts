import { describe, it, expect } from "vitest";
import { uniqueNames } from "../apps/pdf/src/lib/pdf/zipnames";

/**
 * ZIP 항목 이름의 명세.
 *
 * ZIP은 `Record<이름, 바이트>`로 모아 만든다 — 이름이 같으면 **아무 말 없이
 * 덮어써진다.** 화면은 넣은 개수를 세어 "파일 N개 저장됨"이라고 적으므로,
 * 여기서 비켜 주지 않으면 그 줄이 거짓말이 된다.
 */
describe("ZIP 항목 이름 겹침 피하기", () => {
  it("겹치지 않으면 손대지 않는다", () => {
    expect(uniqueNames(["a.txt", "b.txt"])).toEqual(["a.txt", "b.txt"]);
  });

  it("★ 같은 이름이 둘이면 뒤엣것이 확장자 앞으로 번호를 받는다", () => {
    expect(uniqueNames(["a.txt", "a.txt"])).toEqual(["a.txt", "a-2.txt"]);
  });

  it("셋 이상이면 번호가 이어진다", () => {
    expect(uniqueNames(["a.txt", "a.txt", "a.txt"])).toEqual([
      "a.txt",
      "a-2.txt",
      "a-3.txt",
    ]);
  });

  it("★ 붙인 번호가 뒤에 오는 원래 이름과 또 겹치면 그것도 비켜난다", () => {
    expect(uniqueNames(["a.txt", "a.txt", "a-2.txt"])).toEqual([
      "a.txt",
      "a-2.txt",
      "a-2-2.txt",
    ]);
  });

  it("개수와 순서는 언제나 그대로다 — i번째가 i번째 파일의 이름이다", () => {
    const out = uniqueNames(["x.png", "y.png", "x.png", "y.png"]);
    expect(out.length).toBe(4);
    expect(out).toEqual(["x.png", "y.png", "x-2.png", "y-2.png"]);
  });

  it("점이 여럿이면 마지막 점부터가 확장자다", () => {
    expect(uniqueNames(["a.tar.gz", "a.tar.gz"])).toEqual([
      "a.tar.gz",
      "a.tar-2.gz",
    ]);
  });

  it("확장자가 없으면 이름 끝에 붙인다", () => {
    expect(uniqueNames(["report", "report"])).toEqual(["report", "report-2"]);
  });

  it("점으로 시작하는 이름은 확장자로 보지 않는다 — 이름이 사라지면 안 된다", () => {
    expect(uniqueNames([".hidden", ".hidden"])).toEqual([".hidden", ".hidden-2"]);
  });

  it("빈 목록은 빈 목록이다", () => {
    expect(uniqueNames([])).toEqual([]);
  });

  it("이미지 쪽 이름처럼 base가 같으면 쪽 번호까지 같아진다 — 그때가 실제로 부딪히는 자리다", () => {
    // 이름이 같은 PDF 두 개를 함께 끌어다 놓으면 이렇게 온다.
    expect(uniqueNames(["report-1.png", "report-1.png", "report-2.png"])).toEqual(
      ["report-1.png", "report-1-2.png", "report-2.png"],
    );
  });
});
