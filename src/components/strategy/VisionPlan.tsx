"use client";
import { useRef, useState } from "react";
import { Button, EditDialog, Field, type ModuleProps, type Row } from "./Shared";

export default function VisionPlan({ props }: { props: ModuleProps }) {
  const overall = props.data?.strategy?.records.find((row: Row) => row.kind === "overallVision");
  const scenes: Row[] = props.data?.strategy?.scenes || [];
  const [opened, setOpened] = useState(false), [allow, setAllow] = useState(false), [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<Row | null>(null), [drafts, setDrafts] = useState<Row[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const request = async (action: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/vision-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: overall?.id, allowSensitive: allow, instruction, data: action === "save" ? { scenes: drafts?.filter((row) => row.selected) } : undefined }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "请求失败");
      if (action === "preview") setPreview(result);
      if (action === "generate") setDrafts(result.scenes.map((row: Row) => ({ ...row, selected: Boolean(row.payload.expected.trim()) })));
      if (action === "save") {
        setDrafts(null); setOpened(false); setPreview(null);
        await props.reload(); window.dispatchEvent(new Event("workbench-saved"));
        props.notify(`已更新 ${result.saved} 个场景愿景，历史版本已保留`);
        try { const sync = await fetch("/api/sync", { method: "POST" }); if (!sync.ok) props.notify("本地已保存，云端同步暂未完成"); } catch { props.notify("本地已保存，云端同步暂未完成"); }
      }
    } catch (error) { setError(error instanceof Error ? error.message : "操作失败，草稿已保留"); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="mb-6 space-y-3">
    <Button disabled={!overall?.payload.expected || busy} onClick={() => setOpened(true)}>AI 将总愿景拆解到各场景</Button>
    {!overall?.payload.expected && <p className="text-xs text-slate-500">先填写并保存总愿景，再生成场景草稿。</p>}
    {opened && !drafts && <div className="space-y-3 rounded border border-line p-4">
      <p className="text-sm text-slate-500">分析总愿景的价值、诉求与取舍，推导完善各场景愿景、衡量标准、阶段安排和建议第一步。新增建议标为待确认。仅发送总愿景及补充要求；已有子场景将在确认时对照展示。</p>
      <Field label="补充规划要求（可选）"><textarea disabled={busy} rows={2} maxLength={10000} value={instruction} onChange={(e) => { setInstruction(e.target.value); setPreview(null); }} /></Field>
      <label className="flex items-start gap-2 text-xs"><input disabled={busy} type="checkbox" className="!w-auto" checked={allow} onChange={(e) => { setAllow(e.target.checked); setPreview(null); }} />允许本次发送总愿景中涉及的健康、家庭、财务等敏感资料</label>
      <Button disabled={busy} onClick={() => void request("preview")}>{busy ? "处理中…" : "预览总愿景"}</Button>
      <Button disabled={busy} onClick={() => { setOpened(false); setPreview(null); setError(""); }}>取消</Button>
      {preview && <><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-mist p-3 text-xs">{preview.blocked ? "敏感内容未授权，请勾选本次授权后重新预览。" : (() => { try { const data = JSON.parse(preview.context.content); return `总体期望：${data.content.expected}\n\n重要底线：${data.content.boundary}\n\n补充要求：${data.instruction}`; } catch { return "预览内容无法读取"; } })()}</pre><Button primary disabled={busy || preview.blocked} onClick={() => void request("generate")}>{busy ? "AI 正在拆解，请稍候…" : "确认发送并生成场景草稿"}</Button></>}
    </div>}
    {error && !drafts && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    {drafts && <EditDialog title="确认各场景愿景草稿" working={busy} onClose={() => { setDrafts(null); setError(""); }} onSave={async () => { if (!drafts.some((row) => row.selected)) { setError("请至少选择一个场景"); return; } await request("save"); }}>
      <p className="text-xs text-slate-500">只更新勾选的场景。已有内容会被下方草稿替换，历史版本保留；总愿景不变。请重点核对“推导与完善”和待确认建议；不适合的场景可取消勾选。</p>
      {drafts.map((draft, index) => <section key={draft.sceneId} className="space-y-3 border-t border-line pt-3">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="!w-auto" checked={draft.selected} onChange={(e) => setDrafts(drafts.map((row, i) => i === index ? { ...row, selected: e.target.checked } : row))} />{scenes.find((scene) => scene.id === draft.sceneId)?.name} · {draft.previous ? "更新现有愿景" : "新增愿景"}</label>
        <p className="break-words text-xs text-sage">关键词：{draft.keywords.join("、") || "待补充"}</p><p className="whitespace-pre-wrap text-xs text-slate-500">{draft.reason}</p>
        {draft.previous && <details><summary className="cursor-pointer text-xs text-slate-500">查看原内容</summary>{Object.entries(draft.previous).map(([key, value]) => <p key={key} className="mt-2 whitespace-pre-wrap break-words text-xs">{({ expected: "期望", mainGoals: "主要目标", metric: "标准", horizon: "时间", boundary: "底线" } as Record<string, string>)[key]}：{String(value || "未填写")}</p>)}</details>}
        {[["expected", "期望状态"], ["mainGoals", "主要目标"], ["metric", "衡量标准"], ["horizon", "时间范围"], ["boundary", "底线"]].map(([key, label]) => <Field key={key} label={label}><textarea rows={2} maxLength={10000} value={draft.payload[key]} onChange={(e) => setDrafts(drafts.map((row, i) => i === index ? { ...row, payload: { ...row.payload, [key]: e.target.value } } : row))} /></Field>)}
      </section>)}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </EditDialog>}
  </div>;
}
