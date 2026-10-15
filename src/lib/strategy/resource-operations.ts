import { z } from "zod";
import { sceneCount } from "../scenes";
import type { PrismaClient, Prisma } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { writeTransaction } from "../database-writes";
import { assertAIActionReady } from "./self-loop";
import { validateScene } from "./service";
import { resourceLedgerSchema, readResourceLedger } from "./resource-shared";
import { tagSchema } from "./shared";

const id = z.string().min(1).max(150), timestamp = z.string().datetime().nullable();
export const resourceSaveSchema = z.object({
  id: id.optional(), requestId: z.union([z.string().uuid(), z.string().regex(/^[a-f0-9]{32}$/)]), name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).default(""), sceneIds: z.array(id).max(sceneCount),
  ledger: resourceLedgerSchema, expectedUpdatedAt: timestamp, expectedLedgerUpdatedAt: timestamp,
});
const evaluationSchema = z.object({
  resourceId: id, actionId: id, reviewVersion: z.string().datetime(),
  expectedUpdatedAt: timestamp, expectedLedgerUpdatedAt: timestamp,
  actualInvestment: z.string().trim().min(1).max(10000), actualReturn: z.string().trim().min(1).max(10000),
  observation: z.string().trim().min(1).max(10000),
  available: z.string().trim().max(10000), availability: z.enum(["待获取", "可用", "受限", "不可用"]),
  adjustment: z.enum(["继续", "改进", "暂停", "重新配置"]), nextStep: z.string().trim().max(10000),
  nextCheckDate: z.string().date().nullable(),
});
const where = { profileId: PROFILE_ID };
export const resourceTagId = (resourceId: string) => `${PROFILE_ID}:tag:resource:${resourceId}`;

export async function writeResourceTag(tx: Prisma.TransactionClient, resourceId: string, payload: z.infer<typeof tagSchema>) {
  const snapshot = { id: resourceTagId(resourceId), kind: "tag", sceneId: null, title: "资源账本", archived: false, payload };
  await tx.strategyRecord.upsert({ where: { id: snapshot.id },
    create: { ...snapshot, ...where, payload: JSON.stringify(payload) },
    update: { title: snapshot.title, payload: JSON.stringify(payload) } });
  await tx.strategyVersion.create({ data: { id: crypto.randomUUID(), ...where, recordId: snapshot.id, kind: "tag", snapshot: JSON.stringify(snapshot) } });
}
export async function resourceState(db: PrismaClient, resourceId: string) {
  const resource = await db.resource.findFirst({ where: { id: resourceId, ...where } });
  if (!resource) throw new Error("资源不存在或不属于当前档案");
  const tag = await db.strategyRecord.findFirst({ where: { id: resourceTagId(resourceId), kind: "tag", ...where } });
  const payload = tagSchema.parse(tag ? JSON.parse(tag.payload) : { subjectType: "resource", subjectId: resourceId, sceneIds: [] });
  return { resource, tag, payload, ledger: readResourceLedger(payload.ledger, resource.category) };
}
function checkVersion(state: Awaited<ReturnType<typeof resourceState>>, expected: { expectedUpdatedAt: string | null; expectedLedgerUpdatedAt: string | null }) {
  if (state.resource.updatedAt.toISOString() !== expected.expectedUpdatedAt || (state.tag?.updatedAt.toISOString() || null) !== expected.expectedLedgerUpdatedAt)
    throw new Error("资源已变化，请重新打开后确认");
}
export function resourceCategory(availability: string, old = "其他") {
  return availability === "待获取" ? "待获取需求" : old === "待获取需求" && availability !== "待确认" ? "其他" : old;
}
export async function saveResource(db: PrismaClient, input: unknown) {
  const body = resourceSaveSchema.parse(input), receiptId = `${PROFILE_ID}:resource-save:${body.requestId}`;
  const receipt = await db.goalBatch.findFirst({ where: { id: receiptId, ...where } });
  if (receipt) { const old = JSON.parse(receipt.payload); if (old.input !== JSON.stringify(body)) throw new Error("重复请求内容不一致"); return old.result; }
  const state = body.id ? await resourceState(db, body.id) : null;
  if (state) checkVersion(state, body);
  else if (body.expectedUpdatedAt || body.expectedLedgerUpdatedAt) throw new Error("新资源版本无效");
  for (const sceneId of body.sceneIds) await validateScene(db, sceneId);
  const resourceId = body.id || `resource-${body.requestId}`;
  // Evaluation facts are only changed through the confirmed evaluation operation.
  const ledger = { ...body.ledger, actualReturn: state?.ledger.actualReturn || "", actualInvestment: state?.ledger.actualInvestment || "",
    observation: state?.ledger.observation || "", lastEvaluation: state?.ledger.lastEvaluation || null,
    adjustment: state?.ledger.adjustment || "待复盘" as const };
  const data = { name: body.name, description: body.description, category: resourceCategory(ledger.availability, state?.resource.category) };
  return writeTransaction(db, async (tx) => {
    if (state) await tx.resource.update({ where: { id: resourceId }, data });
    else await tx.resource.create({ data: { id: resourceId, ...where, ...data } });
    await writeResourceTag(tx, resourceId, tagSchema.parse({ subjectType: "resource", subjectId: resourceId, sceneIds: body.sceneIds, ledger }));
    const result = { id: resourceId };
    await tx.goalBatch.create({ data: { id: receiptId, ...where, payload: JSON.stringify({ input: JSON.stringify(body), result }) } });
    return result;
  });
}
export async function evaluateResource(db: PrismaClient, input: unknown) {
  const body = evaluationSchema.parse(input), state = await resourceState(db, body.resourceId);
  const action = await db.action.findFirst({ where: { id: body.actionId, ...where } });
  if (!action || action.status !== "已完成") throw new Error("请先完成关联任务");
  if (!await db.recordSource.findFirst({ where: { ...where, sourceType: "resource", sourceId: body.resourceId, targetType: "action", targetId: body.actionId } })) throw new Error("资源与任务未关联");
  await assertAIActionReady(db, body.actionId);
  const review = await db.selfActionReview.findFirst({ where: { ...where, actionId: body.actionId } });
  if (!review || review.updatedAt.toISOString() !== body.reviewVersion) throw new Error("复盘已变化或尚未保存，请重新打开评估");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([body.resourceId, review.id, body.reviewVersion])));
  const receiptId = `${PROFILE_ID}:resource-evaluation:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const receipt = await db.goalBatch.findFirst({ where: { id: receiptId, ...where } });
  if (receipt) { const old = JSON.parse(receipt.payload); if (old.input !== JSON.stringify(body)) throw new Error("本版复盘已确认更新，请查看评估历史"); return old.result; }
  checkVersion(state, body);
  const evaluation = { actionId: action.id, reviewId: review.id, reviewVersion: body.reviewVersion, evaluatedAt: new Date().toISOString(),
    actualInvestment: body.actualInvestment, actualReturn: body.actualReturn, observation: body.observation, adjustment: body.adjustment };
  const ledger = resourceLedgerSchema.parse({ ...state.ledger, ...body, lastEvaluation: evaluation });
  return writeTransaction(db, async (tx) => {
    await tx.resource.update({ where: { id: body.resourceId }, data: { category: resourceCategory(body.availability, state.resource.category) } });
    await writeResourceTag(tx, body.resourceId, { ...state.payload, ledger });
    const result = { id: body.resourceId, evaluatedAt: evaluation.evaluatedAt };
    await tx.goalBatch.create({ data: { id: receiptId, ...where, payload: JSON.stringify({ input: JSON.stringify(body), result }) } });
    return result;
  });
}
