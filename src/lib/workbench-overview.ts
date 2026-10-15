import { laneLabels, shanghaiDate, statusLabels, taskStatus, type DailyView } from "./daily/shared";
import { type StrategyView } from "./strategy/shared";
import { resolveScene } from "./scenes";
import { reviewPeriod } from "./review-period";

export type OverviewRecord = {
  recordCode?: string | null;
  recurrence?: string;
  id: string; title?: string; name?: string; status?: string; goalId?: string | null;
  projectId?: string | null; dueDate?: string | null; deadline?: string | null;
  estimatedHours?: number; purpose?: string; standard?: string; aiRole?: string;
  instructions?: string; acceptanceCriteria?: string; updatedAt?: string;
  sceneId?: string | null;
};
export type OverviewData = {
  name?: string; stage?: string; roles?: string; identityCard?: { currentVersion: number; status: string } | null;
  actions?: OverviewRecord[]; aiTasks?: OverviewRecord[]; goals?: OverviewRecord[];
  projects?: OverviewRecord[]; decisions?: OverviewRecord[]; reviews?: Array<{ periodStart: string; periodEnd: string }>;
  valueRules?: unknown[]; evidences?: unknown[]; contextPackages?: Array<{ packageNumber: number }>;
  suggestions?: Array<{ id: string; status: string; targetType?: string }>;
  strategy?: StrategyView;
};
export type TaskSource = "action" | "daily" | "ai";
export type TaskGroup = "pending" | "running" | "attention" | "done";
export type OverviewTask = {
  recordCode?: string | null;
  key: string; id: string; title: string; source: TaskSource; status: string; group: TaskGroup;
  overdue: boolean; dueAt: string | null; dateOnly: boolean; priority: number;
  owner: string; goal: string; project: string; notes: string; standard: string;
  progress: { done: number; total: number } | null; reason: string;
  sceneId?: string | null;
};
export const sourceLabels: Record<TaskSource, string> = { action: "行动", daily: "今日协同", ai: "AI 任务" };
export const groupLabels: Record<TaskGroup, string> = { pending: "待执行", running: "进行中", attention: "需处理", done: "已完成" };
export const groupOrder: TaskGroup[] = ["pending", "running", "attention", "done"];

function deadlineTime(value: string | null, dateOnly: boolean) {
  return value ? new Date(dateOnly ? `${value.slice(0, 10)}T23:59:59.999+08:00` : value).getTime() : Infinity;
}
function lineage(record: OverviewRecord, data: OverviewData) {
  return {
    goal: data.goals?.find((goal) => goal.id === record.goalId)?.title || "",
    project: data.projects?.find((project) => project.id === record.projectId)?.name || "",
  };
}
function classify(status: string, overdue: boolean): TaskGroup {
  if (["已完成", "完成"].includes(status)) return "done";
  if (overdue || ["待验收", "阻塞", "已阻塞", "失败", "出错"].includes(status)) return "attention";
  if (["进行中", "执行中", "排队中", "准备中"].includes(status)) return "running";
  return "pending";
}

export function buildOverview(data: OverviewData, daily: DailyView | null, now = new Date()): OverviewTask[] {
  const dailyTasks = daily?.date === shanghaiDate(now) ? daily.plan?.tasks || [] : [];
  const linked = new Set(dailyTasks.map((task) => task.actionId).filter(Boolean));
  const tasks: OverviewTask[] = [];
  const add = (task: Omit<OverviewTask, "overdue" | "group">) => {
    const record = task.source === "action" ? data.actions?.find((row) => row.id === task.id) : task.source === "ai" ? data.aiTasks?.find((row) => row.id === task.id) : data.actions?.find((row) => row.id === dailyTasks.find((daily) => daily.id === task.id)?.actionId);
    const dailyTask = dailyTasks.find((item) => item.id === task.id);
    const sceneId = task.source === "daily" && dailyTask?.effectiveSceneId ? dailyTask.effectiveSceneId : resolveScene(record || dailyTask || { id: task.id }, data.goals || [], data.projects || [], data.strategy?.scenes || daily?.scenes || []).effectiveSceneId;
    const overdue = !["已完成", "完成"].includes(task.status) && deadlineTime(task.dueAt, task.dateOnly) < now.getTime();
    tasks.push({ ...task, recordCode: record?.recordCode, sceneId, overdue, group: classify(task.status, overdue) });
  };
  for (const action of data.actions || []) {
    if (linked.has(action.id) || ["已取消", "归档", "已归档"].includes(action.status || "")) continue;
    add({ key: `action:${action.id}`, id: action.id, title: action.title || "未命名行动", source: "action",
      status: action.status || "待开始", dueAt: action.dueDate || null, dateOnly: true, priority: 2,
      owner: "我", ...lineage(action, data), notes: action.purpose || "", standard: action.standard || "",
      progress: null, reason: "" });
  }
  for (const task of dailyTasks) {
    const action = data.actions?.find((item) => item.id === task.actionId);
    const failedStep = task.steps.find((step) => ["blocked", "failed"].includes(step.status));
    add({ key: `daily:${task.id}`, id: task.id, title: task.title, source: "daily",
      status: statusLabels[taskStatus(task.steps)] || "待执行", dueAt: task.dueAt, dateOnly: false,
      priority: task.priority, owner: laneLabels[task.lane], ...lineage({ id: task.id, goalId: task.affiliation?.goalId || action?.goalId, projectId: task.affiliation?.projectId || action?.projectId }, data),
      notes: task.notes, standard: action?.standard || "",
      progress: { done: task.steps.filter((step) => step.status === "done").length, total: task.steps.length },
      reason: failedStep?.blockedReason || failedStep?.runs.find((run) => run.status === "failed")?.error || "" });
  }
  for (const task of data.aiTasks || []) {
    if (["归档", "已归档", "已取消"].includes(task.status || "")) continue;
    add({ key: `ai:${task.id}`, id: task.id, title: task.title || "未命名 AI 任务", source: "ai",
      status: task.status || "草稿", dueAt: task.deadline || null, dateOnly: true, priority: 2,
      owner: task.aiRole || "AI", ...lineage(task, data), notes: task.instructions || "",
      standard: task.acceptanceCriteria || "", progress: null, reason: "" });
  }
  const rank: Record<TaskGroup, number> = { attention: 0, running: 1, pending: 2, done: 3 };
  return tasks.sort((a, b) => rank[a.group] - rank[b.group] || a.priority - b.priority ||
    deadlineTime(a.dueAt, a.dateOnly) - deadlineTime(b.dueAt, b.dateOnly) || a.title.localeCompare(b.title, "zh-CN"));
}

export function overviewCounts(tasks: OverviewTask[]) {
  return groupOrder.reduce((counts, group) => ({ ...counts, [group]: tasks.filter((task) => task.group === group).length }),
    { pending: 0, running: 0, attention: 0, done: 0 });
}

export function hasCurrentWeekReview(reviews: OverviewData["reviews"], now = new Date()) {
  const today = shanghaiDate(now);
  const monday = new Date(`${today}T12:00:00+08:00`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const weekStart = shanghaiDate(monday);
  return (reviews || []).some((review) => reviewPeriod(review) === "weekly" && review.periodStart.slice(0, 10) <= today && review.periodEnd.slice(0, 10) >= weekStart);
}
