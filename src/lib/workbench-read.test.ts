import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { D1Database } from "@cloudflare/workers-types";
import { readWorkbenchData, decodeD1Row } from "./workbench-read";
import { workbenchEdge } from "./workbench-edge";
import { createSessionToken } from "./session-auth";
import { initializeScenes } from "./strategy/service";
import { GET } from "../app/api/data/route";
import { loadWorkbench } from "./load-workbench";

vi.mock("./db", () => ({ getDb: async () => prisma, PROFILE_ID: "local-profile", isCloudflareD1Runtime: () => false }));
vi.mock("./daily/config", () => ({ dailyAIConfig: () => ({ apiKey: "test-key" }) }));
let directory: string, sqlite: DatabaseSync, prisma: PrismaClient, d1: D1Database;
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "workbench-read-"));
  const filename = path.join(directory, "test.sqlite");
  sqlite = new DatabaseSync(filename);
  sqlite.exec(execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" }));
  prisma = new PrismaClient({ datasources: { db: { url: `file:${filename.replaceAll("\\", "/")}` } } });
  const prepare = (sql: string, values: string[] = []) => ({
    bind: (...args: string[]) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values), success: true }),
  });
  d1 = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => Promise.all(statements.map(statement => statement.all())) } as unknown as D1Database;
  await prisma.profile.create({ data: { id: "local-profile", name: "Fixture", aiInstruction: { create: {} } } });
  await prisma.profile.create({ data: { id: "other-profile", name: "Not visible", experiences: { create: { title: "Private" } } } });
  await initializeScenes(prisma);
  await prisma.goal.create({ data: { id: "g", profileId: "local-profile", title: "Goal", horizon: "1年", sceneId: "local-profile-scene-3" } });
  await prisma.project.create({ data: { id: "p", profileId: "local-profile", goalId: "g", name: "Project", milestones: { create: { title: "Milestone", deadline: new Date() } } } });
  await prisma.action.create({ data: { id: "a", profileId: "local-profile", projectId: "p", title: "Action" } });
  await prisma.documentVersion.create({ data: { profileId: "local-profile", documentKey: "profile", title: "Version", content: "Historical document" } });
  await prisma.strategyRecord.create({ data: { id: "vision", profileId: "local-profile", kind: "vision", title: "Vision", payload: '{"state":"Expected"}' } });
  await prisma.dailyPlan.create({ data: { profileId: "local-profile", date: "2026-11-13", tasks: { create: [
    { id: "done", actionId: "a", title: "Done", lane: "mixed", completedAt: new Date(), result: "Verified result", steps: { create: [{ position: 0, title: "AI", assignee: "ai", status: "done" }, { position: 1, title: "Human", assignee: "human", status: "done" }] } },
    { id: "review", title: "Review pending", lane: "B", completedAt: new Date(), steps: { create: { position: 0, title: "AI", assignee: "ai", status: "review" } } },
  ] } } });
  sqlite.exec("CREATE TABLE admin_accounts(id TEXT, email TEXT, password_hash TEXT); INSERT INTO admin_accounts VALUES ('super-admin','test@example.com','test-secret')");
}, 60000);
afterAll(async () => { await prisma?.$disconnect(); sqlite?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });

describe("lightweight authenticated dashboard reads", () => {
  it("matches the existing API including dates, scene inheritance, history and accepted results", async () => {
    const expected = await (await GET()).json();
    const actual = JSON.parse(JSON.stringify(await readWorkbenchData(d1, true)));
    expect(actual).toEqual(expected);
    expect(actual.dailyReviewTasks.map((row: { id: string }) => row.id)).toEqual(["done"]);
    expect(actual.experiences).toEqual([]);
  });
  it("returns null for a new profile instead of fabricating or writing data", async () => {
    expect(await readWorkbenchData(d1, false, "missing-profile")).toBeNull();
  });
  it("merges partitioned reads without dropping records and retains local compatibility", async () => {
    const expected = await (await GET()).json();
    const fetcher = vi.fn(async (url: string) => {
      const part = new URL(url, "https://example.com").searchParams.get("part") as "main" | "archive" | "strategy";
      return Response.json(await readWorkbenchData(d1, true, undefined, part), { headers: { "x-workbench-part": part } });
    });
    expect(await loadWorkbench(fetcher as typeof fetch)).toEqual(expected);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const local = vi.fn(async () => Response.json(expected));
    expect(await loadWorkbench(local)).toEqual(expected);
    expect(local).toHaveBeenCalledTimes(1);
  });
  it("does not render partial data if a partition fails", async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith("main") ? Response.json({ name: "main" }, { headers: { "x-workbench-part": "main" } }) : new Response("Worker error", { status: 503 }));
    await expect(loadWorkbench(fetcher as typeof fetch)).rejects.toThrow("服务暂时无法读取数据");
  });
  it("does not rewrite initialized scenes during a refresh", async () => {
    const write = vi.spyOn(prisma.workbenchScene, "upsert");
    await initializeScenes(prisma);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
  it("uses the schema to convert dates and booleans and excludes unknown columns", () => {
    expect(decodeD1Row("StrategyRecord", { id: "r", archived: 0, createdAt: 0, password_hash: "hidden" })).toEqual({ id: "r", archived: false, createdAt: "1970-01-01T00:00:00.000Z" });
  });
  it("requires a valid unexpired session and never caches authenticated content", async () => {
    const env = { WORKBENCH_DB: d1, AI_API_KEY: "key" };
    expect((await workbenchEdge(new Request("https://example.com/"), env, "shell"))?.status).toBe(307);
    expect((await workbenchEdge(new Request("https://example.com/api/data", { headers: { cookie: "ai_workbench_session=invalid" } }), env, "shell"))?.status).toBe(401);
    expect(await (await workbenchEdge(new Request("https://example.com/login"), env, "shell", "login"))?.text()).toBe("login");
    const token = await createSessionToken("test@example.com", "test-secret");
    const headers = { cookie: `ai_workbench_session=${token}` };
    const response = await workbenchEdge(new Request("https://example.com/?section=documents", { headers }), env, "shell");
    expect(await response?.text()).toBe("shell");
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(await workbenchEdge(new Request("https://example.com/", { headers: { ...headers, rsc: "1" } }), env, "shell")).toBeNull();
    expect(await workbenchEdge(new Request("https://example.com/api/data", { method: "POST", headers }), env, "shell")).toBeNull();
    const wrongUser = await createSessionToken("other@example.com", "test-secret");
    expect((await workbenchEdge(new Request("https://example.com/", { headers: { cookie: `ai_workbench_session=${wrongUser}` } }), env, "shell"))?.status).toBe(307);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 8 * 86400000));
    expect((await workbenchEdge(new Request("https://example.com/", { headers }), env, "shell"))?.status).toBe(307);
    vi.useRealTimers();
    sqlite.exec("UPDATE admin_accounts SET password_hash='new-secret'");
    expect((await workbenchEdge(new Request("https://example.com/", { headers }), env, "shell"))?.status).toBe(307);
  });
});
