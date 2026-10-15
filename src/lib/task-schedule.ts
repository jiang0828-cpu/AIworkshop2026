export const taskRecurrences = ["none", "daily", "weekly", "monthly"] as const;
export type TaskRecurrence = typeof taskRecurrences[number];
export const recurrenceLabels: Record<TaskRecurrence, string> = {
  none: "非周期性", daily: "每日", weekly: "每周", monthly: "每月",
};

export function recurrenceLabel(value?: string | null) {
  return recurrenceLabels[value as TaskRecurrence] || recurrenceLabels.none;
}

export function taskMinutes(hours?: number | null) {
  return hours && hours > 0 ? Math.max(1, Math.round(hours * 60)) : 0;
}

export function taskHours(minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 6000000) throw new Error("预计投入须为至少 1 分钟的整数");
  return minutes / 60;
}
