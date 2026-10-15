import { z } from "zod";
import type { SceneRow } from "../scenes";
import { orchestrationSchema, workflowIssues } from "./workflow";
import { scheduleSchema } from "./scheduling";
import { affiliationSchema, type TaskAffiliation } from "./affiliation";
import { capabilitiesSchema, type AssetView } from "./assets-shared";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "日期无效");
const dateTime = z.string().datetime({ offset: true });
const note = z.string().max(20000).default("");
export const stepDraftSchema = z.object({
  title: z.string().trim().min(1).max(300), assignee: z.enum(["human", "ai"]),
  agentId: z.string().nullable().default(null), estimatedMinutes: z.number().int().min(1).max(1440),
  notes: note,
});
export const taskDraftSchema = z.object({
  title: z.string().trim().min(1).max(300), lane: z.enum(["A", "B", "mixed"]),
  priority: z.number().int().min(1).max(3).default(2), dueAt: dateTime.nullable().default(null),
  actionId: z.string().nullable().default(null), notes: note,
  sceneId: z.string().min(1).max(150).nullable().default(null),
  orchestration: orchestrationSchema.nullable().optional(),
  schedule: scheduleSchema.nullable().optional(),
  affiliation: affiliationSchema.optional(),
  steps: z.array(stepDraftSchema).min(3).max(5),
  checkpoints: z.array(z.object({ title: z.string().trim().min(1).max(300), dueAt: dateTime })).max(10).default([]),
}).superRefine((task, context) => {
  if (task.orchestration) {
    const issue = workflowIssues(task.steps, task.orchestration);
    if (issue) context.addIssue({ code: "custom", message: issue, path: ["orchestration"] });
  }
  const hasHuman = task.steps.some((step) => step.assignee === "human");
  const hasAI = task.steps.some((step) => step.assignee === "ai");
  if ((task.lane === "A" && hasAI) || (task.lane === "B" && hasHuman) || (task.lane === "mixed" && (!hasHuman || !hasAI)))
    context.addIssue({ code: "custom", message: "分类必须与步骤执行人一致", path: ["lane"] });
});
export const agentSchema = z.object({
  name: z.string().trim().min(1).max(100), role: z.string().trim().min(1).max(100),
  model: z.string().trim().max(150).default(""), prompt: z.string().trim().min(1).max(10000),
  enabled: z.boolean().default(true), timeoutSeconds: z.number().int().min(30).max(120).default(120),
  capabilities: capabilitiesSchema,
});
export type TaskDraft = z.infer<typeof taskDraftSchema>;
export type AgentDraft = Omit<z.infer<typeof agentSchema>, "capabilities"> & { capabilities?: string };
export const statusLabels: Record<string, string> = {
  pending: "待执行", preparing: "准备中", queued: "排队中", running: "执行中",
  paused: "已暂停", produced: "AI 已产出", review: "待验收", done: "已完成", blocked: "阻塞", failed: "失败", cancelled: "已取消",
};
export const laneLabels = { A: "A · 亲自执行", B: "B · AI 执行", mixed: "混合协同" };

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function reportIsDue(date: string, now = new Date()) {
  return new Date(`${date}T22:00:00+08:00`).getTime() <= now.getTime();
}
export function taskStatus(steps: Array<{ status: string }>) {
  if (!steps.length) return "pending";
  if (steps.every((step) => step.status === "done")) return "done";
  for (const status of ["blocked", "failed", "review", "running", "preparing", "queued", "paused"])
    if (steps.some((step) => step.status === status)) return status;
  return steps.every((step) => ["done", "produced"].includes(step.status)) ? "review" : "pending";
}

type OrderedTask = {
  steps: Array<{ status: string }>; priority: number; dueAt?: string | null;
  schedule?: { startsAt: string | null } | null;
  orchestration?: { importance: number } | null;
};
export function compareDailyTasks(a: OrderedTask, b: OrderedTask) {
  const time = (value?: string | null) => {
    const result = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(result) ? result : Infinity;
  };
  return Number(taskStatus(a.steps) === "done") - Number(taskStatus(b.steps) === "done") ||
    time(a.schedule?.startsAt) - time(b.schedule?.startsAt) ||
    (a.orchestration?.importance ?? a.priority) - (b.orchestration?.importance ?? b.priority) ||
    a.priority - b.priority || time(a.dueAt) - time(b.dueAt) || 0;
}
export function nextStep<T extends { status: string; position: number }>(steps: T[]) {
  return [...steps].sort((a, b) => a.position - b.position).find((step) => !["done", "produced"].includes(step.status));
}

export type TimerLike = { startedAt: Date | string; endedAt: Date | string | null };
export function timerSeconds(timers: TimerLike[], now = new Date()) {
  return Math.floor(timers.reduce((sum, timer) => sum + Math.max(0, (timer.endedAt ? new Date(timer.endedAt).getTime() : now.getTime()) - new Date(timer.startedAt).getTime()), 0) / 1000);
}
export type MetricTask = {
  title: string; lane: string; dueAt: Date | string | null; completedAt: Date | string | null;
  steps: Array<{ status: string; assignee: string; estimatedMinutes: number; blockedReason?: string; timers: TimerLike[];
    runs: Array<{ durationMs: number; promptTokens: number | null; completionTokens: number | null }> }>;
};
export function computeMetrics(tasks: MetricTask[], now = new Date()) {
  const completed = tasks.filter((task) => taskStatus(task.steps) === "done");
  const dueTasks = tasks.filter((task) => task.dueAt && (new Date(task.dueAt).getTime() <= now.getTime() || taskStatus(task.steps) === "done"));
  const onTime = dueTasks.filter((task) => task.completedAt && new Date(task.completedAt).getTime() <= new Date(task.dueAt!).getTime()).length;
  const blocked = tasks.filter((task) => task.steps.some((step) => step.blockedReason || step.status === "blocked")).length;
  const completionRate = tasks.length ? completed.length / tasks.length : 0;
  const punctualityRate = dueTasks.length ? onTime / dueTasks.length : null;
  const steps = tasks.flatMap((task) => task.steps);
  const runs = steps.flatMap((step) => step.runs);
  const weighted = tasks.length ? (completionRate * .6 + (punctualityRate ?? 0) * .25 + (1 - blocked / tasks.length) * .15) / (punctualityRate === null ? .75 : 1) : null;
  return {
    total: tasks.length, completed: completed.length, completionRate, punctualityRate,
    a: tasks.filter((task) => task.lane === "A").length, b: tasks.filter((task) => task.lane === "B").length,
    mixed: tasks.filter((task) => task.lane === "mixed").length,
    blocked: tasks.filter((task) => taskStatus(task.steps) === "blocked").length, blockedEver: blocked,
    remainingHumanMinutes: steps.filter((step) => step.assignee === "human" && step.status !== "done").reduce((sum, step) => sum + Math.max(0, step.estimatedMinutes - timerSeconds(step.timers, now) / 60), 0),
    humanSeconds: steps.reduce((sum, step) => sum + timerSeconds(step.timers, now), 0),
    aiSeconds: runs.reduce((sum, run) => sum + run.durationMs / 1000, 0),
    averageCompletionMinutes: completed.length ? completed.reduce((sum, task) => sum + task.steps.reduce((n, step) => n + timerSeconds(step.timers, now) / 60 + step.runs.reduce((r, run) => r + run.durationMs / 60000, 0), 0), 0) / completed.length : null,
    score: weighted === null ? null : Math.round(weighted * 100),
    leftovers: tasks.filter((task) => taskStatus(task.steps) !== "done").map((task) => ({ title: task.title, status: taskStatus(task.steps) })),
  };
}
export type Metrics = ReturnType<typeof computeMetrics>;
export const metricsSchema = z.object({
  total: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), completionRate: z.number().min(0).max(1),
  punctualityRate: z.number().min(0).max(1).nullable(), a: z.number().int().nonnegative(), b: z.number().int().nonnegative(), mixed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(), blockedEver: z.number().int().nonnegative(), remainingHumanMinutes: z.number().nonnegative(),
  humanSeconds: z.number().nonnegative(), aiSeconds: z.number().nonnegative(), averageCompletionMinutes: z.number().nonnegative().nullable(),
  score: z.number().int().min(0).max(100).nullable(), leftovers: z.array(z.object({ title: z.string(), status: z.string().refine((value) => value in statusLabels) })),
}).refine((data) => data.completed <= data.total && data.blocked <= data.total && data.blockedEver <= data.total && data.a + data.b + data.mixed === data.total, "日报统计数量不一致");
export function reportMarkdown(date: string, metrics: Metrics, reflection = "") {
  return `# ${date} 每日任务复盘\n\n- 完成：${metrics.completed}/${metrics.total}（${Math.round(metrics.completionRate * 100)}%）\n- 分类：A 线 ${metrics.a}，B 线 ${metrics.b}，混合 ${metrics.mixed}\n- 人工投入：${Math.round(metrics.humanSeconds / 60)} 分钟\n- AI 调用耗时：${Math.round(metrics.aiSeconds)} 秒\n- 平均完成投入：${metrics.averageCompletionMinutes === null ? "暂无" : `${metrics.averageCompletionMinutes.toFixed(1)} 分钟`}\n- 准时率：${metrics.punctualityRate === null ? "暂无适用任务" : `${Math.round(metrics.punctualityRate * 100)}%`}\n- 当前阻塞：${metrics.blocked}；曾阻塞：${metrics.blockedEver}\n- 效率得分：${metrics.score ?? "暂无"}\n\n## 遗留事项\n${metrics.leftovers.map((task) => `- ${task.title}（${statusLabels[task.status]}）`).join("\n") || "无"}\n\n## 我的复盘\n${reflection || "待填写"}\n`;
}

export type AgentView = AgentDraft & { id: string };
export type RunView = { id: string; status: string; attempt: number; input: string; config: string; output: string; error: string;
  durationMs: number; promptTokens: number | null; completionTokens: number | null; createdAt: string };
export type StepView = z.infer<typeof stepDraftSchema> & { id: string; position: number; status: string; result: string; blockedReason: string;
  timers: Array<{ id: string; startedAt: string; endedAt: string | null }>; runs: RunView[] };
export type TaskView = Omit<TaskDraft, "steps" | "checkpoints"> & { id: string; result: string; syncedAt: string | null;
  effectiveSceneId: string; sceneSource: string;
  affiliation: TaskAffiliation; goalName: string | null; projectName: string | null;
  completedAt: string | null; steps: StepView[]; checkpoints: Array<{ id: string; title: string; dueAt: string; done: boolean }> };
export type DailyView = {
  date: string; plan: { id: string; input: string; source: string; tasks: TaskView[];
    report: { markdown: string; reflection: string; generatedAt: string; metrics: string } | null } | null;
  agents: AgentView[]; metrics: Metrics; configured: boolean; heartbeat: string | null;
  assets: AssetView[];
  scenes: SceneRow[]; sceneCounts: Array<{ id: string; name: string; count: number }>;
  goals: Array<{ id: string; title: string; horizon: string; sceneId: string | null }>;
  projects: Array<{ id: string; name: string; goalId: string | null; sceneId: string | null; deadline?: string | null }>;
  actions: Array<{ id: string; title: string; status: string; estimatedHours: number; purpose: string; standard: string; dueDate: string | null; createdAt?: string; recurrence?: string; updatedAt: string; completedAt: string | null; effectiveSceneId: string; goalId: string | null; projectId: string | null }>;
};
