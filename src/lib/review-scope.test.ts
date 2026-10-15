import { describe, expect, it, vi } from "vitest";
import { reviewScopeSchema, validateReviewScope, writeReviewScope } from "./review-scope";
import { reviewSources } from "./review-links";
import { PROFILE_ID } from "./db";
import type { StrategyDB } from "./strategy/service";

function database(projects = [{ id: "p", name: "Project" }], actions: { id: string; title: string; projectId: string | null }[] = [{ id: "a", title: "Task", projectId: "p" }], daily: { id: string; title: string; actionId?: string | null }[] = []) {
  return { project: { findMany: vi.fn(async () => projects) }, action: { findMany: vi.fn(async () => actions) }, dailyTask: { findMany: vi.fn(async () => daily) }, recordSource: { deleteMany: vi.fn(), create: vi.fn() } };
}
const scope = { projectIds: ["p"], actionIds: ["a"] };

describe("project and task review scope", () => {
  it("requires a source, allowing independent work and rejecting duplicates", () => {
    for (const input of [{}, { projectIds: [], actionIds: [], dailyTaskIds: [] }, { ...scope, actionIds: ["a", "a"] }, { dailyTaskIds: ["d", "d"] }]) expect(() => reviewScopeSchema.parse(input)).toThrow();
    expect(reviewScopeSchema.parse({ dailyTaskIds: ["d"] })).toEqual({ projectIds: [], actionIds: [], dailyTaskIds: ["d"] });
  });
  it("validates ownership of every project and task", async () => {
    const db = database();
    await expect(validateReviewScope(db as unknown as StrategyDB, scope)).resolves.toHaveLength(2);
    expect(db.project.findMany).toHaveBeenCalledWith({ where: { profileId: PROFILE_ID, id: { in: ["p"] } } });
    expect(db.action.findMany).toHaveBeenCalledWith({ where: { profileId: PROFILE_ID, id: { in: ["a"] } } });
    await expect(validateReviewScope(database([]) as unknown as StrategyDB, scope)).rejects.toThrow("当前档案");
    await expect(validateReviewScope(database(undefined, []) as unknown as StrategyDB, scope)).rejects.toThrow("当前档案");
  });
  it("supports independent actions and completed daily work without manufacturing projects", async () => {
    await expect(validateReviewScope(database([], [{ id: "a", title: "Task", projectId: null }]) as unknown as StrategyDB, { actionIds: ["a"] })).resolves.toEqual([{ sourceType: "action", sourceId: "a", sourceTitle: "Task" }]);
    const db = database([], [], [{ id: "d", title: "Daily" }]);
    await expect(validateReviewScope(db as unknown as StrategyDB, { dailyTaskIds: ["d"] })).resolves.toHaveLength(1);
    expect(db.dailyTask.findMany).toHaveBeenCalledWith({ where: { id: { in: ["d"] }, plan: { profileId: PROFILE_ID }, completedAt: { not: null }, steps: { some: {}, every: { status: "done" } } } });
    await expect(validateReviewScope(database([], [], []) as unknown as StrategyDB, { dailyTaskIds: ["d"] })).rejects.toThrow("验收");
    await expect(validateReviewScope(database([], [{ id: "a", title: "A", projectId: null }], [{ id: "d", title: "D", actionId: "a" }]) as unknown as StrategyDB, { actionIds: ["a"], dailyTaskIds: ["d"] })).rejects.toThrow("重复");
  });
  it("replaces only this review's project and task links, preserving other sources", async () => {
    const db = database();
    await writeReviewScope(db as unknown as StrategyDB, "r", scope);
    expect(db.recordSource.deleteMany).toHaveBeenCalledWith({ where: { profileId: PROFILE_ID, targetType: "review", targetId: "r", sourceType: { in: ["project", "action", "dailyTask"] } } });
    expect(db.recordSource.create).toHaveBeenCalledTimes(2);
    expect(db.recordSource.create.mock.calls[0][0]).toMatchObject({ data: { profileId: PROFILE_ID, targetType: "review", targetId: "r", sourceType: "project", sourceId: "p", sourceTitle: "Project" } });
  });
  it("retains saved source labels independently of deleted business records", () => {
    const sources = [{ targetType: "review", targetId: "r", sourceType: "action", sourceId: "deleted", sourceTitle: "Original title" }];
    expect(reviewSources(sources, "r")[0].sourceTitle).toBe("Original title");
    expect(reviewSources(sources, "other")).toEqual([]);
  });
});
