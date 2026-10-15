import { describe, expect, it } from "vitest";
import { deliveryAt, intakeActions, recommendedIntake, toIntakeEdit } from "./intake";
import type { DailyView } from "./shared";

const action = (id: string, fields: Partial<DailyView["actions"][number]> = {}): DailyView["actions"][number] => ({
  id, title: id, status: "待开始", estimatedHours: 1, purpose: "具体内容", standard: "交付标准", dueDate: "2026-10-15T00:00:00+08:00",
  updatedAt: "2026-10-14T00:00:00Z", completedAt: null, effectiveSceneId: "work", goalId: "goal", projectId: "project", ...fields,
});
function view(actions: DailyView["actions"]): DailyView {
  return { date: "2026-10-15", actions, projects: [{ id: "project", name: "项目", goalId: "goal", sceneId: "work", deadline: "2026-10-15T23:00:00+08:00" }], plan: null } as DailyView;
}

describe("今日待确认清单", () => {
  it("周期任务按重复日推荐，本次截止使用当天，不复制原始远期截止日期", () => {
    const recurring = { recurrence: "daily", createdAt: "2026-10-01T00:00:00Z", dueDate: "2030-12-15T00:00:00Z" };
    const data = view([action("daily", recurring), action("independent-daily", { ...recurring, projectId: null }), action("weekly", { ...recurring, recurrence: "weekly" }), action("off-day", { ...recurring, recurrence: "weekly", createdAt: "2026-10-02T00:00:00Z" }), action("ended", { ...recurring, dueDate: "2026-10-14" })]);
    expect(recommendedIntake(data).map(row => row.actionId)).toEqual(["daily", "weekly", "independent-daily"]);
    expect(recommendedIntake(data).every(row => row.dueAt === "2026-10-15T23:59:59+08:00")).toBe(true);
    data.plan = { tasks: [{ actionId: "daily" }] } as DailyView["plan"];
    expect(recommendedIntake(data).some(row => row.actionId === "daily")).toBe(false);
  });
  it("按交付时间选逾期及当天项目任务，上海午夜边界后任务留待手动加入", () => {
    const data = view([
      action("tomorrow", { dueDate: "2026-10-15T16:00:00Z" }),
      action("today", { dueDate: "2026-10-15T15:59:59Z" }),
      action("late", { dueDate: "2026-10-10T00:00:00Z" }),
      action("independent", { projectId: null }),
      action("fallback", { dueDate: null }),
    ]);
    expect(recommendedIntake(data).map((row) => row.actionId)).toEqual(["late", "fallback", "today"]);
    expect(intakeActions(data).at(-1)?.id).toBe("independent");
  });
  it("排除已完成、已取消和同日已导入，保留无日期的可选任务", () => {
    const data = view([action("done", { status: "已完成" }), action("completed", { completedAt: "2026-10-14T00:00:00Z" }), action("cancelled", { status: "已取消" }), action("existing"), action("undated", { dueDate: null, projectId: null })]);
    data.plan = { tasks: [{ actionId: "existing" }] } as DailyView["plan"];
    expect(intakeActions(data).map((row) => row.id)).toEqual(["undated"]);
    expect(recommendedIntake(data)).toEqual([]);
  });
  it("最多自动填入20项，任务日期优先且构建草稿不改写来源", () => {
    const data = view(Array.from({ length: 25 }, (_, index) => action(String(index).padStart(2, "0"))));
    expect(recommendedIntake(data)).toHaveLength(20);
    expect(deliveryAt(data.actions[0], data.projects)).toBe(data.actions[0].dueDate);
    const edit = toIntakeEdit(data.actions[0], data.projects);
    edit.title = "今日调整";
    expect(data.actions[0].title).toBe("00");
    expect(edit.updatedAt).toBe(data.actions[0].updatedAt);
  });
});
