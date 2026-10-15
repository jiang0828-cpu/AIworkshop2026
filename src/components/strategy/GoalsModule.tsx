"use client";
import { useEffect, useState } from "react";
import { CheckCheck, FileText, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { shanghaiDate } from "@/lib/daily/shared";
import { goalAncestors, goalHorizons, goalScene } from "@/lib/goal-hierarchy";
import { otherSceneId } from "@/lib/scenes";
import { recordAncestors } from "@/lib/record-hierarchy";
import RadarReferences from "./radar/References";
import GoalProjectPlanner from "./GoalProjectPlanner";
import ExecutionTree from "./ExecutionTree";
import DeliveryMeta from "./DeliveryMeta";
import { AIAnalysis, Button, DetailPane, EditDialog, Empty, Heading, Link, matchesScene, SceneFilter, SourceLinks, useStrategy, type ModuleProps, type Row } from "./Shared";

const horizons = goalHorizons;
const nextHorizon: Record<string, string> = { 长期: "5年", "10年": "5年", "5年": "3年", "3年": "1年", 年度: "90天", "1年": "90天", "90天": "本周", "本月": "本周" };
export default function GoalsModule({ props }: { props: ModuleProps }) {
  const { view, post, working } = useStrategy(props);
  const scene = props.target.scene || "all";
  const [horizon, setHorizon] = useState("all"), [selected, setSelected] = useState<string[]>([]), [classification, setClassification] = useState("");
  const [busy, setBusy] = useState(false), [document, setDocument] = useState<Row | null>(null);
  const [planningGoal, setPlanningGoal] = useState<Row | null>(null);
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [incomplete, setIncomplete] = useState(false);
  const goals: Row[] = props.data?.goals || [], projects: Row[] = props.data?.projects || [], actions: Row[] = props.data?.actions || [];
  const fallback = otherSceneId(view.scenes);
  const project = projects.find((row) => row.id === props.target.projectId);
  const goal = goals.find((row) => row.id === (project?.goalId || props.target.goalId));
  const projectRows = projects.filter((row) => matchesScene(row.effectiveSceneId || row.sceneId, scene, view) && (!goal || row.goalId === goal.id));
  const projectActions = actions.filter((row) => row.projectId === project?.id);
  const navigate = (next: Row) => props.navigate({ section: "goals", scene, ...next });
  useEffect(() => { setSelected([]); }, [scene]);
  const addToDaily = async () => {
    const ids = projectActions.filter((row) => row.status !== "已完成").map((row) => row.id);
    if (!ids.length) { props.notify("此项目暂无待完成任务"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/daily-collaboration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import-actions", date: shanghaiDate(), ids }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "加入失败");
      await props.reload(); props.notify(`已加入 ${result.saved} 项任务`); props.navigate({ section: "daily" });
    } catch (error) { props.notify(error instanceof Error ? error.message : "加入失败"); } finally { setBusy(false); }
  };
  const downloadDocument = () => {
    if (!document) return;
    const url = URL.createObjectURL(new Blob([document.content], { type: "text/markdown;charset=utf-8" }));
    const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `${document.name}.md`; anchor.click(); URL.revokeObjectURL(url);
  };
  const createDocument = () => {
    if (!project) return;
    const content = `# ${project.name}\n\n场景：${view.scenes.find((scene) => scene.id === project.sceneId)?.name || "其他"}\n目标：${goal?.title || "未关联"}\n\n${project.description}\n\n## 指标与边界\n指标：${project.metric || "未定义"}\n投入：${project.budget || "未定义"}\n边界：${project.boundary || "未定义"}\n停止条件：${project.stopCondition || "未定义"}\n风险：${project.risk || "未定义"}\n\n## 里程碑\n${(project.milestones || []).map((row: Row) => `- ${row.title}：${row.status}；${row.metric || "未定义"}`).join("\n") || "暂无"}\n\n## 行动\n${projectActions.map((row) => `- ${row.title}：${row.status}；完成标准：${row.standard || "未定义"}`).join("\n") || "暂无"}`;
    setDocument({ name: project.name, content });
  };
  return <>
    <Heading title="目标 → 项目 → 任务" action={<Button primary onClick={() => props.open({ type: "goal", item: { sceneId: scene !== "all" && scene !== "unclassified" ? scene : null } })}><Plus size={15} />新建目标</Button>} />
    <div className="mb-5 flex min-w-0 flex-wrap items-center gap-3">
      <SceneFilter inline view={view} value={scene} onChange={(scene) => navigate({ scene })} />
      <select aria-label="按目标周期筛选" className="!w-auto max-w-full" value={horizon} onChange={(event) => setHorizon(event.target.value)}><option value="all">全部周期</option>{horizons.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="按执行状态筛选" className="!w-auto max-w-full" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="open">未完成</option>{[...new Set([...goals, ...projects, ...actions].map(row => row.status).filter(Boolean))].map(value => <option key={value} value={value}>{value}</option>)}</select><label className="flex items-center gap-2 text-xs"><input type="checkbox" className="!w-auto" checked={incomplete} onChange={event => setIncomplete(event.target.checked)} />仅看待完善</label><label className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-48"><Search size={16} className="shrink-0 text-slate-400" /><input aria-label="搜索目标项目任务" placeholder="搜索名称或完成标准" value={query} onChange={event => setQuery(event.target.value)} /></label>{(horizon !== "all" || status !== "all" || incomplete || query) && <button title="清空筛选" aria-label="清空筛选" onClick={() => { setHorizon("all"); setStatus("all"); setQuery(""); setIncomplete(false); }}><X size={16} /></button>}</div>
    {selected.length > 0 && <div className="mb-5 space-y-3 border-y border-line py-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs">已选 {selected.length} 项</span><select aria-label="批量归类场景" className="!w-auto" value={classification} onChange={(event) => setClassification(event.target.value)}><option value="">其他</option>{view.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select><Button disabled={working} onClick={() => { if (window.confirm("确认更新所选目标的场景？愿景关联需重新确认。")) void post("classify", selected.map((id) => ({ type: "goal", id, sceneId: classification || null }))); }}>确认批量归类</Button></div><AIAnalysis props={props} mode="classify" records={selected.slice(0, 20).map((id) => ({ type: "goal", id }))} /></div>}
    <div className="min-w-0">
      <ExecutionTree props={props} view={view} filters={{ scene, horizon, status, query, incomplete }} fallback={fallback} selected={selected} setSelected={setSelected} onOpen={(type, item) => props.open({ type, item })} onGoal={row => navigate({ goalId: row.id })} onProject={row => navigate({ goalId: row.goalId || undefined, projectId: row.id })} />
      {(goal || project) && <DetailPane drawer enabled title={project?.name || goal?.title || "目标与项目"} onClose={() => navigate({})}><div className="min-w-0">
        {goal && !project && <section className="mb-6 border-b border-line pb-5"><div className="flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{goal.title}</h2><div className="flex gap-3"><button title="编辑目标" aria-label="编辑目标" onClick={() => props.open({ type: "goal", item: goal })}><Pencil size={15} /></button><button title="删除目标" aria-label="删除目标" onClick={() => props.remove("goal", goal.id)}><Trash2 size={15} /></button></div></div>
          <div className="mt-4 space-y-2 border-y border-line py-3 text-xs"><p>{view.scenes.find((row) => row.id === goalScene(goal as Row & { id: string }, fallback))?.name || "其他"} · {goal.horizon || "周期未设置"}</p><div className="flex flex-wrap items-center gap-2">{goalAncestors(goal as Row & { id: string }, goals as (Row & { id: string })[]).map((parent) => <span key={parent.id}><Link onClick={() => navigate({ goalId: parent.id })}>{parent.horizon} · {parent.title}</Link></span>)}<span>{goal.parentId ? "当前子目标" : "顶层目标"}</span><Link onClick={() => props.open({ type: "goal", item: goal })}>调整从属</Link></div>{goals.filter((row) => row.parentId === goal.id).map((child) => <div key={child.id}><Link onClick={() => navigate({ goalId: child.id })}>下级：{child.horizon} · {child.title}</Link></div>)}</div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{goal.description}</p><p className="mt-3 text-xs text-slate-500">指标：{goal.metric || "未定义"} · 截止：{goal.deadline ? String(goal.deadline).slice(0, 10) : "未设置"}</p>
          <SourceLinks view={view} type="goal" id={goal.id} data={props.data || {}} navigate={props.navigate} />
          <RadarReferences targetType="goal" targetId={goal.id} sceneId={goal.effectiveSceneId || goal.sceneId} navigate={props.navigate} notify={props.notify} />
          {goal.visionId && <div className="mt-3"><Link onClick={() => props.navigate({ section: "self", tab: "values", recordId: goal.visionId })}>查看关联愿景</Link></div>}
          <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => props.open({ type: "goal", item: { parentId: goal.id, sceneId: goal.sceneId, visionId: goal.visionId, horizon: nextHorizon[goal.horizon] || "本周" } })}><Plus size={14} />新增子目标</Button><Button disabled={goal.horizon === "本周"} onClick={() => setPlanningGoal(goal)}><Sparkles size={14} />AI 生成子目标与项目</Button><Button onClick={() => props.open({ type: "project", item: { goalId: goal.id, sceneId: goal.sceneId, visionId: goal.visionId } })}><Plus size={14} />新建关联项目</Button></div>
        </section>}
        {!project && <section><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">关联项目</h2><Button onClick={() => props.open({ type: "project", item: { goalId: goal?.id, sceneId: goal?.sceneId } })}><Plus size={14} />新增项目</Button></div>
          <div className="grid gap-3 sm:grid-cols-2">{projectRows.map((row) => {
            const associated = actions.filter((action) => action.projectId === row.id && !["已取消", "归档"].includes(action.status)), done = associated.filter((action) => action.status === "已完成").length;
            const milestones = row.milestones || [], complete = milestones.filter((item: Row) => item.status === "已完成").length;
            return <button key={row.id} onClick={() => navigate({ goalId: row.goalId || undefined, projectId: row.id })} className="min-w-0 rounded-md border border-line bg-white p-4 text-left"><span className="block break-words text-sm font-semibold">{row.name}</span><span className="mt-2 block text-xs text-slate-500">{row.status} · {view.scenes.find((scene) => scene.id === (row.effectiveSceneId || row.sceneId))?.name || "其他"}</span><span className="mt-3 block text-xs">关联任务 {done}/{associated.length}</span><span role="progressbar" aria-label={`${row.name}任务完成率`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={associated.length || 1} className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-sage" style={{ width: `${associated.length ? done / associated.length * 100 : 0}%` }} /></span><span className="mt-3 block text-xs text-slate-500">里程碑 {complete}/{milestones.length}</span></button>;
          })}</div>{!projectRows.length && <Empty>暂无关联项目</Empty>}
        </section>}
        {project && <section className="mt-6 border-t border-line pt-5"><div className="mb-3 flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{project.name}</h2><div className="flex gap-3"><button title="编辑项目" aria-label="编辑项目" onClick={() => props.open({ type: "project", item: project })}><Pencil size={15} /></button><button title="删除项目" aria-label="删除项目" onClick={() => props.remove("project", project.id)}><Trash2 size={15} /></button></div></div>
          {goal && <div className="mb-3"><Link onClick={() => navigate({ goalId: goal.id })}>所属目标：{goal.title}</Link></div>}
          <div className="mb-3 flex flex-wrap gap-3">{recordAncestors(project as Row & { id: string }, projects as (Row & { id: string })[]).map(parent => <Link key={parent.id} onClick={() => navigate({ goalId: parent.goalId || undefined, projectId: parent.id })}>上级：{parent.name}</Link>)}</div>
          <div className="mb-4 flex flex-wrap gap-3"><Button onClick={() => props.open({ type: "project", item: { parentId: project.id, goalId: project.goalId, sceneId: project.sceneId, visionId: project.visionId } })}><Plus size={14} />新增子项目</Button>{projects.filter(row => row.parentId === project.id).map(child => <Link key={child.id} onClick={() => navigate({ goalId: child.goalId || undefined, projectId: child.id })}>{child.name}</Link>)}</div>
          <DeliveryMeta code={project.recordCode} date={project.deadline} navigate={props.navigate} />
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{project.description}</p><details className="mt-4"><summary className="cursor-pointer text-xs text-slate-500">指标、投入与风险</summary><dl className="mt-4 grid gap-3 sm:grid-cols-2">{[["metric", "指标"], ["budget", "投入"], ["boundary", "边界"], ["stopCondition", "停止条件"], ["risk", "风险"]].map(([key, label]) => <div key={key}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm">{project[key] || "未填写"}</dd></div>)}</dl></details>
          <SourceLinks view={view} type="project" id={project.id} data={props.data || {}} navigate={props.navigate} />
          <div className="my-5 flex flex-wrap gap-2"><Button onClick={() => props.open({ type: "action", item: { goalId: project.goalId, projectId: project.id } })}><Plus size={14} />新建任务</Button><Button disabled={busy} onClick={() => void addToDaily()}>加入每日计划</Button><details><summary className="cursor-pointer px-3 py-2 text-sm text-slate-500">更多操作</summary><div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => props.open({ type: "aiTask", item: { title: project.name, goalId: project.goalId || "", projectId: project.id, instructions: project.description, acceptanceCriteria: project.metric } })}><Sparkles size={14} />创建 AI 任务</Button><Button onClick={createDocument}><FileText size={14} />项目文档</Button></div></details></div>
          <details className="mb-4"><summary className="cursor-pointer text-xs text-slate-500">里程碑（{(project.milestones || []).length}）</summary><div className="mt-3 mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">里程碑</h3><Button onClick={() => props.open({ type: "milestone", item: { projectId: project.id } })}><Plus size={14} />新增里程碑</Button></div>
          {(project.milestones || []).map((row: Row) => <div key={row.id} className="flex items-start justify-between gap-3 border-b border-line py-3"><div><p className="text-sm">{row.title}</p><p className="mt-1 text-xs text-slate-500">{row.status} · {row.deadline ? row.deadline.slice(0, 10) : "无截止日期"} · {row.metric || "未定义指标"}</p></div><div className="flex gap-2"><button title="编辑里程碑" aria-label="编辑里程碑" onClick={() => props.open({ type: "milestone", item: row })}><Pencil size={14} /></button><button title="删除里程碑" aria-label="删除里程碑" onClick={() => props.remove("milestone", row.id)}><Trash2 size={14} /></button></div></div>)}
          </details><h3 className="mb-3 mt-5 text-sm font-semibold">关联任务</h3>{projectActions.length ? projectActions.map((row) => <div key={row.id} className="flex items-center gap-3 border-b border-line py-3"><CheckCheck size={16} className={row.status === "已完成" ? "text-sage" : "text-slate-300"} /><button className="min-w-0 flex-1 text-left" onClick={() => props.open({ type: "action", item: row })}><span className="block break-words text-sm">{row.title}</span><span className="mt-1 block text-xs text-slate-500">{row.status} · {row.standard || "未定义完成标准"}</span></button></div>) : <Empty>暂无关联任务</Empty>}
          <div className="mt-3"><Link onClick={() => props.navigate({ section: "actions", projectId: project.id })}>任务与复盘</Link></div>
        </section>}
      </div></DetailPane>}
    </div>
    {planningGoal && <GoalProjectPlanner key={planningGoal.id} props={props} goal={planningGoal} onClose={() => setPlanningGoal(null)} />}
    {document && <EditDialog title="项目文档" working={busy} onClose={() => setDocument(null)} onSave={async () => {
      if (busy) return; setBusy(true);
      try {
        const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "goals", content: document.content, source: `项目 ${project?.id || ""}` }) });
        if (!response.ok) throw new Error("文档保存失败");
        await props.reload(); props.notify("项目文档已保存到档案"); setDocument(null);
      } catch (error) { props.notify(error instanceof Error ? error.message : "文档保存失败"); } finally { setBusy(false); }
    }}><textarea aria-label="项目文档内容" rows={16} value={document.content} onChange={(event) => setDocument({ ...document, content: event.target.value })} /><Button onClick={downloadDocument}>下载 Markdown</Button></EditDialog>}
  </>;
}
