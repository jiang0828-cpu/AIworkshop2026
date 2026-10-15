import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeScenes } from "../strategy/service";
import { exportSelfStrategy, exportStrategy, strategyBackupSchema } from "../strategy/backup";
import { finishStep, importActions, initializeDaily, syncAction, withDailyLock } from "../daily/service";
import { shanghaiDate } from "../daily/shared";
import { planningContext } from "./context";
import { confirmPlan, createPlan, editPlan, ownPlan, refreshPlan, releaseTask, runStage, selectTasks } from "./service";
import { assertExecutionReady, assertWeeklyCapacity } from "./guard";
import { executionBackupSchema, restoredPlan } from "./backup";
import { confirmationProblems, ruleIssues, validateEvidence, validateGraph } from "./validation";
import { draftSchema, effectiveSelection, inputSchema, isDeferred, payloadSchema, type Context, type Draft, type Issue } from "./shared";

let db: PrismaClient, sqlite: DatabaseSync, directory: string, cloud = false;
const profileId = "local-profile";
vi.mock("@/lib/db", () => ({ getDb: async () => db, PROFILE_ID: "local-profile", isCloudflareD1Runtime: () => cloud }));
vi.mock("../daily/config", () => ({ dailyAIConfig: () => ({ apiKey: "test-only", baseUrl: "https://example.invalid" }) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { WORKBENCH_DB: {
  prepare: (sql: string) => ({ bind: (...values: Array<string | number | null>) => ({ sql, values }) }),
  batch: async (statements: Array<{ sql: string; values: Array<string | number | null> }>) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try { for (const statement of statements) sqlite.prepare(statement.sql).run(...statement.values); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
} } }) }));
const today = shanghaiDate();
const input = () => inputSchema.parse({ capacity: { startDate: today, weeklyHours: 8, weekdays: [0, 1, 2, 3, 4, 5, 6], budget: 0 }, allowSensitive: true });
function draft(context: Context): Draft {
  const sceneId = context.scenes[0].id;
  const common = { sceneId, reason: "来自愿景", sources: ["overallVision:overall"], priority: 1 };
  return draftSchema.parse({ summary: "长期能力路线、90天可验收项目与近四周步骤", coverage: context.scenes.map(scene => ({ sceneId: scene.id, status: scene.id === sceneId ? "planned" : "deferred", reason: "本轮聚焦，其他保留愿景" })),
    goals: [{ ...common, key: "g", title: "建立作品体系", visionId: "overall", description: "建立可验证的作品", metric: "三份完整作品", horizon: "1年", deadline: null }],
    projects: [{ ...common, key: "p", goalKey: "g", title: "首份作品", description: "90天完成完整样例", metric: "交付一份完整样例", budget: "每周8小时、零新增支出", budgetAmount: 0, boundary: "不占用休息", risk: "时间波动", stopCondition: "精力不足暂停", capabilities: ["写作"], resources: ["现有资料"], milestones: [{ title: "初稿", metric: "可审阅初稿", deadline: null }] }],
    tasks: [{ ...common, key: "t", projectKey: "p", title: "整理作品提纲", standard: "一份包含主题与段落的提纲", executor: "AI", estimatedHours: 1, dueDate: today, dependencies: [], conditions: [] }] });
}
const response = (output: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
function model(output: unknown) { vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response(output))); }
async function batch(ready = true) {
  const args = input(), context = await planningContext(db, args), content = draft(context);
  const plan = await createPlan(db, { id: crypto.randomUUID(), input: args, fingerprint: context.fingerprint });
  model(content); const generated = await runStage(db, plan.id, plan.revision, "generate");
  if (!ready) return generated;
  model({ summary: "未发现明确违规", issues: [] }); return runStage(db, plan.id, generated.revision, "review");
}
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "execution-plan-test-"));
  const file = path.join(directory, "test.db");
  const sql = execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
  sqlite = new DatabaseSync(file); sqlite.exec(sql); sqlite.exec("PRAGMA foreign_keys=ON");
  db = new PrismaClient({ datasources: { db: { url: `file:${file.replace(/\\/g, "/")}` } } });
}, 60000);
beforeEach(async () => {
  cloud = false; await db.executionPlan.deleteMany(); await db.radarRecord.deleteMany(); await db.profile.deleteMany();
  await initializeDaily(db); await initializeScenes(db);
  await db.strategyRecord.create({ data: { id: "overall", profileId, kind: "overallVision", title: "总愿景", payload: JSON.stringify({ expected: "形成可验证作品", boundary: "不占用休息" }) } });
  await db.valueRule.create({ data: { id: "value", profileId, value: "健康", rule: "不得牺牲睡眠", priority: 1 } });
});
afterEach(() => { cloud = false; vi.unstubAllGlobals(); });
afterAll(async () => { await db?.$disconnect(); sqlite?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });

describe("规划结构、约束与资料", () => {
  it("六场景覆盖、三级引用及依赖循环校验", async () => {
    const context = await planningContext(db, input()), content = draft(context);
    expect(() => validateGraph(content, context)).not.toThrow();
    content.coverage[5].sceneId = content.coverage[0].sceneId;
    expect(() => validateGraph(content, context)).toThrow("全部场景");
    content.coverage = draft(context).coverage;
    const removed = structuredClone(content); removed.goals[0].sources = ["vision:deleted"]; removed.goals[0].visionId = "deleted";
    expect(() => validateGraph(removed, context)).toThrow(); removed.goals[0].selected = false;
    expect(() => validateGraph(removed, context)).not.toThrow();
    content.tasks.push({ ...content.tasks[0], key: "t2", dependencies: ["t"] }); content.tasks[0].dependencies = ["t2"];
    expect(() => validateGraph(content, context)).toThrow("循环");
  });
  it("上游排除与暂缓向下继承，未知时间不视为可执行", async () => {
    const content = draft(await planningContext(db, input()));
    content.goals[0].selected = false; expect(effectiveSelection(content).size).toBe(0);
    content.goals[0].selected = true; content.projects[0].deferred = true; content.projects[0].deferReason = "核实资源";
    expect(isDeferred(content, "t")).toBe(true);
    content.projects[0].deferred = false;
    expect(ruleIssues(content, { ...input(), capacity: { ...input().capacity, weeklyHours: null } }).some(issue => issue.kind === "unknown")).toBe(true);
  });
  it("容量、日期、依赖和项目投入分别校验", async () => {
    const content = draft(await planningContext(db, input())); content.tasks[0].estimatedHours = 9;
    expect(ruleIssues(content, input()).some(issue => issue.kind === "capacity")).toBe(true);
    content.tasks[0].dueDate = "2020-01-01"; content.projects[0].budgetAmount = null;
    content.projects[0].milestones[0].deadline = "2030-01-01";
    expect(ruleIssues(content, input()).map(issue => issue.kind)).toEqual(expect.arrayContaining(["date", "unknown"]));
  });
  it("明确底线违规不能通过理由或暂缓绕过，推断须有人工理由", async () => {
    const context = await planningContext(db, input()), content = draft(context);
    const issue: Issue = { id: "ai1", nodeKey: "t", kind: "violation", message: "牺牲睡眠", advice: "修改", evidence: { sourceId: "valueRule:value", quote: "不得牺牲睡眠" }, origin: "ai" };
    validateEvidence([issue], context, content);
    const payload = payloadSchema.parse({ input: input(), draft: content, review: { summary: "检查", issues: [issue] }, resolutions: [{ issueId: "ai1", decision: "accept", reason: "愿意" }] });
    payload.draft!.tasks[0].deferred = true; payload.draft!.tasks[0].deferReason = "待确认";
    expect(confirmationProblems(payload)).toHaveLength(1);
    payload.draft!.tasks[0].deferred = false; payload.review!.issues[0].kind = "inference";
    expect(confirmationProblems(payload)).toHaveLength(0);
    payload.resolutions = []; expect(confirmationProblems(payload)).toHaveLength(1);
    expect(() => validateEvidence([{ ...issue, evidence: { sourceId: "valueRule:value", quote: "虚构" } }], context, content)).toThrow("依据");
  });
  it("发送前脱敏，未授权资料不可引用，跨Profile匹配拒绝", async () => {
    await db.profile.update({ where: { id: profileId }, data: { currentChallenges: "联系13812345678或person@example.com", healthEnergy: "敏感健康信息" } });
    const context = await planningContext(db, input());
    const serialized = JSON.stringify(context.sources); expect(serialized).not.toContain("13812345678"); expect(serialized).not.toContain("person@example.com");
    const blocked = await planningContext(db, { ...input(), allowSensitive: false });
    expect(blocked.sources.some(source => source.blocked)).toBe(true);
    const content = draft(context); content.goals[0].mode = "reuse"; content.goals[0].matchId = "foreign-goal";
    expect(() => validateGraph(content, context)).toThrow("匹配记录");
    await expect(ownPlan(db, "foreign-plan")).rejects.toThrow("不属于");
    const noted = await planningContext(db, { ...input(), instruction: "联系13812345678", capacity: { ...input().capacity, budgetNote: "联系person@example.com" } });
    expect(JSON.stringify(noted.sentInput)).not.toContain("13812345678"); expect(JSON.stringify(noted.sentInput)).not.toContain("person@example.com");
    await expect(planningContext(db, { ...input(), allowSensitive: false, capacity: { ...input().capacity, budgetNote: "公司资源" } })).rejects.toThrow("敏感");
  });
});
describe("分阶段持久化与人工确认", () => {
  it("生成与复核保存独立草稿，取消不创建业务记录；重复确认幂等", async () => {
    const plan = await batch(); expect(plan.status).toBe("ready"); expect(plan.logs).toHaveLength(2);
    expect(await db.action.count()).toBe(0); expect(await db.goal.count()).toBe(0);
    const saved = await confirmPlan(db, plan.id, plan.revision); await confirmPlan(db, plan.id, plan.revision);
    expect(saved.mapping).toHaveLength(3); expect(await db.goal.count()).toBe(1); expect(await db.project.count()).toBe(1); expect(await db.action.count()).toBe(1);
    expect((await db.action.findFirstOrThrow()).status).toBe("待开始"); expect(await db.dailyRun.count()).toBe(0);
  });
  it("修改使校验失效，背景变化阻止过期确认，刷新保留草稿", async () => {
    const plan = await batch(), content = structuredClone(plan.draft!); content.tasks[0].standard = "新的验收标准";
    const edited = await editPlan(db, { id: plan.id, revision: plan.revision, draft: content, capacity: plan.input.capacity });
    expect(edited.review).toBeNull(); expect(edited.revision).toBe(plan.revision + 1);
    await expect(confirmPlan(db, plan.id, edited.revision)).rejects.toThrow("重新");
    model({ summary: "通过", issues: [] }); const checked = await runStage(db, plan.id, edited.revision, "review");
    await db.profile.update({ where: { id: profileId }, data: { stage: "发生变化" } });
    await expect(confirmPlan(db, plan.id, checked.revision)).rejects.toThrow("已变化");
    const refreshed = await refreshPlan(db, plan.id, checked.revision); expect(refreshed.draft!.tasks[0].standard).toBe("新的验收标准"); expect(refreshed.review).toBeNull();
  });
  it("复用完成行动，更新只影响明确字段且保留结果状态", async () => {
    const goal = await db.goal.create({ data: { id: "existing-g", profileId, title: "既有目标", horizon: "1年", status: "进行中" } });
    const project = await db.project.create({ data: { id: "existing-p", profileId, name: "既有项目", goalId: goal.id } });
    const action = await db.action.create({ data: { id: "existing-a", profileId, title: "既有行动", goalId: goal.id, projectId: project.id, status: "已完成", completedAt: new Date() } });
    await db.selfActionReview.create({ data: { id: "existing-review", profileId, actionId: action.id, result: "已有成果" } });
    const plan = await batch(), content = structuredClone(plan.draft!);
    content.goals[0] = { ...content.goals[0], mode: "reuse", matchId: goal.id };
    content.projects[0] = { ...content.projects[0], mode: "reuse", matchId: project.id };
    content.tasks[0] = { ...content.tasks[0], mode: "update", matchId: action.id, updateFields: ["standard"] };
    const edited = await editPlan(db, { id: plan.id, revision: plan.revision, draft: content, capacity: input().capacity });
    model({ summary: "通过", issues: [] }); const ready = await runStage(db, plan.id, edited.revision, "review"); await confirmPlan(db, plan.id, ready.revision);
    expect(await db.action.count()).toBe(1); const updated = await db.action.findUniqueOrThrow({ where: { id: action.id } });
    expect(updated.status).toBe("已完成"); expect(updated.completedAt).toEqual(action.completedAt); expect(updated.title).toBe("既有行动");
    expect((await db.selfActionReview.findUniqueOrThrow({ where: { id: "existing-review" } })).result).toBe("已有成果");
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).status).toBe("进行中");
  });
  it.each([false, true])("SQLite/D1 原子失败不留下部分记录（D1=%s）", async d1 => {
    const plan = await batch();
    sqlite.exec("CREATE TRIGGER fail_execution_action BEFORE INSERT ON Action BEGIN SELECT RAISE(ABORT, 'atomic-test'); END;"); cloud = d1;
    try { await expect(confirmPlan(db, plan.id, plan.revision)).rejects.toThrow(); }
    finally { sqlite.exec("DROP TRIGGER fail_execution_action"); cloud = false; }
    expect(await db.goal.count()).toBe(0); expect(await db.project.count()).toBe(0); expect((await ownPlan(db, plan.id)).status).toBe("ready");
  });
  it("AI无效输出及连接失败保留草稿、调用记录，不用模板替代", async () => {
    const plan = await batch(false); model({ invalid: true });
    const failed = await runStage(db, plan.id, plan.revision, "review"); expect(failed.status).toBe("failed"); expect(failed.draft).toEqual(plan.draft); expect(failed.logs).toHaveLength(2);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private connection details")));
    const disconnected = await runStage(db, plan.id, plan.revision, "review"); expect(disconnected.error).not.toContain("private"); expect(disconnected.draft).toEqual(plan.draft);
  });
  it("重复调用、租约中断、晚到回复与覆盖导入保护", async () => {
    const context = await planningContext(db, input()), plan = await createPlan(db, { id: "lease", input: input(), fingerprint: context.fingerprint });
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })));
    const pending = runStage(db, plan.id, plan.revision, "generate");
    await vi.waitFor(async () => expect((await ownPlan(db, plan.id)).status).toBe("generating"));
    await expect(runStage(db, plan.id, plan.revision, "generate")).rejects.toThrow("正在调用");
    await expect(withDailyLock(db, async () => true, true)).rejects.toThrow("运行中");
    await db.executionPlan.update({ where: { id: plan.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    expect((await ownPlan(db, plan.id)).status).toBe("interrupted"); resolve(response(draft(context))); await pending;
    expect((await ownPlan(db, plan.id)).status).toBe("interrupted"); expect(payloadSchema.parse(JSON.parse((await ownPlan(db, plan.id)).payload)).draft).toBeNull();
  });
});
describe("任务选择与备份", () => {
  it("导入同一行动不复制，不自动启动，保留AI执行与验收步骤", async () => {
    const plan = await batch(); await confirmPlan(db, plan.id, plan.revision);
    await selectTasks(db, plan.id, ["t"], today); await selectTasks(db, plan.id, ["t"], today);
    const task = await db.dailyTask.findFirstOrThrow({ include: { steps: true } });
    expect(await db.dailyTask.count()).toBe(1); expect(task.lane).toBe("B"); expect(task.steps.every(step => step.assignee === "ai" && step.status === "pending")).toBe(true); expect(await db.dailyRun.count()).toBe(0);
  });
  it("前置未完成不能启动或导入，未知条件仅保存为暂缓", async () => {
    const plan = await batch(), content = structuredClone(plan.draft!); content.tasks.push({ ...content.tasks[0], key: "t2", title: "后续动作", dependencies: ["t"] });
    const edited = await editPlan(db, { id: plan.id, revision: plan.revision, draft: content, capacity: input().capacity }); model({ summary: "通过", issues: [] });
    const ready = await runStage(db, plan.id, edited.revision, "review"), saved = await confirmPlan(db, plan.id, ready.revision);
    await expect(selectTasks(db, plan.id, ["t2"], today)).rejects.toThrow("前置");
    const mapped = saved.mapping.find(item => item.key === "t")!;
    await db.action.update({ where: { id: mapped.id }, data: { status: "已完成" } });
    await expect(assertExecutionReady(db, saved.mapping.find(item => item.key === "t2")!.id, today)).resolves.toBeUndefined();
  });
  it("整周累计容量拦截，未知投入不能仅凭理由解除", async () => {
    const plan = await batch(), payload = payloadSchema.parse(plan);
    await db.dailyPlan.create({ data: { profileId, date: today, tasks: { create: { title: "其他工作", lane: "A", steps: { create: { title: "工作", assignee: "human", position: 0, estimatedMinutes: 480 } } } } } });
    await expect(assertWeeklyCapacity(db, payload, today, [{ id: "extra", hours: 1 }])).rejects.toThrow("本周");
    const content = structuredClone(plan.draft!); content.projects[0].deferred = true; content.projects[0].deferReason = "投入未知"; content.projects[0].budgetAmount = null;
    const edited = await editPlan(db, { id: plan.id, revision: plan.revision, draft: content, capacity: input().capacity }); model({ summary: "暂缓待核实", issues: [] });
    const ready = await runStage(db, plan.id, edited.revision, "review"); await confirmPlan(db, plan.id, ready.revision);
    await expect(releaseTask(db, plan.id, "t", "已经核实")).rejects.toThrow("投入金额");
    await expect(selectTasks(db, plan.id, ["t"], today)).rejects.toThrow("暂缓");
  });
  it("不能通过普通导入、完成步骤或确认回写绕过规划暂缓", async () => {
    const plan = await batch(), content = structuredClone(plan.draft!);
    content.tasks[0].deferred = true; content.tasks[0].deferReason = "授权未核实";
    const edited = await editPlan(db, { id: plan.id, revision: plan.revision, draft: content, capacity: input().capacity }); model({ summary: "待核实", issues: [] });
    const ready = await runStage(db, plan.id, edited.revision, "review"), saved = await confirmPlan(db, plan.id, ready.revision);
    const actionId = saved.mapping.find(item => item.type === "action")!.id;
    await importActions(db, today, [actionId]);
    const daily = await db.dailyTask.findFirstOrThrow({ include: { steps: { orderBy: { position: "asc" } } } });
    await db.dailyStep.update({ where: { id: daily.steps[0].id }, data: { status: "running" } });
    await expect(finishStep(db, daily.steps[0].id, "伪造完成", {})).rejects.toThrow("暂缓");
    await db.dailyStep.updateMany({ where: { taskId: daily.id }, data: { status: "done" } });
    await expect(syncAction(db, daily.id)).rejects.toThrow("暂缓");
    expect((await db.action.findUniqueOrThrow({ where: { id: actionId } })).status).toBe("待开始");
  });
  it("新确认规划可重新核实旧暂缓行动，旧批次不永久阻塞执行", async () => {
    const plan = await batch(), content = structuredClone(plan.draft!); content.tasks[0].deferred = true; content.tasks[0].deferReason = "资料待核实";
    const edited = await editPlan(db, { id: plan.id, revision: plan.revision, draft: content, capacity: input().capacity }); model({ summary: "待核实", issues: [] });
    const ready = await runStage(db, plan.id, edited.revision, "review"), saved = await confirmPlan(db, plan.id, ready.revision);
    const next = await batch(), updated = structuredClone(next.draft!);
    for (const node of [updated.goals[0], updated.projects[0], updated.tasks[0]]) { node.mode = "reuse"; node.matchId = saved.mapping.find(item => item.key === node.key)!.id; }
    const refreshed = await editPlan(db, { id: next.id, revision: next.revision, draft: updated, capacity: input().capacity }); model({ summary: "条件已明确", issues: [] });
    const checked = await runStage(db, next.id, refreshed.revision, "review"); await confirmPlan(db, next.id, checked.revision);
    await expect(assertExecutionReady(db, saved.mapping.find(item => item.key === "t")!.id, today)).resolves.toBeUndefined();
  });
  it("完整备份包含批次，档案备份不复制，旧备份兼容，恢复调用暂停", async () => {
    const plan = await batch(); const full = await exportStrategy(db); expect(full.executionPlans).toHaveLength(1);
    const personal = await exportSelfStrategy(db); expect(personal.executionPlans).toEqual([]);
    const legacy = { ...full, executionPlans: undefined }; expect(strategyBackupSchema.parse(legacy).executionPlans).toEqual([]);
    const original = executionBackupSchema.parse({ ...(await ownPlan(db, plan.id)), status: "generating", leaseToken: "stale", leaseUntil: new Date() });
    const restored = restoredPlan(original); expect(restored.status).toBe("interrupted"); expect(restored.leaseToken).toBeNull();
    const oldSnapshot = JSON.parse(original.snapshot);
    oldSnapshot.scenes = oldSnapshot.scenes.filter((scene: { slot: number }) => scene.slot !== 6);
    const oldPayload = JSON.parse(original.payload);
    if (oldPayload.draft) oldPayload.draft.coverage = oldPayload.draft.coverage.filter((row: { sceneId: string }) => oldSnapshot.scenes.some((scene: { id: string }) => scene.id === row.sceneId));
    expect(executionBackupSchema.safeParse({ ...original, snapshot: JSON.stringify(oldSnapshot), payload: JSON.stringify(oldPayload) }).success).toBe(true);
    expect(payloadSchema.parse(JSON.parse(restored.payload)).review).toBeNull();
  });
});
