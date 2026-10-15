import { z } from "zod";
import { sceneCount } from "../scenes";

const id = z.string().trim().min(1).max(150);
const text = z.string().trim().max(5000);
const required = text.min(1);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "日期无效");
export const capacitySchema = z.object({ startDate: dateSchema, weeklyHours: z.number().positive().max(168).nullable(), weekdays: z.array(z.number().int().min(0).max(6)).max(7).transform(value => [...new Set(value)]), budget: z.number().nonnegative().max(1e9).nullable(), budgetNote: text.default("") });
export const inputSchema = z.object({ capacity: capacitySchema, allowSensitive: z.boolean().default(false), signalIds: z.array(id).max(20).default([]), instruction: text.default("") });
const common = { key: id, title: z.string().trim().min(1).max(300), sceneId: id, reason: required, sources: z.array(id).min(1).max(20), priority: z.number().int().min(1).max(3), selected: z.boolean().default(true), deferred: z.boolean().default(false), deferReason: text.default(""), mode: z.enum(["new", "reuse", "update"]).default("new"), matchId: id.nullable().default(null), matchReason: text.default(""), updateFields: z.array(id).max(20).default([]) };
export const goalSchema = z.object({ ...common, visionId: id, description: required, metric: required, horizon: z.enum(["10年", "5年", "3年", "1年", "90天", "本周"]), deadline: dateSchema.nullable(), parentKey: id.nullable().default(null) });
export const projectSchema = z.object({ ...common, goalKey: id, description: required, metric: required, budget: required, budgetAmount: z.number().nonnegative().nullable(), boundary: required, risk: required, stopCondition: required, capabilities: z.array(required).max(15), resources: z.array(required).max(15), milestones: z.array(z.object({ title: z.string().trim().min(1).max(300), metric: required, deadline: dateSchema.nullable() })).min(1).max(12) });
export const taskSchema = z.object({ ...common, projectKey: id, standard: required, executor: z.enum(["人工", "AI", "混合"]), estimatedHours: z.number().positive().max(168), dueDate: dateSchema.nullable(), dependencies: z.array(id).max(30), conditions: z.array(required).max(15) });
export const draftSchema = z.object({ summary: required, coverage: z.array(z.object({ sceneId: id, status: z.enum(["planned", "deferred"]), reason: required })).min(1).max(sceneCount), goals: z.array(goalSchema).min(1).max(36), projects: z.array(projectSchema).min(1).max(36), tasks: z.array(taskSchema).min(1).max(80) });
export const issueSchema = z.object({ id, nodeKey: id.nullable(), kind: z.enum(["structure", "capacity", "date", "dependency", "duplicate", "violation", "inference", "unknown"]), message: required, advice: required, evidence: z.object({ sourceId: id, quote: required }).nullable(), origin: z.enum(["rule", "ai"]).default("ai") });
export const reviewSchema = z.object({ summary: required, issues: z.array(issueSchema).max(150) });
export const resolutionSchema = z.object({ issueId: id, decision: z.enum(["accept", "defer", "exclude"]), reason: required });
export const mappingSchema = z.object({ key: id, type: z.enum(["goal", "project", "action"]), id, mode: z.enum(["new", "reuse", "update"]), deferred: z.boolean(), dependencies: z.array(id), cleared: z.boolean().default(false), clearance: text.default(""), executor: z.enum(["人工", "AI", "混合"]).optional() });
export const payloadSchema = z.object({ input: inputSchema, draft: draftSchema.nullable().default(null), review: reviewSchema.nullable().default(null), resolutions: z.array(resolutionSchema).default([]), reviewRevision: z.number().int().nullable().default(null), mapping: z.array(mappingSchema).default([]), confirmedRevision: z.number().int().nullable().default(null), error: text.default(""), logs: z.array(z.object({ stage: z.enum(["generate", "review"]), model: text, durationMs: z.number().nonnegative(), promptTokens: z.number().nonnegative().nullable(), completionTokens: z.number().nonnegative().nullable(), at: z.string() })).default([]) });
export type Draft = z.infer<typeof draftSchema>;
export type PlanInput = z.infer<typeof inputSchema>;
export type PlanPayload = z.infer<typeof payloadSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Source = { id: string; type: string; recordId: string; title: string; content: string; blocked: boolean };
export type Context = { sources: Source[]; scenes: Array<{ id: string; name: string; slot: number }>; missing: string[]; fingerprint: string; sentInput?: PlanInput };
export const nodes = (draft: Draft) => [...draft.goals, ...draft.projects, ...draft.tasks];
export const jsonOutput = (output: string): unknown => JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
export function effectiveSelection(draft: Draft) {
  const selected = new Set(nodes(draft).filter(node => node.selected).map(node => node.key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of [...draft.goals, ...draft.projects, ...draft.tasks]) {
      const parent = "goalKey" in node ? node.goalKey : "projectKey" in node ? node.projectKey : node.parentKey;
      if (parent && !selected.has(parent) && selected.delete(node.key)) changed = true;
    }
  }
  return selected;
}
export function isDeferred(draft: Draft, key: string): boolean {
  const node = nodes(draft).find(row => row.key === key);
  if (!node) return false;
  if (node.deferred) return true;
  const parent = "goalKey" in node ? node.goalKey : "projectKey" in node ? node.projectKey : node.parentKey;
  return Boolean(parent && isDeferred(draft, parent));
}
