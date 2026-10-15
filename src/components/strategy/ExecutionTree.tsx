"use client";
import { useEffect, useState } from "react";
import { CheckCheck, ChevronDown, ChevronRight, Flag, Folder, ListChecks, Plus } from "lucide-react";
import { executionTree, missingTreeFields, type TreeFilters, type TreeRecord } from "@/lib/execution-tree";
import { goalAncestors, hierarchyIssue, sortGoals } from "@/lib/goal-hierarchy";
import { recordAncestors } from "@/lib/record-hierarchy";
import { Button, Empty, type ModuleProps, type Row } from "./Shared";
import type { StrategyView } from "@/lib/strategy/shared";
import DeliveryMeta from "./DeliveryMeta";
import TaskSchedule from "./TaskSchedule";

export default function ExecutionTree({ props, view, filters, fallback, selected, setSelected, onOpen, onGoal, onProject }: {
  props: ModuleProps; view: StrategyView; filters: TreeFilters; fallback: string; selected: string[];
  setSelected: (ids: string[]) => void; onOpen: (value: string, row: Row) => void;
  onGoal: (row: Row) => void; onProject: (row: Row) => void;
}) {
  const goals: TreeRecord[] = props.data?.goals || [], projects: TreeRecord[] = props.data?.projects || [], actions: TreeRecord[] = props.data?.actions || [];
  const tree = executionTree(goals, projects, actions, fallback, filters);
  const filtering = filters.query.trim() !== "" || filters.status !== "all" || filters.horizon !== "all" || filters.incomplete || filters.scene !== "all";
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}), [allOpen, setAllOpen] = useState<boolean | null>(null);
  useEffect(() => { setExpanded({}); setAllOpen(null); }, [filters.scene, filters.query, filters.status, filters.horizon, filters.incomplete]);
  useEffect(() => {
    const project = projects.find(row => row.id === props.target.projectId);
    const goal = goals.find(row => row.id === (project?.goalId || props.target.goalId));
    const keys = [...(goal ? [...goalAncestors(goal, goals), goal].map(row => `goal:${row.id}`) : []), ...(project ? [...recordAncestors(project, projects), project].map(row => `project:${row.id}`) : [])];
    if (keys.length) setExpanded(current => ({ ...current, ...Object.fromEntries(keys.map(key => [key, true])) }));
    // Preserve manual expansion when navigation selects a record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.target.goalId, props.target.projectId]);
  const openFor = (key: string, initial = false) => expanded[key] ?? allOpen ?? (filtering || initial);
  const nesting = (depth: number) => `${depth < 3 ? "ml-2 border-l border-line pl-1 sm:ml-5 sm:pl-3" : "border-l border-line pl-1"} min-w-0`;
  const sceneName = (row: TreeRecord, type: "goal" | "project" | "action") => view.scenes.find(item => item.id === tree.sceneOf(row, type))?.name || "其他";
  const fields = (type: "goal" | "project" | "action", row: TreeRecord) => {
    const missing = missingTreeFields(type, row);
    return missing.length > 0 && <button title="填写缺失信息" onClick={() => onOpen(type, row)} className="mt-1 block max-w-full break-words text-left text-xs text-amber-800">待完善：{missing.join("、")}</button>;
  };
  const disclosure = (key: string, open: boolean, name: string) => <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center" aria-expanded={open} aria-label={`${open ? "折叠" : "展开"}${name}`} title={open ? "折叠" : "展开"} onClick={() => setExpanded(current => ({ ...current, [key]: !open }))}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>;
  const taskDraft = (row: TreeRecord) => ({ parentId: row.id, goalId: row.goalId, projectId: row.projectId, sceneId: row.sceneId });
  const projectDraft = (row: TreeRecord) => ({ parentId: row.id, goalId: row.goalId, sceneId: row.sceneId, visionId: (row as Row).visionId });

  const actionRows = (rows: TreeRecord[], depth: number): React.ReactNode => rows.map(row => {
    const key = `action:${row.id}`, open = openFor(key);
    const children = actions.filter(item => tree.actionParents.get(item.id) === row.id);
    return <div key={key} data-node-type="action" data-node-id={row.id} className="min-w-0 border-t border-line">
      <div className="flex min-w-0 items-start gap-1 py-3">
        {children.length ? disclosure(key, open, row.title || "任务") : <span className="w-8 shrink-0" />}
        <CheckCheck size={15} className={`mt-2 shrink-0 ${row.status === "已完成" ? "text-sage" : "text-slate-400"}`} />
        <div className="min-w-0 flex-1 px-1">
          <button title="编辑任务" className="break-words text-left text-sm font-medium" onClick={() => onOpen("action", row)}>{row.title}</button>
          <p className="mt-1 break-words text-xs text-slate-500">{row.parentId ? "子任务" : "任务"} · {row.status} · {sceneName(row, "action")}{!tree.direct.actions.has(row.id) ? " · 上级路径" : ""}</p>
          <DeliveryMeta code={row.recordCode} date={row.dueDate} navigate={props.navigate} />
          <TaskSchedule recurrence={row.recurrence} estimatedHours={row.estimatedHours} />
          {children.length > 0 && <p className="mt-1 text-xs text-slate-500">{children.length} 个子任务</p>}
          {row.standard && <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">完成标准：{row.standard}</p>}{fields("action", row)}
        </div>
        <button title="新增子任务" aria-label={`为任务 ${row.title} 新增子任务`} className="shrink-0 p-2" onClick={() => onOpen("action", taskDraft(row))}><Plus size={16} /></button>
      </div>
      {open && children.length > 0 && <div className={nesting(depth)}>{actionRows(children, depth + 1)}</div>}
    </div>;
  });

  const projectRows = (rows: TreeRecord[], depth: number): React.ReactNode => rows.map(row => {
    const key = `project:${row.id}`, open = openFor(key);
    const children = projects.filter(item => tree.projectParents.get(item.id) === row.id);
    const tasks = actions.filter(item => item.projectId === row.id && !tree.actionParents.get(item.id) && tree.included.actions.has(item.id));
    const actualTasks = actions.filter(item => item.projectId === row.id && !["已取消", "归档", "已归档"].includes(item.status || ""));
    const complete = actualTasks.filter(item => item.status === "已完成").length;
    const milestones: Row[] = (row as Row).milestones || [];
    return <div key={key} data-node-type="project" data-node-id={row.id} className="min-w-0 border-t border-line">
      <div className={`flex min-w-0 items-start gap-1 py-3 ${props.target.projectId === row.id ? "bg-[#f0f5f1]" : ""}`}>
        {disclosure(key, open, row.name || "项目")}<Folder size={15} className="mt-2 shrink-0 text-sage" />
        <div className="min-w-0 flex-1 px-1">
          <button className="break-words text-left text-sm font-semibold" onClick={() => onProject(row)}>{row.name}</button>
          <p className="mt-1 break-words text-xs text-slate-500">{row.parentId ? "子项目" : "项目"} · {row.status} · {sceneName(row, "project")}{!tree.direct.projects.has(row.id) ? " · 上级路径" : ""}</p>
          <DeliveryMeta code={row.recordCode} date={row.deadline} navigate={props.navigate} />
          <p className="mt-1 break-words text-xs text-slate-500">项目内任务 {complete}/{actualTasks.length} 已完成 · 里程碑 {milestones.filter(item => item.status === "已完成").length}/{milestones.length}{children.length ? ` · ${children.length} 个子项目` : ""}</p>{fields("project", row)}
        </div>
        <button title="新建关联任务" aria-label={`为项目 ${row.name} 新建任务`} className="shrink-0 p-2" onClick={() => onOpen("action", { goalId: row.goalId, projectId: row.id })}><Plus size={16} /></button>
      </div>
      {open && <div className={nesting(depth)}>
        {projectRows(children, depth + 1)}{actionRows(tasks, depth + 1)}
        {!tasks.length && !children.length && <p className="py-3 text-xs text-slate-500">{filtering ? "没有符合筛选的下级记录" : "尚未安排子项目或任务"}</p>}
        <div className="flex flex-wrap gap-4 py-3"><button className="inline-flex items-center gap-1 text-xs text-sage" onClick={() => onOpen("project", projectDraft(row))}><Plus size={14} />新增子项目</button><button className="inline-flex items-center gap-1 text-xs text-sage" onClick={() => onOpen("action", { goalId: row.goalId, projectId: row.id })}><Plus size={14} />新建任务</button></div>
      </div>}
    </div>;
  });

  const goalRows = (rows: TreeRecord[], depth = 0): React.ReactNode => sortGoals(rows).map(row => {
    const key = `goal:${row.id}`, open = openFor(key, depth === 0);
    const children = goals.filter(item => tree.parentById.get(item.id) === row.id);
    const associated = projects.filter(item => item.goalId === row.id && !tree.projectParents.get(item.id) && tree.included.projects.has(item.id));
    const directTasks = actions.filter(item => item.goalId === row.id && !tree.actionParents.get(item.id) && (!item.projectId || !projects.some(project => project.id === item.projectId)) && tree.included.actions.has(item.id));
    const parent = goals.find(item => item.id === row.parentId);
    const issue = parent ? hierarchyIssue(row, parent, fallback) : row.parentId ? "上级目标已删除" : "";
    return <div key={key} data-node-type="goal" data-node-id={row.id} className="min-w-0 border-t border-line">
      <div className={`flex min-w-0 items-start gap-1 py-3 ${props.target.goalId === row.id && !props.target.projectId ? "bg-[#f0f5f1]" : ""}`}>
        {disclosure(key, open, row.title || "目标")}<input type="checkbox" aria-label={`选择目标 ${row.title}`} checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} className="mt-2.5 !w-auto shrink-0" /><Flag size={15} className="mt-2 shrink-0 text-sage" />
        <div className="min-w-0 flex-1 px-1"><button className="break-words text-left text-sm font-semibold" onClick={() => onGoal(row)}>{row.title}</button>
          <p className="mt-1 break-words text-xs text-slate-500">{parent ? "子目标" : "目标"} · {row.horizon || "周期未设置"} · {row.status} · {sceneName(row, "goal")}{!tree.direct.goals.has(row.id) ? " · 上级路径" : ""}</p>
          <p className="mt-1 text-xs text-slate-500">{children.length} 个子目标 · {associated.length} 个直属项目{directTasks.length ? ` · ${directTasks.length} 个直属任务` : ""}</p>
          {row.metric && <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">衡量标准：{row.metric}</p>}{fields("goal", row)}{issue && <button className="mt-1 block break-words text-left text-xs text-amber-800" onClick={() => onOpen("goal", row)}>{issue} · 调整从属</button>}
        </div>
        <button title="新建关联项目" aria-label={`为目标 ${row.title} 新建项目`} className="shrink-0 p-2" onClick={() => onOpen("project", { goalId: row.id, sceneId: row.sceneId, visionId: (row as Row).visionId })}><Plus size={16} /></button>
      </div>
      {open && <div className={nesting(depth)}>{goalRows(children, depth + 1)}{projectRows(associated, depth + 1)}
        {directTasks.length > 0 && <div className="min-w-0 border-t border-line pt-3"><h4 className="text-xs text-slate-500">直属任务 · 待关联项目</h4>{actionRows(directTasks, depth + 1)}</div>}
        {!children.length && !associated.length && !directTasks.length && <p className="py-3 text-xs text-slate-500">{filtering ? "没有符合筛选的下级记录" : "暂无子目标或项目"}</p>}
      </div>}
    </div>;
  });
  const noResults = !tree.direct.goals.size && !tree.direct.projects.size && !tree.direct.actions.size;
  return <div className="min-w-0" aria-label="目标项目任务嵌套列表">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-slate-500">{tree.direct.goals.size} 个目标 · {tree.direct.projects.size} 个项目 · {tree.direct.actions.size} 个任务</p><div className="flex gap-3"><button className="text-xs text-sage" onClick={() => { setExpanded({}); setAllOpen(true); }}>全部展开</button><button className="text-xs text-sage" onClick={() => { setExpanded({}); setAllOpen(false); }}>全部折叠</button></div></div>
    {noResults ? <Empty>没有符合条件的目标、项目或任务</Empty> : <>
      {view.scenes.map(scene => { const roots = tree.roots.filter(row => tree.sceneOf(row, "goal") === scene.id); return roots.length > 0 && <section key={scene.id} className="mb-5 min-w-0"><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 bg-sage" />{scene.name}</h2>{goalRows(roots)}</section>; })}
      {tree.standaloneProjects.length > 0 && <section className="mb-5"><h2 className="mb-2 text-sm font-semibold">未关联目标的项目</h2>{projectRows(tree.standaloneProjects, 0)}</section>}
      {tree.standaloneActions.length > 0 && <section><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ListChecks size={15} />未关联项目的独立任务</h2>{actionRows(tree.standaloneActions, 0)}</section>}
    </>}
    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4"><Button onClick={() => onOpen("project", { sceneId: filters.scene === "all" ? null : filters.scene === "unclassified" ? fallback : filters.scene })}><Plus size={14} />新建独立项目</Button><Button onClick={() => onOpen("action", { sceneId: filters.scene === "all" ? null : filters.scene === "unclassified" ? fallback : filters.scene })}><Plus size={14} />新建独立任务</Button></div>
  </div>;
}
