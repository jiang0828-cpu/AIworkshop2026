import { shanghaiDate } from "./daily/shared";
import { deliveryInRange, type ReviewRange } from "./review-period";

export type CompletedDailyWork = {
  id: string; title: string; actionId?: string | null; projectId?: string | null; goalId?: string | null;
  effectiveSceneId?: string; completedAt: unknown; result?: string; plan: { date: string };
};
export type CompletedWork = {
  sourceType: "action" | "dailyTask"; sourceId: string; title: string; sceneId: string;
  projectId?: string | null; entries: { id: string; date: string; result: string; planDate?: string }[];
};
type Action = { id: string; title?: string; status?: string; completedAt?: unknown; effectiveSceneId?: string; projectId?: string | null };

function completionDay(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : shanghaiDate(date);
}

export function reviewCompletedWork(actions: Action[], daily: CompletedDailyWork[], range: ReviewRange, fallbackScene: string): CompletedWork[] {
  const groups = new Map<string, CompletedWork>();
  for (const task of daily) {
    const date = completionDay(task.completedAt);
    if (!deliveryInRange(date, range)) continue;
    const action = actions.find(action => action.id === task.actionId);
    const sourceType = action ? "action" : "dailyTask", sourceId = action?.id || task.id;
    const key = `${sourceType}:${sourceId}`;
    const group = groups.get(key) || { sourceType, sourceId, title: action?.title || task.title, sceneId: action?.effectiveSceneId || task.effectiveSceneId || fallbackScene, projectId: action?.projectId || task.projectId, entries: [] };
    if (!group.entries.some(entry => entry.id === task.id)) group.entries.push({ id: task.id, date, result: task.result || "", planDate: task.plan.date });
    groups.set(key, group);
  }
  for (const action of actions) {
    const date = completionDay(action.completedAt), key = `action:${action.id}`;
    if (action.status !== "已完成" || !deliveryInRange(date, range) || groups.has(key)) continue;
    groups.set(key, { sourceType: "action", sourceId: action.id, title: action.title || "未命名任务", sceneId: action.effectiveSceneId || fallbackScene, projectId: action.projectId, entries: [{ id: action.id, date, result: "" }] });
  }
  return [...groups.values()].map(group => ({ ...group, entries: group.entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.entries[0].date.localeCompare(b.entries[0].date) || a.sourceId.localeCompare(b.sourceId));
}
