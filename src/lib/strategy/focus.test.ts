import { describe, expect, it } from "vitest";
import { recommendedTasks } from "./shared";

describe("今日重点交付排序", () => {
  const now = new Date("2026-10-15T12:00:00+08:00");
  const task = (key: string, dueAt: string | null, priority = 2, group = "pending") => ({ key, dueAt, priority, group, status: "待开始", overdue: false });
  it("远期任务及其旧置顶不补满今日列表", () => {
    const tasks = [task("future", "2027-02-01"), task("soon", "2026-10-16"), task("unknown", null)];
    expect(recommendedTasks(tasks, [{ date: "2026-10-15", taskKey: "future", position: 0 }], now).map(row => row.key)).toEqual(["soon"]);
  });
  it("交付日期优先，同日按重要性，并保留人工顺序", () => {
    const tasks = [task("later", "2026-10-17", 1), task("low", "2026-10-16", 3), task("high", "2026-10-16", 1)];
    expect(recommendedTasks(tasks, [], now).map(row => row.key)).toEqual(["high", "low", "later"]);
    expect(recommendedTasks(tasks, [{ date: "2026-10-15", taskKey: "later", position: 0 }], now)[0].key).toBe("later");
  });
  it("上海日期七天边界，执行中无日期仍保留，完成排除", () => {
    const tasks = [task("edge", "2026-10-21T23:59:59+08:00"), task("outside", "2026-10-22T00:00:00+08:00"), task("running", null, 2, "running"), task("done", "2026-10-15", 1, "done")];
    expect(recommendedTasks(tasks, [], now).map(row => row.key)).toEqual(["edge", "running"]);
  });
});
