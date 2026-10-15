import { z } from "zod";

const id = z.string().min(1).max(200).nullable();
export const affiliationSchema = z.object({ kind: z.enum(["planned", "temporary"]), goalId: id, projectId: id });
export type TaskAffiliation = z.infer<typeof affiliationSchema>;
export const taskKindLabels = { planned: "计划任务", temporary: "临时任务" };
export function isStandaloneTemporary(task: { actionId?: string | null; affiliation?: TaskAffiliation }) {
  return !task.actionId && task.affiliation?.kind === "temporary" && !task.affiliation.goalId && !task.affiliation.projectId;
}
export function readAffiliation(value: unknown): TaskAffiliation | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const result = affiliationSchema.safeParse(parsed?.affiliation);
    return result.success ? result.data : null;
  } catch { return null; }
}
export function withAffiliation(value: string, affiliation: TaskAffiliation | undefined) {
  return affiliation === undefined ? value : JSON.stringify({ ...JSON.parse(value), affiliation });
}
