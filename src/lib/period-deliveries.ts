import { deliveryInRange, type ReviewRange } from "./review-period";
import { isRecurring, recurrenceSummary, type RecurringAction } from "./recurring-tasks";

type Milestone = { id?: string; title?: string; deadline?: unknown; status?: string };
type Project = { id: string; name?: string; deadline?: unknown; milestones?: Milestone[] };
type Action = RecurringAction & { id: string; projectId?: string | null; dueDate?: unknown; status?: string };

export function periodDeliveries<P extends Project, A extends Action>(projects: P[], actions: A[], range: ReviewRange) {
  const tasks = actions.map(action => ({ ...action, recurrenceSummary: recurrenceSummary(action, range) }))
    .filter(action => isRecurring(action) ? Boolean(action.recurrenceSummary?.dates.length) : deliveryInRange(action.dueDate, range))
    .sort((a, b) => String(a.recurrenceSummary?.dates[0] || a.dueDate).localeCompare(String(b.recurrenceSummary?.dates[0] || b.dueDate)));
  const deliveries = projects.map(project => ({ project,
    milestones: (project.milestones || []).filter(milestone => deliveryInRange(milestone.deadline, range)),
    tasks: tasks.filter(action => action.projectId === project.id),
  })).filter(row => deliveryInRange(row.project.deadline, range) || row.milestones.length || row.tasks.length);
  return { tasks, projects: deliveries };
}
