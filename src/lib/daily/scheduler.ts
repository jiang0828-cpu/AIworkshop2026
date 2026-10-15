import { agentSchema, reportIsDue } from "./shared";
import { callModel, type AIConfig } from "./provider";
import { generateReport, initializeDaily, ownTask, PROFILE, startStep, taskInclude, withDailyLock, type DailyDB } from "./service";
import { readOrchestration, readySteps, reviewRequired } from "./workflow";
import { readBindings } from "./assets-shared";

const LEASE_MS = 180000;
export async function expireRuns(db: DailyDB, now = new Date()) {
  const expired = await db.dailyRun.findMany({ where: { slot: { not: null }, leaseUntilSeconds: { lt: Math.floor(now.getTime() / 1000) } } });
  for (const run of expired) {
    const changed = await db.dailyRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, slot: run.slot },
      data: { status: "failed", error: "执行中断，需人工确认后重试", slot: null, leaseToken: null, finishedAt: now } });
    if (changed.count) await db.dailyStep.updateMany({ where: { id: run.stepId, currentRunId: run.id, status: { in: ["queued", "running"] } },
      data: { status: "failed", blockedReason: "执行中断，需人工确认后重试" } });
  }
  await db.dailyStep.updateMany({ where: { status: "preparing", updatedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
    data: { status: "failed", blockedReason: "入队过程被中断，请重试" } });
}

export async function claimRun(db: DailyDB) {
  const token = crypto.randomUUID();
  // One SQLite statement reserves both a queue item and a free global slot.
  // RETURNING avoids a select-then-update race across overlapping Cron invocations.
  const claimed = await db.$queryRawUnsafe<Array<{ id: string }>>(`
    UPDATE "DailyRun" SET "status" = 'running', "leaseToken" = ?, "leaseUntilSeconds" = ?, "slot" = (
      SELECT slot FROM (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3)
      WHERE slot NOT IN (SELECT "slot" FROM "DailyRun" WHERE "slot" IS NOT NULL) LIMIT 1
    ) WHERE "id" = (
      SELECT r."id" FROM "DailyRun" r
      JOIN "DailyStep" s ON s."id" = r."stepId" AND s."currentRunId" = r."id"
      JOIN "DailyTask" t ON t."id" = s."taskId"
      JOIN "DailyPlan" p ON p."id" = t."planId"
      JOIN "DailyControl" c ON c."profileId" = p."profileId"
      WHERE r."status" = 'queued' AND s."status" = 'queued' AND c."maintenance" = 0 AND p."profileId" = ?
      AND (SELECT COUNT(*) FROM "DailyRun" WHERE "slot" IS NOT NULL) < 3
      ORDER BY t."priority", t."dueAt" IS NULL, t."dueAt", r."createdAt" LIMIT 1
    ) AND "status" = 'queued' RETURNING "id"`, token, Math.floor((Date.now() + LEASE_MS) / 1000), PROFILE);
  if (!claimed.length) return null;
  const changed = await db.dailyRun.updateMany({ where: { id: claimed[0].id, status: "running", leaseToken: token }, data: { startedAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  if (!changed.count) return null;
  const run = await db.dailyRun.findUniqueOrThrow({ where: { id: claimed[0].id } });
  const step = await db.dailyStep.updateMany({ where: { id: run.stepId, currentRunId: run.id, status: "queued" }, data: { status: "running" } });
  if (!step.count) {
    await db.dailyRun.updateMany({ where: { id: run.id, leaseToken: token }, data: { status: "cancelled", slot: null, leaseToken: null } });
    return null;
  }
  return run;
}

export async function reconcileSteps(db: DailyDB) {
  const steps = await db.dailyStep.findMany({ where: { status: { in: ["running", "queued"] }, task: { plan: { profileId: PROFILE } } }, include: { runs: true, timers: true } });
  for (const step of steps) {
    if (step.assignee === "human" && !step.timers.some((timer) => timer.endedAt === null)) {
      await db.dailyStep.updateMany({ where: { id: step.id, status: "running" }, data: { status: "paused" } });
      continue;
    }
    const run = step.runs.find((run) => run.id === step.currentRunId);
    if (run && ["review", "produced", "failed"].includes(run.status)) await db.dailyStep.updateMany({ where: { id: step.id, currentRunId: run.id, status: step.status },
      data: run.status === "failed" ? { status: "failed", blockedReason: run.error } : { status: run.status, result: run.output } });
  }
  const completed = await db.dailyTask.findMany({ where: { plan: { profileId: PROFILE }, completedAt: null, steps: { every: { status: "done" }, some: {} } }, include: { steps: { orderBy: { position: "desc" }, take: 1 } } });
  for (const task of completed) await db.dailyTask.updateMany({ where: { id: task.id, completedAt: null }, data: { completedAt: task.steps[0].completedAt || new Date(), result: task.steps[0].result } });
}

export async function executeRun(db: DailyDB, run: NonNullable<Awaited<ReturnType<typeof claimRun>>>, config: AIConfig) {
  const started = Date.now();
  try {
    const agent = agentSchema.parse(JSON.parse(run.config));
    const guidance = readBindings(agent.capabilities).snapshot?.map((asset) => `[${asset.kind === "tool" ? "Tool" : "Skill"}：${asset.name}]\n${asset.instructions}`).join("\n\n") || "";
    const step = await db.dailyStep.findUniqueOrThrow({ where: { id: run.stepId }, include: { task: { include: taskInclude } } });
    const status = reviewRequired(step.task, step.position) ? "review" : "produced";
    const response = await callModel(config, run.input, `${agent.prompt}\n${guidance}\n你只有文本输出能力。只处理当前步骤，按standard交付可使用的成果。输入的前置结果可能是尚未人工验收的AI初稿，应核对并保留未知条件。produce直接交付文本；suggest给出具体可执行的建议和待决策点。不得声称已联网、修改文件、执行代码、发送消息、付款或发布。`, agent.model, agent.timeoutSeconds);
    const changed = await db.dailyRun.updateMany({ where: { id: run.id, status: "running", leaseToken: run.leaseToken, leaseExpiresAt: { gt: new Date() } },
      data: { ...response, status, finishedAt: new Date(), slot: null, leaseToken: null } });
    if (changed.count) {
      await db.dailyStep.updateMany({ where: { id: run.stepId, currentRunId: run.id, status: "running" }, data: { status, result: response.output } });
      if (status === "produced") {
        try { await withDailyLock(db, async () => {
          const task = await ownTask(db, step.taskId);
          for (const next of readySteps(task).filter((item) => item.assignee === "ai" && item.status === "pending")) await startStep(db, next.id, config);
        }); } catch { /* A subsequent tick retries queueing, never a model call. */ }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 执行失败";
    const changed = await db.dailyRun.updateMany({ where: { id: run.id, status: "running", leaseToken: run.leaseToken },
      data: { status: "failed", error: message, durationMs: Date.now() - started, finishedAt: new Date(), slot: null, leaseToken: null } });
    if (changed.count) await db.dailyStep.updateMany({ where: { id: run.stepId, currentRunId: run.id, status: "running" }, data: { status: "failed", blockedReason: message } });
  } finally {
    await db.dailyRun.updateMany({ where: { id: run.id, status: "cancelled", leaseToken: run.leaseToken }, data: { slot: null, leaseToken: null, finishedAt: new Date(), durationMs: Date.now() - started } });
  }
}

export async function schedulerTick(db: DailyDB, config: AIConfig, now = new Date()) {
  await initializeDaily(db);
  await db.dailyControl.update({ where: { profileId: PROFILE }, data: { heartbeat: now } });
  await db.dailyControl.updateMany({ where: { profileId: PROFILE, maintenance: true, maintenanceUntil: { lt: now } }, data: { maintenance: false, maintenanceToken: null } });
  const control = await db.dailyControl.findUnique({ where: { profileId: PROFILE } });
  if (control?.maintenance) return;
  await expireRuns(db, now);
  await reconcileSteps(db);
  const activeTasks = await db.dailyTask.findMany({ where: { plan: { profileId: PROFILE }, completedAt: null, steps: { some: { status: { in: ["produced", "done"] } } } }, include: taskInclude });
  for (const task of activeTasks) if (readOrchestration(task.orchestration) && readySteps(task).some((step) => step.assignee === "ai" && step.status === "pending")) {
    try { await withDailyLock(db, async () => {
      const current = await ownTask(db, task.id);
      for (const step of readySteps(current).filter((row) => row.assignee === "ai" && row.status === "pending")) await startStep(db, step.id, config);
    }); } catch { /* Queue only; failed and paused calls still require a manual retry. */ }
  }
  const plans = await db.dailyPlan.findMany({ where: { profileId: PROFILE, report: null }, select: { date: true } });
  for (const plan of plans) if (reportIsDue(plan.date, now)) {
    try { await withDailyLock(db, () => generateReport(db, plan.date, undefined, now)); } catch { /* A foreground edit takes precedence; retry next tick. */ }
  }
  await Promise.all(Array.from({ length: 3 }, async () => {
    const run = await claimRun(db);
    if (run) await executeRun(db, run, config);
  }));
}
