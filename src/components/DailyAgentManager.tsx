"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Bot, Pencil, Plus, Save, Search, Trash2, Wrench, X } from "lucide-react";
import type { AgentDraft, AgentView } from "@/lib/daily/shared";
import { assetSchema, defaultToolIds, readBindings, type AssetDraft, type AssetView } from "@/lib/daily/assets-shared";

type Post = (command: Record<string, unknown>) => Promise<unknown | null>;
const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40";
const primary = `${button} !border-sage !bg-sage !text-white`;
const iconButton = "grid h-9 w-9 shrink-0 place-items-center rounded text-slate-500 hover:bg-mist disabled:opacity-40";
const labels = { agent: "Agent", tool: "Tool", skill: "Skill" };

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [close]);
  return <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-2 sm:p-6" onClick={close}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-xl outline-none">
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold">{title}</h2><button type="button" aria-label="关闭" title="关闭" onClick={close} className={iconButton}><X size={18} /></button></div>
      <div className="overflow-y-auto p-4 sm:p-5">{children}</div>
    </div>
  </div>;
}
function Field({ title, children }: { title: string; children: ReactNode }) { return <label className="block min-w-0 text-xs text-slate-500"><span className="mb-1.5 block">{title}</span>{children}</label>; }

export default function DailyAgentManager({ agents, assets, configured, post, working }: { agents: AgentView[]; assets: AssetView[]; configured: boolean; post: Post; working: boolean }) {
  const [tab, setTab] = useState<keyof typeof labels>("agent");
  const [search, setSearch] = useState("");
  const [editAgent, setEditAgent] = useState<AgentView | null | undefined>();
  const [editAsset, setEditAsset] = useState<AssetView | null | undefined>();
  const closeAgent = useCallback(() => { if (!working) setEditAgent(undefined); }, [working]);
  const closeAsset = useCallback(() => { if (!working) setEditAsset(undefined); }, [working]);
  const matches = (text: string) => text.toLowerCase().includes(search.trim().toLowerCase());
  const rows = assets.filter((asset) => asset.kind === tab && matches(`${asset.name} ${asset.description}`));
  const counts = { agent: agents.length, tool: assets.filter((asset) => asset.kind === "tool").length, skill: assets.filter((asset) => asset.kind === "skill").length };
  const assigned = (id: string) => agents.filter((agent) => { const bindings = readBindings(agent.capabilities); return [...bindings.toolIds, ...bindings.skillIds].includes(id); });

  return <section aria-label="Agent Tool Skill 管理">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Agent 资源类型" className="flex flex-wrap border-b border-line">
        {([["agent", Bot], ["tool", Wrench], ["skill", BookOpen]] as const).map(([key, Icon]) => <button type="button" key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setSearch(""); }} className={`flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-sm ${tab === key ? "border-sage font-medium text-sage" : "border-transparent text-slate-500"}`}><Icon size={15} />{labels[key]} <span className="text-xs">{counts[key]}</span></button>)}
      </div>
      <button type="button" className={button} disabled={working} onClick={() => tab === "agent" ? setEditAgent(null) : setEditAsset(null)}><Plus size={15} />新增 {labels[tab]}</button>
    </div>
    <div className="relative mb-3"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input aria-label="搜索 Agent Tool Skill" placeholder={`搜索 ${labels[tab]}`} className="!pl-9" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {tab === "agent" ? agents.filter((agent) => matches(`${agent.name} ${agent.role}`)).map((agent) => {
      const bindings = readBindings(agent.capabilities);
      return <div key={agent.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4">
        <div className="flex min-w-0 flex-1 gap-3"><Bot size={20} className="mt-1 shrink-0 text-sage" /><div className="min-w-0"><h3 className="break-words text-sm font-medium">{agent.name}</h3><p className="mt-1 break-words text-xs text-slate-500">{agent.role} · {agent.model || "默认模型"} · {agent.timeoutSeconds} 秒</p><p className="mt-2 break-words text-xs text-slate-500">Tool：{bindings.toolIds.map((id) => assets.find((asset) => asset.id === id)?.name || "已删除").join("、") || "未绑定"}</p><p className="mt-1 break-words text-xs text-slate-500">Skill：{bindings.skillIds.map((id) => assets.find((asset) => asset.id === id)?.name || "已删除").join("、") || "未绑定"}</p></div></div>
        <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-slate-500"><input aria-label={`启用 ${agent.name}`} type="checkbox" className="!w-4 accent-[#5e7867]" checked={agent.enabled} disabled={working} onChange={(event) => void post({ action: "save-agent", id: agent.id, data: { ...agent, enabled: event.target.checked } })} />启用</label><button type="button" title={`编辑 ${agent.name}`} aria-label={`编辑 ${agent.name}`} className={iconButton} disabled={working} onClick={() => setEditAgent(agent)}><Pencil size={16} /></button></div>
      </div>;
    }) : rows.map((asset) => {
      const bound = assigned(asset.id);
      const ready = asset.adapter !== "unavailable" && (asset.adapter !== "text-model" || configured);
      const Icon = asset.kind === "tool" ? Wrench : BookOpen;
      return <div key={asset.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4"><div className="flex min-w-0 flex-1 gap-3"><Icon size={20} className="mt-1 shrink-0 text-sage" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-medium">{asset.name}</h3><span className={`text-xs ${ready ? "text-sage" : "text-amber-700"}`}>{asset.adapter === "unavailable" ? "未接入" : !ready ? "未配置模型" : !asset.enabled ? "已停用" : asset.adapter === "guidance" && asset.kind === "tool" ? "操作指引" : "可用"}</span>{asset.builtin && <span className="text-xs text-slate-400">内置</span>}</div><p className="mt-1 break-words text-xs text-slate-500">{asset.description}</p><p className="mt-2 break-words text-xs text-slate-500">已绑定：{bound.map((agent) => agent.name).join("、") || "无"}</p>{asset.instructions && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">{asset.kind === "skill" ? "流程内容" : "使用约束"}</summary><p className="mt-2 whitespace-pre-wrap break-words">{asset.instructions}</p></details>}</div></div><div className="flex items-center gap-2"><label className="flex items-center gap-2 text-xs text-slate-500"><input aria-label={`启用 ${asset.name}`} type="checkbox" className="!w-4 accent-[#5e7867]" checked={asset.enabled} disabled={working || asset.adapter === "unavailable"} onChange={(event) => void post({ action: "save-asset", id: asset.id, data: { ...asset, enabled: event.target.checked } })} />启用</label><button type="button" title={`编辑 ${asset.name}`} aria-label={`编辑 ${asset.name}`} className={iconButton} disabled={working} onClick={() => setEditAsset(asset)}><Pencil size={16} /></button>{!asset.builtin && <button type="button" title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`} className={iconButton} disabled={working || bound.length > 0} onClick={() => { if (window.confirm(`删除 ${asset.name}？已保存的执行快照会保留。`)) void post({ action: "delete-asset", id: asset.id }); }}><Trash2 size={16} /></button>}</div></div>;
    })}
    {(tab === "agent" ? !agents.some((agent) => matches(`${agent.name} ${agent.role}`)) : !rows.length) && <p className="py-10 text-center text-sm text-slate-400">暂无匹配的 {labels[tab]}</p>}
    {editAgent !== undefined && <Modal title={editAgent ? "编辑 Agent" : "新增 Agent"} close={closeAgent}><AgentForm key={editAgent?.id || "new"} agent={editAgent} assets={assets} working={working} onSave={async (data) => { if (await post({ action: "save-agent", id: editAgent?.id, data })) setEditAgent(undefined); }} /></Modal>}
    {editAsset !== undefined && <Modal title={`${editAsset ? "编辑" : "新增"} ${labels[editAsset?.kind || (tab === "skill" ? "skill" : "tool")]}`} close={closeAsset}><AssetForm key={editAsset?.id || `new-${tab}`} asset={editAsset} kind={tab === "skill" ? "skill" : "tool"} working={working} onSave={async (data) => { if (await post({ action: "save-asset", id: editAsset?.id, data })) setEditAsset(undefined); }} /></Modal>}
  </section>;
}

function AgentForm({ agent, assets, working, onSave }: { agent: AgentView | null; assets: AssetView[]; working: boolean; onSave: (data: AgentDraft) => Promise<void> }) {
  const [form, setForm] = useState<AgentDraft>(agent || { name: "", role: "custom", model: "", prompt: "", enabled: true, timeoutSeconds: 120 });
  const bindings = readBindings(form.capabilities);
  const toggle = (id: string, kind: "tool" | "skill", checked: boolean) => {
    const key = kind === "tool" ? "toolIds" : "skillIds";
    setForm({ ...form, capabilities: JSON.stringify({ toolIds: bindings.toolIds, skillIds: bindings.skillIds, [key]: checked ? [...bindings[key], id] : bindings[key].filter((value) => value !== id) }) });
  };
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave(form); }}>
    <div className="grid gap-3 sm:grid-cols-2"><Field title="名称"><input required maxLength={100} disabled={working} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field title="角色"><input required maxLength={100} disabled={working} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} /></Field><Field title="模型"><input maxLength={150} disabled={working} placeholder="默认模型" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field><Field title="超时 · 秒"><input type="number" required min={30} max={120} disabled={working} value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: Number(event.target.value) })} /></Field></div>
    <Field title="角色提示词"><textarea required rows={4} maxLength={10000} disabled={working} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} /></Field>
    {(["tool", "skill"] as const).map((kind) => <fieldset key={kind} className="border-t border-line pt-3"><legend className="text-sm font-medium">绑定 {labels[kind]}</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{assets.filter((asset) => asset.kind === kind).map((asset) => {
      const selected = (kind === "tool" ? bindings.toolIds : bindings.skillIds).includes(asset.id);
      return <label key={asset.id} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 !w-4 shrink-0 accent-[#5e7867]" checked={selected} disabled={working || asset.adapter === "unavailable" || !asset.enabled && !selected} onChange={(event) => toggle(asset.id, kind, event.target.checked)} /><span className="min-w-0"><span className="block break-words">{asset.name}{asset.adapter === "unavailable" ? " · 未接入" : !asset.enabled ? " · 已停用" : ""}</span><span className="mt-1 block break-words text-xs text-slate-500">{asset.description}</span></span></label>;
    })}</div></fieldset>)}
    {!bindings.toolIds.includes(defaultToolIds[0]) && <p className="text-xs text-amber-700">未绑定文本生成，保存后暂不能执行模型任务。</p>}
    <div className="flex justify-end"><button type="submit" className={primary} disabled={working}><Save size={15} />保存 Agent</button></div>
  </form>;
}

function AssetForm({ asset, kind, working, onSave }: { asset: AssetView | null; kind: "tool" | "skill"; working: boolean; onSave: (data: AssetDraft) => Promise<void> }) {
  const [form, setForm] = useState<AssetDraft>(asset || { kind, name: "", description: "", instructions: "", adapter: "guidance", enabled: true });
  const [error, setError] = useState("");
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    const parsed = assetSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(""); void onSave(parsed.data);
  }}>
    <Field title="名称"><input required maxLength={100} disabled={working} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
    <Field title="用途"><textarea rows={2} maxLength={1000} disabled={working} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
    {form.kind === "tool" && <p className="text-xs text-slate-500">{form.adapter === "guidance" ? "操作指引：提供步骤与建议，不调用外部接口或执行代码。" : form.adapter === "unavailable" ? "尚未接入执行器，当前不能启用。" : "使用工作台现有执行能力，无需填写密钥。"}</p>}
    <Field title={form.kind === "skill" ? "流程与交付要求" : "使用约束与操作指引"}><textarea required={form.adapter === "guidance"} rows={6} maxLength={4000} disabled={working} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></Field>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex justify-end"><button type="submit" className={primary} disabled={working}><Save size={15} />保存 {labels[form.kind]}</button></div>
  </form>;
}
