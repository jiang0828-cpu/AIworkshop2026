import { z } from "zod";
import { dateSchema, shanghaiDate } from "../daily/shared";
import { situationAssessmentSchema } from "../schemas";
import { radarSchema, feedbackSchema } from "../research/radar";
import { resourceLedgerSchema } from "./resource-shared";
import { profileSceneSchema } from "./profile-scenes";
import { sceneCount } from "../scenes";
export { resourceLedgerSchema } from "./resource-shared";

const text = z.string().trim().max(10000).default("");
const identifier = z.string().min(1).max(150);
export const sceneId = z.string().max(150).nullable().default(null);
export const subjectTypes = ["goal", "project", "decision", "action", "experience", "evidence", "valueRule", "resource", "constraint", "assumption"] as const;
export const subjectType = z.enum(subjectTypes);
export const visionSchema = z.object({ expected: text, mainGoals: text, metric: text, horizon: text, boundary: text });
export const skillSchema = z.object({ evidenceId: sceneId, rating: z.number().int().min(1).max(5).nullable().default(null), improvement: text,
  category: z.enum(["assessment", "requirement"]).default("assessment"), importance: z.enum(["关键", "重要", "一般"]).default("重要"), importanceReason: text,
  requirementStatus: z.enum(["待推进", "进行中", "已达成", "暂缓"]).default("待推进"),
  layer: z.enum(["待分类", "底层自我管理", "中层杠杆能力", "高层专业能力"]).default("待分类"),
  method: z.enum(["待选择", "实战", "拜师", "阅读", "工具", "组合"]).default("待选择"), gap: text, resourceNeeds: text, successCriteria: text });
export const signalSchema = z.object({
  type: z.enum(["trend", "event", "opportunity", "threat", "benchmark"]), facts: text, judgement: text,
  source: text, observedAt: dateSchema, verification: z.enum(["待核验", "已核验", "存疑"]),
  impact: text, response: text, dimensions: text, gap: text, learning: text,
  goalId: sceneId, projectId: sceneId, decisionId: sceneId,
  radar: radarSchema.optional(), feedback: feedbackSchema.optional(),
});
export const tagSchema = z.object({ subjectType, subjectId: identifier, sceneIds: z.array(identifier).max(sceneCount), ledger: resourceLedgerSchema.optional() });
export const recordSchema = z.object({ id: identifier.optional(), kind: z.enum(["overallVision", "vision", "skill", "signal", "tag", "assessment", "profileScene"]),
  sceneId, title: z.string().trim().min(1).max(300), payload: z.unknown(), archived: z.boolean().default(false) });
export function parsePayload(kind: string, payload: unknown) {
  const schemas = { overallVision: visionSchema.pick({ expected: true, boundary: true }), vision: visionSchema, skill: skillSchema, signal: signalSchema, tag: tagSchema, assessment: situationAssessmentSchema, profileScene: profileSceneSchema };
  return schemas[kind as keyof typeof schemas].parse(payload);
}
export const sceneSchema = z.array(z.object({ id: identifier, name: z.string().trim().min(1).max(30), position: z.number().int().min(0).max(sceneCount - 1) })).length(sceneCount)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === sceneCount && new Set(rows.map((row) => row.position)).size === sceneCount && new Set(rows.map((row) => row.name)).size === sceneCount, "场景名称、顺序不可重复");
export const relationSchema = z.object({ fromId: identifier, toId: identifier, kind: z.enum(["promote", "conflict", "depend"]), evidence: text })
  .refine((row) => row.fromId !== row.toId, "不能关联同一个目标");
export const batchSchema = z.object({ requestId: identifier, parentId: identifier,
  goals: z.array(z.object({ title: z.string().trim().min(1).max(300), description: text, horizon: z.string().min(1).max(50),
    metric: text, deadline: z.string().nullable().default(null) })).min(1).max(10) });
export const selfSourceType = z.enum(["experience", "vision", "skill", "evidence", "resource", "constraint", "assumption"]);
export const sourceSchema = z.object({ sourceType: z.enum(["signal", "decision", ...selfSourceType.options]), sourceId: identifier });
export const appliedUpdateSchema = z.object({ sourceType: selfSourceType, sourceId: identifier, mode: z.enum(["evidence", "source"]), targetType: selfSourceType, targetId: identifier });
export type SelfReviewView = { id: string; actionId: string; result: string; adjustment: string; deferred: boolean; updatedAt?: string; applied: Array<z.infer<typeof appliedUpdateSchema>> };
export type Scene = { id: string; slot: number; name: string; position: number };
export type StrategyRecordView = { id: string; kind: "overallVision" | "vision" | "skill" | "signal" | "tag" | "assessment" | "profileScene"; sceneId: string | null; title: string;
  payload: Record<string, unknown>; archived: boolean; createdAt: string; updatedAt: string };
export type StrategyView = { scenes: Scene[]; records: StrategyRecordView[]; selfReviews?: SelfReviewView[];
  selfDailyResults?: Array<{ id: string; actionId: string | null; title: string; result: string; status: string; syncedAt: string | null; hasAI: boolean }>;
  versions: Array<{ id: string; recordId: string; kind: string; snapshot: string; createdAt: string }>;
  relations: Array<{ id: string; fromId: string; toId: string; kind: string; evidence: string }>;
  sources: Array<{ id: string; targetType: string; targetId: string; sourceType: string; sourceId: string; sourceTitle: string }>;
  pins: Array<{ taskKey: string; position: number; date: string }> };

export type LinkedRecord = { id: string; title?: string; name?: string; sceneId?: string | null; effectiveSceneId?: string; visionId?: string | null;
  goalId?: string | null; projectId?: string | null; parentId?: string | null; metric?: string; deadline?: string | Date | null; status?: string };
export function effectiveScene(row: LinkedRecord, goals: LinkedRecord[], projects: LinkedRecord[] = []): string | null {
  if (row.effectiveSceneId) return row.effectiveSceneId;
  if (row.sceneId) return row.sceneId;
  const project = projects.find((item) => item.id === row.projectId);
  if (project?.sceneId) return project.sceneId;
  return goals.find((item) => item.id === (project?.goalId || row.goalId))?.sceneId || null;
}
export function canonicalRelation(fromId: string, toId: string, kind: string) {
  return kind === "conflict" && fromId > toId ? { fromId: toId, toId: fromId } : { fromId, toId };
}
export function alignmentIssues(goals: LinkedRecord[], projects: LinkedRecord[], records: StrategyRecordView[], relations: StrategyView["relations"]) {
  const issues: Array<{ type: "goal" | "project"; id: string; title: string; reason: string }> = [];
  for (const [type, rows] of [["goal", goals], ["project", projects]] as const) for (const row of rows) {
    if (["已完成", "完成", "归档", "已取消"].includes(row.status || "")) continue;
    const reasons = [];
    if (!row.visionId || !records.some((record) => record.id === row.visionId && record.kind === "vision")) reasons.push("未关联愿景");
    if (!row.metric?.trim()) reasons.push("缺少指标");
    if (type === "goal" && !row.deadline) reasons.push("缺少截止时间");
    const parent = goals.find((goal) => goal.id === (row.parentId || row.goalId));
    if (row.sceneId && parent?.sceneId && row.sceneId !== parent.sceneId) reasons.push("与上级目标跨场景");
    if (type === "goal" && relations.some((relation) => relation.kind === "conflict" && [relation.fromId, relation.toId].includes(row.id))) reasons.push("存在目标冲突");
    for (const reason of reasons) issues.push({ type, id: row.id, title: row.title || row.name || "未命名", reason });
  }
  return issues;
}
export function recommendedTasks<T extends { key: string; status: string; group: string; overdue: boolean; dueAt: string | null; priority: number }>(tasks: T[], pins: StrategyView["pins"], now = new Date()): T[] {
  const end = new Date(`${shanghaiDate(now)}T23:59:59.999+08:00`);
  end.setUTCDate(end.getUTCDate() + 6);
  const deadline = (task: T) => task.dueAt ? new Date(task.dueAt).getTime() : Infinity;
  const active = tasks.filter((task) => task.group !== "done" && (task.overdue || deadline(task) <= end.getTime() || ["attention", "running"].includes(task.group) || ["待验收", "阻塞", "失败", "已阻塞", "出错"].includes(task.status)));
  const pinned = pins.filter((pin) => pin.date === shanghaiDate(now)).sort((a, b) => a.position - b.position);
  const byKey = new Map(active.map((task) => [task.key, task]));
  const chosen = pinned.map((pin) => byKey.get(pin.taskKey)).filter((task): task is T => Boolean(task));
  const rest = active.filter((task) => !chosen.some((item) => item.key === task.key)).sort((a, b) => deadline(a) - deadline(b) || a.priority - b.priority || a.key.localeCompare(b.key));
  return [...chosen, ...rest].slice(0, 3);
}
