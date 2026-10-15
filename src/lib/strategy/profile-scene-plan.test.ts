import { beforeEach, describe, expect, it, vi } from "vitest";
import { sceneDefaults } from "../scenes";
import { sceneProfileGroups } from "./profile-scene-layout";

const mocks = vi.hoisted(() => ({ db: {
  profile: { findUnique: vi.fn() }, workbenchScene: { findMany: vi.fn() }, strategyRecord: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  goalBatch: { findFirst: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}, call: vi.fn() }));
vi.mock("@/lib/db", () => ({ PROFILE_ID: "local-profile", getDb: () => mocks.db }));
vi.mock("@/lib/daily/config", () => ({ dailyAIConfig: () => ({ model: "deepseek-reasoner" }) }));
vi.mock("@/lib/daily/provider", () => ({ callModel: mocks.call }));
vi.mock("@/lib/daily/service", () => ({ withDailyLock: (_: unknown, operation: () => unknown) => operation() }));
import { DELETE, GET, POST } from "@/app/api/profile-scene-plan/route";
import { scenePlanResultSchema, validateScenePlan } from "./profile-scene-plan";

const scenes = sceneDefaults.map(row => ({ ...row, id: `scene-${row.slot}` }));
const items = () => scenes.map(scene => ({ sceneId: scene.id, sceneDetails: Object.fromEntries(sceneProfileGroups(scene.slot).flatMap(group => group.fields.map(field => [field.key, `待确认：${field.label}的实际情况`]))), explanation: "专业背景可作为规划参考，不认定当前岗位", questions: ["实际投入的时间？"] }));
const request = (body: object) => new Request("http://localhost/api/profile-scene-plan", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.profile.findUnique.mockResolvedValue({ education: "硕士", major: "生物技术", personalityTraits: "注重具体事实", organization: "未授权组织", sensitiveAiFields: "[]" });
  mocks.db.workbenchScene.findMany.mockResolvedValue(scenes);
  mocks.db.strategyRecord.findMany.mockResolvedValue([
    { id: "health", kind: "profileScene", sceneId: "scene-3", updatedAt: new Date(1000), payload: JSON.stringify({ sceneDetails: { healthEnergy: "未授权身心", focus: "实际健康资料" } }) },
    { id: "work", kind: "profileScene", sceneId: "scene-0", updatedAt: new Date(1000), payload: JSON.stringify({ sceneDetails: { organization: "未授权工作组织", role: "已知工作角色" } }) },
    { id: "overall", kind: "overallVision", sceneId: null, payload: JSON.stringify({ expected: "总愿景含家庭健康内容" }) },
  ]);
  mocks.call.mockResolvedValue({ output: JSON.stringify({ items: items() }) });
});
describe("AI 场景档案草稿", () => {
  it("发送前预览、字段授权及敏感场景过滤，不调用模型", async () => {
    const response = await POST(request({ action: "preview" }));
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.withheld).toBe(2); expect(data.context.background.education).toBe("硕士");
    expect(JSON.stringify(data.context)).not.toContain("未授权"); expect(data.context.records).toHaveLength(1);
    expect(mocks.call).not.toHaveBeenCalled();
    const allowed = await (await POST(request({ action: "preview", allowSensitive: true }))).json();
    expect(allowed.context.records).toHaveLength(3); expect(JSON.stringify(allowed.context)).toContain("实际健康资料");
    expect(JSON.stringify(allowed.context)).not.toContain("未授权");
  });
  it("生成六场景草稿、刷新可恢复，确认前不修改档案", async () => {
    const response = await POST(request({ action: "generate" })); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.items).toHaveLength(sceneDefaults.length);
    expect(mocks.db.strategyRecord.create).not.toHaveBeenCalled(); expect(mocks.db.strategyRecord.update).not.toHaveBeenCalled();
    const stored = mocks.db.goalBatch.upsert.mock.calls[0][0].create;
    mocks.db.goalBatch.findFirst.mockResolvedValue(stored);
    expect((await (await GET()).json()).draft.requestId).toBe(data.requestId);
    expect((await POST(request({ action: "generate" }))).status).toBe(400); expect(mocks.call).toHaveBeenCalledOnce();
    await DELETE(request({ requestId: crypto.randomUUID() })); expect(mocks.db.goalBatch.deleteMany).not.toHaveBeenCalled();
    expect((await DELETE(request({ requestId: data.requestId }))).status).toBe(200); expect(mocks.db.goalBatch.deleteMany).toHaveBeenCalledOnce();
    mocks.db.goalBatch.findFirst.mockResolvedValue({ ...stored, payload: JSON.stringify({ ...data, confirmed: data.items }) });
    expect((await (await GET()).json()).draft).toBeNull();
  });
  it.each(["duplicate", "foreign", "mismatch", "missing", "malformed"])("拒绝无效模型结果：%s，不保存任何草稿", async kind => {
    const list = items();
    if (kind === "duplicate") list[1].sceneId = list[0].sceneId;
    if (kind === "foreign") list[0].sceneId = "other-profile-scene";
    if (kind === "mismatch") list[0].sceneDetails.organization = "健康不能用工作字段";
    if (kind === "missing") delete list[0].sceneDetails.stage;
    mocks.call.mockResolvedValue({ output: kind === "malformed" ? "not-json" : JSON.stringify({ items: list }) });
    expect((await POST(request({ action: "generate" }))).status).toBe(400);
    expect(mocks.db.goalBatch.upsert).not.toHaveBeenCalled();
  });
  it("模型不可用保留人工流程及原档案", async () => {
    mocks.call.mockRejectedValue(new Error("AI 服务返回 HTTP 503"));
    expect((await POST(request({ action: "generate" }))).status).toBe(400);
    expect(mocks.db.goalBatch.upsert).not.toHaveBeenCalled();
    expect(mocks.db.strategyRecord.update).not.toHaveBeenCalled();
  });
  it("字段校验用稳定slot，场景改名后保持适配", () => {
    const parsed = scenePlanResultSchema.parse({ items: items() });
    expect(() => validateScenePlan(parsed.items, scenes.map(row => ({ ...row, name: "自定义名称" })), true)).not.toThrow();
  });
});
