import { describe, expect, it } from "vitest";
import { recurrenceLabel, taskHours, taskMinutes } from "./task-schedule";
import { parseEntity } from "./strategy/entity";

describe("task recurrence and minute estimates", () => {
  it.each([1, 7, 30, 60, 91, 1440])("round trips %s minutes without changing estimates", minutes => {
    expect(taskMinutes(taskHours(minutes))).toBe(minutes);
  });
  it.each([0, -1, 0.5, NaN, Infinity, 6000001])("rejects invalid minute input %s", minutes => {
    expect(() => taskHours(minutes)).toThrow();
  });
  it("converts legacy hours and leaves unknown effort unknown", () => {
    expect(taskMinutes(0.5)).toBe(30);
    expect(taskMinutes(1.5)).toBe(90);
    expect(taskMinutes(null)).toBe(0);
    expect(taskMinutes(0)).toBe(0);
  });
  it("validates recurrence and preserves partial updates", () => {
    expect(parseEntity("action", { recurrence: "weekly", estimatedHours: taskHours(1) })).toMatchObject({ recurrence: "weekly", estimatedHours: 1 / 60 });
    expect(() => parseEntity("action", { recurrence: "yearly" })).toThrow();
    expect(parseEntity("action", { status: "已完成" })).toEqual({ status: "已完成" });
    expect(recurrenceLabel()).toBe("非周期性");
    expect(recurrenceLabel("monthly")).toBe("每月");
  });
});
