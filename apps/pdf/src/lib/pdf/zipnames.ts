/**
 * ZIP 항목 이름을 서로 겹치지 않게 만든다.
 *
 * ZIP을 만들 때 항목을 `Record<이름, 바이트>`로 모으는데, 이름이 같으면 **뒤엣것이
 * 앞엣것을 조용히 덮어쓴다** — 화면은 "파일 2개 저장됨"이라고 적어 놓고 ZIP에는
 * 한 개만 들어 있게 된다. 이름이 같은 PDF 두 개를 한 번에 끌어다 놓으면 실제로
 * 일어나고(텍스트는 `<이름>.txt` 하나뿐이라 더 쉽게 부딪힌다), 받은 사람은 세어
 * 보기 전까지 무엇이 사라졌는지 모른다.
 *
 * 그래서 겹치는 이름은 **확장자 앞에 번호를 붙여** 비켜 준다: `a.txt`, `a-2.txt`.
 * 입력 순서와 개수는 그대로 유지된다(i번째 결과가 i번째 입력의 이름이다).
 */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    let candidate = name;
    // 붙인 번호가 뒤에 오는 원래 이름과 또 겹칠 수 있으므로 결과도 함께 세어 둔다.
    for (let n = 2; taken.has(candidate); n++) candidate = numbered(name, n);
    taken.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** 확장자는 마지막 점부터다. 점이 없거나 맨 앞이면 이름 끝에 붙인다. */
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}-${n}`;
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
}
