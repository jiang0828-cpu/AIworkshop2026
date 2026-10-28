import { z } from "zod";
import { appliedUpdateSchema, canonicalRelation, parsePayload, recordSchema } from "./shared";
import { initializeScenes, type StrategyDB } from "./service";
import { PROFILE_ID } from "../db";
import { researchBackupSchema } from "../research/backup";
import { sceneCount, sceneDefaults } from "../scenes";
import type { PrismaClient } from "@prisma/client";
import { radarBackupSchema, validateRadarGraph } from "../radar/backup";
import { importLegacyRadar } from "../radar/migration";
import { pauseRestoredNews } from "../radar/news";
import { executionBackupSchema, restoredPlan } from "../execution-plan/backup";
import { validateProfileSceneDetails } from "./profile-scene-layout";

const timestamp = z.coerce.date();
const row = z.object({ id: z.string().min(1), profileId: z.string().optional() });
export const strategyBackupSchema = z.object({
  executionPlans: z.array(executionBackupSchema).default([]),
  radar: z.array(radarBackupSchema).default([]),
  research: z.array(researchBackupSchema).default([]),
  scenes: z.array(row.extend({ slot: z.number().int().min(0).max(sceneCount - 1), name: z.string().min(1).max(30), position: z.number().int().min(0).max(sceneCount - 1), updatedAt: timestamp })).min(4).max(sceneCount),
  records: z.array(row.extend({ kind: z.enum(["overallVision", "vision", "skill", "signal", "tag", "assessment", "profileScene"]), sceneId: z.string().nullable(), title: z.string().min(1).max(300),
    payload: z.string().superRefine((value, ctx) => { try { JSON.parse(value); } catch { ctx.addIssue({ code: "custom", message: "记录内容无效" }); } }), archived: z.boolean(), createdAt: timestamp, updatedAt: timestamp })),
  versions: z.array(row.extend({ recordId: z.string(), kind: z.string(), snapshot: z.string(), createdAt: timestamp })),
  relations: z.array(row.extend({ fromId: z.string(), toId: z.string(), kind: z.enum(["promote", "conflict", "depend"]), evidence: z.string(), createdAt: timestamp, updatedAt: timestamp })),
  sources: z.array(row.extend({ targetType: z.string(), targetId: z.string(), sourceType: z.string(), sourceId: z.string(), sourceTitle: z.string(), createdAt: timestamp })),
  pins: z.array(row.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taskKey: z.string(), position: z.number().int().min(0).max(2) })),
  batches: z.array(row.extend({ payload: z.string(), createdAt: timestamp })).default([]),
  selfReviews: z.array(row.extend({ actionId: z.string().min(1), result: z.string().trim().min(1).max(10000), adjustment: z.string().max(10000), deferred: z.boolean(), applied: z.string().superRefine((value, ctx) => { try { z.array(appliedUpdateSchema).parse(JSON.parse(value)); } catch { ctx.addIssue({ code: "custom", message: "复盘回写关联无效" }); } }), createdAt: timestamp, updatedAt: timestamp })).default([]),
}).superRefine((data, ctx) => {
  if (new Set(data.scenes.map((scene) => scene.slot)).size !== data.scenes.length || new Set(data.scenes.map((scene) => scene.id)).size !== data.scenes.length || new Set(data.scenes.map((scene) => scene.position)).size !== data.scenes.length)
    ctx.addIssue({ code: "custom", message: "场景槽位、ID 和顺序不可重复" });
  const scenes = new Set(data.scenes.map((scene) => scene.id));
  try { validateRadarGraph(data.radar, new Set(data.research.map(r => r.id)), scenes); }
  catch { ctx.addIssue({ code: "custom", message: "雷达记录引用无效" }); }
  if (new Set(data.selfReviews.map((review) => review.actionId)).size !== data.selfReviews.length) ctx.addIssue({ code: "custom", message: "同一行动只能有一份复盘" });
  const visions = new Set<string>();
  const profileScenes = new Set<string>();
  if (data.records.filter((record) => record.kind === "overallVision").length > 1 || data.records.some((record) => record.kind === "overallVision" && (record.sceneId || record.archived))) ctx.addIssue({ code: "custom", message: "总愿景必须唯一且不属于单一场景" });
  for (const rows of Object.values(data)) {
    const ids = new Set<string>();
    for (const item of rows) {
      if (ids.has(item.id)) ctx.addIssue({ code: "custom", message: "备份含重复记录 ID" });
      if (item.profileId && item.profileId !== PROFILE_ID) ctx.addIssue({ code: "custom", message: "备份记录归属无效" });
      ids.add(item.id);
    }
  }
  for (const record of data.records) {
    if (record.kind === "profileScene") {
      if (!record.sceneId || record.archived || profileScenes.has(record.sceneId)) ctx.addIssue({ code: "custom", message: "场景档案缺少场景或重复" });
      if (record.sceneId) profileScenes.add(record.sceneId);
    }
    if (record.kind === "vision") {
      if (!record.sceneId || (!record.archived && visions.has(record.sceneId))) ctx.addIssue({ code: "custom", message: "场景愿景缺少场景或重复" });
      if (!record.archived && record.sceneId) visions.add(record.sceneId);
    }
    try {
      const payload = parsePayload(record.kind, JSON.parse(record.payload));
      if (record.kind === "profileScene" && "sceneDetails" in payload) validateProfileSceneDetails(payload.sceneDetails, data.scenes.find(scene => scene.id === record.sceneId)?.slot);
      if ("sceneIds" in payload && payload.sceneIds.some((id) => !scenes.has(id))) throw new Error("标签场景无效");
    } catch { ctx.addIssue({ code: "custom", message: "业务记录字段无效" }); }
    if (record.sceneId && !scenes.has(record.sceneId)) ctx.addIssue({ code: "custom", message: "记录引用未知场景" });
  }
  for (const version of data.versions) {
    try {
      const snapshot = recordSchema.parse(JSON.parse(version.snapshot));
      const payload = parsePayload(snapshot.kind, snapshot.payload);
      if (snapshot.kind === "profileScene" && "sceneDetails" in payload) validateProfileSceneDetails(payload.sceneDetails, data.scenes.find(scene => scene.id === snapshot.sceneId)?.slot);
      if (snapshot.id !== version.recordId || snapshot.kind !== version.kind || !data.records.some((record) => record.id === version.recordId && record.kind === version.kind)) throw new Error("版本引用无效");
      if (snapshot.sceneId && !scenes.has(snapshot.sceneId)) throw new Error("版本场景无效");
      if ("sceneIds" in payload && payload.sceneIds.some((id) => !scenes.has(id))) throw new Error("历史标签场景无效");
    } catch { ctx.addIssue({ code: "custom", message: "历史快照无效" }); }
  }
  const pairs = new Set<string>();
  for (const relation of data.relations) {
    const pair = canonicalRelation(relation.fromId, relation.toId, relation.kind);
    const key = `${pair.fromId}:${pair.toId}:${relation.kind}`;
    if (relation.fromId === relation.toId || pairs.has(key)) ctx.addIssue({ code: "custom", message: "目标关系无效或重复" });
    pairs.add(key);
  }
  const pins = new Set<string>();
  const positions = new Set<string>();
  for (const pin of data.pins) {
    if (pins.has(`${pin.date}:${pin.taskKey}`) || positions.has(`${pin.date}:${pin.position}`)) ctx.addIssue({ code: "custom", message: "今日置顶重复" });
    pins.add(`${pin.date}:${pin.taskKey}`); positions.add(`${pin.date}:${pin.position}`);
  }
});
export async function exportStrategy(db: StrategyDB) {
  await initializeScenes(db);
  const where = { profileId: PROFILE_ID };
  const [scenes, records, versions, relations, sources, pins, batches, selfReviews] = await Promise.all([db.workbenchScene.findMany({ where }), db.strategyRecord.findMany({ where }),
    db.strategyVersion.findMany({ where }), db.goalRelation.findMany({ where }), db.recordSource.findMany({ where }), db.workbenchPin.findMany({ where }), db.goalBatch.findMany({ where }), db.selfActionReview.findMany({ where })]);
  return { scenes, records, versions, relations, sources, pins, batches, selfReviews, executionPlans: await db.executionPlan.findMany({ where }), research: await db.researchBatch.findMany({ where }), radar: await db.radarRecord.findMany({ where }) };
}
export async function restoreStrategy(db: StrategyDB, data: z.infer<typeof strategyBackupSchema> | undefined, selfOnly = false) {
  if (!data) { await initializeScenes(db); if (!selfOnly) await importLegacyRadar(db as PrismaClient); return; }
  if (!data.scenes.some((scene) => scene.slot === 5)) data = { ...data, scenes: sceneDefaults.map((definition, position) => {
    const previous = data!.scenes.find((scene) => scene.slot === definition.slot);
    return previous ? { ...previous, position, name: previous.slot === 0 && previous.name === "职业" ? "工作" : previous.name } : { id: `${PROFILE_ID}-scene-${definition.slot}`, slot: definition.slot, name: definition.name, position, updatedAt: new Date() };
  }) };
  if (!data.scenes.some(scene => scene.slot === 6)) data = { ...data, scenes: [...data.scenes, {
    id: `${PROFILE_ID}-scene-6`, slot: 6, name: "系统", position: Math.max(...data.scenes.map(scene => scene.position)) + 1, updatedAt: new Date(),
  }] };
  const where = { profileId: PROFILE_ID };
  const kinds = ["overallVision", "vision", "skill", "tag", "profileScene"];
  const selfTags = ["experience", "evidence", "valueRule", "resource", "constraint", "assumption"];
  const isSelf = (record: { kind: string; payload: string }) => record.kind !== "tag" ? kinds.includes(record.kind) : selfTags.includes(JSON.parse(record.payload).subjectType);
  const restoredRecords = data.records.filter((record) => !selfOnly || isSelf(record));
  if (!selfOnly) {
    await db.executionPlan.deleteMany({ where });
    await db.radarRecord.deleteMany({ where });
    await db.researchBatch.deleteMany({ where });
    await db.selfActionReview.deleteMany({ where });
    await db.goalBatch.deleteMany({ where }); await db.workbenchPin.deleteMany({ where });
    await db.recordSource.deleteMany({ where }); await db.goalRelation.deleteMany({ where });
    await db.strategyVersion.deleteMany({ where }); await db.strategyRecord.deleteMany({ where }); await db.workbenchScene.deleteMany({ where });
    for (const scene of data.scenes) await db.workbenchScene.create({ data: { ...scene, profileId: PROFILE_ID } });
  } else {
    const current = await db.strategyRecord.findMany({ where });
    const ids = current.filter(isSelf).map((record) => record.id);
    await db.strategyVersion.deleteMany({ where: { ...where, recordId: { in: ids } } });
    await db.strategyRecord.deleteMany({ where: { ...where, id: { in: ids } } });
    for (const scene of data.scenes) await db.workbenchScene.upsert({ where: { profileId_slot: { profileId: PROFILE_ID, slot: scene.slot } },
      create: { ...scene, profileId: PROFILE_ID }, update: { name: scene.name, position: scene.position } });
  }
  await initializeScenes(db);
  const localScenes = await db.workbenchScene.findMany({ where });
  const map = new Map(data.scenes.map((scene) => [scene.id, localScenes.find((local) => local.slot === scene.slot)!.id]));
  for (const record of restoredRecords) {
    const payload = parsePayload(record.kind, JSON.parse(record.payload));
    if ("sceneIds" in payload) payload.sceneIds = payload.sceneIds.map((id: string) => map.get(id)!);
    await db.strategyRecord.create({ data: { ...record, profileId: PROFILE_ID, sceneId: record.sceneId ? map.get(record.sceneId) || null : null, payload: JSON.stringify(payload) } });
  }
  for (const version of data.versions.filter((version) => !selfOnly || restoredRecords.some((record) => record.id === version.recordId))) {
    const snapshot = recordSchema.parse(JSON.parse(version.snapshot));
    snapshot.payload = parsePayload(snapshot.kind, snapshot.payload);
    if (snapshot.sceneId) snapshot.sceneId = map.get(snapshot.sceneId) || null;
    if (snapshot.kind === "tag") { const payload = parsePayload("tag", snapshot.payload); if ("sceneIds" in payload) payload.sceneIds = payload.sceneIds.map((id: string) => map.get(id)!); snapshot.payload = payload; }
    await db.strategyVersion.create({ data: { ...version, profileId: PROFILE_ID, snapshot: JSON.stringify(snapshot) } });
  }
  if (!selfOnly) {
    for (const relation of data.relations) await db.goalRelation.create({ data: { ...relation, ...canonicalRelation(relation.fromId, relation.toId, relation.kind), profileId: PROFILE_ID } });
    for (const source of data.sources) await db.recordSource.create({ data: { ...source, profileId: PROFILE_ID } });
    for (const pin of data.pins) await db.workbenchPin.create({ data: { ...pin, profileId: PROFILE_ID } });
    for (const batch of data.batches) await db.goalBatch.create({ data: { ...batch, profileId: PROFILE_ID } });
    for (const plan of data.executionPlans) await db.executionPlan.create({ data: restoredPlan(plan) });
    for (const review of data.selfReviews) await db.selfActionReview.create({ data: { ...review, profileId: PROFILE_ID } });
    for (const batch of data.research) await db.researchBatch.create({ data: { ...batch, profileId: PROFILE_ID, slot: null, leaseToken: null, leaseUntil: null, version: batch.version + 1, ...(["queued", "collecting", "analyzing"].includes(batch.status) ? { status: "failed", error: "从备份恢复，等待人工确认后重试" } : {}) } });
    for (const row of data.radar) await db.radarRecord.create({ data: { ...pauseRestoredNews(row), profileId: PROFILE_ID, ...(row.kind === "job" && row.status !== "review" ? { status: "failed" } : {}) } });
    await importLegacyRadar(db as PrismaClient);
  }
}

export async function exportSelfStrategy(db: StrategyDB) {
  await initializeScenes(db);
  const where = { profileId: PROFILE_ID };
  const [scenes, candidates] = await Promise.all([
    db.workbenchScene.findMany({ where }),
    db.strategyRecord.findMany({ where: { ...where, kind: { in: ["overallVision", "vision", "skill", "profileScene", "tag"] } } }),
  ]);
  const records = candidates.filter(record => record.kind !== "tag" || ["experience", "evidence", "valueRule", "resource", "constraint", "assumption"].includes(JSON.parse(record.payload).subjectType));
  const versions = await db.strategyVersion.findMany({ where: { ...where, recordId: { in: records.map(record => record.id) } } });
  return { scenes, records, versions, relations: [], sources: [], pins: [], batches: [], selfReviews: [], executionPlans: [], research: [], radar: [] };
}

export function orderedGoals<T extends { id?: string; parentId?: unknown }>(goals: T[], label = "目标"): T[] {
  const result: T[] = [], pending = [...goals];
  const ids = new Set(goals.map((goal) => goal.id));
  while (pending.length) {
    const index = pending.findIndex((goal) => !goal.parentId || (ids.has(String(goal.parentId)) && result.some((parent) => parent.id === goal.parentId)));
    if (index < 0) throw new Error(`备份${label}层级存在循环或未知父项`);
    result.push(pending.splice(index, 1)[0]);
  }
  return result;
}

export function validateStrategyReferences(bundle: Record<string, unknown>) {
  const data = bundle.strategy as z.infer<typeof strategyBackupSchema> | undefined;
  const sets = new Map<string, Set<string>>();
  for (const type of ["goals", "projects", "decisions", "actions", "experiences", "evidences", "valueRules", "resources", "constraints"]) {
    const rows = (bundle[type] || []) as Array<{ id?: string; profileId?: string }>;
    const ids = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (new Set(ids).size !== ids.length || rows.some((row) => row.profileId && row.profileId !== PROFILE_ID)) throw new Error("备份存在重复 ID 或其他档案记录");
    sets.set(type, new Set(ids));
  }
  for (const type of ["goals", "projects", "decisions", "actions"]) for (const row of (bundle[type] || []) as Array<Record<string, unknown>>) {
    if (row.sceneId && !data?.scenes.some((scene) => scene.id === row.sceneId)) throw new Error("备份关联场景无效");
    for (const [field, kind] of [["visionId", "vision"], ["signalId", "signal"]]) if (row[field] && !data?.records.some((record) => record.id === row[field] && record.kind === kind)) throw new Error("备份愿景或研判关联无效");
  }
  for (const type of ["projects", "decisions", "actions"]) for (const row of (bundle[type] || []) as Array<Record<string, unknown>>) {
    if (row.goalId && !sets.get("goals")?.has(String(row.goalId))) throw new Error("备份关联目标无效");
    if (row.projectId && !sets.get("projects")?.has(String(row.projectId))) throw new Error("备份关联项目无效");
  }
  for (const [type, label] of [["projects", "项目"], ["actions", "任务"]]) {
    const rows = (bundle[type] || []) as Array<{ id?: string; parentId?: unknown; goalId?: unknown; projectId?: unknown }>;
    orderedGoals(rows, label);
    for (const row of rows) if (row.parentId) {
      const parent = rows.find(item => item.id === row.parentId)!;
      if ((row.goalId || null) !== (parent.goalId || null) || type === "actions" && (row.projectId || null) !== (parent.projectId || null)) throw new Error(`备份父子${label}所属关系不一致`);
    }
  }
  // Matrix references may deliberately point to deleted goals; keep that history.
  return orderedGoals((bundle.goals || []) as Array<{ id?: string; parentId?: unknown }>);
}
