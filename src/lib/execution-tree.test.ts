import { describe, expect, it } from "vitest";
import { executionTree, missingTreeFields, type TreeFilters, type TreeRecord } from "./execution-tree";

const goals: TreeRecord[] = [
  { id: "long", title: "长期目标", sceneId: "work", horizon: "10年", status: "待开始", metric: "企业成果" },
  { id: "year", title: "年度目标", parentId: "long", sceneId: "work", horizon: "1年", status: "进行中", metric: "完成验证" },
  { id: "finance", title: "财务目标", sceneId: "finance", horizon: "1年", status: "待开始" },
];
const projects: TreeRecord[] = [
  { id: "project", name: "验证项目", goalId: "year", sceneId: "work", status: "进行中", metric: "交付报告" },
  { id: "independent", name: "独立项目", sceneId: "finance", status: "待开始" },
];
const actions: TreeRecord[] = [
  { id: "task", title: "访谈清单", projectId: "project", goalId: "finance", status: "待开始", standard: "整理五项" },
  { id: "done", title: "已完成任务", projectId: "project", status: "已完成", standard: "完成", dueDate: "2026-11-01" },
  { id: "direct", title: "直属任务", goalId: "year", status: "待开始" },
  { id: "free", title: "独立任务", sceneId: "finance", status: "待开始" },
  { id: "orphan", title: "已删除项目的任务", projectId: "deleted", status: "待开始" },
];
const filters: TreeFilters = { scene: "all", horizon: "all", status: "all", query: "", incomplete: false };
const build = (values: Partial<TreeFilters>) => executionTree(goals, projects, actions, "other", { ...filters, ...values });

describe("目标项目任务嵌套筛选", () => {
  it("深层子任务命中后保留多级任务、项目和目标路径", () => {
    const nestedProjects = [...projects, { id: "p2", parentId: "project", goalId: "year", name: "子项目" }, { id: "p3", parentId: "p2", goalId: "year", name: "孙项目" }];
    const nestedTasks = [{ id: "a1", projectId: "p3", goalId: "year", title: "父任务" }, { id: "a2", parentId: "a1", projectId: "p3", goalId: "year", title: "子任务" }, { id: "a3", parentId: "a2", projectId: "p3", goalId: "year", title: "深层命中" }];
    const tree = executionTree(goals, nestedProjects, nestedTasks, "other", { ...filters, query: "深层命中" });
    expect([...tree.included.actions]).toEqual(["a3", "a1", "a2"]);
    expect(tree.included.projects).toEqual(new Set(["project", "p2", "p3"]));
    expect(tree.included.goals).toEqual(new Set(["long", "year"]));
    expect(tree.projectParents.get("p3")).toBe("p2"); expect(tree.actionParents.get("a3")).toBe("a2");
    expect(tree.standaloneProjects).toEqual([]); expect(tree.standaloneActions).toEqual([]);
  });
  it("任务命中保留真实项目与完整祖先路径，任务只归属一次", () => {
    const tree = build({ query: "访谈" });
    expect([...tree.direct.actions]).toEqual(["task"]);
    expect([...tree.included.projects]).toEqual(["project"]);
    expect([...tree.included.goals]).toEqual(["year", "long"]);
    expect(tree.roots.map(row => row.id)).toEqual(["long"]);
    expect(tree.standaloneActions).toHaveLength(0);
    expect(tree.sceneOf(actions[0], "action")).toBe("work");
  });
  it("场景与周期、状态组合筛选不遗漏下级，也不猜测关联", () => {
    const tree = build({ scene: "work", horizon: "1年", status: "open" });
    expect([...tree.direct.goals]).toEqual(["year"]);
    expect([...tree.direct.actions]).toEqual(["task", "direct"]);
    expect(tree.parentById.get("year")).toBe("long");
    expect(tree.direct.actions.has("done")).toBe(false);
    expect(build({ scene: "finance" }).standaloneProjects.map(row => row.id)).toEqual(["independent"]);
  });
  it("未关联记录与已删除关联仍可见，直属任务不重复列为独立任务", () => {
    const tree = build({});
    expect(tree.standaloneActions.map(row => row.id)).toEqual(["free", "orphan"]);
    expect(tree.standaloneProjects.map(row => row.id)).toEqual(["independent"]);
    expect(tree.direct.actions.size).toBe(actions.length);
  });
  it("仅看待完善按实际缺失字段判断，完成标准可搜索", () => {
    expect(missingTreeFields("goal", goals[1])).toEqual(["截止日期"]);
    expect(missingTreeFields("project", projects[1])).toEqual(["所属目标", "衡量标准", "交付日期"]);
    expect(missingTreeFields("action", actions[2])).toEqual(["所属项目", "完成标准", "截止日期"]);
    expect(build({ incomplete: true }).direct.actions.has("done")).toBe(false);
    expect([...build({ query: "整理五项" }).direct.actions]).toEqual(["task"]);
    expect(build({ query: "不存在的内容" }).included.goals.size).toBe(0);
  });
  it("历史跨场景目标只在自身场景展示，筛选不带入其他场景的上级", () => {
    const cross = executionTree([...goals, { id: "cross", parentId: "long", title: "跨场景", sceneId: "finance" }], [], [], "other", { ...filters, scene: "finance" });
    expect(cross.included.goals.has("long")).toBe(false);
    expect(cross.parentById.get("cross")).toBeNull();
    expect(cross.roots.map(row => row.id)).toEqual(["finance", "cross"]);
    const all = executionTree([...goals, { id: "cross", parentId: "long", sceneId: "finance" }, { id: "child", parentId: "cross", sceneId: "finance" }], [], [], "other", filters);
    expect(all.roots.map(row => row.id)).toEqual(["long", "finance", "cross"]);
    expect(all.parentById.get("child")).toBe("cross");
    expect(all.parentById.get("year")).toBe("long");
    expect(all.sceneOf(all.roots.find(row => row.id === "cross")!, "goal")).toBe("finance");
  });
  it("循环数据各显示一次", () => {
    const cyclic = executionTree([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], [], [], "other", filters);
    expect(cyclic.roots).toHaveLength(1);
    expect(cyclic.included.goals.size).toBe(2);
  });
});
