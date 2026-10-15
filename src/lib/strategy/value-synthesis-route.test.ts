import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    profile: { findUnique: vi.fn() }, strategyRecord: { findMany: vi.fn() }, workbenchScene: { findMany: vi.fn() },
    valueRule: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    goalBatch: { findFirst: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  }, call: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ PROFILE_ID: "local-profile", getDb: () => mocks.db }));
vi.mock("@/lib/daily/config", () => ({ dailyAIConfig: () => ({ model: "deepseek-reasoner" }) }));
vi.mock("@/lib/daily/provider", () => ({ callModel: mocks.call }));
vi.mock("@/lib/daily/service", () => ({ withDailyLock: (_: unknown, operation: () => unknown) => operation() }));
import { DELETE, GET, POST } from "@/app/api/value-synthesis/route";
const request = (data: object) => new Request("http://localhost/api/value-synthesis", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.profile.findUnique.mockResolvedValue({ stage: "职业调整", personalityTraits: "重视长期积累", organization: "不得发送", sensitiveAiFields: "[]" });
  mocks.db.strategyRecord.findMany.mockResolvedValue([{ id: "vision", kind: "vision", title: "创作", sceneId: "hobby", payload: JSON.stringify({ expected: "持续写作", boundary: "保留休息时间" }) }]);
  mocks.db.workbenchScene.findMany.mockResolvedValue([{ id: "hobby", slot: 5, name: "爱好" }]);
  mocks.db.valueRule.findMany.mockResolvedValue([]);
  mocks.call.mockResolvedValue({ output: JSON.stringify({ items: [{ value: "长期积累", priority: 2, rule: "时间不足时保留可持续投入", sourceVisionIds: ["vision"] }], explanation: "依据已保存档案与愿景", questions: [] }) });
});
describe("档案与愿景提炼价值", () => {
  it("预览包含档案但遵循字段授权，不调用模型", async () => {
    const response = await POST(request({ action: "preview" })); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.context.background).toMatchObject({ stage: "职业调整", personalityTraits: "重视长期积累" });
    expect(data.context.background).not.toHaveProperty("organization"); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("生成保存待确认草稿，不修改正式规则，GET可恢复", async () => {
    const response = await POST(request({ action: "generate" })); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.items[0].value).toBe("长期积累");
    expect(mocks.call.mock.calls[0][1]).toContain("职业调整");
    expect(mocks.db.valueRule.update).not.toHaveBeenCalled(); expect(mocks.db.valueRule.create).not.toHaveBeenCalled();
    const saved = mocks.db.goalBatch.upsert.mock.calls[0][0].create;
    expect(saved.profileId).toBe("local-profile"); expect(JSON.parse(saved.payload).requestId).toBe(data.requestId);
    mocks.db.goalBatch.findFirst.mockResolvedValue({ payload: saved.payload });
    expect((await (await GET()).json()).draft).toEqual(data);
    expect((await DELETE(request({ requestId: crypto.randomUUID() }))).status).toBe(200);
    expect(mocks.db.goalBatch.deleteMany).not.toHaveBeenCalled();
    expect((await DELETE(request({ requestId: data.requestId }))).status).toBe(200);
    expect(mocks.db.goalBatch.deleteMany).toHaveBeenCalledOnce();
  });
  it("改名后的敏感场景仍需授权，错误来源不能保存草稿", async () => {
    mocks.db.workbenchScene.findMany.mockResolvedValue([{ id: "hobby", slot: 3, name: "自定义名称" }]);
    expect((await POST(request({ action: "generate" }))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled();
    mocks.call.mockResolvedValue({ output: JSON.stringify({ items: [{ value: "无依据", priority: 1, sourceVisionIds: ["foreign-profile"] }] }) });
    expect((await POST(request({ action: "generate", allowSensitive: true }))).status).toBe(400);
    expect(mocks.db.goalBatch.upsert).not.toHaveBeenCalled();
  });
});
