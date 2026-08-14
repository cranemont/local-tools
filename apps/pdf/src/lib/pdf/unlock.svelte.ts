/**
 * 암호가 걸린 PDF를 편집·이미지 탭에서 바로 여는 길.
 *
 * pdf.js는 PasswordException을 던지고 pdf-lib은 암호를 아예 못 푼다. 그래서
 * 사용자에게 비밀번호를 물어 qpdf(암호 탭과 같은 엔진)로 한 번 풀고, 그 뒤로는
 * 평범한 PDF 바이트로 다룬다 — 썸네일·내보내기가 한 경로로 끝난다.
 * qpdf를 쓰므로 이 경로만 인터넷이 필요하다(엔진 최초 1회).
 */
import { t } from "../i18n";
import { decryptArgs, ensureQpdfReady, isPasswordError, runQpdf } from "./qpdfLoader";

/** 비밀번호를 묻는 화면 하나를 앱 전체가 공유한다(App.svelte가 그린다). */
class UnlockPrompt {
  open = $state(false);
  fileName = $state("");
  /** 직전 시도가 틀렸는가 — 문구만 바뀐다. */
  wrong = $state(false);

  #settle: ((password: string | null) => void) | null = null;

  /** 비밀번호를 묻고 기다린다. 취소하면 null. */
  ask(fileName: string, wrong: boolean): Promise<string | null> {
    this.fileName = fileName;
    this.wrong = wrong;
    this.open = true;
    return new Promise((resolve) => {
      this.#settle = resolve;
    });
  }

  submit(password: string): void {
    this.#close(password);
  }
  cancel(): void {
    this.#close(null);
  }

  #close(value: string | null): void {
    this.open = false;
    const settle = this.#settle;
    this.#settle = null;
    settle?.(value);
  }
}

export const unlockPrompt = new UnlockPrompt();

/**
 * 암호를 풀어 평문 바이트를 돌려준다. 사용자가 취소하면 null.
 * onBusy는 엔진 준비·해제 동안의 진행 문구(끝나면 빈 문자열).
 */
export async function unlockPdf(
  fileName: string,
  bytes: Uint8Array,
  onBusy?: (message: string) => void,
): Promise<Uint8Array | null> {
  let wrong = false;

  for (;;) {
    const password = await unlockPrompt.ask(fileName, wrong);
    if (password === null) return null;

    try {
      onBusy?.(t.unlock.preparing);
      await ensureQpdfReady();
      onBusy?.(t.unlock.unlocking);
      return await runQpdf(bytes, decryptArgs(password), t.pw.wrongPw);
    } catch (err) {
      // 비밀번호가 틀린 것만 다시 묻는다 — 엔진 오류는 그대로 올려 보낸다.
      if (!isPasswordError(err)) throw err;
      wrong = true;
    } finally {
      onBusy?.("");
    }
  }
}
