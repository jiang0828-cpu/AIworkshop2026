import { describe, expect, it } from "vitest";
import { arrangeTimes, assertTimeFree, estimatedSpan, readSchedule, reservationsFor, scheduleSchema, withSchedule, type SchedulableTask } from "./scheduling";
import { rulePlan } from "./provider";
import { sceneDefaults } from "../scenes";
import { readOrchestration, stepReady } from "./workflow";

const scenes = sceneDefaults.map((scene, position) => ({ ...scene, id: `scene-${scene.slot}`, position }));
const now = new Date("2026-10-08T06:00:00+08:00");
const task = (slot = 0, priority = 2, minutes = 30): SchedulableTask => ({ title: "处理事项", priority, dueAt: null, sceneId: `scene-${slot}`, steps: [{ assignee: "human", estimatedMinutes: minutes }] });
const at = (schedule: { startsAt: string | null }) => schedule.startsAt!.slice(11, 16);
describe("每日时间匹配", () => {
  it("场景稳定身份对应工作白天、家庭晚间、爱好晚间、健康早晚", () => {
    const renamed = scenes.map((scene) => ({ ...scene, name: "自定义名称" }));
    const result = [0, 2, 5, 3].map((slot) => arrangeTimes([task(slot)], "2026-10-08", renamed, [], now)[0]);
    expect(result.map((row) => at(row.schedule))).toEqual(["09:00", "19:00", "20:00", "07:00"]);
  });
  it("高优先先分配，人工不重叠，预留 10 分钟休息", () => {
    const result = arrangeTimes([task(0, 3), task(0, 1)], "2026-10-08", scenes, [], now);
    expect(at(result[1].schedule)).toBe("09:00");
    expect(at(result[0].schedule)).toBe("09:40");
    expect(() => assertTimeFree(result, [])).not.toThrow();
  });
  it("工作沟通优先下午，需预约事项使用营业时段且标注待确认", () => {
    const result = arrangeTimes([{ ...task(), title: "与客户沟通" }, { ...task(3), title: "体检预约" }], "2026-10-08", scenes, [], now);
    expect(at(result[0].schedule)).toBe("14:00"); expect(at(result[1].schedule)).toBe("09:00");
    expect(result[1].schedule.warnings.join()).toContain("不代表预约成功");
  });
  it("依赖按关键路径预计，AI 可以重叠准备但验收不重叠", () => {
    const agents = [{ id: "writer", name: "写作", role: "writing", enabled: true, prompt: "写作", model: "", timeoutSeconds: 120 }];
    const draft = { ...rulePlan("交付文稿", "2026-10-08", agents)[0], sceneId: "scene-0" };
    expect(estimatedSpan(draft).duration).toBe(40);
    const result = arrangeTimes([draft, { ...draft, title: "第二份文稿" }], "2026-10-08", scenes, [], now);
    expect(new Date(result[1].schedule.startsAt!).getTime()).toBeLessThan(new Date(result[0].schedule.endsAt!).getTime());
    expect(() => assertTimeFree(result, [])).not.toThrow();
    const waiting = { ...draft, steps: draft.steps.map((step) => ({ ...step, status: "review" })) };
    expect(estimatedSpan(waiting).duration).toBe(10);
  });
  it("已占用时段、午休、周末和上海日期边界不会被挤占", () => {
    const result = arrangeTimes([task()], "2026-10-08", scenes, [{ startsAt: "2026-10-08T09:00:00+08:00", endsAt: "2026-10-08T12:00:00+08:00" }], now);
    expect(at(result[0].schedule)).toBe("14:00");
    const weekend = arrangeTimes([task()], "2026-10-10", scenes, [], now)[0];
    expect(weekend.schedule.startsAt).toContain("2026-10-12T09:00");
    const late = arrangeTimes([task(5)], "2026-10-08", scenes, [], new Date("2026-10-08T15:58:00Z"))[0];
    expect(late.schedule.startsAt).toContain("2026-10-09T20:00");
    expect(late.schedule.warnings.join()).toContain("顺延");
  });
  it("截止前无容量时不伪造准时安排，逾期可建议下一时段但不改期限", () => {
    const deadline = "2026-10-08T08:10:00+08:00";
    const result = arrangeTimes([{ ...task(), dueAt: deadline }], "2026-10-08", scenes, [], now)[0];
    expect(result.schedule.startsAt).toBeNull(); expect(result.dueAt).toBe(deadline);
    const expired = arrangeTimes([{ ...task(), dueAt: "2026-10-07T12:00:00+08:00" }], "2026-10-08", scenes, [], now)[0];
    expect(expired.schedule.startsAt).not.toBeNull(); expect(expired.schedule.warnings.join()).toContain("已过");
  });
  it("手动时段保留且参与占用，校验无效时段与碰撞", () => {
    const schedule = { startsAt: "2026-10-08T09:00:00+08:00", endsAt: "2026-10-08T09:30:00+08:00", mode: "manual" as const, reason: "本人安排", warnings: [] };
    const result = arrangeTimes([{ ...task(), schedule }, task()], "2026-10-08", scenes, [], now);
    expect(result[0].schedule).toEqual(schedule); expect(at(result[1].schedule)).toBe("09:40");
    expect(() => assertTimeFree([{ ...task(), schedule }], reservationsFor([{ ...task(), schedule }]))).toThrow("冲突");
    expect(scheduleSchema.safeParse({ ...schedule, endsAt: schedule.startsAt }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...schedule, endsAt: null }).success).toBe(false);
  });
  it("过长任务提示拆小，旧执行配置加时间不会改变顺序", () => {
    const result = arrangeTimes([task(3, 2, 300)], "2026-10-08", scenes, [], now)[0];
    expect(result.schedule.startsAt).toBeNull(); expect(result.schedule.warnings.join()).toContain("拆小");
    const value = withSchedule("{}", result.schedule);
    expect(readSchedule(value)).toEqual(result.schedule); expect(readOrchestration(value)).toBeNull();
    expect(stepReady({ orchestration: value, steps: [{ position: 0, status: "pending", assignee: "human" }, { position: 1, status: "pending", assignee: "human" }] }, 1)).toBe(false);
  });
});
