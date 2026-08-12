// 드롭의 랑데부를 도시 안의 장치로 옮긴 것 — 배치 자체가 논거다.
//
// 글로 "릴레이는 만남의 장소일 뿐 파일은 지나지 않는다"라고 쓰는 대신,
// 게시판과 거울을 **직선 경로에서 비켜난 곁길**에 두고 파일이 지나는 관은
// 두 기기 사이 **최단 직선**으로 놓는다. 눈으로 보면 신호는 옆으로 새고
// 파일은 곧장 간다 — 그게 이 기능의 전부다.
//
//   거울(STUN)   = 가 보면 "밖에서 네 주소는 이렇게 보인다"고 되비쳐 주는 것.
//                  왕복 한 번 하고 끝, 통로가 뚫린 뒤엔 아무 역할이 없다.
//   게시판(릴레이) = 아무나 읽을 수 있는 공개 게시판. 방 번호는 코드에서만 나오고
//                  붙는 것은 봉인된 봉투와 공개 설계값뿐. 6개가 똑같아서 하나만 살아도 된다.
//   자물쇠(SPAKE2) = 양쪽이 반쪽씩 들고 와 맞물려야 열쇠가 생긴다.
//   관(DTLS·SCTP) = 봉투를 다 주고받은 **뒤에야** 조립된다. 파일은 여기로만 흐른다.
//
// ⚠️ 숫자·태그·바이트 수는 전부 apps/drop 소스에서 확인한 값이다.
//    해당 코드를 고치면 여기 대사도 같이 고쳐야 한다.

export type Party = "me" | "peer";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 게시판 하나 — 릴레이 하나에 대응한다 */
export interface Board {
  host: string;
  x: number;
  z: number;
  /** 판이 도시 쪽을 보도록 하는 회전 */
  angle: number;
  /** 슬롯 4개의 자리 — 방 태그 …a …b …o …r */
  slots: Vec3[];
}

/** 거울 하나 — 기기 하나가 자기 주소를 확인하러 가는 곳 */
export interface Mirror {
  owner: Party;
  label: string;
  x: number;
  z: number;
  angle: number;
}

/** 게시판에 붙는 봉투 한 장 */
export interface SlotSpec {
  /** 방 태그 접미사 */
  tag: string;
  label: string;
  from: Party;
  /** 봉인(암호문)인가 — 열린 공개값인가 */
  sealed: boolean;
}

/** 재생 한 박자 — scene.ts가 이걸 보고 무대를 움직인다 */
export type Beat =
  /** 코드에서 방 번호를 뽑아 게시판마다 내건다 */
  | { kind: "tag"; label: string; note: string }
  /** 거울에 다녀온다(왕복) */
  | { kind: "mirror"; who: Party; label: string; note: string }
  /** 후보를 다 모을 때까지 제자리에서 기다린다 */
  | { kind: "gather"; who: Party; label: string; note: string }
  /** 봉투를 게시판 슬롯에 붙인다 */
  | { kind: "post"; who: Party; slot: number; label: string; note: string }
  /** 상대가 그 슬롯에서 봉투를 떼어 간다 */
  | { kind: "read"; who: Party; slot: number; label: string; note: string }
  /** 반쪽 자물쇠가 맞물려 열쇠가 생긴다 */
  | { kind: "key"; label: string; note: string }
  /** 관이 조립된다 */
  | { kind: "build"; label: string; note: string }
  /** 파일이 그 관으로만 흐른다 */
  | { kind: "file"; label: string; note: string };

export interface RendezvousStage {
  me: Vec3;
  peer: Vec3;
  boards: Board[];
  mirrors: Mirror[];
  slots: SlotSpec[];
  /** 직결 관 — 재생 중에 조립된다 */
  link: { from: Vec3; to: Vec3 };
  /** 관의 단면을 세워 두는 자리(성문 옆) — webrtc의 계층을 여기에 쌓는다 */
  linkStackAt: Vec3;
  /** 게시판 발치 — websocket의 계층을 여기에 쌓는다 */
  boardStackAt: Vec3;
  beats: Beat[];
}

const SLOT_Y = [1.7, 2.5, 3.3, 4.1];

/** 게시판에 붙는 네 장 — rendezvous.ts의 방 태그 접미사 그대로 */
export const SLOTS: SlotSpec[] = [
  { tag: "…a", label: "pA (65B)", from: "me", sealed: false },
  { tag: "…b", label: "pB ‖ confB (65+32B)", from: "peer", sealed: false },
  { tag: "…o", label: "confA ‖ 봉인된 청약", from: "me", sealed: true },
  { tag: "…r", label: "봉인된 응답", from: "peer", sealed: true },
];

/**
 * 무대를 세운다.
 *
 * @param me         드롭 구역의 중심 — 내 기기
 * @param angle      도시 중심에서 드롭 구역을 본 방위
 * @param wallRadius 성벽 반지름 — 상대 기기를 성벽 밖 얼마나 멀리 둘지의 기준
 */
export function buildStage(
  me: { x: number; z: number },
  angle: number,
  wallRadius: number,
  hosts: string[],
): RendezvousStage {
  // u = 성벽 밖으로 나가는 방향, t = 그와 직각(곁길이 나는 쪽)
  const u = { x: Math.cos(angle), z: Math.sin(angle) };
  const t = { x: -Math.sin(angle), z: Math.cos(angle) };

  const meAt: Vec3 = { x: me.x, y: 2.4, z: me.z };
  const reach = wallRadius + 34 - Math.hypot(me.x, me.z);
  const peerAt: Vec3 = { x: me.x + u.x * reach, y: 2.4, z: me.z + u.z * reach };

  // ── 게시판 — 두 기기의 한가운데, 그러나 직선에서 옆으로 비켜서 ──
  // 이 옆걸음이 이 그림의 요점이다. 신호는 여기를 들르고 파일은 안 들른다.
  const midX = (meAt.x + peerAt.x) / 2;
  const midZ = (meAt.z + peerAt.z) / 2;
  const OFFSET = 17;
  const rowX = midX + t.x * OFFSET;
  const rowZ = midZ + t.z * OFFSET;

  const boards: Board[] = hosts.map((host, i) => {
    const along = (i - (hosts.length - 1) / 2) * 4.6;
    const x = rowX + u.x * along;
    const z = rowZ + u.z * along;
    return {
      host,
      x,
      z,
      // 판은 직선 경로 쪽(= -t 방향)을 본다
      angle: Math.atan2(-t.x, -t.z),
      slots: SLOT_Y.map((y) => ({ x, y, z })),
    };
  });

  // ── 거울 — 게시판 반대쪽 곁길. 기기마다 하나씩(양쪽 다 자기 주소를 물어본다) ──
  const mirrorOffset = -15;
  const mirrors: Mirror[] = [
    {
      owner: "me",
      label: "stun.l.google.com:19302",
      x: meAt.x + u.x * 24 + t.x * mirrorOffset,
      z: meAt.z + u.z * 24 + t.z * mirrorOffset,
      angle: Math.atan2(t.x, t.z),
    },
    {
      owner: "peer",
      label: "stun.l.google.com:19302",
      x: peerAt.x - u.x * 24 + t.x * mirrorOffset,
      z: peerAt.z - u.z * 24 + t.z * mirrorOffset,
      angle: Math.atan2(t.x, t.z),
    },
  ];

  return {
    me: meAt,
    peer: peerAt,
    boards,
    mirrors,
    slots: SLOTS,
    link: { from: meAt, to: peerAt },
    // 관의 단면은 성문 바로 밖에 세운다 — 관이 무엇으로 겹쳐 있는지 그 입구에서 보이게
    linkStackAt: {
      x: Math.cos(angle) * (wallRadius + 6) + t.x * 5,
      y: 0,
      z: Math.sin(angle) * (wallRadius + 6) + t.z * 5,
    },
    boardStackAt: { x: rowX + t.x * 6.5, y: 0, z: rowZ + t.z * 6.5 },

    beats: [
      {
        kind: "tag",
        label: "코드 → 방 번호",
        note: "6자리를 PBKDF2 12만 회로 늘여 128비트 방 태그를 만든다. 게시판은 번호만 볼 뿐 코드는 모른다. 방은 5분 뒤 만료(NIP-40).",
      },
      {
        kind: "mirror",
        who: "me",
        label: "거울에 다녀오기",
        note: "STUN에 한 번 물어 '밖에서 내 주소가 어떻게 보이나'를 받아 온다(srflx). 같은 네트워크면 이 왕복조차 없다. 거울이 보는 건 내 공인 IP와 포트, 그게 전부다.",
      },
      {
        kind: "gather",
        who: "me",
        label: "후보를 다 모은다 (non-trickle)",
        note: "하나씩 흘려보내지 않고 다 모아 한 덩어리로 만든다. 그래야 연결 정보가 봉투 한 장에 담긴다.",
      },
      {
        kind: "post",
        who: "me",
        slot: 0,
        label: "pA 게시",
        note: "w = PBKDF2(코드, 21만 회)를 고정점 M에 실어 보낸다. 게시판에 붙어도 pA만으로는 코드를 되짚을 수 없다.",
      },
      {
        kind: "post",
        who: "peer",
        slot: 1,
        label: "pB ‖ confB 게시",
        note: "상대도 같은 코드로 w를 만들어야 K가 맞는다. 여기 붙는 confB는 '내가 같은 코드를 안다'는 증표.",
      },
      {
        kind: "key",
        label: "반쪽이 맞물려 열쇠가 된다",
        note: "양쪽이 같은 K에서 같은 Ke를 얻는다. 코드가 틀리면 다른 열쇠가 나오고 조용히 버려진다 — 게시판 기록만으로는 맞았는지 알 수 없다.",
      },
      {
        kind: "post",
        who: "me",
        slot: 2,
        label: "봉인된 청약 게시",
        note: "그 열쇠로 SDP를 AES-256-GCM으로 잠가 붙인다. 게시판에 남는 건 암호문이다.",
      },
      {
        kind: "post",
        who: "peer",
        slot: 3,
        label: "봉인된 응답 게시",
        note: "상대도 같은 방식으로 잠가 붙인다. 여기까지가 게시판이 하는 일 전부다.",
      },
      {
        kind: "build",
        label: "관이 조립된다",
        note: "봉투에서 꺼낸 주소로 두 기기가 직접 DTLS 핸드셰이크를 한다. SCTP 위에 DataChannel \"drop\" 하나가 열린다 — 이 관에는 중간이 없다.",
      },
      {
        kind: "file",
        label: "파일은 이 관으로만 흐른다",
        note: "64KB 청크로 보내다 버퍼가 8MB를 넘으면 멈추고 1MB로 빠지면 잇는다. 게시판도 거울도 이제 아무 역할이 없다 — 그래서 꺼진다.",
      },
    ],
  };
}
