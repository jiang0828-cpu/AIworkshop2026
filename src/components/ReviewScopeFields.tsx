"use client";
import type { CompletedDailyWork } from "@/lib/review-completed-work";
import { shanghaiDate } from "@/lib/daily/shared";

type Project = { id: string; name?: string };
type Action = { id: string; title?: string; projectId?: string | null; status?: string; standard?: string; dueDate?: string | null };

export default function ReviewScopeFields({ projects, actions, projectIds, actionIds, onChange, dailyTasks = [], dailyTaskIds = [], onDailyChange }: {
  projects: Project[]; actions: Action[]; projectIds: string[]; actionIds: string[];
  onChange: (projects: string[], actions: string[]) => void;
  dailyTasks?: CompletedDailyWork[]; dailyTaskIds?: string[]; onDailyChange?: (ids: string[]) => void;
}) {
  const available = actions.filter(action => !action.projectId || projectIds.includes(action.projectId) || actionIds.includes(action.id));
  return <div className="space-y-3 border-b border-line pb-4">
    <fieldset><legend className="mb-2 text-sm font-medium">复盘项目</legend>
      <div className="max-h-36 space-y-2 overflow-y-auto">
        {projects.map(project => <label key={project.id} className="flex items-start gap-2 break-words text-sm">
          <input type="checkbox" className="!mt-1 !w-auto shrink-0" checked={projectIds.includes(project.id)} onChange={event => {
            const next = event.target.checked ? [...projectIds, project.id] : projectIds.filter(id => id !== project.id);
            onChange(next, event.target.checked ? [...new Set([...actionIds, ...actions.filter(action => action.projectId === project.id).map(action => action.id)])] : actionIds.filter(id => actions.some(action => action.id === id && action.projectId !== project.id)));
          }} /><span className="min-w-0">{project.name}<span className="ml-1 text-xs text-slate-400">（{actions.filter(action => action.projectId === project.id).length} 项任务）</span></span>
        </label>)}
      </div>
    </fieldset>
    <fieldset><legend className="mb-2 text-sm font-medium">复盘任务</legend>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {available.map(action => <label key={action.id} className="flex items-start gap-2 break-words text-sm">
          <input type="checkbox" className="!mt-1 !w-auto shrink-0" checked={actionIds.includes(action.id)} onChange={event => onChange(projectIds, event.target.checked ? [...actionIds, action.id] : actionIds.filter(id => id !== action.id))} />
          <span className="min-w-0"><span>{action.title} · {action.status || "待开始"}</span><span className="mt-1 block text-xs text-slate-500">{projects.find(project => project.id === action.projectId)?.name || "独立任务"} · 截止：{action.dueDate?.slice(0, 10) || "未排期"} · 完成标准：{action.standard || "未填写"}</span></span>
        </label>)}
      </div>
      {!available.length && <p className="text-xs text-slate-500">暂无任务，可选择其他项目或每日完成工作。</p>}
    </fieldset>
    {dailyTasks.length > 0 && <fieldset><legend className="mb-2 text-sm font-medium">每日完成工作</legend><div className="max-h-56 space-y-2 overflow-y-auto">{dailyTasks.map(task => <label key={task.id} className="flex items-start gap-2 break-words text-sm"><input type="checkbox" className="!mt-1 !w-auto shrink-0" checked={dailyTaskIds.includes(task.id)} onChange={event => onDailyChange?.(event.target.checked ? [...dailyTaskIds, task.id] : dailyTaskIds.filter(id => id !== task.id))} /><span className="min-w-0">{task.title}<span className="block text-xs text-slate-500">{shanghaiDate(new Date(String(task.completedAt)))}</span></span></label>)}</div></fieldset>}
    {dailyTaskIds.length > 0 && <p className="text-xs text-slate-500">已选每日完成工作 {dailyTaskIds.length} 项</p>}
    <p className="text-xs text-slate-500">已选 {projectIds.length} 个项目、{actionIds.length} 项任务，完成 {actions.filter(action => actionIds.includes(action.id) && action.status === "已完成").length} 项。</p>
  </div>;
}
