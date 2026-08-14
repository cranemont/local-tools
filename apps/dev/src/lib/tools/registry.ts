import type { Component } from "svelte";
import { t } from "../i18n";
import type { IconName } from "../Icon.svelte";
import Format from "./Format.svelte";
import Color from "./Color.svelte";
import Encode from "./Encode.svelte";
import Jwt from "./Jwt.svelte";
import Hash from "./Hash.svelte";
import Uuid from "./Uuid.svelte";
import Qr from "./Qr.svelte";
import Timestamp from "./Timestamp.svelte";
import CronTool from "./CronTool.svelte";
import Diff from "./Diff.svelte";
import Chars from "./Chars.svelte";
import Regex from "./Regex.svelte";
import Xpath from "./Xpath.svelte";
import Cookie from "./Cookie.svelte";
import OAuthTool from "./OAuthTool.svelte";
import Saml from "./Saml.svelte";

export interface ToolDef {
  id: string;
  icon: IconName;
  title: string;
  desc: string;
  group: string;
  /** 검색용 — 제목 외에 걸릴 만한 말들 (영문 포함) */
  keywords: string;
  component: Component;
}

// 배열 순서가 사이드바 순서·그룹 순서를 결정한다.
export const TOOLS: ToolDef[] = [
  {
    id: "format",
    icon: "braces",
    title: t.format.title,
    desc: t.format.desc,
    group: t.groups.format,
    keywords: "json yaml xml 제이슨 변환 정리 압축 포맷 formatter convert minify pretty 트리 tree 접기 키 정렬 들여쓰기 beautify",
    component: Format,
  },
  {
    id: "xpath",
    icon: "route",
    title: t.xpath.title,
    desc: t.xpath.desc,
    group: t.groups.format,
    keywords: "xpath 엑스패스 xml 쿼리 질의 노드 선택 경로 query selector 매칭",
    component: Xpath,
  },
  {
    id: "color",
    icon: "palette",
    title: t.color.title,
    desc: t.color.desc,
    group: t.groups.format,
    keywords: "색 색상 색깔 컬러 color hex rgb rgba hsl oklch 변환 팔레트",
    component: Color,
  },
  {
    id: "encode",
    icon: "code",
    title: t.encode.title,
    desc: t.encode.desc,
    group: t.groups.sec,
    keywords: "base64 베이스64 url 인코딩 디코딩 암호화 복호화 encode decode percent 퍼센트 이스케이프",
    component: Encode,
  },
  {
    id: "jwt",
    icon: "key",
    title: t.jwt.title,
    desc: t.jwt.desc,
    group: t.groups.sec,
    keywords: "jwt 토큰 token 디코드 decode 서명 검증 verify 클레임 claim bearer 만료 인증",
    component: Jwt,
  },
  {
    id: "oauth",
    icon: "shield",
    title: t.oauth.title,
    desc: t.oauth.desc,
    group: t.groups.sec,
    keywords: "oauth oidc 인가 인증 로그인 authorize pkce state nonce 콜백 callback redirect openid",
    component: OAuthTool,
  },
  {
    id: "saml",
    icon: "idcard",
    title: t.saml.title,
    desc: t.saml.desc,
    group: t.groups.sec,
    keywords: "saml sso 싱글사인온 인증 로그인 assertion authnrequest response 디코드 idp sp",
    component: Saml,
  },
  {
    id: "cookie",
    icon: "cookie",
    title: t.cookie.title,
    desc: t.cookie.desc,
    group: t.groups.sec,
    keywords: "쿠키 cookie set-cookie samesite secure httponly 헤더 세션 도메인 만료 분석",
    component: Cookie,
  },
  {
    id: "hash",
    icon: "hash",
    title: t.hash.title,
    desc: t.hash.desc,
    group: t.groups.sec,
    keywords: "해시 hash md5 sha sha256 체크섬 checksum digest 지문 무결성 암호화 파일",
    component: Hash,
  },
  {
    id: "uuid",
    icon: "fingerprint",
    title: t.uuid.title,
    desc: t.uuid.desc,
    group: t.groups.sec,
    keywords: "uuid 유아이디 ulid guid 아이디 식별자 랜덤 무작위 생성 generate",
    component: Uuid,
  },
  {
    id: "qr",
    icon: "qr",
    title: t.qr.title,
    desc: t.qr.desc,
    group: t.groups.sec,
    keywords: "qr 큐알 큐아르 코드 생성 스캔 스캐너 카메라 wifi 와이파이 barcode",
    component: Qr,
  },
  {
    id: "time",
    icon: "clock",
    title: t.time.title,
    desc: t.time.desc,
    group: t.groups.time,
    keywords: "unix 유닉스 타임스탬프 timestamp epoch 에포크 시간 시각 날짜 변환 iso utc",
    component: Timestamp,
  },
  {
    id: "cron",
    icon: "timer",
    title: t.cron.title,
    desc: t.cron.desc,
    group: t.groups.time,
    keywords: "cron 크론 크론탭 crontab 스케줄 schedule 예약 주기 반복 표현식",
    component: CronTool,
  },
  {
    id: "diff",
    icon: "diff",
    title: t.diff.title,
    desc: t.diff.desc,
    group: t.groups.text,
    keywords: "diff 디프 비교 차이 변경점 compare 텍스트 나란히 줄 단위",
    component: Diff,
  },
  {
    id: "regex",
    icon: "regex",
    title: t.regex.title,
    desc: t.regex.desc,
    group: t.groups.text,
    keywords: "정규식 정규표현식 표현식 regex regexp 패턴 매칭 검색 test",
    component: Regex,
  },
  {
    id: "chars",
    icon: "type",
    title: t.chars.title,
    desc: t.chars.desc,
    group: t.groups.text,
    keywords: "글자수 글자 수 세기 길이 바이트 자소서 단어 공백 count byte characters length",
    component: Chars,
  },
];
