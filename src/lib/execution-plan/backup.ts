import { z } from "zod";
import { PROFILE_ID } from "../db";
import { payloadSchema, type Context } from "./shared";
import { validateEvidence, validateGraph } from "./validation";
import { sceneCount } from "../scenes";

export const executionBackupSchema = z.object({ id: z.string().min(1), profileId: z.string().optional(), revision: z.number().int().positive(), status: z.enum(["draft", "generating", "reviewing", "ready", "failed", "interrupted", "confirmed"]), snapshot: z.string(), fingerprint: z.string().min(1), payload: z.string(), leaseToken: z.string().nullable(), leaseUntil: z.coerce.date().nullable(), createdAt: z.coerce.date(), updatedAt: z.coerce.date() }).superRefine((row, ctx) => {
  try {
    if (row.profileId && row.profileId !== PROFILE_ID) throw new Error("归属无效");
    const payload = payloadSchema.parse(JSON.parse(row.payload)), context: Context = JSON.parse(row.snapshot);
    if (!Array.isArray(context.scenes) || ![6, sceneCount].includes(context.scenes.length) || new Set(context.scenes.map(scene => scene.id)).size !== context.scenes.length || !Array.isArray(context.sources)) throw new Error("资料快照无效");
    if (payload.draft) {
      validateGraph(payload.draft, context);
      if (payload.review) validateEvidence(payload.review.issues, context, payload.draft);
      if (new Set(payload.mapping.map(item => item.key)).size !== payload.mapping.length || payload.mapping.some(item => ![...payload.draft!.goals, ...payload.draft!.projects, ...payload.draft!.tasks].some(node => node.key === item.key))) throw new Error("规划映射无效");
    }
    if (row.status === "confirmed" && (!payload.draft || !payload.review || payload.confirmedRevision === null || !payload.mapping.length)) throw new Error("确认记录不完整");
  } catch { ctx.addIssue({ code: "custom", message: "执行规划快照或映射无效" }); }
});
export function restoredPlan(row: z.infer<typeof executionBackupSchema>) {
  const payload = payloadSchema.parse(JSON.parse(row.payload));
  const interrupted = ["generating", "reviewing"].includes(row.status);
  if (interrupted) { payload.error = "从备份恢复，调用已暂停，等待人工重试"; payload.review = null; payload.reviewRevision = null; }
  return { ...row, profileId: PROFILE_ID, status: interrupted ? "interrupted" : row.status, leaseToken: null, leaseUntil: null, payload: JSON.stringify(payload) };
}
