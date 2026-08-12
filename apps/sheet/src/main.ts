import "@local-tools/theme/tokens.css";
import "@local-tools/theme/base.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app 컨테이너를 찾을 수 없습니다.");

const app = mount(App, { target });

// PWA 빌드에서만 서비스 워커를 붙인다. 단일 HTML 빌드는 파일 하나라 캐시할 게 없다.
if (import.meta.env.MODE === "pwa" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" });
  });
}

export default app;
