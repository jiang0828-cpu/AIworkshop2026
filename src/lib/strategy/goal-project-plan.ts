import { z } from "zod";
import { PROFILE_ID } from "../db";
import { shanghaiDate } from "../daily/shared";
import { dailyAIConfig } from "../daily/config";
import { callModel } from "../daily/provider";
import { goalHorizons, hierarchyIssue } from "../goal-hierarchy";
import { digest } from "../execution-plan/context";
import { strategyAnalysis } from "./analysis";
import { atomic, type StrategyDB } from "./service";

const text = z.string().trim().min(1).max(10000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效").nullable();
export const goalProjectInput = z.object({ goalId: z.string().min(1), allowSensitive: z.boolean().default(false), instruction: z.string().max(3000).default(""), weeklyHours: z.number().positive().max(168).nullable().default(null) });
const projectSchema = z.object({ selected: z.boolean().default(true), name: text.max(300), deliverable: text, metric: text, firstStep: text, estimatedHours: z.number().positive().max(10000).nullable(),
  capabilities: z.array(text).max(10), resources: z.array(text).max(10), budget: text, boundary: text, risk: text, stopCondition: text,
  milestones: z.array(z.object({ title: text.max(300), metric: text, deadline: date })).min(1).max(5) });
export const goalProjectDraft = z.object({ summary: text, gaps: z.array(text).max(20), goals: z.array(z.object({ selected: z.boolean().default(true), title: text.max(300), description: text, metric: text,
  horizon: z.enum(goalHorizons as [string, ...string[]]), deadline: date, projects: z.array(projectSchema).min(1).max(3) })).min(1).max(6) });
export type GoalProjectDraft = z.infer<typeof goalProjectDraft>;
const sensitive = /收入|工资|薪资|家庭|孩子|疾病|病史|健康|财务|资产|组织|公司/;
const scrub = (value: string) => value.replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]").replace(/\b\d{17}[\dXx]\b/g, "[证件号已脱敏]");
export async function goalProjectContext(db: StrategyDB, input: unknown) {
  const body = goalProjectInput.parse(input);
  const parent = await db.goal.findFirst({ where: { id: body.goalId, profileId: PROFILE_ID } });
  if (!parent) throw new Error("目标不存在或不属于当前档案");
  if (parent.horizon === "本周") throw new Error("本周目标请直接新建关联项目");
  const [children, projects, values, constraints] = await Promise.all([
    db.goal.findMany({ where: { profileId: PROFILE_ID, parentId: parent.id }, orderBy: { id: "asc" } }),
    db.project.findMany({ where: { profileId: PROFILE_ID, goal: { OR: [{ id: parent.id }, { parentId: parent.id }] } }, orderBy: { id: "asc" } }),
    db.valueRule.findMany({ where: { profileId: PROFILE_ID }, orderBy: { priority: "asc" } }),
    db.constraint.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
  ]);
  const selections = [{ type: "goal", id: parent.id }, ...(parent.visionId ? [{ type: "vision", id: parent.visionId }] : []),
    ...children.map(row => ({ type: "goal", id: row.id })), ...projects.map(row => ({ type: "project", id: row.id })),
    ...values.map(row => ({ type: "valueRule", id: row.id })), ...constraints.map(row => ({ type: "constraint", id: row.id }))];
  const preview = await strategyAnalysis(db, { mode: "analysis", records: selections.slice(0, 20), previewOnly: true, allowSensitive: body.allowSensitive });
  if (!("records" in preview) || !preview.records) throw new Error("资料预览失败");
  const instructionBlocked = !body.allowSensitive && sensitive.test(body.instruction);
  return { records: preview.records, parentId: parent.id, parentHorizon: parent.horizon, today: shanghaiDate(), weeklyHours: body.weeklyHours,
    instruction: instructionBlocked ? "[补充要求含敏感信息，未授权发送]" : scrub(body.instruction),
    blocked: instructionBlocked || preview.records[0].content.startsWith("[包含敏感"), omitted: Math.max(0, selections.length - 20),
    fingerprint: await digest({ body, parent, children, projects, values, constraints, records: preview.records }) };
}
export function validateGoalProjects(draft: GoalProjectDraft, parent: { id: string; horizon: string; sceneId: string | null; deadline: Date | null }, weeklyHours: number | null, today: string) {
  const active = draft.goals.filter(row => row.selected);
  if (!active.length) throw new Error("至少选择一个子目标");
  const titles = new Set<string>();
  let hours = 0;
  const latest = new Date(`${today}T00:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 90);
  for (const goal of active) {
    const issue = hierarchyIssue({ id: "draft", horizon: goal.horizon, sceneId: parent.sceneId }, parent, `${PROFILE_ID}-scene-4`);
    if (issue) throw new Error(issue);
    if (titles.has(goal.title)) throw new Error("子目标标题重复，请合并或排除"); titles.add(goal.title);
    if (goal.deadline && (goal.deadline < today || parent.deadline && goal.deadline > shanghaiDate(parent.deadline))) throw new Error("子目标截止日期须在当前日期与上级目标截止日期之间");
    const projects = goal.projects.filter(row => row.selected);
    if (!projects.length) throw new Error(`子目标“${goal.title}”至少保留一个项目`);
    const names = new Set<string>();
    for (const project of projects) {
      if (names.has(project.name)) throw new Error("同一子目标的项目名称重复"); names.add(project.name);
      hours += project.estimatedHours || 0;
      for (const milestone of project.milestones) if (milestone.deadline && (milestone.deadline < today || milestone.deadline > latest.toISOString().slice(0, 10) || goal.deadline && milestone.deadline > goal.deadline || parent.deadline && milestone.deadline > shanghaiDate(parent.deadline))) throw new Error("项目里程碑须在未来90天内，且不晚于目标截止日期");
      const dates = project.milestones.map(row => row.deadline).filter((value): value is string => value !== null);
      if (dates.some((value, index) => index > 0 && value < dates[index - 1])) throw new Error("项目里程碑日期须按先后顺序排列");
    }
  }
  if (weeklyHours !== null && hours > weeklyHours * 90 / 7) throw new Error("项目预计投入超过未来90天的可用时间，请减少项目或调整投入");
}
const prompt = `你是执行规划助手，仅依据已提供目标、愿景、价值规则、约束和已有规划，不联网、不声称已执行。把当前目标拆成2–5个同场景且时间跨度更短的可衡量子目标，可跨过时间层级。长期目标说明阶段成果，不虚构精确年度任务。
每个子目标拟定1–2个未来90天可启动并验收的有限范围项目：交付物、第一步具体动作、完成标准、能力与资源需求、投入、边界、风险、停止条件、1–5个有验收标准的里程碑。先核实必要条件再推进生产，不假定已拥有客户、预算、资质、授权或资源。未知条件列入gaps并在firstStep中安排核实；未知投入estimatedHours=null，未知日期deadline=null，不能编造可用条件。所有日期须不早于today，项目里程碑不超过未来90天或所属目标截止日期。已知每周可用时间时，所有项目总投入不超过weeklyHours*90/7。避免重复已有子目标或项目，明确差异，不覆盖现有记录。所有内容都是待确认建议。
只输出JSON：{"summary":"规划理由","gaps":["缺失条件与核实要求"],"goals":[{"title":"子目标","description":"与上级目标的关联及阶段结果","metric":"具体可检验的结果","horizon":"10年/5年/3年/1年/90天/本月/本周之一且短于上级","deadline":"YYYY-MM-DD或null","projects":[{"name":"项目","deliverable":"具体交付物","metric":"验收标准","firstStep":"可以立即着手的第一步","estimatedHours":10,"capabilities":["所需能力及已知差距"],"resources":["资源条件及待核实项"],"budget":"预计投入或未知","boundary":"明确边界","risk":"主要风险","stopCondition":"停止条件","milestones":[{"title":"阶段交付","metric":"验收标准","deadline":null}]}]}]}。`;
export async function generateGoalProjects(db: StrategyDB, input: unknown) {
  const body = z.object({ input: goalProjectInput, fingerprint: z.string().min(1) }).parse(input);
  const context = await goalProjectContext(db, body.input);
  if (context.fingerprint !== body.fingerprint) throw new Error("资料或补充要求已变化，请重新预览");
  if (context.blocked) throw new Error("目标或补充要求含敏感资料，请先授权或调整内容");
  const config = dailyAIConfig();
  const result = await callModel(config, JSON.stringify(context), prompt, "deepseek-reasoner", 120, true);
  const draft = goalProjectDraft.parse(JSON.parse(result.output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  const parent = await db.goal.findFirstOrThrow({ where: { id: context.parentId, profileId: PROFILE_ID } });
  let warning = "";
  try { validateGoalProjects(draft, parent, context.weeklyHours, context.today); }
  catch (error) { warning = error instanceof Error ? error.message : "规划条件待调整"; }
  if ((await goalProjectContext(db, body.input)).fingerprint !== context.fingerprint) throw new Error("生成期间资料已变化，请重新预览并生成");
  return { ...draft, warning, input: body.input, fingerprint: context.fingerprint, requestId: crypto.randomUUID(), parentId: context.parentId, source: "DeepSeek 推理规划" };
}
export async function saveGoalProjects(db: StrategyDB, input: unknown) {
  const body = z.object({ requestId: z.string().min(1).max(150), input: goalProjectInput, fingerprint: z.string().min(1), draft: goalProjectDraft }).parse(input);
  const key = `${PROFILE_ID}:goal-project:${body.requestId}`, payload = JSON.stringify(body);
  const counts = { goals: body.draft.goals.filter(row => row.selected).length, projects: body.draft.goals.filter(row => row.selected).reduce((sum, row) => sum + row.projects.filter(project => project.selected).length, 0) };
  const replay = async () => {
    const previous = await db.goalBatch.findUnique({ where: { id: key } });
    if (!previous) return null;
    if (previous.profileId !== PROFILE_ID || previous.payload !== payload) throw new Error("此草稿已确认，重复请求内容不一致");
    return { ...counts, duplicate: true };
  };
  const prior = await replay(); if (prior) return prior;
  const context = await goalProjectContext(db, body.input);
  if (context.fingerprint !== body.fingerprint) {
    const prior = await replay(); if (prior) return prior;
    throw new Error("源目标或已有规划已变化，请重新生成，避免重复保存");
  }
  const parent = await db.goal.findFirstOrThrow({ where: { id: body.input.goalId, profileId: PROFILE_ID } });
  validateGoalProjects(body.draft, parent, body.input.weeklyHours, context.today);
  const [existingGoals, existingProjects] = await Promise.all([
    db.goal.findMany({ where: { profileId: PROFILE_ID, parentId: parent.id } }),
    db.project.findMany({ where: { profileId: PROFILE_ID, goal: { OR: [{ id: parent.id }, { parentId: parent.id }] } } }),
  ]);
  const savedDuringRead = await replay(); if (savedDuringRead) return savedDuringRead;
  const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
  for (const goal of body.draft.goals.filter(row => row.selected)) {
    if (existingGoals.some(row => normalized(row.title) === normalized(goal.title))) throw new Error(`已有同名子目标“${goal.title}”，请调整草稿或取消该项`);
    for (const project of goal.projects.filter(row => row.selected)) if (existingProjects.some(row => normalized(row.name) === normalized(project.name))) throw new Error(`已有同名项目“${project.name}”，请调整草稿或取消该项`);
  }
  const now = Date.now(), at = (value: string | null) => value ? new Date(`${value}T23:59:00+08:00`).getTime() : null;
  const statements: Parameters<typeof atomic>[1] = [{ sql: 'INSERT INTO "GoalBatch" ("id","profileId","payload","createdAt") VALUES (?,?,?,?)', values: [key, PROFILE_ID, payload, now] }];
  for (const goal of body.draft.goals.filter(row => row.selected)) {
    const id = crypto.randomUUID();
    statements.push({ sql: 'INSERT INTO "Goal" ("id","profileId","parentId","title","description","horizon","metric","status","deadline","sceneId","visionId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', values: [id, PROFILE_ID, parent.id, goal.title, goal.description, goal.horizon, goal.metric, "待开始", at(goal.deadline), parent.sceneId, parent.visionId, now, now] });
    for (const project of goal.projects.filter(row => row.selected)) {
      const projectId = crypto.randomUUID();
      const description = `交付物：${project.deliverable}\n第一步：${project.firstStep}\n预计投入：${project.estimatedHours === null ? "待核实" : `${project.estimatedHours} 小时`}\n能力需求：${project.capabilities.join("；") || "待核实"}\n资源需求：${project.resources.join("；") || "待核实"}\n待核实条件：${body.draft.gaps.join("；") || "无额外条件"}`;
      const deadline = project.milestones.map(row => row.deadline).filter((value): value is string => Boolean(value)).sort().at(-1) || goal.deadline;
      statements.push({ sql: 'INSERT INTO "Project" ("id","profileId","goalId","name","description","status","metric","budget","boundary","risk","stopCondition","sceneId","visionId","createdAt","updatedAt","deadline") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', values: [projectId, PROFILE_ID, id, project.name, description, "待开始", project.metric, project.budget, project.boundary, project.risk, project.stopCondition, parent.sceneId, parent.visionId, now, now, at(deadline)] });
      for (const milestone of project.milestones) statements.push({ sql: 'INSERT INTO "Milestone" ("id","projectId","title","metric","deadline","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', values: [crypto.randomUUID(), projectId, milestone.title, milestone.metric, at(milestone.deadline), "未开始", now, now] });
    }
  }
  try { await atomic(db, statements); } catch (error) {
    const prior = await replay(); if (prior) return prior;
    throw error;
  }
  return { ...counts, duplicate: false };
}
