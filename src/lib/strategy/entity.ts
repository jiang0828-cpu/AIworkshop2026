import { z } from "zod";
import type { StrategyDB } from "./service";
import { own, validateScene } from "./service";
import { PROFILE_ID } from "../db";
import { sourceSchema, subjectType } from "./shared";
import { situationAssessmentSchema } from "../schemas";
import { canRespond } from "../research/radar";
import { hierarchyIssue } from "../goal-hierarchy";
import { sameContainer } from "../record-hierarchy";
import { taskRecurrences } from "../task-schedule";
import { sceneCount } from "../scenes";

const text = z.string().max(10000);
const id = z.string().max(150).nullable();
const date = z.union([z.date(), z.string(), z.null()]).transform((value, ctx) => {
  if (!value) return null;
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) { ctx.addIssue({ code: "custom", message: "日期无效" }); return z.NEVER; }
  return result;
});
const linkage = { sceneId: id, visionId: id };
const fields: Record<string, z.ZodRawShape> = {
  experience: { title: text, description: text, learning: text, happenedAt: date },
  evidence: { ability: text, evidence: text, confidence: z.number().int().min(1).max(5) },
  valueRule: { value: text, priority: z.number().int().min(1).max(5), rule: text, conflict: text },
  resource: { name: text, description: text, category: text }, constraint: { name: text, description: text, severity: text },
  assumption: { statement: text, status: text, evidence: text },
  goal: { ...linkage, title: text, description: text, horizon: text, metric: text, status: text, deadline: date, parentId: id },
  project: { ...linkage, parentId: id, goalId: id, name: text, description: text, status: text, metric: text, deadline: date, budget: text, boundary: text, stopCondition: text, risk: text },
  action: { sceneId: id, parentId: id, goalId: id, projectId: id, title: text, purpose: text, dueDate: date, recurrence: z.enum(taskRecurrences), estimatedHours: z.number().nonnegative().max(100000), standard: text, status: text, completedAt: date },
  milestone: { projectId: z.string().min(1), title: text, deadline: date, status: text, metric: text },
  decision: { ...linkage, goalId: id, signalId: id, title: text, context: text, criteria: text, facts: text, assumptions: text, gaps: text,
    selectedOption: text, rationale: text, risk: text, reversible: z.boolean(), reviewDate: date, resultReview: text, status: text, options: text },
  decisionOption: { decisionId: z.string().min(1), name: text, benefit: text, cost: text, risk: text, score: z.number().int().min(0).max(100) },
  review: { periodStart: date, periodEnd: date, wins: text, goalIssue: text, strategyIssue: text, executionIssue: text, externalIssue: text, adjustment: text },
};
export function parseEntity(type: string, input: unknown) {
  if (!fields[type]) throw new Error("记录类型无效");
  const required: Record<string, string[]> = { experience: ["title"], evidence: ["ability", "evidence"], valueRule: ["value"], resource: ["name"], constraint: ["name"], assumption: ["statement"], goal: ["title"], project: ["name"], action: ["title"], milestone: ["title"], decision: ["title"], decisionOption: ["name"] };
  const shape = { ...fields[type] };
  for (const field of required[type] || []) shape[field] = text.trim().min(1, "必填内容不能为空");
  return z.object(shape).partial().strict().parse(input) as Record<string, unknown>;
}
export async function validateEntityLinks(db: StrategyDB, type: string, values: Record<string, unknown>, existing: Record<string, unknown> | null, crossScene: boolean) {
  const merged = { ...existing, ...values };
  if (type === "project" || type === "action") {
    const parent = merged.parentId ? await own(db, type, merged.parentId) as Record<string, unknown> : null;
    if (parent && !existing) {
      for (const key of type === "project" ? ["goalId", "sceneId", "visionId"] : ["goalId", "projectId", "sceneId"]) {
        if (values[key] === undefined) values[key] = parent[key] || null;
      }
      Object.assign(merged, values);
    }
    await validateNestedLinks(db, type, merged);
  }
  if (type === "review") {
    const start = merged.periodStart ? new Date(String(merged.periodStart)) : null;
    const end = merged.periodEnd ? new Date(String(merged.periodEnd)) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error("请填写有效的复盘日期，结束日期不能早于开始日期");
  }
  if (type === "goal" && !existing && merged.parentId && values.sceneId === undefined) {
    const parent = await db.goal.findFirst({ where: { id: String(merged.parentId), profileId: PROFILE_ID } });
    if (!parent) throw new Error("上级目标不存在");
    values.sceneId = parent.sceneId;
    if (values.visionId === undefined) values.visionId = parent.visionId;
  }
  if (type === "goal") {
    if ((!existing || values.sceneId !== undefined) && !(values.sceneId === undefined ? merged.sceneId : values.sceneId)) {
      const other = await db.workbenchScene.findFirst({ where: { profileId: PROFILE_ID, slot: 4 } });
      if (!other) throw new Error("请选择目标的主场景");
      values.sceneId = other.id;
    }
    Object.assign(merged, values);
  }
  await validateScene(db, merged.sceneId);
  for (const [key, related] of [["visionId", "vision"], ["goalId", "goal"], ["parentId", type], ["projectId", "project"], ["signalId", "signal"], ["decisionId", "decision"]]) if (merged[key]) await own(db, related, merged[key]);
  if (type === "project" && merged.goalId) {
    const goal = await db.goal.findUniqueOrThrow({ where: { id: String(merged.goalId) } });
    if (!existing && values.sceneId === undefined) values.sceneId = goal.sceneId;
    if (!existing && values.visionId === undefined && values.sceneId === goal.sceneId) values.visionId = goal.visionId;
    const newScene = values.sceneId === undefined ? merged.sceneId : values.sceneId;
    if (newScene && goal.sceneId && newScene !== goal.sceneId && !crossScene) throw new Error("跨场景项目需要明确确认");
  }
  const scene = values.sceneId === undefined ? merged.sceneId : values.sceneId;
  const visionId = values.visionId === undefined ? merged.visionId : values.visionId;
  if (visionId) {
    const vision = await db.strategyRecord.findUniqueOrThrow({ where: { id: String(visionId) } });
    if (vision.sceneId !== scene) throw new Error("愿景与主场景不一致");
  }
  if (type === "goal" && merged.parentId) {
    if (merged.parentId === merged.id) throw new Error("目标不能作为自己的父目标");
    let cursor: string | null = String(merged.parentId);
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor) || cursor === merged.id) throw new Error("目标层级存在循环");
      seen.add(cursor);
      cursor = (await db.goal.findFirst({ where: { id: cursor, profileId: PROFILE_ID } }))?.parentId || null;
    }
  }
  if (type === "goal" && (!existing || ["parentId", "sceneId", "horizon"].some((key) => values[key] !== undefined && values[key] !== existing[key]))) {
    const candidate = { ...merged, ...values, id: String(merged.id || "draft") };
    const fallback = `${PROFILE_ID}-scene-4`;
    if (merged.parentId) {
      const parent = await db.goal.findUniqueOrThrow({ where: { id: String(merged.parentId) } });
      const issue = hierarchyIssue(candidate, parent, fallback);
      if (issue) throw new Error(`${issue}，请选择同场景且周期更长的上级目标，或设为顶层目标`);
    }
    if (existing?.id) {
      const children = await db.goal.findMany({ where: { profileId: PROFILE_ID, parentId: String(existing.id) } });
      for (const child of children) {
        const issue = hierarchyIssue(child, candidate, fallback);
        if (issue) throw new Error(`与子目标“${child.title}”关系不一致：${issue}，请先调整子目标`);
      }
    }
  }
  if (type === "action" && merged.projectId && merged.goalId) {
    const project = await db.project.findUniqueOrThrow({ where: { id: String(merged.projectId) } });
    if (project.goalId && project.goalId !== merged.goalId) throw new Error("行动的目标与项目不一致");
  }
}
export async function validateNestedLinks(db: StrategyDB, type: "project" | "action", row: Record<string, unknown>) {
  const model = db[type] as unknown as { findMany: (args: unknown) => Promise<Array<{ id: string; parentId: string | null; goalId: string | null; projectId?: string | null }>> };
  const rows = await model.findMany({ where: { profileId: PROFILE_ID } });
  const candidate = { ...row, id: String(row.id || "draft"), goalId: row.goalId as string | null, projectId: row.projectId as string | null };
  const label = type === "project" ? "项目" : "任务";
  let cursor = row.parentId as string | null;
  const seen = new Set([candidate.id]);
  while (cursor) {
    if (seen.has(cursor)) throw new Error(`${label}层级存在循环，不能关联自身或下级`);
    seen.add(cursor);
    const parent = rows.find(item => item.id === cursor);
    if (!parent) throw new Error(`上级${label}不存在或不属于当前档案`);
    if (!sameContainer(candidate, parent, type)) throw new Error(type === "project" ? "父子项目须属于同一目标，请先调整所属目标" : "父子任务须属于同一项目和目标，请先调整所属关系");
    cursor = parent.parentId;
  }
  for (const child of rows.filter(item => item.parentId === candidate.id)) if (!sameContainer(candidate, child, type)) throw new Error(`请先调整子${label}的所属关系，再移动当前${label}`);
}
export async function ownEntity(db: StrategyDB, type: string, id: string) {
  if (type === "milestone") {
    const row = await db.milestone.findFirst({ where: { id, project: { profileId: PROFILE_ID } } });
    if (!row) throw new Error("里程碑不存在"); return row;
  }
  if (type === "decisionOption") {
    const row = await db.decisionOption.findFirst({ where: { id, decision: { profileId: PROFILE_ID } } });
    if (!row) throw new Error("决策选项不存在"); return row;
  }
  return own(db, type, id);
}
export async function attachSource(db: StrategyDB, type: string, targetId: string, input: unknown) {
  if (!input) return;
  const source = sourceSchema.parse(input), row = await own(db, source.sourceType, source.sourceId);
  if (source.sourceType === "signal" && ["decision", "action"].includes(type) && (!row || !("payload" in row) || !canRespond(JSON.parse(row.payload).radar))) throw new Error("请先补充研判置信度及依据；低置信度仅观察核实");
  await db.recordSource.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, targetType: type, targetId, ...source,
    sourceTitle: row?.title || "来源记录" } });
}

export async function validateTags(db: StrategyDB, type: string, data: Record<string, unknown>) {
  const input = data._sceneIds; delete data._sceneIds;
  if (input === undefined) return undefined;
  if (!["experience", "evidence", "valueRule", "resource", "constraint", "assumption"].includes(type)) throw new Error("此记录使用主场景分类");
  const ids = z.array(z.string().min(1)).max(sceneCount).refine((rows) => new Set(rows).size === rows.length, "标签不可重复").parse(input);
  for (const id of ids) await validateScene(db, id);
  return ids;
}

export async function writeTags(tx: StrategyDB, type: string, subjectId: string, sceneIds: string[] | undefined) {
  if (!sceneIds) return;
  const [previous] = await tx.strategyRecord.findMany({ where: { id: `${PROFILE_ID}:tag:${type}:${subjectId}`, profileId: PROFILE_ID } });
  const ledger = previous ? JSON.parse(previous.payload).ledger : undefined;
  const snapshot = { id: `${PROFILE_ID}:tag:${type}:${subjectId}`, kind: "tag", title: "场景标签", sceneId: null, archived: false,
    payload: { subjectType: subjectType.parse(type), subjectId, sceneIds, ...(ledger ? { ledger } : {}) } };
  const payload = JSON.stringify(snapshot.payload);
  await tx.strategyRecord.upsert({ where: { id: snapshot.id }, create: { ...snapshot, profileId: PROFILE_ID, payload }, update: { payload } });
  await tx.strategyVersion.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, recordId: snapshot.id, kind: snapshot.kind, snapshot: JSON.stringify(snapshot) } });
}

export async function writeAssessment(tx: StrategyDB, input: unknown) {
  const parsed = situationAssessmentSchema.parse(input);
  const result = await tx.situationAssessment.upsert({ where: { profileId: PROFILE_ID }, update: parsed, create: { profileId: PROFILE_ID, ...parsed } });
  const snapshot = { id: `${PROFILE_ID}:assessment`, kind: "assessment", title: "本周态势、企业与个人影响", sceneId: null, payload: parsed, archived: false };
  await tx.strategyRecord.upsert({ where: { id: snapshot.id }, create: { ...snapshot, profileId: PROFILE_ID, payload: JSON.stringify(parsed) }, update: { payload: JSON.stringify(parsed) } });
  await tx.strategyVersion.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, recordId: snapshot.id, kind: snapshot.kind, snapshot: JSON.stringify(snapshot) } });
  return result;
}
