import "@local-tools/theme/tokens.css";
import "@local-tools/theme/base.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app 컨테이너를 찾을 수 없습니다.");

const app = mount(App, { target });

// PWA 빌드에서만 서비스 워커를 붙인다. 단일 HTML 빌드는 캐시할 자원이 없다
// (엔진 wasm은 브라우저 디스크 캐시에 기댄다).
if (import.meta.env.MODE === "pwa" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" });
  });
}

export default app;
