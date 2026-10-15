import { describe, expect, it } from "vitest";
import { computeMetrics, type DailyView, type TaskView } from "./daily/shared";
import { buildOverview, hasCurrentWeekReview, overviewCounts } from "./workbench-overview";

const now = new Date("2026-10-02T10:00:00+08:00");
function task(statuses = ["done", "review", "pending"]): TaskView {
  return { id: "daily-1", title: "Review output", lane: "mixed", priority: 1, dueAt: null, actionId: "action-1", sceneId: null,
    notes: "", result: "", syncedAt: null, completedAt: null, checkpoints: [], effectiveSceneId: "local-profile-scene-4", sceneSource: "default",
    affiliation: { kind: "planned", goalId: null, projectId: null }, goalName: null, projectName: null,
    steps: statuses.map((status, position) => ({ id: `step-${position}`, position, title: `Step ${position}`, status,
      assignee: position === 0 ? "human" : "ai", agentId: null, estimatedMinutes: 10, notes: "", result: "",
      blockedReason: "", timers: [], runs: [] })) };
}
function daily(tasks = [task()], date = "2026-10-02"): DailyView {
  return { date, plan: { id: "plan-1", input: "", source: "rules", tasks, report: null }, agents: [], assets: [],
    metrics: computeMetrics(tasks, now), actions: [], configured: true, heartbeat: null, scenes: [], sceneCounts: [], goals: [], projects: [] };
}

describe("workbench overview", () => {
  it("keeps goal and project lineage for an independent daily task", () => {
    const row = task(); row.actionId = null; row.affiliation = { kind: "temporary", goalId: "goal-1", projectId: "project-1" };
    const result = buildOverview({ goals: [{ id: "goal-1", title: "Goal" }], projects: [{ id: "project-1", name: "Project" }] }, daily([row]), now);
    expect(result[0]).toMatchObject({ source: "daily", goal: "Goal", project: "Project" });
  });
  it("merges an imported action with its daily execution and retains its lineage", () => {
    const tasks = buildOverview({ actions: [{ id: "action-1", title: "Action", goalId: "goal-1", projectId: "project-1" }],
      goals: [{ id: "goal-1", title: "Goal" }], projects: [{ id: "project-1", name: "Project" }] }, daily(), now);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ source: "daily", goal: "Goal", project: "Project", group: "attention", progress: { done: 1, total: 3 } });
  });
  it("keeps actions visible when daily data is unavailable or belongs to yesterday", () => {
    const data = { actions: [{ id: "action-1", title: "Action" }] };
    expect(buildOverview(data, null, now)).toHaveLength(1);
    expect(buildOverview(data, daily([task()], "2026-10-01"), now)[0].source).toBe("action");
  });
  it("uses the end of the Shanghai day for date-only deadlines, and exact time for daily tasks", () => {
    const run = task(["pending"]); run.actionId = null; run.dueAt = "2026-10-02T09:00:00+08:00";
    const tasks = buildOverview({ actions: [{ id: "today", dueDate: "2026-10-02T00:00:00Z" }, { id: "yesterday", dueDate: "2026-10-01T00:00:00Z" }] }, daily([run]), now);
    expect(tasks.find((item) => item.id === "today")?.overdue).toBe(false);
    expect(tasks.find((item) => item.id === "yesterday")?.overdue).toBe(true);
    expect(tasks.find((item) => item.id === "daily-1")?.overdue).toBe(true);
  });
  it("counts only actual completion and keeps review, blocked and failed tasks actionable", () => {
    const tasks = buildOverview({ actions: [{ id: "done", status: "已完成", dueDate: "2026-09-01" }, { id: "running", status: "进行中" }, { id: "blocked", status: "阻塞" }],
      aiTasks: [{ id: "review", status: "待验收" }, { id: "ai-done", status: "完成" }, { id: "archived", status: "归档" }] }, daily([task(["failed"])]), now);
    expect(overviewCounts(tasks)).toEqual({ pending: 0, running: 1, attention: 3, done: 2 });
    expect(tasks.find((item) => item.id === "done")?.overdue).toBe(false);
    expect(tasks.some((item) => item.id === "archived")).toBe(false);
    expect(tasks[0].group).toBe("attention");
  });
  it("does not treat an old review as this week's review, including the Sunday/Monday boundary", () => {
    const reviews = [{ periodStart: "2026-09-21T00:00:00Z", periodEnd: "2026-09-27T00:00:00Z" }];
    expect(hasCurrentWeekReview(reviews, now)).toBe(false);
    expect(hasCurrentWeekReview(reviews, new Date("2026-09-27T23:59:59+08:00"))).toBe(true);
    expect(hasCurrentWeekReview(reviews, new Date("2026-09-28T00:00:00+08:00"))).toBe(false);
    expect(hasCurrentWeekReview([{ periodStart: "2026-09-01", periodEnd: "2026-09-30" }], now)).toBe(false);
    expect(hasCurrentWeekReview([{ periodStart: "2026-01-01", periodEnd: "2026-12-31" }], now)).toBe(false);
  });
});
