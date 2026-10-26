import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { processSyncTransfer } from "./cloud-sync-protocol";
import { syncDigest, syncParts, validateSyncRow } from "./cloud-sync-transfer";
import { GET as exportBackup, POST as normalizeBackup } from "./workspace-backup-service";
import { initializeDaily } from "./daily/service";
import type { SyncRow } from "./database-writes";
import { withCloudSyncLock } from "./cloud-sync-lock";

vi.mock("./db", () => ({ getDb: async () => local, PROFILE_ID: "local-profile", isCloudflareD1Runtime: () => false }));
let local: PrismaClient, cloud: DatabaseSync, directory: string, schema: string;
let failCommit = false;
const lock = async <T,>(callback: () => Promise<T>) => callback();
function adapter(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string, values: (string | number | null)[] = []) => ({
    sql, values,
    bind: (...parameters: (string | number | null)[]) => prepare(sql, parameters),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => {
      if (sql.split("UNION ALL").length > 5) throw new Error("D1 compound SELECT limit");
      return { results: sqlite.prepare(sql).all(...values), success: true, meta: {} };
    },
    run: async () => ({ results: [], success: true, meta: sqlite.prepare(sql).run(...values) }),
  });
  return { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        if (statement.sql.split("UNION ALL").length > 5) throw new Error("D1 compound SELECT limit");
        const rows = statement.sql.startsWith("SELECT") ? sqlite.prepare(statement.sql).all(...statement.values) : (sqlite.prepare(statement.sql).run(...statement.values), []);
        results.push({ results: rows, success: true, meta: {} });
        if (failCommit && statement.sql.startsWith('DELETE FROM "Profile"') === false && statement.sql.startsWith("DELETE FROM")) throw new Error("simulated write failure");
      }
      sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "cloud-sync-test-"));
  const filename = path.join(directory, "local.sqlite");
  schema = execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
  const sqlite = new DatabaseSync(filename); sqlite.exec(schema); sqlite.close();
  local = new PrismaClient({ datasources: { db: { url: `file:${filename.replace(/\\/g, "/")}` } } });
}, 60000);
beforeEach(async () => {
  failCommit = false;
  cloud?.close(); cloud = new DatabaseSync(":memory:"); cloud.exec(schema); cloud.exec(readFileSync("cloudflare/migrations/0019_cloud_sync_staging.sql", "utf8"));
  cloud.exec(readFileSync("cloudflare/migrations/0020_cloud_sync_parts.sql", "utf8"));
  await local.profile.deleteMany(); await initializeDaily(local);
  await local.goal.create({ data: { id: "goal-local", profileId: "local-profile", title: "Local goal", horizon: "1年" } });
  await local.project.create({ data: { id: "project-local", profileId: "local-profile", goalId: "goal-local", name: "Local project" } });
  await local.action.create({ data: { id: "action-local", profileId: "local-profile", projectId: "project-local", title: "Local action" } });
  cloud.exec("INSERT INTO Profile(id,name,updatedAt) VALUES ('local-profile','Cloud before',1); INSERT INTO Goal(id,profileId,title,horizon,updatedAt) VALUES ('old-goal','local-profile','Old goal','1年',1)");
});
afterAll(async () => { cloud?.close(); await local?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); });
async function snapshot() {
  const before = await local.goal.findMany();
  let rows: SyncRow[] = [];
  const backup = await exportBackup();
  const response = await normalizeBackup(new Request("http://localhost/api/backup", { method: "POST", body: await backup.text() }), result => { rows = result; });
  expect(await response.json()).toMatchObject({ ok: true });
  expect(await local.goal.findMany()).toEqual(before);
  for (const row of rows) validateSyncRow(row);
  const encoded = await Promise.all(rows.map(async (row, position) => ({ ...row, position, digest: await syncDigest(`${row.table}\n${JSON.stringify(row.data)}`) })));
  const digest = await syncDigest(encoded.map(row => row.digest).join("\n"));
  return { rows: encoded, digest, id: crypto.randomUUID() };
}
async function stage(plan: Awaited<ReturnType<typeof snapshot>>) {
  const db = adapter(cloud);
  await processSyncTransfer(db, { phase: "begin", id: plan.id, rowCount: plan.rows.length, digest: plan.digest }, lock);
  for (let offset = 0; offset < plan.rows.length; offset += 30) await processSyncTransfer(db, { phase: "chunk", id: plan.id, rows: plan.rows.slice(offset, offset + 30) }, lock);
  return db;
}
describe("bounded cloud sync", () => {
  it("the native transport shares the scheduler maintenance lease and releases it on failure", async () => {
    const db = adapter(cloud);
    await withCloudSyncLock(db, async () => {
      expect(cloud.prepare("SELECT maintenance FROM DailyControl").get()).toMatchObject({ maintenance: 1 });
      const lease = cloud.prepare("SELECT maintenanceUntil FROM DailyControl").get()!.maintenanceUntil;
      expect(typeof lease).toBe("string");
      expect(Date.parse(String(lease))).toBeGreaterThan(Date.now());
      await expect(withCloudSyncLock(db, async () => true)).rejects.toThrow("正在更新");
    });
    expect(cloud.prepare("SELECT maintenance FROM DailyControl").get()).toMatchObject({ maintenance: 0 });
    for (const expired of [1, "2000-01-01T00:00:00.000+00:00"]) {
      cloud.prepare("UPDATE DailyControl SET maintenance=1,maintenanceUntil=?").run(expired);
      await expect(withCloudSyncLock(db, async () => true)).resolves.toBe(true);
    }
    await expect(withCloudSyncLock(db, async () => { throw new Error("failed commit"); })).rejects.toThrow("failed commit");
    expect(cloud.prepare("SELECT maintenance FROM DailyControl").get()).toMatchObject({ maintenance: 0 });
  });
  it("normalizes without changing local records, applies the full snapshot atomically and keeps a receipt", async () => {
    const plan = await snapshot(), db = await stage(plan);
    expect(cloud.prepare("SELECT title FROM Goal").get()).toMatchObject({ title: "Old goal" });
    expect(await processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).toMatchObject({ status: "applied", rowCount: plan.rows.length });
    expect(cloud.prepare("SELECT title FROM Goal").get()).toMatchObject({ title: "Local goal" });
    expect(cloud.prepare("SELECT projectId FROM Action").get()).toMatchObject({ projectId: "project-local" });
    expect(cloud.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    cloud.exec("UPDATE Goal SET title='Edited after sync'");
    expect(await processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).toMatchObject({ status: "applied" });
    expect(cloud.prepare("SELECT title FROM Goal").get()).toMatchObject({ title: "Edited after sync" });
  });
  it("read-only local normalization does not acquire or release an execution maintenance lock", async () => {
    await local.dailyControl.update({ where: { profileId: "local-profile" }, data: { maintenance: true, maintenanceToken: "another-operation", maintenanceUntil: new Date(Date.now() + 60000) } });
    await snapshot();
    expect(await local.dailyControl.findUnique({ where: { profileId: "local-profile" } })).toMatchObject({ maintenance: true, maintenanceToken: "another-operation" });
  });
  it("rejects incomplete snapshots, changed chunks and cross-profile rows", async () => {
    const plan = await snapshot(), db = adapter(cloud);
    await processSyncTransfer(db, { phase: "begin", id: plan.id, rowCount: plan.rows.length, digest: plan.digest }, lock);
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).rejects.toThrow("完整");
    const row = plan.rows[0];
    await processSyncTransfer(db, { phase: "chunk", id: plan.id, rows: [row] }, lock);
    await processSyncTransfer(db, { phase: "chunk", id: plan.id, rows: [row] }, lock);
    const data = { ...row.data, name: "Changed" };
    await expect(processSyncTransfer(db, { phase: "chunk", id: plan.id, rows: [{ ...row, data, digest: await syncDigest(`${row.table}\n${JSON.stringify(data)}`) }] }, lock)).rejects.toThrow("不能修改");
    expect(() => validateSyncRow({ ...row, data: { ...row.data, id: "another-profile" } })).toThrow("当前档案");
  });
  it("rolls back every business write on a failed commit and can retry", async () => {
    const plan = await snapshot(), db = await stage(plan);
    failCommit = true;
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).rejects.toThrow("simulated");
    expect(cloud.prepare("SELECT title FROM Goal").get()).toMatchObject({ title: "Old goal" });
    failCommit = false;
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).resolves.toMatchObject({ status: "applied" });
  });
  it("rejects online edits during upload", async () => {
    const plan = await snapshot(), db = await stage(plan);
    cloud.exec("UPDATE Goal SET updatedAt=100,title='New online edit'");
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).rejects.toThrow("线上资料已修改");
    expect(cloud.prepare("SELECT title FROM Goal").get()).toMatchObject({ title: "New online edit" });
  });
  it("requires valid references and an idle scheduler before committing", async () => {
    const plan = await snapshot();
    const task = plan.rows.find(row => row.table === "Action")!;
    task.data.projectId = "not-in-this-profile";
    task.digest = await syncDigest(`${task.table}\n${JSON.stringify(task.data)}`);
    plan.digest = await syncDigest(plan.rows.map(row => row.digest).join("\n"));
    const db = await stage(plan);
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, async () => { throw new Error("存在运行中任务"); })).rejects.toThrow("运行中");
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).rejects.toThrow("同步关联缺失");
    expect(cloud.prepare("SELECT title FROM Goal").get()).toMatchObject({ title: "Old goal" });
  });
  it("rejects expired sessions and corrupted snapshot digests", async () => {
    const plan = await snapshot(), db = await stage(plan);
    cloud.prepare("UPDATE CloudSyncRow SET digest=? WHERE sessionId=? AND position=0").run("f".repeat(64), plan.id);
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).rejects.toThrow("完整快照校验失败");
    cloud.prepare("UPDATE CloudSyncSession SET expiresAt=0 WHERE id=?").run(plan.id);
    await expect(processSyncTransfer(db, { phase: "chunk", id: plan.id, rows: [plan.rows[0]] }, lock)).rejects.toThrow("过期");
  });
  it("keeps cloud news usage maxima rather than refunding consumed budget", async () => {
    const make = (search: number, extract: number) => JSON.stringify({ date: "2026-10-26", search, extract, model: 2 });
    await local.radarRecord.create({ data: { id: "usage-test", profileId: "local-profile", kind: "newsUsage", title: "Usage", payload: make(1, 5) } });
    cloud.prepare("INSERT INTO RadarRecord(id,profileId,kind,title,payload,updatedAt) VALUES (?,?,?,?,?,1)").run("usage-test", "local-profile", "newsUsage", "Usage", make(8, 1));
    const plan = await snapshot(), db = await stage(plan);
    await processSyncTransfer(db, { phase: "commit", id: plan.id }, lock);
    const usage = cloud.prepare("SELECT payload FROM RadarRecord WHERE id='usage-test'").get() as { payload: string };
    expect(JSON.parse(usage.payload)).toEqual({ date: "2026-10-26", search: 8, extract: 5, model: 2 });
  });
  it("assembles bounded fragments with Unicode intact, rejects invalid fields and keeps chunks immutable", async () => {
    const plan = await snapshot();
    const row = plan.rows.find(row => row.table === "Profile")!;
    row.data.name = "中文😀".repeat(15000);
    const fragmented = await syncParts(row.table, JSON.stringify(row.data)); row.digest = fragmented.digest;
    plan.digest = await syncDigest(plan.rows.map(row => row.digest).join("\n"));
    const db = adapter(cloud);
    await processSyncTransfer(db, { phase: "begin", id: plan.id, rowCount: plan.rows.length, digest: plan.digest }, lock);
    const header = { id: plan.id, position: row.position, table: row.table, rowDigest: row.digest, partCount: fragmented.parts.length };
    await expect(processSyncTransfer(db, { ...header, phase: "assemble" }, lock)).rejects.toThrow("完整");
    for (const part of fragmented.parts) await processSyncTransfer(db, { ...header, phase: "parts", parts: [part] }, lock);
    await processSyncTransfer(db, { ...header, phase: "assemble" }, lock);
    const stored = cloud.prepare("SELECT data FROM CloudSyncRow WHERE sessionId=? AND position=?").get(plan.id, row.position) as { data: string };
    expect(JSON.parse(stored.data).name).toBe(row.data.name);
    const changed = "modified";
    await expect(processSyncTransfer(db, { ...header, phase: "parts", parts: [{ index: 0, content: changed, digest: await syncDigest(changed) }] }, lock)).rejects.toThrow("不能修改");
    const invalid = await syncParts("Profile", JSON.stringify({ ...row.data, id: "foreign-profile" }));
    const invalidHeader = { ...header, position: 1, rowDigest: invalid.digest, partCount: invalid.parts.length };
    for (const part of invalid.parts) await processSyncTransfer(db, { ...invalidHeader, phase: "parts", parts: [part] }, lock);
    await expect(processSyncTransfer(db, { ...invalidHeader, phase: "assemble" }, lock)).rejects.toThrow("归属校验失败");
    expect(cloud.prepare("SELECT COUNT(*) n FROM CloudSyncRow WHERE sessionId=? AND position=1").get(plan.id)).toMatchObject({ n: 0 });
  });
  it.skipIf(!process.env.WORKSPACE_BACKUP_FILE)("normalizes the real large backup without writing it into the local source", async () => {
    const payload = readFileSync(process.env.WORKSPACE_BACKUP_FILE!, "utf8");
    let rows: SyncRow[] = [];
    const response = await normalizeBackup(new Request("http://localhost/api/backup", { method: "POST", body: payload }), result => { rows = result; });
    expect(await response.json()).toMatchObject({ ok: true });
    rows.forEach(validateSyncRow);
    const large = new Map<number, Awaited<ReturnType<typeof syncParts>>>();
    const encoded = await Promise.all(rows.map(async (row, position) => {
      const data = JSON.stringify(row.data);
      if (Buffer.byteLength(data) > 128000) large.set(position, await syncParts(row.table, data));
      return { ...row, position, digest: large.get(position)?.digest || await syncDigest(`${row.table}\n${data}`) };
    }));
    const plan = { rows: encoded, digest: await syncDigest(encoded.map(row => row.digest).join("\n")), id: crypto.randomUUID() };
    const db = adapter(cloud);
    await processSyncTransfer(db, { phase: "begin", id: plan.id, rowCount: plan.rows.length, digest: plan.digest }, lock);
    for (const row of encoded) {
      const fragmented = large.get(row.position);
      if (!fragmented) await processSyncTransfer(db, { phase: "chunk", id: plan.id, rows: [row] }, lock);
      else {
        const header = { id: plan.id, position: row.position, table: row.table, rowDigest: row.digest, partCount: fragmented.parts.length };
        for (let offset = 0; offset < fragmented.parts.length; offset += 2) await processSyncTransfer(db, { ...header, phase: "parts", parts: fragmented.parts.slice(offset, offset + 2) }, lock);
        await processSyncTransfer(db, { ...header, phase: "assemble" }, lock);
      }
    }
    await expect(processSyncTransfer(db, { phase: "commit", id: plan.id }, lock)).resolves.toMatchObject({ status: "applied" });
    expect(cloud.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(cloud.prepare("SELECT COUNT(*) n FROM RadarRecord").get()).toMatchObject({ n: rows.filter(row => row.table === "RadarRecord").length });
  }, 60000);
});
