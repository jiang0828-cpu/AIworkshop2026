import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyDB } from "../daily/service";
import { researchTick } from "./scheduler";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), execute: vi.fn(), publish: vi.fn() }));
vi.mock("../daily/service", () => ({ PROFILE: "test-profile", withDailyLock: (_db: unknown, operation: () => unknown) => operation() }));
vi.mock("../radar/news", () => ({ enqueueNews: mocks.enqueue, retryTransientNews: vi.fn() }));
vi.mock("../radar/news-worker", () => ({ executeNews: mocks.execute }));
vi.mock("../radar/migration", () => ({ publishResearch: mocks.publish }));

function database(queued = false) {
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue(queued ? [{ id: "manual-news" }] : []),
    researchBatch: { updateMany: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: "manual-news" }) },
    radarRecord: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as DailyDB;
}
beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue(true); });
describe("研判后台运行模式", () => {
  const config = { apiKey: "test-only", tavilyKey: "test-only" };
  it("手动模式不创建定时轮次，仍执行并发布已排队资讯", async () => {
    const db = database(true);
    await researchTick(db, config, { automaticNews: false });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledWith(db, { id: "manual-news" }, config);
    expect(mocks.publish).toHaveBeenCalledWith(db, "manual-news");
  });
  it("原有默认模式继续检查定时配置", async () => {
    await researchTick(database(), config);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("未配置检索时不自动采集，但仍领取用户作业", async () => {
    await researchTick(database(true), { apiKey: "test-only" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
