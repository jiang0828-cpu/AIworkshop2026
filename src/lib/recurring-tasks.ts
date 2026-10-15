import { shanghaiDate } from "./daily/shared";

export type RecurringAction = {
  recurrence?: string | null; createdAt?: unknown; updatedAt?: unknown; dueDate?: unknown;
  completedAt?: unknown; status?: string;
  dailyTasks?: Array<{ completedAt?: unknown; plan: { date: string } }>;
};
export type RecurrenceSummary = { dates: string[]; completedDates: string[] };
export function isRecurring(action: RecurringAction) { return ["daily", "weekly", "monthly"].includes(action.recurrence || ""); }
function day(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : shanghaiDate(date);
}

export function recurrenceDates(action: RecurringAction, start: string, end: string): string[] {
  if (!isRecurring(action)) return [];
  if (![start, end].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value) || start > end) return [];
  const anchor = day(action.createdAt);
  if (!anchor) return [];
  const stop = day(action.dueDate);
  const closed = action.completedAt ? day(action.completedAt) : ["已完成", "已取消", "已归档"].includes(action.status || "") ? day(action.updatedAt) || anchor : null;
  const first = start > anchor ? start : anchor;
  const last = [end, stop, closed].filter((date): date is string => Boolean(date)).sort()[0];
  const cursor = new Date(`${first}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return [];
  const anchorDate = new Date(`${anchor}T00:00:00Z`);
  const dates: string[] = [];
  while (cursor.toISOString().slice(0, 10) <= last && dates.length < 366) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
    if (action.recurrence === "daily" || action.recurrence === "weekly" && cursor.getUTCDay() === anchorDate.getUTCDay() || action.recurrence === "monthly" && cursor.getUTCDate() === Math.min(anchorDate.getUTCDate(), monthEnd)) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function recurrenceSummary(action: RecurringAction, range: { periodStart: string; periodEnd: string }): RecurrenceSummary | null {
  if (!isRecurring(action)) return null;
  const dates = recurrenceDates(action, range.periodStart, range.periodEnd);
  const completed = new Set(action.dailyTasks?.filter(task => task.completedAt).map(task => task.plan.date));
  return { dates, completedDates: dates.filter(date => completed.has(date)) };
}
export function recurrenceDueAt(date: string) { return `${date}T23:59:59+08:00`; }
export function periodTaskDone(action: { status?: string; recurrenceSummary?: RecurrenceSummary | null }) {
  return action.recurrenceSummary ? action.recurrenceSummary.dates.length > 0 && action.recurrenceSummary.completedDates.length === action.recurrenceSummary.dates.length : action.status === "已完成";
}
export function recurrenceProgress(summary: RecurrenceSummary) {
  return `周期执行：已完成 ${summary.completedDates.length}/${summary.dates.length} 次`;
}
