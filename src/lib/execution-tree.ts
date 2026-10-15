import { goalAncestors, type HierarchyGoal } from "./goal-hierarchy";
import { recordAncestors, visibleParents } from "./record-hierarchy";

export type TreeRecord = HierarchyGoal & {
  recordCode?: string | null;
  recurrence?: string; estimatedHours?: number;
  name?: string; status?: string; metric?: string; deadline?: string | null;
  goalId?: string | null; projectId?: string | null; standard?: string; dueDate?: string | null;
};
export type TreeFilters = { scene: string; horizon: string; status: string; query: string; incomplete: boolean };
export const isFinished = (status?: string) => ["已完成", "完成", "已取消", "归档", "已归档", "已停止"].includes(status || "");
export function missingTreeFields(type: "goal" | "project" | "action", row: TreeRecord) {
  const missing: string[] = [];
  if (type === "goal" && !row.horizon?.trim()) missing.push("周期");
  if (type === "project" && !row.goalId) missing.push("所属目标");
  if (type === "action" && !row.projectId) missing.push("所属项目");
  if (!(type === "action" ? row.standard : row.metric)?.trim()) missing.push(type === "action" ? "完成标准" : "衡量标准");
  if (!(type === "action" ? row.dueDate : row.deadline)) missing.push(type === "project" ? "交付日期" : "截止日期");
  return missing;
}

export function executionTree(goals: TreeRecord[], projects: TreeRecord[], actions: TreeRecord[], fallback: string, filters: TreeFilters) {
  const goalMap = new Map(goals.map(row => [row.id, row])), projectMap = new Map(projects.map(row => [row.id, row]));
  const actionGoal = (row: TreeRecord) => projectMap.get(row.projectId || "")?.goalId || row.goalId;
  const sceneOf = (row: TreeRecord, type: "goal" | "project" | "action") => row.effectiveSceneId || row.sceneId ||
    (type === "action" ? projectMap.get(row.projectId || "")?.effectiveSceneId || projectMap.get(row.projectId || "")?.sceneId || goalMap.get(actionGoal(row) || "")?.sceneId : type === "project" ? goalMap.get(row.goalId || "")?.sceneId : null) || fallback;
  // Legacy cross-scene links must not place a goal under another scene.
  const sceneGoals = goals.map(row => {
    const parent = goalMap.get(row.parentId || "");
    return parent && sceneOf(row, "goal") !== sceneOf(parent, "goal") ? { ...row, parentId: null } : row;
  });
  const direct = { goals: new Set<string>(), projects: new Set<string>(), actions: new Set<string>() };
  const matches = (row: TreeRecord, type: "goal" | "project" | "action") => {
    const owner = type === "goal" ? row : goalMap.get((type === "project" ? row.goalId : actionGoal(row)) || "");
    const horizon = owner?.horizon === "长期" ? "10年" : owner?.horizon === "年度" ? "1年" : owner?.horizon;
    const status = filters.status === "all" || (filters.status === "open" ? !isFinished(row.status) : row.status === filters.status);
    return (filters.scene === "all" || sceneOf(row, type) === (filters.scene === "unclassified" ? fallback : filters.scene)) &&
      (filters.horizon === "all" || horizon === filters.horizon) && status &&
      (!filters.query.trim() || `${row.title || row.name || ""} ${row.recordCode || ""} ${row.metric || row.standard || ""}`.toLocaleLowerCase().includes(filters.query.trim().toLocaleLowerCase())) &&
      (!filters.incomplete || missingTreeFields(type, row).length > 0);
  };
  for (const row of goals) if (matches(row, "goal")) direct.goals.add(row.id);
  for (const row of projects) if (matches(row, "project")) direct.projects.add(row.id);
  for (const row of actions) if (matches(row, "action")) direct.actions.add(row.id);
  const included = { goals: new Set(direct.goals), projects: new Set(direct.projects), actions: new Set(direct.actions) };
  for (const row of actions.filter(row => direct.actions.has(row.id))) for (const parent of recordAncestors(row, actions)) included.actions.add(parent.id);
  for (const row of actions.filter(row => included.actions.has(row.id))) {
    if (row.projectId && projectMap.has(row.projectId)) included.projects.add(row.projectId);
    const id = actionGoal(row); if (id && goalMap.has(id)) included.goals.add(id);
  }
  for (const row of projects.filter(row => included.projects.has(row.id))) for (const parent of recordAncestors(row, projects)) included.projects.add(parent.id);
  for (const row of projects.filter(row => included.projects.has(row.id))) if (row.goalId && goalMap.has(row.goalId)) included.goals.add(row.goalId);
  for (const row of sceneGoals.filter(row => included.goals.has(row.id))) for (const parent of goalAncestors(row, sceneGoals)) included.goals.add(parent.id);
  const parentById = visibleParents(sceneGoals, included.goals), projectParents = visibleParents(projects, included.projects), actionParents = visibleParents(actions, included.actions);
  return { direct, included, parentById, projectParents, actionParents, sceneOf, roots: goals.filter(row => included.goals.has(row.id) && !parentById.get(row.id)),
    standaloneProjects: projects.filter(row => included.projects.has(row.id) && !projectParents.get(row.id) && (!row.goalId || !goalMap.has(row.goalId))),
    standaloneActions: actions.filter(row => included.actions.has(row.id) && !actionParents.get(row.id) && (!row.projectId || !projectMap.has(row.projectId)) && (!row.goalId || !goalMap.has(row.goalId))) };
}
