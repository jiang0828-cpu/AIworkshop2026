import { z } from "zod";
import type { SceneRow } from "../scenes";
import { readOrchestration } from "./workflow";

const timestamp = z.string().datetime({ offset: true });
export const scheduleSchema = z.object({
  startsAt: timestamp.nullable(), endsAt: timestamp.nullable(),
  mode: z.enum(["automatic", "manual"]),
  reason: z.string().max(2000), warnings: z.array(z.string().max(500)).max(10),
}).superRefine((value, context) => {
  if (Boolean(value.startsAt) !== Boolean(value.endsAt) || (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)))
    context.addIssue({ code: "custom", message: "建议结束时间应晚于开始时间" });
});
export type TaskSchedule = z.infer<typeof scheduleSchema>;
type Step = { assignee: string; estimatedMinutes: number; status?: string };
export type SchedulableTask = {
  title: string; priority: number; dueAt: string | Date | null; sceneId?: string | null; effectiveSceneId?: string;
  orchestration?: unknown; steps: Step[]; schedule?: TaskSchedule | null;
};
export type Reservation = { startsAt: string; endsAt: string };
const MINUTE = 60000;
const stamp = (date: string, minute: number) => new Date(`${date}T00:00:00+08:00`).getTime() + minute * MINUTE;
const dayOf = (time: number) => new Date(time + 8 * 60 * MINUTE).toISOString().slice(0, 10);
const iso = (time: number) => `${new Date(time + 8 * 60 * MINUTE).toISOString().slice(0, 19)}+08:00`;
const unfinished = (step: Step) => !["done", "produced"].includes(step.status || "pending");

export function readSchedule(value: unknown): TaskSchedule | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const result = scheduleSchema.safeParse(parsed?.schedule);
    return result.success ? result.data : null;
  } catch { return null; }
}
export function withSchedule(value: unknown, schedule: TaskSchedule | null | undefined) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value || {};
  return JSON.stringify(schedule === undefined ? parsed : { ...parsed, schedule });
}
export function estimatedSpan(task: SchedulableTask) {
  const plan = readOrchestration(task.orchestration as string);
  const lengths = task.steps.map((step) => unfinished(step) && !(step.assignee === "ai" && step.status === "review") ? step.estimatedMinutes : 0);
  const totals = new Map<number, number>();
  const active = new Set<number>();
  const visit = (position: number): number => {
    if (totals.has(position)) return totals.get(position)!;
    if (active.has(position)) throw new Error("步骤依赖存在循环，无法安排时间");
    active.add(position);
    const before = plan ? plan.steps[position]?.dependsOn || [] : position ? [position - 1] : [];
    const result = lengths[position] + Math.max(0, ...before.map(visit));
    active.delete(position); totals.set(position, result); return result;
  };
  const human = task.steps.filter((step) => step.assignee === "human" && unfinished(step)).reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const hasAI = task.steps.some((step) => step.assignee === "ai" && unfinished(step));
  const duration = Math.max(human, ...task.steps.map((_, position) => visit(position))) + (hasAI ? 10 : 0);
  return { duration: Math.max(10, Math.ceil(duration / 5) * 5), human, reviewOnly: human === 0 };
}
function taskKind(task: SchedulableTask) {
  if (/体检|门诊|看诊|银行|柜台|办税|预约/.test(task.title)) return "appointment";
  if (/会议|沟通|对接|访谈|电话/.test(task.title)) return "communication";
  if (/写作|编写|开发|研究|分析|设计|规划/.test(task.title)) return "focus";
  return "routine";
}
function windows(slot: number, weekend: boolean, urgent: boolean, kind: ReturnType<typeof taskKind>): Array<[number, number]> {
  if (urgent) return [[8 * 60, 12 * 60], [14 * 60, 22 * 60]];
  if (kind === "appointment") return weekend ? [] : [[9 * 60, 12 * 60], [14 * 60, 17 * 60]];
  if (slot === 0 && kind === "communication") return weekend ? [] : [[14 * 60, 17 * 60], [9 * 60, 12 * 60]];
  if (slot === 3) return [[7 * 60, 8 * 60 + 30], [18 * 60, 19 * 60]];
  if (slot === 2) return weekend ? [[9 * 60, 12 * 60], [15 * 60, 18 * 60], [19 * 60, 21 * 60]] : [[19 * 60, 21 * 60]];
  if (slot === 5) return weekend ? [[9 * 60, 12 * 60], [15 * 60, 18 * 60], [20 * 60, 22 * 60]] : [[20 * 60, 22 * 60]];
  if (slot === 0) return weekend ? [] : [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
  if (slot === 1) return [[18 * 60, 19 * 60 + 30], [14 * 60, 18 * 60]];
  return [[9 * 60, 12 * 60], [14 * 60, 18 * 60], [19 * 60, 21 * 60]];
}
function humanInterval(task: SchedulableTask, schedule: Reservation) {
  const start = new Date(schedule.startsAt).getTime(), end = new Date(schedule.endsAt).getTime();
  // AI preparation can overlap; its final review still occupies the person's time.
  return { start: estimatedSpan(task).reviewOnly ? Math.max(start, end - 10 * MINUTE) : start, end: end + 10 * MINUTE };
}
export function reservationsFor(tasks: SchedulableTask[]): Reservation[] {
  return tasks.flatMap((task) => {
    if (!task.schedule?.startsAt || !task.schedule.endsAt) return [];
    const interval = humanInterval(task, { startsAt: task.schedule.startsAt, endsAt: task.schedule.endsAt });
    return [{ startsAt: iso(interval.start), endsAt: iso(interval.end) }];
  });
}
export function assertTimeFree(tasks: SchedulableTask[], reservations: Reservation[]) {
  const occupied = [...reservations];
  for (const interval of reservationsFor(tasks)) {
    if (occupied.some((other) => new Date(interval.startsAt) < new Date(other.endsAt) && new Date(interval.endsAt) > new Date(other.startsAt))) throw new Error("时间与已有安排冲突，请调整后重新确认");
    occupied.push(interval);
  }
}

export function arrangeTimes<T extends SchedulableTask>(tasks: T[], date: string, scenes: SceneRow[], reservations: Reservation[] = [], now = new Date()): Array<T & { schedule: TaskSchedule }> {
  const firstDay = date < dayOf(now.getTime()) ? dayOf(now.getTime()) : date;
  const occupied = reservations.map((row) => ({ start: new Date(row.startsAt).getTime(), end: new Date(row.endsAt).getTime() }));
  for (const task of tasks.filter((row) => row.schedule?.mode === "manual")) {
    if (task.schedule?.startsAt && task.schedule.endsAt) occupied.push(humanInterval(task, { startsAt: task.schedule.startsAt, endsAt: task.schedule.endsAt }));
  }
  const results = new Map<T, TaskSchedule>();
  const ordered = [...tasks].sort((a, b) => a.priority - b.priority || (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));
  for (const task of ordered) {
    if (task.schedule?.mode === "manual") { results.set(task, task.schedule); continue; }
    const scene = scenes.find((row) => row.id === (task.effectiveSceneId || task.sceneId));
    const plan = readOrchestration(task.orchestration as string);
    const originalDeadline = task.dueAt ? new Date(task.dueAt).getTime() : Infinity;
    const deadline = originalDeadline < now.getTime() ? Infinity : originalDeadline;
    const urgent = plan?.urgency === 1 || originalDeadline <= now.getTime() + 120 * MINUTE;
    const span = estimatedSpan(task);
    const kind = taskKind(task);
    let chosen: Reservation | null = null;
    // Try scene preferences first; a hard deadline can use another daytime slot.
    for (const flexible of [false, true]) {
      if (flexible && !Number.isFinite(deadline)) break;
      for (let offset = 0; offset < 7 && !chosen; offset++) {
        const day = dayOf(stamp(firstDay, 12 * 60) + offset * 86400000);
        const weekday = new Date(`${day}T12:00:00+08:00`).getUTCDay();
        for (const [from, to] of windows(scene?.slot ?? 4, weekday === 0 || weekday === 6, urgent || flexible, kind)) {
          const floor = Math.ceil((now.getTime() + 5 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;
          for (let start = Math.max(stamp(day, from), floor); start + span.duration * MINUTE <= stamp(day, to); start += 5 * MINUTE) {
            const end = start + span.duration * MINUTE;
            if (end > deadline) continue;
            const interval = humanInterval(task, { startsAt: iso(start), endsAt: iso(end) });
            if (occupied.some((row) => interval.start < row.end && interval.end > row.start)) continue;
            chosen = { startsAt: iso(start), endsAt: iso(end) }; break;
          }
          if (chosen) break;
        }
      }
      if (chosen) break;
    }
    const warnings: string[] = [];
    if (kind === "appointment") warnings.push("预约或营业时间尚需确认，建议时段不代表预约成功");
    if (task.steps.some((step) => ["failed", "blocked"].includes(step.status || ""))) warnings.push("先处理失败或阻塞，再开始执行");
    if (!chosen) warnings.push(Number.isFinite(deadline) ? "截止前没有足够空档，请调整期限、减少范围或拆分任务" : "未来 7 天没有合适的连续时段，请拆小任务或手动安排");
    if (chosen && dayOf(new Date(chosen.startsAt).getTime()) > date) warnings.push("今日容量不足或偏好时段已过，已顺延");
    if (originalDeadline < now.getTime()) warnings.push("原截止时间已过，请重新确认期限");
    const schedule: TaskSchedule = { startsAt: chosen?.startsAt || null, endsAt: chosen?.endsAt || null, mode: "automatic",
      reason: `${task.priority === 1 ? "高" : task.priority === 2 ? "中" : "低"}优先 · ${scene?.name || "其他"}场景 · ${kind === "communication" ? "沟通协作优先下午；" : kind === "focus" ? "为集中工作预留连续时段；" : ""}${span.reviewOnly ? "AI 准备可并行，预留 10 分钟验收" : `预计 ${span.duration} 分钟，预留任务间休息`}；仅为执行建议，原截止时间保留。`, warnings };
    results.set(task, schedule);
    if (chosen) occupied.push(humanInterval(task, chosen));
  }
  return tasks.map((task) => ({ ...task, schedule: results.get(task)! }));
}
