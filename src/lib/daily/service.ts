import type { Prisma, PrismaClient } from "@prisma/client";
import { agentSchema, computeMetrics, nextStep, reportMarkdown, shanghaiDate, taskStatus, timerSeconds, type AgentDraft, type DailyView, type TaskDraft } from "./shared";
import { type AIConfig, rulePlan } from "./provider";
import { initializeScenes, validateScene } from "../strategy/service";
import { resolveScene } from "../scenes";
import { assertExecutionReady } from "../execution-plan/guard";
import { dependencies, readOrchestration, readySteps, stepReady } from "./workflow";
import { writeTransaction } from "../database-writes";
import { arrangeTimes, assertTimeFree, readSchedule, reservationsFor, withSchedule, type TaskSchedule } from "./scheduling";
import { isStandaloneTemporary, readAffiliation, withAffiliation, type TaskAffiliation } from "./affiliation";
import { validateNestedLinks } from "../strategy/entity";
import { agentSnapshot, boundAssets, initializeAssets } from "./assets";
import { isRecurring, recurrenceDates, recurrenceDueAt } from "../recurring-tasks";

export const PROFILE = "local-profile";
export type DailyDB = PrismaClient | Prisma.TransactionClient;
export const taskInclude = { steps: { orderBy: { position: "asc" as const }, include: { timers: true, runs: { orderBy: { attempt: "desc" as const } } } }, checkpoints: true };
export const planInclude = { tasks: { orderBy: [{ priority: "asc" as const }, { createdAt: "asc" as const }], include: taskInclude }, report: true };
const defaults = [
  { key: "writing", name: "写作 Agent", prompt: "你是写作助手。根据给定任务与资料产出可验收的中文文本。区分事实和建议，不编造来源。" },
  { key: "coding", name: "编码建议 Agent", prompt: "你是编程助手。根据给定任务产出代码建议和验证方法。你没有代码执行权限，不得声称已修改文件或运行测试。" },
  { key: "research", name: "资料整理 Agent", prompt: "你是资料整理助手。仅分析输入提供的资料，给出结构化结论与信息缺口。你没有联网工具，不得虚构检索或来源。" },
];

export async function initializeDaily(db: DailyDB) {
  if (!(await db.profile.findUnique({ where: { id: PROFILE }, select: { id: true } })))
    await db.profile.upsert({ where: { id: PROFILE }, create: { id: PROFILE, aiInstruction: { create: {} } }, update: {} });
  if (!(await db.dailyControl.findUnique({ where: { profileId: PROFILE } })))
    await db.dailyControl.upsert({ where: { profileId: PROFILE }, create: { profileId: PROFILE }, update: {} });
  const existing = new Set((await db.dailyAgent.findMany({ where: { profileId: PROFILE }, select: { id: true } })).map((agent) => agent.id));
  for (const agent of defaults.filter((agent) => !existing.has(`daily-${agent.key}`))) await db.dailyAgent.upsert({ where: { id: `daily-${agent.key}` },
    create: { id: `daily-${agent.key}`, profileId: PROFILE, name: agent.name, role: agent.key, prompt: agent.prompt }, update: {} });
  await initializeAssets(db);
}

// The same database lock gates API mutations, backup replacement and scheduler claims.
export async function withDailyLock<T>(db: DailyDB, callback: () => Promise<T>, requireIdle = false): Promise<T> {
  await db.dailyControl.upsert({ where: { profileId: PROFILE }, create: { profileId: PROFILE }, update: {} });
  await db.dailyControl.updateMany({ where: { profileId: PROFILE, maintenance: true, maintenanceUntil: { lt: new Date() } }, data: { maintenance: false, maintenanceToken: null } });
  const token = crypto.randomUUID();
  const acquired = await db.dailyControl.updateMany({ where: { profileId: PROFILE, maintenance: false },
    data: { maintenance: true, maintenanceToken: token, maintenanceUntil: new Date(Date.now() + 600000) } });
  if (!acquired.count) throw new Error("任务数据正在更新，请稍后重试");
  try {
    if (requireIdle && (await db.executionPlan.count({ where: { profileId: PROFILE, leaseUntil: { gt: new Date() } } }) || await db.researchBatch.count({ where: { profileId: PROFILE, slot: { not: null } } }) || await db.dailyRun.count({ where: { slot: { not: null } } }) || await db.dailyStep.count({ where: { task: { plan: { profileId: PROFILE } }, status: { in: ["running", "preparing"] } } })))
      throw new Error("存在运行中任务，请暂停人工任务并等待 AI 执行结束后再导入");
    return await callback();
  } finally {
    await db.dailyControl.updateMany({ where: { profileId: PROFILE, maintenanceToken: token }, data: { maintenance: false, maintenanceToken: null, maintenanceUntil: null } });
  }
}

export async function getDailyView(db: DailyDB, date: string, config: AIConfig): Promise<DailyView> {
  await initializeDaily(db);
  await initializeScenes(db);
  const [plan, agents, control, actions] = await Promise.all([
    db.dailyPlan.findUnique({ where: { profileId_date: { profileId: PROFILE, date } }, include: planInclude }),
    db.dailyAgent.findMany({ where: { profileId: PROFILE }, orderBy: { id: "asc" } }),
    db.dailyControl.findUnique({ where: { profileId: PROFILE } }),
    db.action.findMany({ where: { profileId: PROFILE }, orderBy: { updatedAt: "desc" } }),
  ]);
  const [scenes, goals, projects] = await Promise.all([db.workbenchScene.findMany({ where: { profileId: PROFILE }, orderBy: { position: "asc" } }), db.goal.findMany({ where: { profileId: PROFILE } }), db.project.findMany({ where: { profileId: PROFILE } })]);
  const tasks = plan?.tasks.map((task) => {
    const action = actions.find((action) => action.id === task.actionId);
    const stored = readAffiliation(task.orchestration);
    const project = projects.find((row) => row.id === (action ? action.projectId : stored?.projectId));
    const goal = goals.find((row) => row.id === (project?.goalId || (action ? action.goalId : stored?.goalId)));
    const affiliation: TaskAffiliation = { kind: stored?.kind || (task.actionId ? "planned" : "temporary"), goalId: goal?.id || null, projectId: project?.id || null };
    return { ...task, affiliation, goalName: goal?.title || null, projectName: project?.name || null, schedule: readSchedule(task.orchestration), orchestration: readOrchestration(task.orchestration), ...resolveScene(action || { ...task, ...affiliation }, goals, projects, scenes) };
  }) || [];
  const assets = await db.dailyAsset.findMany({ where: { profileId: PROFILE }, orderBy: [{ kind: "asc" }, { id: "asc" }] });
  return JSON.parse(JSON.stringify({ date, plan: plan ? { ...plan, tasks } : null, agents, assets, scenes,
    goals: goals.map(({ id, title, horizon, sceneId }) => ({ id, title, horizon, sceneId })), projects: projects.map(({ id, name, goalId, sceneId, deadline }) => ({ id, name, goalId, sceneId, deadline })),
    sceneCounts: scenes.map((scene) => ({ id: scene.id, name: scene.name, count: tasks.filter((task) => task.effectiveSceneId === scene.id).length })),
    actions: actions.map((action) => ({ ...action, goalId: projects.find((project) => project.id === action.projectId)?.goalId || action.goalId, ...resolveScene(action, goals, projects, scenes) })), heartbeat: control?.heartbeat || null,
    configured: Boolean(config.apiKey), metrics: computeMetrics(plan?.tasks || []) })) as DailyView;
}

export async function saveTasks(db: DailyDB, date: string, drafts: TaskDraft[], input: string, source: string, requestId?: string) {
  const key = requestId ? `${PROFILE}:daily-save:${requestId}` : null;
  const fingerprint = JSON.stringify({ date, drafts, input, source });
  if (key) {
    const previous = await db.goalBatch.findUnique({ where: { id: key } });
    if (previous) {
      const receipt = JSON.parse(previous.payload);
      if (receipt.fingerprint !== fingerprint) throw new Error("重复请求内容已变化，请重新确认编排");
      const existing = await db.dailyTask.count({ where: { id: { in: receipt.taskIds }, plan: { profileId: PROFILE } } });
      if (existing !== receipt.taskIds.length) throw new Error("此前保存的任务已删除或恢复，请重新编排确认");
      return { saved: receipt.taskIds.length, taskIds: receipt.taskIds as string[], duplicate: true };
    }
  }
  for (const draft of drafts) { await validateScene(db, draft.sceneId); if (draft.affiliation) await validateAffiliation(db, draft.affiliation, !isStandaloneTemporary(draft)); }
  assertTimeFree(drafts, await timeReservations(db));
  const agentIds = drafts.flatMap((task) => task.steps.filter((step) => step.assignee === "ai").map((step) => step.agentId));
  const agents = await db.dailyAgent.findMany({ where: { profileId: PROFILE, enabled: true } });
  if (agentIds.some((id) => !id || !agents.some((agent) => agent.id === id))) throw new Error("请为每个 AI 步骤选择已启用的 Agent");
  const previousPlan = await db.dailyPlan.findUnique({ where: { profileId_date: { profileId: PROFILE, date } }, include: { tasks: { select: { actionId: true } } } });
  const usedActions = new Set(previousPlan?.tasks.map((task) => task.actionId).filter(Boolean));
  const selected: TaskDraft[] = [];
  for (let draft of drafts) {
    if (draft.actionId) {
      const action = await db.action.findFirst({ where: { id: draft.actionId, profileId: PROFILE } });
      if (!action) throw new Error("关联行动不存在");
      if (usedActions.has(draft.actionId)) continue;
      if (isRecurring(action)) {
        if (action.completedAt || ["已完成", "已取消", "已归档"].includes(action.status) || !recurrenceDates(action, date, date).length) throw new Error("该周期任务在所选日期无待执行安排");
        if (draft.dueAt && shanghaiDate(new Date(draft.dueAt)) !== date) throw new Error("周期任务的本次交付时间须在所选日期内");
        draft = { ...draft, dueAt: draft.dueAt || recurrenceDueAt(date) };
      }
      usedActions.add(action.id);
    }
    selected.push(draft);
  }
  const write = async (tx: DailyDB) => {
    const plan = await tx.dailyPlan.upsert({ where: { profileId_date: { profileId: PROFILE, date } },
      create: { profileId: PROFILE, date, input, source }, update: { ...(input ? { input } : {}), source } });
    const taskIds: string[] = [];
    for (const draft of selected) {
      const { steps, checkpoints, orchestration, affiliation, ...task } = draft;
      const { schedule, ...fields } = task;
      if (task.actionId && affiliation) {
        const action = await db.action.findFirstOrThrow({ where: { id: task.actionId, profileId: PROFILE } });
        await validateNestedLinks(db, "action", { ...action, goalId: affiliation.goalId, projectId: affiliation.projectId });
        await tx.action.update({ where: { id: task.actionId }, data: { goalId: affiliation.goalId, projectId: affiliation.projectId } });
      }
      const row = await tx.dailyTask.create({ data: { ...fields, orchestration: withAffiliation(withSchedule(orchestration, schedule), affiliation || (task.actionId ? { kind: "planned", goalId: null, projectId: null } : undefined)), sceneId: task.actionId ? null : task.sceneId, dueAt: task.dueAt ? new Date(task.dueAt) : null, planId: plan.id } });
      taskIds.push(row.id);
      for (const [position, step] of steps.entries()) await tx.dailyStep.create({ data: { ...step, agentId: step.assignee === "ai" ? step.agentId : null, position, taskId: row.id } });
      for (const checkpoint of checkpoints) await tx.dailyCheckpoint.create({ data: { ...checkpoint, dueAt: new Date(checkpoint.dueAt), taskId: row.id } });
    }
    if (key) await tx.goalBatch.create({ data: { id: key, profileId: PROFILE, payload: JSON.stringify({ fingerprint, taskIds }) } });
    return { saved: taskIds.length, taskIds };
  };
  return "$transaction" in db ? writeTransaction(db as PrismaClient, write) : write(db);
}
export async function importActions(db: DailyDB, date: string, actionIds: string[]) {
  const actions = await db.action.findMany({ where: { id: { in: actionIds }, profileId: PROFILE } });
  if (actions.length !== new Set(actionIds).size) throw new Error("所选行动不存在");
  const agents = await db.dailyAgent.findMany({ where: { profileId: PROFILE, enabled: true } });
  const drafts: TaskDraft[] = actions.map((action) => {
    const task = rulePlan(action.title.replace(/[\n；;]/g, " "), date, agents)[0];
    task.title = action.title; task.actionId = action.id; task.notes = `${action.purpose}\n完成标准：${action.standard}`;
    task.dueAt = isRecurring(action) ? recurrenceDueAt(date) : action.dueDate?.toISOString() || null;
    task.steps = task.steps.map((step) => ({ ...step, notes: task.notes, estimatedMinutes: step.assignee === "human" && action.estimatedHours ? Math.max(1, Math.min(1440, Math.round(action.estimatedHours * 60))) : step.estimatedMinutes }));
    if (task.orchestration && action.standard) { task.orchestration.output = action.standard; task.orchestration.steps[task.steps.length - 1].standard = action.standard; }
    return task;
  });
  return saveTasks(db, date, drafts, "", "已有行动");
}
export async function ownTask(db: DailyDB, id: string) {
  const task = await db.dailyTask.findFirst({ where: { id, plan: { profileId: PROFILE } }, include: { ...taskInclude, plan: true } });
  if (!task) throw new Error("任务不存在");
  return task;
}
export async function ownStep(db: DailyDB, id: string) {
  const step = await db.dailyStep.findFirst({ where: { id, task: { plan: { profileId: PROFILE } } }, include: { task: { include: taskInclude }, agent: true } });
  if (!step) throw new Error("步骤不存在");
  if (!stepReady(step.task, step.position)) throw new Error("请先完成前面的步骤或所需前置验收");
  return step;
}

export async function startStep(db: DailyDB, id: string, config: AIConfig) {
  const step = await ownStep(db, id);
  if (["running", "queued", "preparing", "review"].includes(step.status)) return { alreadyStarted: true };
  if (!["pending", "paused", "failed"].includes(step.status)) throw new Error("请先解除阻塞再启动");
  if (step.task.actionId) await assertExecutionReady(db, step.task.actionId, undefined, step.task.steps.some(previous => previous.status === "done"));
  if (step.assignee === "human") {
    const changed = await db.dailyStep.updateMany({ where: { id, status: step.status }, data: { status: "running" } });
    if (changed.count) await db.dailyTimer.create({ data: { stepId: id, startedAt: new Date() } });
    return { started: Boolean(changed.count) };
  }
  if (!config.apiKey) throw new Error("未配置服务端 AI，任务尚未启动");
  if (!step.agent?.enabled) throw new Error("此步骤的 Agent 未配置或已停用");
  const snapshot = agentSchema.parse(await agentSnapshot(db, step.agent));
  const useMaterials = JSON.parse(snapshot.capabilities).snapshot.some((asset: { adapter: string }) => asset.adapter === "task-context");
  const runId = crypto.randomUUID();
  const changed = await db.dailyStep.updateMany({ where: { id, status: step.status, attempt: step.attempt },
    data: { status: "preparing", attempt: { increment: 1 }, currentRunId: runId } });
  if (!changed.count) return { alreadyStarted: true };
  try {
    const plan = readOrchestration(step.task.orchestration);
    const input = JSON.stringify({ task: step.task.title, expectedOutput: plan?.output || "", taskNotes: step.task.notes, selectedMaterials: useMaterials ? step.notes : "", currentStep: step.title,
      kind: plan?.steps[step.position]?.kind || "produce", standard: plan?.steps[step.position]?.standard || step.notes,
      previousResults: useMaterials ? step.task.steps.filter((item) => dependencies(step.task, step.position).includes(item.position)).map((item) => ({ title: item.title, result: item.result, verified: item.status === "done" })) : [], revision: step.blockedReason });
    await db.dailyRun.create({ data: { id: runId, stepId: id, attempt: step.attempt + 1, input,
      config: JSON.stringify(snapshot) } });
    await db.dailyStep.updateMany({ where: { id, currentRunId: runId, status: "preparing" }, data: { status: "queued" } });
    return { queued: true };
  } catch (error) {
    await db.dailyStep.updateMany({ where: { id, currentRunId: runId }, data: { status: "failed", blockedReason: "入队失败，请重试" } });
    throw error;
  }
}
export async function startTask(db: DailyDB, taskId: string, config: AIConfig, aiOnly = false) {
  const task = await ownTask(db, taskId);
  if (readOrchestration(task.orchestration)) {
    const available = readySteps(task) as typeof task.steps;
    const steps = available.filter((step) => !aiOnly || step.assignee === "ai");
    if (!steps.length) return { completed: task.steps.every((step) => step.status === "done"), needsConfirmation: true };
    for (const step of steps) await startStep(db, step.id, config);
    return { started: steps.length };
  }
  const step = nextStep(task.steps);
  if (aiOnly && step?.assignee === "human") return { needsConfirmation: true };
  return step ? startStep(db, step.id, config) : { completed: true };
}
async function stopTimers(db: DailyDB, stepId: string) {
  await db.dailyTimer.updateMany({ where: { stepId, endedAt: null }, data: { endedAt: new Date() } });
}
export async function pauseStep(db: DailyDB, id: string) {
  const step = await ownStep(db, id);
  if (step.assignee !== "human" || step.status !== "running") throw new Error("只能暂停正在执行的人工步骤");
  await stopTimers(db, id);
  await db.dailyStep.update({ where: { id }, data: { status: "paused" } });
}
export async function finishStep(db: DailyDB, id: string, result: string, config: AIConfig, accept = false) {
  const step = await ownStep(db, id);
  if (step.task.actionId) await assertExecutionReady(db, step.task.actionId, undefined, true);
  if (step.assignee === "ai" ? !accept || step.status !== "review" : accept || !["running", "paused"].includes(step.status))
    throw new Error("当前步骤不能完成或验收");
  await stopTimers(db, id);
  if (readOrchestration(step.task.orchestration)) {
    const completesTask = step.task.steps.every((item) => item.id === id || ["done", "produced"].includes(item.status));
    await writeTransaction(db as PrismaClient, async (tx) => {
      await tx.dailyStep.update({ where: { id }, data: { status: "done", result: result || step.result, completedAt: new Date() } });
      if (completesTask) {
        for (const intermediate of step.task.steps.filter((item) => item.status === "produced")) await tx.dailyStep.update({ where: { id: intermediate.id }, data: { status: "done", completedAt: new Date() } });
        await tx.dailyTask.update({ where: { id: step.taskId }, data: { completedAt: new Date(), result: result || step.result } });
      }
    });
    if (!completesTask) {
      const task = await ownTask(db, step.taskId);
      for (const next of readySteps(task).filter((item) => item.assignee === "ai" && item.status === "pending")) {
        try { await startStep(db, next.id, config); } catch (error) { return { warning: error instanceof Error ? error.message : "后续 AI 步骤未启动" }; }
      }
    }
    return { ok: true };
  }
  await db.dailyStep.update({ where: { id }, data: { status: "done", result: result || step.result, completedAt: new Date() } });
  const task = await ownTask(db, step.taskId);
  const next = nextStep(task.steps);
  if (!next) await db.dailyTask.update({ where: { id: task.id }, data: { completedAt: new Date(), result: result || step.result } });
  else if (next.assignee === "ai") {
    // Completing a step authorizes the next AI step in the same sequential task.
    try { await startStep(db, next.id, config); } catch (error) { return { warning: error instanceof Error ? error.message : "下一步未启动" }; }
  }
  return { ok: true };
}
export async function rejectStep(db: DailyDB, id: string, reason: string, config: AIConfig) {
  const step = await ownStep(db, id);
  if (step.status !== "review" || step.assignee !== "ai") throw new Error("只能退回待验收的 AI 结果");
  await db.dailyStep.update({ where: { id }, data: { status: "failed", blockedReason: reason } });
  return startStep(db, id, config);
}
export async function blockStep(db: DailyDB, id: string, reason: string) {
  await ownStep(db, id);
  await stopTimers(db, id);
  // A cancelled call may finish upstream, but its token can no longer write a result.
  await db.dailyRun.updateMany({ where: { stepId: id, status: "queued" }, data: { status: "cancelled", finishedAt: new Date() } });
  await db.dailyRun.updateMany({ where: { stepId: id, status: "running" }, data: { status: "cancelled" } });
  await db.dailyStep.update({ where: { id }, data: { status: "blocked", blockedReason: reason, currentRunId: null } });
}
export async function unblockStep(db: DailyDB, id: string) {
  const step = await ownStep(db, id);
  if (step.status !== "blocked") throw new Error("步骤没有阻塞");
  await db.dailyStep.update({ where: { id }, data: { status: "paused" } });
}
export async function saveAgent(db: DailyDB, data: AgentDraft, id?: string) {
  const parsed = agentSchema.parse(data);
  const { bindings } = await boundAssets(db, parsed.capabilities);
  const stored = { ...parsed, capabilities: JSON.stringify({ toolIds: bindings.toolIds, skillIds: bindings.skillIds }) };
  if (!id) return db.dailyAgent.create({ data: { ...stored, profileId: PROFILE } });
  if (!(await db.dailyAgent.findFirst({ where: { id, profileId: PROFILE } }))) throw new Error("Agent 不存在");
  return db.dailyAgent.update({ where: { id }, data: stored });
}
export function canReplan(task: Awaited<ReturnType<typeof ownTask>>) {
  return !task.completedAt && task.steps.every((step) => ["pending", "queued", "paused", "failed"].includes(step.status) && !step.timers.length && step.runs.every((run) => run.status === "queued" && !run.startedAt && !run.slot));
}
export async function replanTask(db: DailyDB, id: string, updatedAt: string, draft: TaskDraft) {
  const task = await ownTask(db, id);
  if (task.updatedAt.toISOString() !== updatedAt) throw new Error("任务已变化，请重新编排");
  if (!canReplan(task)) throw new Error("已执行的任务保留步骤和历史，请编排下一阶段任务");
  await validateScene(db, draft.sceneId);
  const agents = await db.dailyAgent.findMany({ where: { profileId: PROFILE, enabled: true } });
  if (draft.steps.some((step) => step.assignee === "ai" && !agents.some((agent) => agent.id === step.agentId))) throw new Error("请选择启用的 Agent");
  if (draft.actionId !== task.actionId) throw new Error("重新编排不能更换原行动");
  if (task.actionId) {
    const action = await db.action.findFirst({ where: { id: task.actionId, profileId: PROFILE } });
    if (!action) throw new Error("关联行动不存在或不属于当前档案");
    if (isRecurring(action)) {
      if (draft.dueAt && shanghaiDate(new Date(draft.dueAt)) !== task.plan.date) throw new Error("周期任务的本次交付时间须在所选日期内");
      draft = { ...draft, dueAt: draft.dueAt || recurrenceDueAt(task.plan.date) };
    }
  }
  if (draft.affiliation) await validateAffiliation(db, draft.affiliation, !isStandaloneTemporary(draft));
  assertTimeFree([draft], await timeReservations(db, [id]));
  return writeTransaction(db as PrismaClient, async (tx) => {
    await tx.dailyStep.deleteMany({ where: { taskId: id } });
    await tx.dailyCheckpoint.deleteMany({ where: { taskId: id } });
    if (task.actionId && draft.affiliation) {
      const action = await db.action.findFirstOrThrow({ where: { id: task.actionId, profileId: PROFILE } });
      await validateNestedLinks(db, "action", { ...action, goalId: draft.affiliation.goalId, projectId: draft.affiliation.projectId });
      await tx.action.update({ where: { id: task.actionId }, data: { goalId: draft.affiliation.goalId, projectId: draft.affiliation.projectId } });
    }
    await tx.dailyTask.update({ where: { id }, data: { title: draft.title, lane: draft.lane, notes: draft.notes, priority: draft.priority, dueAt: draft.dueAt ? new Date(draft.dueAt) : null, orchestration: withAffiliation(withSchedule(draft.orchestration, draft.schedule), draft.affiliation || readAffiliation(task.orchestration) || undefined), ...(!task.actionId ? { sceneId: draft.sceneId } : {}) } });
    for (const [position, step] of draft.steps.entries()) await tx.dailyStep.create({ data: { ...step, taskId: id, position, agentId: step.assignee === "ai" ? step.agentId : null } });
    for (const checkpoint of draft.checkpoints) await tx.dailyCheckpoint.create({ data: { ...checkpoint, taskId: id, dueAt: new Date(checkpoint.dueAt) } });
    return { saved: 1, taskIds: [id] };
  });
}
export async function syncAction(db: DailyDB, taskId: string) {
  const task = await ownTask(db, taskId);
  if (task.actionId) await assertExecutionReady(db, task.actionId, undefined, true);
  if (!task.actionId || taskStatus(task.steps) !== "done") throw new Error("只有已完成且关联行动的任务可以同步");
  await writeTransaction(db as PrismaClient, async (tx) => {
    const [action] = await tx.action.findMany({ where: { id: task.actionId!, profileId: PROFILE }, take: 1 });
    if (!action) throw new Error("关联行动不存在");
    if (!isRecurring(action)) await tx.action.update({ where: { id: action.id }, data: { status: "已完成", completedAt: task.completedAt || new Date() } });
    await tx.dailyTask.update({ where: { id: taskId }, data: { syncedAt: new Date() } });
  });
}

export type TimeProposal = { id: string; title: string; updatedAt: string; schedule: TaskSchedule };
export async function validateAffiliation(db: DailyDB, affiliation: TaskAffiliation, required = true) {
  if (required && (!affiliation.goalId || !affiliation.projectId)) throw new Error("请选择所属目标和项目");
  const [goal, project] = await Promise.all([
    affiliation.goalId ? db.goal.findFirst({ where: { id: affiliation.goalId, profileId: PROFILE } }) : null,
    affiliation.projectId ? db.project.findFirst({ where: { id: affiliation.projectId, profileId: PROFILE } }) : null,
  ]);
  if (affiliation.goalId && !goal || affiliation.projectId && !project) throw new Error("目标或项目不存在，或不属于当前档案");
  if (project?.goalId && project.goalId !== affiliation.goalId) throw new Error("所选项目不属于该目标，请重新选择");
  return { goal, project };
}
export function canSchedule(task: { completedAt: Date | string | null; steps: Array<{ status: string }> }) {
  return !task.completedAt && !task.steps.every((step) => step.status === "done") && !task.steps.some((step) => ["running", "preparing", "queued"].includes(step.status));
}
export async function timeReservations(db: DailyDB, excludeIds: string[] = []) {
  const rows = await db.dailyTask.findMany({ where: { plan: { profileId: PROFILE }, completedAt: null, id: { notIn: excludeIds } }, include: taskInclude });
  const now = new Date();
  const active = rows.flatMap((row) => {
    const human = row.steps.filter((step) => step.assignee === "human" && step.status === "running");
    if (!human.length) return [];
    const remaining = Math.max(15, ...human.map((step) => step.estimatedMinutes - timerSeconds(step.timers, now) / 60));
    return [{ startsAt: now.toISOString(), endsAt: new Date(now.getTime() + (remaining + 10) * 60000).toISOString() }];
  });
  return [...reservationsFor(rows.filter((row) => !row.steps.every((step) => step.status === "done")).map((row) => ({ ...row, schedule: readSchedule(row.orchestration) }))), ...active];
}
export async function proposeTimes(db: DailyDB, date: string, sceneId: string | null = null) {
  await validateScene(db, sceneId);
  const view = await getDailyView(db, date, {});
  const tasks = (view.plan?.tasks || []).filter((task) => canSchedule(task) && (!sceneId || task.effectiveSceneId === sceneId) && task.schedule?.mode !== "manual");
  const raw = await db.dailyTask.findMany({ where: { id: { in: tasks.map((row) => row.id) }, plan: { profileId: PROFILE } } });
  const arranged = arrangeTimes(tasks, date, view.scenes, await timeReservations(db, tasks.map((row) => row.id)));
  return { proposals: arranged.map((task) => ({ id: task.id, title: task.title, updatedAt: raw.find((row) => row.id === task.id)!.updatedAt.toISOString(), schedule: task.schedule })), skipped: (view.plan?.tasks || []).filter((task) => !sceneId || task.effectiveSceneId === sceneId).length - tasks.length };
}
export async function validateTimes(db: DailyDB, proposals: Array<Omit<TimeProposal, "title">>) {
  const ids = proposals.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error("时间安排含重复任务");
  const records = [];
  for (const row of proposals) {
    const task = await ownTask(db, row.id);
    if (!canSchedule(task)) throw new Error("已完成或正在执行的任务不能重新安排");
    if (task.updatedAt.toISOString() !== row.updatedAt) throw new Error("任务已变化，请重新生成时间建议");
    records.push({ ...task, schedule: row.schedule });
  }
  assertTimeFree(records, await timeReservations(db, ids));
  return records;
}
export async function saveTimes(db: DailyDB, proposals: Array<Omit<TimeProposal, "title">>) {
  const records = await validateTimes(db, proposals);
  return writeTransaction(db as PrismaClient, async (tx) => {
    for (const task of records) await tx.dailyTask.update({ where: { id: task.id }, data: { orchestration: withSchedule(task.orchestration, task.schedule) } });
    return { saved: records.length };
  });
}
export async function generateReport(db: DailyDB, date: string, reflection?: string, now = new Date()) {
  const plan = await db.dailyPlan.upsert({ where: { profileId_date: { profileId: PROFILE, date } }, create: { profileId: PROFILE, date }, update: {}, include: planInclude });
  const metrics = computeMetrics(plan.tasks, now);
  const text = reflection ?? plan.report?.reflection ?? "";
  return db.dailyReport.upsert({ where: { planId: plan.id },
    create: { planId: plan.id, metrics: JSON.stringify(metrics), markdown: reportMarkdown(date, metrics, text), reflection: text, generatedAt: now },
    update: { metrics: JSON.stringify(metrics), markdown: reportMarkdown(date, metrics, text), reflection: text, generatedAt: now } });
}
export function today() { return shanghaiDate(); }
