import type { Prisma, PrismaClient } from "@prisma/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PROFILE_ID, isCloudflareD1Runtime } from "../db";
import { batchSchema, canonicalRelation, parsePayload, recordSchema, relationSchema, sceneSchema, type StrategyView } from "./shared";
import { shanghaiDate, taskStatus } from "../daily/shared";
import { nextGoalHorizon } from "../ai-use";
import { sceneDefaults } from "../scenes";
import { profileScenesSaveSchema } from "./profile-scenes";
import { validateProfileSceneDetails } from "./profile-scene-layout";

export type StrategyDB = PrismaClient | Prisma.TransactionClient;
type Statement = { sql: string; values: Array<string | number | null> };
function recordStatements(record: { id: string; kind: string; sceneId: string | null; title: string; payload: unknown; archived: boolean }): Statement[] {
  const now = Date.now();
  return [
    { sql: 'INSERT INTO "StrategyRecord" ("id","profileId","kind","sceneId","title","payload","archived","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT("id") DO UPDATE SET "sceneId"=excluded."sceneId","title"=excluded."title","payload"=excluded."payload","archived"=excluded."archived","updatedAt"=excluded."updatedAt"', values: [record.id, PROFILE_ID, record.kind, record.sceneId, record.title, JSON.stringify(record.payload), Number(record.archived), now, now] },
    { sql: 'INSERT INTO "StrategyVersion" ("id","profileId","recordId","kind","snapshot","createdAt") VALUES (?,?,?,?,?,?)', values: [crypto.randomUUID(), PROFILE_ID, record.id, record.kind, JSON.stringify(record), now] },
  ];
}
export async function saveProfileScenes(db: StrategyDB, input: unknown) {
  const data = profileScenesSaveSchema.parse(input);
  const statements: Statement[] = [];
  if (data.global) {
    const fields = Object.entries(data.global).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    if (fields.length) statements.push({ sql: `UPDATE "Profile" SET ${fields.map(([key]) => `"${key}"=?`).join(",")},"updatedAt"=? WHERE "id"=?`, values: [...fields.map(([, value]) => value), Date.now(), PROFILE_ID] });
  }
  for (const row of data.scenes) {
    await validateScene(db, row.sceneId);
    const scene = await db.workbenchScene.findFirst({ where: { id: row.sceneId, profileId: PROFILE_ID } });
    validateProfileSceneDetails(row.fields.sceneDetails, scene?.slot);
    const current = await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, kind: "profileScene", sceneId: row.sceneId } });
    const id = current?.id || `${PROFILE_ID}:profile-scene:${row.sceneId}`;
    const existing = await db.strategyRecord.findUnique({ where: { id } });
    if (existing && (existing.profileId !== PROFILE_ID || existing.kind !== "profileScene")) throw new Error("记录归属或类型无效");
    statements.push(...recordStatements({ id, kind: "profileScene", sceneId: row.sceneId, title: "基础档案", payload: row.fields, archived: false }));
  }
  await atomic(db, statements);
  return { saved: data.scenes.length + Number(Boolean(data.global)) };
}
export async function atomic(db: StrategyDB, statements: Statement[]) {
  if (!statements.length) return;
  if (isCloudflareD1Runtime()) {
    const d1 = getCloudflareContext().env.WORKBENCH_DB;
    await d1.batch(statements.map((statement) => d1.prepare(statement.sql).bind(...statement.values)));
  } else if ("$transaction" in db) {
    await db.$transaction(async (tx) => { for (const statement of statements) await tx.$executeRawUnsafe(statement.sql, ...statement.values); });
  } else for (const statement of statements) await db.$executeRawUnsafe(statement.sql, ...statement.values);
}
export async function initializeScenes(db: StrategyDB) {
  const existing = await db.workbenchScene.findMany({ where: { profileId: PROFILE_ID } });
  const upgrading = existing.length > 0 && !existing.some((scene) => scene.slot === 5);
  const systemPosition = existing.length && !upgrading ? Math.max(...existing.map(scene => scene.position)) + 1 : sceneDefaults.length - 1;
  for (const [position, { slot, name }] of sceneDefaults.entries()) await db.workbenchScene.upsert({ where: { profileId_slot: { profileId: PROFILE_ID, slot } },
    create: { id: `${PROFILE_ID}-scene-${slot}`, profileId: PROFILE_ID, slot, name, position: slot === 6 ? systemPosition : position },
    update: upgrading ? { position, ...(slot === 0 && existing.find((scene) => scene.slot === 0)?.name === "职业" ? { name: "工作" } : {}) } : {} });
}
export async function strategyView(db: StrategyDB): Promise<StrategyView> {
  await initializeScenes(db);
  const [scenes, records, versions, relations, sources, pins, selfReviews, dailyResults] = await Promise.all([
    db.workbenchScene.findMany({ where: { profileId: PROFILE_ID }, orderBy: { position: "asc" } }),
    db.strategyRecord.findMany({ where: { profileId: PROFILE_ID }, orderBy: { updatedAt: "desc" } }),
    db.strategyVersion.findMany({ where: { profileId: PROFILE_ID }, orderBy: { createdAt: "desc" } }),
    db.goalRelation.findMany({ where: { profileId: PROFILE_ID } }), db.recordSource.findMany({ where: { profileId: PROFILE_ID } }),
    db.workbenchPin.findMany({ where: { profileId: PROFILE_ID, date: shanghaiDate() }, orderBy: { position: "asc" } }),
    db.selfActionReview.findMany({ where: { profileId: PROFILE_ID } }),
    db.dailyTask.findMany({ where: { plan: { profileId: PROFILE_ID }, actionId: { not: null } }, select: { id: true, actionId: true, title: true, result: true, syncedAt: true, steps: { select: { assignee: true, status: true } } } }),
  ]);
  return JSON.parse(JSON.stringify({ scenes, records: records.map((record) => ({ ...record, payload: JSON.parse(record.payload) })), versions, relations, sources, pins,
    selfReviews: selfReviews.map((row) => ({ ...row, applied: JSON.parse(row.applied) })), selfDailyResults: dailyResults.map(({ steps, ...row }) => ({ ...row, status: taskStatus(steps), hasAI: steps.some((step) => step.assignee === "ai") })) }));
}
export async function own(db: StrategyDB, type: string, id: unknown) {
  if (!id) return null;
  if (typeof id !== "string") throw new Error("关联 ID 无效");
  if (type === "signal" || type === "vision" || type === "skill") {
    const row = await db.strategyRecord.findFirst({ where: { id, profileId: PROFILE_ID, kind: type } });
    if (!row) throw new Error("关联记录不存在或不属于当前档案");
    return row;
  }
  const models = { goal: db.goal, project: db.project, decision: db.decision, action: db.action, evidence: db.evidence,
    experience: db.experience, valueRule: db.valueRule, resource: db.resource, constraint: db.constraint,
    assumption: db.assumption, review: db.review, situationItem: db.situationItem, aITask: db.aITask };
  const model = models[type as keyof typeof models];
  if (!model) throw new Error("记录类型无效");
  const row = await (model as unknown as { findFirst: (args: unknown) => Promise<{ id: string; title?: string; name?: string }> }).findFirst({ where: { id, profileId: PROFILE_ID } });
  if (!row) throw new Error("记录不存在或不属于当前档案");
  return row;
}
export async function validateScene(db: StrategyDB, id: unknown) {
  if (id && !(typeof id === "string" && await db.workbenchScene.findFirst({ where: { id, profileId: PROFILE_ID } }))) throw new Error("场景无效");
}
export async function saveScenes(db: StrategyDB, input: unknown) {
  const rows = sceneSchema.parse(input);
  for (const row of rows) await validateScene(db, row.id);
  await atomic(db, rows.map((row) => ({ sql: 'UPDATE "WorkbenchScene" SET "name"=?, "position"=?, "updatedAt"=? WHERE "id"=? AND "profileId"=?', values: [row.name, row.position, Date.now(), row.id, PROFILE_ID] })));
}
export async function saveRecord(db: StrategyDB, input: unknown) {
  const record = recordSchema.parse(input), payload = parsePayload(record.kind, record.payload);
  await validateScene(db, record.sceneId);
  let id = record.id || crypto.randomUUID();
  if (record.kind === "profileScene") {
    if (!record.sceneId || record.archived) throw new Error("场景档案必须选择场景，不能归档");
    const scene = await db.workbenchScene.findFirst({ where: { id: record.sceneId, profileId: PROFILE_ID } });
    if ("sceneDetails" in payload) validateProfileSceneDetails(payload.sceneDetails, scene?.slot);
    const current = await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, kind: "profileScene", sceneId: record.sceneId } });
    if (record.id && record.id !== current?.id) throw new Error("场景档案不存在或与所选场景不一致");
    id = current?.id || `${PROFILE_ID}:profile-scene:${record.sceneId}`;
  }
  if (record.kind === "overallVision") {
    if (record.sceneId || record.archived) throw new Error("总愿景不属于单一场景，也不需要归档");
    if (record.id) {
      const requested = await db.strategyRecord.findFirst({ where: { id: record.id, profileId: PROFILE_ID, kind: "overallVision" } });
      if (!requested) throw new Error("总愿景不存在或不属于当前档案");
    }
    const current = await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, kind: "overallVision" } });
    if (record.id && current && record.id !== current.id) throw new Error("每个档案只有一份总愿景");
    id = current?.id || `${PROFILE_ID}:overall-vision`;
  }
  if (record.kind === "vision") {
    if (!record.sceneId) throw new Error("愿景必须选择场景");
    const existing = await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, kind: "vision", sceneId: record.sceneId, archived: false } });
    if (!record.archived && existing && record.id && existing.id !== record.id) throw new Error("所选场景已有愿景，请从该场景的愿景编辑");
    if (!record.archived && existing && existing.id !== record.id) id = existing.id;
  }
  if (record.kind === "tag" && "subjectType" in payload) {
    await own(db, payload.subjectType, payload.subjectId);
    for (const scene of payload.sceneIds) await validateScene(db, scene);
    id = `${PROFILE_ID}:tag:${payload.subjectType}:${payload.subjectId}`;
  }
  if (record.kind === "skill" && "evidenceId" in payload) await own(db, "evidence", payload.evidenceId);
  if (record.kind === "signal" && "goalId" in payload) {
    for (const type of ["goal", "project", "decision"] as const) await own(db, type, payload[`${type}Id`]);
  }
  const existing = await db.strategyRecord.findUnique({ where: { id } });
  if (existing && (existing.profileId !== PROFILE_ID || existing.kind !== record.kind)) throw new Error("记录归属或类型无效");
  await atomic(db, recordStatements({ ...record, id, payload }));
  return { id };
}
export async function saveRelation(db: StrategyDB, input: unknown) {
  const relation = relationSchema.parse(input);
  await own(db, "goal", relation.fromId); await own(db, "goal", relation.toId);
  const pair = canonicalRelation(relation.fromId, relation.toId, relation.kind);
  return db.goalRelation.upsert({ where: { profileId_fromId_toId_kind: { profileId: PROFILE_ID, ...pair, kind: relation.kind } },
    create: { id: crypto.randomUUID(), profileId: PROFILE_ID, ...pair, kind: relation.kind, evidence: relation.evidence }, update: { evidence: relation.evidence } });
}
export async function saveGoalBatch(db: StrategyDB, input: unknown) {
  const batch = batchSchema.parse(input);
  await own(db, "goal", batch.parentId);
  const parent = await db.goal.findUniqueOrThrow({ where: { id: batch.parentId } });
  if (!nextGoalHorizon(parent.horizon) || batch.goals.some((goal) => goal.horizon !== nextGoalHorizon(parent.horizon))) throw new Error("子目标必须使用下一时间层级");
  const key = `${PROFILE_ID}:${batch.requestId}`, payload = JSON.stringify(batch);
  const existing = await db.goalBatch.findUnique({ where: { id: key } });
  if (existing) { if (existing.payload !== payload) throw new Error("重复请求内容不一致"); return { saved: batch.goals.length, duplicate: true }; }
  const now = Date.now();
  const statements: Statement[] = [{ sql: 'INSERT INTO "GoalBatch" ("id","profileId","payload","createdAt") VALUES (?,?,?,?)', values: [key, PROFILE_ID, payload, now] }];
  for (const goal of batch.goals) {
    const deadline = goal.deadline ? new Date(goal.deadline).getTime() : null;
    if (deadline !== null && !Number.isFinite(deadline)) throw new Error("截止日期无效");
    statements.push({ sql: 'INSERT INTO "Goal" ("id","profileId","parentId","title","description","horizon","metric","status","deadline","sceneId","visionId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      values: [crypto.randomUUID(), PROFILE_ID, parent.id, goal.title, goal.description, goal.horizon, goal.metric, "进行中", deadline, parent.sceneId, parent.visionId, now, now] });
  }
  try { await atomic(db, statements); } catch (error) {
    const replay = await db.goalBatch.findUnique({ where: { id: key } });
    if (replay?.payload === payload) return { saved: batch.goals.length, duplicate: true };
    throw error;
  }
  return { saved: batch.goals.length };
}
