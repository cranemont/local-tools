// 드롭의 암호 경계 — SPAKE2(RFC 9382)와 시그널 코덱의 명세를 실행 가능한 형태로 적는다.
//
// 여기 적힌 규칙이 깨지면 사용자가 다치는 방식:
//  · SPAKE2가 틀리면 "6자리 코드로 안전하다"는 주장이 통째로 거짓이 된다.
//    프리미티브가 맞아도 조립 순서(TT의 길이 접두사·연결 순서·키 분할)가 한 바이트만
//    어긋나면 상호운용이 깨지고, 더 나쁘게는 조용히 약해진다. 그래서 정답은 우리가
//    계산한 값이 아니라 RFC 9382 Appendix B의 테스트 벡터다.
//  · 시그널 코덱이 틀리면 SDP가 조용히 망가져 연결이 안 된다(원인을 화면에서 볼 수 없다).
//
// 벡터 출처: RFC 9382 §4(P-256용 M·N), Appendix B(P256-SHA256-HKDF-HMAC 4개 벡터).

import { describe, it, expect } from "vitest";

import {
  deriveW,
  schedule,
  pointA,
  pointB,
  sharedA,
  sharedB,
  startHostSpake,
  runGuestSpake,
} from "../apps/drop/src/lib/rtc/spake2";
import { encodeSignal, decodeSignal } from "../apps/drop/src/lib/rtc/signal";

// ── 도우미 ──────────────────────────────────────────────────────────

const bytes = (hex: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const big = (hex: string): bigint => BigInt("0x" + hex);

/** P-256의 위수 n (SEC2 / FIPS 186-4) */
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// ── RFC 9382 Appendix B 테스트 벡터 (줄바꿈만 이어 붙였다) ────────────

interface Vector {
  name: string;
  A: string;
  B: string;
  w: string;
  x: string;
  y: string;
  pA: string;
  pB: string;
  K: string;
  ke: string;
  confA: string;
  confB: string;
}

const VECTORS: Vector[] = [
  {
    name: "A='server', B='client'",
    A: "server",
    B: "client",
    w: "2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f",
    x: "43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729",
    pA:
      "04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470" +
      "f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c",
    y: "dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be",
    pB:
      "0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676" +
      "d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7",
    K:
      "0412af7e89717850671913e6b469ace67bd90a4df8ce45c2af19010175e37eed" +
      "69f75897996d539356e2fa6a406d528501f907e04d97515fbe83db277b715d3325",
    ke: "0e0672dc86f8e45565d338b0540abe69",
    confA: "58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281f" + "ee38f0",
    confB: "d3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26" + "dc459b",
  },
  {
    name: "A='', B='client' (신원이 비어도 길이 접두사 0으로 들어간다)",
    A: "",
    B: "client",
    w: "0548d8729f730589e579b0475a582c1608138ddf7054b73b5381c7e883e2efae",
    x: "403abbe3b1b4b9ba17e3032849759d723939a27a27b9d921c500edde18ed654b",
    pA:
      "04a897b769e681c62ac1c2357319a3d363f610839c4477720d24cbe32f5fd8" +
      "5f44fb92ba966578c1b712be6962498834078262caa5b441ecfa9d4a9485720e918a",
    y: "903023b6598908936ea7c929bd761af6039577a9c3f9581064187c3049d87065",
    pB:
      "04e0f816fd1c35e22065d5556215c097e799390d16661c386e0ecc84593974" +
      "a61b881a8c82327687d0501862970c64565560cb5671f696048050ca66ca5f8cc7fc",
    K:
      "048f83ec9f6e4f87cc6f9dc740bdc2769725f923364f01c84148c049a39a735e" +
      "bda82eac03e00112fd6a5710682767cff5361f7e819e53d8d3c3a2922e0d837aa6",
    ke: "642f05c473c2cd79909f9a841e2f30a7",
    confA: "47d29e6666af1b7dd450d571233085d7a9866e4d49d2645e2df9754895" + "21232b",
    confB: "3313c5cefc361d27fb16847a91c2a73b766ffa90a4839122a9b70a2f6b" + "d1d6df",
  },
  {
    name: "A='server', B=''",
    A: "server",
    B: "",
    w: "626e0cdc7b14c9db3e52a0b1b3a768c98e37852d5db30febe0497b14eae8c254",
    x: "07adb3db6bc623d3399726bfdbfd3d15a58ea776ab8a308b00392621291f9633",
    pA:
      "04f88fb71c99bfffaea370966b7eb99cd4be0ff1a7d335caac4211c4afd855e2" +
      "e15a873b298503ad8ba1d9cbb9a392d2ba309b48bfd7879aefd0f2cea6009763b0",
    y: "b6a4fc8dbb629d4ba51d6f91ed1532cf87adec98f25dd153a75accafafedec16",
    pB:
      "040c269d6be017dccb15182ac6bfcd9e2a14de019dd587eaf4bdfd353f031101" +
      "e7cca177f8eb362a6e83e7d5e729c0732e1b528879c086f39ba0f31a9661bd34db",
    K:
      "0445ee233b8ecb51ebd6e7da3f307e88a1616bae2166121221fdc0dadb986afa" +
      "f3ec8a988dc9c626fa3b99f58a7ca7c9b844bb3e8dd9554aafc5b53813504c1cbe",
    ke: "005184ff460da2ce59062c87733c299c",
    confA: "bc9f9bbe99f26d0b2260e6456e05a86196a3307ec6663a18bf6ac8257365" + "33b2",
    confB: "c2370e1bf813b086dff0d834e74425a06e6390f48f5411900276dcccc5a2" + "97ec",
  },
  {
    name: "A='', B=''",
    A: "",
    B: "",
    w: "7bf46c454b4c1b25799527d896508afd5fc62ef4ec59db1efb49113063d70cca",
    x: "8cef65df64bb2d0f83540c53632de911b5b24b3eab6cc74a97609fd659e95473",
    pA:
      "04a65b367a3f613cf9f0654b1b28a1e3a8a40387956c8ba6063e8658563890f4" +
      "6ca1ef6a676598889fc28de2950ab8120b79a5ef1ea4c9f44bc98f585634b46d66",
    y: "d7a66f64074a84652d8d623a92e20c9675c61cb5b4f6a0063e4648a2fdc02d53",
    pB:
      "04589f13218822710d98d8b2123a079041052d9941b9cf88c6617ddb2fcc0494" +
      "662eea8ba6b64692dc318250030c6af045cb738bc81ba35b043c3dcb46adf6f58d",
    K:
      "041a3c03d51b452537ca2a1fea6110353c6d5ed483c4f0f86f4492ca3f378d40" +
      "a994b4477f93c64d928edbbcd3e85a7c709b7ea73ee97986ce3d1438e135543772",
    ke: "fc6374762ba5cf11f4b2caa08b2cd1b9",
    confA: "dfb4db8d48ae5a675963ea5e6c19d98d4ea028d8e898dad96ea19a80ade9" + "5dca",
    confB: "d0f0609d1613138d354f7e95f19fb556bf52d751947241e8c7118df5ef0a" + "e175",
  },
];

describe("SPAKE2 — RFC 9382 Appendix B 벡터", () => {
  it("옮겨 적은 벡터 자체가 규격의 길이를 지킨다 (전사 오류 방지)", () => {
    for (const v of VECTORS) {
      expect(bytes(v.w).length, `${v.name} w`).toBe(32);
      expect(bytes(v.x).length, `${v.name} x`).toBe(32);
      expect(bytes(v.y).length, `${v.name} y`).toBe(32);
      // 모든 점은 비압축 SEC1 — 0x04 접두사 + 32B x + 32B y = 65B
      for (const [label, p] of [["pA", v.pA], ["pB", v.pB], ["K", v.K]] as const) {
        expect(bytes(p).length, `${v.name} ${label}`).toBe(65);
        expect(bytes(p)[0], `${v.name} ${label} 접두사`).toBe(0x04);
      }
      expect(bytes(v.ke).length).toBe(16);
      expect(bytes(v.confA).length).toBe(32);
      expect(bytes(v.confB).length).toBe(32);
    }
  });

  for (const v of VECTORS) {
    describe(v.name, () => {
      it("pA = w*M + x*G — 고정점 M이 RFC §4의 그 값이어야만 맞는다", () => {
        expect(hex(pointA(big(v.w), big(v.x)))).toBe(v.pA);
      });

      it("pB = w*N + y*G — 고정점 N이 RFC §4의 그 값이어야만 맞는다", () => {
        expect(hex(pointB(big(v.w), big(v.y)))).toBe(v.pB);
      });

      it("A는 K = x*(pB − w*N)을, B는 K = y*(pA − w*M)을 얻고 둘은 같다", () => {
        expect(hex(sharedA(big(v.w), big(v.x), bytes(v.pB)))).toBe(v.K);
        expect(hex(sharedB(big(v.w), big(v.y), bytes(v.pA)))).toBe(v.K);
      });

      it("TT 조립과 키 스케줄이 규격의 Ke·A conf·B conf를 낸다", async () => {
        const s = await schedule(v.A, v.B, bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
        expect(hex(s.ke)).toBe(v.ke);
        expect(hex(s.confA)).toBe(v.confA);
        expect(hex(s.confB)).toBe(v.confB);
      });
    });
  }

  it("Ke는 Hash(TT)의 앞 16바이트다 — 뒤 16바이트(Ka)는 새어 나가지 않는다", async () => {
    const v = VECTORS[0];
    const s = await schedule(v.A, v.B, bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
    expect(s.ke.length).toBe(16);
    // Hash(TT) = Ke || Ka, 벡터의 Ka = 15bdf72e2b35b5c9e5663168e960a91b
    expect(hex(s.ke)).toBe("0e0672dc86f8e45565d338b0540abe69");
  });
});

describe("SPAKE2 — TT의 도메인 분리", () => {
  const v = VECTORS[0];

  it("신원 문자열이 뒤바뀌면 완전히 다른 키가 나온다 (역할 혼동 방지)", async () => {
    const straight = await schedule(v.A, v.B, bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
    const swapped = await schedule(v.B, v.A, bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
    expect(hex(swapped.ke)).not.toBe(hex(straight.ke));
    expect(hex(swapped.confA)).not.toBe(hex(straight.confA));
  });

  it("신원의 경계가 길이 접두사로 못 박혀 있다 — 'ab'+'c'와 'a'+'bc'는 다른 키다", async () => {
    const left = await schedule("ab", "c", bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
    const right = await schedule("a", "bc", bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
    expect(hex(left.ke)).not.toBe(hex(right.ke));
  });

  it("confA와 confB는 서로 다른 확인 키로 만든 서로 다른 MAC이다", async () => {
    const s = await schedule(v.A, v.B, bytes(v.pA), bytes(v.pB), bytes(v.K), big(v.w));
    expect(hex(s.confA)).not.toBe(hex(s.confB));
    expect(s.confA.length).toBe(32);
    expect(s.confB.length).toBe(32);
  });
});

describe("SPAKE2 — 코드에서 스칼라 w 뽑기", () => {
  const NS = "drop-test";

  it("w는 PBKDF2-SHA256(21만 회)로 48바이트를 뽑아 mod n 한 값이다", async () => {
    // 도식(apps/stack .. mechanisms.ts)이 "21만 회"라고 적어 둔 그 수치를 여기서 못 박는다.
    // 48바이트를 뽑는 이유는 32바이트를 mod n 하면 생기는 편향을 2^-128 아래로 눌러 두려는 것.
    const code = "482913";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(`${NS}:${code}`),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode(`${NS}:spake2-w`),
          iterations: 210_000,
          hash: "SHA-256",
        },
        key,
        48 * 8,
      ),
    );
    const expected = big(hex(bits)) % P256_ORDER;
    expect(await deriveW(code, NS)).toBe(expected);
  });

  it("같은 코드·같은 네임스페이스면 언제나 같은 w다", async () => {
    expect(await deriveW("000000", NS)).toBe(await deriveW("000000", NS));
  });

  it("네임스페이스가 다르면 같은 코드라도 다른 w다 (세션끼리 섞이지 않는다)", async () => {
    expect(await deriveW("123456", "room-a")).not.toBe(await deriveW("123456", "room-b"));
  });

  it("코드 한 글자만 달라도 w가 달라진다", async () => {
    expect(await deriveW("123456", NS)).not.toBe(await deriveW("123457", NS));
  });

  it("w는 0이 아니고 곡선 위수 n보다 작다", async () => {
    for (const code of ["", "0", "000000", "999999", "\u{1f680}"]) {
      const w = await deriveW(code, NS);
      expect(w).toBeGreaterThan(0n);
      expect(w).toBeLessThan(P256_ORDER);
    }
  }, 20_000);
});

describe("드롭 고수준 API — 같은 코드를 아는 두 쪽만 키에 도달한다", () => {
  const NS = "ns-1";

  it("같은 코드면 호스트와 손님이 같은 16바이트 ke에 도달한다", async () => {
    const host = await startHostSpake("482913", NS);
    const guest = await runGuestSpake("482913", NS, host.msgA);
    const done = await host.finish(guest.msgB);
    expect(done).not.toBeNull();
    expect(hex(done!.ke)).toBe(hex(guest.ke));
    expect(done!.ke.length).toBe(16);
  }, 20_000);

  it("호스트의 확인 메시지를 손님이 검증해야 비로소 양방향 증명이 끝난다", async () => {
    const host = await startHostSpake("482913", NS);
    const guest = await runGuestSpake("482913", NS, host.msgA);
    const done = await host.finish(guest.msgB);
    expect(guest.verifyHost(done!.confirmA)).toBe(true);
  }, 20_000);

  it("호스트의 첫 메시지는 65바이트 비압축 점이고, 손님의 답은 65+32=97바이트다", async () => {
    const host = await startHostSpake("482913", NS);
    const guest = await runGuestSpake("482913", NS, host.msgA);
    expect(host.msgA.length).toBe(65);
    expect(host.msgA[0]).toBe(0x04);
    expect(guest.msgB.length).toBe(97);
    expect(guest.msgB[0]).toBe(0x04);
  }, 20_000);

  it("코드가 다르면 호스트가 손님의 확인 메시지를 거부한다 (null)", async () => {
    const host = await startHostSpake("482913", NS);
    const guest = await runGuestSpake("482914", NS, host.msgA);
    expect(await host.finish(guest.msgB)).toBeNull();
  }, 20_000);

  it("코드가 맞아도 네임스페이스가 다르면 거부된다 (다른 방의 대화가 섞이지 않는다)", async () => {
    const host = await startHostSpake("482913", "room-a");
    const guest = await runGuestSpake("482913", "room-b", host.msgA);
    expect(await host.finish(guest.msgB)).toBeNull();
  }, 20_000);

  it("코드가 틀린 쪽은 확인 MAC도 통과하지 못한다 — 손님도 호스트를 거부한다", async () => {
    const host = await startHostSpake("482913", NS);
    const wrong = await runGuestSpake("999999", NS, host.msgA);
    // 호스트가 (틀린 손님을 맞다고 착각했다는 가정 하에) 만들 confirmA는 손님 것과 다르다
    const right = await runGuestSpake("482913", NS, host.msgA);
    const done = await host.finish(right.msgB);
    expect(wrong.verifyHost(done!.confirmA)).toBe(false);
  }, 30_000);

  it("확인 메시지 한 비트만 뒤집혀도 거부된다", async () => {
    const host = await startHostSpake("482913", NS);
    const guest = await runGuestSpake("482913", NS, host.msgA);
    const tampered = Uint8Array.from(guest.msgB);
    tampered[96] ^= 0x01;
    expect(await host.finish(tampered)).toBeNull();
  }, 20_000);

  it("길이가 97이 아닌 메시지는 곡선 연산 전에 잘라낸다", async () => {
    const host = await startHostSpake("482913", NS);
    for (const n of [0, 1, 64, 65, 96, 98, 200]) {
      expect(await host.finish(new Uint8Array(n)), `${n}바이트`).toBeNull();
    }
  }, 20_000);

  it("곡선 위에 없는 점은 예외가 아니라 null로 거절된다 (무효 곡선 공격 차단)", async () => {
    const host = await startHostSpake("482913", NS);
    const junk = new Uint8Array(97);
    junk[0] = 0x04; // 접두사만 그럴듯하고 좌표는 전부 0 — 곡선 위의 점이 아니다
    expect(await host.finish(junk)).toBeNull();
  }, 20_000);

  it("손상된 호스트 메시지를 받은 손님은 예외로 실패한다 — 호출부가 무시해야 한다", async () => {
    const junk = new Uint8Array(65);
    junk[0] = 0x04;
    await expect(runGuestSpake("482913", NS, junk)).rejects.toThrow();
  }, 20_000);

  it("같은 코드라도 세션마다 x·y를 새로 뽑아 ke가 매번 다르다 (x 재사용 금지)", async () => {
    const one = await startHostSpake("482913", NS);
    const two = await startHostSpake("482913", NS);
    expect(hex(one.msgA)).not.toBe(hex(two.msgA));

    const g1 = await runGuestSpake("482913", NS, one.msgA);
    const g2 = await runGuestSpake("482913", NS, two.msgA);
    expect(hex(g1.ke)).not.toBe(hex(g2.ke));
  }, 30_000);

  it("verifyHost는 길이가 다른 값도 조용히 통과시키지 않는다", async () => {
    const host = await startHostSpake("482913", NS);
    const guest = await runGuestSpake("482913", NS, host.msgA);
    expect(guest.verifyHost(new Uint8Array(0))).toBe(false);
    expect(guest.verifyHost(new Uint8Array(32))).toBe(false);
    expect(guest.verifyHost(new Uint8Array(31))).toBe(false);
  }, 20_000);
});

// ── 시그널 코덱 ──────────────────────────────────────────────────────

const SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:F7gI",
  "a=ice-pwd:x9cml/YzichV2+XlhiMu8g",
  "a=fingerprint:sha-256 " +
    "12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "",
].join("\r\n");

describe("시그널 코덱 — SDP ↔ 한 줄 문자열", () => {
  it("SDP를 싸고 풀면 한 바이트도 다르지 않다", async () => {
    expect(await decodeSignal(await encodeSignal(SDP))).toBe(SDP);
  });

  it("빈 문자열도 왕복한다 (아직 후보가 없는 SDP도 코덱을 탄다)", async () => {
    expect(await decodeSignal(await encodeSignal(""))).toBe("");
  });

  it("한 글자짜리도 왕복한다", async () => {
    expect(await decodeSignal(await encodeSignal("v"))).toBe("v");
  });

  it("길이가 1..80인 모든 입력이 왕복한다 (base64 패딩 경계 전부)", async () => {
    for (let n = 1; n <= 80; n++) {
      const s = "a=candidate:".repeat(20).slice(0, n);
      expect(await decodeSignal(await encodeSignal(s)), `${n}자`).toBe(s);
    }
  }, 20_000);

  it("한글·이모지가 섞여도 UTF-8로 정확히 되돌아온다", async () => {
    const s = "a=label:사진 폴더 📁 — 3.2GB\r\na=x:ﬀ①漢";
    expect(await decodeSignal(await encodeSignal(s))).toBe(s);
  });

  it("아주 긴 SDP(수백 후보)도 왕복하고, 반복이 많으므로 원본보다 짧아진다", async () => {
    const long =
      SDP +
      Array.from(
        { length: 400 },
        (_, i) => `a=candidate:${i} 1 udp 2122260223 192.168.0.${i % 256} ${30000 + i} typ host`,
      ).join("\r\n");
    const code = await encodeSignal(long);
    expect(await decodeSignal(code)).toBe(long);
    expect(code.length).toBeLessThan(long.length);
  });

  it("출력은 base64url 알파벳뿐이다 — '+' '/' '=' 가 없다 (URL·QR에 그대로 실린다)", async () => {
    for (const s of ["", "v", SDP, " ÿ".repeat(500), "🙂".repeat(300)]) {
      const code = await encodeSignal(s);
      expect(code).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(code).not.toContain("=");
    }
  });

  it("줄바꿈·공백이 섞여 들어와도 푼다 (붙여넣기·QR 줄바꿈 대비)", async () => {
    const code = await encodeSignal(SDP);
    const wrapped = "  " + (code.match(/.{1,40}/g) ?? []).join("\n") + " \n";
    expect(await decodeSignal(wrapped)).toBe(SDP);
  });

  it("base64가 아닌 글자가 들어오면 거부한다", async () => {
    await expect(decodeSignal("!!!!")).rejects.toThrow();
  });

  it("base64로는 읽히지만 deflate 스트림이 아니면 거부한다", async () => {
    await expect(decodeSignal("AAAAAAAA")).rejects.toThrow();
  });

  it("코드 끝이 잘리면 조용히 반쪽짜리 SDP를 내놓지 않고 거부한다", async () => {
    const code = await encodeSignal(SDP);
    await expect(decodeSignal(code.slice(0, Math.floor(code.length / 2)))).rejects.toThrow();
  });

  // 주의: deflate-raw에는 체크섬이 없다(gzip·zlib과 다르다). 한 글자 오타의 대부분은
  // 예외 없이 "다른 SDP"로 풀린다 — 실측 6714/11025. 그래서 여기서 못 박을 수 있는 것은
  // "원본이 나오지 않는다"까지고, "반드시 거부한다"는 지금 구조로는 참이 아니다.
  it("가운데 한 글자가 바뀌면 원본과 같은 SDP가 나오지 않는다", async () => {
    const code = await encodeSignal(SDP);
    const i = Math.floor(code.length / 2);
    const flip = code[i] === "A" ? "B" : "A";
    const broken = code.slice(0, i) + flip + code.slice(i + 1);
    let out: string | null = null;
    try {
      out = await decodeSignal(broken);
    } catch {
      out = null; // 거부도 정답이다
    }
    expect(out).not.toBe(SDP);
  });
});
