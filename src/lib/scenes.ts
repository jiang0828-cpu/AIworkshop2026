// Slots are permanent identities. Position and display name may change.
export const sceneDefaults = [
  { slot: 3, name: "健康", description: "关注身心与作息" },
  { slot: 1, name: "财务", description: "关注收支与保障" },
  { slot: 0, name: "工作", description: "关注职业与产出" },
  { slot: 2, name: "家庭", description: "关注关系与陪伴" },
  { slot: 5, name: "爱好", description: "关注兴趣与创作" },
  { slot: 4, name: "其他", description: "容纳其他事项" },
  { slot: 6, name: "系统", description: "关注工作流、工具与系统维护" },
] as const;
export const sceneCount = sceneDefaults.length;
export type SceneRow = { id: string; slot: number; name: string; position: number };
export type SceneRecord = { id: string; sceneId?: string | null; effectiveSceneId?: string; projectId?: string | null; goalId?: string | null };
export function otherSceneId(scenes: SceneRow[]) { return scenes.find((scene) => scene.slot === 4)?.id || "local-profile-scene-4"; }
export function resolveScene(row: SceneRecord, goals: SceneRecord[], projects: SceneRecord[], scenes: SceneRow[]) {
  const project = projects.find((item) => item.id === row.projectId);
  const projectGoal = goals.find((item) => item.id === project?.goalId);
  const goal = goals.find((item) => item.id === row.goalId);
  const candidates = [[row.sceneId, "explicit"], [project?.sceneId || projectGoal?.sceneId, "project"], [goal?.sceneId, "goal"]] as const;
  const found = candidates.find(([id]) => id && scenes.some((scene) => scene.id === id));
  return { effectiveSceneId: found?.[0] || otherSceneId(scenes), sceneSource: found?.[1] || "default" };
}
export function matchesSceneId(id: string | null | undefined, filter: string, scenes: SceneRow[]) {
  return filter === "all" || (id || otherSceneId(scenes)) === (filter === "unclassified" ? otherSceneId(scenes) : filter);
}
