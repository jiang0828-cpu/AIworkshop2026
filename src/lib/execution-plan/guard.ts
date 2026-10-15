import { PROFILE_ID } from "../db";
import { shanghaiDate } from "../daily/shared";
import type { StrategyDB } from "../strategy/service";
import { payloadSchema, type PlanPayload } from "./shared";

export async function assertWeeklyCapacity(db: StrategyDB, payload: PlanPayload, date: string, additions: Array<{ id: string; hours: number }> = []) {
  const start = Date.parse(payload.input.capacity.startDate), when = Date.parse(date);
  const week = Math.floor((when - start) / 604800000);
  if (!Number.isFinite(when) || week < 0 || week > 3) throw new Error("任务超出本轮四周执行窗口，请重新规划");
  const first = new Date(start + week * 604800000).toISOString().slice(0, 10);
  const last = new Date(start + week * 604800000 + 6 * 86400000).toISOString().slice(0, 10);
  const existing = await db.dailyTask.findMany({ where: { plan: { profileId: PROFILE_ID, date: { gte: first, lte: last } } }, include: { steps: true, plan: true } });
  const used = existing.filter(task => task.steps.some(step => step.status !== "cancelled")).reduce((sum, task) => sum + task.steps.reduce((hours, step) => hours + step.estimatedMinutes / 60, 0), 0);
  const added = additions.filter(item => !existing.some(task => task.actionId === item.id && task.plan.date === date)).reduce((sum, item) => sum + Math.ceil(item.hours * 60) / 60, 0);
  if (payload.input.capacity.weeklyHours === null || used + added > payload.input.capacity.weeklyHours + 1e-9) throw new Error("本周任务超出已确认容量，请减少选择或调整排期");
}

export async function assertExecutionReady(db: StrategyDB, actionId: string, date = shanghaiDate(), continuing = false) {
  const plans = await db.executionPlan.findMany({ where: { profileId: PROFILE_ID, status: "confirmed" }, orderBy: { createdAt: "desc" } });
  for (const plan of plans) {
    const payload = payloadSchema.parse(JSON.parse(plan.payload));
    const mapped = payload.mapping.find(item => item.type === "action" && item.id === actionId);
    if (!mapped) continue;
    const current = await db.action.findFirst({ where: { id: actionId, profileId: PROFILE_ID } });
    if (mapped.mode !== "new" && current && ["进行中", "已完成"].includes(current.status)) return;
    if (mapped.deferred && !mapped.cleared) throw new Error("此任务暂缓，请在AI系统规划中记录实际核实结果后再启动");
    const task = payload.draft!.tasks.find(task => task.key === mapped.key)!;
    if (!continuing) {
      if (payload.input.capacity.weeklyHours === null || !payload.input.capacity.weekdays.includes(new Date(date).getUTCDay())) throw new Error("当前日期或时间容量未确认，请调整规划后执行");
      const start = Date.parse(payload.input.capacity.startDate), when = Date.parse(date);
      if (!Number.isFinite(when) || when < start || when >= start + 28 * 86400000) throw new Error("任务超出本轮四周执行窗口，请重新规划");
      await assertWeeklyCapacity(db, payload, date, [{ id: actionId, hours: task.estimatedHours }]);
    }
    for (const dependency of task.dependencies) {
      const source = payload.mapping.find(item => item.type === "action" && item.key === dependency);
      const action = source && await db.action.findFirst({ where: { id: source.id, profileId: PROFILE_ID } });
      if (!action || action.status !== "已完成") throw new Error("前置行动尚未完成并确认回写，不能提前启动");
    }
    return;
  }
}
