import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { writeTransaction } from "../database-writes";
import { withDailyLock, initializeDaily, saveTasks } from "../daily/service";
import { shanghaiDate } from "../daily/shared";
import { callModel } from "../daily/provider";
import { dailyAIConfig } from "../daily/config";
import type { StrategyDB } from "../strategy/service";
import { validateNestedLinks } from "../strategy/entity";
import { planningContext } from "./context";
import { confirmationProblems, ruleIssues, validateEvidence, validateGraph } from "./validation";
import { capacitySchema, draftSchema, effectiveSelection, inputSchema, isDeferred, jsonOutput, nodes, payloadSchema, resolutionSchema, reviewSchema, type Context, type Draft, type PlanPayload } from "./shared";

export async function ownPlan(db: StrategyDB, id: string) {
  const row = await db.executionPlan.findFirst({ where: { id, profileId: PROFILE_ID } });
  if (!row) throw new Error("规划不存在或不属于当前档案");
  if (["generating", "reviewing"].includes(row.status) && row.leaseUntil && row.leaseUntil.getTime() < Date.now()) {
    const payload = payloadSchema.parse(JSON.parse(row.payload));
    payload.error = "调用中断，请核对后手动重试；不会自动重复调用";
    await db.executionPlan.updateMany({ where: { id, leaseToken: row.leaseToken }, data: { status: "interrupted", leaseToken: null, leaseUntil: null, payload: JSON.stringify(payload) } });
    return db.executionPlan.findFirstOrThrow({ where: { id, profileId: PROFILE_ID } });
  }
  return row;
}
export function planView(row: Awaited<ReturnType<typeof ownPlan>>) {
  const payload = payloadSchema.parse(JSON.parse(row.payload));
  const context: Context = JSON.parse(row.snapshot);
  const issues = payload.draft ? [...ruleIssues(payload.draft, payload.input), ...(payload.review?.issues || [])] : [];
  return { id: row.id, revision: row.revision, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, context, ...payload, issues,
    confirmable: row.status === "ready" && payload.reviewRevision === row.revision && effectiveSelection(payload.draft!).size > 0 && confirmationProblems(payload).length === 0 };
}
export async function createPlan(db: StrategyDB, input: unknown) {
  const body = z.object({ id: z.string().min(1).max(150), input: inputSchema, fingerprint: z.string().min(1) }).parse(input);
  const existing = await db.executionPlan.findFirst({ where: { id: body.id, profileId: PROFILE_ID } });
  if (existing) return planView(existing);
  const context = await planningContext(db, body.input);
  if (context.fingerprint !== body.fingerprint) throw new Error("资料已变化，请重新预览实际发送内容");
  const payload = payloadSchema.parse({ input: body.input });
  return planView(await db.executionPlan.create({ data: { id: body.id, profileId: PROFILE_ID, snapshot: JSON.stringify(context), fingerprint: context.fingerprint, payload: JSON.stringify(payload) } }));
}
export async function editPlan(db: StrategyDB, input: unknown) {
  const body = z.object({ id: z.string(), revision: z.number().int(), draft: draftSchema.nullable(), capacity: capacitySchema, resolutions: z.array(resolutionSchema).default([]) }).parse(input);
  const row = await ownPlan(db, body.id);
  if (row.revision !== body.revision || ["confirmed", "generating", "reviewing"].includes(row.status)) throw new Error("规划版本已变化或不可编辑，请刷新");
  const payload = payloadSchema.parse(JSON.parse(row.payload));
  const context: Context = JSON.parse(row.snapshot);
  if (body.draft) validateGraph(body.draft, context);
  if (payload.draft && !body.draft) throw new Error("已有草稿不能清空，请新建规划批次");
  const changed = JSON.stringify(payload.draft) !== JSON.stringify(body.draft) || JSON.stringify(payload.input.capacity) !== JSON.stringify(body.capacity);
  payload.draft = body.draft; payload.input.capacity = body.capacity; payload.resolutions = body.resolutions; payload.error = "";
  if (changed) { payload.review = null; payload.reviewRevision = null; payload.resolutions = []; }
  const nextContext = await planningContext(db, payload.input);
  // Capacity edits are explicit. Background changes still require a separate preview refresh.
  const originalContext = await planningContext(db, { ...payload.input, capacity: JSON.parse(row.payload).input.capacity });
  if (originalContext.fingerprint !== row.fingerprint) throw new Error("背景资料已变化，请刷新资料后重新校验；当前输入仍在页面保留");
  const updated = await db.executionPlan.updateMany({ where: { id: row.id, profileId: PROFILE_ID, revision: row.revision, status: row.status }, data: { revision: changed ? row.revision + 1 : row.revision, payload: JSON.stringify(payload), snapshot: JSON.stringify(nextContext), fingerprint: nextContext.fingerprint, status: changed ? "draft" : row.status } });
  if (!updated.count) throw new Error("规划已在其他窗口修改，请刷新");
  return planView(await ownPlan(db, row.id));
}
export async function refreshPlan(db: StrategyDB, id: string, revision: number) {
  const row = await ownPlan(db, id);
  if (row.revision !== revision || ["confirmed", "generating", "reviewing"].includes(row.status)) throw new Error("当前规划不可刷新资料");
  const payload = payloadSchema.parse(JSON.parse(row.payload));
  const context = await planningContext(db, payload.input);
  const previous = JSON.parse(row.snapshot) as Context;
  const changed = context.sources.filter(source => !previous.sources.some(old => old.id === source.id && old.content === source.content && old.blocked === source.blocked)).map(source => source.title);
  const removed = previous.sources.filter(source => !context.sources.some(current => current.id === source.id)).map(source => source.title);
  payload.review = null; payload.reviewRevision = null; payload.resolutions = [];
  payload.error = `已刷新背景；变化：${[...changed, ...removed].join("、") || "记录版本或容量变化"}。核对草稿后重新校验。`;
  await db.executionPlan.update({ where: { id }, data: { status: "draft", revision: { increment: 1 }, snapshot: JSON.stringify(context), fingerprint: context.fingerprint, payload: JSON.stringify(payload) } });
  return planView(await ownPlan(db, id));
}

const generationPrompt = `你是独立的个人执行规划师，仅根据输入资料，不联网，不作出法律、医疗或投资结论。
输出完整可执行的长期目标→90天项目→近4周任务。输入全部场景逐一覆盖；没有足够依据时coverage标deferred并说明，不强建项目。事实、个人自述、推断、未知分开；既有已完成/进行中任务必须复用且不重置状态。不删除历史。现有匹配只建议matchId与matchReason，mode保持new，由用户选择。每个条目sources必须来自提供的source.id；visionId使用愿景recordId；sceneId使用输入提供的场景ID。所有key独立唯一，依赖仅引用草稿任务key。
按capacity.startDate起28天排任务，90天项目给里程碑，长期只给路线。每周全部任务estimatedHours之和不超weeklyHours，仅用weekdays安排（0周日6周六）。预算是90天投入上限。不知道容量/日期时任务暂缓并写原因；不知道实际资源、预算、授权时项目或任务暂缓并附核实行动。未知不当已具备。不默认完成、不启动AI。AI执行人仅适用于文本、分析、代码建议；运动/沟通/付款等需人工。条件未知用conditions列明，后续核实再执行；不必要花费填0。
给出需要的能力、资源获取渠道，缺口引用已有库，否则写待获取；每个任务有具体产出验收、耗时、日期和前置步骤。为完整覆盖和可操作性，通常6至12目标、6至10项目、12至24任务，避免堆砌。
只输出JSON，格式如下（按资料扩充，不照抄内容）：
{"summary":"规划说明、取舍及未核实项","coverage":[{"sceneId":"场景ID","status":"planned或deferred","reason":"理由"}],"goals":[{"key":"g1","title":"目标","sceneId":"场景ID","visionId":"愿景recordId","reason":"依据","sources":["source.id"],"priority":1,"description":"预期结果与长期路线","metric":"衡量标准","horizon":"10年/5年/3年/1年/90天/本周","deadline":null,"parentKey":null,"matchId":null,"matchReason":"","deferred":false,"deferReason":""}],"projects":[{"key":"p1","goalKey":"g1","title":"项目","sceneId":"场景ID","reason":"依据","sources":["source.id"],"priority":1,"description":"90天交付物与范围","metric":"验收","budget":"时间资金人力","budgetAmount":0,"boundary":"边界","risk":"风险","stopCondition":"停止条件","capabilities":["能力与渠道"],"resources":["资源与渠道"],"milestones":[{"title":"阶段产出","metric":"标准","deadline":null}],"matchId":null,"matchReason":"","deferred":false,"deferReason":""}],"tasks":[{"key":"t1","projectKey":"p1","title":"具体动作","sceneId":"场景ID","reason":"依据","sources":["source.id"],"priority":1,"standard":"可验收产出","executor":"人工/AI/混合","estimatedHours":0.5,"dueDate":null,"dependencies":[],"conditions":[],"matchId":null,"matchReason":"","deferred":true,"deferReason":"日期或条件待核实"}]}。
日期仅YYYY-MM-DD或null，coverage必须六条。不要编造资料ID、实际数字、证书、同意或已达成结果。`;
const reviewPrompt = `你是个人规划复核者。按输入价值规则、愿景底线、约束、真实容量检查draft，区分事实违规、推断冲突和未知。仅输出JSON {"summary":"复核结论","issues":[{"id":"ai-1","nodeKey":"草稿key或null","kind":"violation/inference/unknown","message":"具体问题","advice":"可执行修正或核实动作","evidence":{"sourceId":"已发送source.id","quote":"该source.content中逐字原文"}}]}。无引用用evidence:null。violation仅用于原文明确底线被直接违反，必须有原文引用，不把推测作禁止；inference可人工解释确认；unknown应先核实或暂缓。引用不得来自blocked资料，不虚构。日期预算依赖等规则会在服务端再检查。不能代替用户确认或执行。`;

export async function runStage(db: StrategyDB, id: string, revision: number, stage: "generate" | "review") {
  const row = await ownPlan(db, id), payload = payloadSchema.parse(JSON.parse(row.payload));
  if (row.revision !== revision || ["confirmed", "generating", "reviewing"].includes(row.status)) throw new Error("规划正在调用或版本已变化");
  if (stage === "generate" && payload.draft) throw new Error("已有草稿，请编辑校验或新建规划批次，不重复生成");
  if (stage === "review" && !payload.draft) throw new Error("请先生成完整规划");
  const context = await planningContext(db, payload.input);
  if (context.fingerprint !== row.fingerprint) throw new Error("资料已变化，请刷新预览后再调用");
  if (payload.draft) validateGraph(payload.draft, context);
  const token = crypto.randomUUID(), status = stage === "generate" ? "generating" : "reviewing";
  const claimed = await withDailyLock(db, () => db.executionPlan.updateMany({ where: { id, profileId: PROFILE_ID, revision, status: row.status }, data: { status, leaseToken: token, leaseUntil: new Date(Date.now() + 180000) } }));
  if (!claimed.count) throw new Error("同一阶段已在另一窗口启动");
  try {
    const config = dailyAIConfig();
    const sent = { scenes: context.scenes, sources: context.sources.filter(row => !row.blocked), missing: context.missing, input: context.sentInput!, ...(stage === "review" ? { draft: payload.draft } : {}) };
    const result = await callModel(config, JSON.stringify(sent), stage === "generate" ? generationPrompt : reviewPrompt, "deepseek-reasoner", 120, true);
    payload.logs.push({ stage, model: "deepseek-reasoner", durationMs: result.durationMs, promptTokens: result.promptTokens, completionTokens: result.completionTokens, at: new Date().toISOString() });
    if (stage === "generate") {
      payload.draft = draftSchema.parse(jsonOutput(result.output));
      for (const node of nodes(payload.draft)) { node.mode = "new"; node.updateFields = []; }
      validateGraph(payload.draft, context);
      payload.review = null; payload.reviewRevision = null;
    } else {
      payload.review = reviewSchema.parse(jsonOutput(result.output));
      payload.review.issues = payload.review.issues.map(issue => ({ ...issue, origin: "ai" as const }));
      validateEvidence(payload.review.issues, context, payload.draft!);
      payload.reviewRevision = revision;
      payload.resolutions = [];
    }
    payload.error = "";
    const saved = await db.executionPlan.updateMany({ where: { id, profileId: PROFILE_ID, revision, leaseToken: token, status }, data: { payload: JSON.stringify(payload), revision: stage === "generate" ? revision + 1 : revision, status: stage === "generate" ? "draft" : "ready", leaseToken: null, leaseUntil: null } });
    if (!saved.count) throw new Error("调用结果已过期，未覆盖新版本");
  } catch (error) {
    payload.error = error instanceof z.ZodError ? "AI输出未通过字段校验，原草稿保留，请核对后重试" : error instanceof Error ? error.message : "调用失败";
    // Preserve the last valid draft when provider parsing fails.
    if (stage === "generate") payload.draft = payloadSchema.parse(JSON.parse(row.payload)).draft;
    else { payload.review = null; payload.reviewRevision = null; }
    await db.executionPlan.updateMany({ where: { id, leaseToken: token, revision }, data: { status: "failed", payload: JSON.stringify(payload), leaseToken: null, leaseUntil: null } });
  }
  return planView(await ownPlan(db, id));
}

const updateKeys = {
  goal: ["title", "description", "metric", "horizon", "deadline", "sceneId", "visionId", "parentId"],
  project: ["name", "description", "metric", "budget", "boundary", "risk", "stopCondition", "sceneId", "visionId", "goalId", "deadline"],
  action: ["title", "purpose", "standard", "dueDate", "estimatedHours", "sceneId", "goalId", "projectId"],
} as const;
export async function confirmPlan(db: PrismaClient, id: string, revision: number) {
  return withDailyLock(db, async () => {
    const row = await ownPlan(db, id), payload = payloadSchema.parse(JSON.parse(row.payload));
    if (row.status === "confirmed") return planView(row);
    if (row.revision !== revision || row.status !== "ready" || payload.reviewRevision !== revision) throw new Error("草稿修改后须重新完成AI校验");
    const context = await planningContext(db, payload.input);
    if (context.fingerprint !== row.fingerprint) throw new Error("资料或匹配记录已变化，请刷新差异并重新校验");
    const draft = payload.draft!;
    validateGraph(draft, context);
    if (confirmationProblems(payload).length) throw new Error("仍有未处理问题，明确底线违规须修改或排除");
    const selected = effectiveSelection(draft);
    if (!selected.size) throw new Error("请至少选择一项目标");
    const mapping: PlanPayload["mapping"] = [];
    const date = (value: string | null) => value ? new Date(`${value}T18:00:00+08:00`) : null;
    const ids = new Map<string, string>();
    for (const node of nodes(draft).filter(node => selected.has(node.key))) ids.set(node.key, node.mode === "new" ? crypto.randomUUID() : node.matchId!);
    await writeTransaction(db, async tx => {
      const write = async (type: "goal" | "project" | "action", node: Draft["goals"][number] | Draft["projects"][number] | Draft["tasks"][number], data: Record<string, unknown>) => {
        const id = ids.get(node.key)!;
        const delegate = tx[type] as unknown as { findFirst(args: { where: { id: string; profileId: string } }): Promise<unknown>; create(args: { data: Record<string, unknown> }): Promise<unknown>; update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> };
        const existing = node.mode === "new" ? null : await delegate.findFirst({ where: { id, profileId: PROFILE_ID } } as never);
        if (node.mode !== "new" && !existing) throw new Error("复用记录不存在");
        if (node.mode === "reuse") {
          for (const field of type === "project" ? ["goalId"] : type === "action" ? ["projectId"] : []) if ((existing as unknown as Record<string, unknown>)[field] !== data[field]) throw new Error("复用项上下游不同，请明确勾选更新关联，或选择原有上游");
        }
        if (node.mode === "new") await delegate.create({ data: { id, profileId: PROFILE_ID, ...data, status: type === "action" ? "待开始" : "待确认" } } as never);
        if (node.mode === "update") {
          if (node.updateFields.some(field => !(updateKeys[type] as readonly string[]).includes(field))) throw new Error("不能更新状态、成果或其他未授权字段");
          const changes = Object.fromEntries(node.updateFields.map(field => [field, data[field]]));
          if (Object.values(changes).some(value => value === undefined)) throw new Error("更新字段无效");
          if (type === "project" || type === "action") await validateNestedLinks(db, type, { ...existing as Record<string, unknown>, ...changes });
          await delegate.update({ where: { id }, data: changes } as never);
          for (const field of type === "project" ? ["goalId"] : type === "action" ? ["projectId"] : []) if (!(field in changes) && (existing as unknown as Record<string, unknown>)[field] !== data[field]) throw new Error("须明确更新关联字段，保持三级归属一致");
        }
        for (const sourceId of node.sources) {
          const source = context.sources.find(source => source.id === sourceId)!;
          await tx.recordSource.create({ data: { id: crypto.randomUUID(), profileId: PROFILE_ID, targetType: type, targetId: id, sourceType: source.type, sourceId: source.recordId, sourceTitle: source.title } });
        }
        mapping.push({ key: node.key, type, id, mode: node.mode, deferred: isDeferred(draft, node.key), dependencies: "dependencies" in node ? node.dependencies : [], cleared: false, clearance: "", ...("executor" in node ? { executor: node.executor } : {}) });
      };
      const remaining = draft.goals.filter(node => selected.has(node.key));
      const written = new Set<string>();
      while (remaining.length) {
        const index = remaining.findIndex(node => !node.parentKey || written.has(node.parentKey));
        if (index < 0) throw new Error("父目标不完整");
        const node = remaining.splice(index, 1)[0];
        const sceneVision = context.sources.find(source => source.type === "vision" && source.recordId === node.visionId);
        await write("goal", node, { title: node.title, description: `${node.description}\n规划依据：${node.reason}\n优先级：${node.priority}`, metric: node.metric, horizon: node.horizon, deadline: date(node.deadline), sceneId: node.sceneId, visionId: sceneVision ? node.visionId : null, parentId: node.parentKey ? ids.get(node.parentKey) : null });
        written.add(node.key);
      }
      for (const node of draft.projects.filter(node => selected.has(node.key))) {
        const goal = draft.goals.find(row => row.key === node.goalKey)!;
        const goalVision = context.sources.find(source => source.type === "vision" && source.recordId === goal.visionId);
        const deadline = node.milestones.map(row => row.deadline).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
        await write("project", node, { name: node.title, goalId: ids.get(node.goalKey), sceneId: node.sceneId, visionId: goalVision && goal.sceneId === node.sceneId ? goal.visionId : null, description: `${node.description}\n能力：${node.capabilities.join("；")}\n资源：${node.resources.join("；")}\n规划依据：${node.reason}`, metric: node.metric, budget: node.budget, boundary: node.boundary, risk: node.risk, stopCondition: node.stopCondition, deadline: date(deadline) });
        if (node.mode === "new") for (const milestone of node.milestones) await tx.milestone.create({ data: { projectId: ids.get(node.key)!, title: milestone.title, metric: milestone.metric, deadline: date(milestone.deadline), status: "未开始" } });
      }
      for (const node of draft.tasks.filter(node => selected.has(node.key))) {
        const project = draft.projects.find(row => row.key === node.projectKey)!;
        await write("action", node, { title: node.title, projectId: ids.get(node.projectKey), goalId: ids.get(project.goalKey), sceneId: node.sceneId, standard: node.standard, dueDate: date(node.dueDate), estimatedHours: node.estimatedHours, purpose: `规划依据：${node.reason}\n执行人：${node.executor}\n前置：${node.dependencies.join("、") || "无"}\n待核实：${node.conditions.join("；") || "无"}${isDeferred(draft, node.key) ? `\n暂缓：${node.deferReason || "上游暂缓"}` : ""}` });
      }
      payload.mapping = mapping; payload.confirmedRevision = revision;
      await tx.executionPlan.update({ where: { id: row.id }, data: { payload: JSON.stringify(payload), status: "confirmed" } });
    });
    return planView(await ownPlan(db, row.id));
  });
}

export async function releaseTask(db: StrategyDB, id: string, key: string, reason: string) {
  const row = await ownPlan(db, id), payload = payloadSchema.parse(JSON.parse(row.payload));
  if (row.status !== "confirmed" || !reason.trim()) throw new Error("须填写实际核实结果");
  const item = payload.mapping.find(item => item.key === key && item.type === "action");
  if (!item?.deferred) throw new Error("此任务无需解除暂缓");
  const candidate = payload.draft!.tasks.find(task => task.key === key)!;
  if (!candidate.dueDate || payload.input.capacity.weeklyHours === null || !payload.input.capacity.weekdays.length) throw new Error("当前未具备排期容量，请新建规划批次补充真实时间后确认");
  const project = payload.draft!.projects.find(project => project.key === candidate.projectKey)!;
  const start = Date.parse(payload.input.capacity.startDate), when = Date.parse(candidate.dueDate);
  if (when < start || when >= start + 28 * 86400000 || !payload.input.capacity.weekdays.includes(new Date(candidate.dueDate).getUTCDay())) throw new Error("请先调整到本轮四周内的可用日期后重新确认");
  if (project.milestones.some(milestone => milestone.deadline && (Date.parse(milestone.deadline) < start || Date.parse(milestone.deadline) >= start + 90 * 86400000))) throw new Error("项目里程碑超出本轮90天，请先调整规划");
  if (project.budgetAmount === null || (project.budgetAmount > 0 && payload.input.capacity.budget === null)) throw new Error("项目投入金额尚未明确，请补充真实投入条件后重新规划");
  const releasedProjects = new Set(payload.mapping.filter(mapped => mapped.type === "action" && mapped.cleared).map(mapped => payload.draft!.tasks.find(task => task.key === mapped.key)!.projectKey));
  releasedProjects.add(project.key);
  const plannedBudget = payload.draft!.projects.filter(project => !isDeferred(payload.draft!, project.key) || releasedProjects.has(project.key)).reduce((sum, project) => sum + (project.budgetAmount || 0), 0);
  if (payload.input.capacity.budget !== null && plannedBudget > payload.input.capacity.budget) throw new Error("核实后项目投入仍超出总上限，请调整规划后重新确认");
  const { assertWeeklyCapacity } = await import("./guard");
  await assertWeeklyCapacity(db, payload, candidate.dueDate, [{ id: item.id, hours: candidate.estimatedHours }]);
  item.cleared = true; item.clearance = reason.trim();
  await db.executionPlan.update({ where: { id }, data: { payload: JSON.stringify(payload) } });
  return planView(await ownPlan(db, id));
}
export async function selectTasks(db: StrategyDB, id: string, keys: string[], date: string) {
  const row = await ownPlan(db, id), payload = payloadSchema.parse(JSON.parse(row.payload));
  if (row.status !== "confirmed" || !keys.length || new Set(keys).size !== keys.length) throw new Error("请从已确认规划选择任务");
  if (date < shanghaiDate()) throw new Error("不能加入已过去的每日计划");
  const actions = keys.map(key => {
    const mapped = payload.mapping.find(item => item.key === key && item.type === "action");
    if (!mapped) throw new Error("所选任务不属于此规划");
    return mapped.id;
  });
  const { assertExecutionReady, assertWeeklyCapacity } = await import("./guard");
  for (const id of actions) await assertExecutionReady(db, id, date);
  const tasks = payload.draft!.tasks.filter(task => keys.includes(task.key));
  await assertWeeklyCapacity(db, payload, date, tasks.map(task => ({ id: payload.mapping.find(item => item.key === task.key)!.id, hours: task.estimatedHours })));
  await initializeDaily(db);
  const agent = await db.dailyAgent.findFirst({ where: { profileId: PROFILE_ID, enabled: true, role: "research" } });
  const drafts = [];
  for (const task of tasks) {
    const actionId = payload.mapping.find(item => item.key === task.key)!.id;
    const action = await db.action.findFirstOrThrow({ where: { id: actionId, profileId: PROFILE_ID } });
    if (action.status === "已完成") throw new Error("已完成的行动不重复加入执行，请排除该项");
    const existing = await db.dailyTask.findFirst({ where: { actionId, plan: { profileId: PROFILE_ID, date } } });
    if (existing) continue;
    if (task.executor !== "人工" && !agent) throw new Error("请先启用资料整理 Agent，再导入 AI 或混合任务");
    const lane = task.executor === "AI" ? "B" as const : task.executor === "混合" ? "mixed" as const : "A" as const;
    const titles = ["准备当前任务所需资料", task.title, "整理交付与完成标准核对"];
    const totalMinutes = Math.max(3, Math.ceil(task.estimatedHours * 60));
    if (totalMinutes > 4320) throw new Error("单项行动超过72小时，请进一步拆解再导入");
    const minutes = Math.floor(totalMinutes / 3);
    drafts.push({ title: action.title, lane, priority: task.priority, actionId, sceneId: null, dueAt: action.dueDate?.toISOString() || null,
      notes: `${action.purpose}\n完成标准：${action.standard}`, checkpoints: [],
      steps: titles.map((title, index) => { const assignee = lane === "B" || (lane === "mixed" && index === 1) ? "ai" as const : "human" as const;
        return { title, assignee, agentId: assignee === "ai" ? agent!.id : null, estimatedMinutes: minutes + (index === 2 ? totalMinutes % 3 : 0), notes: action.standard }; }) });
  }
  // The existing action ID is retained; importing never starts execution.
  return saveTasks(db, date, drafts, "", "AI系统规划（人工确认）");
}
