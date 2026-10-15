import { draftSchema, effectiveSelection, isDeferred, nodes, type Context, type Draft, type Issue, type PlanInput, type PlanPayload, type Source } from "./shared";

export function validateGraph(draft: Draft, context: Context) {
  draft = draftSchema.parse(draft);
  const rows = nodes(draft);
  const keys = new Set(rows.map(row => row.key));
  if (keys.size !== rows.length) throw new Error("规划条目标识重复");
  const sources = new Map(context.sources.filter(row => !row.blocked).map(row => [row.id, row]));
  const scenes = new Set(context.scenes.map(row => row.id));
  const selected = effectiveSelection(draft);
  if (draft.coverage.length !== scenes.size || new Set(draft.coverage.map(row => row.sceneId)).size !== scenes.size || draft.coverage.some(row => !scenes.has(row.sceneId))) throw new Error("必须逐一覆盖规划资料中的全部场景并说明原因");
  for (const row of rows) {
    if (!selected.has(row.key)) continue;
    if (!scenes.has(row.sceneId) || row.sources.some(id => !sources.has(id))) throw new Error("规划引用未知或未授权的资料／场景");
    const type = draft.goals.includes(row as Draft["goals"][number]) ? "goal" : draft.projects.includes(row as Draft["projects"][number]) ? "project" : "action";
    if (row.matchId && !context.sources.some(source => source.type === type && source.recordId === row.matchId && !source.blocked)) throw new Error("匹配记录不存在或未授权");
    if (row.mode !== "new" && !row.matchId) throw new Error("复用或更新须明确选择原记录");
    if (row.deferred && !row.deferReason.trim()) throw new Error("请填写暂缓原因");
  }
  for (const goal of draft.goals) {
    if (selected.has(goal.key) && !sources.has(`vision:${goal.visionId}`) && !sources.has(`overallVision:${goal.visionId}`)) throw new Error("目标必须关联已发送的愿景");
    if (goal.parentKey && !draft.goals.some(row => row.key === goal.parentKey && row.key !== goal.key)) throw new Error("父目标无效");
  }
  for (const project of draft.projects) if (!draft.goals.some(row => row.key === project.goalKey)) throw new Error("项目缺少所属目标");
  for (const task of draft.tasks) {
    if (!draft.projects.some(row => row.key === task.projectKey)) throw new Error("任务缺少所属项目");
    if (task.dependencies.some(key => !draft.tasks.some(row => row.key === key && row.key !== task.key))) throw new Error("前置任务无效");
  }
  const visit = (key: string, get: (key: string) => string[], active: Set<string>, done: Set<string>) => {
    if (active.has(key)) throw new Error("依赖或父目标存在循环");
    if (done.has(key)) return;
    active.add(key);
    for (const dependency of get(key)) visit(dependency, get, active, done);
    active.delete(key); done.add(key);
  };
  const goalsDone = new Set<string>(), tasksDone = new Set<string>();
  for (const row of draft.goals) visit(row.key, key => { const parent = draft.goals.find(row => row.key === key)?.parentKey; return parent ? [parent] : []; }, new Set(), goalsDone);
  for (const row of draft.tasks) visit(row.key, key => draft.tasks.find(row => row.key === key)?.dependencies || [], new Set(), tasksDone);
}
export function ruleIssues(draft: Draft, input: PlanInput): Issue[] {
  const result: Issue[] = [];
  const add = (nodeKey: string | null, kind: Issue["kind"], message: string, advice: string) => result.push({ id: `rule-${result.length}`, nodeKey, kind, message, advice, evidence: null, origin: "rule" });
  const selected = effectiveSelection(draft);
  const active = nodes(draft).filter(row => selected.has(row.key) && !isDeferred(draft, row.key));
  const parents = new Map(nodes(draft).map(row => [row.key, row]));
  for (const row of active) {
    const parentKey = "goalKey" in row ? row.goalKey : "projectKey" in row ? row.projectKey : row.parentKey;
    if (parentKey && parents.get(parentKey)?.sceneId !== row.sceneId) add(row.key, "inference", "与上游主场景不同", "确认跨场景理由，或统一归属");
    if (row.mode === "update" && !row.updateFields.length) add(row.key, "structure", "尚未确认需要更新的字段", "选择字段差异，或改为复用");
  }
  const matches = new Set<string>();
  for (const row of nodes(draft).filter(row => selected.has(row.key) && row.mode !== "new")) {
    if (matches.has(row.matchId!)) add(row.key, "duplicate", "同一原记录被多次选用", "只保留一处映射，其他事项改为独立记录或排除");
    matches.add(row.matchId!);
  }
  const end = new Date(input.capacity.startDate); end.setUTCDate(end.getUTCDate() + 27);
  const limit = end.toISOString().slice(0, 10);
  const hours = [0, 0, 0, 0];
  for (const task of draft.tasks.filter(row => selected.has(row.key) && !isDeferred(draft, row.key))) {
    if (task.estimatedHours > 72) add(task.key, "structure", "单项任务超过每日协同步骤容量", "拆成更小的可验收行动");
    if (input.capacity.weeklyHours === null || !input.capacity.weekdays.length) add(task.key, "unknown", "排期容量或可用日期尚未核实", "暂缓任务并先核实时间容量");
    if (task.conditions.length) add(task.key, "unknown", `待核实条件：${task.conditions.join("；")}`, "先完成核实行动；将当前任务标为暂缓");
    if (!task.dueDate || task.dueDate < input.capacity.startDate || task.dueDate > limit) add(task.key, "date", "任务日期不在本轮四周范围内", "调整日期或暂缓到后续轮次");
    else {
      const day = new Date(task.dueDate).getUTCDay();
      if (input.capacity.weekdays.length && !input.capacity.weekdays.includes(day)) add(task.key, "date", "任务安排在不可用日期", "调整到已确认的可用日期");
      const week = Math.floor((Date.parse(task.dueDate) - Date.parse(input.capacity.startDate)) / 604800000);
      hours[week] += task.estimatedHours;
    }
    for (const key of task.dependencies) {
      const dependency = draft.tasks.find(row => row.key === key)!;
      if (!selected.has(key)) add(task.key, "dependency", "前置任务已被排除", "保留前置任务，或暂缓依赖它的任务");
      else if (isDeferred(draft, key)) add(task.key, "dependency", "前置任务暂缓", "暂缓依赖它的任务");
      else if (task.dueDate && dependency.dueDate && dependency.dueDate > task.dueDate) add(task.key, "dependency", "前置任务日期晚于当前任务", "重新安排先后日期");
    }
  }
  if (input.capacity.weeklyHours !== null) hours.forEach((hours, week) => { if (hours > input.capacity.weeklyHours!) add(null, "capacity", `第${week + 1}周投入${hours}小时，超过${input.capacity.weeklyHours}小时`, "减少、暂缓或调整排期后重新校验"); });
  let budget = 0;
  for (const project of draft.projects.filter(row => selected.has(row.key) && !isDeferred(draft, row.key))) {
    if (project.milestones.some(milestone => milestone.deadline && (milestone.deadline < input.capacity.startDate || Date.parse(milestone.deadline) >= Date.parse(input.capacity.startDate) + 90 * 86400000))) add(project.key, "date", "项目里程碑超出本轮90天范围", "调整近期里程碑，远期保留为目标路线");
    if (project.budgetAmount === null || (project.budgetAmount > 0 && input.capacity.budget === null)) add(project.key, "unknown", "项目金额投入尚未核实", "暂缓并先核实投入；确认无需支出时填写0");
    budget += project.budgetAmount || 0;
  }
  if (input.capacity.budget !== null && budget > input.capacity.budget) add(null, "capacity", `项目投入${budget}超过上限${input.capacity.budget}`, "减少或暂缓项目");
  const titles = new Set<string>();
  for (const row of active) {
    const normalized = row.title.replace(/\s/g, "").toLowerCase();
    if (titles.has(normalized)) add(row.key, "inference", "规划中存在同名事项", "核对职责，注明分工或排除重复");
    titles.add(normalized);
  }
  return result;
}
export function validateEvidence(issues: Issue[], context: Context, draft: Draft) {
  const keys = new Set(nodes(draft).map(row => row.key));
  const ids = new Set<string>();
  for (const issue of issues) {
    if (ids.has(issue.id) || issue.id.startsWith("rule-")) throw new Error("AI校验问题标识重复或无效");
    ids.add(issue.id);
    if (issue.nodeKey && !keys.has(issue.nodeKey)) throw new Error("AI校验引用未知规划条目");
    if (issue.evidence) {
      const source = context.sources.find(row => row.id === issue.evidence!.sourceId && !row.blocked);
      const fragments = [source?.content || ""];
      const collect = (value: unknown) => { if (typeof value === "string") fragments.push(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object") Object.values(value).forEach(collect); };
      try { collect(JSON.parse(source?.content || "")); } catch { /* Text sources need no decoding. */ }
      if (!source || !fragments.some(fragment => fragment.includes(issue.evidence!.quote))) throw new Error("AI校验依据未出现在已发送资料中");
    }
    if (issue.kind === "violation" && (!issue.evidence || !context.sources.some(source => source.id === issue.evidence!.sourceId && ["valueRule", "constraint", "vision", "overallVision"].includes(source.type)))) throw new Error("底线违规必须引用实际价值规则、约束或愿景");
  }
}
export function confirmationProblems(payload: PlanPayload): Issue[] {
  if (!payload.draft || !payload.review) throw new Error("请先完成DeepSeek规划和校验");
  const draft = payload.draft, selected = effectiveSelection(draft);
  return [...ruleIssues(draft, payload.input), ...payload.review.issues].filter(issue => {
    if (issue.nodeKey && !selected.has(issue.nodeKey)) return false;
    if (issue.kind === "violation") return true;
    if (issue.nodeKey && isDeferred(draft, issue.nodeKey)) return false;
    const resolution = payload.resolutions.find(row => row.issueId === issue.id);
    return !(issue.kind === "inference" && resolution?.decision === "accept" && resolution.reason.trim());
  });
}
export const matchingSources = (context: Context, type: string): Source[] => context.sources.filter(row => row.type === type && !row.blocked);
