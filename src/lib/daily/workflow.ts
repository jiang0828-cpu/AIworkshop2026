import { z } from "zod";

export const workflowStepSchema = z.object({
  dependsOn: z.array(z.number().int().min(0).max(4)).max(4),
  kind: z.enum(["produce", "suggest", "decide", "act"]),
  reviewRequired: z.boolean(),
  standard: z.string().trim().min(1).max(2000),
});
export const orchestrationSchema = z.object({
  importance: z.number().int().min(1).max(3), urgency: z.number().int().min(1).max(3),
  reason: z.string().trim().min(1).max(2000), output: z.string().trim().min(1).max(4000),
  steps: z.array(workflowStepSchema).min(3).max(5),
});
export type Orchestration = z.infer<typeof orchestrationSchema>;
export type WorkflowTask = { orchestration?: string | Orchestration | null; steps: Array<{ position: number; status: string; assignee: string }> };
export function readOrchestration(value: WorkflowTask["orchestration"]): Orchestration | null {
  try { const result = orchestrationSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value); return result.success ? result.data : null; }
  catch { return null; }
}
export function workflowIssues(steps: Array<{ assignee: string }>, plan: Orchestration) {
  if (plan.steps.length !== steps.length) return "编排步骤数量不一致";
  for (const [position, step] of plan.steps.entries()) {
    if (new Set(step.dependsOn).size !== step.dependsOn.length || step.dependsOn.some((id) => id >= steps.length || id === position)) return "前置步骤无效";
    if (steps[position].assignee === "human" && (!step.reviewRequired || !["decide", "act"].includes(step.kind))) return "人工步骤应为决策或现实操作";
    if (steps[position].assignee === "ai" && ["decide", "act"].includes(step.kind)) return "AI 只能产出文本或建议，不能替人决策或执行外部操作";
    if (!plan.steps.some((next) => next.dependsOn.includes(position)) && !step.reviewRequired) return "最终成果必须人工确认验收";
  }
  const visited = new Set<number>(), active = new Set<number>();
  const visit = (position: number): boolean => {
    if (active.has(position)) return false;
    if (visited.has(position)) return true;
    active.add(position);
    if (!plan.steps[position].dependsOn.every(visit)) return false;
    active.delete(position); visited.add(position); return true;
  };
  if (!plan.steps.every((_, position) => visit(position))) return "步骤依赖存在循环";
  return "";
}
export function dependencies(task: WorkflowTask, position: number) {
  return readOrchestration(task.orchestration)?.steps[position]?.dependsOn ?? task.steps.filter((step) => step.position < position).map((step) => step.position);
}
export function stepReady(task: WorkflowTask, position: number) {
  const plan = readOrchestration(task.orchestration);
  return dependencies(task, position).every((id) => {
    const step = task.steps.find((row) => row.position === id);
    return step?.status === "done" || (step?.status === "produced" && plan?.steps[id]?.reviewRequired === false);
  });
}
export function readySteps<T extends { position: number; status: string; assignee: string }>(task: { orchestration?: WorkflowTask["orchestration"]; steps: T[] }): T[] {
  return [...task.steps].sort((a, b) => a.position - b.position).filter((step) => ["pending", "paused", "failed"].includes(step.status) && stepReady(task, step.position));
}
export function reviewRequired(task: WorkflowTask, position: number) { return readOrchestration(task.orchestration)?.steps[position]?.reviewRequired ?? true; }
export const importanceLabels = ["重要", "一般", "较低"];
export const urgencyLabels = ["紧迫", "近期", "不紧迫"];
export function quadrant(plan: Orchestration) {
  return plan.importance === 1 ? plan.urgency === 1 ? "重要且紧迫" : "重要不紧迫" : plan.urgency === 1 ? "紧迫待委派" : "可延后";
}
export function priorityFor(importance: number, urgency: number) { return importance === 1 && urgency === 1 ? 1 : importance === 1 || urgency === 1 ? 2 : 3; }
