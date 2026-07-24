import * as pdfjsLib from "pdfjs-dist";
// 워커를 인라인으로 번들 → 자기완결 단일 파일 유지(외부 워커 파일 fetch 없음).
import PdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker();

export { pdfjsLib };
