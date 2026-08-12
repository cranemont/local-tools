/** PWA 파일 연결 — 설치된 앱이면 .hwp/.hwpx 더블클릭이 이 앱으로 들어온다.
 *
 * 이 앱이 PWA를 따로 내는 이유의 절반이 여기 있다: 한글이 깔려 있지 않은 맥에서 .hwp는
 * **열어 주는 앱이 아예 없다**. 남의 자리를 뺏는 게 아니라 빈 자리를 메우는 셈이다.
 * 설치되지 않았거나 단일 HTML로 열었으면 launchQueue가 없고, 조용히 넘어간다.
 */

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** 파일 연결로 들어온 파일을 넘겨준다. 지원하지 않는 환경이면 아무 일도 안 한다. */
export function onFileLaunch(open: (file: File) => void): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;

  queue.setConsumer(async (params) => {
    for (const handle of params.files ?? []) {
      try {
        open(await handle.getFile());
      } catch {
        // 권한이 없거나 파일이 사라진 경우 — 사용자가 직접 열면 된다.
      }
      break; // 이 도구는 한 번에 한 문서만 다룬다
    }
  });
}

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * 설치 프롬프트를 잡아 둔다. 브라우저는 조건이 맞을 때 한 번만 이 이벤트를 주고,
 * 그 순간 말고는 설치를 띄울 수 없어서 붙잡아 두었다가 사용자가 누를 때 쓴다.
 */
export function captureInstallPrompt(onReady: (show: () => Promise<boolean>) => void): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    const prompt = event as InstallPrompt;
    onReady(async () => {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      return outcome === "accepted";
    });
  });
}

/** 이미 설치된 창에서 열렸는가 — 설치 안내를 감추는 데 쓴다. */
export function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}
