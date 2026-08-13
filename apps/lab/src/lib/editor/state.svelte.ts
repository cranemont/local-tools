import { EmbedSession, detectDevice, type Device, type FileProgress } from "../embed/runtime";
import { MODELS, dtypeBytes, modelById, type ModelSpec } from "../embed/registry";
import { buildIndex, scoreMatrix } from "../embed/bm25";
import { meanSpearman, overlapAtK, similarityMatrix, truncate } from "../embed/vector";
import { scorePairs, type PairReport } from "../embed/score";
import { mcnemar, neededItems, wilson, type McNemar } from "../embed/stats";
import {
  loadMarks,
  saveMarks,
  scoreIr,
  seedFromProbe,
  setMark,
  type IrReport,
  type Marks,
} from "../embed/judge";
import {
  clearPoints,
  loadPoints,
  mergePoints,
  type MetricKind,
  type ResultPoint,
} from "../embed/results";
import { probeCorpus, pastedCorpus, type CorpusItem } from "../corpus/samples";
import { t } from "../i18n";

/** 유사도 행렬은 n²이라 화면·시간 모두 여기서 막는다. */
export const MAX_ITEMS = 400;

/** 한 번의 실행 — 설정이 정해진 채로 코퍼스 전체를 점수판 하나로 만든 결과. */
export interface Run {
  id: string;
  /** dense는 벡터를 만들고, lexical(BM25)은 점수판을 바로 만든다 */
  kind: "dense" | "lexical";
  modelId: string;
  dtype: string;
  usePrefix: boolean;
  device: Device | null;
  /** dense: 절단 **전** 원본 벡터. 절단은 볼 때 하는 것이지 다시 계산할 일이 아니다. */
  vectors: Float32Array[];
  /** lexical: 미리 계산된 n×n 점수판(비대칭). dense는 null. */
  matrix: Float32Array | null;
  /** 이 실행이 다룬 문장 수 — lexical은 vectors가 비어 있어 따로 들고 있어야 한다 */
  count: number;
  loadMs: number;
  embedMs: number;
  corpusKey: string;
}

/** 비교 슬롯 — 실행 하나를 특정 차원으로 잘라 본 것(lexical은 dim 0). */
export interface Slot {
  runId: string;
  dim: number;
}

export interface SlotView {
  run: Run;
  dim: number;
  label: string;
  matrix: Float32Array;
  count: number;
  report: PairReport;
  ir: IrReport;
}

export type View = "matrix" | "bump" | "neighbors" | "judge" | "pareto";

function corpusKeyOf(items: CorpusItem[]): string {
  return `${items.length}:${items.map((i) => i.text).join(" ")}`;
}

/** 이 실행에서 고를 수 있는 차원 눈금. lexical은 자를 게 없어 한 칸뿐이다. */
export function dimsOf(run: Run): number[] {
  if (run.kind === "lexical") return [0];
  const full = run.vectors[0]?.length ?? 0;
  const spec = modelById(run.modelId);
  if (spec.mrl.length) return spec.mrl.filter((d) => d <= full);
  const steps: number[] = [];
  for (let d = full; d >= 64; d = Math.floor(d / 2)) steps.push(d);
  return steps;
}

export function runLabel(run: Run, dim: number): string {
  const spec = modelById(run.modelId);
  if (run.kind === "lexical") return spec.label;
  const bits = [spec.label, run.dtype, `${dim}d`];
  if (spec.prefix) bits.push(run.usePrefix ? t.run.prefixOn : t.run.prefixOff);
  return bits.join(" · ");
}

class LabState {
  // ── 코퍼스 ───────────────────────────────────────────────
  source = $state<"probe" | "pasted">("probe");
  pastedText = $state("");

  items = $derived.by<CorpusItem[]>(() => {
    const all = this.source === "probe" ? probeCorpus() : pastedCorpus(this.pastedText);
    return all.slice(0, MAX_ITEMS);
  });

  truncated = $derived(
    this.source === "pasted" && pastedCorpus(this.pastedText).length > MAX_ITEMS,
  );

  corpusKey = $derived(corpusKeyOf(this.items));

  // ── 다음 실행 설정 ────────────────────────────────────────
  modelId = $state(MODELS[0].id);
  dtype = $state(MODELS[0].defaultDtype);
  usePrefix = $state(true);

  spec = $derived<ModelSpec>(modelById(this.modelId));

  // ── 실행 상태 ─────────────────────────────────────────────
  device = $state<Device | null>(null);
  busy = $state(false);
  phase = $state<"idle" | "loading" | "embedding">("idle");
  progress = $state(0);
  progressNote = $state("");
  error = $state<string | null>(null);

  // ── 결과 ─────────────────────────────────────────────────
  runs = $state<Run[]>([]);
  slotA = $state<Slot | null>(null);
  slotB = $state<Slot | null>(null);

  // ── 판정 ─────────────────────────────────────────────────
  marks = $state<Marks>({});
  /** 판정이 바뀔 때마다 오르는 카운터 — 점수 메모를 무효화하는 열쇠 */
  marksRev = $state(0);

  // ── 뷰 ───────────────────────────────────────────────────
  view = $state<View>("matrix");
  focus = $state(0);
  topK = $state(5);

  /** (모델, 정밀도)별로 세션을 재사용한다 — 코퍼스를 바꿀 때마다 200MB를 다시 열 순 없다. */
  #sessions = new Map<string, EmbedSession>();
  #seq = 0;
  /** 파레토 점 메모 — 조합마다 행렬을 다시 만드는 걸 막는다 */
  #pointMemo = new Map<string, ResultPoint>();

  constructor() {
    void detectDevice().then((d) => {
      this.device = d;
    });
    this.marks = loadMarks(corpusKeyOf(this.items));
  }

  // ── 파생 계산 ─────────────────────────────────────────────

  viewA = $derived.by(() => this.#slotView(this.slotA));
  viewB = $derived.by(() => this.#slotView(this.slotB));

  /** 정답이 어디서 오는가 — 판정을 매겼으면 그것, 아니면 프로브 짝. */
  metricKind = $derived<MetricKind>(this.viewA?.ir.queries || this.viewB?.ir.queries ? "ndcg" : "pair");

  comparable = $derived.by(() => {
    const a = this.viewA;
    const b = this.viewB;
    if (!a || !b) return false;
    if (a.run.corpusKey !== b.run.corpusKey) return false;
    return a.run.id !== b.run.id || a.dim !== b.dim;
  });

  overlap = $derived.by(() => {
    if (!this.comparable) return null;
    const a = this.viewA!;
    const b = this.viewB!;
    return overlapAtK(a.matrix, b.matrix, a.count, this.topK);
  });

  spearman = $derived.by(() => {
    if (!this.comparable) return null;
    const a = this.viewA!;
    const b = this.viewB!;
    return meanSpearman(a.matrix, b.matrix, a.count);
  });

  /**
   * 두 설정이 통계적으로 구별되는가 — 총점 차이가 아니라 **엇갈린 문장**만 센다.
   * 프로브 짝짓기(정오가 문장별로 나오는 유일한 지표)에만 붙는다.
   */
  verdict = $derived.by<(McNemar & { need: number | null }) | null>(() => {
    if (!this.comparable) return null;
    const a = this.viewA!.report.outcomes;
    const b = this.viewB!.report.outcomes;
    if (a.size === 0 || b.size === 0) return null;

    let aOnly = 0;
    let bOnly = 0;
    let scored = 0;
    for (const [i, okA] of a) {
      const okB = b.get(i);
      if (okB === undefined) continue;
      scored += 1;
      if (okA && !okB) aOnly += 1;
      else if (!okA && okB) bOnly += 1;
    }
    const test = mcnemar(aOnly, bOnly);
    return { ...test, need: neededItems(test.discordant, scored) };
  });

  #slotView(slot: Slot | null): SlotView | null {
    if (!slot) return null;
    const run = this.runs.find((r) => r.id === slot.runId);
    if (!run) return null;
    if (run.corpusKey !== this.corpusKey) return null;

    const count = run.count;
    let matrix: Float32Array;
    let dim = slot.dim;

    if (run.kind === "lexical") {
      matrix = run.matrix ?? new Float32Array(count * count);
      dim = 0;
    } else {
      dim = Math.min(slot.dim, run.vectors[0]?.length ?? slot.dim);
      matrix = similarityMatrix(run.vectors.map((v) => truncate(v, dim)));
    }

    // marksRev를 읽어 판정이 바뀌면 이 뷰도 다시 계산되게 한다
    this.marksRev;
    return {
      run,
      dim,
      label: runLabel(run, dim),
      matrix,
      count,
      report: scorePairs(this.items, matrix, count),
      ir: scoreIr(this.marks, matrix, count, this.topK),
    };
  }

  // ── 동작 ─────────────────────────────────────────────────

  selectModel(id: string) {
    this.modelId = id;
    this.dtype = modelById(id).defaultDtype;
  }

  setSource(source: "probe" | "pasted") {
    if (this.source === source) return;
    this.source = source;
    this.#afterCorpusChange();
  }

  setPasted(text: string) {
    this.pastedText = text;
    this.#afterCorpusChange();
  }

  /** 코퍼스가 바뀌면 기존 실행은 비교 대상이 될 수 없고, 판정도 그 코퍼스의 것으로 갈린다. */
  #afterCorpusChange() {
    this.runs = [];
    this.slotA = null;
    this.slotB = null;
    this.focus = 0;
    this.#pointMemo.clear();
    this.marks = loadMarks(this.corpusKey);
    this.marksRev += 1;
  }

  existingRun(): Run | null {
    const key = this.corpusKey;
    const lexical = this.spec.kind === "lexical";
    return (
      this.runs.find(
        (r) =>
          r.corpusKey === key &&
          r.modelId === this.modelId &&
          (lexical || (r.dtype === this.dtype && r.usePrefix === this.usePrefix)),
      ) ?? null
    );
  }

  async run(): Promise<void> {
    if (this.busy) return;
    const items = this.items;
    if (!items.length) {
      this.error = t.errors.emptyCorpus;
      return;
    }

    const already = this.existingRun();
    if (already) {
      this.#assign(already);
      return;
    }

    this.busy = true;
    this.error = null;
    this.progress = 0;

    try {
      const run =
        this.spec.kind === "lexical"
          ? this.#runLexical(items)
          : await this.#runDense(items);
      this.runs = [...this.runs, run].slice(-8);
      this.#assign(run);
    } catch (e) {
      this.error = describe(e);
    } finally {
      this.busy = false;
      this.phase = "idle";
      this.progressNote = "";
    }
  }

  /** BM25 — 내려받을 것도, 장치도 없다. 색인하고 점수판을 만들면 끝. */
  #runLexical(items: CorpusItem[]): Run {
    const started = performance.now();
    const index = buildIndex(items.map((i) => i.text));
    const matrix = scoreMatrix(index);
    return {
      id: `run${++this.#seq}`,
      kind: "lexical",
      modelId: this.spec.id,
      dtype: "—",
      usePrefix: false,
      device: null,
      vectors: [],
      matrix,
      count: items.length,
      loadMs: 0,
      embedMs: performance.now() - started,
      corpusKey: this.corpusKey,
    };
  }

  async #runDense(items: CorpusItem[]): Promise<Run> {
    const device = this.device ?? (await detectDevice());
    this.device = device;
    const spec = this.spec;
    const sessionKey = `${spec.id}:${this.dtype}:${device}`;

    let session = this.#sessions.get(sessionKey);
    if (!session) {
      this.phase = "loading";
      this.progressNote = t.run.loading;
      session = await EmbedSession.open({
        spec,
        dtype: this.dtype,
        device,
        onProgress: (files: FileProgress[]) => {
          const loaded = files.reduce((s, f) => s + f.loaded, 0);
          const total = files.reduce((s, f) => s + f.total, 0);
          this.progress = total > 0 ? loaded / total : 0;
        },
      });
      this.#sessions.set(sessionKey, session);
    }

    this.phase = "embedding";
    this.progress = 0;
    this.progressNote = t.run.embedding;
    const { vectors, elapsedMs } = await session.embed(
      items.map((i) => i.text),
      "doc",
      this.usePrefix,
      (done, total) => {
        this.progress = done / total;
        this.progressNote = t.run.embeddingAt(done, total);
      },
    );

    return {
      id: `run${++this.#seq}`,
      kind: "dense",
      modelId: spec.id,
      dtype: this.dtype,
      usePrefix: this.usePrefix,
      device,
      vectors,
      matrix: null,
      count: items.length,
      loadMs: session.loadMs,
      embedMs: elapsedMs,
      corpusKey: this.corpusKey,
    };
  }

  /** 새 실행은 B로 들어가고 이전 B가 A로 밀린다 — 방금 돌린 것과 직전 것이 자동 비교. */
  #assign(run: Run) {
    const dims = dimsOf(run);
    const full = dims[0] ?? 0;
    if (!this.slotA) {
      this.slotA = { runId: run.id, dim: full };
      return;
    }
    if (this.slotA.runId === run.id) {
      // 같은 실행을 다시 고른 경우 — 절단 비교(실험 ①)로 자동 전환
      const smaller = dims.find((d) => d < full) ?? full;
      this.slotB = { runId: run.id, dim: smaller };
      return;
    }
    this.slotA = this.slotB ?? this.slotA;
    this.slotB = { runId: run.id, dim: full };
  }

  setSlot(which: "A" | "B", slot: Slot | null) {
    if (which === "A") this.slotA = slot;
    else this.slotB = slot;
  }

  removeRun(id: string) {
    this.runs = this.runs.filter((r) => r.id !== id);
    if (this.slotA?.runId === id) this.slotA = null;
    if (this.slotB?.runId === id) this.slotB = null;
  }

  // ── 판정 ─────────────────────────────────────────────────

  mark(query: number, doc: number, relevant: boolean | null) {
    this.marks = setMark(this.marks, query, doc, relevant);
    saveMarks(this.corpusKey, this.marks);
    this.marksRev += 1;
    this.#pointMemo.clear();
  }

  seedMarks() {
    this.marks = seedFromProbe(this.items, this.marks);
    saveMarks(this.corpusKey, this.marks);
    this.marksRev += 1;
    this.#pointMemo.clear();
  }

  clearMarks() {
    this.marks = {};
    saveMarks(this.corpusKey, this.marks);
    this.marksRev += 1;
    this.#pointMemo.clear();
  }

  // ── 파레토 ───────────────────────────────────────────────

  /**
   * 실행 × 차원 조합마다 점 하나. **파레토 화면이 떠 있을 때만** 불린다
   * (조합마다 유사도 행렬을 새로 만들어야 해서 늘 돌릴 수는 없다).
   * 계산한 점은 코퍼스별 저장소에 합쳐 넣어 다음 세션에도 남는다.
   */
  computePoints(): ResultPoint[] {
    const metric = this.metricKind;
    const fresh: ResultPoint[] = [];

    for (const run of this.runs) {
      if (run.corpusKey !== this.corpusKey) continue;
      const spec = modelById(run.modelId);

      for (const dim of dimsOf(run)) {
        const memoKey = `${run.id}|${dim}|${metric}|${this.marksRev}|${this.topK}`;
        const hit = this.#pointMemo.get(memoKey);
        if (hit) {
          fresh.push(hit);
          continue;
        }

        const matrix =
          run.kind === "lexical"
            ? (run.matrix ?? new Float32Array(0))
            : similarityMatrix(run.vectors.map((v) => truncate(v, dim)));

        let value = 0;
        let lo = 0;
        let hi = 0;
        let n = 0;

        if (metric === "ndcg") {
          const ir = scoreIr(this.marks, matrix, run.count, this.topK);
          value = ir.ndcg.mean;
          lo = ir.ndcg.lo;
          hi = ir.ndcg.hi;
          n = ir.queries;
        } else {
          const report = scorePairs(this.items, matrix, run.count);
          if (report.total === 0) continue;
          value = report.hits / report.total;
          const ci = wilson(report.hits, report.total);
          lo = ci.lo;
          hi = ci.hi;
          n = report.total;
        }
        if (n === 0) continue;

        const point: ResultPoint = {
          modelId: run.modelId,
          dtype: run.dtype,
          dim,
          usePrefix: run.usePrefix,
          bytes: run.kind === "lexical" ? 0 : dtypeBytes(spec, run.dtype),
          msPerItem: run.count > 0 ? run.embedMs / run.count : 0,
          metric,
          value,
          lo,
          hi,
          n,
        };
        this.#pointMemo.set(memoKey, point);
        fresh.push(point);
      }
    }

    // 저장된 것과 합쳐 돌려준다 — 지난 세션에 재 본 조합이 그림에 그대로 남는다
    return fresh.length ? mergePoints(this.corpusKey, fresh) : loadPoints(this.corpusKey);
  }

  /** 쌓인 점을 버린다 — 지금 켜져 있는 실행 것은 다음 계산에서 다시 찍힌다. */
  resetPoints() {
    clearPoints(this.corpusKey);
    this.#pointMemo.clear();
    this.marksRev += 1;
  }

  /** 세션을 전부 닫는다 — 저장소에서 모델을 지운 뒤 메모리에 남은 걸 털 때. */
  async closeSessions(): Promise<void> {
    const open = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(open.map((s) => s.dispose()));
  }
}

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) return t.errors.network;
  if (/no available backend|WebGPU|adapter/i.test(msg)) return t.errors.device(msg);
  return msg;
}

export const lab = new LabState();
