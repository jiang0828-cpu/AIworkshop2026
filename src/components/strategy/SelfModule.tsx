"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Archive, History, Pencil, Settings2 } from "lucide-react";
import { visionSchema, skillSchema, type StrategyRecordView } from "@/lib/strategy/shared";
import { Button, EditDialog, Field, Heading, Link, matchesScene, SceneFilter, SceneSelect, Tabs, useRecordFocus, useStrategy, type ModuleProps, type Row } from "./Shared";

import OverallVision from "./OverallVision";
import CapabilityPlan from "./CapabilityPlan";
import CapabilityLibrary from "./CapabilityLibrary";
import ResourceLedger from "./ResourceLedger";
import SelfTransfer from "./SelfTransfer";
import VisionContent from "./VisionContent";
import SelfAI from "./SelfAI";
import VisionPlan from "./VisionPlan";
import VisionValues from "./VisionValues";
import { sceneDefaults } from "@/lib/scenes";
import SelfLoop, { selfGuides } from "./SelfLoop";

export default function SelfModule({ props, legacy }: { props: ModuleProps; legacy: (tab: string, scene: string, loop: (type: string, record: Row) => ReactNode) => ReactNode }) {
  const { view, working, post } = useStrategy(props);
  const refresh = useRef(props.reload); refresh.current = props.reload;
  useEffect(() => {
    const focus = () => { if (!document.querySelector('[data-workbench-dirty="true"]')) void refresh.current(); };
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  const tab = props.target.tab || "profile", scene = props.target.scene || "all";
  useRecordFocus(props.target.recordId);
  const [editing, setEditing] = useState<Row | null>(null), [settings, setSettings] = useState(false);
  const [scenes, setScenes] = useState(view.scenes), [historyId, setHistoryId] = useState("");
  const navigate = (next: Row) => props.navigate({ section: "self", tab, scene, ...next });
  const start = (kind: "vision" | "skill", record?: StrategyRecordView) => setEditing(record || { kind, sceneId: scene === "all" || scene === "unclassified" ? view.scenes[0]?.id || null : scene, title: "", payload: kind === "vision" ? visionSchema.parse({}) : skillSchema.parse({ evidenceId: null, rating: null, improvement: "" }) });
  const updatePayload = (key: string, value: unknown) => setEditing((current: Row | null) => current ? { ...current, payload: { ...current.payload, [key]: value } } : current);
  const records = view.records.filter((record) => (!record.archived || props.target.recordId === record.id) && matchesScene(record.sceneId, scene, view));
  return <>
    <Heading title="认识自己" />
    <Tabs items={[["profile", "个人档案"], ["values", "我的愿景"], ["skills", "我的能力"], ["resources", "我的资源"], ["experiences", "项目及经历"]]} active={tab} onChange={(tab) => navigate({ tab, recordId: undefined })} />
    <p className="mb-2 text-sm text-slate-500">{selfGuides[tab]?.[0]}</p><details className="mb-4"><summary className="cursor-pointer text-xs text-sage">填写示例</summary><p className="mt-2 text-xs leading-6 text-slate-500">{selfGuides[tab]?.[1]}</p></details>
    <SelfAI key={tab} props={props} tab={tab} />
    <SelfTransfer key={`transfer-${tab}`} props={props} tab={tab} />
    {["skills", "resources"].includes(tab) && <CapabilityPlan key={`requirements-${tab}`} props={props} scope={tab === "resources" ? "resources" : "all"} />}
    {tab === "values" && <OverallVision props={props} />}
    {tab === "values" && <VisionPlan props={props} />}
    {tab === "values" && <VisionValues props={props} />}
    <SceneFilter view={view} value={scene} onChange={(scene) => navigate({ scene })} />
    {tab === "skills" && <CapabilityLibrary props={props} />}
    {tab === "resources" && <ResourceLedger props={props} />}
    {tab === "values" && <section className="mb-7"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">场景愿景</h2></div>
      {<div className="divide-y divide-line border-y border-line">{view.scenes.filter((item) => matchesScene(item.id, scene, view)).map((item) => { const record = records.find((row) => row.kind === "vision" && row.sceneId === item.id && !row.archived); const description = sceneDefaults.find((row) => row.slot === item.slot)?.description; if (!record) return <div key={item.id} className="py-4"><h3 className="text-sm font-semibold">{item.name}</h3><p className="my-2 text-xs text-slate-500">{description}</p><Button onClick={() => setEditing({ kind: "vision", sceneId: item.id, title: `${item.name}愿景`, payload: visionSchema.parse({}) })}>填写场景愿景</Button></div>; return <div key={record.id} data-record-id={record.id} className={`py-4 ${props.target.recordId === record.id ? "bg-[#f0f5f1]" : ""}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-xs text-sage">{item.name} · {description}</span><h3 className="mt-1 break-words text-sm font-semibold">{record.title}</h3></div><div className="flex shrink-0 gap-2"><button title="编辑愿景" aria-label="编辑愿景" onClick={() => start("vision", record)}><Pencil size={15} /></button><button title="愿景历史" aria-label="愿景历史" onClick={() => setHistoryId(historyId === record.id ? "" : record.id)}><History size={15} /></button><button title="归档愿景" aria-label="归档愿景" onClick={() => { if (window.confirm("归档愿景？现有引用和历史版本仍会保留。")) void post("record", { ...record, archived: true }); }}><Archive size={15} /></button></div></div>
        <VisionContent title={`${item.name}愿景详情`} preview={String(record.payload.expected || "尚未填写期望状态")} focused={props.target.recordId === record.id}>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm">{String(record.payload.expected || "尚未填写期望状态")}</p><div className="mt-3"><h4 className="text-xs text-slate-400">主要目标</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm">{String(record.payload.mainGoals || "尚未填写主要目标")}</p></div><details className="mt-3"><summary className="cursor-pointer text-xs text-slate-500">衡量标准与时间</summary><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{[["metric", "衡量标准"], ["horizon", "时间范围"], ["boundary", "底线"]].map(([key, label]) => <div key={key}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{String(record.payload[key] || "未填写")}</dd></div>)}</dl></details>
        </VisionContent>
        {!record.archived && <SelfLoop props={props} type="vision" record={record} />}
        {historyId === record.id && <div className="mt-4 space-y-2">{view.versions.filter((version) => version.recordId === record.id).map((version) => <details key={version.id} className="border-t border-line pt-2"><summary className="cursor-pointer text-xs text-slate-500">{new Date(version.createdAt).toLocaleString("zh-CN")}</summary><pre className="mt-2 whitespace-pre-wrap break-words bg-mist p-3 text-xs">{JSON.stringify(JSON.parse(version.snapshot), null, 2)}</pre></details>)}</div>}
      </div>; })}</div>}
      <div className="mt-3"><Link onClick={() => props.navigate({ section: "goals", tab: "visions", scene })}>查看愿景对齐</Link></div>
      <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-xs text-slate-500">已归档愿景</summary>{view.records.filter((row) => row.kind === "vision" && row.archived && matchesScene(row.sceneId, scene, view)).map((record) => <div key={record.id} className="py-3"><Link onClick={() => navigate({ recordId: record.id })}>{record.title}</Link><p className="mt-2 whitespace-pre-wrap break-words text-xs">{String(record.payload.expected || "未填写期望状态")}</p><Button onClick={() => setHistoryId(historyId === record.id ? "" : record.id)}>查看历史</Button>{historyId === record.id && view.versions.filter((version) => version.recordId === record.id).map((version) => <details key={version.id} className="mt-2"><summary className="text-xs">{new Date(version.createdAt).toLocaleString("zh-CN")}</summary><pre className="whitespace-pre-wrap break-words p-2 text-xs">{JSON.stringify(JSON.parse(version.snapshot).payload, null, 2)}</pre></details>)}</div>)}</details>
    </section>}
    {! ["skills", "resources"].includes(tab) && legacy(tab, scene, (type, record) => <SelfLoop props={props} type={type} record={record} />)}
    <details className="mt-6 border-t border-line pt-4"><summary className="cursor-pointer text-xs text-slate-500">场景设置</summary><div className="mt-3"><Button onClick={() => { setScenes(view.scenes); setSettings(true); }}><Settings2 size={15} />管理场景</Button></div></details>
    {editing && <EditDialog title={editing.kind === "vision" ? "编辑场景愿景" : "编辑技能评估"} working={working} onClose={() => setEditing(null)} onSave={async () => {
      const result = await post("record", editing); if (result) setEditing(null);
    }}>
      <Field label="标题"><input required maxLength={300} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></Field>
      <Field label="场景"><SceneSelect required={editing.kind === "vision"} view={view} value={editing.sceneId || ""} onChange={(value) => setEditing({ ...editing, sceneId: value || null })} /></Field>
      {editing.kind === "vision" ? [["expected", "期望状态"], ["mainGoals", "主要目标"], ["metric", "衡量标准"], ["horizon", "时间范围"], ["boundary", "底线"]].map(([key, label]) => <Field key={key} label={label}><textarea rows={2} value={editing.payload[key] || ""} onChange={(event) => updatePayload(key, event.target.value)} /></Field>) : <>
        <Field label="能力证据"><select value={editing.payload.evidenceId || ""} onChange={(event) => updatePayload("evidenceId", event.target.value || null)}><option value="">待补充证据</option>{(props.data?.evidences || []).map((row: Row) => <option key={row.id} value={row.id}>{row.ability} · {row.evidence}</option>)}</select></Field>
        <Field label="自评（1–5，可不填）"><input type="number" min={1} max={5} value={editing.payload.rating ?? ""} onChange={(event) => updatePayload("rating", event.target.value ? Number(event.target.value) : null)} /></Field>
        <Field label="待提升项与下一步"><textarea rows={3} value={editing.payload.improvement} onChange={(event) => updatePayload("improvement", event.target.value)} /></Field>
      </>}
    </EditDialog>}
    {settings && <EditDialog title="管理场景" working={working} onClose={() => setSettings(false)} onSave={async () => { const result = await post("scenes", scenes); if (result) setSettings(false); }}>
      {scenes.map((scene, index) => <div key={scene.id} className="flex items-center gap-2"><input aria-label={`场景 ${index + 1} 名称`} required maxLength={30} value={scene.name} onChange={(event) => setScenes(scenes.map((row) => row.id === scene.id ? { ...row, name: event.target.value } : row))} />{[-1, 1].map((direction) => <button key={direction} type="button" title={direction < 0 ? "上移" : "下移"} aria-label={`${scene.name}${direction < 0 ? "上移" : "下移"}`} disabled={index + direction < 0 || index + direction >= scenes.length} className="p-2 disabled:opacity-25" onClick={() => { const rows = [...scenes]; [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]]; setScenes(rows.map((row, position) => ({ ...row, position }))); }}>{direction < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</button>)}</div>)}
    </EditDialog>}
  </>;
}
