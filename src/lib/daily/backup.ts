import { z } from "zod";
import { agentSchema, dateSchema, metricsSchema } from "./shared";
import { PROFILE, planInclude, type DailyDB } from "./service";
import { orchestrationSchema, readOrchestration, workflowIssues } from "./workflow";
import { scheduleSchema } from "./scheduling";
import { affiliationSchema } from "./affiliation";
import { assetSchema, defaultToolIds, readBindings } from "./assets-shared";
import { initializeAssets } from "./assets";

const id = z.string().min(1).max(200);
const date = z.string().datetime({ offset: true });
const optionalDate = date.nullable();
const text = z.string().max(200000).default("");
const statuses = z.enum(["pending", "preparing", "queued", "running", "paused", "review", "produced", "done", "blocked", "failed", "cancelled"]);
const runSchema = z.object({
  id, attempt: z.number().int().min(1), status: statuses, input: text,
  config: z.string().max(200000).transform((value, context) => {
    try { return JSON.stringify(agentSchema.parse(JSON.parse(value))); }
    catch { context.addIssue({ code: "custom", message: "执行配置无效" }); return z.NEVER; }
  }), output: text, error: text, durationMs: z.number().int().min(0),
  promptTokens: z.number().int().min(0).nullable(), completionTokens: z.number().int().min(0).nullable(),
  createdAt: date, startedAt: optionalDate, finishedAt: optionalDate,
});
const stepSchema = z.object({
  id, position: z.number().int().min(0).max(4), title: z.string().min(1).max(300),
  assignee: z.enum(["human", "ai"]), agentId: id.nullable(), estimatedMinutes: z.number().int().min(1).max(1440),
  status: statuses, notes: text, result: text, blockedReason: text, attempt: z.number().int().min(0),
  currentRunId: id.nullable(), completedAt: optionalDate, updatedAt: date,
  runs: z.array(runSchema).max(1000),
  timers: z.array(z.object({ id, startedAt: date, endedAt: optionalDate })).max(10000),
});
export const dailyDataSchema = z.object({
  agents: z.array(agentSchema.extend({ id })).max(100),
  assets: z.array(assetSchema.and(z.object({ id, builtin: z.boolean().default(false) }))).max(1000).default([]),
  plans: z.array(z.object({
    id, date: dateSchema, input: text, source: z.string().max(200), createdAt: date, updatedAt: date,
    tasks: z.array(z.object({
      id, actionId: id.nullable(), title: z.string().min(1).max(300), lane: z.enum(["A", "B", "mixed"]), priority: z.number().int().min(1).max(3),
      sceneId: id.nullable().default(null),
      orchestration: z.string().max(30000).default("{}").superRefine((value, ctx) => {
        try {
          const parsed = JSON.parse(value);
          if (parsed.schedule !== undefined && parsed.schedule !== null) scheduleSchema.parse(parsed.schedule);
          if (parsed.affiliation !== undefined) affiliationSchema.parse(parsed.affiliation);
          const workflow = { ...parsed }; delete workflow.schedule; delete workflow.affiliation;
          if (Object.keys(workflow).length) orchestrationSchema.parse(workflow);
        }
        catch { ctx.addIssue({ code: "custom", message: "编排配置无效" }); }
      }),
      dueAt: optionalDate, notes: text, result: text, completedAt: optionalDate, syncedAt: optionalDate, createdAt: date, updatedAt: date,
      steps: z.array(stepSchema).min(3).max(5),
      checkpoints: z.array(z.object({ id, title: z.string().min(1).max(300), dueAt: date, done: z.boolean() })).max(10),
    })).max(1000),
    report: z.object({ id, metrics: z.string().max(200000), markdown: text, reflection: text, generatedAt: date }).nullable(),
  })).max(10000),
}).superRefine((data, context) => {
  const ids = new Set<string>();
  const add = (value: string) => {
    if (ids.has(value)) context.addIssue({ code: "custom", message: "备份含重复记录 ID" });
    ids.add(value);
  };
  const agents = new Set(data.agents.map((agent) => agent.id));
  data.agents.forEach((agent) => add(agent.id));
  data.assets.forEach((asset) => add(asset.id));
  for (const agent of data.agents) {
    const bindings = readBindings(agent.capabilities);
    for (const [kind, selected] of [["tool", bindings.toolIds], ["skill", bindings.skillIds]] as const) {
      if (selected.some((id) => !data.assets.some((asset) => asset.id === id && asset.kind === kind) && !(kind === "tool" && !data.assets.length && defaultToolIds.includes(id)))) context.addIssue({ code: "custom", message: "备份 Agent 绑定的资源缺失或类型不符" });
    }
  }
  const dates = new Set<string>();
  for (const plan of data.plans) {
    add(plan.id);
    if (dates.has(plan.date)) context.addIssue({ code: "custom", message: "备份日期重复" });
    dates.add(plan.date);
    const actions = new Set<string>();
    for (const task of plan.tasks) {
      add(task.id);
      const orchestration = readOrchestration(task.orchestration);
      if (orchestration) { const issue = workflowIssues([...task.steps].sort((a, b) => a.position - b.position), orchestration); if (issue) context.addIssue({ code: "custom", message: issue }); }
      if (task.steps.some((step) => step.status === "produced" && (!orchestration || orchestration.steps[step.position]?.reviewRequired || step.assignee !== "ai"))) context.addIssue({ code: "custom", message: "中间产出必须属于已配置的 AI 自动衔接步骤" });
      if (task.actionId) {
        if (actions.has(task.actionId)) context.addIssue({ code: "custom", message: "同一天重复关联行动" });
        actions.add(task.actionId);
      }
      const positions = task.steps.map((step) => step.position).sort();
      if (positions.some((position, index) => position !== index)) context.addIssue({ code: "custom", message: "步骤顺序无效" });
      const human = task.steps.some((step) => step.assignee === "human");
      const ai = task.steps.some((step) => step.assignee === "ai");
      if ((task.lane === "A" && ai) || (task.lane === "B" && human) || (task.lane === "mixed" && (!human || !ai))) context.addIssue({ code: "custom", message: "任务分类无效" });
      for (const step of task.steps) {
        add(step.id);
        if (step.agentId && !agents.has(step.agentId)) context.addIssue({ code: "custom", message: "备份引用未知 Agent" });
        const attempts = new Set<number>();
        for (const run of step.runs) {
          add(run.id);
          if (attempts.has(run.attempt) || run.attempt > step.attempt) context.addIssue({ code: "custom", message: "执行次数无效" });
          attempts.add(run.attempt);
        }
        if (step.currentRunId && !step.runs.some((run) => run.id === step.currentRunId)) context.addIssue({ code: "custom", message: "当前执行引用无效" });
        for (const timer of step.timers) {
          add(timer.id);
          if (timer.endedAt && new Date(timer.endedAt) < new Date(timer.startedAt)) context.addIssue({ code: "custom", message: "计时记录无效" });
        }
      }
      task.checkpoints.forEach((checkpoint) => add(checkpoint.id));
    }
    if (plan.report) {
      add(plan.report.id);
      try { metricsSchema.parse(JSON.parse(plan.report.metrics)); } catch { context.addIssue({ code: "custom", message: "报告统计无效" }); }
    }
  }
});
export const moduleBackupSchema = z.object({ format: z.literal("daily-collaboration-backup"), version: z.literal(1), exportedAt: date, data: dailyDataSchema });
export type DailyBackupData = Omit<z.infer<typeof dailyDataSchema>, "assets"> & { assets?: z.infer<typeof dailyDataSchema>["assets"] };

export async function exportDaily(db: DailyDB) {
  const [agents, plans, assets] = await Promise.all([
    db.dailyAgent.findMany({ where: { profileId: PROFILE } }),
    db.dailyPlan.findMany({ where: { profileId: PROFILE }, include: planInclude }),
    db.dailyAsset.findMany({ where: { profileId: PROFILE } }),
  ]);
  return dailyDataSchema.parse(JSON.parse(JSON.stringify({ agents, plans, assets })));
}
const toDate = (value: string | null) => value ? new Date(value) : null;
export function restoredStatus(status: string) { return ["queued", "running", "preparing"].includes(status) ? "paused" : status; }
export async function restoreDaily(db: DailyDB, data: DailyBackupData, exportedAt = new Date().toISOString()) {
  const scenes = new Set((await db.workbenchScene.findMany({ where: { profileId: PROFILE }, select: { id: true } })).map((scene) => scene.id));
  if (data.plans.some((plan) => plan.tasks.some((task) => task.sceneId && !scenes.has(task.sceneId)))) throw new Error("备份任务场景不存在，请先恢复完整备份或场景配置");
  await db.dailyPlan.deleteMany({ where: { profileId: PROFILE } });
  await db.dailyAgent.deleteMany({ where: { profileId: PROFILE } });
  await db.dailyAsset.deleteMany({ where: { profileId: PROFILE } });
  for (const asset of data.assets || []) await db.dailyAsset.create({ data: { ...asset, profileId: PROFILE } });
  await initializeAssets(db);
  for (const agent of data.agents) await db.dailyAgent.create({ data: { ...agent, profileId: PROFILE } });
  const actions = new Set((await db.action.findMany({ where: { profileId: PROFILE }, select: { id: true } })).map((action) => action.id));
  for (const { tasks, report, ...plan } of data.plans) {
    await db.dailyPlan.create({ data: { ...plan, profileId: PROFILE, createdAt: new Date(plan.createdAt), updatedAt: new Date(plan.updatedAt) } });
    for (const { steps, checkpoints, ...task } of tasks) {
      await db.dailyTask.create({ data: { ...task, sceneId: task.actionId && actions.has(task.actionId) ? null : task.sceneId, planId: plan.id, actionId: task.actionId && actions.has(task.actionId) ? task.actionId : null,
        dueAt: toDate(task.dueAt), completedAt: toDate(task.completedAt), syncedAt: toDate(task.syncedAt), createdAt: new Date(task.createdAt), updatedAt: new Date(task.updatedAt) } });
      for (const { runs, timers, ...step } of steps) {
        await db.dailyStep.create({ data: { ...step, taskId: task.id, status: readOrchestration(task.orchestration) && step.status === "pending" ? "paused" : restoredStatus(step.status),
          completedAt: toDate(step.completedAt), updatedAt: new Date(step.updatedAt) } });
        for (const run of runs) await db.dailyRun.create({ data: { ...run, stepId: step.id, status: restoredStatus(run.status),
          createdAt: new Date(run.createdAt), startedAt: toDate(run.startedAt), finishedAt: toDate(run.finishedAt) } });
        for (const timer of timers) await db.dailyTimer.create({ data: { ...timer, stepId: step.id, startedAt: new Date(timer.startedAt),
          endedAt: toDate(timer.endedAt) || new Date(Math.max(new Date(timer.startedAt).getTime(), new Date(exportedAt).getTime())) } });
      }
      for (const checkpoint of checkpoints) await db.dailyCheckpoint.create({ data: { ...checkpoint, taskId: task.id, dueAt: new Date(checkpoint.dueAt) } });
    }
    if (report) await db.dailyReport.create({ data: { ...report, planId: plan.id, generatedAt: new Date(report.generatedAt) } });
  }
}
