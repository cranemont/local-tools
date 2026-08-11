import "@local-tools/theme/tokens.css";
import "@local-tools/theme/base.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app 컨테이너를 찾을 수 없습니다.");

const app = mount(App, { target });

export default app;
