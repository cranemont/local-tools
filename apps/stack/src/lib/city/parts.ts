// 기계 부품 지오메트리 — 색도 위치도 모르는 순수 도형 공장.
//
// scene.ts가 이걸로 유닛을 조립한다. 여기서 만드는 건 전부 "한 번 만들어 여러 번 쓰는"
// 것들이라 InstancedMesh에 그대로 물릴 수 있게 원점 기준으로 세워 둔다.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * 격자 중계탑 — 다리 4개 + 가로대 + 접시.
 * 상자 하나로 세우면 그냥 기둥이라 통신 설비로 안 읽힌다. 밑동이 원점, +Y로 선다.
 */
export function latticeTower(height: number, half = 0.3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const legR = 0.05;

  // 다리 넷 — 위로 갈수록 좁아지게 살짝 기울인다
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const leg = new THREE.BoxGeometry(legR * 2, height, legR * 2);
    leg.translate(sx * half, height / 2, sz * half);
    parts.push(leg);
  }

  // 가로대 — 층마다 네 변
  const levels = Math.max(2, Math.round(height / 1.15));
  for (let i = 1; i <= levels; i++) {
    const y = (height * i) / (levels + 1);
    for (const axis of [0, 1]) {
      for (const side of [-1, 1]) {
        const bar =
          axis === 0
            ? new THREE.BoxGeometry(half * 2, 0.05, 0.05)
            : new THREE.BoxGeometry(0.05, 0.05, half * 2);
        bar.translate(axis === 0 ? 0 : side * half, y, axis === 0 ? side * half : 0);
        parts.push(bar);
      }
    }
  }

  // 꼭대기 접시 — 열린 원뿔을 눕혀 바깥(+X)을 본다
  const dish = new THREE.CylinderGeometry(0.42, 0.06, 0.42, 14, 1, true);
  dish.rotateZ(-Math.PI / 2);
  dish.translate(0.34, height + 0.1, 0);
  parts.push(dish);

  // 접시를 받치는 짧은 기둥
  const neck = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6);
  neck.translate(0, height + 0.1, 0);
  parts.push(neck);

  return mergeGeometries(parts, false)!;
}

/**
 * 배기 덕트 — wasm을 쓰는 유닛의 지붕에 선다.
 * 바깥에서 받아 오는 게 있다는 표시라서 굴뚝 모양으로 눈에 띄게.
 */
export function ductStack(): THREE.BufferGeometry {
  const pipe = new THREE.CylinderGeometry(0.15, 0.19, 0.85, 10);
  pipe.translate(0, 0.425, 0);
  const cap = new THREE.CylinderGeometry(0.24, 0.24, 0.09, 10);
  cap.translate(0, 0.89, 0);
  return mergeGeometries([pipe, cap], false)!;
}

/** 지붕 안테나 — 바깥과 통하는 유닛. 가느다란 마스트 + 끝의 구슬. */
export function roofAntenna(height = 1.5): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.035, 0.045, height, 6);
  mast.translate(0, height / 2, 0);
  const bead = new THREE.SphereGeometry(0.11, 10, 8);
  bead.translate(0, height + 0.08, 0);
  return mergeGeometries([mast, bead], false)!;
}

/** 화물 상자 — 모서리를 두른 궤짝. 공이 아니라 물건으로 보이게. */
export function crate(size = 0.72): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(size, size, size);
  const band = new THREE.BoxGeometry(size * 1.08, size * 0.2, size * 1.08);
  return mergeGeometries([body, band], false)!;
}

/**
 * 공개 게시판 — 릴레이 하나. 기둥 둘에 판 하나, 판에는 슬롯 네 칸이 파여 있다.
 * 상자로 두면 창고로 읽히지만, 슬롯이 보이면 "여기에 무언가를 붙여 두는 곳"이 된다.
 */
export function bulletinBoard(slotYs: number[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const W = 3.4;

  for (const side of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.22, 5.0, 0.22);
    post.translate(side * (W / 2 - 0.2), 2.5, 0);
    parts.push(post);
  }

  // 뒷판 — 이게 없으면 가로대만 남아 울타리로 읽힌다. 봉투가 기댈 면이기도 하다.
  const back = new THREE.BoxGeometry(W, slotYs[slotYs.length - 1] - slotYs[0] + 1.4, 0.12);
  back.translate(0, (slotYs[0] + slotYs[slotYs.length - 1]) / 2, -0.11);
  parts.push(back);

  // 판 — 슬롯이 파인 것처럼 보이도록 칸 사이에 가로대만 남긴다
  const top = new THREE.BoxGeometry(W, 0.18, 0.3);
  top.translate(0, slotYs[slotYs.length - 1] + 0.62, 0);
  parts.push(top);
  const bottom = new THREE.BoxGeometry(W, 0.18, 0.3);
  bottom.translate(0, slotYs[0] - 0.5, 0);
  parts.push(bottom);
  for (const y of slotYs) {
    const rail = new THREE.BoxGeometry(W, 0.07, 0.34);
    rail.translate(0, y - 0.3, 0);
    parts.push(rail);
  }

  // 지붕 — 게시판이 비를 맞지 않게 생긴 것. 실루엣을 알아보게 하는 역할.
  const roof = new THREE.BoxGeometry(W + 0.5, 0.16, 0.9);
  roof.translate(0, 5.05, -0.1);
  parts.push(roof);

  return mergeGeometries(parts, false)!;
}

/**
 * 거울 — STUN. 틀에 낀 판 하나. 가서 자기를 비춰 보고 돌아오는 곳이라
 * 무엇을 저장하거나 중계하는 물건처럼 보이면 안 된다.
 */
export function mirrorPanel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const post = new THREE.CylinderGeometry(0.18, 0.24, 3.2, 8);
  post.translate(0, 1.6, 0);
  parts.push(post);
  // 받침 — 서 있는 물건이라는 걸 분명히
  const foot = new THREE.CylinderGeometry(1.0, 1.2, 0.36, 10);
  foot.translate(0, 0.18, 0);
  parts.push(foot);
  // 틀
  const frame = new THREE.BoxGeometry(3.8, 4.4, 0.3);
  frame.translate(0, 5.6, 0);
  parts.push(frame);
  return mergeGeometries(parts, false)!;
}

/** 거울 면 — 틀과 색이 달라야 해서 따로 만든다(반사면은 밝게 칠한다) */
export function mirrorFace(): THREE.BufferGeometry {
  const face = new THREE.BoxGeometry(3.3, 3.9, 0.1);
  face.translate(0, 5.6, 0.2);
  return face;
}

/** 봉투 — 게시판에 붙는 한 장. 봉인 여부는 색으로 가른다. */
export function envelope(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sheet = new THREE.BoxGeometry(1.5, 0.62, 0.1);
  parts.push(sheet);
  // 접힌 덮개 — 종이로 보이게 하는 최소한의 실루엣
  const flap = new THREE.BoxGeometry(1.5, 0.2, 0.14);
  flap.translate(0, 0.18, 0.02);
  parts.push(flap);
  return mergeGeometries(parts, false)!;
}

/**
 * 반쪽 자물쇠 — SPAKE2. 양쪽이 하나씩 들고 와 맞물려야 열쇠가 된다.
 * 이가 맞물리는 모양이라 "혼자서는 아무것도 안 된다"가 형태로 읽힌다.
 */
export function lockHalf(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(0.9, 1.2, 0.6);
  parts.push(body);
  for (let i = 0; i < 3; i++) {
    const tooth = new THREE.BoxGeometry(0.42, 0.24, 0.6);
    tooth.translate(0.62, -0.4 + i * 0.4, 0);
    parts.push(tooth);
  }
  return mergeGeometries(parts, false)!;
}

/** 꺾인 폴리라인을 부드럽게 뭉개지 않는 경로로 — 배관은 직각이 살아야 한다. */
export function polyCurve(points: { x: number; y: number; z: number }[]): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i + 1 < points.length; i++) {
    path.add(
      new THREE.LineCurve3(
        new THREE.Vector3(points[i].x, points[i].y, points[i].z),
        new THREE.Vector3(points[i + 1].x, points[i + 1].y, points[i + 1].z),
      ),
    );
  }
  return path;
}

/**
 * 배관 — 경로를 따라가는 관에 꺾이는 자리마다 엘보를 끼운다.
 * TubeGeometry만 쓰면 직각에서 단면이 찌그러져 보여서 구를 덧대 가린다.
 */
export function pipeGeometry(
  points: { x: number; y: number; z: number }[],
  radius: number,
): THREE.BufferGeometry {
  const curve = polyCurve(points);
  const parts: THREE.BufferGeometry[] = [
    new THREE.TubeGeometry(curve, Math.max(8, points.length * 4), radius, 8, false),
  ];
  for (let i = 1; i + 1 < points.length; i++) {
    const elbow = new THREE.SphereGeometry(radius * 1.22, 10, 8);
    elbow.translate(points[i].x, points[i].y, points[i].z);
    parts.push(elbow);
  }
  return mergeGeometries(parts, false)!;
}
