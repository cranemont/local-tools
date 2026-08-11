// 도시 씬 — layout3d.ts가 정한 좌표를 three.js 물체로 세우고, 상호작용을 붙인다.
//
// 여기서 새로 정하는 건 아무것도 없다. 좌표는 layout3d, 색은 테마 토큰(palette),
// 경로는 route가 데이터에서 유도한 것을 받아 쓰기만 한다.
//
// 상자 하나가 기능 하나였던 시절과 달리, 지금 유닛은 부품으로 조립된다.
// 왼쪽 면의 포트 = 기대는 기술(색이 그 성격), 앞면 계기판 = 소스 줄 수,
// 지붕 안테나 = 바깥과 통함, 지붕 덕트 = wasm. 전부 세어서 맞출 수 있는 값이다.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { computeCity, PLOT_H, type Building, type CityLayout, type NetSite } from "./layout3d";
import { readPalette, type Palette } from "./palette";
import { crate, ductStack, latticeTower, pipeGeometry, polyCurve, roofAntenna } from "./parts";
import { routeFor, usesBridge } from "./route";
import type { TechKind } from "../data/stack";

const KIND_TOKEN: Record<TechKind, keyof Palette> = {
  native: "--cat-1",
  lib: "--cat-2",
  own: "--cat-3",
  wasm: "--cat-4",
  build: "--cat-5",
};

/** 프로토콜 계층 기둥의 색 — 아래에서 위로 갈아 끼워 층이 몇 겹인지 세어지게 */
const LAYER_TOKENS: (keyof Palette)[] = ["--cat-1", "--cat-2", "--cat-3", "--cat-5", "--cat-4"];

const WALL_H = 2.4;
const GATE_HALF = 0.05; // 성문 틈(라디안 반각)
const PIPE_R = 0.13;

const CARGO_SPEED = 0.05; // 유닛/ms — 긴 구간은 오래 걸린다(고정 시간이 아니다)
const DWELL_MS = 460; // 유닛에 머무는 시간

export interface HighlightState {
  activeSet: Set<string> | null;
  matchSet: Set<string> | null;
  pinned: string | null;
  networkOnly: boolean;
  kinds: TechKind[];
}

export interface SceneHooks {
  onHover(id: string | null): void;
  onPick(id: string | null): void;
  onStep(index: number | null): void;
  onWalkChange(on: boolean): void;
}

export interface CityScene {
  layout: CityLayout;
  setHighlight(state: HighlightState): void;
  refreshPalette(): void;
  focus(featureId: string): void;
  play(pipelineId: string): void;
  stop(): void;
  setWalk(on: boolean): void;
  resetCamera(): void;
  dispose(): void;
}

/** 인스턴스 하나가 누구 것이고 무슨 색인지 — paint()가 이걸 보고 칠한다. */
interface Slot {
  owner: string | null;
  token: keyof Palette;
}

interface Bank {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  slots: Slot[];
}

/** 화물이 지나는 한 구간 */
interface Leg {
  curve: THREE.CurvePath<THREE.Vector3>;
  length: number;
  /** 도착하면 알릴 단계 번호 */
  step: number | null;
  /** 도착 지점의 유닛·설비 id — 그것만 환하게 켠다 */
  arriveId: string | null;
  /** 이 구간이 타는 배관 — 지나갈 때 관이 달아오른다 */
  pipeId: string | null;
}

export function createCityScene(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  hooks: SceneHooks,
): CityScene {
  const layout = computeCity();
  let palette = readPalette();

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── 기본 골격 ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 1400);
  // 처음 화면에 중계탑과 옆 기기까지 다 들어와야 한다 — 그게 이 도시의 요점이다.
  const outer = Math.max(
    layout.wallRadius + 16,
    ...layout.sites.flatMap((site) => [
      Math.hypot(site.x, site.z) + 8,
      ...site.masts.map((mast) => Math.hypot(mast.x, mast.z) + 6),
    ]),
    layout.peer ? Math.hypot(layout.peer.x, layout.peer.z) + 10 : 0,
  );
  const HOME = new THREE.Vector3(0, outer * 0.9, outer * 1.34);
  camera.position.copy(HOME);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.maxPolarAngle = Math.PI / 2.12; // 지면 아래로 내려가지 않게
  orbit.minDistance = 10;
  orbit.maxDistance = outer * 2.6;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.45);
  sun.position.set(-46, 82, 38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = outer + 30;
  Object.assign(sun.shadow.camera, {
    left: -span,
    right: span,
    top: span,
    bottom: -span,
    near: 1,
    far: 320,
  });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  // ── 인스턴스 뱅크 만들기 ─────────────────────────────────────
  // 같은 부품이 수십 개씩 나온다. 개별 Mesh로 세우면 드로우콜이 수백이 되므로
  // 부품 종류마다 InstancedMesh 하나로 묶고, 색만 인스턴스별로 준다.
  const banks: Bank[] = [];
  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3(1, 1, 1);
  const tmpPos = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function bank(
    geometry: THREE.BufferGeometry,
    count: number,
    options: { roughness?: number; metalness?: number; shadow?: boolean } = {},
  ): Bank {
    const material = new THREE.MeshStandardMaterial({
      roughness: options.roughness ?? 0.7,
      metalness: options.metalness ?? 0.08,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    mesh.count = 0; // place()가 채운 만큼만 그린다
    mesh.castShadow = options.shadow ?? true;
    mesh.receiveShadow = options.shadow ?? true;
    mesh.frustumCulled = false;
    const entry: Bank = { mesh, slots: [] };
    banks.push(entry);
    scene.add(mesh);
    return entry;
  }

  function place(
    entry: Bank,
    position: { x: number; y: number; z: number },
    slot: Slot,
    rotationY = 0,
    scale?: { x: number; y: number; z: number },
  ) {
    const i = entry.mesh.count;
    tmpPos.set(position.x, position.y, position.z);
    tmpQuat.setFromAxisAngle(UP, rotationY);
    tmpScale.set(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    entry.mesh.setMatrixAt(i, tmpMatrix);
    entry.slots.push(slot);
    entry.mesh.count = i + 1;
  }

  // ── 지형 ────────────────────────────────────────────────────
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  // 지면 원반의 가장자리가 보이면 "접시 위의 도시"처럼 읽힌다 — 안개가 삼킬 만큼 넓게 편다.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(outer * 2.4, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const plotMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const plotRimMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  for (const district of layout.districts) {
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(district.w + 0.7, PLOT_H * 0.7, district.d + 0.7),
      plotRimMat,
    );
    rim.position.set(district.cx, PLOT_H * 0.35, district.cz);
    rim.receiveShadow = true;
    scene.add(rim);

    const plot = new THREE.Mesh(new THREE.BoxGeometry(district.w, PLOT_H, district.d), plotMat);
    plot.position.set(district.cx, PLOT_H / 2, district.cz);
    plot.receiveShadow = true;
    scene.add(plot);
  }

  // ── 성벽 — 성문 각도에서만 끊긴다 ────────────────────────────
  const SEGMENTS = 190;
  const segStep = (Math.PI * 2) / SEGMENTS;
  const chord = layout.wallRadius * segStep * 1.1;
  const wallBank = bank(new THREE.BoxGeometry(0.5, WALL_H, chord), SEGMENTS, { roughness: 1 });
  const copingBank = bank(new THREE.BoxGeometry(0.74, 0.16, chord), SEGMENTS, { roughness: 1 });

  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * segStep - Math.PI;
    const inGate = layout.gates.some(
      (gate) => Math.abs(((a - gate.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < GATE_HALF,
    );
    if (inGate) continue;
    const at = { x: Math.cos(a) * layout.wallRadius, y: 0, z: Math.sin(a) * layout.wallRadius };
    place(wallBank, { ...at, y: WALL_H / 2 }, { owner: null, token: "--border-strong" }, -a);
    place(copingBank, { ...at, y: WALL_H + 0.08 }, { owner: null, token: "--border" }, -a);
  }

  // ── 성문 — 문설주 둘과 상인방. 무엇이 나가는 문인지 이름이 붙는다 ────
  const gateSpan = GATE_HALF * 2 * layout.wallRadius + 1;
  const pierBank = bank(new THREE.BoxGeometry(0.9, WALL_H + 1.1, 0.9), layout.gates.length * 2);
  const lintelBank = bank(new THREE.BoxGeometry(0.6, 0.34, gateSpan), layout.gates.length);
  for (const gate of layout.gates) {
    for (const side of [-1, 1]) {
      const a = gate.angle + side * GATE_HALF;
      place(
        pierBank,
        {
          x: Math.cos(a) * layout.wallRadius,
          y: (WALL_H + 1.1) / 2,
          z: Math.sin(a) * layout.wallRadius,
        },
        { owner: null, token: "--border-strong" },
        -a,
      );
    }
    place(
      lintelBank,
      {
        x: Math.cos(gate.angle) * layout.wallRadius,
        y: WALL_H + 0.9,
        z: Math.sin(gate.angle) * layout.wallRadius,
      },
      { owner: null, token: "--border-strong" },
      -gate.angle,
    );
  }

  // ── 기계 유닛 ───────────────────────────────────────────────
  const bodies = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();

  const totalPorts = layout.buildings.reduce((sum, b) => sum + b.ports.length + 1, 0);
  const plateBank = bank(new THREE.BoxGeometry(1, 0.16, 1), layout.buildings.length);
  const capBank = bank(new THREE.BoxGeometry(1, 0.18, 1), layout.buildings.length);
  const portBank = bank(new THREE.CylinderGeometry(0.115, 0.115, 0.2, 8), totalPorts);
  const gaugeBank = bank(new THREE.BoxGeometry(0.86, 1, 0.05), layout.buildings.length);
  const fillBank = bank(new THREE.BoxGeometry(0.74, 1, 0.05), layout.buildings.length);
  const antennaBank = bank(roofAntenna(1.5), layout.buildings.filter((b) => b.mast).length);
  const ductBank = bank(ductStack(), layout.buildings.filter((b) => b.duct).length);

  // 포트는 옆으로 눕힌 원통이라 지오메트리 자체를 미리 돌려 둔다
  portBank.mesh.geometry.rotateZ(Math.PI / 2);

  for (const b of layout.buildings) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.12 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), material);
    mesh.position.set(b.x, PLOT_H + b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = b.id;
    scene.add(mesh);
    bodies.set(b.id, mesh);

    place(
      plateBank,
      { x: b.x, y: PLOT_H + 0.08, z: b.z },
      { owner: b.id, token: "--border-strong" },
      0,
      { x: b.w + 0.62, y: 1, z: b.d + 0.62 },
    );
    place(
      capBank,
      { x: b.x, y: PLOT_H + b.h + 0.09, z: b.z },
      { owner: b.id, token: "--surface-raised" },
      0,
      { x: b.w + 0.26, y: 1, z: b.d + 0.26 },
    );

    // 입력 포트 — 기술 하나당 하나, 색은 그 기술의 성격
    for (const port of b.ports) {
      place(
        portBank,
        { x: b.x + port.dx, y: PLOT_H + b.h / 2 + port.dy, z: b.z + port.dz },
        { owner: b.id, token: KIND_TOKEN[port.kind] },
      );
    }
    // 출력 포트 — 오른쪽 면에 하나
    place(
      portBank,
      { x: b.x + b.w / 2, y: PLOT_H + b.h / 2, z: b.z },
      { owner: b.id, token: "--accent" },
    );

    // 계기판 — 눈금이 줄 수에 비례한다
    const gaugeH = Math.min(0.62, b.h * 0.42);
    const gaugeY = PLOT_H + b.h * 0.56;
    // 테두리는 --text로 — --bg를 쓰면 밝은 테마의 밝은 몸통 위에서 통째로 사라진다
    place(
      gaugeBank,
      { x: b.x, y: gaugeY, z: b.z + b.d / 2 + 0.02 },
      { owner: b.id, token: "--text" },
      0,
      { x: 1, y: gaugeH, z: 1 },
    );
    const fillH = Math.max(0.05, gaugeH * 0.84 * b.fill);
    place(
      fillBank,
      { x: b.x, y: gaugeY - (gaugeH * 0.84) / 2 + fillH / 2, z: b.z + b.d / 2 + 0.04 },
      { owner: b.id, token: "--accent" },
      0,
      { x: 1, y: fillH, z: 1 },
    );

    if (b.mast) {
      place(
        antennaBank,
        { x: b.x - b.w / 2 + 0.35, y: PLOT_H + b.h + 0.18, z: b.z - b.d / 2 + 0.35 },
        { owner: b.id, token: "--cat-4" },
      );
    }
    if (b.duct) {
      place(
        ductBank,
        { x: b.x + b.w / 2 - 0.4, y: PLOT_H + b.h + 0.18, z: b.z + b.d / 2 - 0.4 },
        { owner: b.id, token: "--cat-4" },
      );
    }
  }

  // ── 배관 — 흐름이 지나는 유닛 순서에서 나온 것만 놓인다 ──────
  interface PipeMesh {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    from: string;
    to: string;
  }
  const pipeMeshes = new Map<string, PipeMesh>();
  const pipeCurves = new Map<string, THREE.CurvePath<THREE.Vector3>>();

  for (const pipe of layout.pipes) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 });
    const mesh = new THREE.Mesh(pipeGeometry(pipe.points, PIPE_R), material);
    mesh.castShadow = true;
    scene.add(mesh);
    pipeMeshes.set(pipe.id, { mesh, from: pipe.from, to: pipe.to });
    pipeCurves.set(pipe.id, polyCurve(pipe.points));
  }

  // ── 성벽 밖 통신 설비 ───────────────────────────────────────
  // 창고 상자 하나로 뭉뚱그리지 않는다. 붙는 곳마다 중계탑이 서고,
  // 그 위에 얹히는 계층이 기둥으로 쌓인다 — 몇 겹인지 세어진다.
  const sitePads = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  const totalLayers = layout.sites.reduce((sum, site) => sum + site.layers.length, 0);

  const layerBank = bank(new THREE.BoxGeometry(3.4, 0.44, 1.7), totalLayers);
  const conduitMats: THREE.MeshStandardMaterial[] = [];

  // 중계탑은 인스턴스로 늘이면 접시까지 같이 늘어나 찌그러진다 — 높이마다 따로 세운다.
  // 열 개 남짓이라 드로우콜을 걱정할 규모가 아니다.
  const towers: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; site: string }[] =
    [];
  const beaconMat = new THREE.MeshStandardMaterial({ roughness: 0.4 });
  const beaconGeo = new THREE.SphereGeometry(0.16, 10, 8);

  const LAYER_GAP = 0.66;

  for (const site of layout.sites) {
    // 설비 바닥 — 짚을 수 있는 판. 여기가 이 기술의 대표 지점이다.
    const padMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.7, 8), padMat);
    pad.position.set(site.x, 0.35, site.z);
    pad.castShadow = true;
    pad.receiveShadow = true;
    pad.userData.id = site.id;
    scene.add(pad);
    sitePads.set(site.id, pad);

    // 계층 기둥 — 아래가 전송, 위가 앱 프로토콜
    site.layers.forEach((_, i) => {
      place(
        layerBank,
        { x: site.x, y: 0.95 + i * LAYER_GAP, z: site.z },
        { owner: site.id, token: LAYER_TOKENS[i % LAYER_TOKENS.length] },
        -site.angle,
      );
    });

    // 중계탑 — 붙는 곳 하나당 하나. 접시는 도시 쪽(안쪽)을 본다.
    for (const mast of site.masts) {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.35 });
      const tower = new THREE.Mesh(latticeTower(mast.h), material);
      tower.position.set(mast.x, 0, mast.z);
      tower.rotation.y = -site.angle + Math.PI;
      tower.castShadow = true;
      scene.add(tower);
      towers.push({ mesh: tower, site: site.id });

      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(mast.x, mast.h + 0.72, mast.z);
      scene.add(beacon);
    }

    // 성문에서 설비까지 가는 관 — 길이 아니라 회선이다
    const gate = layout.gates.find((g) => g.techId === site.id);
    if (gate) {
      const inner = {
        x: Math.cos(gate.angle) * (layout.wallRadius - 6),
        y: 1.1,
        z: Math.sin(gate.angle) * (layout.wallRadius - 6),
      };
      const mid = {
        x: Math.cos(gate.angle) * (layout.wallRadius + 2),
        y: 1.1,
        z: Math.sin(gate.angle) * (layout.wallRadius + 2),
      };
      const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 });
      conduitMats.push(material);
      const conduit = new THREE.Mesh(
        pipeGeometry([inner, mid, { x: site.x, y: 1.1, z: site.z }], PIPE_R * 0.85),
        material,
      );
      conduit.castShadow = true;
      scene.add(conduit);
    }
  }

  // ── 옆 기기와 직결 링크 ─────────────────────────────────────
  // 다리(길)가 아니라 회선 두 가닥이다. 릴레이를 거치지 않고 바로 건너간다.
  const peerMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2 });
  const linkMats: THREE.MeshStandardMaterial[] = [];
  /** 직결 링크의 양 끝 — 화물이 이 선 위를 지나야 칼라를 꿰고 간다 */
  let peerLink: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;

  if (layout.peer) {
    const from = new THREE.Vector3(layout.peer.fromX, 2.2, layout.peer.fromZ);
    const to = new THREE.Vector3(layout.peer.x, 2.2, layout.peer.z);
    const dir = to.clone().sub(from).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);

    // 두 가닥 — 양방향이라는 뜻. 가운데 고리는 DTLS 이음매.
    for (const offset of [-0.42, 0.42]) {
      const a = from.clone().addScaledVector(side, offset);
      const b = to.clone().addScaledVector(side, offset);
      const material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.35 });
      linkMats.push(material);
      const line = new THREE.Mesh(pipeGeometry([a, b], PIPE_R * 0.8), material);
      line.castShadow = true;
      scene.add(line);
    }
    peerLink = { from, to };

    // 이음매 고리 — 회선을 감싼 칼라. 토러스는 축이 +Z라 회선 방향으로 돌리면 그대로 끼워진다.
    const collarBank = bank(new THREE.TorusGeometry(0.78, 0.1, 8, 18), 5, { shadow: false });
    for (let i = 1; i <= 5; i++) {
      const at = from.clone().lerp(to, i / 6);
      place(collarBank, at, { owner: "webrtc", token: "--cat-4" }, Math.atan2(dir.x, dir.z));
    }

    // 옆 기기 — 우리 도시가 아니라서 작은 유닛 몇 개로만 세운다
    for (let i = 0; i < 5; i++) {
      const h = 1.6 + (i % 3) * 1.1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, h, 1.7), peerMat);
      box.position.set(to.x + ((i % 3) - 1) * 2.7, h / 2, to.z + (Math.floor(i / 3) - 0.5) * 2.7);
      box.castShadow = true;
      box.receiveShadow = true;
      scene.add(box);
    }
  }

  // ── 화물 — 궤짝 셋이 줄지어 배관을 탄다 ─────────────────────
  const cargoMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.15 });
  const CRATES = 3;
  const crates: THREE.Mesh[] = [];
  const crateGeo = crate(0.7);
  for (let i = 0; i < CRATES; i++) {
    const box = new THREE.Mesh(crateGeo, cargoMat);
    box.castShadow = true;
    box.visible = false;
    scene.add(box);
    crates.push(box);
  }

  // ── 라벨 (DOM 오버레이 — 3D 안에 폰트를 굽지 않는다) ─────────
  interface Label {
    el: HTMLElement;
    at: THREE.Vector3;
    /** 설비를 짚었을 때만 뜨는 라벨이면 그 설비 id */
    site?: string;
  }
  const labels: Label[] = [];
  function addLabel(text: string, sub: string, at: THREE.Vector3, cls: string, site?: string) {
    const el = document.createElement("div");
    el.className = `city-label ${cls}`;
    const strong = document.createElement("strong");
    strong.textContent = text;
    el.appendChild(strong);
    if (sub) {
      const small = document.createElement("span");
      small.textContent = sub;
      el.appendChild(small);
    }
    if (site) el.hidden = true;
    overlay.appendChild(el);
    labels.push({ el, at, site });
  }

  for (const d of layout.districts) {
    addLabel(d.label, d.blurb, new THREE.Vector3(d.cx, 6.2, d.cz), "district");
  }
  for (const site of layout.sites) {
    const top = 0.95 + site.layers.length * LAYER_GAP + 0.6;
    addLabel(site.label, site.network, new THREE.Vector3(site.x, top, site.z), "outpost");
    // 계층·호스트 이름은 그 설비를 짚었을 때만 — 늘 띄우면 글자밭이 된다
    site.layers.forEach((layer, i) => {
      addLabel(
        layer.label,
        "",
        new THREE.Vector3(site.x, 0.95 + i * LAYER_GAP, site.z),
        "layer",
        site.id,
      );
    });
    for (const mast of site.masts) {
      addLabel(mast.host, "", new THREE.Vector3(mast.x, mast.h + 1.2, mast.z), "host", site.id);
    }
  }
  if (layout.peer) {
    addLabel(
      "옆 기기",
      "P2P 직결 — 릴레이를 지나지 않음",
      new THREE.Vector3(layout.peer.x, 6.0, layout.peer.z),
      "peer",
    );
  }

  // 유닛 이름표는 하나만 만들어 짚는 대상으로 옮긴다(45개를 늘 띄우면 글자밭이 된다).
  const focusLabel = document.createElement("div");
  focusLabel.className = "city-label focus";
  focusLabel.hidden = true;
  overlay.appendChild(focusLabel);
  let focusAt: THREE.Vector3 | null = null;

  // ── 화물 재생 상태 ──────────────────────────────────────────
  // paint()가 이 값들을 읽는다. 아래 재생 구역에 두면 초기 paint() 호출이
  // 선언 전 접근(TDZ)으로 터진다 — 그래서 여기서 먼저 만든다.
  let legs: Leg[] = [];
  let legIndex = 0;
  let legDist = 0;
  let dwellLeft = 0;
  let running = false;
  /** 재생 중 켜 둘 유닛들 — 경로가 도시 위에 길로 남는다 */
  let routeIds = new Set<string>();
  let currentId: string | null = null;
  let activePipe: string | null = null;

  // ── 색 입히기 ───────────────────────────────────────────────
  let highlight: HighlightState = {
    activeSet: null,
    matchSet: null,
    pinned: null,
    networkOnly: false,
    kinds: ["native", "lib", "own", "wasm", "build"],
  };

  // paint()는 마우스가 스칠 때마다 돈다 — 안에서 색을 새로 만들면 프레임마다 쓰레기가 쌓인다.
  const tmpColor = new THREE.Color();
  const dimColor = new THREE.Color();
  const hotColor = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);

  function dimmedId(id: string, outside: boolean, kind: TechKind): boolean {
    // 재생 중에는 경로가 주인공이다 — 다른 강조는 잠시 물러난다.
    if (running) return !routeIds.has(id);
    if (highlight.networkOnly && !outside) return true;
    if (!highlight.kinds.includes(kind)) return true;
    if (highlight.matchSet && !highlight.matchSet.has(id)) return true;
    if (highlight.activeSet && !highlight.activeSet.has(id)) return true;
    return false;
  }

  const dimmedBuilding = (b: Building) => dimmedId(b.id, b.outside, b.kind);
  const dimmedSite = (site: NetSite) => dimmedId(site.id, true, site.kind);

  /** 유닛·설비 id → 지금 흐려져 있는가. 인스턴스 부품이 몸통을 따라가게 하는 표. */
  const dimTable = new Map<string, boolean>();
  const litTable = new Map<string, boolean>();

  function paint() {
    const bg = new THREE.Color(palette["--bg"]);
    groundMat.color.set(palette["--surface-2"]);
    plotMat.color.set(palette["--surface"]);
    plotRimMat.color.set(palette["--border"]);
    peerMat.color.set(palette["--accent"]);
    cargoMat.color.set(palette["--accent"]);
    cargoMat.emissive.set(palette["--accent"]);
    cargoMat.emissiveIntensity = 0.5;
    scene.background = bg;
    // 옆 기기까지는 또렷해야 한다 — 안개는 그 바깥부터, 지면 끝은 확실히 삼키게.
    scene.fog = new THREE.Fog(palette["--bg"], outer * 1.15, outer * 2.2);
    hemi.groundColor.set(palette["--surface-2"]);

    dimTable.clear();
    litTable.clear();

    for (const b of layout.buildings) {
      const mesh = bodies.get(b.id);
      if (!mesh) continue;
      const lit = running ? currentId === b.id : highlight.pinned === b.id;
      const dim = dimmedBuilding(b) && !lit;
      dimTable.set(b.id, dim);
      litTable.set(b.id, lit);
      const base = tmpColor.set(palette[KIND_TOKEN[b.kind]]);
      if (dim) {
        mesh.material.color.copy(base).lerp(bg, 0.8);
        mesh.material.emissive.setHex(0x000000);
      } else {
        mesh.material.color.copy(base);
        mesh.material.emissive.copy(base).multiplyScalar(lit ? 0.55 : 0.1);
      }
    }

    for (const site of layout.sites) {
      const pad = sitePads.get(site.id);
      if (!pad) continue;
      const lit = running ? currentId === site.id : highlight.pinned === site.id;
      const dim = dimmedSite(site) && !lit;
      dimTable.set(site.id, dim);
      litTable.set(site.id, lit);
      const base = tmpColor.set(palette["--cat-4"]);
      pad.material.color.copy(base).lerp(bg, dim ? 0.72 : 0);
      pad.material.emissive.copy(base).multiplyScalar(lit ? 0.5 : 0.12);
    }

    // 중계탑 — 그 설비를 따라 흐려진다
    for (const tower of towers) {
      tower.mesh.material.color
        .set(palette["--border-strong"])
        .lerp(bg, dimTable.get(tower.site) ? 0.72 : 0);
    }
    beaconMat.color.set(palette["--danger"]);

    // 인스턴스 부품 — 주인이 흐려지면 같이 흐려진다
    for (const entry of banks) {
      entry.mesh.material.color.setHex(0xffffff); // 실제 색은 인스턴스별로
      entry.slots.forEach((slot, i) => {
        dimColor.set(palette[slot.token]);
        if (slot.owner) {
          if (dimTable.get(slot.owner)) dimColor.lerp(bg, 0.8);
          // 켜진 유닛도 부품 색조는 남겨야 한다 — 하얗게 날리면 포트 색으로 성격을 못 읽는다
          else if (litTable.get(slot.owner)) dimColor.lerp(WHITE, 0.15);
        }
        entry.mesh.setColorAt(i, dimColor);
      });
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    }

    // 배관 — 지금 화물이 지나는 관만 달아오른다
    hotColor.set(palette["--accent"]);
    for (const [id, pipe] of pipeMeshes) {
      const hot = activePipe === id;
      const cold =
        !hot &&
        (running
          ? !(routeIds.has(pipe.from) && routeIds.has(pipe.to))
          : Boolean(dimTable.get(pipe.from) && dimTable.get(pipe.to)));
      pipe.mesh.material.color.copy(hot ? hotColor : tmpColor.set(palette["--border-strong"]));
      if (cold) pipe.mesh.material.color.lerp(bg, 0.72);
      pipe.mesh.material.emissive.copy(hotColor).multiplyScalar(hot ? 0.55 : 0);
    }

    for (const material of conduitMats) material.color.set(palette["--border-strong"]);
    for (const material of linkMats) {
      material.color.set(palette["--accent"]);
      material.emissive.set(palette["--accent"]).multiplyScalar(0.18);
    }
  }
  paint();

  // ── 픽킹 ────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickable = () => [...bodies.values(), ...sitePads.values()];
  let hovered: string | null = null;
  let pointerInside = false;

  function updatePointer(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerInside = true;
  }

  function pick(): string | null {
    if (!pointerInside || walking) return null;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickable(), false)[0];
    return (hit?.object.userData.id as string) ?? null;
  }

  const onPointerMove = (event: PointerEvent) => updatePointer(event);
  const onPointerLeave = () => {
    pointerInside = false;
    if (hovered) {
      hovered = null;
      hooks.onHover(null);
    }
  };
  const onClick = (event: PointerEvent) => {
    updatePointer(event);
    hooks.onPick(pick());
  };
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);

  // ── 걷기 모드 ───────────────────────────────────────────────
  const walker = new PointerLockControls(camera, renderer.domElement);
  let walking = false;
  const keys = new Set<string>();
  const savedPose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  const onKeyDown = (e: KeyboardEvent) => walking && keys.add(e.code);
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  addEventListener("keydown", onKeyDown);
  addEventListener("keyup", onKeyUp);

  walker.addEventListener("unlock", () => {
    if (!walking) return;
    walking = false;
    keys.clear();
    orbit.enabled = true;
    camera.position.copy(savedPose.pos);
    orbit.target.copy(savedPose.target);
    hooks.onWalkChange(false);
  });

  function setWalk(on: boolean) {
    if (on === walking) return;
    if (on) {
      savedPose.pos.copy(camera.position);
      savedPose.target.copy(orbit.target);
      orbit.enabled = false;
      walking = true;
      // 성문 안쪽 거리에 내려선다
      camera.position.set(0, 1.75, layout.wallRadius - 10);
      camera.lookAt(0, 1.75, 0);
      walker.lock();
      hooks.onWalkChange(true);
    } else {
      walker.unlock();
    }
  }

  const walkDir = new THREE.Vector3();
  function stepWalk(dt: number) {
    const speed = (keys.has("ShiftLeft") ? 26 : 12) * dt;
    walkDir.set(0, 0, 0);
    if (keys.has("KeyW") || keys.has("ArrowUp")) walkDir.z += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) walkDir.z -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) walkDir.x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) walkDir.x += 1;
    if (walkDir.lengthSq() === 0) return;
    walkDir.normalize();
    walker.moveForward(walkDir.z * speed);
    walker.moveRight(walkDir.x * speed);
    camera.position.y = 1.75;
  }

  // ── 카메라 이동(포커스) ─────────────────────────────────────
  let glide: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    t: number;
  } | null = null;

  function focus(id: string) {
    if (walking) return;
    const mesh = bodies.get(id) ?? sitePads.get(id);
    if (!mesh) return;
    const target = mesh.position.clone();
    const site = layout.sites.find((s) => s.id === id);
    // 설비는 계층 기둥이 위로 길어서 기둥 한가운데를 잡고 조금 더 물러난다
    if (site) target.y = 0.95 + (site.layers.length * LAYER_GAP) / 2;
    const distance = site ? 28 : 21;
    const to = target
      .clone()
      .add(new THREE.Vector3(0.55, 0.6, 0.55).normalize().multiplyScalar(distance));
    if (reduced) {
      camera.position.copy(to);
      orbit.target.copy(target);
      return;
    }
    glide = { from: camera.position.clone(), to, fromT: orbit.target.clone(), toT: target, t: 0 };
  }

  function resetCamera() {
    if (walking) return;
    if (reduced) {
      camera.position.copy(HOME);
      orbit.target.set(0, 0, 0);
      return;
    }
    glide = {
      from: camera.position.clone(),
      to: HOME.clone(),
      fromT: orbit.target.clone(),
      toT: new THREE.Vector3(0, 0, 0),
      t: 0,
    };
  }

  // ── 화물 이동 ───────────────────────────────────────────────
  interface Node {
    id: string | null;
    at: THREE.Vector3;
    step: number | null;
    /** 옆 기기 — 직결 링크를 타고 건너간다 */
    peer?: boolean;
  }

  function nodesFor(pipelineId: string): Node[] {
    const byId = new Map(layout.buildings.map((b) => [b.id, b]));
    const out: Node[] = [];

    for (const stop of routeFor(pipelineId)) {
      if (stop.outpostId) {
        const site = layout.sites.find((s) => s.id === stop.outpostId);
        if (site) {
          out.push({
            id: site.id,
            at: new THREE.Vector3(site.x, 0.95 + site.layers.length * LAYER_GAP, site.z),
            step: stop.index,
          });
        }
      }
      const b = stop.buildingId ? byId.get(stop.buildingId) : undefined;
      if (b) {
        out.push({ id: b.id, at: new THREE.Vector3(b.x, PLOT_H + b.h + 0.2, b.z), step: stop.index });
      }
    }

    if (usesBridge(pipelineId) && layout.peer) {
      out.push({
        id: null,
        at: new THREE.Vector3(layout.peer.x, 2.2, layout.peer.z),
        step: null,
        peer: true,
      });
    } else {
      // 나머지는 전부 "표준 다운로드"에서 끝난다 — 성문을 지나지 않는 출구.
      const save = byId.get("common-save");
      if (save) {
        out.push({
          id: save.id,
          at: new THREE.Vector3(save.x, PLOT_H + save.h + 0.2, save.z),
          step: null,
        });
      }
    }
    return out;
  }

  /** 두 지점 사이를 잇는 길 — 배관이 있으면 그 관을 타고, 없으면 배관층 높이로 건너뛴다. */
  function legBetween(a: Node, b: Node): Leg {
    // 옆 기기로 건너갈 땐 깔아 둔 직결 링크를 그대로 탄다 — 칼라를 꿰고 지나가야 한다
    if (b.peer && peerLink) {
      const curve = polyCurve([
        a.at,
        { x: a.at.x, y: peerLink.from.y, z: a.at.z },
        peerLink.from,
        peerLink.to,
      ]);
      return { curve, length: curve.getLength(), step: b.step, arriveId: null, pipeId: null };
    }
    // 한 유닛이 연달아 여러 단계를 맡는 일이 흔하다(gif의 video.ts가 1~3단계).
    // 이때 배관층까지 올라갔다 제자리로 내려오면 헛도는 것처럼 보인다 — 그 자리에서 한 번 튄다.
    if (a.id && a.id === b.id) {
      const curve = polyCurve([
        a.at,
        { x: a.at.x, y: a.at.y + 1.1, z: a.at.z },
        { x: b.at.x, y: b.at.y, z: b.at.z },
      ]);
      return { curve, length: curve.getLength(), step: b.step, arriveId: b.id, pipeId: null };
    }
    if (a.id && b.id) {
      const forward = layout.pipes.find((p) => p.from === a.id && p.to === b.id);
      const backward = layout.pipes.find((p) => p.from === b.id && p.to === a.id);
      const pipe = forward ?? backward;
      if (pipe) {
        const points = forward ? pipe.points : [...pipe.points].reverse();
        const curve = polyCurve(points);
        return {
          curve,
          length: curve.getLength(),
          step: b.step,
          arriveId: b.id,
          pipeId: pipe.id,
        };
      }
    }
    // 관이 없는 구간(설비·옆 기기로 나가는 길)은 배관층으로 올라갔다 내려온다
    const high = layout.rackY + 1.4;
    const curve = polyCurve([
      { x: a.at.x, y: a.at.y, z: a.at.z },
      { x: a.at.x, y: high, z: a.at.z },
      { x: b.at.x, y: high, z: b.at.z },
      { x: b.at.x, y: b.at.y, z: b.at.z },
    ]);
    return { curve, length: curve.getLength(), step: b.step, arriveId: b.id, pipeId: null };
  }

  /** 마지막 지점에서 궤짝을 치우는 예약 — 정지·재생을 빨리 누르면 새 화물을 지워 버린다 */
  let endTimer = 0;

  function play(pipelineId: string) {
    const nodes = nodesFor(pipelineId);
    if (nodes.length < 2) return;
    clearTimeout(endTimer);

    legs = [];
    for (let i = 0; i + 1 < nodes.length; i++) legs.push(legBetween(nodes[i], nodes[i + 1]));
    if (legs.length === 0) return;

    routeIds = new Set(nodes.map((n) => n.id).filter((id): id is string => Boolean(id)));
    legIndex = 0;
    legDist = 0;
    dwellLeft = 0;
    currentId = nodes[0].id;
    activePipe = legs[0].pipeId;
    running = true;
    for (const box of crates) {
      box.visible = true;
      box.position.copy(nodes[0].at);
    }
    paint();
    hooks.onStep(nodes[0].step);
  }

  function stop() {
    clearTimeout(endTimer);
    running = false;
    legs = [];
    routeIds = new Set();
    currentId = null;
    activePipe = null;
    for (const box of crates) box.visible = false;
    paint();
    hooks.onStep(null);
  }

  const crateAt = new THREE.Vector3();
  const crateAhead = new THREE.Vector3();

  function placeCrates(leg: Leg, distance: number) {
    for (let i = 0; i < crates.length; i++) {
      const d = Math.max(0, Math.min(leg.length, distance - i * 0.95));
      const u = leg.length > 0 ? d / leg.length : 0;
      leg.curve.getPointAt(u, crateAt);
      crates[i].position.copy(crateAt);
      // 진행 방향을 본다 — 궤짝이 옆으로 미끄러지지 않게
      const ahead = Math.min(1, u + 0.02);
      leg.curve.getPointAt(ahead, crateAhead);
      if (crateAhead.distanceToSquared(crateAt) > 1e-6) crates[i].lookAt(crateAhead);
    }
  }

  function advanceCargo(dtMs: number) {
    if (!running || legs.length === 0) return;
    if (dwellLeft > 0) {
      dwellLeft -= dtMs;
      return;
    }
    const leg = legs[legIndex];
    legDist += dtMs * CARGO_SPEED;

    if (legDist >= leg.length) {
      placeCrates(leg, leg.length);
      if (leg.step !== null) hooks.onStep(leg.step);
      if (leg.arriveId !== currentId) currentId = leg.arriveId;
      dwellLeft = DWELL_MS;
      legIndex += 1;
      legDist = 0;
      activePipe = legs[legIndex]?.pipeId ?? null;
      paint();
      if (legIndex >= legs.length) {
        // 마지막 지점에서 잠깐 머문 뒤 사라진다
        running = false;
        endTimer = setTimeout(() => {
          for (const box of crates) box.visible = false;
          hooks.onStep(null);
        }, DWELL_MS * 2);
      }
      return;
    }
    placeCrates(leg, legDist);
  }

  // ── 루프 ────────────────────────────────────────────────────
  const projected = new THREE.Vector3();
  const labelSize = new WeakMap<HTMLElement, { w: number; h: number }>();
  function placeLabels() {
    const rect = canvas.getBoundingClientRect();
    const draw = (el: HTMLElement, at: THREE.Vector3) => {
      projected.copy(at).project(camera);
      if (projected.z > 1) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "visible";
      // 크기는 한 번만 잰다 — 프레임마다 재면 매번 레이아웃이 강제된다
      let size = labelSize.get(el);
      if (!size || size.w === 0) {
        size = { w: el.offsetWidth, h: el.offsetHeight };
        labelSize.set(el, size);
      }
      // 가장자리 물체의 이름표가 캔버스 밖으로 잘리지 않게 가둔다
      const x = Math.min(
        Math.max(((projected.x + 1) / 2) * rect.width, size.w / 2 + 4),
        rect.width - size.w / 2 - 4,
      );
      const y = Math.min(
        Math.max(((1 - projected.y) / 2) * rect.height, size.h + 4),
        rect.height - 4,
      );
      el.style.transform = `translate(-50%,-100%) translate(${x}px, ${y}px)`;
    };
    for (const label of labels) {
      if (label.el.hidden) continue;
      draw(label.el, label.at);
    }
    if (focusAt && !focusLabel.hidden) draw(focusLabel, focusAt);
  }

  let raf = 0;
  let last = performance.now();
  let disposed = false;
  let beaconPhase = 0;

  function tick(now: number) {
    if (disposed) return;
    const dtMs = Math.min(64, now - last);
    last = now;

    if (glide) {
      glide.t = Math.min(1, glide.t + dtMs / 520);
      const e = glide.t * glide.t * (3 - 2 * glide.t);
      camera.position.lerpVectors(glide.from, glide.to, e);
      orbit.target.lerpVectors(glide.fromT, glide.toT, e);
      if (glide.t >= 1) glide = null;
    }

    if (walking) stepWalk(dtMs / 1000);
    else orbit.update();

    advanceCargo(dtMs);

    // 중계탑 항공장애등 — 살아 있는 회선이라는 표시
    if (!reduced) {
      beaconPhase += dtMs / 900;
      const pulse = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(beaconPhase));
      beaconMat.emissive.set(palette["--danger"]).multiplyScalar(pulse);
    }

    // 짚기 — 프레임마다 한 번만 광선을 쏜다
    if (!walking) {
      const id = pick();
      if (id !== hovered) {
        hovered = id;
        hooks.onHover(id);
      }
    }

    placeLabels();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  // ── 크기 ────────────────────────────────────────────────────
  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return {
    layout,
    setHighlight(state) {
      highlight = state;
      paint();

      const target = state.pinned;
      const b = target ? layout.buildings.find((x) => x.id === target) : undefined;
      const site = target ? layout.sites.find((x) => x.id === target) : undefined;

      // 계층·호스트 이름표는 그 설비를 골랐을 때만 펼친다
      for (const label of labels) {
        if (label.site) label.el.hidden = label.site !== target;
      }

      if (b) {
        focusLabel.hidden = false;
        focusLabel.textContent = `${b.label} · ${b.loc}줄 · 기술 ${b.ports.length}`;
        focusAt = new THREE.Vector3(b.x, PLOT_H + b.h + 1.5, b.z);
      } else if (site) {
        // 설비는 계층 이름표가 이미 기둥을 따라 붙는다 — 여기에 문구를 더 얹으면
        // 맨 아래 층을 가린다. 무엇이 지나가는지는 상세 패널이 글로 말한다.
        focusLabel.hidden = true;
        focusAt = null;
      } else {
        focusLabel.hidden = true;
        focusAt = null;
      }
    },
    refreshPalette() {
      palette = readPalette();
      paint();
    },
    focus,
    play,
    stop,
    setWalk,
    resetCamera,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
      if (walking) walker.unlock();
      walker.disconnect();
      orbit.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      overlay.replaceChildren();
    },
  };
}
