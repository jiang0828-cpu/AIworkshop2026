import { describe, expect, it } from "vitest";
import { goalAncestors, hierarchyIssue, parentCandidates, sortGoals, treeWithAncestors } from "./goal-hierarchy";

describe("目标领域与时间从属", () => {
  const goals = [
    { id: "long", title: "长期", sceneId: "work", horizon: "10年" },
    { id: "middle", title: "中期", sceneId: "work", horizon: "3年", parentId: "long" },
    { id: "short", title: "年度", sceneId: "work", horizon: "1年", parentId: "middle" },
    { id: "finance", title: "财务", sceneId: "finance", horizon: "5年" },
  ];
  it("同领域长周期作为上级，跨领域与同周期不可从属", () => {
    expect(parentCandidates(goals[2], goals, "other").map((row) => row.id)).toEqual(["long", "middle"]);
    expect(hierarchyIssue(goals[2], { ...goals[0], horizon: "年度" }, "other")).toContain("长于");
    expect(hierarchyIssue(goals[2], goals[3], "other")).toContain("场景不同");
    expect(hierarchyIssue({ id: "new", horizon: "本月" }, { id: "old", horizon: "90天", sceneId: "other" }, "other")).toBe("");
  });
  it("后代不能成为上级，即使周期被调长；循环查询终止", () => {
    const changed = goals.map((row) => row.id === "short" ? { ...row, horizon: "10年" } : row);
    expect(parentCandidates(goals[1], changed, "other").map((row) => row.id)).toEqual(["long"]);
    expect(goalAncestors({ id: "a", parentId: "b" }, [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }])).toHaveLength(1);
  });
  it("周期筛选保留同场景祖先，跨场景关系不混入分组", () => {
    expect(treeWithAncestors([goals[2]], goals, "other").map((row) => row.id)).toEqual(["long", "middle", "short"]);
    const cross = { ...goals[2], parentId: "finance" };
    expect(treeWithAncestors([cross], [...goals, cross].filter((row) => row.id !== "short" || row === cross), "other")).toEqual([cross]);
    expect(sortGoals([goals[2], goals[0], goals[1]]).map((row) => row.id)).toEqual(["long", "middle", "short"]);
  });
});
