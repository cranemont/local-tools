// apps/dev — MD5(md5.ts)와 도구 검색(search.ts)의 명세.
// 화면에서 걷어낸 "동작 해설"이 여기에 규칙으로 남는다.
//
// 기대값의 출처:
//   · MD5는 RFC 1321 부록 A.5의 시험 벡터를 그대로 쓰고,
//     길이 경계·멀티바이트는 node:crypto(독립 구현)를 기준으로 잡았다.
//   · 검색은 apps/dev의 실제 도구 목록(registry.ts)으로 잰다 —
//     Svelte 컴포넌트는 node에서 못 읽으니 그 import만 가짜로 막는다.

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { md5Hex, bytesToHex } from "../apps/dev/src/lib/tools/md5";

// registry.ts가 끌고 오는 .svelte 17개는 node에서 변환되지 않는다.
// 검색은 컴포넌트를 보지 않으므로(제목·설명·그룹·키워드만 본다) 껍데기로 대체한다.
for (const name of [
  "Format", "Color", "Encode", "Jwt", "Hash", "Uuid", "Qr", "Timestamp",
  "CronTool", "Diff", "Chars", "Regex", "Xpath", "Cookie", "OAuthTool", "Saml",
])
  vi.doMock(`../apps/dev/src/lib/tools/${name}.svelte`, () => ({ default: {} }));

const { searchTools } = await import("../apps/dev/src/lib/tools/search");
const { TOOLS } = await import("../apps/dev/src/lib/tools/registry");

const ids = (q: string) => searchTools(TOOLS, q).map((t) => t.id);
const bytes = (s: string) => new TextEncoder().encode(s);
const md5 = (s: string) => md5Hex(bytes(s));
const reference = (b: Uint8Array) => createHash("md5").update(b).digest("hex");

describe("md5Hex — RFC 1321 시험 벡터", () => {
  it("빈 입력의 다이제스트는 d41d8cd9…이다 (입력이 0바이트여도 패딩 블록 하나는 돈다)", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("한 바이트 입력도 규격 값과 같다", () => {
    expect(md5("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
  });

  it("RFC 1321 부록의 나머지 벡터를 전부 재현한다", () => {
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(
      md5("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
    ).toBe("d174ab98d277d9f5a5611c2c9f419d9f");
    expect(
      md5("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});

describe("md5Hex — 64바이트 블록 경계 (패딩 버그가 나는 자리)", () => {
  // 55바이트까지는 0x80 + 길이 8바이트가 한 블록에 들어가고,
  // 56바이트부터는 블록이 하나 더 필요하다. 63·64·65는 그 다음 경계다.
  const expected: Record<number, string> = {
    54: "eced9e0b81ef2bba605cbc5e2e76a1d0",
    55: "ef1772b6dff9a122358552954ad0df65",
    56: "3b0c8ac703f828b04c6c197006d17218",
    57: "652b906d60af96844ebd21b674f35e93",
    63: "b06521f39153d618550606be297466d5",
    64: "014842d480b571495a4a0363793f7367",
    65: "c743a45e0d2e6a95cb859adae0248435",
    119: "8a7bd0732ed6a28ce75f6dabc90e1613",
    120: "5f61c0ccad4cac44c75ff505e1f1e537",
    128: "e510683b3f5ffe4093d021808bc6ff70",
  };

  for (const [n, hex] of Object.entries(expected))
    it(`${n}바이트 입력에서 패딩 블록 수가 맞다`, () => {
      expect(md5("a".repeat(Number(n)))).toBe(hex);
    });

  it("0~200바이트를 전부 독립 구현(node:crypto)과 대조해도 어긋나는 길이가 없다", () => {
    for (let n = 0; n <= 200; n++) {
      const buf = new Uint8Array(n);
      for (let i = 0; i < n; i++) buf[i] = (i * 37 + 11) & 0xff;
      expect(md5Hex(buf), `길이 ${n}`).toBe(reference(buf));
    }
  });
});

describe("md5Hex — 바이트를 있는 그대로 먹는다", () => {
  it("한글·이모지는 UTF-8 바이트열로 해싱된다 (문자 수가 아니라 바이트 수가 길이다)", () => {
    expect(md5("안녕하세요")).toBe("209bebae3eb7363d9b080a66f9e306ef");
    expect(md5("🙂")).toBe("5c8d6d302301d0e25c0e051418dff305");
    expect(md5("가나다 abc 🙂")).toBe("6f11d0e2272587ebe664aec47fcd4c8d");
  });

  it("0x00과 0xff도 데이터다 — 문자열 종료로 잘리지 않는다", () => {
    expect(md5Hex(new Uint8Array([0, 0, 0]))).toBe("693e9af84d3dfcc71e640e005bdc5e2e");
    expect(md5Hex(new Uint8Array([0xff]))).toBe("00594fd4f42ba43fc1ca0427a0576295");
  });

  it("입력 배열을 건드리지 않는다 (같은 배열을 두 번 해싱해도 같은 값)", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    const copy = Uint8Array.from(buf);
    const first = md5Hex(buf);
    expect(md5Hex(buf)).toBe(first);
    expect([...buf]).toEqual([...copy]);
  });

  it("남의 버퍼 한가운데를 가리키는 부분뷰(subarray)도 그 구간만 해싱한다", () => {
    const whole = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    expect(md5Hex(whole.subarray(2, 5))).toBe(md5Hex(new Uint8Array([1, 2, 3])));
  });
});

describe("bytesToHex", () => {
  it("한 자리 바이트는 0을 채워 두 자리로 적는다 (0x0f → \"0f\")", () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe("000fa0ff");
  });

  it("빈 배열은 빈 문자열이다", () => {
    expect(bytesToHex(new Uint8Array())).toBe("");
  });

  it("길이가 언제나 바이트 수의 두 배다", () => {
    const buf = new Uint8Array(64).map((_, i) => i * 4);
    expect(bytesToHex(buf)).toHaveLength(128);
  });

  it("md5 결과는 언제나 소문자 16진 32자다", () => {
    expect(md5("abc")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("searchTools — 기본 규칙", () => {
  it("빈 질의는 등록 순서 그대로 전부 돌려준다 (거르기만 하고 정렬하지 않는다)", () => {
    expect(searchTools(TOOLS, "")).toEqual(TOOLS);
    expect(searchTools(TOOLS, "   ")).toEqual(TOOLS);
  });

  it("결과 순서는 언제나 사이드바 순서다", () => {
    const got = ids("변환");
    expect(got).toEqual(TOOLS.filter((t) => got.includes(t.id)).map((t) => t.id));
  });

  it("제목·설명·그룹·키워드 어디에 있어도 걸린다 — 색인은 넷 다 본다", () => {
    expect(ids("체크섬")).toContain("hash"); // 설명
    expect(ids("crontab")).toContain("cron"); // 키워드
    expect(ids("XPath")).toContain("xpath"); // 제목
  });

  it("대소문자를 가리지 않는다", () => {
    expect(ids("JSON")).toEqual(ids("json"));
    expect(ids("JsOn")).toEqual(ids("json"));
  });

  it("공백으로 쪼갠 토큰은 전부 걸려야 한다(AND)", () => {
    const and = ids("json 압축");
    expect(and).toContain("format");
    for (const id of and) expect(ids("json")).toContain(id);
    expect(and.length).toBeLessThanOrEqual(ids("json").length);
  });

  it("어느 토큰도 못 거는 질의는 0건이다 — 억지로 채우지 않는다", () => {
    expect(ids("zzzzzzzz")).toEqual([]);
  });
});

describe("searchTools — 관용은 0건일 때의 마지막 수단이다", () => {
  it("그대로 걸리는 것이 있으면 관용을 아예 켜지 않는다 ('색깔'이 '검색'을 끌고 오지 않는다)", () => {
    expect(ids("색깔")).toEqual(["color"]);
  });

  it("'색상'은 컬러 변환 하나만 준다 (어미를 떼면 '검색'까지 걸리지만 그럴 필요가 없다)", () => {
    expect(ids("색상")).toEqual(["color"]);
  });

  it("어미가 붙은 말은 한 글자씩 떼며 물러선다 ('변환하기' → '변환')", () => {
    expect(ids("변환하기")).toEqual(ids("변환"));
    expect(ids("변환하기").length).toBeGreaterThan(0);
  });
});

describe("searchTools — 어미 떼기 하한은 한글 두 음절 (1음절로 내리면 오인식이 돌아온다)", () => {
  // 1음절까지 내려가면 '비'가 '비교'를, '엑'이 '엑스패스'를, '날'이 '날짜'를 끌어왔다.
  // 아무것도 없다고 말하는 편이 낫다 — 다섯 건 모두 0이어야 한다.
  const traps: [string, string][] = [
    ["비밀번호", "'비'교"],
    ["엑셀", "'엑'스패스"],
    ["날씨", "'날'짜"],
    ["시계", "'시'간"],
    ["해외", "'해'시"],
  ];
  for (const [q, why] of traps)
    it(`'${q}'는 0건이다 — ${why}를 끌고 오지 않는다`, () => {
      expect(ids(q)).toEqual([]);
    });

  it("두 음절짜리 질의는 애초에 뗄 자리가 없다 (자르면 1음절이라 하한에 걸린다)", () => {
    expect(ids("엑셀")).toEqual([]);
    expect(ids("날씨")).toEqual([]);
  });

  it("영문은 하한이 세 글자라 두 글자 조각으로 물러서지 않는다", () => {
    expect(ids("jsonx")).toContain("format"); // 'json'까지는 뗀다
    expect(ids("qrxy")).toEqual([]); // 'qr'까지 내려가지는 않는다
  });
});

describe("searchTools — 의도한 질의는 여전히 걸린다", () => {
  it("동의어는 registry의 keywords가 받는다 ('제이슨' → 포맷터)", () => {
    expect(ids("제이슨")).toContain("format");
  });

  it("'날짜'는 타임스탬프를 준다", () => {
    expect(ids("날짜")).toContain("time");
  });

  it("'암호화'는 Base64와 해시를 함께 준다", () => {
    expect(ids("암호화")).toEqual(expect.arrayContaining(["encode", "hash"]));
  });

  it("'색상'은 컬러 변환을 준다", () => {
    expect(ids("색상")).toContain("color");
  });

  it("초성만 적어도 걸린다 ('ㄱㅈㅅ' → 글자수 세기)", () => {
    expect(ids("ㄱㅈㅅ")).toContain("chars");
  });

  it("붙은 두 글자가 뒤바뀐 오타를 받는다 ('jsno' → 포맷터)", () => {
    expect(ids("jsno")).toContain("format");
  });

  it("한 글자 오타(편집거리 1)를 받는다 — 단 네 글자부터", () => {
    expect(ids("jsom")).toContain("format"); // 치환
    expect(ids("jsonn")).toContain("format"); // 삽입
    expect(ids("jwr")).toEqual([]); // 세 글자는 오타 관용을 켜지 않는다 ('jwt'로 봐 주지 않는다)
  });
});

describe("searchTools — 그룹 이름도 색인이다", () => {
  it("그룹 이름을 치면 그 그룹이 통째로 나온다 ('인코딩' → 인코딩·보안 8종)", () => {
    const sec = TOOLS.filter((t) => t.group === "인코딩·보안").map((t) => t.id);
    expect(sec.length).toBeGreaterThan(1);
    expect(ids("인코딩")).toEqual(sec);
  });

  it("그룹 이름의 일부만 쳐도 그룹 전체가 걸린다 — 부분일치라 '코딩'도 '인코딩'이다", () => {
    expect(ids("코딩")).toEqual(ids("인코딩"));
  });
});
