import { describe, expect, it } from "vitest";
import { reviewDeliveryDraft } from "./review-delivery-draft";

const projects = [{ id: "p", name: "Project", status: "进行中", deadline: "2026-10-11" }];
const actions = [
  { id: "pending", title: "Pending task", projectId: "p", status: "待开始", dueDate: "2026-10-10" },
  { id: "done", title: "Done task", projectId: "p", status: "已完成", dueDate: "2026-10-09" },
];

describe("review drafts from delivery records", () => {
  it("fills results and unfinished work using recorded statuses without inventing reasons", () => {
    const draft = reviewDeliveryDraft(projects, actions);
    expect(draft.wins).toContain("当前已完成 1 项，未完成 1 项");
    expect(draft.wins).toContain("已完成：Done task（Project；截止 2026-10-09）");
    expect(draft.wins).not.toContain("已完成：Pending task");
    expect(draft.executionIssue).toContain("未完成：Pending task");
    expect(draft.executionIssue).toContain("原因待补充");
    expect(draft.executionIssue).not.toContain("Done task");
    expect(draft.adjustment).toContain("Pending task");
    expect(draft.adjustment).not.toContain("Done task");
  });
  it("regenerates only from selected records and never mutates them", () => {
    const original = JSON.stringify(actions);
    const selected = reviewDeliveryDraft(projects, [actions[1]]);
    expect(selected.wins).toContain("交付任务 1 项");
    expect(selected.executionIssue).toContain("当前均已完成");
    expect(JSON.stringify(actions)).toBe(original);
    expect(reviewDeliveryDraft(projects, [...actions].reverse())).toEqual(reviewDeliveryDraft(projects, actions));
  });
  it("handles empty data and missing project dates without claiming completion", () => {
    expect(reviewDeliveryDraft([], []).executionIssue).toBe("尚未选择任务。");
    const draft = reviewDeliveryDraft([], [{ id: "a", title: "Standalone", status: "进行中" }]);
    expect(draft.executionIssue).toContain("未关联项目；截止 未排期");
  });
  it("keeps large drafts within the API text limit while retaining complete source references", () => {
    const draft = reviewDeliveryDraft(projects, Array.from({ length: 500 }, (_, index) => ({ ...actions[0], id: String(index), title: "Task ".repeat(40) + index })));
    for (const text of Object.values(draft)) expect(text.length).toBeLessThanOrEqual(5000);
    expect(draft.executionIssue).toContain("请查看关联项目任务");
    expect(draft.wins).toContain("交付任务 500 项");
  });
});
