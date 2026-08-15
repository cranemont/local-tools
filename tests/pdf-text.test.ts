import { describe, it, expect } from "vitest";
import {
  joinPages,
  layoutText,
  PAGE_BREAK,
  pieceFromMatrix,
  uprightCorrection,
  type LayoutOptions,
  type TextPiece,
} from "../apps/pdf/src/lib/pdf/text";

/**
 * 텍스트 재구성의 명세.
 *
 * PDF에는 "줄"도 "문단"도 없다. 글자 뭉치가 어디에 그려지는지만 있다. 그래서 줄과
 * 문단은 **좌표에서 되짚어 만드는 것**이고, 그 규칙이 여기 실행 가능한 형태로 있다.
 *
 * 좌표계 주의: 넘기는 좌표는 **화면 좌표**다 — x는 오른쪽, y는 **아래로** 갈수록 크다.
 * PDF 사용자 좌표(y가 위로 커진다)와 쪽 회전(/Rotate)은 부르는 쪽(extract.ts)이
 * 뷰포트 변환으로 걷어낸 뒤 넘긴다. 그 계약이 깨지면 어떻게 되는지도 아래에 있다.
 *
 * 기대값의 기준 치수: 글자 폭 6, 높이 12(12pt 라틴 본문에 가깝다). 그래서
 * 같은 줄 허용오차는 6(높이×0.5), 공백 기준 틈은 1.8(글자 폭×0.3)이다.
 */

const piece = (
  str: string,
  x: number,
  y: number,
  extra: Partial<TextPiece> = {},
): TextPiece => ({ str, x, y, width: str.length * 6, height: 12, ...extra });

/** 줄 목록만 볼 때 쓰는 지름길. */
const linesOf = (pieces: TextPiece[], options: LayoutOptions = {}) =>
  layoutText(pieces, options).lines.map((l) => l.text);

describe("줄 묶기 — 기준선 y로 모은다", () => {
  it("같은 기준선의 조각들은 한 줄이다", () => {
    const out = layoutText([piece("Hello", 0, 100), piece("world", 36, 100)]);
    expect(out.lines.length).toBe(1);
    expect(out.text).toBe("Hello world");
  });

  it("기준선이 미세하게 흔들려도 같은 줄이다 — 글자 높이의 절반까지는 봐준다", () => {
    // 같은 줄인데 조각마다 y가 조금씩 다른 것은 흔하다(글꼴이 섞이면 더 그렇다).
    expect(linesOf([piece("Hello", 0, 100), piece("world", 36, 100.4)])).toEqual(
      ["Hello world"],
    );
  });

  it("한 줄 높이만큼 내려가면 다른 줄이다", () => {
    expect(linesOf([piece("a", 0, 100), piece("b", 0, 114)])).toEqual([
      "a",
      "b",
    ]);
  });

  it("줄은 위에서 아래로 나온다 — 넘긴 순서와 무관하다", () => {
    expect(linesOf([piece("b", 0, 114), piece("a", 0, 100)])).toEqual([
      "a",
      "b",
    ]);
  });

  it("★ 허용오차만큼씩 조금씩 내려가도 사슬처럼 한 줄이 되지 않는다", () => {
    // 바로 앞 조각과만 재면 100→105→110→115가 전부 한 줄로 이어진다.
    // 묶음의 첫 조각(기준)과 재기 때문에 두 줄로 갈린다.
    expect(
      linesOf([
        piece("a", 0, 100),
        piece("b", 0, 105),
        piece("c", 0, 110),
        piece("d", 0, 115),
      ]),
    ).toEqual(["ab", "cd"]);
  });

  it("허용오차는 그 줄에서 제일 큰 글자를 따라간다 — 큰 제목 옆의 작은 글자도 같은 줄이다", () => {
    const big = piece("제목", 0, 100, { width: 60, height: 30 });
    const small = piece("주", 70, 112, { width: 8, height: 8 });
    expect(layoutText([big, small]).lines.length).toBe(1);
  });
});

describe("공백 추론 — pdf.js가 단어를 쪼개 주기도, 붙여 주기도 한다", () => {
  it("붙어 있는 조각은 그대로 잇는다 — 없는 공백을 만들지 않는다", () => {
    expect(linesOf([piece("abc", 0, 100), piece("def", 18, 100)])).toEqual([
      "abcdef",
    ]);
  });

  it("틈이 벌어지면 공백을 끼운다 — 이것이 단어 경계다", () => {
    expect(linesOf([piece("abc", 0, 100), piece("def", 24, 100)])).toEqual([
      "abc def",
    ]);
  });

  it("자간만큼의 틈은 공백이 아니다", () => {
    expect(linesOf([piece("abc", 0, 100), piece("def", 19, 100)])).toEqual([
      "abcdef",
    ]);
  });

  it("경계는 글자 한 개 폭의 0.3배다 — 그 위아래로 판단이 갈린다", () => {
    // 글자 폭 6 → 기준 틈 1.8. 오른쪽 끝이 18이므로 19.5는 아래, 20.5는 위다.
    expect(linesOf([piece("abc", 0, 100), piece("def", 19.5, 100)])).toEqual([
      "abcdef",
    ]);
    expect(linesOf([piece("abc", 0, 100), piece("def", 20.5, 100)])).toEqual([
      "abc def",
    ]);
  });

  it("★ 이미 공백 글자가 있으면 더 넣지 않는다 — 공백이 두 칸이 되던 자리다", () => {
    expect(linesOf([piece("abc ", 0, 100), piece("def", 30, 100)])).toEqual([
      "abc def",
    ]);
  });

  it("다음 조각이 공백으로 시작해도 더 넣지 않는다", () => {
    expect(linesOf([piece("abc", 0, 100), piece(" def", 24, 100)])).toEqual([
      "abc def",
    ]);
  });

  it("겹쳐 그려진 조각(음의 틈)에는 공백을 넣지 않는다", () => {
    expect(linesOf([piece("abc", 0, 100), piece("def", 12, 100)])).toEqual([
      "abcdef",
    ]);
  });

  it("★ 기준은 그 조각의 실제 글자 폭이다 — 폭이 넓은 한글에서 공백이 남발되던 자리다", () => {
    // 한글은 글자 하나가 높이만큼 넓다(폭 12) → 기준 틈은 3.6이 된다.
    const wide = { width: 24 };
    expect(
      linesOf([
        piece("가나", 0, 100, wide),
        piece("다라", 27, 100, wide), // 틈 3 — 자간이다
      ]),
    ).toEqual(["가나다라"]);
    expect(
      linesOf([
        piece("가나", 0, 100, wide),
        piece("다라", 30, 100, wide), // 틈 6 — 띄어쓰기다
      ]),
    ).toEqual(["가나 다라"]);
  });

  it("폭을 모르는 조각은 높이에서 짐작한다 — 던지지 않는다", () => {
    expect(
      linesOf([piece("abc", 0, 100, { width: 0 }), piece("def", 5, 100)]),
    ).toEqual(["abc def"]);
  });

  it("넓은 틈이든 좁은 틈이든 공백은 한 개다 — 몇 칸 벌어졌는지는 남지 않는다", () => {
    expect(linesOf([piece("a", 0, 100), piece("b", 400, 100)])).toEqual(["a b"]);
  });
});

describe("뒤죽박죽 순서로 오는 조각 — 판단은 좌표로 한다", () => {
  it("같은 줄 안에서 순서가 거꾸로 와도 x로 세운다", () => {
    expect(linesOf([piece("world", 36, 100), piece("Hello", 0, 100)])).toEqual([
      "Hello world",
    ]);
  });

  it("줄이 섞여 와도 제자리를 찾는다", () => {
    expect(
      linesOf([
        piece("third", 0, 128),
        piece("one", 0, 100),
        piece("second", 24, 100),
      ]),
    ).toEqual(["one second", "third"]);
  });

  it("좌표를 알 수 없는 조각은 버린다 — 어느 줄에도 놓을 수 없다", () => {
    expect(
      linesOf([
        piece("ok", 0, 100),
        piece("nan", NaN, 100),
        piece("inf", 0, Infinity),
      ]),
    ).toEqual(["ok"]);
  });
});

describe("문단 나누기 — 줄 간격이 평소보다 벌어진 자리", () => {
  const rows = (ys: number[]) =>
    ys.map((y, i) => piece(String.fromCharCode(97 + i), 0, y));

  it("평소 간격(중앙값)의 1.5배를 넘으면 빈 줄이 들어간다", () => {
    // 간격 14·14·28·14 → 중앙값 14 → 기준 21. 28만 넘는다.
    expect(layoutText(rows([100, 114, 128, 156, 170])).text).toBe(
      "a\nb\nc\n\nd\ne",
    );
  });

  it("간격이 고르면 문단은 하나다", () => {
    expect(layoutText(rows([100, 114, 128, 142])).text).toBe("a\nb\nc\nd");
  });

  it("★ 줄이 둘뿐이면 아무리 벌어져도 나누지 않는다 — 평소 간격을 잴 수 없다", () => {
    // 근거 없이 나누느니 붙여 두는 쪽이 되돌리기 쉽다.
    expect(layoutText(rows([100, 300])).text).toBe("a\nb");
  });

  it("기준은 평균이 아니라 중앙값이다 — 제목 하나에 끌려가지 않는다", () => {
    // 간격 14가 여럿, 60이 하나. 평균(≈23)이면 14들도 아슬아슬해진다.
    expect(layoutText(rows([100, 114, 128, 142, 202, 216])).text).toBe(
      "a\nb\nc\nd\n\ne\nf",
    );
  });

  it("문단 기준은 옵션으로 늦출 수 있다 — 크게 잡으면 한 문단이 된다", () => {
    expect(
      layoutText(rows([100, 114, 128, 156, 170]), { paragraphFactor: 3 }).text,
    ).toBe("a\nb\nc\nd\ne");
  });
});

describe("빈 텍스트 — 스캔 PDF의 자리", () => {
  it("조각이 하나도 없으면 비었다고 말한다 — 화면이 이걸 보고 경고한다", () => {
    const out = layoutText([]);
    expect(out.lines).toEqual([]);
    expect(out.text).toBe("");
    expect(out.empty).toBe(true);
  });

  it("공백만 그려진 쪽도 빈 쪽이다 — 눈에 보이는 글자가 없다", () => {
    const out = layoutText([piece(" ", 0, 100), piece("   ", 30, 100)]);
    expect(out.lines).toEqual([]);
    expect(out.empty).toBe(true);
  });

  it("글자 없는 조각(줄 끝 표시)만 있어도 빈 쪽이다", () => {
    const out = layoutText([
      { str: "", x: 0, y: 100, width: 0, height: 12, hasEOL: true },
    ]);
    expect(out.empty).toBe(true);
  });

  it("글자가 한 자라도 있으면 비지 않았다", () => {
    expect(layoutText([piece("가", 0, 100)]).empty).toBe(false);
  });
});

describe("줄 끝 표시(hasEOL) — 좌표만으로 못 가르는 자리에만 쓴다", () => {
  it("줄 마지막 조각에 표시가 붙는 것이 보통이다 — 그때는 아무 일도 없다", () => {
    expect(
      linesOf([piece("Hello", 0, 100), piece("world", 36, 100, { hasEOL: true })]),
    ).toEqual(["Hello world"]);
  });

  it("★ 같은 기준선에 두 줄이 겹쳐 있고 x가 왼쪽으로 되돌아가면 가른다", () => {
    expect(
      linesOf([
        piece("first", 100, 100, { hasEOL: true }),
        piece("second", 100, 100),
      ]),
    ).toEqual(["first", "second"]);
  });

  it("갈린 두 줄은 표시된 순서를 지킨다 — 같은 y라 좌표로는 다시 세울 수 없다", () => {
    // 왼쪽으로 되돌아간 줄을 x로 정렬하면 다음 줄이 앞으로 튀어나온다.
    expect(
      linesOf([
        piece("먼저", 200, 100, { hasEOL: true, width: 24 }),
        piece("나중", 50, 100, { width: 24 }),
      ]),
    ).toEqual(["먼저", "나중"]);
  });

  it("★ 오른쪽으로 이어지면 표시가 있어도 한 줄이다 — 눈에 보이는 줄이 하나다", () => {
    expect(
      linesOf([piece("left", 0, 100, { hasEOL: true }), piece("right", 40, 100)]),
    ).toEqual(["left right"]);
  });

  it("글자 없는 표시 조각은 앞 조각의 줄 끝으로 옮겨진다 — 자기 줄을 만들지 않는다", () => {
    // pdf.js는 줄 끝을 { str: "", hasEOL: true } 조각으로 내기도 한다.
    // 그 좌표는 앞 줄을 가리키므로 줄 묶기에 넣으면 없는 줄이 생긴다.
    expect(
      linesOf([
        piece("first", 100, 100),
        { str: "", x: 130, y: 100, width: 0, height: 12, hasEOL: true },
        piece("second", 100, 100),
      ]),
    ).toEqual(["first", "second"]);
  });

  it("표시가 하나도 없으면 좌표만으로 판단한다 — 흔한 경우다", () => {
    expect(linesOf([piece("a", 0, 100), piece("b", 40, 100)])).toEqual(["a b"]);
  });
});

describe("★ 다단(2단) 조판 — 이번 범위 밖이라는 것을 못 박는다", () => {
  /**
   * 단을 가르려면 "빈 세로 띠"를 찾아 쪽을 먼저 쪼개야 한다. 그 판단은 표·각주·
   * 그림 캡션과 얽혀 있어 별개의 문제다. 지금은 좌우가 한 줄로 이어진다 —
   * 고칠 때 이 테스트가 먼저 깨질 것이다.
   */
  const twoColumn = [
    piece("left one", 50, 100),
    piece("right one", 320, 100),
    piece("left two", 50, 114),
    piece("right two", 320, 114),
  ];

  it("좌우 단이 한 줄로 이어진다 — 줄마다 두 단의 글이 섞인다", () => {
    expect(layoutText(twoColumn).text).toBe(
      "left one right one\nleft two right two",
    );
  });

  it("단 사이의 넓은 틈도 공백 한 개로만 남는다 — 어디가 경계였는지 알 수 없다", () => {
    expect(linesOf(twoColumn)[0]).toBe("left one right one");
  });

  it("줄 끝 표시를 붙여도 갈라지지 않는다 — 오른쪽 단은 왼쪽 단의 '다음 줄'이 아니다", () => {
    const withEol = [
      piece("left one", 50, 100, { hasEOL: true }),
      piece("right one", 320, 100, { hasEOL: true }),
    ];
    expect(linesOf(withEol)).toEqual(["left one right one"]);
  });
});

describe("★ 좌표 계약 — 회전과 y 방향은 부르는 쪽이 걷어낸다", () => {
  /**
   * layoutText는 회전을 모른다. extract.ts가 pdf.js 뷰포트 행렬을 왼쪽에서 곱해
   * "가로로 눕고 위에서 아래로 읽는" 좌표로 세운 뒤 넘긴다.
   * 그 곱을 빠뜨리면 어떻게 되는지가 이 묶음이다.
   */

  it("y가 위로 커지는 PDF 사용자 좌표를 그대로 넘기면 줄 순서가 거꾸로 나온다", () => {
    // PDF 사용자 좌표는 쪽 아래가 원점이다. 뒤집지 않으면 마지막 줄이 첫 줄이 된다.
    expect(linesOf([piece("첫 줄", 0, 720), piece("둘째 줄", 0, 706)])).toEqual([
      "둘째 줄",
      "첫 줄",
    ]);
  });

  it("★ 90° 쪽의 사용자 좌표를 그대로 넘기면 한 줄이 여러 줄로 흩어진다", () => {
    // /Rotate 90인 쪽은 내용이 사용자 좌표의 y축을 따라 적혀 있다(그래야 돌려 놓았을 때
    // 가로로 읽힌다). 그 좌표에서는 x가 고정이고 y만 움직인다 — 조각마다 다른 줄이다.
    const raw = [
      { str: "Hello", x: 100, y: 700, width: 30, height: 12 },
      { str: "world", x: 100, y: 736, width: 30, height: 12 },
    ];
    expect(linesOf(raw)).toEqual(["Hello", "world"]);
  });
});

/**
 * 배율 1, viewBox [0,0,612,792]인 쪽의 pdf.js 뷰포트 행렬(PageViewport가 내는 값).
 * 회전을 걷어내는 것이 바로 이 행렬이다.
 */
const VIEWPORT = {
  0: [1, 0, 0, -1, 0, 792],
  90: [0, 1, 1, 0, 0, 0],
  180: [-1, 0, 0, 1, 612, 0],
} as const;

/** 행렬 곱 — pdf.js Util.transform과 같은 규약(m1을 나중에 적용한다). */
const mul = (m1: readonly number[], m2: readonly number[]): number[] => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

describe("행렬에서 조각 읽기(pieceFromMatrix)", () => {
  it("회전 없는 쪽: y가 뒤집혀 화면 좌표가 된다", () => {
    // 사용자 좌표 (100, 700), 12pt → 화면 (100, 92). 792 - 700 = 92.
    const m = mul(VIEWPORT[0], [12, 0, 0, 12, 100, 700]);
    expect(pieceFromMatrix("Hello", m, 30, 12)).toEqual({
      str: "Hello",
      x: 100,
      y: 92,
      width: 30,
      height: 12,
      hasEOL: false,
    });
  });

  it("★ 90° 쪽의 옆으로 누운 글이 같은 자리에 선다 — 이래서 화면 좌표로 넘긴다", () => {
    // /Rotate 90 쪽의 글은 사용자 좌표 +y를 따라 간다(아이템 행렬이 돌아 있다).
    const m = mul(VIEWPORT[90], [0, 12, -12, 0, 92, 100]);
    expect(pieceFromMatrix("Hello", m, 30, 12)).toEqual({
      str: "Hello",
      x: 100,
      y: 92,
      width: 30,
      height: 12,
      hasEOL: false,
    });
  });

  it("180° 쪽의 뒤집힌 글도 같은 자리에 선다", () => {
    const m = mul(VIEWPORT[180], [-12, 0, 0, -12, 512, 92]);
    const p = pieceFromMatrix("Hello", m, 30, 12);
    expect(p.x).toBe(100);
    expect(p.y).toBe(92);
    expect(p.height).toBe(12);
  });

  it("★ 글이 왼쪽으로 나아가면 원점이 오른쪽 끝이다 — 폭만큼 물러나 왼쪽 끝을 잡는다", () => {
    // 180° 쪽인데 아이템은 안 돌아 있는 경우(화면에서 거꾸로 읽히는 조판).
    const m = mul(VIEWPORT[180], [12, 0, 0, 12, 482, 92]);
    expect(m[0]).toBeLessThan(0);
    expect(pieceFromMatrix("Hello", m, 30, 12).x).toBe(612 - 482 - 30);
  });

  it("높이가 0으로 오면 행렬에서 글꼴 크기를 잰다 — 허용오차가 0이 되면 줄이 다 갈린다", () => {
    const m = mul(VIEWPORT[0], [12, 0, 0, 12, 100, 700]);
    expect(pieceFromMatrix("Hello", m, 30, 0).height).toBe(12);
  });

  it("음수 폭은 0으로 접는다 — 오른쪽 끝이 왼쪽보다 앞에 오면 안 된다", () => {
    const m = mul(VIEWPORT[0], [12, 0, 0, 12, 100, 700]);
    expect(pieceFromMatrix("Hello", m, -5, 12).width).toBe(0);
  });

  it("줄 끝 표시는 넘긴 값 그대로다(기본은 꺼짐)", () => {
    const m = mul(VIEWPORT[0], [12, 0, 0, 12, 100, 700]);
    expect(pieceFromMatrix("a", m, 6, 12).hasEOL).toBe(false);
    expect(pieceFromMatrix("a", m, 6, 12, true).hasEOL).toBe(true);
  });
});

describe("★ 회전을 걷어내고 나면 0°든 90°든 같은 글이 나온다", () => {
  /** 두 줄짜리 같은 내용을, 쪽 회전만 달리해 아이템 행렬로 적은 것. */
  const upright = [
    pieceFromMatrix("Hello", mul(VIEWPORT[0], [12, 0, 0, 12, 100, 700]), 30, 12),
    pieceFromMatrix("world", mul(VIEWPORT[0], [12, 0, 0, 12, 136, 700]), 30, 12),
    pieceFromMatrix("again", mul(VIEWPORT[0], [12, 0, 0, 12, 100, 686]), 30, 12),
  ];
  const rotated = [
    pieceFromMatrix("Hello", mul(VIEWPORT[90], [0, 12, -12, 0, 92, 100]), 30, 12),
    pieceFromMatrix("world", mul(VIEWPORT[90], [0, 12, -12, 0, 92, 136]), 30, 12),
    pieceFromMatrix("again", mul(VIEWPORT[90], [0, 12, -12, 0, 106, 100]), 30, 12),
  ];

  it("회전 없는 쪽이 두 줄로 읽힌다", () => {
    expect(layoutText(upright).text).toBe("Hello world\nagain");
  });

  it("90° 돌린 쪽이 글자 그대로 같다", () => {
    expect(rotated).toEqual(upright);
    expect(layoutText(rotated).text).toBe(layoutText(upright).text);
  });
});

describe("★ 회전이 나중에 얹힌 쪽(uprightCorrection) — 기준은 쪽이 아니라 글이다", () => {
  /**
   * 위 묶음이 다루는 것은 **글을 회전에 맞춰 그린** 문서다. 회전 도구는 그렇게 하지
   * 않는다 — 내용 스트림은 놔둔 채 /Rotate만 바꾼다(우리 편집 탭의 회전이 바로
   * 그것이다: exporter.ts의 `setRotation`). 그런 쪽에서는 뷰포트 변환이 회전을
   * 걷어내는 게 아니라 **거꾸로 글을 눕힌다**.
   *
   * 아래 행렬은 지어낸 값이 아니라 실제 PDF에서 뜬 값이다. 612×792 쪽에 표처럼
   * 흩어 놓은 조각 여섯 개(AAA·BBB / DDD·EEE, 사이의 " "는 pdf.js가 끼워 주는
   * 조각)를 만들고, 편집 탭과 똑같이 /Rotate만 얹어 다시 열어서 pdf.js가 준
   * 합성 행렬(뷰포트 × 아이템)과 치수를 그대로 적었다.
   */

  /** [글, 합성 행렬, 폭, 높이, 줄 끝 표시] */
  type Item = [string, number[], number, number, boolean];
  interface Page {
    /** 뷰포트(화면 상자) 크기 — 90·270°에서는 가로세로가 바뀐다. */
    vw: number;
    vh: number;
    items: Item[];
  }

  const ROT_0: Page = {
    vw: 612,
    vh: 792,
    items: [
      ["AAA", [12, 0, 0, -12, 72, 72], 24.012, 12, false],
      [" ", [12, 0, 0, -12, 96.012, 72], 203.988, 0, false],
      ["BBB", [12, 0, 0, -12, 300, 72], 24.012, 12, true],
      ["DDD", [12, 0, 0, -12, 72, 92], 25.992, 12, false],
      [" ", [12, 0, 0, -12, 97.992, 92], 202.008, 0, false],
      ["EEE", [12, 0, 0, -12, 300, 92], 24.012, 12, false],
    ],
  };
  const ROT_90: Page = {
    vw: 792,
    vh: 612,
    items: [
      ["AAA", [0, 12, 12, 0, 720, 72], 24.012, 12, false],
      [" ", [0, 12, 12, 0, 720, 96.012], 203.988, 0, false],
      ["BBB", [0, 12, 12, 0, 720, 300], 24.012, 12, true],
      ["DDD", [0, 12, 12, 0, 700, 72], 25.992, 12, false],
      [" ", [0, 12, 12, 0, 700, 97.992], 202.008, 0, false],
      ["EEE", [0, 12, 12, 0, 700, 300], 24.012, 12, false],
    ],
  };
  const ROT_180: Page = {
    vw: 612,
    vh: 792,
    items: [
      ["AAA", [-12, 0, 0, 12, 540, 720], 24.012, 12, false],
      [" ", [-12, 0, 0, 12, 515.988, 720], 203.988, 0, false],
      ["BBB", [-12, 0, 0, 12, 312, 720], 24.012, 12, true],
      ["DDD", [-12, 0, 0, 12, 540, 700], 25.992, 12, false],
      [" ", [-12, 0, 0, 12, 514.008, 700], 202.008, 0, false],
      ["EEE", [-12, 0, 0, 12, 312, 700], 24.012, 12, false],
    ],
  };
  const ROT_270: Page = {
    vw: 792,
    vh: 612,
    items: [
      ["AAA", [0, -12, -12, 0, 72, 540], 24.012, 12, false],
      [" ", [0, -12, -12, 0, 72, 515.988], 203.988, 0, false],
      ["BBB", [0, -12, -12, 0, 72, 312], 24.012, 12, true],
      ["DDD", [0, -12, -12, 0, 92, 540], 25.992, 12, false],
      [" ", [0, -12, -12, 0, 92, 514.008], 202.008, 0, false],
      ["EEE", [0, -12, -12, 0, 92, 312], 24.012, 12, false],
    ],
  };

  const fixOf = (p: Page) =>
    uprightCorrection(
      p.items.map(([, m]) => m),
      p.vw,
      p.vh,
    );

  /** extract.ts가 하는 것과 같은 순서 — 보정을 구해 곱하고, 조각으로 읽는다. */
  const read = (p: Page): string => {
    const fix = fixOf(p);
    return layoutText(
      p.items.map(([str, m, w, h, eol]) =>
        pieceFromMatrix(str, fix ? mul(fix, m) : m, w, h, eol),
      ),
    ).text;
  };

  /** 보정을 끄고 읽으면 무엇이 나오는지 — 이 자리가 왜 있는지 눈에 보이게 둔다. */
  const readUnfixed = (p: Page): string =>
    layoutText(
      p.items.map(([str, m, w, h, eol]) => pieceFromMatrix(str, m, w, h, eol)),
    ).text;

  it("똑바로 선 쪽은 손대지 않는다 — 보정이 없다(null)", () => {
    expect(fixOf(ROT_0)).toBeNull();
    expect(read(ROT_0)).toBe("AAA BBB\nDDD EEE");
  });

  it("★ 180°만 얹힌 쪽은 보정 없이는 줄도 조각도 통째로 뒤집힌다", () => {
    expect(readUnfixed(ROT_180)).toBe("EEE DDD\nBBB AAA");
  });

  it("★ 90°·270°만 얹힌 쪽은 보정 없이는 줄이 세로로 흩어진다", () => {
    expect(readUnfixed(ROT_90)).toBe("DDDAAA\nBBB\nEEE");
    expect(readUnfixed(ROT_270)).toBe("BBB\nEEE\nAAADDD");
  });

  it("★ 회전을 얹어도 읽는 글은 같다 — 세 각도 모두", () => {
    for (const p of [ROT_90, ROT_180, ROT_270]) {
      expect(read(p)).toBe("AAA BBB\nDDD EEE");
    }
  });

  it("보정 행렬은 90° 눈금의 회전뿐이다 — 좌표를 뷰포트 상자 안에 남긴다", () => {
    expect(fixOf(ROT_90)).toEqual([0, -1, 1, 0, 0, 792]);
    expect(fixOf(ROT_180)).toEqual([-1, 0, 0, -1, 612, 792]);
    expect(fixOf(ROT_270)).toEqual([0, 1, -1, 0, 612, 0]);
  });

  it("★ 방향이 섞이면 손대지 않는다 — 눕힌 도장 하나에 본문을 눕힐 수는 없다", () => {
    const stamp: number[] = [0, 24, -24, 0, 560, 300]; // 90°로 찍힌 "DRAFT"
    expect(
      uprightCorrection([...ROT_0.items.map(([, m]) => m), stamp], 612, 792),
    ).toBeNull();
  });

  it("방향이 없는 조각(글꼴 크기 0)은 투표하지 않는다", () => {
    const dead = [0, 0, 0, 0, 100, 100];
    const fix = uprightCorrection(
      [dead, ...ROT_180.items.map(([, m]) => m)],
      612,
      792,
    );
    expect(fix).toEqual([-1, 0, 0, -1, 612, 792]);
  });

  it("잴 조각이 하나도 없으면 보정도 없다", () => {
    expect(uprightCorrection([], 612, 792)).toBeNull();
    expect(uprightCorrection([[0, 0, 0, 0, 0, 0]], 612, 792)).toBeNull();
  });

  it("★ 알려진 한계: 눕힌 쪽에 똑바른 조각이 하나만 섞여도 되돌리지 않는다", () => {
    // 쪽 번호만 똑바로 찍힌 눕힌 쪽이 여기 걸린다. 본문 쪽으로 다수결을 하면
    // 반대 실수(도장 하나에 본문이 눕는 것)가 열리므로 만장일치로 두었다.
    const pageNo: number[] = [12, 0, 0, -12, 300, 780];
    expect(
      uprightCorrection([...ROT_180.items.map(([, m]) => m), pageNo], 612, 792),
    ).toBeNull();
  });
});

describe("줄이 들고 있는 좌표", () => {
  it("줄의 x·y는 그 줄에서 제일 왼쪽·제일 위다", () => {
    const [line] = layoutText([
      piece("world", 36, 100.4),
      piece("Hello", 10, 100),
    ]).lines;
    expect(line.x).toBe(10);
    expect(line.y).toBe(100);
  });

  it("줄의 높이는 제일 큰 글자를 따른다 — 문단 간격을 재는 근거다", () => {
    const [line] = layoutText([
      piece("제목", 0, 100, { width: 60, height: 30 }),
      piece("주", 70, 112, { width: 8, height: 8 }),
    ]).lines;
    expect(line.height).toBe(30);
  });
});

describe("옵션 — 기준을 옮길 수 있다", () => {
  it("허용오차를 0으로 두면 미세한 흔들림도 다른 줄이 된다", () => {
    expect(
      linesOf([piece("a", 0, 100), piece("b", 0, 100.4)], {
        lineTolerance: 0,
      }),
    ).toEqual(["a", "b"]);
  });

  it("공백 기준을 크게 잡으면 붙여 쓴다", () => {
    expect(
      linesOf([piece("abc", 0, 100), piece("def", 24, 100)], {
        spaceFactor: 2,
      }),
    ).toEqual(["abcdef"]);
  });
});

describe("경계값 — 여기서 조용히 다른 것을 고르면 안 된다", () => {
  it("★ 넘긴 배열도 조각도 고치지 않는다 — 줄 끝 표시를 옮기는 자리가 그 유혹이다", () => {
    const eol: TextPiece = { str: "", x: 0, y: 100, width: 0, height: 12, hasEOL: true };
    const first = piece("first", 0, 100);
    const input = [first, eol, piece("second", 0, 100)];
    const snapshot = JSON.parse(JSON.stringify(input));
    layoutText(input);
    expect(input.length).toBe(3);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it("높이를 모르는 조각만 있으면 허용오차가 0이다 — y가 꼭 같은 것만 한 줄", () => {
    const flat = (str: string, x: number, y: number): TextPiece => ({
      str,
      x,
      y,
      width: str.length * 6,
      height: 0,
    });
    expect(linesOf([flat("a", 0, 100), flat("b", 30, 100)])).toEqual(["a b"]);
    expect(linesOf([flat("a", 0, 100), flat("b", 0, 100.1)])).toEqual(["a", "b"]);
  });

  it("★ 줄 끝 표시로 갈린 두 줄은 y가 같아 문단 경계가 되지 않는다", () => {
    // 간격 0을 '평소 간격'에 세면 중앙값이 0으로 내려앉아 모든 줄이 문단이 된다.
    const out = layoutText([
      piece("첫째", 100, 100, { hasEOL: true, width: 24 }),
      piece("둘째", 50, 100, { width: 24, hasEOL: true }),
      piece("셋째", 50, 114, { width: 24 }),
    ]);
    expect(out.text).toBe("첫째\n둘째\n셋째");
  });

  it("글자 폭은 코드 유닛이 아니라 글자 수로 나눈다 — 보조평면 글자에서 갈린다", () => {
    // "𝐀𝐁"은 코드 유닛 4개, 글자 2개. 폭 24를 4로 나누면 기준 틈이 1.8,
    // 2로 나누면 3.6이다 — 틈 3이 공백이 되느냐 마느냐가 여기서 갈린다.
    expect(
      linesOf([
        piece("𝐀𝐁", 0, 100, { width: 24 }),
        piece("𝐂", 27, 100, { width: 12 }),
      ]),
    ).toEqual(["𝐀𝐁𝐂"]);
  });

  it("좌표가 아주 커도(1e6) 같은 줄로 묶인다 — 절대값이 아니라 차이로 잰다", () => {
    expect(
      linesOf([piece("a", 1e6, 1e6), piece("b", 1e6 + 30, 1e6 + 0.4)]),
    ).toEqual(["a b"]);
  });

  it("문단 사이 말고는 줄바꿈이 하나뿐이다 — 끝에 빈 줄이 붙지 않는다", () => {
    const out = layoutText([piece("a", 0, 100), piece("b", 0, 114)]);
    expect(out.text.endsWith("b")).toBe(true);
  });
});

describe("쪽 잇기(joinPages)", () => {
  it("쪽 경계는 폼 피드다 — 받은 쪽에서 다시 쪼갤 수 있다", () => {
    expect(PAGE_BREAK).toBe("\f");
    expect(joinPages(["a", "b"])).toBe("a\n\f\nb");
  });

  it("한 쪽뿐이면 경계가 없다", () => {
    expect(joinPages(["a"])).toBe("a");
  });

  it("쪽이 없으면 빈 문자열이다", () => {
    expect(joinPages([])).toBe("");
  });

  it("★ 빈 쪽도 자리를 지킨다 — 쪽 번호가 밀리면 안 된다", () => {
    expect(joinPages(["a", "", "b"]).split(PAGE_BREAK).length).toBe(3);
  });
});
