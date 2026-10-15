import { periodTaskDone, recurrenceProgress, recurrenceSummary, type RecurrenceSummary, type RecurringAction } from "./recurring-tasks";
import type { ReviewRange } from "./review-period";
import type { CompletedWork } from "./review-completed-work";
type Project = { id: string; name?: string; status?: string; deadline?: unknown };
type Action = RecurringAction & { id: string; title?: string; projectId?: string | null; status?: string; dueDate?: unknown; recurrenceSummary?: RecurrenceSummary | null };

function day(value: unknown) {
  if (!value) return "未排期";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "未排期" : value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function summary(lines: string[]) {
  const included: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > 4900) break;
    included.push(line);
    length += line.length + 1;
  }
  if (included.length < lines.length) included.push(`另有 ${lines.length - included.length} 条，请查看关联项目任务。`);
  return included.join("\n");
}

export function reviewDeliveryDraft(projects: Project[], actions: Action[], range?: ReviewRange, completedWork: CompletedWork[] = [], scenes: { id: string; name: string }[] = []) {
  const ordered = actions.map(action => ({ ...action, recurrenceSummary: range ? recurrenceSummary(action, range) : action.recurrenceSummary }))
    .sort((a, b) => day(a.dueDate).localeCompare(day(b.dueDate)) || a.id.localeCompare(b.id));
  const completed = ordered.filter(periodTaskDone);
  const pending = ordered.filter(action => !periodTaskDone(action));
  const describe = (action: Action) => {
    const project = projects.find(project => project.id === action.projectId);
    return `${action.title || "未命名任务"}（${project?.name || "未关联项目"}；${action.recurrenceSummary ? recurrenceProgress(action.recurrenceSummary) : `截止 ${day(action.dueDate)}`}）`;
  };
  const dailyActionIds = new Set(completedWork.filter(work => work.sourceType === "action").map(work => work.sourceId));
  return {
    wins: summary([
      `交付任务 ${actions.length} 项，当前已完成 ${completed.length} 项，未完成 ${pending.length} 项。`,
      ...(completedWork.length ? [`实际完成工作 ${completedWork.length} 项，共 ${completedWork.reduce((count, work) => count + work.entries.length, 0)} 条完成记录（按实际完成时间统计）。`] : []),
      ...projects.map(project => `项目：${project.name || "未命名项目"}；状态：${project.status || "未填写"}；交付：${day(project.deadline)}`),
      ...completed.filter(action => !dailyActionIds.has(action.id)).map(action => `已完成：${describe(action)}`),
      ...pending.filter(action => action.recurrenceSummary && !dailyActionIds.has(action.id)).map(action => describe(action)),
      ...completedWork.map(work => `【${scenes.find(scene => scene.id === work.sceneId)?.name || "其他"}】${work.title}：${work.entries.map(entry => `${entry.date} 已完成${entry.result ? `；结果：${entry.result}` : ""}`).join("；")}`),
    ]),
    executionIssue: pending.length ? summary(pending.map(action => `未完成：${describe(action)}；当前状态：${action.status || "待开始"}；原因待补充。`)) : actions.length ? "所选任务当前均已完成；如有执行问题，可补充记录。" : completedWork.length ? "已汇总所选每日完成工作；如有执行问题，可补充记录。" : "尚未选择任务。",
    adjustment: pending.length ? summary(pending.map(action => `待安排：${describe(action)}；确认后续交付时间与推进方式。`)) : "待确认下一周期的重点项目与任务。",
  };
}
