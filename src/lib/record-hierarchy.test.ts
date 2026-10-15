import { describe, expect, it } from "vitest";
import { recordAncestors, recordParentCandidates, visibleParents } from "./record-hierarchy";

describe("项目与任务层级", () => {
  const rows = [{ id: "a", goalId: "goal", projectId: "project" }, { id: "b", parentId: "a", goalId: "goal", projectId: "project" }, { id: "c", parentId: "b", goalId: "goal", projectId: "project" }, { id: "outside", goalId: "other", projectId: "other" }];
  it("支持多级路径并排除自身、后代和其他容器", () => {
    expect(recordAncestors(rows[2], rows).map(row => row.id)).toEqual(["a", "b"]);
    expect(recordParentCandidates(rows[0], rows, "action")).toEqual([]);
    expect(recordParentCandidates(rows[2], rows, "project").map(row => row.id)).toEqual(["a", "b"]);
  });
  it("历史循环和已删除父项不会丢失记录或无限递归", () => {
    const cyclic = [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }, { id: "c", parentId: "deleted" }];
    const parents = visibleParents(cyclic, new Set(["a", "b", "c"]));
    expect([...parents.values()].filter(value => value === null)).toHaveLength(2);
    expect(recordAncestors(cyclic[0], cyclic)).toHaveLength(1);
  });
});
