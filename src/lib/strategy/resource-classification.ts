import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { redact } from "../ai";
import { writeTransaction } from "../database-writes";
import { resourceState, writeResourceTag } from "./resource-operations";
import { capitalClassSchema, resourceLedgerSchema } from "./resource-shared";
import { requirementsPlanSchema } from "./capability-plan";

export const classificationRequestSchema = z.object({
  resourceIds: z.array(z.string().min(1).max(150)).max(100), includeDraft: z.boolean().default(true),
  allowSensitive: z.boolean().default(false), fingerprint: z.string().optional(),
});
export const classSuggestionSchema = z.object({ key: z.string().min(1).max(200), capitalClass: capitalClassSchema, reason: z.string().max(2000).default("") });
export const classSuggestionsSchema = z.array(classSuggestionSchema).max(112);
const where = { profileId: PROFILE_ID };
const draftId = `${PROFILE_ID}:resource-demand:draft`;

export async function resourceClassificationContext(db: PrismaClient, input: z.infer<typeof classificationRequestSchema>) {
  const scenes = await db.workbenchScene.findMany({ where });
  const states = await Promise.all([...new Set(input.resourceIds)].map((id) => resourceState(db, id)));
  const draftRecord = input.includeDraft ? await db.goalBatch.findFirst({ where: { id: draftId, ...where } }) : null;
  const draft = draftRecord ? JSON.parse(draftRecord.payload) : null;
  const plan = draft ? requirementsPlanSchema.parse(draft.result) : null;
  const visions = plan ? await db.strategyRecord.findMany({ where: { ...where, kind: "vision", id: { in: plan.resources.map((row) => row.visionId) } } }) : [];
  const entries = states.map((state) => ({ key: `resource:${state.resource.id}`, title: state.resource.name,
    content: { description: state.resource.description, ledger: state.ledger }, sceneIds: state.payload.sceneIds,
    version: [state.resource.updatedAt.toISOString(), state.tag?.updatedAt.toISOString() || null] }));
  for (const [index, row] of (plan?.resources || []).entries()) {
    const requestId = draft.requestIds[`resource:${index}`];
    if (row.capitalClass !== "待分类" || !requestId) continue;
    if (await db.goalBatch.findFirst({ where: { id: `${PROFILE_ID}:requirement:${requestId}`, ...where } })) continue;
    const vision = visions.find((item) => item.id === row.visionId);
    entries.push({ key: `draft:${requestId}`, title: row.title, content: { description: [row.reason, row.requirements, row.nextStep].join("\n"), ledger: resourceLedgerSchema.parse(row) }, sceneIds: vision?.sceneId ? [vision.sceneId] : [], version: [draftRecord!.createdAt.toISOString(), draftRecord!.payload, vision?.updatedAt.toISOString() || ""] });
  }
  if (!entries.length) throw new Error("没有可分类的资源或待选草稿");
  const sensitive = (entry: typeof entries[number]) => scenes.some((scene) => [1, 2, 3].includes(scene.slot) && entry.sceneIds.includes(scene.id)) || /家庭|孩子|收入|工资|健康|病史|财务|资产|组织|公司/.test(JSON.stringify({ title: entry.title, content: entry.content }));
  const scrub = (value: unknown) => JSON.parse(JSON.stringify(redact(value, "脱敏")).replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]").replace(/\b\d{17}[\dXx]\b/g, "[证件号已脱敏]"));
  const sources = entries.map((entry) => ({ key: entry.key, title: scrub(entry.title) as string,
    content: !input.allowSensitive && sensitive(entry) ? "[敏感资料未授权]" : scrub(entry.content), blocked: !input.allowSensitive && sensitive(entry) }));
  if (JSON.stringify(sources).length > 120000) throw new Error("分类资料过多，请精简资源说明后再试");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(entries)));
  const fingerprint = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { sources, fingerprint, states, draft, draftRecord, plan };
}
export async function confirmResourceClasses(db: PrismaClient, input: z.infer<typeof classificationRequestSchema>, suggestions: unknown) {
  const rows = classSuggestionsSchema.min(1).parse(suggestions), context = await resourceClassificationContext(db, input);
  if (input.fingerprint !== context.fingerprint) throw new Error("资源或草稿已变化，请重新预览分类");
  if (new Set(rows.map((row) => row.key)).size !== rows.length || rows.some((row) => !context.sources.some((source) => source.key === row.key))) throw new Error("分类记录无效");
  await writeTransaction(db, async (tx) => {
    let draftChanged = false;
    for (const row of rows) {
      if (row.key.startsWith("resource:")) {
        const state = context.states.find((item) => `resource:${item.resource.id}` === row.key)!;
        await writeResourceTag(tx, state.resource.id, { ...state.payload, ledger: resourceLedgerSchema.parse({ ...state.ledger, capitalClass: row.capitalClass }) });
      } else {
        const index = context.plan!.resources.findIndex((_, index) => `draft:${context.draft.requestIds[`resource:${index}`]}` === row.key);
        context.draft.result.resources[index] = { ...context.draft.result.resources[index], capitalClass: row.capitalClass,
          element: resourceLedgerSchema.parse({ ...context.draft.result.resources[index], capitalClass: row.capitalClass }).element };
        draftChanged = true;
      }
    }
    if (draftChanged) await tx.goalBatch.update({ where: { id: draftId }, data: { payload: JSON.stringify(context.draft) } });
  });
  return { saved: rows.length };
}
