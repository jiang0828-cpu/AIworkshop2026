import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { writeTransaction } from "../database-writes";
import { own, type StrategyDB } from "./service";
import { parseEntity, validateEntityLinks } from "./entity";
import { appliedUpdateSchema, selfSourceType, skillSchema, visionSchema } from "./shared";
import { taskStatus } from "../daily/shared";

const id = z.string().min(1).max(150), text = z.string().trim().max(10000);
const source = z.object({ sourceType: selfSourceType, sourceId: id });
const linkSchema = source.extend({ requestId: z.union([z.string().uuid(), z.string().regex(/^[a-f0-9]{32}$/)]), actionId: id.optional(), title: text.min(1), standard: text.default(""), operation: z.enum(["使用", "获取", "维护"]).optional(), dueDate: z.string().date().nullable().default(null), goalId: id.nullable().default(null), projectId: id.nullable().default(null), sceneId: id.nullable().optional() });
const reflectionSchema = z.object({ actionId: id, result: text.min(1, "请填写实际结果"), adjustment: text.default(""), deferred: z.boolean().default(false) });
const applySchema = source.extend({ actionId: id.optional(), mode: z.enum(["evidence", "source"]), title: text.min(1).max(300), content: text.min(1), expectedUpdatedAt: z.string().optional() });
const where = { profileId: PROFILE_ID };
type SourceRow = { id: string; title?: string; name?: string; ability?: string; statement?: string; payload?: string; sceneId?: string | null; archived?: boolean; updatedAt?: Date };
export async function selfOrigin(db: StrategyDB, type: z.infer<typeof selfSourceType>, sourceId: string): Promise<SourceRow> {
  const row = await own(db, type, sourceId);
  if (!row) throw new Error("来源记录不存在");
  return row as SourceRow;
}
const sourceTitle = (row: SourceRow) => row.title || row.name || row.ability || row.statement || "来源记录";
export async function assertAIActionReady(db: StrategyDB, actionId: string) {
  const tasks = await db.dailyTask.findMany({ where: { plan: where, actionId }, include: { steps: true } });
  if (tasks.some((task) => task.steps.some((step) => step.assignee === "ai") && (taskStatus(task.steps) !== "done" || !task.syncedAt)))
    throw new Error("请先在每日协同完成 AI 验收并确认同步行动完成");
}
async function completedAction(db: StrategyDB, actionId: string) {
  const action = await db.action.findFirst({ where: { id: actionId, ...where } });
  if (!action) throw new Error("行动不存在或不属于当前档案");
  if (action.status !== "已完成") throw new Error("完成行动后再复盘");
  await assertAIActionReady(db, actionId);
  if (!await db.recordSource.findFirst({ where: { ...where, targetType: "action", targetId: actionId, sourceType: { in: selfSourceType.options } } })) throw new Error("行动尚未关联自我认知记录");
  return action;
}
export async function linkSelfAction(db: PrismaClient, input: unknown) {
  const body = linkSchema.parse(input), origin = await selfOrigin(db, body.sourceType, body.sourceId);
  const actionId = body.actionId || `self-${body.requestId}`;
  const existing = await db.action.findFirst({ where: { id: actionId } });
  if (existing && existing.profileId !== PROFILE_ID) throw new Error("行动归属无效");
  if (body.actionId && !existing) throw new Error("所选行动不存在");
  const linkId = `${PROFILE_ID}:self:${body.sourceType}:${body.sourceId}:${actionId}`;
  if (await db.recordSource.findUnique({ where: { id: linkId } })) return { id: actionId };
  let sceneId = body.sceneId;
  if (sceneId === undefined && !body.goalId && !body.projectId) {
    const tag = await db.strategyRecord.findFirst({ where: { ...where, id: `${PROFILE_ID}:tag:${body.sourceType}:${body.sourceId}` } });
    const ids: string[] = origin.sceneId ? [origin.sceneId] : tag ? JSON.parse(tag.payload).sceneIds : [];
    sceneId = ids.length === 1 ? ids[0] : null;
  }
  if (!existing) await validateEntityLinks(db, "action", { goalId: body.goalId, projectId: body.projectId, sceneId }, null, false);
  return writeTransaction(db, async (tx) => {
    if (!existing) await tx.action.create({ data: { id: actionId, ...where, title: body.title, standard: body.standard, purpose: body.operation ? `${body.operation}：${sourceTitle(origin)}` : sourceTitle(origin), dueDate: body.dueDate ? new Date(body.dueDate) : null, goalId: body.goalId, projectId: body.projectId, sceneId: sceneId || null } });
    await tx.recordSource.create({ data: { id: linkId, ...where, targetType: "action", targetId: actionId, sourceType: body.sourceType, sourceId: body.sourceId, sourceTitle: sourceTitle(origin) } });
    return { id: actionId };
  });
}
export async function saveSelfReview(db: PrismaClient, input: unknown) {
  const body = reflectionSchema.parse(input);
  await completedAction(db, body.actionId);
  return db.selfActionReview.upsert({ where: { profileId_actionId: { ...where, actionId: body.actionId } },
    create: { id: crypto.randomUUID(), ...where, ...body }, update: { result: body.result, adjustment: body.adjustment, deferred: body.deferred } });
}
// Call under the same persistent lock as action mutations and backup restore.
export async function applySelfUpdate(db: PrismaClient, input: unknown) {
  const body = applySchema.parse(input), origin = await selfOrigin(db, body.sourceType, body.sourceId);
  if (!body.actionId && (body.sourceType !== "experience" || body.mode !== "evidence")) throw new Error("请先完成行动并保存复盘");
  const review = body.actionId ? await db.selfActionReview.findFirst({ where: { ...where, actionId: body.actionId } }) : null;
  if (body.actionId) {
    await completedAction(db, body.actionId);
    if (!review) throw new Error("请先保存复盘");
    if (!await db.recordSource.findFirst({ where: { ...where, targetType: "action", targetId: body.actionId, sourceType: body.sourceType, sourceId: body.sourceId } })) throw new Error("来源与行动未关联");
  }
  const applied = z.array(appliedUpdateSchema).parse(JSON.parse(review?.applied || "[]"));
  const previous = applied.find((row) => row.sourceId === body.sourceId && row.sourceType === body.sourceType && row.mode === body.mode);
  if (previous) return previous;
  const evidenceLinkId = `${PROFILE_ID}:self-evidence:${body.sourceType}:${body.sourceId}:${body.actionId || "experience"}`;
  if (!body.actionId) {
    const link = await db.recordSource.findUnique({ where: { id: evidenceLinkId } });
    if (link) return { targetType: "evidence", targetId: link.targetId, mode: "evidence", sourceType: body.sourceType, sourceId: body.sourceId };
  }
  if (body.mode === "source" && (!body.expectedUpdatedAt || origin.updatedAt?.toISOString() !== body.expectedUpdatedAt)) throw new Error("原记录已变化，请重新打开草稿后确认");
  const outcome = { sourceType: body.sourceType, sourceId: body.sourceId, mode: body.mode, targetType: body.mode === "evidence" ? "evidence" as const : body.sourceType, targetId: body.mode === "evidence" ? crypto.randomUUID() : body.sourceId };
  await writeTransaction(db, async (tx) => {
    if (body.mode === "evidence") {
      await tx.evidence.create({ data: { id: outcome.targetId, ...where, ability: body.title, evidence: body.content } });
      await tx.recordSource.create({ data: { id: evidenceLinkId, ...where, targetType: "evidence", targetId: outcome.targetId, sourceType: body.sourceType, sourceId: body.sourceId, sourceTitle: sourceTitle(origin) } });
      const tags = await db.strategyRecord.findFirst({ where: { ...where, id: `${PROFILE_ID}:tag:${body.sourceType}:${body.sourceId}` } });
      const sceneIds = origin.sceneId ? [origin.sceneId] : tags ? JSON.parse(tags.payload).sceneIds as string[] : [];
      if (sceneIds.length) await tx.strategyRecord.create({ data: { id: `${PROFILE_ID}:tag:evidence:${outcome.targetId}`, ...where, kind: "tag", title: "适用场景", payload: JSON.stringify({ subjectType: "evidence", subjectId: outcome.targetId, sceneIds }) } });
      if (body.sourceType === "skill") {
        const payload = skillSchema.parse(JSON.parse(origin.payload!));
        // Keep original evidence; additional evidence is linked below the skill.
        if (!payload.evidenceId) {
          payload.evidenceId = outcome.targetId;
          await tx.strategyRecord.update({ where: { id: origin.id }, data: { payload: JSON.stringify(payload) } });
          await tx.strategyVersion.create({ data: { id: crypto.randomUUID(), ...where, recordId: origin.id, kind: "skill", snapshot: JSON.stringify({ ...origin, kind: "skill", payload }) } });
        }
      }
    } else if (body.sourceType === "vision" || body.sourceType === "skill") {
      const payload = body.sourceType === "vision" ? visionSchema.parse(JSON.parse(origin.payload!)) : skillSchema.parse(JSON.parse(origin.payload!));
      if ("expected" in payload) payload.expected = body.content; else payload.improvement = body.content;
      await tx.strategyRecord.update({ where: { id: origin.id }, data: { title: body.title, payload: JSON.stringify(payload) } });
      await tx.strategyVersion.create({ data: { id: crypto.randomUUID(), ...where, recordId: origin.id, kind: body.sourceType, snapshot: JSON.stringify({ ...origin, kind: body.sourceType, title: body.title, payload }) } });
    } else {
      const fields = body.sourceType === "experience" ? { title: body.title, learning: body.content } : body.sourceType === "evidence" ? { ability: body.title, evidence: body.content } : body.sourceType === "assumption" ? { statement: body.title, evidence: body.content } : { name: body.title, description: body.content };
      const validated = parseEntity(body.sourceType, fields);
      const model = tx[body.sourceType] as unknown as { update: (args: unknown) => Promise<unknown> };
      await model.update({ where: { id: body.sourceId }, data: validated });
    }
    if (review) await tx.selfActionReview.update({ where: { id: review.id }, data: { applied: JSON.stringify([...applied, outcome]), deferred: false } });
  });
  return outcome;
}
