export const goalHorizons = ["10年", "5年", "3年", "1年", "90天", "本月", "本周"];
const ranks: Record<string, number> = { 长期: 7, "10年": 7, "5年": 6, "3年": 5, 年度: 4, "1年": 4, "90天": 3, 本月: 2, 本周: 1 };
export type HierarchyGoal = { id: string; title?: string; horizon?: string; parentId?: string | null; sceneId?: string | null; effectiveSceneId?: string | null };
export const goalScene = (goal: HierarchyGoal, fallback: string) => goal.sceneId || goal.effectiveSceneId || fallback;
export function hierarchyIssue(child: HierarchyGoal, parent: HierarchyGoal, fallback: string) {
  if (goalScene(child, fallback) !== goalScene(parent, fallback)) return "父子目标场景不同";
  if (!ranks[child.horizon || ""] || !ranks[parent.horizon || ""]) return "时间跨度待明确";
  if (ranks[parent.horizon!] <= ranks[child.horizon!]) return "上级目标时间跨度须长于子目标";
  return "";
}
export function goalAncestors(goal: HierarchyGoal, goals: HierarchyGoal[]) {
  const ancestors: HierarchyGoal[] = [], seen = new Set([goal.id]);
  let cursor = goals.find((row) => row.id === goal.parentId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id); ancestors.unshift(cursor);
    cursor = goals.find((row) => row.id === cursor!.parentId);
  }
  return ancestors;
}
export function parentCandidates(child: HierarchyGoal, goals: HierarchyGoal[], fallback: string) {
  return sortGoals(goals.filter((parent) => parent.id !== child.id && !hierarchyIssue(child, parent, fallback) && !goalAncestors(parent, goals).some((row) => row.id === child.id)));
}
export function sortGoals<T extends HierarchyGoal>(goals: T[]): T[] {
  return [...goals].sort((a, b) => (ranks[b.horizon || ""] || 0) - (ranks[a.horizon || ""] || 0) || (a.title || "").localeCompare(b.title || "", "zh-CN"));
}
export function treeWithAncestors<T extends HierarchyGoal>(visible: T[], goals: T[], fallback: string): T[] {
  const ids = new Set(visible.map((row) => row.id));
  for (const goal of visible) for (const ancestor of goalAncestors(goal, goals)) {
    if (goalScene(ancestor, fallback) === goalScene(goal, fallback)) ids.add(ancestor.id);
  }
  return sortGoals(goals.filter((row) => ids.has(row.id)));
}
