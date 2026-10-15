import { z } from "zod";
import { backgroundSchema, conclusionSchema, sourceSchema } from "../research/shared";
import { radarSchema } from "../research/radar";
import { newsConfigSchema, newsRunSchema, newsUsageSchema, newsSourceSchema } from "./news-shared";
export const kinds = ["topic", "information", "analysis", "judgement", "judgementVersion", "response", "verification", "rule", "report", "job", "reference", "history", "newsConfig", "newsRun", "newsUsage", "newsSource"] as const;
export type Kind = typeof kinds[number];
const text = z.string().trim().max(12000).default("");
const id = z.string().min(1).max(300);
const date = z.union([z.literal(""), z.string().date()]).default("");
export const assessmentInputSchema=z.object({id,recordId:id,kind:z.enum(["analysis","judgementVersion"]),version:z.number().int().positive(),title:z.string().max(300),facts:z.string().max(4000),relevance:z.string().max(4000),nextStep:z.string().max(2000),uncertainty:z.string().max(3000)});
export const schemas = {
  newsConfig: newsConfigSchema, newsRun: newsRunSchema, newsUsage: newsUsageSchema, newsSource:z.object({source:newsSourceSchema}),
  topic: z.object({ question: text, dimension: radarSchema.shape.dimension, reviewDate: date }),
  information: z.object({ source: sourceSchema, facts: text, notes: text, verification: z.enum(["待核验", "已核验", "存疑"]).default("待核验"), revisionOf: id.optional(), observation: z.object({ nature:z.enum(["亲眼观察","亲身经历","他人转述","小道消息"]), occurredOn:z.string().date().or(z.literal("")), signal:text, alternative:text, nextCheck:text }).optional() }),
  analysis: z.object({ sources: z.array(sourceSchema).max(15), informationIds: z.array(id).max(15), background: z.array(backgroundSchema).max(20).default([]), conclusion: conclusionSchema, gaps: text, batchId: id.optional(), revisionJudgementId: id.optional(), revisionVersion: z.number().int().positive().optional() }),
  judgement: z.object({ currentVersionId: id }),
  judgementVersion: z.object({ sources: z.array(sourceSchema).max(15), informationIds: z.array(id).max(15), background: z.array(backgroundSchema).max(20).default([]), conclusion: conclusionSchema, gaps: text, analysisId: id.optional(), number: z.number().int().positive(), confirmed: z.boolean(), legacySourceType: z.string().optional(), legacySourceId: z.string().optional() }),
  response: z.object({ judgementVersionId: id, purpose: z.enum(["verify", "respond"]), category: radarSchema.shape.responseType, proposal: text, targetType: z.enum(["action", "decision"]).default("decision"), targetId: z.string().default(""), adjustmentType: z.enum(["goal", "project", "resource", "skill", "none"]).default("none"), adjustmentId: z.string().default(""), standard: text, dueDate: date, reversibleStep: text, stopCondition: text }),
  verification: z.object({ judgementVersionId: id, actual: z.string().trim().min(1).max(12000), outcome: z.enum(["符合", "偏离", "尚不能判断"]), reason: text, effectiveness: z.enum(["有效", "无效", "尚未执行", "尚不能判断"]).default("尚不能判断"), effectEvidence: text, adjustment: text, nextDate: date }),
  rule: z.object({ verificationId: id, content: z.string().trim().min(1).max(12000), conditions: text, exceptions: text, revisions: z.array(z.object({ content: text, conditions: text, exceptions: text, at: z.string() })).default([]) }),
  report: z.object({ period: z.enum(["week", "month", "quarter", "year"]), start: z.string().date(), end: z.string().date(), summary: z.array(z.object({ id, title: z.string(), text: z.string() })).max(5), markdown: z.string().max(5000000), recordIds: z.array(id) }),
  job: z.object({ batchId: id, mode: z.enum(["collect", "analyze"]), informationIds: z.array(id).default([]), assessments:z.array(assessmentInputSchema).max(15).default([]), published: z.boolean().default(false) }),
  reference: z.object({ judgementVersionId: id, targetType: z.enum(["goal", "review"]), targetId: id }),
  history: z.object({ sourceType: text, sourceId: text, content: z.string().max(1000000) }),
};
export const saveSchema = z.object({ requestId: z.string().uuid(), id: id.optional(), version: z.number().int().positive().optional(), title: z.string().trim().min(1).max(300), sceneId: z.string().nullable().default(null), topicId: z.string().nullable().default(null), payload: z.unknown() });
export type RadarRow = { id: string; kind: Kind; title: string; sceneId: string | null; topicId: string | null; parentId: string | null; status: string; version: number; payload: Record<string, unknown>; originKey: string | null; createdAt: string; updatedAt: string };
export const tabs: Array<[string, string]> = [["collect", "信息采集"], ["analyze", "信息分析"], ["judge", "形势判断"], ["respond", "决策应变"]];
export const tabKinds: Record<string, Kind[]> = { collect: ["information"], analyze: ["analysis"], judge: ["judgement"], respond: ["response"], verify: ["verification"] };
export const statusLabels: Record<string, string> = { draft: "草稿", active: "有效", confirmed: "已确认", archived: "已归档", pending: "待确认", linked: "已关联", disabled: "已停用", queued: "排队", review: "待确认", failed: "失败", collecting: "收集中", analyzing: "分析中" };
export function periodRange(period: "week" | "month" | "quarter" | "year", day: string) {
  z.string().date().parse(day); const d = new Date(`${day}T00:00:00Z`), start = new Date(d);
  if (period === "week") start.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  if (period === "month") start.setUTCDate(1);
  if (period === "quarter") { start.setUTCDate(1); start.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3); }
  if (period === "year") { start.setUTCDate(1); start.setUTCMonth(0); }
  const end = new Date(start);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 7);
  else end.setUTCMonth(end.getUTCMonth() + (period === "year" ? 12 : period === "quarter" ? 3 : 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), from: new Date(`${start.toISOString().slice(0, 10)}T00:00:00+08:00`), to: new Date(`${end.toISOString().slice(0, 10)}T00:00:00+08:00`) };
}
