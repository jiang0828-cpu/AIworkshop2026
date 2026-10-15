import { z } from "zod";
import { shanghaiDate, type DailyView } from "./shared";
import { isRecurring, recurrenceDates, recurrenceDueAt } from "../recurring-tasks";

export const intakeEditSchema = z.object({
  actionId: z.string().min(1).max(200),
  updatedAt: z.string().datetime({ offset: true }),
  title: z.string().trim().min(1, "请填写任务名称").max(300),
  purpose: z.string().max(20000),
  standard: z.string().max(20000),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  estimatedHours: z.number().min(0).max(24),
});
export type IntakeEdit = z.infer<typeof intakeEditSchema>;

export function deliveryAt(action: DailyView["actions"][number], projects: DailyView["projects"]) {
  return action.dueDate || projects.find((project) => project.id === action.projectId)?.deadline || null;
}

export function intakeActions(view: DailyView) {
  const existing = new Set(view.plan?.tasks.map((task) => task.actionId));
  return view.actions.filter((action) => !action.completedAt && !["已完成", "已取消", "已归档"].includes(action.status) && !existing.has(action.id) && (!isRecurring(action) || recurrenceDates(action, view.date, view.date).length > 0))
    .sort((a, b) => Number(!a.projectId) - Number(!b.projectId) ||
      (deliveryAt(a, view.projects) ? new Date(deliveryAt(a, view.projects)!).getTime() : Infinity) - (deliveryAt(b, view.projects) ? new Date(deliveryAt(b, view.projects)!).getTime() : Infinity) || a.id.localeCompare(b.id));
}

export function toIntakeEdit(action: DailyView["actions"][number], projects: DailyView["projects"], date?: string): IntakeEdit {
  return { actionId: action.id, updatedAt: action.updatedAt, title: action.title, purpose: action.purpose, standard: action.standard,
    dueAt: date && isRecurring(action) ? recurrenceDueAt(date) : deliveryAt(action, projects), estimatedHours: Math.min(24, Math.max(0, action.estimatedHours)) };
}

export function recommendedIntake(view: DailyView): IntakeEdit[] {
  return intakeActions(view).filter((action) => {
    const due = deliveryAt(action, view.projects);
    return isRecurring(action) || action.projectId && due && shanghaiDate(new Date(due)) <= view.date;
  }).sort((a, b) => Number(isRecurring(b)) - Number(isRecurring(a))).slice(0, 20).map((action) => toIntakeEdit(action, view.projects, view.date));
}
