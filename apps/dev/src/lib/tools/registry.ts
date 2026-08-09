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
    keywords: "json yaml xml 변환 정리 압축 포맷 formatter convert minify pretty",
    component: Format,
  },
  {
    id: "color",
    icon: "palette",
    title: t.color.title,
    desc: t.color.desc,
    group: t.groups.format,
    keywords: "색 컬러 color hex rgb hsl oklch 변환",
    component: Color,
  },
  {
    id: "encode",
    icon: "code",
    title: t.encode.title,
    desc: t.encode.desc,
    group: t.groups.sec,
    keywords: "base64 url 인코딩 디코딩 encode decode percent 퍼센트",
    component: Encode,
  },
  {
    id: "jwt",
    icon: "key",
    title: t.jwt.title,
    desc: t.jwt.desc,
    group: t.groups.sec,
    keywords: "jwt 토큰 token 디코드 decode 서명 검증 verify",
    component: Jwt,
  },
  {
    id: "hash",
    icon: "hash",
    title: t.hash.title,
    desc: t.hash.desc,
    group: t.groups.sec,
    keywords: "해시 hash md5 sha 체크섬 checksum digest 파일",
    component: Hash,
  },
  {
    id: "uuid",
    icon: "fingerprint",
    title: t.uuid.title,
    desc: t.uuid.desc,
    group: t.groups.sec,
    keywords: "uuid ulid guid 아이디 식별자 생성 generate",
    component: Uuid,
  },
  {
    id: "qr",
    icon: "qr",
    title: t.qr.title,
    desc: t.qr.desc,
    group: t.groups.sec,
    keywords: "qr 큐알 코드 생성 스캔 wifi 와이파이 barcode",
    component: Qr,
  },
  {
    id: "time",
    icon: "clock",
    title: t.time.title,
    desc: t.time.desc,
    group: t.groups.time,
    keywords: "unix 타임스탬프 timestamp epoch 시간 날짜 변환 iso",
    component: Timestamp,
  },
  {
    id: "cron",
    icon: "timer",
    title: t.cron.title,
    desc: t.cron.desc,
    group: t.groups.time,
    keywords: "cron 크론 스케줄 schedule 표현식",
    component: CronTool,
  },
  {
    id: "diff",
    icon: "diff",
    title: t.diff.title,
    desc: t.diff.desc,
    group: t.groups.text,
    keywords: "diff 비교 차이 compare 텍스트",
    component: Diff,
  },
  {
    id: "regex",
    icon: "regex",
    title: t.regex.title,
    desc: t.regex.desc,
    group: t.groups.text,
    keywords: "정규식 regex regexp 패턴 매칭 test",
    component: Regex,
  },
  {
    id: "chars",
    icon: "type",
    title: t.chars.title,
    desc: t.chars.desc,
    group: t.groups.text,
    keywords: "글자수 바이트 자소서 단어 count byte characters",
    component: Chars,
  },
];
