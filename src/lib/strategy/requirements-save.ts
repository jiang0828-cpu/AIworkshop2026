import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { writeTransaction } from "../database-writes";
import { demandSkillSchema, resourceDemandSchema } from "./capability-plan";
import { skillSchema, tagSchema, resourceLedgerSchema } from "./shared";
import { own } from "./service";

export const requirementSaveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skill"), requestId: z.string().min(1).max(100), mode: z.enum(["new", "supplement", "reuse"]), demand: demandSkillSchema }),
  z.object({ kind: z.literal("resource"), requestId: z.string().min(1).max(100), mode: z.enum(["new", "supplement", "reuse"]), demand: resourceDemandSchema }),
]);

// Called under the shared write lock. The receipt and all business writes commit together.
export async function saveRequirement(db: PrismaClient, input: unknown) {
  const body = requirementSaveSchema.parse(input), demand = body.demand;
  const receiptId = `${PROFILE_ID}:requirement:${body.requestId}`;
  const serialized = JSON.stringify(body);
  const receipt = await db.goalBatch.findUnique({ where: { id: receiptId } });
  if (receipt) {
    const previous = JSON.parse(receipt.payload);
    if (JSON.stringify(requirementSaveSchema.parse(JSON.parse(previous.input))) !== serialized) throw new Error("重复请求内容不一致，请重新确认");
    return previous.result as { id: string; type: string };
  }
  const vision = await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, id: demand.visionId, kind: { in: ["vision", "overallVision"] }, archived: false } });
  if (!vision) throw new Error("愿景不存在或不属于当前档案");
  const match = body.mode === "new" ? null : demand.match;
  if (body.mode !== "new" && !match) throw new Error("请选择要复用或补充的已有记录");
  if (match && (body.kind === "resource" ? match.type !== "resource" : match.type === "resource")) throw new Error("匹配类型不一致");
  if (match) await own(db, match.type, match.id);
  const note = `愿景：${vision.title}\n依据：${demand.reason}\n重要性：${demand.importance}\n时间进度：${demand.timing}\n具体需求：${demand.requirements}\n已有基础与缺口：${demand.matchReason}`;
  let result = { id: match?.id || crypto.randomUUID(), type: match?.type || body.kind };
  const skill = body.kind === "skill" && match?.type === "skill" ? await db.strategyRecord.findFirst({ where: { profileId: PROFILE_ID, kind: "skill", archived: false, id: match.id } }) : null;
  // Evidence can already belong to a capability. Reuse that capability instead of copying it.
  const linkedSkills = body.kind === "skill" && match?.type === "evidence" ? await db.strategyRecord.findMany({ where: { profileId: PROFILE_ID, kind: "skill", archived: false } }) : [];
  const evidenceLinks = match?.type === "evidence" ? await db.recordSource.findMany({ where: { profileId: PROFILE_ID, targetType: "evidence", targetId: match.id, sourceType: "skill" } }) : [];
  const existingSkill = match?.type === "skill" ? skill : linkedSkills.find((row) => JSON.parse(row.payload).evidenceId === match?.id || evidenceLinks.some((link) => link.sourceId === row.id)) || null;
  if (match?.type === "skill" && !existingSkill) throw new Error("能力已归档，请重新匹配");
  const existingResource = body.kind === "resource" && match ? await db.resource.findFirstOrThrow({ where: { id: match.id, profileId: PROFILE_ID } }) : null;
  const existingTag = existingResource ? await db.strategyRecord.findUnique({ where: { id: `${PROFILE_ID}:tag:resource:${existingResource.id}` } }) : null;
  await writeTransaction(db, async (tx) => {
    const record = async (id: string, kind: string, title: string, sceneId: string | null, payload: unknown) => {
      const snapshot = { id, kind, title, sceneId, payload, archived: false };
      await tx.strategyRecord.upsert({ where: { id }, create: { ...snapshot, payload: JSON.stringify(payload), profileId: PROFILE_ID }, update: { title, sceneId, payload: JSON.stringify(payload) } });
      await tx.strategyVersion.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, recordId: id, kind, snapshot: JSON.stringify(snapshot) } });
    };
    if (body.mode !== "reuse" && body.kind === "skill") {
      const row = body.demand;
      result = { id: existingSkill?.id || crypto.randomUUID(), type: "skill" };
      const addition = `${note}\n实现渠道：${row.channels}\n能力缺口：${row.gap}\n所需投入：${row.resourceNeeds}\n验证标准：${row.successCriteria}\n行动计划：${row.plan}\n建议项目：${row.project.name}；${row.project.description}；${row.project.metric}\n任务：\n${row.tasks.map((task) => `${task.title}（${task.executor}）；前置：${task.dependency}；验收：${task.standard}`).join("\n")}`;
      const payload = existingSkill ? skillSchema.parse(JSON.parse(existingSkill.payload)) : skillSchema.parse({ category: "requirement", evidenceId: match?.type === "evidence" ? match.id : null, layer: row.layer, method: row.method, importance: row.importance, importanceReason: row.importanceReason, gap: row.gap, resourceNeeds: row.resourceNeeds, successCriteria: row.successCriteria });
      payload.improvement = [payload.improvement, addition].filter(Boolean).join("\n\n");
      await record(result.id, "skill", existingSkill?.title || row.title, existingSkill ? existingSkill.sceneId : vision.sceneId, skillSchema.parse(payload));
    } else if (body.mode !== "reuse" && body.kind === "resource") {
      const row = body.demand;
      result = { id: existingResource?.id || crypto.randomUUID(), type: "resource" };
      const description = [existingResource?.description, note, `建议投入：${row.allocation}\n底线：${row.boundary}\n验证标准：${row.expectedReturn}\n下一步：${row.nextStep}`].filter(Boolean).join("\n\n");
      if (description.length > 10000) throw new Error("资源内容过长，请精简需求后保存");
      if (existingResource) await tx.resource.update({ where: { id: result.id }, data: { description } });
      else await tx.resource.create({ data: { id: result.id, profileId: PROFILE_ID, name: row.title, description, category: "待获取需求" } });
      const payload = existingTag ? tagSchema.parse(JSON.parse(existingTag.payload)) : tagSchema.parse({ subjectType: "resource", subjectId: result.id, sceneIds: !existingResource && vision.sceneId ? [vision.sceneId] : [], ledger: resourceLedgerSchema.parse(existingResource ? {} : { element: row.element, capitalClass: row.capitalClass, importance: row.importance, availability: "待获取", available: "待获取（需求，非已有存量）", allocation: row.allocation, boundary: row.boundary, expectedReturn: row.expectedReturn, nextStep: row.nextStep }) });
      await record(`${PROFILE_ID}:tag:resource:${result.id}`, "tag", existingTag?.title || "资源配置账本", null, payload);
    }
    // Preserve the source relationship even when no content changes are needed.
    const sourceType = vision.kind === "overallVision" ? "overallVision" : "vision";
    const link = await db.recordSource.findFirst({ where: { profileId: PROFILE_ID, sourceType, sourceId: vision.id, targetType: result.type, targetId: result.id } });
    if (!link) await tx.recordSource.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, sourceType, sourceId: vision.id, sourceTitle: vision.title, targetType: result.type, targetId: result.id } });
    await tx.goalBatch.create({ data: { id: receiptId, profileId: PROFILE_ID, payload: JSON.stringify({ input: serialized, result }) } });
  });
  return result;
}
