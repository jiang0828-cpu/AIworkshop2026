"use client";
import { useRef, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { resourceClasses, readResourceLedger } from "@/lib/strategy/resource-shared";
import { Button, type ModuleProps, type Row, useStrategy } from "./Shared";

export default function ResourceClassification({ props }: { props: ModuleProps }) {
  const { view } = useStrategy(props);
  const [preview, setPreview] = useState<Row | null>(null), [suggestions, setSuggestions] = useState<Row[] | null>(null);
  const [allow, setAllow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [requestScope, setRequestScope] = useState<string[]>([]);
  const lock = useRef(false);
  const run = async (action: "preview" | "generate" | "confirm") => {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const resourceIds = action === "preview" ? (props.data?.resources || []).filter((row: Row) => {
        const tag = view.records.find((tag) => tag.kind === "tag" && tag.payload.subjectType === "resource" && tag.payload.subjectId === row.id);
        return readResourceLedger(tag?.payload.ledger).capitalClass === "待分类";
      }).map((row: Row) => row.id) : requestScope;
      const response = await fetch("/api/resource-classification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, resourceIds, includeDraft: true, allowSensitive: allow, fingerprint: preview?.fingerprint, suggestions: suggestions?.filter((row) => selected.includes(row.key)) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "分类失败");
      if (action === "preview") { setPreview(data); setSuggestions(null); setSelected([]); setRequestScope(resourceIds); }
      else if (action === "generate") { setSuggestions(data.suggestions); setSelected([]); }
      else {
        setPreview(null); setSuggestions(null); setSelected([]);
        await props.reload(); window.dispatchEvent(new Event("resource-draft-updated")); props.notify(`已确认 ${data.saved} 项资源分类`);
        try { const sync = await fetch("/api/sync", { method: "POST" }); if (!sync.ok) props.notify("分类已本地保存，云端同步暂未完成"); } catch { props.notify("分类已本地保存，云端同步暂未完成"); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分类失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  return <details className="border-y border-line py-3"><summary className="cursor-pointer text-sm text-sage">AI 分类 · 待分类资源与待选草稿</summary><div className="mt-3 space-y-3">
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="!w-auto" disabled={busy} checked={allow} onChange={(event) => { setAllow(event.target.checked); setPreview(null); setSuggestions(null); setSelected([]); }} />允许本次发送资源中的敏感内容</label>
    <Button disabled={busy} onClick={() => void run("preview")}><Sparkles size={14} />预览待分类资料</Button>
    {preview && <><details><summary className="cursor-pointer text-xs">本次资料（{preview.sources.length} 项）</summary>{preview.sources.map((row: Row) => <div className="mt-2 text-xs" key={row.key}><p>{row.key.startsWith("draft:") ? "待选草稿" : "已有资源"} · {row.title}</p><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words bg-mist p-2">{typeof row.content === "string" ? row.content : JSON.stringify(row.content, null, 2)}</pre></div>)}</details>
      <Button disabled={busy || preview.sources.some((row: Row) => row.blocked)} onClick={() => void run("generate")}><Sparkles size={14} />{busy ? "正在处理…" : "确认发送并建议分类"}</Button></>}
    {suggestions && <><div className="divide-y divide-line">{suggestions.map((row) => <div key={row.key} className="flex flex-wrap items-start gap-2 py-3"><label className="flex min-w-0 flex-1 items-start gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={selected.includes(row.key)} disabled={busy} onChange={(e) => setSelected(e.target.checked ? [...selected, row.key] : selected.filter((key) => key !== row.key))} /><span className="break-words">{preview?.sources.find((source: Row) => source.key === row.key)?.title}<span className="mt-1 block text-xs text-slate-500">{row.reason}</span></span></label>
      <select aria-label={`分类：${preview?.sources.find((source: Row) => source.key === row.key)?.title}`} className="!w-auto" disabled={busy} value={row.capitalClass} onChange={(e) => setSuggestions(suggestions.map((item) => item.key === row.key ? { ...item, capitalClass: e.target.value } : item))}><option>待分类</option>{resourceClasses.map((item) => <option key={item.name}>{item.name}</option>)}</select></div>)}</div><Button primary disabled={busy || !selected.length} onClick={() => void run("confirm")}><Check size={14} />确认所选分类（{selected.length}）</Button></>}
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
  </div></details>;
}
