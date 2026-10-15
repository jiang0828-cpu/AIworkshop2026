"use client";
import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button, EditDialog, Field, type ModuleProps, useStrategy } from "./Shared";

type Item = { value: string; priority: number; rule: string; conflict: string; sourceVisionIds: string[]; existingId?: string | null; previousUpdatedAt?: string | null };
type Result = { items: Item[]; explanation: string; questions: string[]; source?: string; requestId?: string };
export default function VisionValues({ props }: { props: ModuleProps }) {
  const { view } = useStrategy(props);
  const [allowSensitive, setAllowSensitive] = useState(false), [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<{ context: unknown; blocked: boolean } | null>(null), [result, setResult] = useState<Result | null>(null);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/value-synthesis", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("读取价值规则草稿失败");
      const data = await response.json(); if (!controller.signal.aborted) setResult(data.draft);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取草稿失败"); });
    return () => controller.abort();
  }, []);
  const discard = async () => {
    if (busy || !result?.requestId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/value-synthesis", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: result.requestId }) });
      if (!response.ok) throw new Error("放弃草稿失败，请重试");
      setResult(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(false); }
  };
  const visions = view.records.filter((record) => ["overallVision", "vision"].includes(record.kind) && !record.archived);
  const call = async (action: "preview" | "generate" | "save", items?: Item[], requestId?: string) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/value-synthesis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, allowSensitive, instruction, items, requestId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "操作失败");
      if (action === "preview") setPreview(data); else if (action === "generate") setResult(data); else { setEditing(false); setResult(null); setPreview(null); await props.reload(); props.notify(`已保存 ${data.saved} 条核心价值与取舍规则`); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  return <section className="mb-6 rounded-md border border-line p-4" data-testid="vision-values">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">核心价值与取舍规则 · AI 草稿</h2><p className="mt-1 text-xs leading-5 text-slate-500">结合基本档案、总愿景与各场景愿景；确认前保留已有规则。</p></div><Button onClick={() => void call("preview")} disabled={busy || !visions.length}><Sparkles size={15} />根据档案与愿景提炼</Button></div>
    {!visions.length && <p className="mt-4 text-xs text-slate-500">请先填写总愿景或至少一份场景愿景。</p>}
    <div className="mt-3"><Field label="补充侧重点（可选）"><textarea rows={2} value={instruction} onChange={(event) => { setInstruction(event.target.value); setPreview(null); setResult(null); }} placeholder="例如：更关注家庭时间、长期健康和工作投入边界。" /></Field></div>
    <label className="mt-3 flex items-start gap-2 text-xs text-slate-500"><input type="checkbox" className="!w-auto" disabled={busy} checked={allowSensitive} onChange={(event) => { setAllowSensitive(event.target.checked); setPreview(null); }} />允许本次发送档案与愿景中的敏感内容（档案仍遵循字段授权）</label>
    {preview && <div className="mt-4 space-y-3 border-t border-line pt-3"><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-mist p-3 text-xs">{JSON.stringify(preview.context, null, 2)}</pre>{preview.blocked ? <p className="text-xs text-amber-700">检测到敏感内容，请授权后重新预览。</p> : <Button primary onClick={() => void call("generate")} disabled={busy}>{busy ? "AI 正在提炼…" : "确认发送并提炼"}</Button>}</div>}
    {result && <div className="mt-4 space-y-3 border-t border-line pt-3"><p className="text-xs text-slate-500">{result.source} · 待确认草稿</p><p className="text-sm whitespace-pre-wrap">{result.explanation}</p>{result.questions.length > 0 && <p className="text-xs text-amber-700">待确认：{result.questions.join("；")}</p>}<Button disabled={busy} onClick={() => setEditing(true)}><Check size={15} />查看并确认草稿</Button><button type="button" disabled={busy} className="ml-3 text-xs text-slate-500" onClick={() => void discard()}>放弃建议</button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
    {editing && result && <EditDialog title="确认核心价值与取舍规则" working={busy} onClose={() => setEditing(false)} onSave={async () => { await call("save", result.items, result.requestId); }}>
      <p className="text-xs text-slate-500">删除不适合的条目并调整排序；同名规则更新原记录，其余新增。未选择更新的旧规则保留。</p>
      {result.items.map((item, index) => <Field key={`target-${index}`} label={`${index + 1}. ${item.value} · 保存方式`}><select value={item.existingId || ""} onChange={event => {
        const old = props.data?.valueRules?.find((row: { id: string }) => row.id === event.target.value);
        setResult({ ...result, items: result.items.map((row, i) => i === index ? { ...row, existingId: old?.id || null, previousUpdatedAt: old?.updatedAt || null } : row) });
      }}><option value="">新增规则</option>{(props.data?.valueRules || []).map((old: { id: string; value: string }) => <option key={old.id} value={old.id}>更新：{old.value}</option>)}</select></Field>)}
      {result.items.map((item, index) => <section key={index} className="space-y-3 border-t border-line pt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">规则 {index + 1}</h3><button type="button" className="text-xs text-slate-400" onClick={() => setResult({ ...result, items: result.items.filter((_, i) => i !== index) })}>删除</button></div><Field label="核心价值"><input value={item.value} onChange={(event) => setResult({ ...result, items: result.items.map((row, i) => i === index ? { ...row, value: event.target.value } : row) })} /></Field><Field label="重要性（1最重要）"><select value={item.priority} onChange={(event) => setResult({ ...result, items: result.items.map((row, i) => i === index ? { ...row, priority: Number(event.target.value) } : row) })}>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></Field><Field label="取舍规则"><textarea rows={3} value={item.rule} onChange={(event) => setResult({ ...result, items: result.items.map((row, i) => i === index ? { ...row, rule: event.target.value } : row) })} /></Field><Field label="典型冲突"><textarea rows={2} value={item.conflict} onChange={(event) => setResult({ ...result, items: result.items.map((row, i) => i === index ? { ...row, conflict: event.target.value } : row) })} /></Field><p className="text-xs text-slate-400">来源：{item.sourceVisionIds.map((id) => view.records.find((row) => row.id === id)?.title || "愿景").join("、") || "待补充"}</p></section>)}
    </EditDialog>}
  </section>;
}
