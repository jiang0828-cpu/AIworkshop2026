import { z } from "zod";
import { PROFILE_ID } from "./db";
import type { StrategyDB } from "./strategy/service";

const ids = z.array(z.string().min(1).max(150)).max(500).refine(rows => new Set(rows).size === rows.length, "复盘对象不能重复");
export const reviewScopeSchema = z.object({ projectIds: ids.default([]), actionIds: ids.default([]), dailyTaskIds: ids.default([]) }).strict().refine(scope => scope.projectIds.length + scope.actionIds.length + scope.dailyTaskIds.length > 0, "请选择项目、任务或每日完成工作");
export type ReviewScope = z.infer<typeof reviewScopeSchema>;
export async function validateReviewScope(db: StrategyDB, input: unknown) {
  const scope = reviewScopeSchema.parse(input);
  const [projects, actions, dailyTasks] = await Promise.all([
    db.project.findMany({ where: { profileId: PROFILE_ID, id: { in: scope.projectIds } } }),
    db.action.findMany({ where: { profileId: PROFILE_ID, id: { in: scope.actionIds } } }),
    scope.dailyTaskIds.length ? db.dailyTask.findMany({ where: { id: { in: scope.dailyTaskIds }, plan: { profileId: PROFILE_ID }, completedAt: { not: null }, steps: { some: {}, every: { status: "done" } } } }) : [],
  ]);
  if (projects.length !== scope.projectIds.length || actions.length !== scope.actionIds.length || dailyTasks.length !== scope.dailyTaskIds.length) throw new Error("复盘来源不存在、不属于当前档案或尚未完成验收");
  if (dailyTasks.some(task => task.actionId && scope.actionIds.includes(task.actionId))) throw new Error("同一行动及其每日工作请勿重复选择");
  return [
    ...projects.map(project => ({ sourceType: "project", sourceId: project.id, sourceTitle: project.name })),
    ...actions.map(action => ({ sourceType: "action", sourceId: action.id, sourceTitle: action.title })),
    ...dailyTasks.map(task => ({ sourceType: "dailyTask", sourceId: task.id, sourceTitle: task.title })),
  ];
}

export async function writeReviewScope(db: StrategyDB, reviewId: string, input: unknown) {
  const sources = await validateReviewScope(db, input);
  await db.recordSource.deleteMany({ where: { profileId: PROFILE_ID, targetType: "review", targetId: reviewId, sourceType: { in: ["project", "action", "dailyTask"] } } });
  for (const source of sources) await db.recordSource.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, targetType: "review", targetId: reviewId, ...source } });
}
