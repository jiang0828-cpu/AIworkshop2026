"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DiffLine = { type: "same" | "added" | "removed"; text: string };
const documents = [
  ["profile", "个人基础档案"], ["goals", "目标与项目"], ["instruction", "AI 协作说明书"], ["actions", "行动与复盘"], ["decisions", "重要决策记录"],
] as const;

export default function DocumentComparePage() {
  const [key, setKey] = useState<(typeof documents)[number][0]>(() => {
    if (typeof window === "undefined") return "profile";
    const candidate = new URLSearchParams(window.location.search).get("key");
    return documents.some(([value]) => value === candidate) ? candidate as (typeof documents)[number][0] : "profile";
  });
  const [lines, setLines] = useState<DiffLine[]>([]);
  const [source, setSource] = useState("");
  useEffect(() => { void fetch(`/api/documents/diff?key=${key}`).then((response) => response.json()).then((data) => { setLines(data.lines || []); setSource(data.source || ""); }); }, [key]);
  return <main className="min-h-screen bg-[#fbfcfa] p-5 text-[#1f2933] md:p-10"><div className="mx-auto max-w-5xl"><Link className="text-sm text-[#5e7867] hover:underline" href="/">返回 AI 工作台</Link><div className="mt-5 flex flex-col gap-4 border-b border-[#e3e8e3] pb-5 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-semibold tracking-[.16em] text-[#5e7867]">档案中心</p><h1 className="mt-2 text-2xl font-semibold">文档版本差异</h1><p className="mt-2 text-sm text-slate-500">对比最近保存版本与当前结构化数据重新生成的内容。</p></div><select value={key} onChange={(event) => setKey(event.target.value as typeof key)} className="rounded-lg border border-[#e3e8e3] bg-white px-3 py-2 text-sm"><>{documents.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</></select></div><p className="mt-4 text-xs text-slate-400">基准版本：{source}</p><pre className="mt-4 overflow-x-auto rounded-lg border border-[#e3e8e3] bg-white p-4 text-sm leading-7">{lines.map((line, index) => <div key={`${index}-${line.text}`} className={line.type === "added" ? "bg-green-50 text-green-800" : line.type === "removed" ? "bg-red-50 text-red-800" : "text-slate-600"}>{line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}{line.text || " "}</div>)}</pre></div></main>;
}
