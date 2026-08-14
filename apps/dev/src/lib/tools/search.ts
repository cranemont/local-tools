// 사이드바 도구 검색.
// 예전엔 `${title} ${keywords}`에 부분일치 한 번이었다 — 설명은 색인에 없었고
// '색상'·'정규표현식'처럼 조금만 다르게 말해도 0건이 됐다. 여기서 하는 것은 셋이다:
//   ① 색인을 제목·설명·그룹·키워드로 넓힌다
//   ② 질의를 공백으로 쪼개 모든 토큰이 걸려야 통과시킨다(AND)
//   ③ 토큰이 그대로 안 걸리면 초성('ㄱㅈㅅ')·어미 떼기('색상'→'색')·
//      한 글자 오타(편집거리 1) 순으로 물러서며 다시 본다
// 동의어('제이슨'·'날짜'·'암호화')는 registry.ts의 keywords가 맡는다.

import type { ToolDef } from "./registry";

/** 한글 음절 → 초성. 초성만 적은 질의('ㄱㅈㅅ')를 받기 위한 색인. */
const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

function choseong(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    else if (code >= 0x3131 && code <= 0x314e) out += ch; // 이미 자모
    else out += " ";
  }
  return out;
}

const isChoseongOnly = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);

/** 붙어 있는 두 글자가 뒤바뀐 오타('jsno') — 편집거리로는 2라 따로 본다. */
function transposed(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++) {
    if (a[i] === b[i]) continue;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return false;
}

/** 편집거리가 1을 넘는 순간 멈춘다 — 정확한 거리는 필요 없다. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length - s.length > 1) return false;
  let i = 0;
  let j = 0;
  let slack = 1;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
      continue;
    }
    if (!slack--) return false;
    if (s.length === l.length) i++; // 치환
    j++; // 삽입·치환 모두 긴 쪽을 하나 넘긴다
  }
  return true;
}

interface Indexed {
  tool: ToolDef;
  text: string;
  cho: string;
  /**
   * 공백을 걷어낸 초성. 사람은 초성을 붙여 치는데('ㄱㅈㅅㅅㄱ') 색인은
   * '글자수 세기' → 'ㄱㅈㅅ ㅅㄱ'이라 띄어쓰기를 건너는 질의가 통째로 0건이 됐다.
   * 두 벌을 함께 두고 어느 쪽에든 걸리면 통과시킨다.
   */
  choTight: string;
  /**
   * `choTight`에서 낱말이 시작하는 자리. 공백을 지우면 앞 낱말의 꼬리와 뒤 낱말의
   * 머리가 붙어 버려서('변환 포맷' → 'ㅂㅎㅍㅁ') 'ㅎㅍ'가 포맷터에 걸렸다 —
   * '헬퍼'를 찾던 사람이 여섯 건을 받는다. 붙여 읽는 것은 허용하되
   * **시작만은 낱말 첫머리**로 못 박아 그 꼬리-머리 조합을 막는다.
   */
  choStarts: Set<number>;
  words: string[];
}

/** 초성 문자열에서 공백을 걷어내고, 낱말이 시작하는 자리를 함께 기록한다. */
function tighten(cho: string): { tight: string; starts: Set<number> } {
  let tight = "";
  const starts = new Set<number>();
  let atStart = true;
  for (const ch of cho) {
    if (ch === " ") {
      atStart = true;
      continue;
    }
    if (atStart) starts.add(tight.length);
    tight += ch;
    atStart = false;
  }
  return { tight, starts };
}

const index = new WeakMap<ToolDef, Indexed>();

function indexOf(tool: ToolDef): Indexed {
  let entry = index.get(tool);
  if (!entry) {
    const text = `${tool.title} ${tool.desc} ${tool.group} ${tool.keywords}`.toLowerCase();
    const cho = choseong(text);
    const { tight, starts } = tighten(cho);
    entry = {
      tool,
      text,
      cho,
      choTight: tight,
      choStarts: starts,
      words: text.split(/[^0-9a-z가-힣ㄱ-ㅎ]+/).filter((w) => w.length > 1),
    };
    index.set(tool, entry);
  }
  return entry;
}

/** 붙여 친 초성 — 낱말 첫머리에서 시작하는 자리만 인정한다. */
function tightHit(entry: Indexed, token: string): boolean {
  for (let i = entry.choTight.indexOf(token); i >= 0; i = entry.choTight.indexOf(token, i + 1))
    if (entry.choStarts.has(i)) return true;
  return false;
}

function strictHit(entry: Indexed, token: string): boolean {
  // 초성 질의는 띄어 친 것도('ㄱㅈㅅ ㅅㄱ') 붙여 친 것도('ㄱㅈㅅㅅㄱ') 같은 뜻이다.
  if (isChoseongOnly(token)) return entry.cho.includes(token) || tightHit(entry, token);
  return entry.text.includes(token);
}

function looseHit(entry: Indexed, token: string): boolean {
  if (strictHit(entry, token)) return true;
  // '색상'·'변환하기'처럼 뒤에 말이 붙은 경우 — 한 글자씩 떼며 물러선다.
  // 한글도 두 음절까지만 내려간다: 한 음절까지 내려가면 '비밀번호'가 '비교'를,
  // '엑셀'이 '엑스패스'를, '날씨'가 '날짜'를 끌고 온다 — 없다고 말하는 편이 낫다.
  const floor = /[가-힣]/.test(token) ? 2 : 3;
  for (let cut = token.slice(0, -1); cut.length >= floor; cut = cut.slice(0, -1))
    if (entry.text.includes(cut)) return true;
  // 오타 관용은 오인식이 늘지 않게 네 글자부터
  if (token.length >= 4)
    return entry.words.some((w) => withinOneEdit(w, token) || transposed(w, token));
  return false;
}

/**
 * 등록 순서(사이드바 순서)는 그대로 두고 거르기만 한다.
 * 그대로 걸리는 것이 하나라도 있으면 그것만 보여 준다 — 관용은 0건일 때의 마지막 수단이다.
 * ('색상'이 '검색'까지 끌고 오면 정확히 친 사람이 손해를 본다.)
 */
export function searchTools(tools: ToolDef[], query: string): ToolDef[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return tools;
  const entries = tools.map(indexOf);
  const strict = entries.filter((e) => tokens.every((token) => strictHit(e, token)));
  const found = strict.length
    ? strict
    : entries.filter((e) => tokens.every((token) => looseHit(e, token)));
  return found.map((e) => e.tool);
}
