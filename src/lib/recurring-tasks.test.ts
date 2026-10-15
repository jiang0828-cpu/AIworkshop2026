import { describe, expect, it } from "vitest";
import { periodTaskDone, recurrenceDates, recurrenceSummary } from "./recurring-tasks";
import { periodDeliveries } from "./period-deliveries";
import { reviewDeliveryDraft } from "./review-delivery-draft";

const daily = { id: "a", title: "健康记录", projectId: "p", recurrence: "daily", createdAt: "2026-10-14T16:00:00Z", dueDate: "2030-12-15T00:00:00Z", status: "进行中" };
const range = { periodStart: "2026-10-12", periodEnd: "2026-10-18" };
describe("周期任务的每日与周期计划", () => {
  it("按上海创建日期起算，远期截止不阻止当日执行，截止后不再安排", () => {
    expect(recurrenceDates(daily, range.periodStart, range.periodEnd)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(recurrenceDates({ ...daily, dueDate: "2026-10-16T15:59:59Z" }, range.periodStart, range.periodEnd)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(recurrenceDates(daily, "2030-12-16", "2030-12-16")).toEqual([]);
  });
  it("周任务沿用星期，月任务跨年并正确处理月末和闰年", () => {
    expect(recurrenceDates({ ...daily, recurrence: "weekly" }, "2026-10-15", "2026-10-28")).toEqual(["2026-10-15", "2026-10-22"]);
    const monthly = { recurrence: "monthly", createdAt: "2023-12-31T00:00:00Z" };
    expect(recurrenceDates(monthly, "2024-01-01", "2024-03-31")).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
    expect(recurrenceDates(monthly, "2025-02-01", "2025-02-28")).toEqual(["2025-02-28"]);
  });
  it("终止不抹去历史执行，未完成记录不计完成，多条完成记录按日期去重", () => {
    const action = { ...daily, status: "已完成", completedAt: "2026-10-16T00:00:00Z", dailyTasks: [
      { completedAt: "2026-10-15T01:00:00Z", plan: { date: "2026-10-15" } },
      { completedAt: "2026-10-15T02:00:00Z", plan: { date: "2026-10-15" } },
      { completedAt: null, plan: { date: "2026-10-16" } },
    ] };
    expect(recurrenceSummary(action, range)).toEqual({ dates: ["2026-10-15", "2026-10-16"], completedDates: ["2026-10-15"] });
    expect(periodTaskDone({ ...action, recurrenceSummary: recurrenceSummary(action, range) })).toBe(false);
  });
  it("周/月/年计划包含周期任务及所属项目，复盘使用执行次数而非主任务状态", () => {
    const action = { ...daily, dailyTasks: [{ completedAt: "2026-10-15T01:00:00Z", plan: { date: "2026-10-15" } }] };
    const result = periodDeliveries([{ id: "p", name: "健康" }], [action], range);
    expect(result.projects).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].recurrenceSummary?.completedDates).toEqual(["2026-10-15"]);
    const draft = reviewDeliveryDraft([{ id: "p", name: "健康" }], [action], range);
    expect(draft.wins).toContain("已完成 1/4 次");
    expect(draft.executionIssue).toContain("已完成 1/4 次");
    expect(periodDeliveries([], [action], { periodStart: "2026-10-01", periodEnd: "2026-10-31" }).tasks[0].recurrenceSummary?.dates).toHaveLength(17);
    expect(periodDeliveries([], [action], { periodStart: "2026-01-01", periodEnd: "2026-12-31" }).tasks[0].recurrenceSummary?.dates).toHaveLength(78);
    expect(recurrenceDates({ recurrence: "none" }, range.periodStart, range.periodEnd)).toEqual([]);
  });
});
