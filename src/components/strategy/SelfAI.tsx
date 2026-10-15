"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { selfAIFields } from "@/lib/strategy/self-ai-shared";
import { Button, EditDialog, Field, type ModuleProps, type Row, useStrategy } from "./Shared";

type Result = { fields: Record<string, string>; sceneIds: string[]; explanation: string; questions: string[]; source: string };
function previewText(context: unknown) {
  const row = context as { content?: string; fields?: Record<string, string> };
  try {
    const data = JSON.parse(row.content || "{}");
    return [...Object.entries(data.content || {}).map(([key, value]) => `${row.fields?.[key] || key}：${value || "未填写"}`), `补充说明：${data.instruction || "无"}`].join("\n\n");
  } catch { return row.content || "暂无内容"; }
}
export default function SelfAI({ props, tab }: { props: ModuleProps; tab: string }) {
  const { view, post } = useStrategy(props);
  const [config, setConfig] = useState<{ configured: boolean; model: string } | null>(null);
  const [selection, setSelection] = useState(""), [mode, setMode] = useState("organize"), [instruction, setInstruction] = useState("");
  const [allowSensitive, setAllowSensitive] = useState(false), [preview, setPreview] = useState<{ context: unknown; blocked: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => { void fetch("/api/self-ai").then((r) => r.json()).then(setConfig).catch(() => setError("无法读取 AI 配置，请稍后重试")); }, []);
  const rows: Array<{ key: string; type: string; row: Row; label: string }> = [];
  if (tab === "profile" && props.data?.id) rows.push({ key: `profile:${props.data.id}`, type: "profile", row: props.data, label: "当前个人档案" });
  const kinds = tab === "values" ? ["overallVision", "vision"] : tab === "skills" ? ["skill"] : [];
  for (const row of view.records.filter((r) => kinds.includes(r.kind) && !r.archived)) rows.push({ key: `${row.kind}:${row.id}`, type: row.kind, row, label: row.title });
  const entities = tab === "experiences" ? [["experiences", "experience"]] : tab === "resources" ? [["resources", "resource"], ["constraints", "constraint"], ["assumptions", "assumption"]] : tab === "skills" ? [["evidences", "evidence"]] : tab === "values" ? [["valueRules", "valueRule"]] : [];
  for (const [collection, type] of entities) for (const row of props.data?.[collection] || []) rows.push({ key: `${type}:${row.id}`, type, row, label: row.title || row.name || row.ability || row.value || row.statement });
  const selected = rows.find((row) => row.key === selection);
  const reset = () => { setPreview(null); setResult(null); setError(""); };
  const run = async (previewOnly: boolean) => {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/self-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: selected.type, id: selected.row.id, mode, instruction, allowSensitive, previewOnly }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "AI 请求失败");
      if (previewOnly) setPreview(data); else setResult(data);
    } catch (error) { setError(error instanceof Error ? error.message : "请求失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!selected || !result || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const strategy = ["overallVision", "vision", "skill"].includes(selected.type);
      if (strategy) {
        const saved = await post("record", { ...selected.row, payload: { ...selected.row.payload, ...result.fields }, ...(selected.type !== "overallVision" && mode === "classify" ? { sceneId: result.sceneIds[0] || null } : {}) });
        if (!saved) return;
      } else {
        const data = selected.type === "profile" ? { ...props.data, ...result.fields } : { ...result.fields, ...(mode === "classify" ? { _sceneIds: result.sceneIds } : {}) };
        await props.save(selected.type, data, selected.row.id);
      }
      setEditing(false); setResult(null); setPreview(null);
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败，输入已保留"); }
    finally { lock.current = false; setBusy(false); }
  };
  return <details className="mb-5 rounded-lg border border-line p-3">
    <summary className="cursor-pointer text-sm font-medium text-sage"><Sparkles className="mr-1 inline" size={15} />AI 助手 · 分类、整理、补充、思考</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-500">{config ? config.configured ? `当前模型：${config.model}` : "尚未配置模型，请在服务端配置 AI_API_KEY、AI_BASE_URL 和 AI_MODEL。" : "正在读取模型配置…"} 仅发送你选定的记录和补充说明，确认前不修改内容。</p>
      <fieldset disabled={busy || editing} className="space-y-3 disabled:opacity-60">
        <Field label="选择内容"><select value={selection} onChange={(e) => { setSelection(e.target.value); reset(); }}><option value="">请选择一条已保存的内容</option>{rows.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</select></Field>
        {!rows.length && <p className="text-xs text-slate-500">先新增一条记录，填入已有事实，即可使用 AI 整理和完善。</p>}
        <Field label="希望 AI 帮你做什么"><select value={mode} onChange={(e) => { setMode(e.target.value); reset(); }}><option value="classify">分类：建议适用场景</option><option value="organize">整理：清晰表达、精简重复</option><option value="complete">填充完善：结合补充事实完善内容</option><option value="reflect">思考：发现盲点、取舍与下一步</option></select></Field>
        <Field label="补充事实或具体问题（可选）"><textarea rows={3} maxLength={10000} value={instruction} onChange={(e) => { setInstruction(e.target.value); reset(); }} placeholder="例如：补充我的职责与实际成果；或请帮我思考下一步可以验证什么。" /></Field>
        <label className="flex items-start gap-2 text-xs text-slate-500"><input type="checkbox" className="!w-auto" checked={allowSensitive} onChange={(e) => { setAllowSensitive(e.target.checked); reset(); }} />允许本次发送所选内容中涉及的健康、家庭、财务等敏感资料</label>
      </fieldset>
      {mode === "classify" && ["profile", "overallVision"].includes(selected?.type || "") ? <p className="text-xs text-slate-500">个人档案和总愿景为全局内容，无需分类；请选择整理、完善或思考。</p> : <Button disabled={!selected || busy || !config?.configured} onClick={() => void run(true)}>{busy ? "处理中…" : "预览发送内容"}</Button>}
      {preview && <div className="space-y-3"><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-mist p-3 text-xs">{previewText(preview.context)}</pre>{preview.blocked ? <p className="text-xs text-amber-700">含敏感资料，需要本次授权后重新预览。</p> : <Button disabled={busy} onClick={() => void run(false)}>{busy ? "AI 正在处理…" : "确认发送给 AI"}</Button>}</div>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {result && <div className="space-y-3 border-t border-line pt-3"><p className="text-xs text-slate-500">{result.source} · 待确认建议</p><p className="whitespace-pre-wrap break-words text-sm">{result.explanation}</p>{result.questions.length > 0 && <div><p className="mb-1 text-xs text-slate-500">可以继续思考或补充</p><ul className="list-inside list-disc space-y-1 text-sm">{result.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}{mode !== "reflect" && (Object.keys(result.fields).length > 0 || mode === "classify") && <Button disabled={busy} onClick={() => setEditing(true)}>查看并编辑建议</Button>}<Button disabled={busy} onClick={() => setResult(null)}>放弃建议</Button></div>}
    </div>
    {editing && result && selected && <EditDialog title="确认 AI 建议" working={busy} onClose={() => setEditing(false)} onSave={save}>
      {Object.entries(result.fields).map(([key, value]) => <Field key={key} label={selfAIFields[selected.type][key]}><p className="mb-2 whitespace-pre-wrap text-xs text-slate-400">原内容：{String((selected.row.payload || selected.row)[key] || "未填写")}</p><textarea rows={4} maxLength={10000} value={value} onChange={(e) => setResult({ ...result, fields: { ...result.fields, [key]: e.target.value } })} /></Field>)}
      {mode === "classify" && <Field label="适用场景"><p className="mb-2 text-xs text-slate-500">保存后替换原场景；档案内容可多选，不选为全局。</p>{view.scenes.map((scene) => <label key={scene.id} className="mr-3 inline-flex items-center gap-1 py-2"><input type="checkbox" className="!w-auto" checked={result.sceneIds.includes(scene.id)} onChange={(e) => setResult({ ...result, sceneIds: e.target.checked ? ["vision", "skill"].includes(selected.type) ? [scene.id] : [...result.sceneIds, scene.id] : result.sceneIds.filter((id) => id !== scene.id) })} />{scene.name}</label>)}</Field>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </EditDialog>}
  </details>;
}
