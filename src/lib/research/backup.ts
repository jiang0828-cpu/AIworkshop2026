import { z } from "zod";
import { backgroundSchema, conclusionSchema, sourceSchema, validateAnalysis } from "./shared";
import { publicUrl } from "./provider";
const json = <T extends z.ZodTypeAny>(schema: T) => z.string().superRefine((value, ctx) => { try { schema.parse(JSON.parse(value)); } catch { ctx.addIssue({ code: "custom", message: "研判快照无效" }); } });
export const researchBackupSchema = z.object({
  id: z.string().min(1), profileId: z.string().optional(), sceneId: z.string().nullable(), question: z.string().min(1).max(1000),
  background: json(z.array(backgroundSchema).max(20)), queries: json(z.array(z.string().max(180)).max(3)), days: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]), online: z.boolean(), previousId: z.string().nullable(),
  status: z.enum(["queued", "collecting", "analyzing", "review", "failed"]), phase: z.number().int().min(0).max(3), version: z.number().int().min(1),
  slot: z.number().nullable(), leaseToken: z.string().nullable(), leaseUntil: z.coerce.date().nullable(), leaseUntilSeconds: z.number().int().nullable().default(null),
  sources: json(z.array(sourceSchema).max(15)), conclusions: json(z.array(conclusionSchema).max(5)), gaps: z.string().max(8000), changes: z.string().max(8000),
  calls: json(z.array(z.object({ stage: z.string().max(100), status: z.enum(["running", "done", "failed"]), durationMs: z.number().optional(), credits: z.number().nullable().optional(), promptTokens: z.number().nullable().optional(), completionTokens: z.number().nullable().optional() })).max(1000)),
  error: z.string().max(4000), followUpDate: z.string().date().nullable(), createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
}).superRefine((data, ctx) => {
  try {
    const sources = z.array(sourceSchema).parse(JSON.parse(data.sources));
    for (const source of sources) if (source.url) publicUrl(source.url);
    if (new Set(sources.map((source) => source.id)).size !== sources.length) throw new Error("重复来源编号");
    validateAnalysis({ conclusions: JSON.parse(data.conclusions), gaps: data.gaps, changes: data.changes }, sources, JSON.parse(data.background));
  } catch { ctx.addIssue({ code: "custom", message: "研判来源或引用无效" }); }
});
