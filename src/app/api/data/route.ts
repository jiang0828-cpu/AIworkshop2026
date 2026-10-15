import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, PROFILE_ID } from "@/lib/db";
import { deleteSchema, entitySchema, instructionSchema, profileSchema, profilePatchSchema, situationItemSchema, updateSchema, parseOptionalDate } from "@/lib/schemas";
import { strategyView, own } from "@/lib/strategy/service";
import { ownEntity, parseEntity, validateEntityLinks, validateTags, writeAssessment, writeTags } from "@/lib/strategy/entity";
import { sourceSchema } from "@/lib/strategy/shared";
import { writeTransaction } from "@/lib/database-writes";
import { withDailyLock } from "@/lib/daily/service";
import { dailyAIConfig } from "@/lib/daily/config";
import { assertAIActionReady } from "@/lib/strategy/self-loop";
import { resolveScene } from "@/lib/scenes";
import { assertExecutionReady } from "@/lib/execution-plan/guard";
import { validateReviewScope, writeReviewScope } from "@/lib/review-scope";
import { readAffiliation } from "@/lib/daily/affiliation";

const include = {
  experiences: { orderBy: { createdAt: "desc" as const } }, evidences: { orderBy: { createdAt: "desc" as const } },
  valueRules: { orderBy: { priority: "asc" as const } }, resources: { orderBy: { createdAt: "desc" as const } },
  constraints: { orderBy: { createdAt: "desc" as const } }, assumptions: { orderBy: { createdAt: "desc" as const } },
  goals: { orderBy: { createdAt: "desc" as const } }, projects: { include: { milestones: true }, orderBy: { createdAt: "desc" as const } },
  actions: { include: { dailyTasks: { select: { completedAt: true, plan: { select: { date: true } } } } }, orderBy: { dueDate: "asc" as const } }, reviews: { orderBy: { periodEnd: "desc" as const } },
  decisions: { include: { options: true }, orderBy: { createdAt: "desc" as const } }, aiInstruction: true,
  suggestions: { orderBy: { createdAt: "desc" as const } }, documentVersions: { orderBy: { createdAt: "desc" as const }, take: 50 },
  identityCard: { include: { versions: { orderBy: { createdAt: "desc" as const }, take: 30 } } },
  contextPackages: { include: { items: { orderBy: { priority: "desc" as const } }, references: true }, orderBy: { createdAt: "desc" as const }, take: 30 },
  aiTasks: { include: { feedbacks: { orderBy: { createdAt: "desc" as const } }, contextPackage: true }, orderBy: { updatedAt: "desc" as const }, take: 50 },
  correctionRecords: { orderBy: { updatedAt: "desc" as const }, take: 100 },
  situationAssessment: true,
  situationItems: { orderBy: { updatedAt: "desc" as const } },
} as const;

export async function GET() {
  const db = await getDb();
  const profile = await db.profile.upsert({ where: { id: PROFILE_ID }, update: {}, create: { id: PROFILE_ID, aiInstruction: { create: {} } }, include });
  const strategy = await strategyView(db);
  const withScene = <T extends { id: string }>(row: T) => ({ ...row, ...resolveScene(row, profile.goals, profile.projects, strategy.scenes) });
  const completedDaily = await db.dailyTask.findMany({ where: { plan: { profileId: PROFILE_ID }, completedAt: { not: null }, steps: { some: {}, every: { status: "done" } } }, select: { id: true, title: true, actionId: true, sceneId: true, completedAt: true, result: true, orchestration: true, plan: { select: { date: true } } }, orderBy: { completedAt: "asc" } });
  const dailyReviewTasks = completedDaily.map(({ orchestration, ...task }) => {
    const action = profile.actions.find(action => action.id === task.actionId);
    const affiliation = readAffiliation(orchestration);
    const projectId = action ? action.projectId : affiliation?.projectId;
    const links = { projectId, goalId: (action ? action.goalId : affiliation?.goalId) || profile.projects.find(project => project.id === projectId)?.goalId };
    return { ...task, result: task.result.slice(0, 4000), ...links, ...resolveScene(action || { ...task, ...links }, profile.goals, profile.projects, strategy.scenes) };
  });
  return NextResponse.json({ ...profile, dailyReviewTasks, goals: profile.goals.map(withScene), projects: profile.projects.map(withScene), actions: profile.actions.map(withScene), strategy, aiConfigured: Boolean(dailyAIConfig().apiKey) });
}

function withDates(data: Record<string, unknown>) {
  const result = { ...data };
  for (const key of ["happenedAt", "deadline", "dueDate", "periodStart", "periodEnd", "reviewDate"]) if (key in result) result[key] = parseOptionalDate(result[key]);
  return result;
}

export async function PATCH(request: Request) {
  try {
    const db = await getDb();
    const body = updateSchema.parse(await request.json());
    const data = withDates(body.data);
    const tags = await validateTags(db, body.type, data);
    if (body.type === "profile") {
      const parsed = profilePatchSchema.parse(data);
      return NextResponse.json(await db.profile.update({ where: { id: PROFILE_ID }, data: parsed }));
    }
    if (body.type === "instruction") {
      const parsed = instructionSchema.parse(data);
      return NextResponse.json(await db.aIInstruction.upsert({ where: { profileId: PROFILE_ID }, update: parsed, create: { profileId: PROFILE_ID, ...parsed } }));
    }
    if (body.type === "situationAssessment") {
      return NextResponse.json(await withDailyLock(db, () => writeTransaction(db, (tx) => writeAssessment(tx, data))));
    }
    if (body.type === "situationItem") {
      await own(db, "situationItem", body.id);
      const parsed = situationItemSchema.parse(data);
      return NextResponse.json(await db.situationItem.update({ where: { id: body.id }, data: parsed }));
    }
    if (!body.id) return NextResponse.json({ error: "缺少记录 ID" }, { status: 400 });
    const existing = await ownEntity(db, body.type, body.id);
    const reviewScope = data._reviewScope;
    delete data._reviewScope;
    if (body.type === "review" && reviewScope !== undefined) await validateReviewScope(db, reviewScope);
    const crossScene = data.crossSceneConfirmed === true;
    delete data.crossSceneConfirmed; delete data._source;
    const validated = parseEntity(body.type, data);
    await validateEntityLinks(db, body.type, validated, existing as Record<string, unknown>, crossScene);
    if (body.type === "decision") delete validated.options;
    const result = await withDailyLock(db, () => writeTransaction(db, async (tx) => {
      await validateEntityLinks(db, body.type, validated, await ownEntity(db, body.type, body.id!) as Record<string, unknown>, crossScene);
      if (body.type === "action" && validated.status === "已完成" && existing && "status" in existing && existing.status !== "已完成") await assertAIActionReady(db, body.id!);
      if (body.type === "action" && ["进行中", "已完成"].includes(String(validated.status)) && existing && "status" in existing && existing.status !== validated.status) await assertExecutionReady(db, body.id!);
      const model = (tx as unknown as Record<string, { update: (args: unknown) => Promise<unknown> }>)[body.type];
      if (!model) throw new Error("未知记录类型");
      const updated = await model.update({ where: { id: body.id }, data: validated });
      if (body.type === "review" && reviewScope !== undefined) await writeReviewScope(tx, body.id!, reviewScope);
      await writeTags(tx, body.type, body.id!, tags);
      return { ...existing, ...(updated as Record<string, unknown>) };
    }));
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败，请检查输入" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const db = await getDb();
    const body = entitySchema.parse(await request.json());
    const data = withDates(body.data);
    const tags = await validateTags(db, body.type, data);
    const reviewScope = data._reviewScope;
    delete data._reviewScope;
    if (body.type === "review") {
      if (reviewScope === undefined) throw new Error("请先建立项目及任务，再选择复盘对象");
      await validateReviewScope(db, reviewScope);
    }
    const source = data._source ? sourceSchema.parse(data._source) : null;
    if (source) await own(db, source.sourceType, source.sourceId);
    const crossScene = data.crossSceneConfirmed === true;
    delete data.crossSceneConfirmed; delete data._source;
    if (!["situationItem", "situationAssessment"].includes(body.type)) {
      const validated = parseEntity(body.type, data);
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, validated);
      await validateEntityLinks(db, body.type, data, null, crossScene);
    }
    const required: Partial<Record<typeof body.type, string[]>> = {
      experience: ["title"], evidence: ["ability", "evidence"], valueRule: ["value"], resource: ["name"], constraint: ["name"], assumption: ["statement"], goal: ["title"], project: ["name"], milestone: ["title"], action: ["title"], decision: ["title"], decisionOption: ["name"], situationItem: ["title"],
    };
    for (const field of required[body.type] || []) z.string().trim().min(1, `${field}不能为空`).parse(data[field]);
    const output = await withDailyLock(db, () => writeTransaction(db, async (tx) => {
    await validateEntityLinks(db, body.type, data, null, crossScene);
    const profileData = { profileId: PROFILE_ID, ...data };
    let result: unknown;
    switch (body.type) {
      case "experience": result = await tx.experience.create({ data: profileData as never }); break;
      case "evidence": result = await tx.evidence.create({ data: profileData as never }); break;
      case "valueRule": result = await tx.valueRule.create({ data: profileData as never }); break;
      case "resource": result = await tx.resource.create({ data: profileData as never }); break;
      case "constraint": result = await tx.constraint.create({ data: profileData as never }); break;
      case "assumption": result = await tx.assumption.create({ data: profileData as never }); break;
      case "goal": result = await tx.goal.create({ data: { ...profileData, parentId: typeof data.parentId === "string" && data.parentId ? data.parentId : null } as never }); break;
      case "project": result = await tx.project.create({ data: profileData as never }); break;
      case "milestone": result = await tx.milestone.create({ data: data as never }); break;
      case "action": result = await tx.action.create({ data: profileData as never }); break;
      case "review": {
        const review = await tx.review.create({ data: profileData as never });
        await writeReviewScope(tx, review.id, reviewScope);
        result = review;
        break;
      }
      case "decision": {
        const { options, ...decisionData } = profileData as Record<string, unknown>;
        const optionNames = typeof options === "string" ? options.split(/\r?\n/).map((name) => name.trim()).filter(Boolean) : [];
        const decision = await tx.decision.create({ data: decisionData as never });
        for (const name of optionNames) await tx.decisionOption.create({ data: { decisionId: decision.id, name } });
        result = decision;
        break;
      }
      case "decisionOption": result = await tx.decisionOption.create({ data: data as never }); break;
      case "situationAssessment": {
        result = await writeAssessment(tx, data);
        break;
      }
      case "situationItem": {
        const parsed = situationItemSchema.parse(data);
        result = await tx.situationItem.create({ data: { profileId: PROFILE_ID, ...parsed } });
        break;
      }
      default: return NextResponse.json({ error: "未知记录类型" }, { status: 400 });
    }
    if (source && result && typeof result === "object" && "id" in result) {
      const origin = await own(db, source.sourceType, source.sourceId);
      await tx.recordSource.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, targetType: body.type, targetId: String(result.id), ...source, sourceTitle: origin?.title || "来源记录" } });
    }
    if (result && typeof result === "object" && "id" in result) await writeTags(tx, body.type, String(result.id), tags);
    return result;
    }));
    if (output && typeof output === "object" && "id" in output && (body.type === "project" || body.type === "action")) {
      return NextResponse.json(await ownEntity(db, body.type, String(output.id)), { status: 201 });
    }
    return NextResponse.json(output, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败，请检查输入" }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const db = await getDb();
  let body;
  try { body = deleteSchema.parse(await request.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "删除请求无效" }, { status: 400 }); }
  if (body.type === "all") {
    await withDailyLock(db, () => writeTransaction(db, async (tx) => {
      const where = { profileId: PROFILE_ID };
      await tx.executionPlan.deleteMany({ where });
      await tx.dailyPlan.deleteMany({ where }); await tx.dailyAgent.deleteMany({ where });
      await tx.selfActionReview.deleteMany({ where });
      await tx.radarRecord.deleteMany({ where });
      await tx.researchBatch.deleteMany({ where });
      await tx.goalBatch.deleteMany({ where }); await tx.workbenchPin.deleteMany({ where });
      await tx.recordSource.deleteMany({ where }); await tx.goalRelation.deleteMany({ where });
      await tx.strategyVersion.deleteMany({ where }); await tx.strategyRecord.deleteMany({ where }); await tx.workbenchScene.deleteMany({ where });
      await tx.documentVersion.deleteMany({ where }); await tx.aISuggestion.deleteMany({ where });
      await tx.aITask.deleteMany({ where }); await tx.contextPackage.deleteMany({ where });
      await tx.correctionRecord.deleteMany({ where }); await tx.identityCard.deleteMany({ where });
      await tx.decision.deleteMany({ where }); await tx.review.deleteMany({ where }); await tx.action.deleteMany({ where });
      await tx.project.deleteMany({ where }); await tx.goal.deleteMany({ where }); await tx.assumption.deleteMany({ where });
      await tx.constraint.deleteMany({ where }); await tx.resource.deleteMany({ where }); await tx.valueRule.deleteMany({ where });
      await tx.evidence.deleteMany({ where }); await tx.experience.deleteMany({ where });
      await tx.situationItem.deleteMany({ where }); await tx.situationAssessment.deleteMany({ where });
      await tx.profile.update({ where: { id: PROFILE_ID }, data: profileSchema.parse({}) });
    }), true);
    return NextResponse.json({ ok: true });
  }
  if (!body.id) return NextResponse.json({ error: "缺少删除记录 ID" }, { status: 400 });
  try { await ownEntity(db, body.type, body.id); }
  catch { return NextResponse.json({ error: "记录不存在或不属于当前档案" }, { status: 404 }); }
  if (body.type === "review") {
    await withDailyLock(db, () => writeTransaction(db, async tx => {
      await tx.recordSource.deleteMany({ where: { profileId: PROFILE_ID, targetType: "review", targetId: body.id } });
      await tx.review.deleteMany({ where: { id: body.id, profileId: PROFILE_ID } });
    }));
    return NextResponse.json({ ok: true });
  }
  const model = (db as unknown as Record<string, { delete: (args: unknown) => Promise<unknown> }>)[body.type];
  if (!model) return NextResponse.json({ error: "未知记录类型" }, { status: 400 });
  await model.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
