// BM25 — 내려받을 것이 없는 기준선.
//
// 이 앱이 답해야 할 가장 불편한 질문이 여기 있다: **197MB짜리 모델이 0MB짜리 이것을
// 이기는가?** 검색 논문이 언제나 BM25를 같이 싣는 이유이고, 그 줄이 없으면 임베딩
// 점수는 비교 대상 없는 숫자가 된다. 파레토 그림에서 x=0에 서는 점이 이것이다.
//
// 한국어 토큰화는 형태소 분석기 없이 **문자 2-gram**으로 간다. Lucene의 CJK 분석기가
// 쓰는 방식이고, 분석기 없이 얻을 수 있는 것 중에는 제일 낫다. 라틴·숫자는 낱말
// 그대로 둔다 — "machine learning 모델"에서 영어까지 2-gram으로 쪼개면 망가진다.
//
// 못 하는 것을 알고 쓸 것: 글자가 겹치지 않으면 점수가 0이다. 치과↔이빨, 존댓말↔반말은
// 원리상 못 잡는다. 그게 임베딩이 무엇을 사 주는지 보여 주는 대비다.

/** Robertson·Sparck Jones 계열의 표준값. 손대려면 왜인지 적을 것. */
const K1 = 1.2;
const B = 0.75;

/** 한글·한자·가나 덩어리는 2-gram, 라틴·숫자 덩어리는 낱말 하나로. */
const CHUNK = /[가-힣ㄱ-ㅎㅏ-ㅣ぀-ヿ一-鿿]+|[a-z0-9]+/gi;

export function terms(text: string): string[] {
  const out: string[] = [];
  for (const [chunk] of text.toLowerCase().normalize("NFC").matchAll(CHUNK)) {
    if (/^[a-z0-9]+$/.test(chunk) || chunk.length === 1) {
      out.push(chunk);
      continue;
    }
    for (let i = 0; i + 1 < chunk.length; i++) out.push(chunk.slice(i, i + 2));
  }
  return out;
}

interface Posting {
  doc: number;
  tf: number;
}

export interface LexicalIndex {
  n: number;
  postings: Map<string, Posting[]>;
  idf: Map<string, number>;
  /** 문서별 길이(용어 개수) */
  len: number[];
  avgdl: number;
  /** 문서별 중복 없는 용어 — 그 문서를 질의로 쓸 때 훑을 목록 */
  distinct: string[][];
}

export function buildIndex(texts: string[]): LexicalIndex {
  const n = texts.length;
  const postings = new Map<string, Posting[]>();
  const df = new Map<string, number>();
  const len: number[] = [];
  const distinct: string[][] = [];

  texts.forEach((text, doc) => {
    const ts = terms(text);
    len.push(ts.length);

    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    distinct.push([...tf.keys()]);

    for (const [t, count] of tf) {
      const list = postings.get(t);
      if (list) list.push({ doc, tf: count });
      else postings.set(t, [{ doc, tf: count }]);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  });

  const total = len.reduce((s, v) => s + v, 0);
  const avgdl = n > 0 ? total / n : 0;

  // +1 형태라 모든 문서에 있는 용어도 음수가 되지 않는다(작은 양수로 수렴).
  const idf = new Map<string, number>();
  for (const [t, count] of df) idf.set(t, Math.log(1 + (n - count + 0.5) / (count + 0.5)));

  return { n, postings, idf, len, avgdl, distinct };
}

/**
 * 문서 하나하나를 질의로 삼아 n×n 점수판을 만든다.
 *
 * ⚠️ **대칭이 아니다.** BM25는 질의 쪽 용어로만 훑고 문서 쪽 길이로 정규화하므로
 *    score(i→j) ≠ score(j→i)다. 코사인 행렬을 만들 때처럼 위쪽 삼각형만 채우고
 *    거울처럼 베끼면 안 된다 — 이웃 순위는 행 단위로 읽으니 비대칭 그대로가 맞다.
 *
 * 역색인을 타고 질의 용어를 가진 문서만 더한다(n² 전수 대조가 아니다).
 */
export function scoreMatrix(index: LexicalIndex): Float32Array {
  const { n, postings, idf, len, avgdl, distinct } = index;
  const out = new Float32Array(n * n);
  if (n === 0 || avgdl === 0) return out;

  // 문서 길이로 정하는 분모 항은 질의와 무관하니 한 번만 계산해 둔다
  const norm = len.map((l) => K1 * (1 - B + (B * l) / avgdl));

  for (let i = 0; i < n; i++) {
    const row = i * n;
    for (const t of distinct[i]) {
      const weight = idf.get(t) ?? 0;
      if (weight <= 0) continue;
      for (const { doc, tf } of postings.get(t) ?? []) {
        out[row + doc] += (weight * (tf * (K1 + 1))) / (tf + norm[doc]);
      }
    }
  }
  return out;
}
