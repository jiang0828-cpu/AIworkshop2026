"use client";
import { useState } from "react";
import type { OverviewData } from "@/lib/workbench-overview";
import { AIAnalysis, Button, Empty, Link, SceneSelect, emptyStrategy, type Navigation } from "./Shared";

export default function ClassificationQueue({ data, reload, navigate, notify }: { data: OverviewData; reload: () => Promise<void>; navigate: (target: Navigation) => void; notify: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]), [sceneId, setSceneId] = useState(""), [working, setWorking] = useState(false);
  const view = data.strategy || emptyStrategy;
  const records = (["goal", "project", "decision"] as const).flatMap((type) => (data[`${type}s`] || []).filter((record) => !record.sceneId).map((record) => ({ ...record, type, key: `${type}:${record.id}` })));
  const chosen = records.filter((record) => selected.includes(record.key));
  const classify = async () => {
    if (working || !chosen.length) return;
    const cross = chosen.some((record) => record.type === "project" && record.goalId && data.goals?.some((goal) => goal.id === record.goalId && goal.sceneId && sceneId && goal.sceneId !== sceneId));
    if (!window.confirm(cross ? "所选项目与目标主场景不一致，确认保留跨场景关联？愿景关联需重新确认。" : "确认归类所选记录？愿景关联需重新确认。")) return;
    setWorking(true);
    try {
      const response = await fetch("/api/strategy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "classify", data: chosen.map((record) => ({ type: record.type, id: record.id, sceneId: sceneId || null, crossSceneConfirmed: cross })) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "归类失败");
      await reload(); setSelected([]); notify("已归类");
      const sync = await fetch("/api/sync", { method: "POST" }); if (!sync.ok) notify("本地已保存，云端同步暂未完成");
    } catch (error) { notify(error instanceof Error ? error.message : "归类失败"); } finally { setWorking(false); }
  };
  return <section className="mb-6 border-y border-line py-5"><h2 className="mb-3 text-sm font-semibold">其他记录 · {records.length}</h2>{records.length ? <>
    <div className="mb-3 flex flex-wrap items-center gap-2"><div className="min-w-36"><SceneSelect view={view} value={sceneId} onChange={setSceneId} /></div><Button disabled={working || !chosen.length} onClick={() => void classify()}>确认批量归类</Button></div>
    <div className="mb-4 divide-y divide-line">{records.map((record) => <div key={record.key} className="flex items-center gap-3 py-3"><input type="checkbox" className="!w-auto" aria-label={`选择其他记录 ${record.title || record.name}`} checked={selected.includes(record.key)} onChange={(event) => setSelected(event.target.checked ? [...selected, record.key] : selected.filter((key) => key !== record.key))} /><span className="min-w-0 flex-1 break-words text-sm">{record.type === "goal" ? "目标" : record.type === "project" ? "项目" : "决策"} · {record.title || record.name}</span><Link onClick={() => navigate({ section: record.type === "decision" ? "decisions" : "goals", ...(record.type === "goal" ? { goalId: record.id } : record.type === "project" ? { projectId: record.id } : { tab: "decisions", recordId: record.id }) })}>打开</Link></div>)}</div>
    <AIAnalysis props={{ data, reload, notify }} mode="classify" records={chosen.slice(0, 20).map((record) => ({ type: record.type, id: record.id }))} />
  </> : <Empty>暂无其他目标、项目或决策</Empty>}</section>;
}
