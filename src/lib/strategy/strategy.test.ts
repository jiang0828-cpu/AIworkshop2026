import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeScenes, own, saveGoalBatch, saveRecord, saveRelation, saveScenes, saveProfileScenes, strategyView } from "./service";
import { profileSceneFields } from "./profile-scenes";
import { alignmentIssues, canonicalRelation, effectiveScene, recommendedTasks } from "./shared";
import { parseEntity, validateEntityLinks } from "./entity";
import { generateGoalProjects, goalProjectContext, goalProjectDraft, saveGoalProjects, validateGoalProjects } from "./goal-project-plan";
import { exportStrategy, orderedGoals, restoreStrategy, strategyBackupSchema } from "./backup";
import { decompositionDraft, strategyAnalysis } from "./analysis";
import { writeTransaction } from "../database-writes";
import { GET as exportBackup, POST as restoreBackup } from "../../app/api/backup/route";
import { GET as exportSelf, POST as restoreSelf } from "../../app/api/profile-backup/route";
import { POST as strategyPost } from "../../app/api/strategy/route";
import { PATCH as dataPatch, POST as dataPost, DELETE as dataDelete } from "../../app/api/data/route";
import { POST as focusPost } from "../../app/api/workbench-focus/route";
import { selectContext } from "../ai-use";
import { contextOptionsSchema } from "../schemas";
import { applySelfUpdate, linkSelfAction, saveSelfReview } from "./self-loop";
import { syncAction } from "../daily/service";
import { initializeDaily } from "../daily/service";
import { createResearch, previewResearch, convertResearch, updateResearch } from "../research/service";
import { claimResearch, executeResearch } from "../research/scheduler";
import { resolveScene } from "../scenes";
import { getDailyView, importActions, saveTasks } from "../daily/service";
import { rulePlan, orchestrate } from "../daily/provider";
import { GET as dataGet } from "../../app/api/data/route";
import { POST as dailyPost } from "../../app/api/daily-collaboration/route";
import { saveVisionPlan, validateVisionPlan } from "./vision-plan";
import { saveRequirement } from "./requirements-save";
import { requirementsContext } from "./requirements-context";
import { POST as requirementsPlanPost, GET as requirementsDraftGet, DELETE as requirementsDraftDelete } from "../../app/api/capability-plan/route";
import { saveRadar, confirmJudgement, confirmResponse, setRadarStatus, generateRadarReport, record as radarRecord, dueRadar } from "../radar/service";
import { importLegacyRadar, publishResearch } from "../radar/migration";
import { radarJob } from "../radar/jobs";
import { periodRange } from "../radar/shared";
import { listRadar } from "../radar/service";
import { POST as radarPost } from "../../app/api/situation/[resource]/route";
import { GET as exportRadar, POST as restoreRadar } from "../../app/api/situation/backup/route";
import { configureNews, enqueueNews, reserveNews, newsInformation, revalidateNews, refinishNews, retryTransientNews, newsView } from "../radar/news";
import { defaultNewsConfig, limits, newsUsageSchema, newsRunSchema } from "../radar/news-shared";
import { taskDraftSchema } from "../daily/shared";
import { evaluateResource, resourceState, saveResource } from "./resource-operations";
import { confirmResourceClasses, resourceClassificationContext } from "./resource-classification";
import { POST as classifyResourcesPost } from "../../app/api/resource-classification/route";
import { confirmScenePlan, profileScenePlanContext, profileScenePlanId } from "./profile-scene-plan";

describe("项目任务年复盘", () => {
  const scope = { projectIds: ["review-project"], actionIds: ["review-action"] };
  async function setupReview() {
    await db.project.create({ data: { id: "review-project", profileId, name: "年度项目" } });
    await db.action.create({ data: { id: "review-action", profileId, projectId: "review-project", title: "年度任务" } });
  }
  const reviewData = { periodStart: "2026-01-01", periodEnd: "2026-12-31", wins: "实际结果", _reviewScope: scope };

  it.each([false, true])("项目任务年复盘：保存、编辑、归属、备份和删除（D1=%s）", async d1 => {
    cloud = d1; await setupReview();
    expect((await dataPost(request({ type: "review", data: { periodStart: "2026-01-01", periodEnd: "2026-12-31" } }))).status).toBe(400);
    await db.profile.create({ data: { id: "other-review-profile" } });
    await db.project.create({ data: { id: "foreign-review-project", profileId: "other-review-profile", name: "other" } });
    expect((await dataPost(request({ type: "review", data: { ...reviewData, _reviewScope: { ...scope, projectIds: ["foreign-review-project"] } } }))).status).toBe(400);
    const response = await dataPost(request({ type: "review", data: reviewData }));
    const review = await response.json(); expect(response.status, JSON.stringify(review)).toBe(201);
    expect(await db.recordSource.count({ where: { targetId: review.id } })).toBe(2);
    expect((await dataPatch(request({ type: "review", id: review.id, data: { adjustment: "下一步任务", _reviewScope: scope } }))).status).toBe(200);
    expect(await db.recordSource.count({ where: { targetId: review.id } })).toBe(2);
    const backup = await (await exportBackup()).json();
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).adjustment).toBe("下一步任务");
    expect(await db.recordSource.count({ where: { targetId: review.id } })).toBe(2);
    await dataDelete(request({ type: "action", id: "review-action" }));
    expect((await db.recordSource.findFirstOrThrow({ where: { targetId: review.id, sourceType: "action" } })).sourceTitle).toBe("年度任务");
    expect((await dataPatch(request({ type: "review", id: review.id, data: { wins: "保留历史" } }))).status).toBe(200);
    expect((await dataDelete(request({ type: "review", id: review.id }))).status).toBe(200);
    expect(await db.recordSource.count({ where: { targetId: review.id } })).toBe(0);
    expect(await db.project.count({ where: { id: "review-project" } })).toBe(1);
  });

  it.each([false, true])("项目任务年复盘：来源失败时复盘及关联一起回滚（D1=%s）", async d1 => {
    cloud = d1; await setupReview();
    sqlite.exec("CREATE TRIGGER reject_review_source BEFORE INSERT ON RecordSource WHEN NEW.sourceType='action' BEGIN SELECT RAISE(ABORT, 'review source failed'); END");
    try {
      expect((await dataPost(request({ type: "review", data: reviewData }))).status).toBe(400);
      expect(await db.review.count()).toBe(0);
      expect(await db.recordSource.count()).toBe(0);
    } finally { sqlite.exec("DROP TRIGGER reject_review_source"); }
  });
});

describe("场景档案AI人工确认", () => {
  async function pending() {
    await db.profile.update({ where: { id: profileId }, data: { major: "测试专业" } });
    await saveProfileScenes(db, { scenes: [{ sceneId: `${profileId}-scene-0`, fields: { industry: "旧资料", sceneDetails: { role: "已有角色", focus: "未选择字段" } } }] });
    const context = await profileScenePlanContext(db, false);
    const requestId = crypto.randomUUID(), items = [{ sceneId: `${profileId}-scene-0`, sceneDetails: { role: "人工修改后确认" }, explanation: "已知依据", questions: [] }];
    await db.goalBatch.create({ data: { id: profileScenePlanId, profileId, payload: JSON.stringify({ requestId, items, baselines: context.baselines }) } });
    return { requestId, items };
  }
  it.each([false, true])("人工确认、保留旧字段、重复确认、备份和版本（D1=%s）", async d1 => {
    cloud = d1; const draft = await pending();
    expect(await confirmScenePlan(db, draft.requestId, draft.items)).toMatchObject({ saved: 1, repeated: false });
    expect(await confirmScenePlan(db, draft.requestId, draft.items)).toMatchObject({ saved: 1, repeated: true });
    const record = await db.strategyRecord.findFirstOrThrow({ where: { kind: "profileScene" } });
    expect(JSON.parse(record.payload)).toMatchObject({ industry: "旧资料", sceneDetails: { role: "人工修改后确认", focus: "未选择字段" } });
    expect(await db.strategyVersion.count()).toBe(2); expect(await db.strategyRecord.count()).toBe(1);
    expect(strategyBackupSchema.safeParse(await exportStrategy(db)).success).toBe(true);
    await expect(confirmScenePlan(db, draft.requestId, [{ ...draft.items[0], sceneDetails: { role: "重复请求篡改" } }])).rejects.toThrow("已保存");
  });
  it.each([false, true])("冲突与其他档案归属不得覆盖或部分保存（D1=%s）", async d1 => {
    cloud = d1; const draft = await pending();
    await expect(confirmScenePlan(db, draft.requestId, [...draft.items, { ...draft.items[0], sceneId: "foreign-scene" }])).rejects.toThrow("不属于");
    const record = await db.strategyRecord.findFirstOrThrow({ where: { kind: "profileScene" } });
    await db.strategyRecord.update({ where: { id: record.id }, data: { updatedAt: new Date(record.updatedAt.getTime() + 1000) } });
    await expect(confirmScenePlan(db, draft.requestId, draft.items)).rejects.toThrow("已发生修改");
    expect(await db.strategyVersion.count()).toBe(1);
    expect(JSON.parse((await db.strategyRecord.findUniqueOrThrow({ where: { id: record.id } })).payload).sceneDetails.role).toBe("已有角色");
  });
  it.each([false, true])("版本写入失败时档案和草稿一并回滚（D1=%s）", async d1 => {
    cloud = d1; const draft = await pending();
    await db.$executeRawUnsafe("CREATE TRIGGER reject_scene_plan BEFORE INSERT ON StrategyVersion BEGIN SELECT RAISE(ABORT,'reject'); END");
    try {
      await expect(confirmScenePlan(db, draft.requestId, draft.items)).rejects.toThrow();
      expect(JSON.parse((await db.strategyRecord.findFirstOrThrow({ where: { kind: "profileScene" } })).payload).sceneDetails.role).toBe("已有角色");
      expect(JSON.parse((await db.goalBatch.findUniqueOrThrow({ where: { id: profileScenePlanId } })).payload).confirmed).toBeUndefined();
    } finally { await db.$executeRawUnsafe("DROP TRIGGER reject_scene_plan"); }
  });
});

describe("基础档案按场景保存", () => {
  const sceneId = (slot: number) => `${profileId}-scene-${slot}`;
  it.each([false, true])("适配参数与旧内容共存、备份恢复，并拒绝错误场景参数（D1=%s）", async d1 => {
    cloud = d1;
    const fields = profileSceneFields({ industry: "原有说明", stage: "原有阶段", sceneDetails: { role: "个人健康管理", stage: "建立习惯", healthEnergy: "已填写状态", successDefinition: "按实际记录检查作息" } });
    await saveProfileScenes(db, { scenes: [{ sceneId: sceneId(3), fields }] });
    const stored = (await strategyView(db)).records[0];
    expect(stored.payload).toMatchObject(fields);
    const backup = await (await exportSelf(new Request("http://localhost/api/profile-backup?section=profile"))).json();
    expect((await restoreSelf(request(backup))).status).toBe(200);
    expect((await strategyView(db)).records[0].payload).toMatchObject(fields);
    await db.workbenchScene.update({ where: { id: sceneId(3) }, data: { name: "身心" } });
    await saveProfileScenes(db, { scenes: [{ sceneId: sceneId(3), fields }] });
    await expect(saveProfileScenes(db, { global: { stage: "不可提交" }, scenes: [{ sceneId: sceneId(3), fields: { sceneDetails: { organization: "不适用字段" } } }] })).rejects.toThrow("不匹配");
    expect((await db.profile.findUniqueOrThrow({ where: { id: profileId } })).stage).toBe("");
    await expect(saveRecord(db, { kind: "profileScene", sceneId: sceneId(3), title: "健康资料", payload: { sceneDetails: { incomeRange: "错误参数" } } })).rejects.toThrow("不匹配");
    const invalid = await exportStrategy(db);
    invalid.records[0].payload = JSON.stringify({ sceneDetails: { organization: "错误参数" } });
    expect(strategyBackupSchema.safeParse(invalid).success).toBe(false);
    expect((await strategyView(db)).records[0].payload).toMatchObject(fields);
  });
  it.each([false, true])("场景独立、重复保存不复制、改名排序保留关联（D1=%s）", async d1 => {
    cloud = d1;
    await db.profile.update({ where: { id: profileId }, data: { name: "原称呼", stage: "原阶段", sensitiveAiFields: '["organization"]' } });
    const input = { scenes: [{ sceneId: sceneId(0), fields: { roles: "工作角色" } }, { sceneId: sceneId(3), fields: { roles: "健康角色" } }] };
    await saveProfileScenes(db, input); await saveProfileScenes(db, input);
    expect(await db.strategyRecord.count({ where: { kind: "profileScene" } })).toBe(2);
    await saveProfileScenes(db, { scenes: [{ sceneId: sceneId(0), fields: { roles: "新工作角色" } }] });
    const sceneView = await strategyView(db);
    expect(sceneView.records.find(row => row.sceneId === sceneId(3))?.payload.roles).toBe("健康角色");
    expect(await db.profile.findUniqueOrThrow({ where: { id: profileId } })).toMatchObject({ name: "原称呼", stage: "原阶段", sensitiveAiFields: '["organization"]' });
    await db.workbenchScene.update({ where: { id: sceneId(0) }, data: { name: "事业" } });
    expect((await strategyView(db)).records.find(row => row.sceneId === sceneId(0))?.payload.roles).toBe("新工作角色");
  });
  it.each([false, true])("原子保存全局与多个场景；未知场景不留下部分更新（D1=%s）", async d1 => {
    cloud = d1;
    await db.profile.update({ where: { id: profileId }, data: { stage: "原阶段", roles: "保留角色", sensitiveAiFields: '["organization"]' } });
    await expect(saveProfileScenes(db, { global: { stage: "不应更新" }, scenes: [{ sceneId: sceneId(0), fields: { roles: "不应保存" } }, { sceneId: "foreign-scene", fields: {} }] })).rejects.toThrow("场景无效");
    expect(await db.strategyRecord.count()).toBe(0);
    expect((await db.profile.findUniqueOrThrow({ where: { id: profileId } })).stage).toBe("原阶段");
    await saveProfileScenes(db, { global: { stage: "全局补充" }, scenes: [] });
    expect(await db.profile.findUniqueOrThrow({ where: { id: profileId } })).toMatchObject({ roles: "保留角色", sensitiveAiFields: '["organization"]' });
    await saveProfileScenes(db, { global: { stage: "新全局阶段", sensitiveAiFields: '["healthEnergy"]' }, scenes: [{ sceneId: sceneId(3), fields: { stage: "健康阶段" } }] });
    expect((await db.profile.findUniqueOrThrow({ where: { id: profileId } })).stage).toBe("新全局阶段");
    expect(await db.strategyVersion.count()).toBe(1);
  });
  it.each([false, true])("基础档案分板块备份与完整备份保留内容及版本（D1=%s）", async d1 => {
    await saveProfileScenes(db, { scenes: [{ sceneId: sceneId(0), fields: { roles: "事业角色" } }] });
    const backup = await (await exportSelf(new Request("http://localhost/api/profile-backup?section=profile"))).json();
    expect(backup.data.strategy.records).toHaveLength(1); expect(backup.data.strategy.versions).toHaveLength(1);
    cloud = d1;
    expect((await restoreSelf(request(backup))).status).toBe(200);
    expect((await strategyView(db)).records[0].payload.roles).toBe("事业角色");
    const full = await (await exportBackup()).json();
    expect((await restoreBackup(request(full))).status).toBe(200);
    expect(await db.strategyRecord.count({ where: { kind: "profileScene" } })).toBe(1);
    expect(await db.strategyVersion.count()).toBe(1);
    full.data.strategy.records = []; full.data.strategy.versions = [];
    expect((await restoreBackup(request(full))).status).toBe(200);
    expect(await db.strategyRecord.count()).toBe(0);
  });
  it.each([false, true])("数据库写入失败时全局、场景与版本一起回滚（D1=%s）", async d1 => {
    cloud = d1;
    await db.profile.update({ where: { id: profileId }, data: { stage: "原阶段" } });
    await db.$executeRawUnsafe("CREATE TRIGGER profile_scene_failure BEFORE INSERT ON StrategyVersion WHEN NEW.kind='profileScene' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    try {
      await expect(saveProfileScenes(db, { global: { stage: "新阶段" }, scenes: [{ sceneId: sceneId(0), fields: { roles: "工作角色" } }] })).rejects.toThrow();
      expect(await db.strategyRecord.count()).toBe(0); expect(await db.strategyVersion.count()).toBe(0);
      expect((await db.profile.findUniqueOrThrow({ where: { id: profileId } })).stage).toBe("原阶段");
    } finally { await db.$executeRawUnsafe("DROP TRIGGER profile_scene_failure"); }
  });
  it("场景敏感字段授权继续生效，API 拒绝重复场景及伪造字段", async () => {
    await saveProfileScenes(db, { scenes: [{ sceneId: sceneId(0), fields: { roles: "公开角色", organization: "私密组织", healthEnergy: "私密健康" } }] });
    const config = { domain: "通用", scope: "标准", exclusions: [], options: contextOptionsSchema.parse({}) };
    const context = selectContext({ strategy: await strategyView(db), sensitiveAiFields: "[]" }, config);
    expect(JSON.stringify(context)).toContain("公开角色"); expect(JSON.stringify(context)).not.toContain("私密组织"); expect(JSON.stringify(context)).not.toContain("私密健康");
    const excluded = selectContext({ strategy: await strategyView(db), sensitiveAiFields: '["organization"]' }, { ...config, exclusions: ["公司"] });
    expect(JSON.stringify(excluded)).not.toContain("私密组织");
    const row = { sceneId: sceneId(0), fields: {} };
    expect((await strategyPost(request({ action: "profile-scenes-save", data: { scenes: [row, row] } }))).status).toBe(400);
    await expect(saveProfileScenes(db, { scenes: [{ ...row, fields: { profileId: "foreign-profile" } }] })).rejects.toThrow();
    expect(profileSceneFields({ roles: "原有资料", name: "全局称呼" })).not.toHaveProperty("name");
    const data = await exportStrategy(db);
    expect(strategyBackupSchema.safeParse({ ...data, records: [...data.records, { ...data.records[0], id: "duplicate-scene" }] }).success).toBe(false);
  });
});

describe("资源运营轻量闭环", () => {
  const setup = async () => {
    const input = { requestId: crypto.randomUUID(), name: "专注时段", description: "保留原说明", sceneIds: [`${profileId}-scene-0`],
      expectedUpdatedAt: null, expectedLedgerUpdatedAt: null, ledger: { capitalClass: "时间", importance: "关键", availability: "可用", available: "每周两小时", expectedReturn: "完成作品" } };
    const row = await saveResource(db, input);
    return { input, id: row.id as string };
  };
  const evaluation = async (resourceId: string, actionId: string) => {
    const state = await resourceState(db, resourceId), review = await db.selfActionReview.findFirstOrThrow({ where: { actionId, profileId } });
    return { resourceId, actionId, reviewVersion: review.updatedAt.toISOString(), expectedUpdatedAt: state.resource.updatedAt.toISOString(), expectedLedgerUpdatedAt: state.tag?.updatedAt.toISOString() || null,
      actualInvestment: "一小时", actualReturn: "完成初稿", observation: "时段可持续，但被临时沟通打断", available: "下周两小时", availability: "受限", adjustment: "改进", nextStep: "维护专注边界", nextCheckDate: "2026-10-07" };
  };
  it.each([false, true])("统一配置原子保存、幂等与版本冲突（D1=%s）", async (d1) => {
    cloud = d1; const row = await setup(); expect(await saveResource(db, row.input)).toEqual({ id: row.id });
    expect(await db.resource.count()).toBe(1); expect(await db.strategyVersion.count()).toBe(1);
    const state = await resourceState(db, row.id);
    expect(state.ledger).toMatchObject({ capitalClass: "时间", element: "能量", importance: "关键", actualReturn: "" });
    const changed = { ...row.input, id: row.id, requestId: crypto.randomUUID(), name: "新名称", expectedUpdatedAt: state.resource.updatedAt.toISOString(), expectedLedgerUpdatedAt: state.tag!.updatedAt.toISOString() };
    await saveResource(db, changed);
    await expect(saveResource(db, { ...changed, requestId: crypto.randomUUID(), name: "过期修改" })).rejects.toThrow("已变化");
    expect((await resourceState(db, row.id)).resource.description).toBe("保留原说明");
  });
  it("接受浏览器与HTTP局域网使用的请求编号，接口保存后不重复创建", async () => {
    const input = { requestId: "0123456789abcdef0123456789abcdef", name: "浏览器资源", sceneIds: [], expectedUpdatedAt: null, expectedLedgerUpdatedAt: null, ledger: { capitalClass: "时间" } };
    const first = await strategyPost(request({ action: "resource-save", data: input })); expect(first.status).toBe(200);
    const second = await strategyPost(request({ action: "resource-save", data: input })); expect(second.status).toBe(200);
    const saved = await first.json(); expect(saved).toEqual(await second.json()); expect(await db.resource.count()).toBe(1);
    const task = { sourceType: "resource", sourceId: saved.id, requestId: "1123456789abcdef0123456789abcdef", title: "维护资源", operation: "维护" };
    expect((await strategyPost(request({ action: "self-link", data: task }))).status).toBe(200);
    expect((await strategyPost(request({ action: "self-link", data: task }))).status).toBe(200);
    expect(await db.action.count()).toBe(1); expect(await db.recordSource.count()).toBe(1);
  });
  it.each([false, true])("共享任务复盘，分别评估、防重、保留历史与备份（D1=%s）", async (d1) => {
    cloud = d1; const a = await setup(), b = await setup();
    const linked = await linkSelfAction(db, { sourceType: "resource", sourceId: a.id, requestId: crypto.randomUUID(), title: "使用专注时段", operation: "使用", standard: "完成初稿" });
    await linkSelfAction(db, { sourceType: "resource", sourceId: b.id, requestId: crypto.randomUUID(), actionId: linked.id, title: "共用任务" });
    await db.action.update({ where: { id: linked.id }, data: { status: "已完成" } });
    await saveSelfReview(db, { actionId: linked.id, result: "完成初稿", adjustment: "维护专注边界" });
    const body = await evaluation(a.id, linked.id), first = await evaluateResource(db, body);
    expect(await evaluateResource(db, body)).toEqual(first);
    await expect(evaluateResource(db, { ...body, available: "擅自改存量" })).rejects.toThrow("已确认");
    await evaluateResource(db, await evaluation(b.id, linked.id));
    expect(await db.action.count()).toBe(1); expect(await db.selfActionReview.count()).toBe(1);
    const updated = await resourceState(db, a.id);
    expect(updated.ledger).toMatchObject({ available: "下周两小时", actualInvestment: "一小时", actualReturn: "完成初稿", adjustment: "改进", availability: "受限" });
    const frozen = await evaluation(a.id, linked.id);
    await saveSelfReview(db, { actionId: linked.id, result: "补充真实结果" });
    await expect(evaluateResource(db, frozen)).rejects.toThrow("复盘已变化");
    const second = { ...await evaluation(a.id, linked.id), actualReturn: "补充真实结果" };
    await evaluateResource(db, second);
    expect(await db.strategyVersion.count({ where: { recordId: updated.tag!.id } })).toBe(3);
    const backup = await (await exportBackup()).json(); expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await resourceState(db, a.id)).ledger.actualReturn).toBe("补充真实结果");
    expect(await evaluateResource(db, second)).toMatchObject({ id: a.id });
  });
  it("拒绝未完成、未关联、跨档案和未验收 AI，保留资源", async () => {
    const row = await setup();
    const linked = await linkSelfAction(db, { sourceType: "resource", sourceId: row.id, requestId: crypto.randomUUID(), title: "维护资源" });
    await db.action.update({ where: { id: linked.id }, data: { status: "已完成" } });
    await saveSelfReview(db, { actionId: linked.id, result: "完成" }); const body = await evaluation(row.id, linked.id);
    await db.action.update({ where: { id: linked.id }, data: { status: "进行中" } }); await expect(evaluateResource(db, body)).rejects.toThrow("先完成");
    await db.action.update({ where: { id: linked.id }, data: { status: "已完成" } });
    await initializeDaily(db); const agent = await db.dailyAgent.findFirstOrThrow();
    await saveTasks(db, "2026-10-06", [taskDraftSchema.parse({ title: "AI维护", lane: "B", actionId: linked.id, steps: Array.from({ length: 3 }, () => ({ title: "核对", assignee: "ai", agentId: agent.id, estimatedMinutes: 10 })) })], "", "test");
    await expect(evaluateResource(db, body)).rejects.toThrow("AI 验收");
    await db.dailyTask.deleteMany({ where: { actionId: linked.id } });
    await db.recordSource.deleteMany({ where: { sourceId: row.id } }); await expect(evaluateResource(db, body)).rejects.toThrow("未关联");
    await db.profile.create({ data: { id: "other" } }); const other = await db.resource.create({ data: { profileId: "other", name: "别人的资源" } });
    await expect(evaluateResource(db, { ...body, resourceId: other.id })).rejects.toThrow("不属于");
    expect((await resourceState(db, row.id)).ledger.available).toBe("每周两小时");
  });
  it.each([false, true])("评估与配置失败回滚（D1=%s）", async (d1) => {
    cloud = d1; const row = await setup();
    const linked = await linkSelfAction(db, { sourceType: "resource", sourceId: row.id, requestId: crypto.randomUUID(), title: "维护" });
    await db.action.update({ where: { id: linked.id }, data: { status: "已完成" } }); await saveSelfReview(db, { actionId: linked.id, result: "完成" });
    const body = await evaluation(row.id, linked.id), count = await db.goalBatch.count();
    await db.$executeRawUnsafe("CREATE TRIGGER reject_resource BEFORE INSERT ON StrategyVersion BEGIN SELECT RAISE(ABORT,'reject'); END");
    try {
      await expect(evaluateResource(db, body)).rejects.toThrow(); expect((await resourceState(db, row.id)).ledger.actualReturn).toBe(""); expect(await db.goalBatch.count()).toBe(count);
      await expect(saveResource(db, { ...row.input, requestId: crypto.randomUUID() })).rejects.toThrow(); expect(await db.resource.count()).toBe(1);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER reject_resource"); }
  });
  it("待选分类沿用愿景敏感场景，未授权不发送，虚假引用拒绝", async () => {
    const wish = await vision();
    await db.strategyRecord.update({ where: { id: wish.id }, data: { sceneId: `${profileId}-scene-3` } });
    const draft = { title: "专注条件", visionId: wish.id, reason: "落实计划", requirements: "方法", importance: "关键", element: "信息", allocation: "", boundary: "", expectedReturn: "", nextStep: "" };
    await db.goalBatch.create({ data: { id: `${profileId}:resource-demand:draft`, profileId, payload: JSON.stringify({ result: { summary: "草稿", capabilities: [], resources: [draft], cleanup: [] }, requestIds: { "resource:0": crypto.randomUUID() } }) } });
    const input = { resourceIds: [], includeDraft: true, allowSensitive: false }, preview = await resourceClassificationContext(db, input);
    expect(preview.sources[0]).toMatchObject({ blocked: true, content: "[敏感资料未授权]" });
    expect((await classifyResourcesPost(request({ ...input, action: "generate", fingerprint: preview.fingerprint }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await resourceClassificationContext(db, { ...input, allowSensitive: true })).sources[0].blocked).toBe(false);
    await expect(confirmResourceClasses(db, { ...input, fingerprint: preview.fingerprint }, [{ key: "resource:fake", capitalClass: "知识" }])).rejects.toThrow("无效");
    expect(await db.resource.count()).toBe(0);
  });
  it.each([false, true])("分类先草稿后确认，不覆盖内容及12条旧需求（D1=%s）", async (d1) => {
    cloud = d1;
    const resource = await db.resource.create({ data: { profileId, name: "素材模板", description: "原有资料" } }); const wish = await vision();
    const old = { title: "工具", visionId: wish.id, reason: "作品", requirements: "待确认", importance: "关键", element: "物质", allocation: "", boundary: "", expectedReturn: "", nextStep: "" };
    const requestIds = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`resource:${index}`, crypto.randomUUID()]));
    await db.goalBatch.create({ data: { id: `${profileId}:resource-demand:draft`, profileId, payload: JSON.stringify({ result: { summary: "旧草稿", capabilities: [], resources: Array.from({ length: 12 }, () => old), cleanup: [] }, ids: [wish.id], requestIds, inventory: [] }) } });
    const input = { resourceIds: [resource.id], includeDraft: true, allowSensitive: false }, preview = await resourceClassificationContext(db, input);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions: preview.sources.map((source) => ({ key: source.key, capitalClass: source.key.startsWith("resource:") ? "知识" : "实物", reason: "用途" })) }) } }] }))));
    expect((await classifyResourcesPost(request({ ...input, action: "preview" }))).status).toBe(200); expect(fetch).not.toHaveBeenCalled();
    const generated = await classifyResourcesPost(request({ ...input, action: "generate", fingerprint: preview.fingerprint })); expect(generated.status).toBe(200);
    expect((await resourceState(db, resource.id)).ledger.capitalClass).toBe("待分类");
    const suggestions = (await generated.json()).suggestions;
    await confirmResourceClasses(db, { ...input, fingerprint: preview.fingerprint }, suggestions);
    expect((await resourceState(db, resource.id)).ledger.capitalClass).toBe("知识"); expect((await resourceState(db, resource.id)).resource.description).toBe("原有资料");
    const draft = (await (await requirementsDraftGet()).json()).draft;
    expect(draft.result.resources).toHaveLength(12); expect(draft.requestIds).toEqual(requestIds); expect(draft.result.resources[0].capitalClass).toBe("实物");
    expect(await db.resource.count()).toBe(1);
    await expect(confirmResourceClasses(db, { ...input, fingerprint: preview.fingerprint }, suggestions)).rejects.toThrow("已变化");
  });
});

describe("每日资讯持久化执行",()=>{
  it.each([false,true])("36次预算优先补齐当日超时解读，复用来源、只建一轮且不清零原账本（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);await configureNews(db,{version:1,payload:defaultNewsConfig()});
    const now=new Date(),date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(now);
    await enqueueNews(db,{requestId:crypto.randomUUID(),column:"b"},false,now);
    const original=await db.radarRecord.findFirstOrThrow({where:{kind:"newsRun"}}),p=JSON.parse(original.payload);
    const sources=[{id:"S1",title:"公告",url:null,publisher:"机构",content:"原始公告说明行业政策变化。".repeat(100),collectedAt:p.cutoff,publishedAt:date,publishedTime:p.cutoff,quality:"text",group:"original",original:true,note:""}];
    await db.radarRecord.update({where:{id:original.id},data:{status:"failed",payload:JSON.stringify({...p,stage:"final",sources,modelCount:3,searchCount:7})}});
    await db.researchBatch.update({where:{id:original.id},data:{status:"failed",error:"AI 调用超时，请确认服务状态后重试",updatedAt:new Date(now.getTime()-61000)}});
    const preview=await newsView(db,new URLSearchParams({date,column:"b"}));
    expect(newsRunSchema.parse(preview.run!.payload).sources[0].content).toBe(sources[0].content.slice(0,600));
    expect(preview.completion).toEqual({completed:0,total:11,deadline:`${date}T07:00:00+08:00`});
    await reserveNews(db,"model",date);await db.radarRecord.update({where:{id:`local-profile-news-usage-${date}`},data:{payload:JSON.stringify({date,search:71,extract:0,model:33})}});
    await expect(enqueueNews(db,{requestId:crypto.randomUUID()})).rejects.toThrow("补齐");
    await retryTransientNews(db,now);await retryTransientNews(db,now);
    expect(await db.researchBatch.count()).toBe(2);
    const recovery=await db.radarRecord.findFirstOrThrow({where:{kind:"newsRun",parentId:original.id}});
    expect(JSON.parse(recovery.payload)).toMatchObject({sources,cutoff:p.cutoff,date,stage:"final",modelCount:0});
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:JSON.stringify({items:[{title:"政策变化",facts:"政策变化",impact:"影响待核实",reason:"公告",section:"企业",eventDate:date,uncertainty:"仅一个来源",citations:[{sourceId:"S1",quote:"原始公告说明行业政策变化"}]}],gaps:""})}}],usage:{prompt_tokens:10,completion_tokens:10}}));
    vi.stubGlobal("fetch",fetcher);
    await executeResearch(db,(await claimResearch(db))!,{apiKey:"mock",tavilyKey:"mock"});
    const saved=JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:recovery.id}})).payload);
    expect(saved.published).toBe(true);expect(saved.items).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await newsView(db,new URLSearchParams({date,column:"b"}))).completion.completed).toBe(1);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:`local-profile-news-usage-${date}`}})).payload)).toMatchObject({search:71,model:34});
    await retryTransientNews(db,now);expect(await db.researchBatch.count()).toBe(2);
    for(let n=0;n<2;n++)await reserveNews(db,"model",date);
    await expect(reserveNews(db,"model",date)).rejects.toThrow("额度");
    expect(newsUsageSchema.safeParse({date,model:37,search:0,extract:0}).success).toBe(false);
  });
  it("自动续跑遵守暂停、日期、配额且不重试未知中断",async()=>{
    await initializeDaily(db);await configureNews(db,{version:1,payload:defaultNewsConfig()});
    const now=new Date("2026-10-15T00:00:00Z");await enqueueNews(db,{requestId:crypto.randomUUID(),column:"politics"},false,now);
    const row=await db.radarRecord.findFirstOrThrow({where:{kind:"newsRun"}}),payload={...JSON.parse(row.payload),modelCount:1};
    await db.researchBatch.update({where:{id:row.id},data:{status:"failed",error:"执行中断",updatedAt:now}});
    await retryTransientNews(db,now);expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:row.id}})).payload).retryAt).toBeNull();
    await db.radarRecord.update({where:{id:row.id},data:{payload:JSON.stringify(payload)}});
    await db.researchBatch.update({where:{id:row.id},data:{error:"AI 服务返回 HTTP 503"}});
    await configureNews(db,{version:1,payload:{...defaultNewsConfig(),enabled:false}});
    await retryTransientNews(db,now);expect((await db.researchBatch.findUniqueOrThrow({where:{id:row.id}})).status).toBe("failed");
    await configureNews(db,{version:2,payload:defaultNewsConfig()});
    await retryTransientNews(db,new Date("2026-10-16T00:00:00Z"));
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:row.id}})).payload).retryAt).toBeNull();
    await reserveNews(db,"model","2026-10-15");await db.radarRecord.update({where:{id:"local-profile-news-usage-2026-10-15"},data:{payload:JSON.stringify({date:"2026-10-15",model:limits.model,search:0,extract:0})}});
    await retryTransientNews(db,now);expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:row.id}})).payload).retryAt).toBeNull();
  });
  it.each([false,true])("503自动续跑等待60秒、防重且保留原计数（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);await configureNews(db,{version:1,payload:defaultNewsConfig()});
    const now=new Date("2026-10-15T00:00:00Z");
    await enqueueNews(db,{requestId:crypto.randomUUID(),column:"politics"},false,now);
    const row=await db.radarRecord.findFirstOrThrow({where:{kind:"newsRun"}}),p=JSON.parse(row.payload);
    await db.radarRecord.update({where:{id:row.id},data:{payload:JSON.stringify({...p,modelCount:1}),status:"failed"}});
    await db.researchBatch.update({where:{id:row.id},data:{status:"failed",error:"AI 服务返回 HTTP 503",updatedAt:now}});
    await retryTransientNews(db,now);
    await retryTransientNews(db,new Date(now.getTime()+59000));
    expect((await db.researchBatch.findUniqueOrThrow({where:{id:row.id}})).status).toBe("failed");
    await retryTransientNews(db,new Date(now.getTime()+60000));
    const resumed=await db.researchBatch.findUniqueOrThrow({where:{id:row.id}});
    expect(resumed.status).toBe("queued");
    const saved=JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:row.id}})).payload);
    expect(saved).toMatchObject({modelCount:1,automaticRetries:1,retryAt:null});
    await retryTransientNews(db,new Date(now.getTime()+61000));
    expect((await db.researchBatch.findUniqueOrThrow({where:{id:row.id}})).version).toBe(resumed.version);
    await db.researchBatch.update({where:{id:row.id},data:{status:"failed",error:"AI 服务返回 HTTP 503"}});
    await retryTransientNews(db,new Date(now.getTime()+120000));
    expect((await db.researchBatch.findUniqueOrThrow({where:{id:row.id}})).status).toBe("failed");
  });
  it.each([false,true])("重新解读复用截止时间和资料，幂等且不返还预算（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);
    await enqueueNews(db,{requestId:crypto.randomUUID(),column:"economy"},false,new Date("2026-10-05T10:00:00Z"));
    const row=await db.radarRecord.findFirstOrThrow({where:{kind:"newsRun"}}),p=JSON.parse(row.payload);
    const sources=[{id:"S1",title:"事实",url:null,publisher:"测试",publishedAt:null,publishedTime:null,collectedAt:p.cutoff,content:"测试事实资料",quality:"manual",group:"test",original:false,note:""}];
    await db.radarRecord.update({where:{id:row.id},data:{payload:JSON.stringify({...p,sources,modelCount:3,searchCount:7}),status:"failed"}});
    await db.researchBatch.update({where:{id:row.id},data:{status:"failed"}});
    await reserveNews(db,"model","2026-10-05");
    const input={id:row.id,requestId:crypto.randomUUID()},result=await refinishNews(db,input);
    expect(await refinishNews(db,input)).toEqual(result);
    const next=JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:result.id}})).payload);
    expect(next).toMatchObject({date:p.date,cutoff:p.cutoff,sources,stage:"final",modelCount:0,searchCount:0,published:false});
    expect(await db.researchBatch.count()).toBe(2);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:"local-profile-news-usage-2026-10-05"}})).payload).model).toBe(1);
    await expect(refinishNews(db,{id:row.id,requestId:crypto.randomUUID()})).rejects.toThrow("等待");
  });
  it.each([false,true])("05:00提前采集、重启当天、防重、恢复暂停（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);
    expect((await enqueueNews(db,{},true,new Date("2026-10-05T00:00:00Z"))).count).toBe(0);
    await configureNews(db,{version:1,payload:defaultNewsConfig()});
    expect((await enqueueNews(db,{},true,new Date("2026-10-04T20:59:59Z"))).count).toBe(0);
    expect((await enqueueNews(db,{},true,new Date("2026-10-04T21:00:00Z"))).count).toBe(11);
    expect((await enqueueNews(db,{},true,new Date("2026-10-05T02:00:00Z"))).count).toBe(0);
    expect(await db.researchBatch.count()).toBe(11);
    await importLegacyRadar(db);expect(await db.radarRecord.count({where:{kind:"history"}})).toBe(0);
    const backup=strategyBackupSchema.parse(await exportStrategy(db));await restoreStrategy(db,backup);
    expect((await enqueueNews(db,{},true,new Date("2026-10-06T00:00:00Z"))).count).toBe(0);
    expect(await db.researchBatch.count({where:{status:"queued"}})).toBe(0);
  });
  it("共享预算并发预占不超过上限，补搜保留其他栏目额度",async()=>{
    await reserveNews(db,"search","2026-10-05");
    await db.radarRecord.update({where:{id:"local-profile-news-usage-2026-10-05"},data:{payload:JSON.stringify({date:"2026-10-05",search:79,extract:19,model:limits.model-1})}});
    for(const type of ["search","extract","model"] as const){const result=await Promise.allSettled([reserveNews(db,type,"2026-10-05"),reserveNews(db,type,"2026-10-05")]);expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);}
    await expect(reserveNews(db,"search","2026-10-05",4)).rejects.toThrow("额度");
  });
  it.each([false,true])("恢复旧备份不能返还已消耗的资讯预算（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);const backup=await (await exportBackup()).json();
    await reserveNews(db,"model","2026-10-05");
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:"local-profile-news-usage-2026-10-05"}})).payload).model).toBe(1);
  });
  it("过期租约的模型响应和重复执行不能覆盖新版本或再次占用预算",async()=>{
    await initializeDaily(db);await enqueueNews(db,{requestId:crypto.randomUUID(),column:"health"});
    const row=await db.radarRecord.findFirstOrThrow({where:{kind:"newsRun"}}),p=JSON.parse(row.payload);
    await db.radarRecord.update({where:{id:row.id},data:{payload:JSON.stringify({...p,stage:"final",modelCount:2,sources:[{id:"S1",title:"事实",url:null,publisher:"测试",publishedAt:null,publishedTime:null,collectedAt:new Date().toISOString(),content:"仅为测试事实",quality:"manual",group:"test",original:false,note:""}]})}});
    const batch=(await claimResearch(db))!;
    vi.stubGlobal("fetch",vi.fn(async()=>{await db.researchBatch.update({where:{id:batch.id},data:{status:"queued",version:{increment:1},slot:null,leaseToken:null}});return Response.json({choices:[{message:{content:JSON.stringify({items:[],gaps:"测试"})}}]});}));
    await executeResearch(db,batch,{apiKey:"mock",tavilyKey:"mock"});
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:row.id}})).payload).published).toBe(false);
    const usage=await db.radarRecord.findFirstOrThrow({where:{kind:"newsUsage"}});
    await executeResearch(db,batch,{apiKey:"mock",tavilyKey:"mock"});
    expect((await db.radarRecord.findUniqueOrThrow({where:{id:usage.id}})).payload).toBe(usage.payload);
  });
  it.each([false,true])("原生工具规划、补搜、整理三轮，资料进入同一信息库且备份可恢复（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);await configureNews(db,{version:1,payload:defaultNewsConfig()});
    await enqueueNews(db,{requestId:crypto.randomUUID(),column:"health"});let models=0,searches=0;
    vi.stubGlobal("fetch",vi.fn(async(url:string,options:RequestInit)=>{
      if(url.includes("cloudflare-dns"))return Response.json({Answer:[{type:1,data:"8.8.8.8"}]});
      const body=JSON.parse(String(options.body));
      if(url.includes("tavily")&&body.urls)return Response.json({results:[{url:body.urls[0],raw_content:"临床前研究结果，不等于患者获益。补充完整实验资料。"}],usage:{credits:0}});
      if(url.includes("tavily")){searches++;return Response.json({results:[{url:"https://example.com/report",title:"研究报告",content:"临床前研究结果，不等于患者获益。",published_date:new Date().toISOString()}],usage:{credits:2}});}
      models++;if(body.tools)return Response.json({choices:[{message:{tool_calls:[{id:`tool-${models}`,function:{name:"search_public_web",arguments:JSON.stringify({query:models===1?"精准医疗 最新公告":"临床研究 新进展"})}},...(models===2?[{id:"extract-1",function:{name:"extract_public_page",arguments:JSON.stringify({sourceId:JSON.parse(body.messages[1].content).sources[0].id})}}]:[])]}}],usage:{prompt_tokens:100,completion_tokens:50}});
      const input=JSON.parse(body.messages[1].content);
      return Response.json({choices:[{message:{content:JSON.stringify({items:[{title:"研究报告",facts:"临床前研究",impact:"仍需临床验证",reason:"研究进展",section:"医学",eventDate:null,uncertainty:"临床前",citations:[{sourceId:input.sources[0].id,quote:"临床前研究结果"}]}],gaps:"样本不足"})}}],usage:{prompt_tokens:100,completion_tokens:50}});
    }));
    for(let i=0;i<16;i++){const b=await claimResearch(db);if(!b)break;await executeResearch(db,b,{apiKey:"mock",tavilyKey:"mock"});}
    const b=await db.researchBatch.findFirstOrThrow();expect(b.status).toBe("review");expect(models).toBe(3);expect(searches).toBe(2);
    const run=await db.radarRecord.findUniqueOrThrow({where:{id:b.id}});expect(JSON.parse(run.payload).published).toBe(true);
    const first=await newsInformation(db,{id:b.id,indexes:[0]}),second=await newsInformation(db,{id:b.id,indexes:[0]});expect(first.rows[0].id).toBe(second.rows[0].id);
    const payload=JSON.parse(run.payload);
    await db.radarRecord.update({where:{id:b.id},data:{payload:JSON.stringify({...payload,published:false,items:[],stage:"final"}),status:"failed"}});
    await db.researchBatch.update({where:{id:b.id},data:{status:"failed"}});
    expect(await revalidateNews(db,{id:b.id})).toEqual({id:b.id});expect(await revalidateNews(db,{id:b.id})).toEqual({id:b.id});expect(models).toBe(3);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:b.id}})).payload).items).toHaveLength(1);
    const backup=await (await exportRadar()).json();expect((await restoreRadar(request(backup))).status).toBe(200);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:"local-profile-news-config"}})).payload).enabled).toBe(false);
  });
});

describe("外部环境雷达统一闭环", () => {
  it.each([false,true])("主题新增防重、改名自动更新筛选并保留关联，过期编辑不覆盖（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);
    const input={requestId:crypto.randomUUID(),title:"关注政策",payload:{question:"政策变化对项目有什么影响",dimension:"待分类",reviewDate:""}};
    const topic=await saveRadar(db,"topic",input);
    expect(await saveRadar(db,"topic",input)).toEqual(topic);
    const info=await saveRadar(db,"information",{requestId:crypto.randomUUID(),title:"关联资料",topicId:topic.id,payload:{source:{id:"manual",title:"资料",url:null,publisher:"手动",publishedAt:null,collectedAt:new Date().toISOString(),content:"观察到一条变化",quality:"manual",group:"manual",original:false,note:""}}});
    await saveRadar(db,"topic",{...input,id:topic.id,version:1,requestId:crypto.randomUUID(),title:"关注行业变化",payload:{...input.payload,question:"行业变化如何影响项目"}});
    const list=await listRadar(db,new URLSearchParams({kind:"information",topic:topic.id}));
    expect(list.rows.map(r=>r.id)).toEqual([info.id]);
    expect(list.topics.find(t=>t.id===topic.id)?.title).toBe("关注行业变化");
    expect(await db.radarRecord.count({where:{kind:"topic"}})).toBe(1);
    await expect(saveRadar(db,"topic",{...input,id:topic.id,version:1,requestId:crypto.randomUUID(),title:"过期修改"})).rejects.toThrow("已更新");
    const saved=await db.radarRecord.findUniqueOrThrow({where:{id:topic.id}});
    expect(saved.title).toBe("关注行业变化");expect(saved.version).toBe(2);
  });
  it("周遭变化独立筛选，同正文普通资料不吞掉观察内容，备份保留",async()=>{
    await initializeDaily(db);
    const payload={source:{id:"local",title:"门店观察",url:null,publisher:"身边观察",publishedAt:null,collectedAt:new Date().toISOString(),content:"门店缩短营业时间",quality:"manual",group:"manual",original:false,note:"待核实"},facts:"",notes:"",verification:"待核验"};
    await saveRadar(db,"information",{requestId:crypto.randomUUID(),title:"一般资料",payload});
    const observation={nature:"他人转述",occurredOn:"2026-10-06",signal:"客流变化？",alternative:"可能是节假日",nextCheck:"询问其他门店"};
    const saved=await saveRadar(db,"information",{requestId:crypto.randomUUID(),title:"周遭变化",payload:{...payload,observation}});
    const result=await listRadar(db,new URLSearchParams({kind:"information",collection:"surroundings"}));
    expect(result.total).toBe(1);expect(result.rows[0].id).toBe(saved.id);
    const backup=strategyBackupSchema.parse(await exportStrategy(db));await restoreStrategy(db,backup);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:saved.id}})).payload).observation).toEqual(observation);
  });
  async function information(content = "公开报告记录了三个访谈样本。") {
    return saveRadar(db, "information", { requestId: crypto.randomUUID(), title: "报告事实", payload: { source: { id: "input", title: "报告事实", url: null, publisher: "访谈", publishedAt: null, collectedAt: "2026-10-05T00:00:00.000Z", content, quality: "manual", group: "original", original: false, note: "" }, facts: content, notes: "不代表整体市场", verification: "待核验" } });
  }
  async function analysis(infoId: string, confidence = "低", revision?: { revisionJudgementId: string; revisionVersion: number }) {
    return saveRadar(db, "analysis", { requestId: crypto.randomUUID(), title: "需求判断", payload: { informationIds: [infoId], sources: [], background: [], gaps: "样本有限", ...revision, conclusion: { title: "需求判断", facts: "报告记录三个样本", relevance: "可能存在需求，属于推断", nextStep: "先核实后调整", backgroundIds: [], citations: [{ sourceId: infoId, quote: "三个访谈样本" }], evidence: "单一来源", uncertainty: "需要更广样本", radar: { confidence, confidenceReason: "核对了访谈原文", indicator: "新增访谈数量", expected: "至少十个样本", reviewDate: "2026-01-01" } } } });
  }
  it.each([false,true])("多选综合研判去重、独立观点快照、后台应变草稿与备份（D1=%s）",async d1=>{
    cloud=d1;await initializeDaily(db);
    const first=await information(),second=await information("另一报告记录了三个访谈样本，需求尚待验证。");
    const draft=await analysis(first.id),other=await analysis(second.id,"中");
    const judgement=await confirmJudgement(db,{id:other.id,version:1,requestId:crypto.randomUUID()});
    const input={requestId:crypto.randomUUID(),mode:"analyze",question:"综合两份资料，给出可逆应变措施",recordIds:[draft.id,judgement.id,first.id]};
    const configured={search:false,ai:true},preview=await radarJob(db,input,true,configured);
    if(!("sources" in preview))throw Error("缺少预览");
    expect(preview.sources.map(s=>s.id)).toEqual([first.id,second.id]);
    expect(preview.assessments.map(a=>a.id)).toEqual([draft.id,judgement.versionId]);
    const queued=await radarJob(db,{...input,preview:JSON.stringify(preview)},false,configured);
    expect(await radarJob(db,{...input,preview:JSON.stringify(preview)},false,configured)).toEqual(queued);
    if(!("batchId" in queued))throw Error("未入队");
    let modelInput:{sources:{id:string}[];priorAssessments:{id:string}[]}|undefined;
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));modelInput=JSON.parse(body.messages[1].content);
      expect(body.messages[0].content).toContain("综合研判");
      return Response.json({choices:[{message:{content:JSON.stringify({conclusions:[{title:"先做小样本验证",facts:"两份资料均记录访谈样本",relevance:"可能存在需求，尚不足以扩张",nextStep:"访谈十位客户后决定是否投入",citations:[first,second].map(i=>({sourceId:i.id,quote:"三个访谈样本"})),evidence:"资料不足",uncertainty:"样本不足",backgroundIds:[],radar:{confidence:"低",confidenceReason:"样本有限",reversibleStep:"限一周访谈",indicator:"有效访谈数",expected:"十个样本",trigger:"无明确需求则停止"}}],gaps:"需要更多样本",changes:"首次综合研判"})}}],usage:{prompt_tokens:50,completion_tokens:80}});
    });vi.stubGlobal("fetch",fetcher);
    await executeResearch(db,(await claimResearch(db))!,{apiKey:"mock"});await publishResearch(db,queued.batchId);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(modelInput?.sources.map(s=>s.id)).toEqual([first.id,second.id]);
    expect(modelInput?.priorAssessments).toHaveLength(2);
    expect(await db.radarRecord.count({where:{kind:"information"}})).toBe(2);
    expect(await db.radarRecord.count({where:{kind:"judgement"}})).toBe(1);expect(await db.action.count()).toBe(0);
    const result=await db.radarRecord.findUniqueOrThrow({where:{id:`radar-analysis-${queued.batchId}-0`}});
    const payload=JSON.parse(result.payload);expect(payload.conclusion.nextStep).toContain("十位客户");expect(payload.conclusion.radar.reversibleStep).toBe("限一周访谈");
    const backup=strategyBackupSchema.parse(await exportStrategy(db));await restoreStrategy(db,backup);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({where:{id:queued.id}})).payload).assessments).toHaveLength(2);
  });
  it("综合研判拒绝资料变更、越权、无效类型及超量，旧任务仍可恢复",async()=>{
    await initializeDaily(db);const info=await information(),draft=await analysis(info.id);
    const input={requestId:crypto.randomUUID(),mode:"analyze",question:"需求是否变化",recordIds:[draft.id]};
    const configured={search:false,ai:true},preview=await radarJob(db,input,true,configured);
    const row=await db.radarRecord.findUniqueOrThrow({where:{id:draft.id}}),p=JSON.parse(row.payload);p.conclusion.nextStep="先调查更多客户";
    await saveRadar(db,"analysis",{requestId:crypto.randomUUID(),id:draft.id,version:1,title:row.title,payload:p});
    await expect(radarJob(db,{...input,preview:JSON.stringify(preview)},false,configured)).rejects.toThrow("资料已变化");
    const topic=await saveRadar(db,"topic",{requestId:crypto.randomUUID(),title:"主题",payload:{question:"关注"}});
    await expect(radarJob(db,{...input,recordIds:[topic.id]},true,configured)).rejects.toThrow("请选择信息卡");
    await expect(radarJob(db,{...input,recordIds:Array(16).fill(info.id)},true,configured)).rejects.toThrow();
    await db.profile.create({data:{id:"foreign-assessment"}});await db.radarRecord.update({where:{id:draft.id},data:{profileId:"foreign-assessment"}});
    await expect(radarJob(db,input,true,configured)).rejects.toThrow("档案");
    await db.radarRecord.update({where:{id:draft.id},data:{profileId}});
    const duplicate=await radarJob(db,{...input,recordIds:[],informationIds:[info.id,info.id]},true,configured);
    expect("sources" in duplicate&&duplicate.sources.length).toBe(1);
  });
  it.each([false, true])("信息、确认、低置信度核实、反馈规则与备份闭环（D1=%s）", async (d1) => {
    cloud = d1; const info = await information(); expect((await information()).id).toBe(info.id);
    const draft = await analysis(info.id), requestId = crypto.randomUUID();
    const judged = await confirmJudgement(db, { id: draft.id, version: 1, requestId });
    expect(await confirmJudgement(db, { id: draft.id, version: 1, requestId })).toEqual(judged);
    const makeResponse = (purpose: string) => saveRadar(db, "response", { requestId: crypto.randomUUID(), title: "核实资料", payload: { judgementVersionId: judged.versionId, purpose, category: "目标", proposal: "追加样本", targetType: "action", standard: "核实十个样本" } });
    const blocked = await makeResponse("respond");
    await expect(confirmResponse(db, { id: blocked.id, version: 1, requestId: crypto.randomUUID() })).rejects.toThrow("核实任务");
    const verify = await makeResponse("verify"), command = { id: verify.id, version: 1, requestId: crypto.randomUUID() };
    const action = await confirmResponse(db, command); expect(await confirmResponse(db, command)).toEqual(action); expect(await db.action.count()).toBe(1);
    const feedback = await saveRadar(db, "verification", { requestId: crypto.randomUUID(), title: "验证", payload: { judgementVersionId: judged.versionId, actual: "样本扩大后需求不成立", outcome: "偏离", effectiveness: "有效", effectEvidence: "及时避免扩大投入", reason: "样本偏差", adjustment: "扩大样本" } });
    const rule = await saveRadar(db, "rule", { requestId: crypto.randomUUID(), title: "样本规则", payload: { verificationId: feedback.id, content: "检查样本覆盖", conditions: "访谈需求判断", exceptions: "不适用于总体统计" } });
    await setRadarStatus(db, { id: rule.id, version: 1, requestId: crypto.randomUUID(), status: "active" });
    expect((await db.radarRecord.findUniqueOrThrow({ where: { id: rule.id } })).status).toBe("active");
    const backup = await (await exportBackup()).json(); expect(backup.data.strategy.radar.length).toBeGreaterThan(5);
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect(await db.action.count()).toBe(1); expect(await db.radarRecord.count({ where: { kind: "verification" } })).toBe(1);
    expect((await (await exportSelf(new Request("http://localhost/api/profile-backup"))).json()).data.strategy.radar).toEqual([]);
  });
  it("信息修改和研判修订生成新快照，旧依据与验证仍保留", async () => {
    const info = await information(), a = await analysis(info.id, "中"), j = await confirmJudgement(db, { id: a.id, version: 1, requestId: crypto.randomUUID() });
    const before = await db.radarRecord.findUniqueOrThrow({ where: { id: j.versionId } });
    const infoRow = await db.radarRecord.findUniqueOrThrow({ where: { id: info.id } }), payload = JSON.parse(infoRow.payload);
    const newInfo = await saveRadar(db, "information", { id: info.id, version: 1, requestId: crypto.randomUUID(), title: "补充后的报告", payload: { ...payload, source: { ...payload.source, content: "三个访谈样本，另补充了七个样本。" } } });
    expect(newInfo.id).not.toBe(info.id);
    const revised = await analysis(newInfo.id, "中", { revisionJudgementId: j.id!, revisionVersion: 1 });
    await confirmJudgement(db, { id: revised.id, version: 1, requestId: crypto.randomUUID() });
    expect((await db.radarRecord.findUniqueOrThrow({ where: { id: j.versionId } })).payload).toBe(before.payload);
    expect((await db.radarRecord.findUniqueOrThrow({ where: { id: j.id! } })).version).toBe(2);
    expect((await dueRadar(db, new URLSearchParams())).rows.some(r => r.id === j.id)).toBe(true);
    await expect(saveRadar(db, "topic", { id: info.id, version: 1, requestId: crypto.randomUUID(), title: "覆盖", payload: { question: "不能覆盖其他类型" } })).rejects.toThrow();
  });
  it("迁移幂等且不重复创建行动，旧链接和自由文本保留", async () => {
    const signal = await saveRecord(db, { kind: "signal", title: "旧研判", payload: { type: "event", facts: "原事实", judgement: "原判断", source: "人工资料", observedAt: "2026-10-04", verification: "待核验" } });
    const action = await db.action.create({ data: { profileId, title: "历史行动" } });
    await db.recordSource.create({ data: { id: crypto.randomUUID(), profileId, sourceType: "signal", sourceId: signal.id, sourceTitle: "旧研判", targetType: "action", targetId: action.id } });
    await importLegacyRadar(db); const count = await db.radarRecord.count(); await importLegacyRadar(db);
    expect(await db.radarRecord.count()).toBe(count); expect(await db.action.count()).toBe(1);
    expect(await db.radarRecord.count({ where: { kind: "history" } })).toBeGreaterThan(0);
    const response = await db.radarRecord.findFirstOrThrow({ where: { kind: "response" } }); expect(JSON.parse(response.payload).targetId).toBe(action.id);
  });
  it("采集任务只收集事实，不调用模型，完成后发布信息卡", async () => {
    await initializeDaily(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: "公开报告", url: "https://example.org/report", content: "原始公开资料" }] }))); vi.stubGlobal("fetch", fetcher);
    const input = { requestId: crypto.randomUUID(), mode: "collect", question: "政策变化", queries: ["政策原文"], days: 30 };
    const preview = await radarJob(db, input, true, { search: true, ai: false });
    const job = await radarJob(db, { ...input, preview: JSON.stringify(preview) }, false, { search: true, ai: false });
    if (!("batchId" in job)) throw new Error("未创建任务");
    const claim = await claimResearch(db); await executeResearch(db, claim!, { tavilyKey: "mock", apiKey: undefined }); await publishResearch(db, job.batchId);
    expect(fetcher.mock.calls).toHaveLength(1); expect(await db.radarRecord.count({ where: { kind: "information" } })).toBe(1); expect(await db.radarRecord.count({ where: { kind: "analysis" } })).toBe(0);
    expect(JSON.parse((await db.radarRecord.findUniqueOrThrow({ where: { id: job.id } })).payload).published).toBe(true);
  });
  it("周期汇总超过100条仍完整，上海周季年边界正确", async () => {
    const info = await information(), a = await analysis(info.id), j = await confirmJudgement(db, { id: a.id, version: 1, requestId: crypto.randomUUID() });
    const original = await db.radarRecord.findUniqueOrThrow({ where: { id: j.versionId } });
    await db.radarRecord.createMany({ data: Array.from({ length: 105 }, (_, i) => radarRecord("judgementVersion", `period-${i}`, `判断${i}`, JSON.parse(original.payload), { createdAt: new Date("2026-10-01T00:00:00+08:00") })) });
    const report = await generateRadarReport(db, { requestId: crypto.randomUUID(), period: "month", day: "2026-10-05" });
    const p = JSON.parse((await db.radarRecord.findUniqueOrThrow({ where: { id: report.id } })).payload);
    expect(p.recordIds.filter((id: string) => id.startsWith("period-"))).toHaveLength(105); expect(p.summary).toHaveLength(5);
    expect(periodRange("week", "2026-01-01").start).toBe("2025-12-29"); expect(periodRange("quarter", "2026-10-05").end).toBe("2027-01-01"); expect(periodRange("year", "2026-10-05").from.toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
  it("跨档案引用与虚假摘录被拒绝，确认中断整体回滚", async () => {
    const info = await information(), a = await analysis(info.id);
    await db.profile.create({ data: { id: "foreign-radar" } });
    await db.radarRecord.update({ where: { id: info.id }, data: { profileId: "foreign-radar" } });
    await expect(analysis(info.id)).rejects.toThrow("档案");
    await db.radarRecord.update({ where: { id: info.id }, data: { profileId } });
    cloud = true; sqlite.exec("CREATE TRIGGER reject_radar_version BEFORE INSERT ON RadarRecord WHEN NEW.kind='judgementVersion' BEGIN SELECT RAISE(ABORT,'reject'); END");
    try { await expect(confirmJudgement(db, { id: a.id, version: 1, requestId: crypto.randomUUID() })).rejects.toThrow(); expect(await db.radarRecord.count({ where: { kind: "judgement" } })).toBe(0); }
    finally { sqlite.exec("DROP TRIGGER reject_radar_version"); }
  });
  it("正式应变关联现有行动，重复确认不复制；非法引用备份恢复前拒绝", async () => {
    const info = await information(), draft = await analysis(info.id, "中");
    const judged = await confirmJudgement(db, { id: draft.id, version: 1, requestId: crypto.randomUUID() });
    const action = await db.action.create({ data: { profileId, title: "已有行动" } });
    const response = await saveRadar(db, "response", { requestId: crypto.randomUUID(), title: "小步验证", payload: { judgementVersionId: judged.versionId, purpose: "respond", category: "项目", proposal: "先验证", targetType: "action" } });
    const result = await confirmResponse(db, { id: response.id, version: 1, requestId: crypto.randomUUID(), existingId: action.id });
    expect(result.id).toBe(action.id); expect(await db.action.count()).toBe(1);
    expect(await confirmResponse(db, { id: response.id, version: 1, requestId: crypto.randomUUID() })).toEqual(result);
    const backup = await (await exportRadar()).json();
    const count = await db.radarRecord.count();
    const broken = structuredClone(backup), item = broken.records.find((r: { kind: string }) => r.kind === "response");
    item.payload = JSON.stringify({ ...JSON.parse(item.payload), judgementVersionId: "foreign-or-missing" });
    expect((await restoreRadar(request(broken))).status).toBe(400); expect(await db.radarRecord.count()).toBe(count);
    expect((await restoreRadar(request(backup))).status).toBe(200); expect(await db.action.count()).toBe(1);
  });
  it("资源接口重复请求、伪造引用、过期修改和本地保存边界", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const context = { params: Promise.resolve({ resource: "topic" }) };
    const input = { requestId: crypto.randomUUID(), title: "本地主题", payload: { question: "关注问题" } };
    const first = await (await radarPost(request(input), context)).json();
    expect(await (await radarPost(request(input), context)).json()).toEqual(first);
    expect((await radarPost(request({ ...input, id: first.id, version: 99 }), context)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const info = await information(), draft = await analysis(info.id);
    const row = await db.radarRecord.findUniqueOrThrow({ where: { id: draft.id } }), p = JSON.parse(row.payload);
    p.conclusion.citations[0].quote = "来源不存在的断言";
    await expect(saveRadar(db, "analysis", { requestId: crypto.randomUUID(), title: "假引用", payload: p })).rejects.toThrow("摘录");
  });
});

describe("愿景能力与资源需求", () => {
  const resourceDemand = (visionId: string) => ({ title: "练习时间", visionId, reason: "每月形成作品", requirements: "每周两小时", importance: "关键", element: "能量", allocation: "两小时", boundary: "不熬夜", expectedReturn: "形成可验收成果", nextStep: "安排练习", timing: "本月" });
  const skillDemand = (visionId: string) => ({ title: "写作", visionId, reason: "作品目标", requirements: "独立成文", channels: "实战", plan: "每周练习", project: { name: "写作练习", description: "产出一篇文章", metric: "反馈通过" }, tasks: [], timing: "本月" });
  it.each([false, true])("需求原子录入、重复确认、补充保留存量及能力证据（D1=%s）", async (d1) => {
    cloud = d1; const wish = await vision();
    const input = { kind: "resource", mode: "new", requestId: "resource-demand", demand: resourceDemand(wish.id) };
    const first = await saveRequirement(db, input);
    expect(await saveRequirement(db, input)).toEqual(first);
    expect(await db.resource.count()).toBe(1);
    expect((await db.resource.findUniqueOrThrow({ where: { id: first.id } })).category).toBe("待获取需求");
    const tagId = `${profileId}:tag:resource:${first.id}`;
    const tagBefore = (await db.strategyRecord.findUniqueOrThrow({ where: { id: tagId } })).payload;
    await saveRequirement(db, { ...input, requestId: "supplement", mode: "supplement", demand: { ...input.demand, match: { type: "resource", id: first.id }, requirements: "改为三小时" } });
    expect((await db.strategyRecord.findUniqueOrThrow({ where: { id: tagId } })).payload).toBe(tagBefore);
    expect((await db.resource.findUniqueOrThrow({ where: { id: first.id } })).description).toContain("改为三小时");
    const evidence = await db.evidence.create({ data: { profileId, ability: "写作", evidence: "已发表一篇" } });
    const skill = await saveRecord(db, { kind: "skill", title: "已有写作", payload: { evidenceId: evidence.id, rating: 4, improvement: "保留的原计划" } });
    const saved = await saveRequirement(db, { kind: "skill", mode: "supplement", requestId: "skill", demand: { ...skillDemand(wish.id), match: { type: "evidence", id: evidence.id } } });
    expect(saved.id).toBe(skill.id);
    const row = await db.strategyRecord.findUniqueOrThrow({ where: { id: skill.id } });
    expect(row.sceneId).toBeNull(); expect(row.title).toBe("已有写作");
    expect(JSON.parse(row.payload)).toMatchObject({ rating: 4, evidenceId: evidence.id });
    expect(JSON.parse(row.payload).improvement).toContain("保留的原计划");
    const full = await (await exportBackup()).json();
    expect((await restoreBackup(request(full))).status).toBe(200);
    expect(await saveRequirement(db, input)).toEqual(first);
  });
  it.each([false, true])("资源标签写入失败整体回滚，不生成空需求（D1=%s）", async (d1) => {
    cloud = d1; const wish = await vision();
    await db.$executeRawUnsafe("CREATE TRIGGER reject_requirement BEFORE INSERT ON StrategyVersion BEGIN SELECT RAISE(ABORT,'reject'); END");
    try {
      await expect(saveRequirement(db, { kind: "resource", mode: "new", requestId: "rollback", demand: resourceDemand(wish.id) })).rejects.toThrow();
      expect(await db.resource.count()).toBe(0); expect(await db.goalBatch.count()).toBe(0); expect(await db.recordSource.count()).toBe(0);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER reject_requirement"); }
  });
  it("直接复用不改内容，拒绝其他档案记录及重复请求变更", async () => {
    const wish = await vision(), resource = await db.resource.create({ data: { profileId, name: "工具", description: "原内容" } });
    const input = { kind: "resource", mode: "reuse", requestId: "reuse", demand: { ...resourceDemand(wish.id), match: { type: "resource", id: resource.id } } };
    await saveRequirement(db, input); await saveRequirement(db, input);
    expect((await db.resource.findUniqueOrThrow({ where: { id: resource.id } })).description).toBe("原内容"); expect(await db.recordSource.count()).toBe(1);
    await expect(saveRequirement(db, { ...input, demand: { ...input.demand, title: "更改" } })).rejects.toThrow("不一致");
    await db.profile.create({ data: { id: "other" } });
    const other = await db.resource.create({ data: { profileId: "other", name: "别人的资源" } });
    await expect(saveRequirement(db, { ...input, requestId: "other", demand: { ...input.demand, match: { type: "resource", id: other.id } } })).rejects.toThrow("不属于");
  });
  it("预览包含目标时间标准和账本，过滤敏感资料、脱敏并阻止过期预览", async () => {
    const wish = await vision();
    const resource = await db.resource.create({ data: { profileId, name: "练习工具 13800138000", description: "固定可用" } });
    await saveRecord(db, { kind: "tag", title: "账本", payload: { subjectType: "resource", subjectId: resource.id, sceneIds: [], ledger: { available: "两套", actualReturn: "已有成果" } } });
    await saveRecord(db, { kind: "skill", title: "敏感能力", sceneId: `${profileId}-scene-1`, payload: { improvement: "私有数据" } });
    const preview = await requirementsContext(db, [wish.id], "", false);
    expect(preview.excluded).toBe(1); expect(JSON.stringify(preview)).not.toContain("私有数据"); expect(JSON.stringify(preview)).not.toContain("13800138000");
    expect(preview.inventory[0].content).toContain("两套"); expect(preview.sources[0].content).toContain("horizon");
    await db.resource.update({ where: { id: resource.id }, data: { description: "变更资料" } });
    const response = await requirementsPlanPost(request({ ids: [wish.id], fingerprint: preview.fingerprint }));
    expect(response.status).toBe(400); expect(fetch).not.toHaveBeenCalled();
    expect(await db.goalBatch.count()).toBe(0);
  });
  it("模型生成仅返回待选草稿，不自动写入能力或资源", async () => {
    const wish = await vision();
    const preview = await requirementsContext(db, [wish.id], "", false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "本月先补齐练习时间", capabilities: [], resources: [resourceDemand(wish.id)], cleanup: [] }) } }] }))));
    const response = await requirementsPlanPost(request({ ids: [wish.id], fingerprint: preview.fingerprint }));
    expect(response.status).toBe(200); expect((await response.json()).resources).toHaveLength(1);
    expect(await db.resource.count()).toBe(0); expect(await db.strategyRecord.count({ where: { kind: "skill" } })).toBe(0);
  });
  it("资源专用规划带入档案并匹配存量，预览和生成不录入", async () => {
    const wish = await vision();
    await db.profile.update({ where: { id: profileId }, data: { education: "工程专业", personalityTraits: "善于归纳", behaviorPatterns: "固定练习", riskPreference: "稳健" } });
    const existing = await db.resource.create({ data: { profileId, name: "练习时间", description: "已有每周一小时" } });
    const previewResponse = await requirementsPlanPost(request({ ids: [wish.id], scope: "resources", previewOnly: true }));
    expect(previewResponse.status).toBe(200); expect(fetch).not.toHaveBeenCalled();
    const preview = await previewResponse.json();
    expect(preview.supporting.find((row: { type: string }) => row.type === "profile").content).toContain("善于归纳");
    const demand = { ...resourceDemand(wish.id), match: { type: "resource", id: existing.id }, matchReason: "已有一小时，需要补充一小时" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "复用现有练习时间", capabilities: [], resources: [demand], cleanup: [] }) } }] }))));
    const response = await requirementsPlanPost(request({ ids: [wish.id], scope: "resources", fingerprint: preview.fingerprint }));
    expect(response.status).toBe(200); expect((await response.json()).resources[0].match.id).toBe(existing.id);
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(sent.messages[0].content).toContain("本轮只规划资源"); expect(sent.messages[1].content).toContain("工程专业");
    expect(await db.resource.count()).toBe(1); expect((await db.resource.findUniqueOrThrow({ where: { id: existing.id } })).description).toBe("已有每周一小时");
    expect(await db.goalBatch.count()).toBe(1);
    const draft = (await (await requirementsDraftGet()).json()).draft;
    expect(draft.result.resources[0].match.id).toBe(existing.id);
    expect(draft.saved).toEqual({}); expect(draft.inventory[0]).not.toHaveProperty("content");
    await saveRequirement(db, { kind: "resource", mode: "reuse", requestId: draft.requestIds["resource:0"], demand });
    expect((await (await requirementsDraftGet()).json()).draft.saved["resource:0"]).toBe("已复用");
    expect((await requirementsDraftDelete()).status).toBe(200);
    expect((await (await requirementsDraftGet()).json()).draft).toBeNull();
    expect(await db.resource.count()).toBe(1);
  });
  it("资源专用规划拒绝能力和清理结果，保留存量", async () => {
    const wish = await vision(), preview = await requirementsContext(db, [wish.id], "", false);
    const resource = await db.resource.create({ data: { profileId, name: "工具", description: "仍有用途" } });
    const current = await requirementsContext(db, [wish.id], "", false);
    expect(current.fingerprint).not.toBe(preview.fingerprint);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "检查", capabilities: [], resources: [], cleanup: [{ target: { type: "resource", id: resource.id }, reason: "本轮未用", suggestion: "本轮暂不需要" }] }) } }] }))));
    const response = await requirementsPlanPost(request({ ids: [wish.id], scope: "resources", fingerprint: current.fingerprint }));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("其他内容");
    expect(await db.resource.count()).toBe(1);
  });
  it("资源规划仍遵循档案字段授权，档案改变使预览失效", async () => {
    const wish = await vision();
    await db.profile.update({ where: { id: profileId }, data: { incomeRange: "私密金额", organization: "未授权机构", personalityTraits: "稳重" } });
    const safe = await requirementsContext(db, [wish.id], "", true);
    expect(JSON.stringify(safe)).not.toContain("私密金额"); expect(JSON.stringify(safe)).not.toContain("未授权机构");
    await db.profile.update({ where: { id: profileId }, data: { sensitiveAiFields: '["incomeRange"]' } });
    const authorized = await requirementsContext(db, [wish.id], "", true);
    expect(JSON.stringify(authorized)).toContain("私密金额"); expect(JSON.stringify(authorized)).not.toContain("未授权机构");
    await db.profile.update({ where: { id: profileId }, data: { personalityTraits: "稳重且注重时间边界" } });
    expect((await requirementsContext(db, [wish.id], "", true)).fingerprint).not.toBe(authorized.fingerprint);
  });
  it("规划带入经历、约束和现有任务，继承敏感场景并校验背景变化", async () => {
    const wish = await saveRecord(db, { kind: "vision", title: "生活节律", sceneId: `${profileId}-scene-3`, payload: { expected: "可持续" } });
    await db.constraint.create({ data: { profileId, name: "时间未知", description: "先核实每周容量" } });
    await db.experience.create({ data: { profileId, title: "历史经验", description: "不等于当前授权" } });
    await db.goal.create({ data: { id: "private-goal", profileId, title: "私人事项", horizon: "本月", sceneId: `${profileId}-scene-3` } });
    await db.project.create({ data: { id: "private-project", profileId, goalId: "private-goal", name: "资料整理" } });
    await db.action.create({ data: { id: "private-action", profileId, projectId: "private-project", title: "核对资料", purpose: "不能外发的明细" } });
    const safe = await requirementsContext(db, [wish.id], "", false);
    expect(safe.supporting.some((row) => row.id === "private-project" || row.id === "private-action")).toBe(false);
    const full = await requirementsContext(db, [wish.id], "", true);
    expect(full.supporting.map((row) => row.type)).toEqual(expect.arrayContaining(["experience", "constraint", "goal", "project", "action"]));
    await db.action.update({ where: { id: "private-action" }, data: { standard: "修改后的验收" } });
    expect((await requirementsContext(db, [wish.id], "", true)).fingerprint).not.toBe(full.fingerprint);
  });
});

describe("总愿景批量拆解", () => {
  it.each([false, true])("资源账本在场景修改和板块备份恢复后保留（D1=%s）", async (d1) => {
    cloud = d1;
    const response = await dataPost(request({ type: "resource", data: { name: "练习时间", _sceneIds: [`${profileId}-scene-0`] } }));
    expect(response.status).toBe(201);
    const resource = await response.json();
    await saveRecord(db, { kind: "tag", title: "资源账本", payload: { subjectType: "resource", subjectId: resource.id, sceneIds: [`${profileId}-scene-0`], ledger: { element: "能量", available: "每周两小时", allocation: "一次练习", adjustment: "改进" } } });
    expect((await dataPatch(request({ type: "resource", id: resource.id, data: { name: "固定练习时间", _sceneIds: [`${profileId}-scene-3`] } }))).status).toBe(200);
    const readLedger = async () => JSON.parse((await db.strategyRecord.findFirstOrThrow({ where: { kind: "tag" } })).payload);
    expect(await readLedger()).toMatchObject({ sceneIds: [`${profileId}-scene-3`], ledger: { element: "能量", available: "每周两小时", adjustment: "改进" } });
    const backup = await (await exportSelf(new Request("http://localhost/api/profile-backup?section=resources"))).json();
    const restored = await restoreSelf(request(backup));
    expect(restored.status).toBe(200);
    expect((await readLedger()).ledger).toMatchObject({ available: "每周两小时", adjustment: "改进" });
  });
  it.each([false, true])("板块备份只恢复所选内容（D1=%s）", async (d1) => {
    cloud = d1;
    await db.experience.create({ data: { id: "exp-section", profileId, title: "经历备份" } });
    await db.resource.create({ data: { id: "res-section", profileId, name: "保留资源" } });
    const response = await exportSelf(new Request("http://localhost/api/profile-backup?section=experiences"));
    const bundle = await response.json();
    expect(bundle.section).toBe("experiences");
    expect(bundle.data.resources).toEqual([]);
    await db.experience.update({ where: { id: "exp-section" }, data: { title: "已修改" } });
    const imported = await restoreSelf(request(bundle));
    expect(imported.status, JSON.stringify(await imported.json())).toBe(200);
    expect((await db.experience.findUniqueOrThrow({ where: { id: "exp-section" } })).title).toBe("经历备份");
    expect((await db.resource.findUniqueOrThrow({ where: { id: "res-section" } })).name).toBe("保留资源");
  });
  it.each([false, true])("批量保存、版本、重复确认及过期草稿（D1=%s）", async (d1) => {
    cloud = d1;
    const scenes = await db.workbenchScene.findMany({ where: { profileId } });
    const drafts = scenes.map((scene) => ({ sceneId: scene.id, payload: { expected: "期望状态", metric: "待确认", horizon: "", boundary: "不透支" }, previousId: null, previousUpdatedAt: null }));
    expect((await saveVisionPlan(db, { scenes: drafts })).saved).toBe(7);
    expect((await saveVisionPlan(db, { scenes: drafts })).saved).toBe(0);
    expect(await db.strategyVersion.count()).toBe(7);
    await expect(saveVisionPlan(db, { scenes: drafts.map((row) => ({ ...row, payload: { ...row.payload, expected: "过期修改" } })) })).rejects.toThrow("发生变化");
    expect(await db.strategyVersion.count()).toBe(7);
  });
  it("拒绝缺场景、重复场景和跨档案场景", async () => {
    expect(() => validateVisionPlan({ scenes: [] }, [])).toThrow();
    const row = { sceneId: "other-profile", payload: { expected: "愿景" }, previousId: null, previousUpdatedAt: null };
    await expect(saveVisionPlan(db, { scenes: [row] })).rejects.toThrow("当前档案");
    await expect(saveVisionPlan(db, { scenes: [row, row] })).rejects.toThrow("不可重复");
    expect(await db.strategyRecord.count()).toBe(0);
  });
  it.each([false, true])("版本写入失败整体回滚（D1=%s）", async (d1) => {
    cloud = d1;
    sqlite.exec(`CREATE TRIGGER reject_vision_version BEFORE INSERT ON StrategyVersion BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    try {
      await expect(saveVisionPlan(db, { scenes: [{ sceneId: `${profileId}-scene-0`, payload: { expected: "新愿景" }, previousId: null, previousUpdatedAt: null }] })).rejects.toThrow();
      expect(await db.strategyRecord.count()).toBe(0);
    } finally { sqlite.exec("DROP TRIGGER reject_vision_version"); }
  });
});

let db: PrismaClient, sqlite: DatabaseSync, directory: string;
let cloud = false;
vi.mock("@/lib/db", () => ({ getDb: async () => db, PROFILE_ID: "local-profile", isCloudflareD1Runtime: () => cloud, ensureProfile: async () => db.profile.findUniqueOrThrow({ where: { id: "local-profile" } }) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { WORKBENCH_DB: {
  prepare: (sql: string) => ({ bind: (...values: Array<string | number | null>) => ({ sql, values }) }),
  batch: async (statements: Array<{ sql: string; values: Array<string | number | null> }>) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try { for (const statement of statements) sqlite.prepare(statement.sql).run(...statement.values); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
} } }) }));
vi.mock("../daily/config", () => ({ dailyAIConfig: () => ({ apiKey: "mock-only", baseUrl: "https://example.invalid", model: "test" }) }));
const request = (data: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const profileId = "local-profile";
const goal = (id = "goal") => db.goal.create({ data: { id, profileId, title: id, horizon: "90天", sceneId: `${profileId}-scene-0` } });
const vision = () => saveRecord(db, { kind: "vision", title: "职业愿景", sceneId: `${profileId}-scene-0`, payload: { expected: "形成可验证成果", metric: "作品数", horizon: "一年", boundary: "保持精力" } });
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "strategy-test-"));
  const database = path.join(directory, "test.db");
  const schema = execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
  sqlite = new DatabaseSync(database); sqlite.exec(schema); sqlite.exec("PRAGMA foreign_keys=ON");
  const deliveryMigration = readFileSync(path.resolve("cloudflare/migrations/0014_delivery_codes.sql"), "utf8");
  sqlite.exec(deliveryMigration.slice(deliveryMigration.indexOf("-- Number allocation")));
  db = new PrismaClient({ datasources: { db: { url: `file:${database.replace(/\\/g, "/")}` } } });
}, 60000);
beforeEach(async () => {
  cloud = false; await db.radarRecord.deleteMany(); await db.profile.deleteMany();
  await db.profile.create({ data: { id: profileId, aiInstruction: { create: {} } } }); await initializeScenes(db);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions: [] }) } }] }))));
});
afterEach(() => { cloud = false; vi.unstubAllGlobals(); });
afterAll(async () => { await db?.$disconnect(); sqlite?.close(); if (directory && directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

describe("拖动任务调整所属项目", () => {
  async function setupMove() {
    await goal("move-goal");
    await db.project.create({ data: { id: "move-from", profileId, name: "原项目" } });
    await db.project.create({ data: { id: "move-to", profileId, name: "目标项目", goalId: "move-goal", sceneId: `${profileId}-scene-0` } });
    await db.action.create({ data: { id: "move-action", profileId, projectId: "move-from", title: "保留任务内容", purpose: "保留目的", standard: "保留标准", status: "已完成", completedAt: new Date("2026-10-15T08:00:00Z"), dueDate: new Date("2026-10-17T00:00:00Z"), recurrence: "weekly", estimatedHours: 1 / 60, sceneId: `${profileId}-scene-1` } });
    return db.action.findUniqueOrThrow({ where: { id: "move-action" } });
  }
  const move = (data: Record<string, unknown> = {}) => strategyPost(request({ action: "action-move", data: { actionId: "move-action", projectId: "move-to", fromProjectId: "move-from", fromParentId: null, ...data } }));
  it.each([false, true])("仅修改归属，保留内容、显式场景、日期、完成状态及每日记录，重复操作不重复创建（D1=%s）", async d1 => {
    const before = await setupMove();
    const plan = await db.dailyPlan.create({ data: { profileId, date: "2026-10-16" } });
    const daily = await db.dailyTask.create({ data: { planId: plan.id, actionId: before.id, title: "历史每日任务", lane: "A", result: "保留结果" } });
    cloud = d1;
    expect((await move()).status).toBe(200);
    const after = await db.action.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toEqual({ ...before, projectId: "move-to", goalId: "move-goal", updatedAt: after.updatedAt });
    expect(await db.dailyTask.findUnique({ where: { id: daily.id } })).toEqual(daily);
    expect(await (await move()).json()).toEqual({ moved: 0 });
    expect(await db.action.count()).toBe(1);
  });
  it.each([false, true])("多级任务一起迁移，移出原父任务，保留内部层级及其他兄弟任务（D1=%s）", async d1 => {
    await setupMove();
    await db.action.create({ data: { id: "old-parent", profileId, projectId: "move-from", title: "原父任务" } });
    await db.action.update({ where: { id: "move-action" }, data: { parentId: "old-parent" } });
    await db.action.create({ data: { id: "move-child", profileId, projectId: "move-from", parentId: "move-action", title: "子任务" } });
    await db.action.create({ data: { id: "move-grandchild", profileId, projectId: "move-from", parentId: "move-child", title: "孙任务" } });
    cloud = d1;
    expect(await (await move({ fromParentId: "old-parent" })).json()).toEqual({ moved: 3 });
    expect(await db.action.findUnique({ where: { id: "move-action" } })).toMatchObject({ projectId: "move-to", goalId: "move-goal", parentId: null });
    expect(await db.action.findUnique({ where: { id: "move-child" } })).toMatchObject({ projectId: "move-to", goalId: "move-goal", parentId: "move-action" });
    expect(await db.action.findUnique({ where: { id: "move-grandchild" } })).toMatchObject({ projectId: "move-to", parentId: "move-child" });
    expect(await db.action.findUnique({ where: { id: "old-parent" } })).toMatchObject({ projectId: "move-from", goalId: null });
  });
  it.each([false, true])("归属过期、跨档案和额外字段拒绝，不改动原任务（D1=%s）", async d1 => {
    const before = await setupMove();
    await db.profile.create({ data: { id: "foreign-move" } });
    await db.project.create({ data: { id: "foreign-move-project", profileId: "foreign-move", name: "外部" } });
    await db.action.create({ data: { id: "foreign-move-action", profileId: "foreign-move", title: "外部" } });
    cloud = d1;
    for (const data of [{ fromProjectId: null }, { projectId: "foreign-move-project" }, { actionId: "foreign-move-action" }, { title: "不允许覆盖" }, { projectId: "missing" }]) {
      expect((await move(data)).status).toBe(400);
      expect(await db.action.findUnique({ where: { id: before.id } })).toEqual(before);
    }
  });
  it.each([false, true])("迁移中途失败时整体回滚（D1=%s）", async d1 => {
    const before = await setupMove();
    await db.action.create({ data: { id: "move-child", profileId, parentId: before.id, projectId: "move-from", title: "子任务" } });
    const child = await db.action.findUniqueOrThrow({ where: { id: "move-child" } });
    sqlite.exec("CREATE TRIGGER reject_action_move BEFORE UPDATE OF projectId ON Action WHEN OLD.id='move-child' BEGIN SELECT RAISE(ABORT, 'test move failure'); END;");
    cloud = d1;
    try {
      expect((await move()).status).toBe(400);
      expect(await db.action.findUnique({ where: { id: before.id } })).toEqual(before);
      expect(await db.action.findUnique({ where: { id: child.id } })).toEqual(child);
    } finally { sqlite.exec("DROP TRIGGER reject_action_move"); }
  });
});

describe("任务周期与分钟投入", () => {
  it.each([false, true])("保存、部分更新、备份与旧格式兼容（D1=%s）", async d1 => {
    cloud = d1;
    for (const recurrence of ["none", "daily", "weekly", "monthly"]) {
      const response = await dataPost(request({ type: "action", data: { title: recurrence, recurrence, estimatedHours: 1 / 60 } }));
      expect(response.status).toBe(201);
      const row = await response.json();
      expect((await dataPatch(request({ type: "action", id: row.id, data: { status: "进行中" } }))).status).toBe(200);
      const stored = await db.action.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored).toMatchObject({ recurrence, status: "进行中" });
      expect(stored.estimatedHours).toBeCloseTo(1 / 60, 12);
    }
    const backup = await (await exportBackup()).json();
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.action.findMany()).map(row => row.recurrence).sort()).toEqual(["daily", "monthly", "none", "weekly"]);
    expect((await db.action.findMany()).every(row => Math.round(row.estimatedHours * 60) === 1)).toBe(true);
    const invalid = structuredClone(backup); invalid.data.actions[0].recurrence = "yearly";
    expect((await restoreBackup(request(invalid))).status).toBe(400);
    expect(await db.action.count()).toBe(4);
    for (const row of backup.data.actions) delete row.recurrence;
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.action.findMany()).every(row => row.recurrence === "none")).toBe(true);
  });
});

describe("项目任务多级从属", () => {
  async function nested(type: "project" | "action") {
    await goal();
    const project = await db.project.create({ data: { id: "p-root", profileId, goalId: "goal", sceneId: `${profileId}-scene-0`, name: "根项目" } });
    const root = type === "project" ? project : await db.action.create({ data: { id: "a-root", profileId, goalId: "goal", projectId: project.id, title: "根任务" } });
    const childResponse = await dataPost(request({ type, data: { parentId: root.id, ...(type === "project" ? { name: "子项目" } : { title: "子任务" }) } }));
    expect(childResponse.status).toBe(201);
    const child = await childResponse.json();
    const leafResponse = await dataPost(request({ type, data: { parentId: child.id, ...(type === "project" ? { name: "孙项目" } : { title: "孙任务" }) } }));
    expect(leafResponse.status).toBe(201);
    return { root, child, leaf: await leafResponse.json() };
  }
  it.each([false, true])("三级创建、继承、防循环、归属和容器校验（D1=%s）", async d1 => {
    cloud = d1;
    const { root, child, leaf } = await nested("project");
    expect(leaf).toMatchObject({ parentId: child.id, goalId: "goal", sceneId: `${profileId}-scene-0` });
    expect((await dataPatch(request({ type: "project", id: root.id, data: { parentId: leaf.id } }))).status).toBe(400);
    expect((await dataPatch(request({ type: "project", id: child.id, data: { goalId: null } }))).status).toBe(400);
    expect((await dataPatch(request({ type: "project", id: root.id, data: { goalId: null } }))).status).toBe(400);
    await db.profile.create({ data: { id: "foreign" } });
    await db.project.create({ data: { id: "foreign-parent", profileId: "foreign", name: "foreign" } });
    expect((await dataPost(request({ type: "project", data: { name: "invalid", parentId: "foreign-parent" } }))).status).toBe(400);
    expect(await db.project.count({ where: { profileId } })).toBe(3);
  });
  it.each([false, true])("子任务状态独立、删除父项保留后代及每日关联防护（D1=%s）", async d1 => {
    cloud = d1;
    const { root, child, leaf } = await nested("action");
    expect(leaf).toMatchObject({ parentId: child.id, goalId: "goal", projectId: "p-root" });
    expect((await dataPatch(request({ type: "action", id: root.id, data: { parentId: leaf.id } }))).status).toBe(400);
    const moved = await db.action.findUniqueOrThrow({ where: { id: child.id } });
    await expect(validateEntityLinks(db, "action", { projectId: null }, moved, false)).rejects.toThrow("父子任务");
    expect((await dataPatch(request({ type: "action", id: leaf.id, data: { status: "已完成" } }))).status).toBe(200);
    expect((await db.action.findUniqueOrThrow({ where: { id: root.id } })).status).toBe("待开始");
    expect((await dataDelete(request({ type: "action", id: child.id }))).status).toBe(200);
    expect((await db.action.findUniqueOrThrow({ where: { id: leaf.id } })).parentId).toBeNull();
  });
  it.each([false, true])("完整备份及同步恢复父子关系，兼容旧备份并拦截循环（D1=%s）", async d1 => {
    cloud = d1; const { root, child, leaf } = await nested("action");
    await db.project.create({ data: { id: "p-child", parentId: "p-root", profileId, goalId: "goal", name: "子项目" } });
    const backup = await (await exportBackup()).json();
    backup.data.actions.reverse(); backup.data.projects.reverse();
    const restored = await restoreBackup(request(backup));
    expect(restored.status, JSON.stringify(await restored.json())).toBe(200);
    expect((await db.action.findUniqueOrThrow({ where: { id: leaf.id } })).parentId).toBe(child.id);
    expect((await db.project.findUniqueOrThrow({ where: { id: "p-child" } })).parentId).toBe("p-root");
    const invalid = structuredClone(backup);
    invalid.data.actions.find((row: { id: string }) => row.id === root.id).parentId = leaf.id;
    expect((await restoreBackup(request(invalid))).status).toBe(400);
    expect(await db.action.count()).toBe(3);
    for (const row of [...backup.data.actions, ...backup.data.projects]) delete row.parentId;
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.action.findUniqueOrThrow({ where: { id: leaf.id } })).parentId).toBeNull();
  });
  it("SQLite与D1增量迁移保留数据、父项删除仅解除从属", () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE Project(id TEXT PRIMARY KEY,profileId TEXT,name TEXT); CREATE TABLE Action(id TEXT PRIMARY KEY,profileId TEXT,title TEXT); INSERT INTO Project VALUES('p','local-profile','kept'); INSERT INTO Action VALUES('a','local-profile','kept')");
      legacy.exec(readFileSync(path.resolve("cloudflare/migrations/0013_execution_hierarchy.sql"), "utf8"));
      legacy.exec("INSERT INTO Action(id,profileId,title,parentId) VALUES('b','local-profile','child','a'); DELETE FROM Action WHERE id='a'");
      expect(legacy.prepare("SELECT name,parentId FROM Project").get()).toMatchObject({ name: "kept", parentId: null });
      expect(legacy.prepare("SELECT title,parentId FROM Action WHERE id='b'").get()).toMatchObject({ title: "child", parentId: null });
    } finally { legacy.close(); }
  });
});

describe("系统场景全局兼容", () => {
  it.each([false, true])("旧六场景升级、再次改名排序、完整与档案备份（D1=%s）", async d1 => {
    cloud = d1;
    await db.workbenchScene.delete({ where: { id: `${profileId}-scene-6` } });
    await db.workbenchScene.update({ where: { id: `${profileId}-scene-0` }, data: { name: "我的工作" } });
    const original = await db.workbenchScene.findMany({ orderBy: { position: "asc" } });
    const migration = readFileSync(path.resolve("cloudflare/migrations/0017_system_scene.sql"), "utf8");
    sqlite.exec(migration); sqlite.exec(migration);
    await initializeScenes(db);
    const scenes = (await strategyView(db)).scenes;
    expect(scenes).toHaveLength(7);
    expect(scenes.filter(row => row.slot !== 6).map(({ id, name, position }) => ({ id, name, position }))).toEqual(original.map(({ id, name, position }) => ({ id, name, position })));
    const system = scenes.find(row => row.slot === 6)!;
    await saveScenes(db, scenes.map(row => ({ ...row, name: row.slot === 6 ? "系统维护" : row.name, position: 6 - row.position })));
    await initializeScenes(db);
    expect((await strategyView(db)).scenes[0]).toMatchObject({ id: system.id, name: "系统维护" });
    await db.goal.create({ data: { id: "system-goal", profileId, title: "维护", sceneId: system.id } });
    await db.project.create({ data: { id: "system-project", profileId, name: "工作流", goalId: "system-goal" } });
    await db.action.create({ data: { id: "system-action", profileId, title: "备份", projectId: "system-project" } });
    const backup = await (await exportBackup()).json();
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.goal.findUniqueOrThrow({ where: { id: "system-goal" } })).sceneId).toBe(system.id);
    expect(resolveScene({ id: "system-action", projectId: "system-project" }, await db.goal.findMany(), await db.project.findMany(), (await strategyView(db)).scenes).effectiveSceneId).toBe(system.id);
    const selfBackup = await (await exportSelf(new Request("http://localhost/api/profile-backup"))).json();
    expect((await restoreSelf(request(selfBackup))).status).toBe(200);
    expect(await db.action.count()).toBe(1);
    const old = await (await exportBackup()).json();
    old.data.strategy.scenes = old.data.strategy.scenes.filter((row: { slot: number }) => row.slot !== 6).map((row: { position: number }) => ({ ...row, position: row.position - 1 }));
    old.data.goals = []; old.data.projects = []; old.data.actions = [];
    expect((await restoreBackup(request(old))).status).toBe(200);
    expect((await strategyView(db)).scenes.find(row => row.slot === 6)?.name).toBe("系统");
    expect((await strategyView(db)).scenes.find(row => row.slot === 0)?.name).toBe("我的工作");
  });
});

describe("总愿景与六场景", () => {
  it("SQLite 与 D1 增量迁移保留旧数据和场景 ID", () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      for (const name of ["0001_init.sql", "0002_goal_hierarchy_and_situation.sql", "0003_daily_collaboration.sql", "0004_five_modules.sql", "0005_self_loop.sql", "0006_trend_research.sql"]) legacy.exec(readFileSync(path.resolve("cloudflare/migrations", name), "utf8"));
      legacy.exec("INSERT INTO Profile(id,updatedAt) VALUES('legacy',0); INSERT INTO WorkbenchScene(id,profileId,slot,name,position,updatedAt) VALUES('stable-work','legacy',0,'职业',0,0); INSERT INTO Action(id,profileId,title,updatedAt) VALUES('kept','legacy','历史行动',0)");
      legacy.exec(readFileSync(path.resolve("cloudflare/migrations/0007_six_scenes.sql"), "utf8"));
      expect(legacy.prepare("SELECT name,position FROM WorkbenchScene WHERE id='stable-work'").get()).toMatchObject({ name: "工作", position: 2 });
      expect(legacy.prepare("SELECT title,sceneId FROM Action WHERE id='kept'").get()).toMatchObject({ title: "历史行动", sceneId: null });
      expect(legacy.prepare("PRAGMA table_info('DailyTask')").all().some((row) => row.name === "sceneId")).toBe(true);
    } finally { legacy.close(); }
  });
  it("旧五场景升级保留ID，新顺序可再次改名排序", async () => {
    await db.workbenchScene.delete({ where: { id: `${profileId}-scene-5` } });
    await db.workbenchScene.update({ where: { id: `${profileId}-scene-0` }, data: { name: "职业" } });
    await goal(); await initializeScenes(db); await initializeScenes(db);
    const scenes = (await strategyView(db)).scenes;
    expect(scenes.map((scene) => scene.name)).toEqual(["健康", "财务", "工作", "家庭", "爱好", "其他", "系统"]);
    expect((await db.goal.findUniqueOrThrow({ where: { id: "goal" } })).sceneId).toBe(`${profileId}-scene-0`);
    await saveScenes(db, scenes.map((scene) => ({ ...scene, name: scene.slot === 5 ? "创作" : scene.name, position: scenes.length - 1 - scene.position })));
    await initializeScenes(db);
    expect((await strategyView(db)).scenes[2].name).toBe("创作");
  });
  it.each([false, true])("总愿景唯一、版本保留、完整及个人备份兼容（D1=%s）", async (d1) => {
    cloud = d1;
    const first = await saveRecord(db, { kind: "overallVision", title: "总愿景", payload: { expected: "稳定且有余力", boundary: "不透支" } });
    const second = await saveRecord(db, { kind: "overallVision", title: "总愿景", payload: { expected: "有余力做喜欢的事", boundary: "不透支" } });
    expect(second.id).toBe(first.id);
    expect(await db.strategyVersion.count({ where: { recordId: first.id } })).toBe(2);
    await expect(saveRecord(db, { id: "someone-else", kind: "overallVision", title: "总愿景", payload: {} })).rejects.toThrow();
    const backup = await (await exportBackup()).json();
    expect((await restoreBackup(request(backup))).status).toBe(200);
    const personal = await (await exportSelf(new Request("http://localhost/api/profile-backup"))).json();
    expect(personal.data.strategy.records.some((row: { kind: string }) => row.kind === "overallVision")).toBe(true);
    expect((await restoreSelf(request(personal))).status).toBe(200);
    expect(await db.strategyRecord.count({ where: { kind: "overallVision" } })).toBe(1);
  });
  it.each([false, true])("行动继承、明确覆盖、每日同步确认、备份恢复（D1=%s）", async (d1) => {
    await initializeDaily(db); cloud = d1;
    const g = await goal();
    const project = await db.project.create({ data: { id: "p", profileId, name: "项目", goalId: g.id, sceneId: `${profileId}-scene-3` } });
    const action = await db.action.create({ data: { id: "a", profileId, title: "行动", projectId: project.id } });
    await importActions(db, "2026-10-02", [action.id]); await importActions(db, "2026-10-02", [action.id]);
    let view = await getDailyView(db, "2026-10-02", {});
    expect(view.plan!.tasks).toHaveLength(1);
    expect(view.plan!.tasks[0]).toMatchObject({ effectiveSceneId: `${profileId}-scene-3`, sceneSource: "project", sceneId: null });
    const task = view.plan!.tasks[0];
    const command = { action: "update-task", id: task.id, title: task.title, notes: "", result: "", priority: 2, dueAt: null, sceneId: `${profileId}-scene-5` };
    expect((await dailyPost(request(command))).status).toBe(400);
    expect((await dailyPost(request({ ...command, confirmActionScene: true }))).status).toBe(200);
    await db.project.update({ where: { id: project.id }, data: { sceneId: `${profileId}-scene-1` } });
    view = await getDailyView(db, "2026-10-02", {});
    expect(view.plan!.tasks[0].effectiveSceneId).toBe(`${profileId}-scene-5`);
    const data = await (await dataGet()).json();
    expect(data.actions[0].effectiveSceneId).toBe(`${profileId}-scene-5`);
    const backup = await (await exportBackup()).json();
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await getDailyView(db, "2026-10-02", {})).plan!.tasks[0].effectiveSceneId).toBe(`${profileId}-scene-5`);
    await db.action.update({ where: { id: action.id }, data: { sceneId: null } });
    await db.project.delete({ where: { id: project.id } });
    expect((await getDailyView(db, "2026-10-02", {})).plan!.tasks[0].effectiveSceneId).toBe(`${profileId}-scene-4`);
  });
  it("独立编排遵循当前场景，错误场景不保存，草稿不生成任务", async () => {
    await initializeDaily(db);
    const scenes = (await strategyView(db)).scenes;
    const result = await orchestrate("散步", "2026-10-02", [], {}, scenes, `${profileId}-scene-3`);
    expect(result.tasks[0].sceneId).toBe(`${profileId}-scene-3`);
    expect(await db.dailyTask.count()).toBe(0);
    await saveTasks(db, "2026-10-02", result.tasks, "", "规则");
    expect((await getDailyView(db, "2026-10-02", {})).sceneCounts.find((row) => row.id === `${profileId}-scene-3`)?.count).toBe(1);
    const invalid = rulePlan("散步", "2026-10-02", []); invalid[0].sceneId = "foreign-scene";
    await expect(saveTasks(db, "2026-10-02", invalid, "", "规则")).rejects.toThrow("场景无效");
  });
  it.each([false, true])("恢复旧五场景备份补齐爱好，不复制行动（D1=%s）", async (d1) => {
    cloud = d1; await goal();
    const backup = await (await exportBackup()).json();
    backup.data.strategy.scenes = backup.data.strategy.scenes.filter((row: { slot: number }) => row.slot !== 5 && row.slot !== 6).map((row: { slot: number; name: string }) => ({ ...row, name: row.slot === 0 ? "职业" : row.name, position: row.slot }));
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await strategyView(db)).scenes.map((row) => row.name)).toEqual(["健康", "财务", "工作", "家庭", "爱好", "其他", "系统"]);
  });
  it("来源场景预填与单场景归属", async () => {
    const wish = await vision();
    const linked = await linkSelfAction(db, { sourceType: "vision", sourceId: wish.id, requestId: crypto.randomUUID(), title: "第一步" });
    const action = await db.action.findUniqueOrThrow({ where: { id: linked.id } });
    expect(action.sceneId).toBe(`${profileId}-scene-0`);
    const scenes = (await strategyView(db)).scenes;
    expect(resolveScene({ id: "a" }, [], [], scenes)).toEqual({ effectiveSceneId: `${profileId}-scene-4`, sceneSource: "default" });
  });
});

describe("趋势研判队列与确认转化", () => {
  const input = () => ({ requestId: crypto.randomUUID(), sceneId: null, question: "公开报告如何影响我的下一步", selected: [], queries: ["公开报告 技能变化"], online: true, days: 30 });
  const modelOutput = { conclusions: [{ title: "技能变化", facts: "报告发布", relevance: "可能影响学习", nextStep: "核实报告", backgroundIds: [], citations: [{ sourceId: "S1", quote: "报告发布" }], evidence: "单一来源", uncertainty: "需阅读全文", change: "新增", radar: { confidence: "中", confidenceReason: "已核对报告原文" } }], gaps: "发布日期未知", changes: "首次研判" };
  async function enqueue(body = input()) { const preview = await previewResearch(db, body); return createResearch(db, { ...body, preview: JSON.stringify(preview) }, { search: true, ai: true }); }
  const mockServices = (badAI = false) => vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("tavily") ? new Response(JSON.stringify({ results: [{ title: "报告", url: "https://example.org/report", content: "报告发布，提及技能变化。" }], usage: { credits: 2 } })) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(badAI ? {} : modelOutput) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }))));
  it("可选择目标项目校准影响，未授权不发送经营资料且禁止越权", async () => {
    await db.goal.create({ data: { id: "radar-goal", profileId, title: "验证业务路径", metric: "三个客户" } });
    await db.project.create({ data: { id: "radar-project", profileId, name: "访谈验证", goalId: "radar-goal", budget: "测试预算", stopCondition: "无支付意愿则暂停" } });
    const selected = [{ type: "goal", id: "radar-goal" }, { type: "project", id: "radar-project" }];
    const hidden = await previewResearch(db, { ...input(), selected });
    expect(JSON.stringify(hidden.background)).not.toContain("测试预算");
    const allowed = await previewResearch(db, { ...input(), selected, allowSensitive: true });
    expect(JSON.stringify(allowed.background)).toContain("无支付意愿则暂停");
    expect(allowed.queries).toEqual(input().queries);
    await db.profile.create({ data: { id: "foreign-radar" } });
    await db.project.create({ data: { id: "foreign-project", profileId: "foreign-radar", name: "不可读取" } });
    await expect(previewResearch(db, { ...input(), selected: [{ type: "project", id: "foreign-project" }], allowSensitive: true })).rejects.toThrow("重新选择");
  });
  it.each([false, true])("雷达低置信度拦截、已转化反馈幂等、备份保留验证（D1=%s）", async (useCloud) => {
    await initializeDaily(db); cloud = useCloud; mockServices();
    const batch = await enqueue(); const claimed = await claimResearch(db);
    await executeResearch(db, claimed!, { apiKey: "test", baseUrl: "https://model.example", model: "test", tavilyKey: "test" });
    const c = JSON.parse((await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } })).conclusions)[0];
    await updateResearch(db, "save-conclusion", { id: batch.id, version: 1, index: 0, conclusion: { ...c, radar: { ...c.radar, confidence: "低" } } });
    const draft = { id: batch.id, version: 2, index: 0, type: "decision", title: "应变", content: "比较方案" };
    await expect(convertResearch(db, draft)).rejects.toThrow("置信度"); expect(await db.decision.count()).toBe(0);
    await updateResearch(db, "save-conclusion", { id: batch.id, version: 2, index: 0, conclusion: c });
    await convertResearch(db, { ...draft, version: 3 });
    const feedback = { id: batch.id, version: 3, index: 0, verification: { id: crypto.randomUUID(), actual: "已核对 https://example.org/report", outcome: "偏离", reason: "样本变化", adjustment: "重新评估", rule: "先核实样本范围" } };
    await updateResearch(db, "verify", feedback); await updateResearch(db, "verify", feedback);
    const saved = await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(saved.version).toBe(4); expect(JSON.parse(saved.conclusions)[0].feedback).toHaveLength(1);
    expect(JSON.parse(saved.conclusions)[0].facts).toBe(c.facts);
    await expect(updateResearch(db, "save-conclusion", { id: batch.id, version: 4, index: 0, conclusion: c })).rejects.toThrow("快照");
    const backup = await (await exportBackup()).json(); expect((await restoreBackup(request(backup))).status).toBe(200);
    expect(JSON.parse((await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } })).conclusions)[0].feedback[0].rule).toBe("先核实样本范围");
  });
  it.each([false, true])("先预览、入队幂等、分阶段结果、确认转化与备份恢复（D1=%s）", async (useCloud) => {
    await initializeDaily(db); cloud = useCloud; mockServices();
    const body = input(), batch = await enqueue(body); expect((await enqueue(body)).id).toBe(batch.id);
    const claims = await Promise.all([claimResearch(db), claimResearch(db), claimResearch(db)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await executeResearch(db, claims.find(Boolean)!, { apiKey: "test", tavilyKey: "test" });
    const searchCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("tavily"));
    const searchBody = JSON.parse(String(searchCall?.[1]?.body));
    expect(searchBody.query).toBe(body.queries[0]); expect(searchBody).not.toHaveProperty("background"); expect(searchBody).not.toHaveProperty("question");
    const saved = await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(saved.status).toBe("review"); expect(saved.phase).toBe(1); expect(JSON.parse(saved.sources)[0].publishedAt).toBeNull();
    const draft = { id: batch.id, version: 1, index: 0, type: "decision", title: "是否调整学习计划", content: "需要比较选项" };
    const decision = await convertResearch(db, draft); expect((await convertResearch(db, draft)).id).toBe(decision.id); expect(await db.decision.count()).toBe(1);
    expect(await db.recordSource.count({ where: { sourceType: "research" } })).toBe(1);
    const backup = await (await exportBackup()).json(); expect(backup.data.strategy.research).toHaveLength(1);
    expect((await (await exportSelf(new Request("http://localhost/api/profile-backup"))).json()).data.strategy.research).toEqual([]);
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("review");
    delete backup.data.strategy.research;
    expect((await restoreBackup(request(backup))).status).toBe(200); expect(await db.researchBatch.count()).toBe(0);
  });
  it("分析失败保留来源，手动重试不重新检索；晚到结果不能覆盖", async () => {
    await initializeDaily(db); mockServices(true); const batch = await enqueue(), claimed = (await claimResearch(db))!;
    await executeResearch(db, claimed, { apiKey: "test", tavilyKey: "test" });
    let saved = await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(saved.status).toBe("failed"); expect(saved.phase).toBe(1); expect(JSON.parse(saved.sources)).toHaveLength(1);
    expect(JSON.parse(saved.calls).find((row: { stage: string }) => row.stage === "分析").promptTokens).toBe(20);
    await updateResearch(db, "retry", { id: batch.id, version: 1 }); mockServices();
    const retry = (await claimResearch(db))!; await executeResearch(db, retry, { apiKey: "test", tavilyKey: "test" });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    await executeResearch(db, claimed, { apiKey: "test", tavilyKey: "test" });
    saved = await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } }); expect(saved.status).toBe("review"); expect(saved.version).toBe(2);
  });
  it("中断需人工重试、运行中不能恢复备份，恢复排队记录暂停", async () => {
    await initializeDaily(db); const batch = await enqueue(); const backup = await (await exportBackup()).json();
    await claimResearch(db); expect((await restoreBackup(request(backup))).status).toBe(400);
    await db.researchBatch.update({ where: { id: batch.id }, data: { leaseUntilSeconds: 0 } });
    expect(await claimResearch(db)).toBeNull(); expect((await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("failed");
    expect((await restoreBackup(request(backup))).status).toBe(200); expect((await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("failed");
  });
  it("背景逐次授权、禁止跨档案、确认前变更需重新预览", async () => {
    await db.profile.update({ where: { id: profileId }, data: { name: "张某", organization: "某公司", stage: "张某的家庭阶段", currentPriorities: "发展方向", sensitiveAiFields: '["currentPriorities"]' } });
    const body = { ...input(), selected: [{ type: "profile", id: "stage" }, { type: "profile", id: "currentPriorities" }], queries: ["张某 某公司 行业"] };
    const hidden = await previewResearch(db, body); expect(JSON.stringify(hidden)).not.toContain("家庭阶段"); expect(JSON.stringify(hidden)).not.toContain("发展方向"); expect(hidden.queries[0]).not.toContain("某公司");
    expect(JSON.stringify(await previewResearch(db, { ...body, allowSensitive: true }))).toContain("家庭阶段");
    await expect(createResearch(db, { ...body, allowSensitive: true, preview: JSON.stringify(hidden) }, { search: true, ai: true })).rejects.toThrow("重新预览");
    await db.profile.create({ data: { id: "other" } });
    const other = await db.resource.create({ data: { profileId: "other", name: "他人资源" } });
    await expect(previewResearch(db, { ...body, selected: [{ type: "resource", id: other.id }] })).rejects.toThrow();
    expect(await db.researchBatch.count()).toBe(0);
    await db.researchBatch.create({ data: { id: "other-batch", profileId: "other", question: "他人问题", background: "[]", queries: "[]" } });
    await expect(updateResearch(db, "retry", { id: "other-batch", version: 1 })).rejects.toThrow("不属于");
  });
  it("没有配置不伪装联网；正文提取失败保留失败来源并允许补充", async () => {
    await initializeDaily(db);
    const body = input(), preview = await previewResearch(db, body);
    await expect(createResearch(db, { ...body, preview: JSON.stringify(preview) }, { search: false, ai: true })).rejects.toThrow("TAVILY_API_KEY");
    const manual = { ...body, online: false, queries: [], manual: [{ title: "公开链接", url: "https://example.org/report" }] };
    const batch = await createResearch(db, { ...manual, preview: JSON.stringify(await previewResearch(db, manual)) }, { search: false, ai: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test timeout")));
    await executeResearch(db, (await claimResearch(db))!, { apiKey: "test" });
    const saved = await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(saved.status).toBe("failed"); expect(JSON.parse(saved.sources)[0].quality).toBe("failed");
    await updateResearch(db, "supplement", { id: batch.id, version: 1, sourceId: "M1", content: "粘贴的原文" });
    expect(JSON.parse((await db.researchBatch.findUniqueOrThrow({ where: { id: batch.id } })).sources)[0].content).toBe("粘贴的原文");
  });
  it("D1 转化失败整体回滚，不留下未关联的决策", async () => {
    await initializeDaily(db); mockServices(); const batch = await enqueue();
    await executeResearch(db, (await claimResearch(db))!, { apiKey: "test", tavilyKey: "test" });
    cloud = true;
    sqlite.exec('CREATE TRIGGER reject_research_link BEFORE INSERT ON RecordSource BEGIN SELECT RAISE(ABORT, "test failure"); END');
    await expect(convertResearch(db, { id: batch.id, index: 0, version: 1, type: "decision", title: "需要回滚", content: "测试" })).rejects.toThrow();
    sqlite.exec('DROP TRIGGER reject_research_link');
    expect(await db.decision.count()).toBe(0); expect(await db.recordSource.count()).toBe(0);
  });
});

describe("认识自己轻量闭环", () => {
  it.each([false, true])("行动和来源原子保存、重试幂等、共享复盘与回写（D1=%s）", async (useCloud) => {
    const wish = await vision();
    const resource = await db.resource.create({ data: { profileId, name: "每周两小时" } });
    cloud = useCloud;
    const input = { requestId: crypto.randomUUID(), sourceType: "vision", sourceId: wish.id, title: "做一次访谈", standard: "形成摘要" };
    const action = await linkSelfAction(db, input);
    expect((await linkSelfAction(db, input)).id).toBe(action.id);
    expect(await db.action.count()).toBe(1); expect(await db.recordSource.count()).toBe(1);
    await linkSelfAction(db, { ...input, requestId: crypto.randomUUID(), sourceType: "resource", sourceId: resource.id, actionId: action.id });
    expect(await db.action.count()).toBe(1);
    await expect(saveSelfReview(db, { actionId: action.id, result: "完成访谈" })).rejects.toThrow("完成行动");
    await db.action.update({ where: { id: action.id }, data: { status: "已完成" } });
    await saveSelfReview(db, { actionId: action.id, result: "完成访谈", adjustment: "增加追问" });
    await saveSelfReview(db, { actionId: action.id, result: "完成访谈并整理摘要", adjustment: "增加追问" });
    expect(await db.selfActionReview.count()).toBe(1);
    const update = { sourceType: "vision", sourceId: wish.id, actionId: action.id, mode: "evidence", title: "访谈", content: "已完成一次访谈" };
    const applied = await applySelfUpdate(db, update);
    expect((await applySelfUpdate(db, update)).targetId).toBe(applied.targetId);
    expect(await db.evidence.count()).toBe(1);
    const full = await (await exportBackup()).json();
    expect((await restoreBackup(request(full))).status).toBe(200);
    expect(await db.selfActionReview.count()).toBe(1);
    const ownBackup = await (await exportSelf(new Request("http://localhost/api/profile-backup"))).json();
    expect(ownBackup.data.strategy.selfReviews).toEqual([]); expect(ownBackup.data.strategy.sources).toEqual([]);
    expect((await restoreSelf(request(ownBackup))).status).toBe(200);
    expect(await db.action.count()).toBe(1); expect(await db.evidence.count()).toBe(1);
    delete full.data.strategy.selfReviews;
    expect((await restoreBackup(request(full))).status).toBe(200);
    expect(await db.selfActionReview.count()).toBe(0);
  });
  it.each([false, true])("经历转证据保留一次结果，技能自评可空，原记录更新保留评分（D1=%s）", async (useCloud) => {
    const experience = await db.experience.create({ data: { profileId, title: "完成访谈", description: "访谈摘要" } });
    cloud = useCloud;
    const update = { sourceType: "experience", sourceId: experience.id, mode: "evidence", title: "访谈能力", content: "有摘要" };
    const result = await applySelfUpdate(db, update); await applySelfUpdate(db, update);
    expect(await db.evidence.count()).toBe(1);
    const skill = await saveRecord(db, { kind: "skill", title: "访谈能力", payload: { evidenceId: result.targetId, improvement: "练习追问" } });
    expect(JSON.parse((await db.strategyRecord.findUniqueOrThrow({ where: { id: skill.id } })).payload).rating).toBeNull();
    const action = await linkSelfAction(db, { requestId: crypto.randomUUID(), sourceType: "skill", sourceId: skill.id, title: "练习一次" });
    await db.action.update({ where: { id: action.id }, data: { status: "已完成" } });
    await saveSelfReview(db, { actionId: action.id, result: "更有条理" });
    const original = await db.strategyRecord.findUniqueOrThrow({ where: { id: skill.id } });
    await expect(applySelfUpdate(db, { sourceType: "skill", sourceId: skill.id, actionId: action.id, mode: "source", title: "访谈", content: "进一步练习", expectedUpdatedAt: "2000-01-01" })).rejects.toThrow("已变化");
    await applySelfUpdate(db, { sourceType: "skill", sourceId: skill.id, actionId: action.id, mode: "source", title: "访谈", content: "进一步练习", expectedUpdatedAt: original.updatedAt.toISOString() });
    expect(JSON.parse((await db.strategyRecord.findUniqueOrThrow({ where: { id: skill.id } })).payload)).toMatchObject({ rating: null, improvement: "进一步练习" });
  });
  it("AI 验收与确认回写之前禁止提前完成和复盘", async () => {
    const wish = await vision(), action = await linkSelfAction(db, { requestId: crypto.randomUUID(), sourceType: "vision", sourceId: wish.id, title: "AI 整理" });
    const plan = await db.dailyPlan.create({ data: { profileId, date: "2026-10-02" } });
    const task = await db.dailyTask.create({ data: { planId: plan.id, actionId: action.id, title: "AI 整理", lane: "B", steps: { create: { position: 0, title: "整理", assignee: "ai", status: "review" } } } });
    expect((await dataPatch(request({ type: "action", id: action.id, data: { status: "已完成" } }))).status).toBe(400);
    await db.dailyStep.updateMany({ where: { taskId: task.id }, data: { status: "done", result: "已整理" } });
    expect((await dataPatch(request({ type: "action", id: action.id, data: { status: "已完成" } }))).status).toBe(400);
    await syncAction(db, task.id);
    await saveSelfReview(db, { actionId: action.id, result: "已核验" });
    expect(await db.selfActionReview.count()).toBe(1);
  });
  it("校验归属，删除来源不删除行动复盘，回写失败不留下部分记录", async () => {
    const wish = await vision(), action = await linkSelfAction(db, { requestId: crypto.randomUUID(), sourceType: "vision", sourceId: wish.id, title: "测试行动" });
    await db.action.update({ where: { id: action.id }, data: { status: "已完成" } });
    await saveSelfReview(db, { actionId: action.id, result: "完成" });
    await db.profile.create({ data: { id: "other" } });
    const other = await db.resource.create({ data: { profileId: "other", name: "别人的资源" } });
    await expect(linkSelfAction(db, { requestId: crypto.randomUUID(), sourceType: "resource", sourceId: other.id, title: "不能读" })).rejects.toThrow();
    cloud = true;
    sqlite.exec('CREATE TRIGGER reject_self_evidence BEFORE INSERT ON Evidence BEGIN SELECT RAISE(ABORT, "test failure"); END');
    await expect(applySelfUpdate(db, { sourceType: "vision", sourceId: wish.id, actionId: action.id, mode: "evidence", title: "证据", content: "完成" })).rejects.toThrow();
    sqlite.exec('DROP TRIGGER reject_self_evidence');
    expect(await db.evidence.count()).toBe(0); expect((await db.selfActionReview.findFirstOrThrow()).applied).toBe("[]");
    await db.strategyRecord.delete({ where: { id: wish.id } });
    expect(await db.action.count()).toBe(1); expect(await db.selfActionReview.count()).toBe(1);
  });
  it("增量迁移保留既有记录", () => {
    const legacy = new DatabaseSync(path.join(directory, "self-migration.db"));
    try {
      for (const file of ["0001_init.sql", "0002_goal_hierarchy_and_situation.sql", "0003_daily_collaboration.sql", "0004_five_modules.sql"]) legacy.exec(readFileSync(path.resolve("cloudflare/migrations", file), "utf8"));
      legacy.exec("INSERT INTO Profile(id,updatedAt) VALUES('legacy',0)");
      legacy.exec(readFileSync(path.resolve("cloudflare/migrations/0005_self_loop.sql"), "utf8"));
      expect(legacy.prepare('SELECT count(*) AS n FROM Profile').get()?.n).toBe(1);
      expect(legacy.prepare('SELECT count(*) AS n FROM SelfActionReview').get()?.n).toBe(0);
    } finally { legacy.close(); }
  });
});

describe("目标生成子目标与项目", () => {
  const draft = () => goalProjectDraft.parse({ summary: "通过有限试点验证阶段成果", gaps: ["核实可用时间及真实授权"], goals: [{ title: "形成验证成果", description: "支持上级目标的阶段结果", metric: "完成一份试点验收报告", horizon: "本月", deadline: null,
    projects: [{ name: "小范围验证", deliverable: "试点报告", metric: "报告含事实及验收记录", firstStep: "核对资料与授权", estimatedHours: 8, capabilities: ["访谈"], resources: ["资料待核实"], budget: "待核实", boundary: "只使用已授权资料", risk: "缺少样本", stopCondition: "无法取得授权则停止", milestones: [{ title: "核实准备", metric: "形成授权与资料清单", deadline: null }] }] }] });
  const setup = async () => {
    await goal(); const input = { goalId: "goal", weeklyHours: 2 };
    return { requestId: "goal-project-request", input, fingerprint: (await goalProjectContext(db, input)).fingerprint, draft: draft() };
  };
  it("真实AI接口只生成草稿，未配置或非法响应不能伪装成果", async () => {
    const body = await setup();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(draft()) } }] })));
    const generated = await generateGoalProjects(db, { input: body.input, fingerprint: body.fingerprint });
    expect(generated.goals[0].projects[0].firstStep).toBe("核对资料与授权");
    expect(await db.goal.count()).toBe(1); expect(await db.project.count()).toBe(0); expect(await db.goalBatch.count()).toBe(0);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).model).toBe("deepseek-reasoner");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"goals":[]}' } }] })));
    await expect(generateGoalProjects(db, { input: body.input, fingerprint: body.fingerprint })).rejects.toThrow();
    expect(await db.project.count()).toBe(0);
  });
  it.each([false, true])("确认原子创建、继承场景和愿景、幂等并发、不启动执行（D1=%s）", async (d1) => {
    cloud = d1; const body = await setup();
    // WAL lets the SQLite-backed D1 fixture overlap reads and atomic batch commits.
    if (d1) sqlite.exec("PRAGMA journal_mode=WAL");
    const wish = await vision(); await db.goal.update({ where: { id: "goal" }, data: { visionId: wish.id } });
    body.fingerprint = (await goalProjectContext(db, body.input)).fingerprint;
    const results = await Promise.allSettled([saveGoalProjects(db, body), saveGoalProjects(db, body)]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    expect(await db.goal.count()).toBe(2); expect(await db.project.count()).toBe(1); expect(await db.milestone.count()).toBe(1); expect(await db.action.count()).toBe(0);
    const child = await db.goal.findFirstOrThrow({ where: { parentId: "goal" } });
    const project = await db.project.findFirstOrThrow();
    expect(child).toMatchObject({ status: "待开始", sceneId: `${profileId}-scene-0`, visionId: wish.id });
    expect(project).toMatchObject({ status: "待开始", goalId: child.id, sceneId: child.sceneId, visionId: wish.id });
    expect(project.description).toContain("第一步：核对资料与授权");
    expect((await saveGoalProjects(db, body)).duplicate).toBe(true);
    const restored = await (await exportBackup()).json(); expect((await restoreBackup(request(restored))).status).toBe(200);
    expect((await saveGoalProjects(db, body)).duplicate).toBe(true);
    await expect(saveGoalProjects(db, { ...body, draft: { ...body.draft, summary: "修改" } })).rejects.toThrow("不一致");
  });
  it("校验不通过的AI草稿保留，修正后才可确认保存", async () => {
    const body = await setup(), invalid = draft(); invalid.goals[0].horizon = "1年";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] })));
    const generated = await generateGoalProjects(db, { input: body.input, fingerprint: body.fingerprint });
    expect(generated.warning).toContain("长于");
    await expect(saveGoalProjects(db, { ...body, requestId: generated.requestId, draft: generated })).rejects.toThrow("长于");
    generated.goals[0].horizon = "本月";
    expect(await saveGoalProjects(db, { ...body, requestId: generated.requestId, draft: generated })).toMatchObject({ goals: 1, projects: 1 });
  });
  it.each([false, true])("创建项目失败时不留下子目标、里程碑及请求标记（D1=%s）", async (d1) => {
    cloud = d1; const body = await setup();
    await db.$executeRawUnsafe("CREATE TRIGGER reject_project BEFORE INSERT ON Project BEGIN SELECT RAISE(ABORT,'reject'); END");
    try { await expect(saveGoalProjects(db, body)).rejects.toThrow(); expect(await db.goal.count()).toBe(1); expect(await db.project.count()).toBe(0); expect(await db.milestone.count()).toBe(0); expect(await db.goalBatch.count()).toBe(0); }
    finally { await db.$executeRawUnsafe("DROP TRIGGER reject_project"); }
  });
  it("周期、容量、日期、重复与过期草稿均校验", async () => {
    const body = await setup(), parent = await db.goal.findUniqueOrThrow({ where: { id: "goal" } });
    expect(() => validateGoalProjects({ ...body.draft, goals: body.draft.goals.map(row => ({ ...row, horizon: "1年" })) }, parent, 2, "2026-10-08")).toThrow("长于");
    expect(() => validateGoalProjects(body.draft, parent, 0.1, "2026-10-08")).toThrow("可用时间");
    const invalid = draft(); invalid.goals[0].projects[0].milestones[0].deadline = "2026-10-01";
    expect(() => validateGoalProjects(invalid, parent, 2, "2026-10-08")).toThrow("里程碑");
    expect(() => validateGoalProjects({ ...body.draft, goals: [...body.draft.goals, ...body.draft.goals] }, parent, 2, "2026-10-08")).toThrow("重复");
    await db.goal.update({ where: { id: "goal" }, data: { metric: "已有目标变化" } });
    await expect(saveGoalProjects(db, body)).rejects.toThrow("变化"); expect(await db.project.count()).toBe(0);
  });
  it("敏感内容须授权，跨档案拒绝，排除项目不保存", async () => {
    const body = await setup(); await db.goal.update({ where: { id: "goal" }, data: { description: "公司资料 13800138000" } });
    const context = await goalProjectContext(db, body.input); expect(context.blocked).toBe(true);
    await expect(generateGoalProjects(db, { input: body.input, fingerprint: context.fingerprint })).rejects.toThrow("授权"); expect(fetch).not.toHaveBeenCalled();
    const allowed = await goalProjectContext(db, { ...body.input, allowSensitive: true }); expect(allowed.records[0].content).toContain("手机号已脱敏");
    expect(JSON.stringify(allowed.records)).not.toContain("13800138000");
    await db.profile.create({ data: { id: "foreign" } }); await db.goal.create({ data: { id: "foreign-goal", profileId: "foreign", title: "foreign" } });
    await expect(goalProjectContext(db, { goalId: "foreign-goal" })).rejects.toThrow("档案");
    body.fingerprint = context.fingerprint; const excluded = draft().goals[0].projects[0]; excluded.selected = false;
    body.draft.goals[0].projects.push(excluded); await saveGoalProjects(db, body); expect(await db.project.count()).toBe(1);
  });
  it("现有同名目标或项目需要人工处理，不能重复录入", async () => {
    const body = await setup();
    await db.goal.create({ data: { profileId, parentId: "goal", title: body.draft.goals[0].title } });
    body.fingerprint = (await goalProjectContext(db, body.input)).fingerprint;
    await expect(saveGoalProjects(db, body)).rejects.toThrow("同名子目标"); expect(await db.project.count()).toBe(0);
    body.draft.goals[0].title = "调整后的阶段目标";
    await db.project.create({ data: { profileId, goalId: "goal", name: body.draft.goals[0].projects[0].name } });
    body.fingerprint = (await goalProjectContext(db, body.input)).fingerprint;
    await expect(saveGoalProjects(db, body)).rejects.toThrow("同名项目"); expect(await db.goalBatch.count()).toBe(0);
  });
});

describe("五模块关联与保存", () => {
  it("SQLite 增量迁移保留历史数据并兼容 D1 迁移链", () => {
    const legacy = new DatabaseSync(path.join(directory, "migration.db"));
    try {
      for (const file of ["0001_init.sql", "0002_goal_hierarchy_and_situation.sql", "0003_daily_collaboration.sql"]) legacy.exec(readFileSync(path.resolve("cloudflare/migrations", file), "utf8"));
      legacy.exec("INSERT INTO Profile(id,updatedAt) VALUES('legacy',0); INSERT INTO Goal(id,profileId,title,updatedAt) VALUES('historical','legacy','unchanged',0)");
      legacy.exec(readFileSync(path.resolve("cloudflare/migrations/0004_five_modules.sql"), "utf8"));
      expect(legacy.prepare("SELECT title, sceneId FROM Goal WHERE id='historical'").get()).toMatchObject({ title: "unchanged", sceneId: null });
    } finally { legacy.close(); }
  });
  it("场景改名和换序保留稳定 ID 与历史关联", async () => {
    const parent = await goal(), scenes = (await strategyView(db)).scenes;
    await saveScenes(db, scenes.map((scene) => ({ ...scene, name: scene.slot === 0 ? "事业" : scene.name, position: scenes.length - 1 - scene.position })));
    expect((await db.goal.findUniqueOrThrow({ where: { id: parent.id } })).sceneId).toBe(scenes.find((scene) => scene.slot === 0)?.id);
    expect((await strategyView(db)).scenes.find((scene) => scene.slot === 0)?.name).toBe("事业");
    await expect(saveScenes(db, scenes.slice(1))).rejects.toThrow();
  });
  it("历史目标保持理想国，行动只继承已记录关联", async () => {
    const old = await db.goal.create({ data: { profileId, title: "历史目标" } });
    expect(effectiveScene({ id: "a", goalId: old.id }, [old])).toBeNull();
    expect(effectiveScene({ id: "a", projectId: "p" }, [old], [{ id: "p", goalId: old.id, sceneId: "health" }])).toBe("health");
  });
  it("项目继承场景和愿景，跨场景必须确认且愿景必须一致", async () => {
    const parent = await goal(), wish = await vision();
    await db.goal.update({ where: { id: parent.id }, data: { visionId: wish.id } });
    const values: Record<string, unknown> = { goalId: parent.id };
    await validateEntityLinks(db, "project", values, null, false);
    expect(values).toMatchObject({ sceneId: parent.sceneId, visionId: wish.id });
    const cross = { goalId: parent.id, sceneId: `${profileId}-scene-1` };
    await expect(validateEntityLinks(db, "project", cross, null, false)).rejects.toThrow("确认");
    await validateEntityLinks(db, "project", cross, null, true);
    await expect(validateEntityLinks(db, "project", { ...cross, visionId: wish.id }, null, true)).rejects.toThrow("愿景");
  });
  it("禁止自关联、层级循环和其他 Profile 的引用", async () => {
    await goal("one"); await goal("two");
    await db.goal.update({ where: { id: "two" }, data: { parentId: "one" } });
    await expect(validateEntityLinks(db, "goal", { parentId: "two" }, { id: "one" }, false)).rejects.toThrow("循环");
    await db.profile.create({ data: { id: "other" } });
    await db.goal.create({ data: { id: "foreign", profileId: "other", title: "foreign" } });
    await expect(own(db, "goal", "foreign")).rejects.toThrow("档案");
    await expect(saveRelation(db, { fromId: "one", toId: "one", kind: "conflict" })).rejects.toThrow();
  });
  it("目标从属保存校验领域与周期，旧关系可继续编辑内容", async () => {
    await goal("parent"); await goal("child");
    await db.goal.update({ where: { id: "parent" }, data: { horizon: "1年" } });
    const child = await db.goal.findUniqueOrThrow({ where: { id: "child" } });
    await validateEntityLinks(db, "goal", { parentId: "parent" }, child, false);
    await expect(validateEntityLinks(db, "goal", { parentId: "parent", horizon: "年度" }, child, false)).rejects.toThrow("长于");
    await expect(validateEntityLinks(db, "goal", { parentId: "parent", sceneId: `${profileId}-scene-1` }, child, false)).rejects.toThrow("场景不同");
    await db.goal.update({ where: { id: "child" }, data: { parentId: "parent", sceneId: `${profileId}-scene-1` } });
    const legacy = await db.goal.findUniqueOrThrow({ where: { id: "child" } });
    await validateEntityLinks(db, "goal", { title: "编辑原内容" }, legacy, false);
    const parent = await db.goal.findUniqueOrThrow({ where: { id: "parent" } });
    await expect(validateEntityLinks(db, "goal", { horizon: "本月" }, parent, false)).rejects.toThrow("子目标");
    const inherited: Record<string, unknown> = { title: "新子目标", parentId: "parent", horizon: "本周" };
    await validateEntityLinks(db, "goal", inherited, null, false);
    expect(inherited.sceneId).toBe(`${profileId}-scene-0`);
  });
  it("目标仅接受一个主场景，空场景兼容归入其他且不能越权引用", async () => {
    const values: Record<string, unknown> = { title: "独立目标", horizon: "1年", sceneId: null };
    await validateEntityLinks(db, "goal", values, null, false);
    expect(values.sceneId).toBe(`${profileId}-scene-4`);
    expect(() => parseEntity("goal", { title: "多场景目标", sceneId: [`${profileId}-scene-0`, `${profileId}-scene-1`] })).toThrow();
    await expect(validateEntityLinks(db, "goal", { title: "无效场景", sceneId: "foreign-scene" }, null, false)).rejects.toThrow("场景无效");
    const parent = await goal("scene-parent");
    const child: Record<string, unknown> = { title: "继承场景", parentId: parent.id, horizon: "本周" };
    await validateEntityLinks(db, "goal", child, null, false);
    expect(child.sceneId).toBe(parent.sceneId);
  });
  it("冲突关系对称去重，依赖保留方向", async () => {
    await goal("a"); await goal("b");
    await saveRelation(db, { fromId: "b", toId: "a", kind: "conflict", evidence: "时间冲突" });
    await saveRelation(db, { fromId: "a", toId: "b", kind: "conflict", evidence: "补充依据" });
    expect(await db.goalRelation.count()).toBe(1);
    expect(canonicalRelation("b", "a", "depend")).toEqual({ fromId: "b", toId: "a" });
  });
  it("原子分解并发与重复请求不会重复创建", async () => {
    await goal();
    const batch = { requestId: "batch", parentId: "goal", goals: [{ title: "子目标", horizon: "本周" }] };
    await Promise.all([saveGoalBatch(db, batch), saveGoalBatch(db, batch)]);
    expect(await db.goal.count()).toBe(2);
    expect((await db.goal.findFirstOrThrow({ where: { parentId: "goal" } })).sceneId).toBe(`${profileId}-scene-0`);
    await expect(saveGoalBatch(db, { ...batch, goals: [{ title: "changed", horizon: "本周" }] })).rejects.toThrow("不一致");
    await expect(saveGoalBatch(db, { ...batch, requestId: "bad", goals: [{ title: "层级错误", horizon: "5年" }] })).rejects.toThrow("层级");
  });
  it("分解中途失败回滚所有子目标和幂等标记", async () => {
    await goal();
    await db.$executeRawUnsafe("CREATE TRIGGER reject_child BEFORE INSERT ON Goal WHEN NEW.title='reject' BEGIN SELECT RAISE(ABORT,'reject'); END");
    try {
      await expect(saveGoalBatch(db, { requestId: "fail", parentId: "goal", goals: [{ title: "first", horizon: "本周" }, { title: "reject", horizon: "本周" }] })).rejects.toThrow();
      expect(await db.goal.count()).toBe(1); expect(await db.goalBatch.count()).toBe(0);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER reject_child"); }
  });
  it("归档保留愿景版本，修改保存完整快照", async () => {
    const wish = await vision();
    await saveRecord(db, { id: wish.id, kind: "vision", sceneId: `${profileId}-scene-0`, title: "旧愿景", payload: {}, archived: true });
    expect(await db.strategyVersion.count()).toBe(2);
    expect((await db.strategyRecord.findUniqueOrThrow({ where: { id: wish.id } })).archived).toBe(true);
  });
  it("字段白名单禁止修改归属和只读属性", () => {
    expect(() => parseEntity("goal", { profileId: "other" })).toThrow();
    expect(() => parseEntity("decisionOption", { updatedAt: new Date() })).toThrow();
  });
  it.each([false, true])("档案字段和标签同时原子保存，中途失败不产生半条记录（D1=%s）", async (useCloud) => {
    cloud = useCloud;
    const valid = { type: "evidence", data: { ability: "执行", evidence: "验收成果", _sceneIds: [`${profileId}-scene-0`] } };
    const response = await dataPost(request(valid)); expect(response.status).toBe(201);
    const row = await response.json();
    const update = await dataPatch(request({ type: "evidence", id: row.id, data: { ability: "交付", _sceneIds: [`${profileId}-scene-3`] } }));
    expect(update.status).toBe(200);
    expect(JSON.parse((await db.strategyRecord.findFirstOrThrow({ where: { kind: "tag" } })).payload).sceneIds).toEqual([`${profileId}-scene-3`]);
    await db.$executeRawUnsafe("CREATE TRIGGER reject_tag BEFORE INSERT ON StrategyRecord WHEN NEW.kind='tag' BEGIN SELECT RAISE(ABORT,'reject tag'); END");
    try { expect((await dataPost(request(valid))).status).toBe(400); expect(await db.evidence.count()).toBe(1); }
    finally { await db.$executeRawUnsafe("DROP TRIGGER reject_tag"); }
  });
  it("原本周态势保存生成完整变化日志", async () => {
    const first = await dataPost(request({ type: "situationAssessment", data: { todayStatus: "旧状态" } })); expect(first.status).toBe(201);
    const second = await dataPatch(request({ type: "situationAssessment", data: { todayStatus: "新状态" } })); expect(second.status).toBe(200);
    const versions = await db.strategyVersion.findMany({ where: { kind: "assessment" } });
    expect(versions.map((version) => JSON.parse(version.snapshot).payload.todayStatus).sort()).toEqual(["旧状态", "新状态"].sort());
  });
  it("批量跨场景归类被拒绝，确认后才写入", async () => {
    await goal(); await db.project.create({ data: { id: "p", profileId, goalId: "goal", name: "p", sceneId: `${profileId}-scene-0` } });
    const data = [{ type: "project", id: "p", sceneId: `${profileId}-scene-1` }];
    expect((await strategyPost(request({ action: "classify", data }))).status).toBe(400);
    expect((await strategyPost(request({ action: "classify", data: data.map((row) => ({ ...row, crossSceneConfirmed: true })) }))).status).toBe(200);
  });
});

describe("优先事项、备份与 AI 边界", () => {
  it.each([false, true])("项目任务编号和交付日期在备份恢复后保持一致，兼容旧备份（D1=%s）", async useCloud => {
    const projectResponse = await dataPost(request({ type: "project", data: { name: "交付项目", deadline: "2026-12-31" } }));
    const project = await projectResponse.json();
    expect(projectResponse.status).toBe(201);
    expect(project.recordCode).toMatch(/^\d{8}A\d{2,}$/);
    const actionResponse = await dataPost(request({ type: "action", data: { title: "交付任务", projectId: project.id, dueDate: "2026-11-01" } }));
    const action = await actionResponse.json();
    expect(actionResponse.status).toBe(201);
    expect(action.recordCode).toMatch(/^\d{8}B\d{2,}$/);
    const backup = await (await exportBackup()).json();
    cloud = useCloud;
    expect((await restoreBackup(request(backup))).status).toBe(200);
    const restored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(restored.recordCode).toBe(project.recordCode);
    expect(restored.deadline?.toISOString().slice(0,10)).toBe("2026-12-31");
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).recordCode).toBe(action.recordCode);
    for (const rows of [backup.data.projects, backup.data.actions]) for (const row of rows) delete row.recordCode;
    for (const row of backup.data.projects) delete row.deadline;
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).recordCode).toMatch(/^\d{8}A\d{2,}$/);
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).dueDate?.toISOString().slice(0,10)).toBe("2026-11-01");
  });
  it("三项优先排序遵守上海日期，已完成置顶自动退出", () => {
    const make = (key: string, status = "待执行", overdue = false, dueAt: string | null = null) => ({ key, status, overdue, dueAt, group: "pending", priority: 2 });
    const tasks = [make("normal"), make("today", "待执行", false, "2026-10-02T00:00:00+08:00"), make("late", "待执行", true), make("blocked", "阻塞"), make("review", "待验收"), { ...make("done"), group: "done" }];
    const now = new Date("2026-10-01T16:01:00Z");
    expect(recommendedTasks(tasks, [], now).map((task) => task.key)).toEqual(["today", "blocked", "late"]);
    expect(recommendedTasks(tasks, [{ taskKey: "normal", position: 0, date: "2026-10-02" }, { taskKey: "done", position: 1, date: "2026-10-02" }, { taskKey: "today", position: 0, date: "2026-10-01" }], now).map((task) => task.key)).toEqual(["today", "blocked", "late"]);
  });
  it("置顶校验归属、上限和日期", async () => {
    await db.action.create({ data: { id: "a", profileId, title: "a" } });
    expect((await focusPost(request({ date: "2026-10-02", taskKeys: ["action:a"] }))).status).toBe(200);
    expect((await focusPost(request({ date: "2026-10-02", taskKeys: ["action:missing"] }))).status).toBe(400);
    expect((await focusPost(request({ date: "2026-10-02", taskKeys: ["action:a", "action:a"] }))).status).toBe(400);
  });
  it("对齐只列真实问题，无虚构评分", () => {
    const issues = alignmentIssues([{ id: "a", title: "理想国" }], [], [], []);
    expect(issues.map((issue) => issue.reason)).toEqual(["未关联愿景", "缺少指标", "缺少截止时间"]);
  });
  it.each([false, true])("完整备份恢复新关联与旧备份兼容（D1 batch=%s）", async (useCloud) => {
    const wish = await vision(); await goal();
    await db.goal.update({ where: { id: "goal" }, data: { visionId: wish.id } });
    await db.project.create({ data: { id: "project", profileId, goalId: "goal", sceneId: `${profileId}-scene-0`, visionId: wish.id, name: "project" } });
    await db.decision.create({ data: { id: "decision", profileId, goalId: "goal", sceneId: `${profileId}-scene-0`, visionId: wish.id, title: "decision" } });
    const backup = await (await exportBackup()).json();
    cloud = useCloud;
    const response = await restoreBackup(request(backup));
    expect(response.status, JSON.stringify(await response.json())).toBe(200);
    expect((await db.project.findUniqueOrThrow({ where: { id: "project" } })).visionId).toBe(wish.id);
    expect((await db.decision.findUniqueOrThrow({ where: { id: "decision" } })).goalId).toBe("goal");
    delete backup.data.strategy;
    for (const rows of [backup.data.goals, backup.data.projects, backup.data.decisions]) for (const row of rows) { delete row.sceneId; delete row.visionId; delete row.signalId; }
    expect((await restoreBackup(request(backup))).status).toBe(200);
    expect((await db.goal.findUniqueOrThrow({ where: { id: "goal" } })).sceneId).toBeNull();
    expect(await db.workbenchScene.count()).toBe(7);
  });
  it.each([false, true])("档案导入失败不破坏已有数据（D1 batch=%s）", async (useCloud) => {
    await db.evidence.create({ data: { profileId, ability: "existing", evidence: "proof" } });
    const backup = await (await exportSelf(new Request("http://localhost/api/profile-backup"))).json();
    backup.data.evidences.push({ ability: "", evidence: "" }); cloud = useCloud;
    expect((await restoreSelf(request(backup))).status).toBe(400);
    expect(await db.evidence.count()).toBe(1);
  });
  it("D1 批量恢复产生 SQL 错误时完整回滚", async () => {
    await goal();
    await expect(writeTransaction(db, async (tx) => { await tx.goal.deleteMany({ where: { profileId } }); await tx.project.create({ data: { profileId, goalId: "missing", name: "invalid" } }); }, true)).rejects.toThrow();
    expect(await db.goal.count()).toBe(1);
  });
  it("快照、重复 ID 与标签未知场景在恢复前拒绝", async () => {
    await vision();
    const data = await exportStrategy(db);
    expect(strategyBackupSchema.safeParse(data).success).toBe(true);
    expect(strategyBackupSchema.safeParse({ ...data, records: [...data.records, data.records[0]] }).success).toBe(false);
    expect(strategyBackupSchema.safeParse({ ...data, versions: [{ ...data.versions[0], snapshot: "invalid" }] }).success).toBe(false);
    expect(() => orderedGoals([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }])).toThrow("循环");
    expect(orderedGoals([{ id: "b", parentId: "a" }, { id: "a" }])[0].id).toBe("a");
  });
  it("个人档案恢复映射历史场景，保留目标标签", async () => {
    await goal();
    await saveRecord(db, { kind: "tag", title: "目标标签", payload: { subjectType: "goal", subjectId: "goal", sceneIds: [`${profileId}-scene-0`] } });
    await vision(); const data = strategyBackupSchema.parse(await exportStrategy(db));
    await writeTransaction(db, (tx) => restoreStrategy(tx, data, true));
    expect(await db.strategyRecord.count({ where: { kind: "tag" } })).toBe(1);
  });
  it("AI预览脱敏、场景改名仍保护敏感内容，确认前不写入", async () => {
    await goal();
    await db.goal.update({ where: { id: "goal" }, data: { sceneId: `${profileId}-scene-1`, title: "私有规划 13800138000" } });
    await db.workbenchScene.update({ where: { id: `${profileId}-scene-1` }, data: { name: "资金" } });
    const input = { mode: "classify", records: [{ type: "goal", id: "goal" }], previewOnly: true };
    const preview = await strategyAnalysis(db, input);
    expect(JSON.stringify(preview)).toContain("未授权"); expect(fetch).not.toHaveBeenCalled();
    const authorized = await strategyAnalysis(db, { ...input, allowSensitive: true });
    expect(JSON.stringify(authorized)).toContain("手机号已脱敏"); expect(JSON.stringify(authorized)).not.toContain("13800138000");
    await strategyAnalysis(db, { ...input, previewOnly: false });
    expect((await db.goal.findUniqueOrThrow({ where: { id: "goal" } })).sceneId).toBe(`${profileId}-scene-1`);
  });
  it("AI未知记录返回被拒绝，分解预览不发起模型调用", async () => {
    await goal();
    await decompositionDraft(db, { goalId: "goal", previewOnly: true }); expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions: [{ type: "goal", id: "foreign", sceneId: null, reason: "", advice: "" }] }) } }] }))));
    await expect(strategyAnalysis(db, { mode: "analysis", records: [{ type: "goal", id: "goal" }] })).rejects.toThrow("未知记录");
  });
  it("新上下文默认过滤敏感场景，授权后可选；旧快照不变", async () => {
    const id = await saveRecord(db, { kind: "vision", title: "资金规划", sceneId: `${profileId}-scene-1`, payload: { expected: "稳定" } });
    const strategy = await strategyView(db);
    const config = { domain: "通用", scope: "标准", exclusions: [], options: contextOptionsSchema.parse({}) };
    const profile = { strategy, sensitiveAiFields: "[]" };
    expect(selectContext(profile, config).some((item) => item.sourceId === id.id)).toBe(false);
    expect(selectContext({ ...profile, sensitiveAiFields: '["incomeRange"]' }, config).some((item) => item.sourceId === id.id)).toBe(true);
  });
  it("预填决策取消不创建记录，确认创建同时保存来源", async () => {
    const signal = await saveRecord(db, { kind: "signal", title: "事件", payload: { type: "event", observedAt: "2026-10-02", verification: "待核验", radar: { confidence: "中", confidenceReason: "已核对原始公告" } } });
    const response = await dataPost(request({ type: "decision", data: { title: "决策", signalId: signal.id, options: "方案一\n方案二", _source: { sourceType: "signal", sourceId: signal.id } } }));
    expect(response.status).toBe(201); expect(await db.recordSource.count()).toBe(1); expect(await db.decisionOption.count()).toBe(2);
  });
});
