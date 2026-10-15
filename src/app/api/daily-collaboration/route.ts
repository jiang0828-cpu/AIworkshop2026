import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isCloudflareD1Runtime } from "@/lib/db";
import { agentSchema, dateSchema, taskDraftSchema } from "@/lib/daily/shared";
import { dailyAIConfig } from "@/lib/daily/config";
import { orchestrate } from "@/lib/daily/provider";
import { initializeScenes, validateScene } from "@/lib/strategy/service";
import { writeTransaction } from "@/lib/database-writes";
import { exportDaily, moduleBackupSchema, restoreDaily } from "@/lib/daily/backup";
import { blockStep, canReplan, finishStep, generateReport, getDailyView, importActions, initializeDaily, ownTask, pauseStep, PROFILE, rejectStep, replanTask, saveAgent, saveTasks, startTask, startStep, syncAction, today, unblockStep, withDailyLock } from "@/lib/daily/service";
import { readOrchestration } from "@/lib/daily/workflow";
import type { PlanningContext } from "@/lib/daily/provider";
import { arrangeTimes, scheduleSchema, withSchedule } from "@/lib/daily/scheduling";
import { canSchedule, proposeTimes, saveTimes, timeReservations, validateAffiliation, validateTimes } from "@/lib/daily/service";
import { affiliationSchema, isStandaloneTemporary, withAffiliation } from "@/lib/daily/affiliation";
import { deliveryAt, intakeEditSchema } from "@/lib/daily/intake";
import { isRecurring, recurrenceDates, recurrenceDueAt } from "@/lib/recurring-tasks";
import { assetSchema } from "@/lib/daily/assets-shared";
import { deleteAsset, saveAsset } from "@/lib/daily/assets";

const id = z.string().min(1).max(200);
const note = z.string().max(20000);
const resultText = z.string().max(200000);
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("orchestrate"), date: dateSchema, input: z.string().trim().max(20000).default(""), sceneId: id.nullable().default(null), taskId: id.optional(), actionIds: z.array(id).max(20).default([]), actionEdits: z.array(intakeEditSchema).max(20).default([]), includeResults: z.boolean().default(false), kind: z.enum(["planned", "temporary"]).default("temporary"), goalId: id.nullable().default(null), projectId: id.nullable().default(null) }),
  z.object({ action: z.literal("replan-task"), id, updatedAt: z.string().datetime({ offset: true }), task: taskDraftSchema }),
  z.object({ action: z.literal("save-tasks"), date: dateSchema, tasks: z.array(taskDraftSchema).min(1).max(20).refine((tasks) => tasks.every((task) => isStandaloneTemporary(task) || task.affiliation?.goalId && task.affiliation.projectId), "计划任务请选择所属目标和项目"), input: note.default(""), source: z.string().max(200).default("手动编排"), requestId: z.string().min(20).max(64).regex(/^[a-z0-9-]+$/i).optional() }),
  z.object({ action: z.literal("import-actions"), date: dateSchema, ids: z.array(id).min(1).max(50) }),
  z.object({ action: z.literal("start-task"), id, aiOnly: z.boolean().default(false) }),
  z.object({ action: z.literal("start-all"), date: dateSchema, aiOnly: z.boolean().default(true), sceneId: id.nullable().default(null) }),
  z.object({ action: z.literal("start-step"), id }),
  z.object({ action: z.literal("plan-times"), date: dateSchema, sceneId: id.nullable().default(null) }),
  z.object({ action: z.literal("save-times"), proposals: z.array(z.object({ id, updatedAt: z.string().datetime({ offset: true }), schedule: scheduleSchema })).min(1).max(200) }),
  z.object({ action: z.literal("pause-step"), id }),
  z.object({ action: z.literal("finish-step"), id, result: resultText.default("") }),
  z.object({ action: z.literal("accept-step"), id, result: resultText.default("") }),
  z.object({ action: z.literal("reject-step"), id, reason: note.refine((value) => Boolean(value.trim()), "请填写退回要求") }),
  z.object({ action: z.literal("block-step"), id, reason: note.refine((value) => Boolean(value.trim()), "请填写阻塞原因") }),
  z.object({ action: z.literal("unblock-step"), id }),
  z.object({ action: z.literal("save-agent"), id: id.optional(), data: agentSchema }),
  z.object({ action: z.literal("save-asset"), id: id.optional(), data: assetSchema }),
  z.object({ action: z.literal("delete-asset"), id }),
  z.object({ action: z.literal("update-task"), id, title: z.string().trim().min(1).max(300), notes: note, result: resultText, priority: z.number().int().min(1).max(3), dueAt: z.string().datetime({ offset: true }).nullable(), sceneId: id.nullable().optional(), confirmActionScene: z.boolean().default(false), schedule: scheduleSchema.nullable().optional(), affiliation: affiliationSchema.optional(), confirmActionLinks: z.boolean().default(false) }),
  z.object({ action: z.literal("update-step"), id, notes: note, result: resultText }),
  z.object({ action: z.literal("checkpoint"), id, done: z.boolean() }),
  z.object({ action: z.literal("sync-action"), id }),
  z.object({ action: z.literal("delete-task"), id }),
  z.object({ action: z.literal("report"), date: dateSchema, reflection: note.optional() }),
  z.object({ action: z.literal("import"), backup: moduleBackupSchema }),
]);
export async function GET(request: Request) {
  try {
    const db = await getDb();
    if (new URL(request.url).searchParams.get("export") === "json") {
      await initializeDaily(db);
      return new NextResponse(JSON.stringify({ format: "daily-collaboration-backup", version: 1, exportedAt: new Date().toISOString(), data: await exportDaily(db) }, null, 2),
        { headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=daily-collaboration.json", "Cache-Control": "no-store" } });
    }
    const date = dateSchema.parse(new URL(request.url).searchParams.get("date") || today());
    return NextResponse.json(await getDailyView(db, date, dailyAIConfig()), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "无法读取每日协同，请检查数据库迁移与日期" }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    const command = commandSchema.parse(await request.json());
    const db = await getDb();
    await initializeDaily(db);
    const config = dailyAIConfig();
    if (command.action === "orchestrate") {
      if (!command.input && !command.taskId && !command.actionIds.length) throw new Error("请填写任务与预期产出，或选择已有任务");
      if (command.taskId && command.actionIds.length) throw new Error("请分别编排已有行动与每日任务");
      if (new Set(command.actionIds).size !== command.actionIds.length || new Set(command.actionEdits.map((edit) => edit.actionId)).size !== command.actionEdits.length || command.actionEdits.some((edit) => !command.actionIds.includes(edit.actionId))) throw new Error("待编排清单包含重复或未选择的任务");
      await initializeScenes(db);
      await validateScene(db, command.sceneId);
      const scenes = await db.workbenchScene.findMany({ where: { profileId: PROFILE }, orderBy: { position: "asc" } });
      const agents = await db.dailyAgent.findMany({ where: { profileId: PROFILE } });
      const view = await getDailyView(db, command.date, config);
      const context: PlanningContext = {};
      if (command.goalId || command.projectId) {
        const links = await validateAffiliation(db, { kind: command.kind, goalId: command.goalId, projectId: command.projectId }, false);
        context.planningBasis = { goal: links.goal?.title || "待关联", project: links.project?.name || "待关联" };
      }
      let replacement: { id: string; updatedAt: string } | null = null;
      if (command.taskId) {
        const task = await ownTask(db, command.taskId);
        if (task.plan.date !== command.date || !canReplan(task)) throw new Error("仅可重新编排当日尚未实际执行的任务；已执行任务请保留历史");
        const row = view.plan!.tasks.find((row) => row.id === task.id)!;
        context.sources = [{ id: task.id, title: task.title, purpose: task.notes, standard: readOrchestration(task.orchestration)?.output || "", dueAt: row.dueAt, sceneId: row.effectiveSceneId, actionId: task.actionId, goalTitle: row.goalName || "待关联", projectName: row.projectName || "待关联" }];
        replacement = { id: task.id, updatedAt: task.updatedAt.toISOString() };
      } else if (command.actionIds.length) {
        const rows = await db.action.findMany({ where: { profileId: PROFILE, id: { in: command.actionIds } } });
        if (rows.length !== new Set(command.actionIds).size) throw new Error("所选行动不存在或不属于当前档案");
        if (rows.some((row) => row.completedAt || ["已完成", "已取消", "已归档"].includes(row.status) || view.plan?.tasks.some((task) => task.actionId === row.id))) throw new Error("已完成、已取消或今日已导入的行动不重复编排");
        if (rows.some(row => isRecurring(row) && !recurrenceDates(row, command.date, command.date).length)) throw new Error("该周期任务在所选日期无待执行安排");
        if (command.actionEdits.some((edit) => rows.find((row) => row.id === edit.actionId)?.updatedAt.toISOString() !== edit.updatedAt)) throw new Error("原项目任务已更新，请刷新清单后重新确认");
        context.sources = command.actionIds.map((id) => {
          const row = rows.find((row) => row.id === id)!;
          const action = view.actions.find((action) => action.id === row.id)!;
          const edit = command.actionEdits.find((edit) => edit.actionId === id);
          return { id: row.id, title: edit?.title ?? row.title, purpose: edit?.purpose ?? row.purpose, standard: edit?.standard ?? row.standard, estimatedHours: edit?.estimatedHours ?? row.estimatedHours, dueAt: edit ? edit.dueAt : isRecurring(row) ? recurrenceDueAt(command.date) : deliveryAt(action, view.projects), sceneId: action.effectiveSceneId, actionId: row.id, goalTitle: view.goals.find((goal) => goal.id === action.goalId)?.title || "待关联", projectName: view.projects.find((project) => project.id === action.projectId)?.name || "待关联" };
        });
      }
      if (command.includeResults) context.results = view.plan?.tasks.filter((task) => task.completedAt && (command.sceneId === null || task.effectiveSceneId === command.sceneId)).map((task) => ({ title: task.title, result: task.result.slice(0, 4000) })).slice(0, 10);
      const result = await orchestrate(command.input, command.date, agents, config, scenes, command.sceneId, context);
      if (context.sources?.length) {
        const ids = result.tasks.map((task) => task.actionId);
        if (context.sources.some((source) => ids.filter((id) => id === source.actionId).length !== 1)) throw new Error("AI 未保留所选任务关联，请重试");
      }
      const tasks = arrangeTimes(result.tasks.map((task) => {
        const original = replacement ? view.plan!.tasks.find((row) => row.id === replacement.id) : null;
        const action = view.actions.find((row) => row.id === task.actionId);
        const affiliation = original?.affiliation || { kind: action ? "planned" as const : command.kind, goalId: action ? action.goalId : command.goalId, projectId: action ? action.projectId : command.projectId };
        const project = view.projects.find((row) => row.id === affiliation.projectId);
        const goal = view.goals.find((row) => row.id === (project?.goalId || affiliation.goalId));
        const edit = command.actionEdits.find((edit) => edit.actionId === task.actionId);
        return { ...task, ...(edit ? { title: edit.title, dueAt: edit.dueAt, notes: `${edit.purpose}\n完成标准：${edit.standard}`, steps: task.steps.map((step) => step.assignee === "human" && task.lane === "A" ? { ...step, estimatedMinutes: Math.max(1, Math.round(edit.estimatedHours * 60 / task.steps.length)) } : step) } : {}), affiliation, sceneId: action ? action.effectiveSceneId : command.sceneId || project?.sceneId || goal?.sceneId || task.sceneId, schedule: null };
      }), command.date, scenes, await timeReservations(db, replacement ? [replacement.id] : []));
      return NextResponse.json({ ...result, tasks, replacement });
    }
    const result = await withDailyLock(db, async () => {
      switch (command.action) {
        case "replan-task": return replanTask(db, command.id, command.updatedAt, command.task);
        case "save-tasks": {
          return saveTasks(db, command.date, command.tasks, command.input, command.source, command.requestId);
        }
        case "import-actions": return importActions(db, command.date, command.ids);
        case "start-task": return startTask(db, command.id, config, command.aiOnly);
        case "start-step": return startStep(db, command.id, config);
        case "plan-times": return proposeTimes(db, command.date, command.sceneId);
        case "save-times": return saveTimes(db, command.proposals);
        case "start-all": {
          const view = await getDailyView(db, command.date, config);
          const errors: string[] = [];
          let started = 0;
          for (const task of (view.plan?.tasks || []).filter((task) => (!command.sceneId || task.effectiveSceneId === command.sceneId) && !task.steps.some((step) => ["failed", "blocked"].includes(step.status)))) try {
            const result = await startTask(db, task.id, config, command.aiOnly);
            if ("started" in result && result.started || "queued" in result && result.queued) started++;
          } catch (error) { errors.push(`${task.title}：${error instanceof Error ? error.message : "未启动"}`); }
          return { ok: true, started, warning: errors.join("；") || undefined };
        }
        case "pause-step": return pauseStep(db, command.id);
        case "finish-step": return finishStep(db, command.id, command.result, config);
        case "accept-step": return finishStep(db, command.id, command.result, config, true);
        case "reject-step": return rejectStep(db, command.id, command.reason, config);
        case "block-step": return blockStep(db, command.id, command.reason);
        case "unblock-step": return unblockStep(db, command.id);
        case "save-agent": return saveAgent(db, command.data, command.id);
        case "save-asset": return saveAsset(db, command.data, command.id);
        case "delete-asset": return deleteAsset(db, command.id);
        case "sync-action": return syncAction(db, command.id);
        case "delete-task": {
          const task = await ownTask(db, command.id);
          if (task.steps.some((step) => ["running", "preparing"].includes(step.status)) || await db.dailyRun.count({ where: { step: { taskId: task.id }, slot: { not: null } } }))
            throw new Error("请暂停人工执行并等待 AI 调用结束后删除");
          return db.dailyTask.delete({ where: { id: task.id } });
        }
        case "update-task": {
          const task = await ownTask(db, command.id);
          if (command.affiliation) {
            await validateAffiliation(db, command.affiliation, false);
            if (task.actionId && !(await db.action.findFirst({ where: { id: task.actionId, profileId: PROFILE } }))) throw new Error("关联行动不存在或不属于当前档案");
            const current = (await getDailyView(db, task.plan.date, config)).plan!.tasks.find((row) => row.id === task.id)!.affiliation;
            if (current.goalId && current.projectId && (!command.affiliation.goalId || !command.affiliation.projectId)) throw new Error("请选择完整的所属目标和项目");
            if (task.actionId && (current.goalId !== command.affiliation.goalId || current.projectId !== command.affiliation.projectId) && !command.confirmActionLinks) throw new Error("目标和项目修改将同步原行动，请确认");
          }
          if (command.schedule !== undefined && !canSchedule(task)) throw new Error("已完成或正在执行的任务不能重新安排");
          if (command.schedule) await validateTimes(db, [{ id: task.id, updatedAt: task.updatedAt.toISOString(), schedule: command.schedule }]);
          await validateScene(db, command.sceneId);
          if (task.actionId && command.sceneId !== undefined && !command.confirmActionScene) throw new Error("修改场景将同步原行动，请确认");
          return writeTransaction(db, async (tx) => {
            if (task.actionId && command.affiliation) await tx.action.update({ where: { id: task.actionId }, data: { goalId: command.affiliation.goalId, projectId: command.affiliation.projectId } });
            if (task.actionId && command.sceneId !== undefined) {
              const action = await db.action.findFirst({ where: { id: task.actionId, profileId: PROFILE } });
              if (!action) throw new Error("关联行动不存在");
              await tx.action.update({ where: { id: action.id }, data: { sceneId: command.sceneId } });
            }
            return tx.dailyTask.update({ where: { id: command.id }, data: { title: command.title, notes: command.notes, result: command.result, priority: command.priority, dueAt: command.dueAt ? new Date(command.dueAt) : null, ...(command.schedule !== undefined || command.affiliation !== undefined ? { orchestration: withAffiliation(withSchedule(task.orchestration, command.schedule), command.affiliation) } : {}), ...(!task.actionId && command.sceneId !== undefined ? { sceneId: command.sceneId } : {}) } });
          });
        }
        case "update-step": {
          const step = await db.dailyStep.findFirst({ where: { id: command.id, task: { plan: { profileId: PROFILE } } } });
          if (!step) throw new Error("步骤不存在");
          if (["preparing", "queued"].includes(step.status) || (step.status === "running" && step.assignee === "ai")) throw new Error("请等待 AI 返回后修改记录");
          return db.dailyStep.update({ where: { id: command.id }, data: { notes: command.notes, result: command.result } });
        }
        case "checkpoint": {
          if (!(await db.dailyCheckpoint.findFirst({ where: { id: command.id, task: { plan: { profileId: PROFILE } } } }))) throw new Error("检查点不存在");
          return db.dailyCheckpoint.update({ where: { id: command.id }, data: { done: command.done } });
        }
        case "report": return generateReport(db, command.date, command.reflection);
        case "import": {
          const write = (tx: Parameters<typeof restoreDaily>[0]) => restoreDaily(tx, command.backup.data, command.backup.exportedAt);
          await (isCloudflareD1Runtime() ? write(db) : db.$transaction(write, { timeout: 600000 }));
          return { ok: true };
        }
      }
    }, command.action === "import");
    return NextResponse.json(result || { ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).slice(0, 3).join("；") : error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}
