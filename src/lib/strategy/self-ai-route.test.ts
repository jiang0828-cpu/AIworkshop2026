import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ own: vi.fn(), call: vi.fn(), db: { profile: { findUnique: vi.fn() }, workbenchScene: { findMany: vi.fn() }, strategyRecord: { findMany: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ PROFILE_ID: "me", getDb: async () => mocks.db }));
vi.mock("@/lib/strategy/service", () => ({ own: mocks.own }));
vi.mock("@/lib/daily/config", () => ({ dailyAIConfig: () => ({ model: "deepseek-reasoner" }) }));
vi.mock("@/lib/daily/provider", () => ({ callModel: mocks.call }));
import { POST } from "@/app/api/self-ai/route";
const request = (extra = {}) => new Request("http://localhost/api/self-ai", { method: "POST", body: JSON.stringify({ type: "experience", id: "entry", mode: "organize", ...extra }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.profile.findUnique.mockResolvedValue({ id: "me" });
  mocks.db.workbenchScene.findMany.mockResolvedValue([{ id: "work", slot: 0, name: "工作" }]);
  mocks.db.strategyRecord.findMany.mockResolvedValue([]);
  mocks.own.mockResolvedValue({ title: "阅读记录", description: "读了三本书", learning: "" });
  mocks.call.mockResolvedValue({ output: JSON.stringify({ fields: { description: "整理阅读记录" }, sceneIds: [], explanation: "依据原文", questions: [] }) });
});
describe("认识自己 AI 接口边界", () => {
  it("预览不调用模型；生成只返回草稿", async () => {
    expect((await POST(request({ previewOnly: true }))).status).toBe(200);
    expect(mocks.call).not.toHaveBeenCalled();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).fields.description).toBe("整理阅读记录");
    expect(mocks.call).toHaveBeenCalledOnce();
  });
  it("未授权敏感内容不发送，授权后可以生成", async () => {
    mocks.own.mockResolvedValue({ title: "家庭安排", description: "陪伴孩子", learning: "" });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
    expect((await POST(request({ allowSensitive: true }))).status).toBe(200);
  });
  it("拒绝其他档案记录", async () => {
    mocks.own.mockRejectedValue(new Error("记录不存在或不属于当前档案"));
    expect((await POST(request())).status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("拒绝模型伪造字段和全局分类", async () => {
    mocks.call.mockResolvedValue({ output: JSON.stringify({ fields: { id: "other" }, sceneIds: [], explanation: "", questions: [] }) });
    expect((await POST(request())).status).toBe(400);
    expect((await POST(request({ type: "profile", id: "me", mode: "classify" }))).status).toBe(400);
  });
});
