import type { Component } from "svelte";
import { t } from "../i18n";
import type { IconName } from "../Icon.svelte";
import Format from "./Format.svelte";
import Diff from "./Diff.svelte";
import Encode from "./Encode.svelte";
import Chars from "./Chars.svelte";

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
    id: "diff",
    icon: "diff",
    title: t.diff.title,
    desc: t.diff.desc,
    group: t.groups.text,
    keywords: "diff 비교 차이 compare 텍스트",
    component: Diff,
  },
  {
    id: "encode",
    icon: "code",
    title: t.encode.title,
    desc: t.encode.desc,
    group: t.groups.codec,
    keywords: "base64 url 인코딩 디코딩 encode decode percent 퍼센트",
    component: Encode,
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
