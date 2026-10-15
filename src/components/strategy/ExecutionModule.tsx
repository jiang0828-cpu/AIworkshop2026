"use client";
import GoalsModule from "./GoalsModule";
import StrategyModule from "./StrategyModule";
import { Button, Heading, SceneFilter, Tabs, matchesScene, type ModuleProps, type Row, useStrategy } from "./Shared";

export default function ExecutionModule({ props }: { props: ModuleProps }) {
  const { view } = useStrategy(props);
  const mode = props.target.section === "decisions" || ["basis", "planning", "decisions", "visions", "matrix", "alignment"].includes(props.target.tab || "") ? "planning" : props.target.tab === "tasks" ? "tasks" : "hierarchy";
  const scene = props.target.scene || "all";
  const navigate = (tab: string) => props.navigate({ section: "goals", tab, scene });
  const goals: Row[] = props.data?.goals || [], projects: Row[] = props.data?.projects || [];
  const tasks: Row[] = (props.data?.actions || []).filter((row: Row) => matchesScene(row.effectiveSceneId || row.sceneId, scene, view));
  return <>
    <Heading title="目标与执行" />
    <p className="mb-4 text-sm text-slate-500">以愿景和趋势研判为依据，确定目标，拆成项目，再落实为任务。</p>
    <Tabs items={[["hierarchy", "目标 → 项目 → 任务"], ["planning", "规划与对齐"], ["tasks", "全部任务"]]} active={mode} onChange={navigate} />
    {mode === "hierarchy" && <GoalsModule props={props} />}
    {mode === "planning" && <StrategyModule props={props} />}
    {mode === "tasks" && <SceneFilter view={view} value={scene} onChange={(value) => props.navigate({ ...props.target, scene: value })} />}
    {mode === "tasks" && <><div className="mb-4 flex flex-wrap gap-2"><Button onClick={() => props.open({ type: "action", item: { sceneId: scene === "all" ? null : scene } })}>新建任务</Button><Button onClick={() => props.navigate({ section: "daily" })}>每日协同与任务编排</Button></div>{!tasks.length && <p className="text-sm text-slate-500">暂无任务，可直接创建，或从项目详情中拆解。</p>}{tasks.map((task) => { const project = projects.find((row) => row.id === task.projectId); const goal = goals.find((row) => row.id === (project?.goalId || task.goalId)); return <div key={task.id} className="border-t border-line py-3"><p className="text-xs text-slate-500">{goal?.title || "未关联目标"} → {project?.name || "独立任务"}</p><button className="my-2 text-left text-sm font-medium" onClick={() => props.open({ type: "action", item: task })}>{task.title} · {task.status}</button>{project && <div><Button onClick={() => props.navigate({ section: "goals", projectId: project.id, goalId: goal?.id })}>查看所属项目</Button></div>}</div>; })}</>}
  </>;
}
