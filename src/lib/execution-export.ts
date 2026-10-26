import { executionTree, type TreeFilters, type TreeRecord } from "./execution-tree";
import { sortGoals } from "./goal-hierarchy";
import { otherSceneId, type SceneRow } from "./scenes";
import { recurrenceLabel, taskMinutes } from "./task-schedule";

export type ExportScope = "filtered" | "all" | "selected";
export type ExecutionExportRecord = TreeRecord & {
  description?: string; purpose?: string; budget?: string; boundary?: string; risk?: string; stopCondition?: string;
  completedAt?: string | null;
  milestones?: Array<{ title: string; status?: string; deadline?: string | null; metric?: string }>;
};
export type ExportSection = {
  kind: "scene" | "group" | "goal" | "project" | "action";
  id?: string; title: string; metadata: string[];
  fields: Array<{ label: string; value: string }>;
  children: ExportSection[];
};
export type ExecutionDocument = {
  title: string; exportedAt: string; scopeLabel: string; filters: string[];
  counts: { goals: number; projects: number; actions: number; context: number };
  sections: ExportSection[];
};
export const exportScopeLabels: Record<ExportScope, string> = {
  filtered: "当前筛选结果", all: "全部目标项目任务", selected: "已勾选目标及全部下级",
};
const allFilters: TreeFilters = { scene: "all", horizon: "all", status: "all", query: "", incomplete: false };

export function exportDate(value?: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function descendants(rows: ExecutionExportRecord[], ids: Set<string>) {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (row.parentId && result.has(row.parentId) && !result.has(row.id)) { result.add(row.id); changed = true; }
  }
  return result;
}

export function buildExecutionDocument(input: {
  goals: ExecutionExportRecord[]; projects: ExecutionExportRecord[]; actions: ExecutionExportRecord[];
  scenes: SceneRow[]; filters: TreeFilters; scope: ExportScope; selected?: string[]; now?: Date;
}): ExecutionDocument {
  let { goals, projects, actions } = input;
  const { scenes, scope } = input;
  if (scope === "selected") {
    const goalIds = descendants(goals, new Set(input.selected || []));
    goals = goals.filter(row => goalIds.has(row.id));
    const projectIds = descendants(projects, new Set(projects.filter(row => row.goalId && goalIds.has(row.goalId)).map(row => row.id)));
    projects = projects.filter(row => projectIds.has(row.id));
    const actionIds = descendants(actions, new Set(actions.filter(row => row.projectId ? projectIds.has(row.projectId) : Boolean(row.goalId && goalIds.has(row.goalId))).map(row => row.id)));
    actions = actions.filter(row => actionIds.has(row.id));
  }
  const filters = scope === "filtered" ? input.filters : allFilters;
  const fallback = otherSceneId(scenes);
  const tree = executionTree(goals, projects, actions, fallback, filters);
  const sceneName = (row: ExecutionExportRecord, kind: "goal" | "project" | "action") => scenes.find(scene => scene.id === tree.sceneOf(row, kind))?.name || "其他";
  const seen = { goal: new Set<string>(), project: new Set<string>(), action: new Set<string>() };
  let context = 0;
  const node = (kind: "goal" | "project" | "action", row: ExecutionExportRecord): ExportSection => {
    const pathOnly = !tree.direct[kind === "goal" ? "goals" : kind === "project" ? "projects" : "actions"].has(row.id);
    if (pathOnly) context++;
    const metadata = [sceneName(row, kind), row.status || "状态未设置", ...(row.recordCode ? [row.recordCode] : []), ...(pathOnly ? ["上级路径"] : [])];
    const fields: ExportSection["fields"] = [];
    const add = (label: string, value?: string | null) => { if (value?.trim()) fields.push({ label, value: value.trim() }); };
    if (kind === "goal") {
      add("周期", row.horizon || "未设置"); add("截止日期", exportDate(row.deadline));
      add("目标说明", row.description); add("衡量标准", row.metric || "未填写");
    } else if (kind === "project") {
      add("交付日期", exportDate(row.deadline)); add("项目说明", row.description);
      add("衡量标准", row.metric || "未填写"); add("投入", row.budget); add("范围与边界", row.boundary);
      add("风险", row.risk); add("停止条件", row.stopCondition);
      row.milestones?.forEach((milestone, index) => add(`里程碑 ${index + 1}`, `${milestone.title}\n状态：${milestone.status || "未开始"}\n交付日期：${exportDate(milestone.deadline)}${milestone.metric ? `\n衡量标准：${milestone.metric}` : ""}`));
    } else {
      add("交付日期", exportDate(row.dueDate)); add("任务目的", row.purpose);
      add("完成标准", row.standard || "未填写"); add("任务周期", recurrenceLabel(row.recurrence));
      const minutes = taskMinutes(row.estimatedHours);
      add("预计投入", minutes ? `${minutes} 分钟` : "未设置");
      if (row.completedAt) add("完成日期", exportDate(row.completedAt));
    }
    return { kind, id: row.id, title: `${kind === "goal" ? "目标" : kind === "project" ? "项目" : "任务"} ${row.title || row.name || "未命名"}`, metadata, fields, children: [] };
  };
  const actionNode = (row: ExecutionExportRecord): ExportSection[] => {
    if (seen.action.has(row.id) || !tree.included.actions.has(row.id)) return [];
    seen.action.add(row.id);
    const result = node("action", row);
    result.children = actions.filter(item => tree.actionParents.get(item.id) === row.id).flatMap(actionNode);
    return [result];
  };
  const projectNode = (row: ExecutionExportRecord): ExportSection[] => {
    if (seen.project.has(row.id) || !tree.included.projects.has(row.id)) return [];
    seen.project.add(row.id);
    const result = node("project", row);
    result.children = [
      ...projects.filter(item => tree.projectParents.get(item.id) === row.id).flatMap(projectNode),
      ...actions.filter(item => item.projectId === row.id && !tree.actionParents.get(item.id)).flatMap(actionNode),
    ];
    return [result];
  };
  const goalNode = (row: ExecutionExportRecord): ExportSection[] => {
    if (seen.goal.has(row.id) || !tree.included.goals.has(row.id)) return [];
    seen.goal.add(row.id);
    const result = node("goal", row);
    result.children = [
      ...sortGoals(goals.filter(item => tree.parentById.get(item.id) === row.id)).flatMap(goalNode),
      ...projects.filter(item => item.goalId === row.id && !tree.projectParents.get(item.id)).flatMap(projectNode),
      ...actions.filter(item => item.goalId === row.id && !projects.some(project => project.id === item.projectId) && !tree.actionParents.get(item.id)).flatMap(actionNode),
    ];
    return [result];
  };
  const group = (title: string, children: ExportSection[], kind: "scene" | "group" = "group"): ExportSection => ({ kind, title, children, metadata: [], fields: [] });
  const sections = [...scenes].sort((a, b) => a.position - b.position).map(scene => group(scene.name, sortGoals(tree.roots.filter(row => tree.sceneOf(row, "goal") === scene.id)).flatMap(goalNode), "scene")).filter(section => section.children.length);
  const unknownGoals = tree.roots.filter(row => !seen.goal.has(row.id)).flatMap(goalNode);
  if (unknownGoals.length) sections.push(group("其他场景", unknownGoals, "scene"));
  const independentProjects = tree.standaloneProjects.flatMap(projectNode);
  if (independentProjects.length) sections.push(group("未关联目标的项目", independentProjects));
  const independentActions = tree.standaloneActions.flatMap(actionNode);
  if (independentActions.length) sections.push(group("未关联项目的独立任务", independentActions));
  // Preserve every included legacy record, even when its saved hierarchy is inconsistent.
  const remaining = [...goals.flatMap(goalNode), ...projects.flatMap(projectNode), ...actions.flatMap(actionNode)];
  if (remaining.length) sections.push(group("其他关联记录", remaining));
  const filterLabels = scope !== "filtered" ? [] : [
    `场景：${filters.scene === "all" ? "全部" : scenes.find(scene => scene.id === (filters.scene === "unclassified" ? fallback : filters.scene))?.name || "其他"}`,
    `目标周期：${filters.horizon === "all" ? "全部" : filters.horizon}`,
    `状态：${filters.status === "all" ? "全部" : filters.status === "open" ? "未完成" : filters.status}`,
    ...(filters.query.trim() ? [`搜索：${filters.query.trim()}`] : []), ...(filters.incomplete ? ["仅看待完善"] : []),
  ];
  return { title: "目标项目任务执行计划", exportedAt: (input.now || new Date()).toISOString(), scopeLabel: exportScopeLabels[scope], filters: filterLabels,
    counts: { goals: seen.goal.size, projects: seen.project.size, actions: seen.action.size, context }, sections };
}

export function executionSummary(document: ExecutionDocument) {
  const { counts } = document;
  return `${counts.goals} 个目标 · ${counts.projects} 个项目 · ${counts.actions} 个任务${counts.context ? `（含 ${counts.context} 条上级路径）` : ""}`;
}

export function executionExportFilename(now: Date, extension: "md" | "docx") {
  const stamp = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `目标与执行-${stamp}.${extension}`;
}

export function executionExportTime(document: ExecutionDocument) {
  return new Date(document.exportedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

const escapeMarkdown = (value: string) => value.replace(/\\/g, "\\\\").replace(/([`*_{}\[\]<>#!|~])/g, "\\$1");
export function executionMarkdown(document: ExecutionDocument) {
  const lines = [`# ${document.title}`, "", `导出时间：${executionExportTime(document)}（北京时间）`, "", `导出范围：${document.scopeLabel}`, "", executionSummary(document), ""];
  if (document.filters.length) lines.push(escapeMarkdown(document.filters.join("；")), "");
  const write = (sections: ExportSection[], parent: string) => sections.forEach((section, index) => {
    const number = parent ? `${parent}.${index + 1}` : `${index + 1}`;
    const depth = number.split(".").length;
    lines.push(`${"#".repeat(Math.min(depth + 1, 6))} ${number} ${escapeMarkdown(section.title).replace(/\r?\n/g, " ")}`, "");
    if (section.metadata.length) lines.push(escapeMarkdown(section.metadata.join(" · ")), "");
    for (const field of section.fields) lines.push(`**${escapeMarkdown(field.label)}**`, "", ...field.value.split(/\r?\n/).map(line => escapeMarkdown(line)), "");
    write(section.children, number);
  });
  write(document.sections, "");
  if (!document.sections.length) lines.push("暂无符合条件的目标、项目或任务。", "");
  return lines.join("\n");
}
