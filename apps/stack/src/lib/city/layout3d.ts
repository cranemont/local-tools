// 도시 배치 계산 — 기계 유닛·배관·성벽·성문·바깥 통신 설비의 좌표를 정한다.
//
// three.js를 모른다(순수 숫자). 씬 구성은 scene.ts가 이 결과만 보고 만든다.
// 좌표계: XZ 평면이 땅, Y가 위. 단위 1 ≈ 유닛 반 칸.
//
// 은유의 핵심은 성벽이다. 도시 안 = 브라우저 안. 성문 밖으로 나가는 길은
// 데이터에 network가 적힌 기술 수만큼만 생긴다 — 손으로 그리지 않는다.
//
// 유닛의 생김새도 마찬가지다. 입력 포트 수 = 그 기능이 기대는 기술 수,
// 높이 = 흐름이 여기를 몇 번 지나는가, 지붕 안테나 = 바깥과 통하는가.
// 전부 세어서 맞출 수 있어야 한다 — 손으로 정한 숫자는 하나도 없다.

import {
  APPS,
  FEATURES,
  KIND_ORDER,
  TECHS,
  TECH_BY_ID,
  type AppId,
  type NetLayer,
  type TechKind,
} from "../data/stack";
import { PIPELINES } from "../data/pipelines";
import { routeFor } from "./route";
import { buildStage, type RendezvousStage } from "./rendezvous";

const GRID = 3.9; // 유닛 간격 — 배관이 지날 통로를 남긴다
const FOOT = 2.2; // 유닛 바닥 한 변
const PLOT_PAD = 3.0; // 구역 판 여백

/** 구역 판 두께 — 유닛은 이 위에 선다. 배관 높이 계산이 이 값에 걸려 있어 여기 둔다. */
export const PLOT_H = 0.4;

/**
 * 단계 수 → 높이. **파일이 여기서 몇 번 손을 타는가**로 센다.
 *
 * 흐름에 한 번도 안 나오는 기능은 아예 유닛을 세우지 않는다(아래 onFlow) —
 * 예전엔 납작한 슬래브로 세웠는데, 스물몇 개가 이름표만 달고 서 있으니
 * "무엇을 보라는 건지" 알 수 없는 상자밭이 됐다. 그런 기능은 오른쪽 목록에서
 * 읽는 편이 낫다. 도시에는 파일이 실제로 지나는 자리만 남긴다.
 */
const heightOf = (steps: number): number => 1.4 + steps * 0.8;

export interface Port {
  /** 유닛 중심 기준 상대 좌표 */
  dx: number;
  dy: number;
  dz: number;
  /** 이 구멍으로 들어오는 기술 */
  techId: string;
  kind: TechKind;
}

export interface Building {
  id: string; // feature id
  app: AppId;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: TechKind;
  /** 이 기능이 성문 밖과 연결되는가 */
  outside: boolean;
  /** 높이의 근거 — 이 유닛에서 벌어지는 흐름 단계 수 */
  steps: number;
  /** 입력 포트 — 기대는 기술 하나당 하나 */
  ports: Port[];
  /** 지붕 안테나 — 바깥과 통하는 유닛 */
  mast: boolean;
  /** 지붕 배기관 — wasm을 쓰는 유닛 */
  duct: boolean;
}

export interface District {
  id: AppId;
  label: string;
  blurb: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** 중심에서 본 방위(라디안) — 성문·도로가 이 방향으로 뻗는다 */
  angle: number;
}

/** 유닛과 유닛을 잇는 배관 한 줄. 흐름이 실제로 지나는 순서에서 나온다. */
export interface Pipe {
  id: string;
  from: string;
  to: string;
  /** 맨해튼 폴리라인 — 지붕에서 올라가 배관층을 지나 지붕으로 내려온다 */
  points: { x: number; y: number; z: number }[];
  /** 이 관을 쓰는 흐름들 */
  pipelines: string[];
}

/** 성문 — 성벽이 끊기는 곳. 무엇이 나가는 문인지 이름이 붙는다. */
export interface Gate {
  angle: number;
  /** 이 문으로 나가는 기술(또는 P2P 다리) */
  techId: string;
  label: string;
}

/** 성벽 밖 통신 설비 — network가 적힌 기술마다 하나. */
export interface NetSite {
  id: string; // tech id
  label: string;
  kind: TechKind;
  network: string;
  carries: string;
  x: number;
  z: number;
  angle: number;
  from: AppId;
  /** 붙는 곳마다 안테나 하나 */
  masts: { x: number; z: number; host: string; h: number }[];
  /** 아래에서 위로 쌓은 계층 — 기둥으로 세운다 */
  layers: NetLayer[];
}

export interface CityLayout {
  districts: District[];
  buildings: Building[];
  sites: NetSite[];
  pipes: Pipe[];
  /** 성벽 반지름 */
  wallRadius: number;
  gates: Gate[];
  /** 배관층 높이 — 카메라·안개가 이 값을 참고한다 */
  rackY: number;
  /**
   * 드롭의 랑데부 무대 — 게시판(릴레이)·거울(STUN)·상대 기기·직결 관.
   * 이 둘은 성벽 밖 "설비"로 뭉뚱그리지 않는다. 역할이 서로 다르고,
   * 배치(곁길 대 직선)가 곧 설명이라 전용 무대로 세운다.
   */
  stage: RendezvousStage | null;
}

/** 유닛마다 흐름 단계가 몇 번 지나가는가 — 높이의 근거. 파이프라인 데이터에서 나온다. */
function stepsPerBuilding(): Map<string, number> {
  const out = new Map<string, number>();
  for (const pipeline of PIPELINES) {
    for (const stop of routeFor(pipeline.id)) {
      if (!stop.buildingId) continue;
      out.set(stop.buildingId, (out.get(stop.buildingId) ?? 0) + 1);
    }
  }
  return out;
}

/** 유닛 색은 그 기능이 기대는 기술의 성격 중 가장 많은 것. wasm은 하나만 있어도 이긴다. */
function dominantKind(techIds: string[]): TechKind {
  const kinds = techIds.map((id) => TECH_BY_ID.get(id)?.kind).filter(Boolean) as TechKind[];
  if (kinds.includes("wasm")) return "wasm";
  const tally = new Map<TechKind, number>();
  for (const kind of kinds) tally.set(kind, (tally.get(kind) ?? 0) + 1);
  let best: TechKind = "native";
  let bestN = -1;
  for (const kind of KIND_ORDER) {
    const n = tally.get(kind) ?? 0;
    if (n > bestN) {
      best = kind;
      bestN = n;
    }
  }
  return best;
}

/**
 * 입력 포트 배치 — 유닛 왼쪽 면(-X)에 격자로 박는다.
 * 한 줄에 최대 3개, 위로 쌓는다. 유닛이 낮으면 줄 간격을 줄여 몸통 밖으로 안 나가게.
 */
function portsFor(techIds: string[], h: number): Port[] {
  const perRow = 3;
  const rows = Math.ceil(techIds.length / perRow);
  const gapY = Math.min(0.44, (h - 0.5) / Math.max(1, rows));
  const baseY = -h / 2 + 0.45;
  return techIds.map((techId, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, techIds.length - row * perRow);
    return {
      dx: -FOOT / 2,
      dy: baseY + row * gapY,
      dz: (col - (inRow - 1) / 2) * 0.62,
      techId,
      kind: TECH_BY_ID.get(techId)?.kind ?? "native",
    };
  });
}

/** 이어지는 같은 점은 배관 도형을 깨뜨린다(길이 0 구간) — 미리 접어 둔다. */
function dedupePoints(points: { x: number; y: number; z: number }[]) {
  return points.filter((p, i) => {
    if (i === 0) return true;
    const q = points[i - 1];
    return Math.abs(p.x - q.x) > 1e-6 || Math.abs(p.y - q.y) > 1e-6 || Math.abs(p.z - q.z) > 1e-6;
  });
}

/**
 * 배관 — 흐름이 실제로 거치는 유닛 순서에서만 나온다. 따로 그리지 않는다.
 * 지붕에서 배관층까지 수직으로 올라가 맨해튼으로 건너간 뒤 다시 내려온다.
 */
function computePipes(buildings: Building[], rackY: number): Pipe[] {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const pipes = new Map<string, Pipe>();

  for (const pipeline of PIPELINES) {
    const visited = routeFor(pipeline.id)
      .map((stop) => stop.buildingId)
      .filter((id): id is string => Boolean(id));

    for (let i = 0; i + 1 < visited.length; i++) {
      const from = visited[i];
      const to = visited[i + 1];
      if (from === to) continue; // 같은 유닛 안에서 이어지는 단계 — 관이 필요 없다

      const key = `${from}→${to}`;
      const known = pipes.get(key);
      if (known) {
        if (!known.pipelines.includes(pipeline.id)) known.pipelines.push(pipeline.id);
        continue;
      }

      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) continue;

      // 나란한 관이 겹쳐 보이지 않게 층을 조금씩 올린다
      const y = rackY + (pipes.size % 5) * 0.36;
      const aTop = PLOT_H + a.h;
      const bTop = PLOT_H + b.h;
      // 홀짝을 번갈아 Z 먼저 / X 먼저 — 같은 구역을 오가는 관들이 한 줄로 포개지지 않게
      const zFirst = pipes.size % 2 === 0;
      const bend = zFirst
        ? [
            { x: a.x, y, z: b.z },
            { x: b.x, y, z: b.z },
          ]
        : [
            { x: b.x, y, z: a.z },
            { x: b.x, y, z: b.z },
          ];

      pipes.set(key, {
        id: key,
        from,
        to,
        points: dedupePoints([
          { x: a.x, y: aTop, z: a.z },
          { x: a.x, y, z: a.z },
          ...bend,
          { x: b.x, y: bTop, z: b.z },
        ]),
        pipelines: [pipeline.id],
      });
    }
  }

  return [...pipes.values()];
}

export function computeCity(): CityLayout {
  const stepsOf = stepsPerBuilding();

  // ① 흐름이 지나는 기능만 추린 뒤, 구역별 격자 크기를 재서 링 반지름을 정한다.
  //    남는 게 하나도 없는 구역(개발자 유틸·이 페이지 자신)은 도시에 서지 않는다.
  const featsOf = (appId: AppId) =>
    FEATURES.filter((f) => f.app === appId && (stepsOf.get(f.id) ?? 0) > 0);

  const ringApps = APPS.filter((app) => app.id !== "common" && featsOf(app.id).length > 0);
  const centre = APPS.find((a) => a.id === "common");
  const centred = centre && featsOf(centre.id).length > 0 ? [centre] : [];

  const sized = [...ringApps, ...centred].map((app) => {
    const feats = featsOf(app.id);
    const cols = Math.max(1, Math.ceil(Math.sqrt(feats.length)));
    const rows = Math.ceil(feats.length / cols);
    return {
      app,
      feats,
      cols,
      rows,
      w: cols * GRID + PLOT_PAD,
      d: rows * GRID + PLOT_PAD,
    };
  });

  const maxExtent = Math.max(...sized.map((s) => Math.max(s.w, s.d)));
  const ring = Math.max(22, maxExtent * 1.75);

  const districts: District[] = [];
  const buildings: Building[] = [];

  sized.forEach((s) => {
    const isCenter = s.app.id === "common";
    // 링 위 구역은 북쪽(-90°)부터 시계방향으로 — 개수는 흐름이 지나는 앱 수에서 나온다
    // (숫자를 적어 두면 앱이 늘 때마다 주석만 낡는다). 중앙은 공통 기반.
    const idx = ringApps.findIndex((a) => a.id === s.app.id);
    const angle = isCenter ? 0 : -Math.PI / 2 + (idx * Math.PI * 2) / ringApps.length;
    const cx = isCenter ? 0 : Math.cos(angle) * ring;
    const cz = isCenter ? 0 : Math.sin(angle) * ring;

    districts.push({
      id: s.app.id,
      label: s.app.label,
      blurb: s.app.blurb,
      cx,
      cz,
      w: s.w,
      d: s.d,
      angle,
    });

    s.feats.forEach((feat, i) => {
      const col = i % s.cols;
      const row = Math.floor(i / s.cols);
      const steps = stepsOf.get(feat.id) ?? 0;
      const h = heightOf(steps);
      const techs = feat.techs.map((id) => TECH_BY_ID.get(id));
      buildings.push({
        id: feat.id,
        app: feat.app,
        label: feat.label,
        x: cx + (col - (s.cols - 1) / 2) * GRID,
        z: cz + (row - (s.rows - 1) / 2) * GRID,
        w: FOOT,
        d: FOOT,
        h,
        kind: dominantKind(feat.techs),
        outside: techs.some((tech) => Boolean(tech?.network)),
        steps,
        ports: portsFor(feat.techs, h),
        mast: techs.some((tech) => Boolean(tech?.network)),
        duct: techs.some((tech) => tech?.kind === "wasm"),
      });
    });
  });

  // ② 배관층 — 가장 높은 유닛 위로 지나가야 어느 관도 건물을 뚫지 않는다.
  const rackY = PLOT_H + Math.max(...buildings.map((b) => b.h)) + 2.6;
  const pipes = computePipes(buildings, rackY);

  // ③ 성벽 — 모든 구역을 감싸는 원.
  const wallRadius = ring + maxExtent * 0.62 + 5;

  // ④ 바깥 통신 설비 — network가 적힌 기술마다 하나씩. 그 기술을 쓰는 구역 바깥에 세운다.
  const sites: NetSite[] = [];
  const gates: Gate[] = [];
  const byAngle = new Map<AppId, number>(districts.map((d) => [d.id, d.angle]));

  // websocket·webrtc는 여기서 빼고 랑데부 무대가 통째로 맡는다 — 둘은 "바깥에 있는 설비"가
  // 아니라 서로 역할이 다른 배우라서, 같은 모양의 탑으로 세우면 그 차이가 지워진다.
  const STAGED = new Set(["websocket", "webrtc"]);
  const networked = TECHS.filter((tech) => tech.network && !STAGED.has(tech.id));
  const perDistrict = new Map<AppId, string[]>();
  for (const tech of networked) {
    const user = FEATURES.find((feat) => feat.techs.includes(tech.id));
    const app = user?.app ?? "common";
    perDistrict.set(app, [...(perDistrict.get(app) ?? []), tech.id]);
  }

  for (const [app, techIds] of perDistrict) {
    const base = byAngle.get(app) ?? 0;
    techIds.forEach((techId, i) => {
      const tech = TECH_BY_ID.get(techId)!;
      // 같은 구역에서 여러 개면 부채꼴로 펼친다
      const spread = ((i - (techIds.length - 1) / 2) * 17 * Math.PI) / 180;
      const angle = base + spread;
      const r = wallRadius + 12;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      // 안테나는 붙는 곳 수만큼. 설비를 등지고 부채꼴로 세운다.
      const hosts = tech.net?.hosts ?? [];
      const masts = hosts.map((host, k) => {
        const spreadK = ((k - (hosts.length - 1) / 2) * 15 * Math.PI) / 180;
        const rk = r + 6.5;
        return {
          x: Math.cos(angle + spreadK) * rk,
          z: Math.sin(angle + spreadK) * rk,
          host,
          // 높이를 조금씩 달리해 여섯 개가 한 덩어리로 안 보이게
          h: 4.4 + (k % 3) * 0.8,
        };
      });

      sites.push({
        id: tech.id,
        label: tech.label,
        kind: tech.kind,
        network: tech.network!,
        carries: tech.net?.carries ?? "",
        x,
        z,
        angle,
        from: app,
        masts,
        layers: tech.net?.layers ?? [],
      });
      gates.push({ angle, techId: tech.id, label: tech.label });
    });
  }

  // ⑤ 랑데부 무대 — 드롭 구역 바깥에 세운다. 성문 하나가 이 무대로 열린다.
  const dropDistrict = districts.find((d) => d.id === "drop");
  const relayHosts = TECH_BY_ID.get("websocket")?.net?.hosts ?? [];
  const stage = dropDistrict
    ? buildStage(
        { x: dropDistrict.cx, z: dropDistrict.cz },
        dropDistrict.angle,
        wallRadius,
        relayHosts,
      )
    : null;
  if (dropDistrict) {
    gates.push({ angle: dropDistrict.angle, techId: "webrtc", label: "P2P 직결" });
  }

  return { districts, buildings, sites, pipes, wallRadius, gates, rackY, stage };
}
