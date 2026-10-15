import { describe, expect, it } from "vitest";
import { periodDeliveries } from "./period-deliveries";
import { planReviewRanges } from "./review-period";

const { current, previous } = planReviewRanges("weekly", new Date("2026-10-15T00:00:00Z"));
const projects = [
  { id: "milestones", milestones: [{ id: "due", deadline: "2026-10-18", status: "已完成" }, { id: "future", deadline: "2026-10-19" }] },
  { id: "tasks" },
  { id: "last", milestones: [{ deadline: "2026-10-05" }] },
  { id: "unscheduled", milestones: [{ title: "No date" }] },
];
const actions = [
  { id: "future", projectId: "tasks", dueDate: "2026-10-19" },
  { id: "last", projectId: "last", dueDate: "2026-10-11", status: "待开始" },
  { id: "end", projectId: "tasks", dueDate: "2026-10-18", status: "已完成" },
  { id: "start", projectId: "tasks", dueDate: "2026-10-12", status: "进行中" },
  { id: "standalone", projectId: null, dueDate: "2026-10-15" },
  { id: "deleted-project", projectId: "deleted", dueDate: "2026-10-16" },
  { id: "unscheduled", projectId: "unscheduled", dueDate: null },
];

describe("period deliveries reuse project milestones and action deadlines", () => {
  it("includes projects with in-period milestones or tasks exactly once", () => {
    const result = periodDeliveries(projects, actions, current);
    expect(result.projects.map(row => row.project.id)).toEqual(["milestones", "tasks"]);
    expect(result.projects[0].milestones.map(row => row.id)).toEqual(["due"]);
    expect(result.projects[1].tasks.map(row => row.id)).toEqual(["start", "end"]);
  });
  it("keeps independent tasks and deleted-project tasks without inventing a project", () => {
    const result = periodDeliveries(projects, actions, current);
    expect(result.tasks.map(row => row.id)).toEqual(["start", "standalone", "deleted-project", "end"]);
    expect(result.projects.some(row => row.project.id === "deleted")).toBe(false);
  });
  it("uses due dates rather than completion status for the preceding period", () => {
    const result = periodDeliveries(projects, actions, previous);
    expect(result.tasks.map(row => row.id)).toEqual(["last"]);
    expect(result.projects.map(row => row.project.id)).toEqual(["last"]);
    expect(result.projects[0].milestones).toHaveLength(1);
  });
  it("excludes undated items and handles empty data", () => {
    expect(periodDeliveries(projects, actions, current).tasks.some(row => row.id === "unscheduled")).toBe(false);
    expect(periodDeliveries([], [], current)).toEqual({ tasks: [], projects: [] });
  });
  it("includes a project by its own delivery date without milestones or tasks", () => {
    const dated = [{ id: "due-project", deadline: "2026-10-18" }, { id: "later-project", deadline: "2026-10-19" }];
    expect(periodDeliveries(dated, [], current).projects.map(row => row.project.id)).toEqual(["due-project"]);
    expect(periodDeliveries(dated, [], planReviewRanges("monthly", new Date("2026-10-15T00:00:00Z")).current).projects).toHaveLength(2);
    expect(periodDeliveries(dated, [], planReviewRanges("yearly", new Date("2026-10-15T00:00:00Z")).current).projects).toHaveLength(2);
    dated[0].deadline = "2027-01-02";
    expect(periodDeliveries(dated, [], current).projects).toHaveLength(0);
  });
});
