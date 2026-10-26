import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./workspace-backup-service", () => ({
  GET: async () => new Response(JSON.stringify({ data: { name: "test fixture" } })),
  POST: async (_: Request, capture: (rows: unknown[]) => void) => { capture([{ table: "Profile", data: { id: "local-profile", name: "test fixture" } }]); return Response.json({ ok: true }); },
}));
vi.mock("./cloud-sync", () => ({ getCloudSyncConfig: () => ({ token: "test-only-token" }), getCloudSyncTarget: () => "https://sync.example.invalid" }));
vi.mock("./cloud-sync-transfer", () => ({ syncDigest: async () => "a".repeat(64), validateSyncRow: () => {}, syncParts: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  delete (globalThis as typeof globalThis & { workbenchSync?: unknown }).workbenchSync;
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("local sync retry and receipts", () => {
  it("backs off transient errors and retries only the failed chunk", async () => {
    const calls: string[] = [];
    let chunks = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const { phase } = JSON.parse(init.body); calls.push(phase);
      if (phase === "chunk" && ++chunks < 3) return Response.json({}, { status: 503 });
      return Response.json({ status: phase === "commit" ? "applied" : "uploading", rowCount: 1 });
    }));
    const client = await import("./cloud-sync-client"); client.enqueueCloudSync();
    await vi.advanceTimersByTimeAsync(100000);
    expect(client.cloudSyncProgress()).toMatchObject({ status: "synced", uploaded: 1, total: 1, error: null });
    expect(calls).toEqual(["begin", "chunk", "chunk", "chunk", "commit"]);
  });
  it("does not retry ownership/conflict errors or report a queued request as synchronized", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const { phase } = JSON.parse(init.body); calls.push(phase);
      return phase === "chunk" ? Response.json({ error: "ownership conflict" }, { status: 409 }) : Response.json({ status: "uploading" });
    }));
    const client = await import("./cloud-sync-client"); client.enqueueCloudSync();
    expect(client.cloudSyncProgress().status).not.toBe("synced");
    await vi.advanceTimersByTimeAsync(100000);
    expect(client.cloudSyncProgress()).toMatchObject({ status: "error", error: "ownership conflict", syncedAt: null });
    expect(calls).toEqual(["begin", "chunk"]);
  });
  it("queries the receipt after a lost commit response instead of applying it again", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const { phase } = JSON.parse(init.body); calls.push(phase);
      if (phase === "commit") throw new Error("connection closed after commit");
      return Response.json({ status: phase === "status" ? "applied" : "uploading", rowCount: 1 });
    }));
    const client = await import("./cloud-sync-client"); client.enqueueCloudSync();
    await vi.advanceTimersByTimeAsync(100000);
    expect(client.cloudSyncProgress().status).toBe("synced");
    expect(calls).toEqual(["begin", "chunk", "commit", "status"]);
  });
});
