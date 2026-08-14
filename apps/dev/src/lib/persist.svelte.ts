// 도구별 입력 보존.
// App.svelte는 도구를 옮길 때 컴포넌트를 통째로 다시 만든다(`{#key}`) — 그래서 값을
// 컴포넌트 밖에 둔다. 저장소는 sessionStorage다: 탭이 살아 있는 동안(새로고침 포함)만
// 남고 탭을 닫으면 사라지므로, 남의 화면에 붙여넣은 토큰이 다음 날까지 남지 않는다.
//
// 비밀값(JWT 비밀키·WiFi 비밀번호·PKCE 생성값)은 여기에 넣지 않는다.

const PREFIX = "dev.state.";
const FLUSH_MS = 200;

// 이번 세션에 오간 값. 도구를 옮겼다 돌아오는 길은 이 지도만 본다 —
// sessionStorage는 디바운스로 늦게 쓰이므로, 저장소에서 되읽으면 마지막 몇 글자를 잃는다.
const live = new Map<string, unknown>();

// 타자 한 번마다 동기 쓰기를 하면 큰 입력에서 눈에 띄게 걸린다 — 모아서 한 번에 쓴다.
// 직렬화도 여기서 한다: 타자마다 JSON.stringify를 돌리면 큰 입력에서 쓰기를 미룬 보람이 없다.
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  clearTimeout(timer);
  timer = undefined;
  for (const key of pending) {
    try {
      sessionStorage.setItem(key, JSON.stringify(live.get(key)));
    } catch {
      // 용량 초과·저장소 차단 — 보존만 포기하고 도구는 그대로 쓰게 둔다
    }
  }
  pending.clear();
}

if (typeof window !== "undefined") {
  // 탭을 닫거나 감추는 순간엔 남은 것을 바로 쓴다(디바운스가 물고 있을 수 있다)
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function read<T>(key: string, fallback: T): T {
  if (live.has(key)) return live.get(key) as T;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 도구를 옮겼다 돌아와도, 새로고침해도 살아남는 상태 하나.
 * `const input = persisted("format.input", "")` → `bind:value={input.current}`.
 */
export function persisted<T>(key: string, initial: T): { current: T } {
  const storeKey = PREFIX + key;
  let value = $state<T>(read(storeKey, initial));
  return {
    get current() {
      return value;
    },
    set current(next: T) {
      value = next;
      live.set(storeKey, next);
      pending.add(storeKey);
      timer ??= setTimeout(flush, FLUSH_MS);
    },
  };
}
