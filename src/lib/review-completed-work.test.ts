import { describe, expect, it } from "vitest";
import { reviewCompletedWork, type CompletedDailyWork } from "./review-completed-work";
import { reviewDeliveryDraft } from "./review-delivery-draft";

const range = { periodStart: "2026-10-05", periodEnd: "2026-10-11" };
const daily = (id: string, date: string, actionId: string | null = null): CompletedDailyWork => ({ id, title: "同名工作", actionId, completedAt: date, result: "实际结果", effectiveSceneId: "health", plan: { date: date.slice(0, 10) } });

describe("completed review work", () => {
  it("merges daily and ordinary completion by action ID while retaining daily occurrences", () => {
    const action = { id: "a", title: "健康记录", status: "已完成", completedAt: "2026-10-10T00:00:00Z", effectiveSceneId: "health", projectId: "p" };
    const d1 = daily("d1", "2026-10-09T00:00:00Z", "a"), d2 = daily("d2", "2026-10-10T00:00:00Z", "a");
    const result = reviewCompletedWork([action], [d1, d1, d2], range, "other");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceType: "action", sourceId: "a", title: "健康记录", sceneId: "health", projectId: "p" });
    expect(result[0].entries).toHaveLength(2);
  });
  it("does not deduplicate distinct works by title and keeps deleted actions as daily sources", () => {
    const result = reviewCompletedWork([], [daily("d1", "2026-10-06"), daily("d2", "2026-10-06", "deleted")], range, "other");
    expect(result.map(row => row.sourceId)).toEqual(["d1", "d2"]);
    expect(result.every(row => row.sourceType === "dailyTask")).toBe(true);
  });
  it("uses actual completion time in Shanghai rather than planned date, due date or updated time", () => {
    const rows = [daily("included", "2026-10-04T16:00:00Z"), daily("excluded", "2026-10-11T16:00:00Z"), daily("missing", ""), daily("invalid", "bad")];
    rows[0].plan.date = "2026-09-01";
    const result = reviewCompletedWork([{ id: "incomplete", status: "进行中", completedAt: "2026-10-06" }, { id: "complete", status: "已完成", completedAt: "2026-10-06" }, { id: "no-date", status: "已完成" }], rows, range, "other");
    expect(result.map(row => row.sourceId)).toEqual(["included", "complete"]);
    expect(result[0].entries[0]).toMatchObject({ date: "2026-10-05", planDate: "2026-09-01" });
    expect(result[1].sceneId).toBe("other");
  });
  it("includes completed daily work in drafts by scene only once per underlying action", () => {
    const action = { id: "a", title: "健康记录", status: "已完成", completedAt: "2026-10-06", effectiveSceneId: "health" };
    const work = reviewCompletedWork([action], [daily("d", "2026-10-06", "a")], range, "other");
    const draft = reviewDeliveryDraft([], [action], range, work, [{ id: "health", name: "健康" }]);
    expect(draft.wins).toContain("【健康】健康记录：2026-10-06 已完成；结果：实际结果");
    expect(draft.wins.match(/健康记录/g)).toHaveLength(1);
    const independent = reviewDeliveryDraft([], [], range, reviewCompletedWork([], [daily("d", "2026-10-06")], range, "other"));
    expect(independent.wins).toContain("实际结果");
    expect(independent.wins).toContain("实际完成工作 1 项，共 1 条完成记录");
    expect(independent.executionIssue).toContain("已汇总所选每日完成工作");
  });
});
