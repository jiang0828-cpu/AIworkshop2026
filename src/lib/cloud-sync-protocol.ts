import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { PROFILE_ID } from "./profile-id";
import { syncBaseline, syncCommitStatements, syncDigest, syncModels, syncRowSqlPredicate, validateStagedReferences, validateSyncRow } from "./cloud-sync-transfer";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = { id: z.string().uuid() };
const largeRow = { position: z.number().int().min(0), table: z.string(), rowDigest: hash, partCount: z.number().int().min(1).max(200) };
const inputSchema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("begin"), rowCount: z.number().int().min(1).max(100000), digest: hash }),
  z.object({ ...base, phase: z.literal("status") }),
  z.object({ ...base, phase: z.literal("chunk"), rows: z.array(z.object({ position: z.number().int().min(0), table: z.string(), data: z.record(z.union([z.string(), z.number(), z.null()])), digest: hash })).min(1).max(40) }),
  z.object({ ...base, phase: z.literal("commit") }),
  z.object({ ...base, ...largeRow, phase: z.literal("parts"), parts: z.array(z.object({ index: z.number().int().min(0), content: z.string().max(48000), digest: hash })).min(1).max(5) }),
  z.object({ ...base, ...largeRow, phase: z.literal("assemble") }),
]);
type Session = { id: string; profileId: string; rowCount: number; digest: string; baseline: string; status: string; expiresAt: number };
export class SyncConflict extends Error {}

// Rows remain private staging data until a single atomic database batch applies the snapshot.
export async function processSyncTransfer(db: D1Database, raw: unknown, lock: <T>(callback: () => Promise<T>) => Promise<T>) {
  const input = inputSchema.parse(raw);
  if (input.phase === "begin") {
    await db.prepare('DELETE FROM "CloudSyncSession" WHERE expiresAt<?').bind(Date.now()).run();
    const baseline = await syncBaseline(db);
    await db.prepare('INSERT INTO "CloudSyncSession" (id,profileId,rowCount,digest,baseline,createdAt,expiresAt) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(input.id, PROFILE_ID, input.rowCount, input.digest, baseline, Date.now(), Date.now() + 3600000).run();
  }
  const session = await db.prepare('SELECT * FROM "CloudSyncSession" WHERE id=? AND profileId=?').bind(input.id, PROFILE_ID).first<Session>();
  if (!session || session.expiresAt < Date.now()) throw new SyncConflict("同步会话已过期，请重新同步");
  if (input.phase === "begin" && (session.digest !== input.digest || session.rowCount !== input.rowCount)) throw new SyncConflict("同步批次内容不一致");
  if (session.status === "applied") return { ok: true, status: "applied", rowCount: session.rowCount, digest: session.digest };
  if (input.phase === "begin" || input.phase === "status") {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM "CloudSyncRow" WHERE sessionId=?').bind(input.id).first<{ n: number }>();
    return { ok: true, status: "uploading", uploaded: count?.n || 0, rowCount: session.rowCount };
  }
  if (input.phase === "parts" || input.phase === "assemble") {
    if (input.position >= session.rowCount || !syncModels.some(model => model.name === input.table)) throw new SyncConflict("同步记录位置或类型无效");
    if (input.phase === "parts") {
      const statements = [];
      for (const part of input.parts) {
        if (part.index >= input.partCount || await syncDigest(part.content) !== part.digest) throw new SyncConflict("大档案分片校验失败");
        const previous = await db.prepare('SELECT digest,rowDigest,tableName,partCount FROM "CloudSyncPart" WHERE sessionId=? AND position=? AND partIndex=?').bind(input.id, input.position, part.index).first<{ digest: string; rowDigest: string; tableName: string; partCount: number }>();
        if (previous && (previous.digest !== part.digest || previous.rowDigest !== input.rowDigest || previous.tableName !== input.table || previous.partCount !== input.partCount)) throw new SyncConflict("不能修改已上传的档案分片");
        statements.push(db.prepare('INSERT INTO "CloudSyncPart" (sessionId,position,partIndex,tableName,rowDigest,partCount,content,digest) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM "CloudSyncSession" WHERE id=? AND status=\'uploading\') ON CONFLICT(sessionId,position,partIndex) DO NOTHING')
          .bind(input.id, input.position, part.index, input.table, input.rowDigest, input.partCount, part.content, part.digest, input.id));
      }
      await db.batch(statements);
      return { ok: true, status: "uploading" };
    }
    const parts = await db.prepare('SELECT partIndex,digest,tableName,rowDigest,partCount FROM "CloudSyncPart" WHERE sessionId=? AND position=? ORDER BY partIndex').bind(input.id, input.position).all<{ partIndex: number; digest: string; tableName: string; rowDigest: string; partCount: number }>();
    if (parts.results.length !== input.partCount || parts.results.some((part, index) => part.partIndex !== index || part.tableName !== input.table || part.rowDigest !== input.rowDigest || part.partCount !== input.partCount)) throw new SyncConflict("大档案尚未传输完整");
    if (await syncDigest(`${input.table}\n${parts.results.map(part => part.digest).join("\n")}`) !== input.rowDigest) throw new SyncConflict("大档案完整性校验失败");
    const previous = await db.prepare('SELECT digest FROM "CloudSyncRow" WHERE sessionId=? AND position=?').bind(input.id, input.position).first<{ digest: string }>();
    if (previous && previous.digest !== input.rowDigest) throw new SyncConflict("不能替换已上传的档案");
    await db.prepare(`INSERT INTO "CloudSyncRow" (sessionId,position,tableName,rowId,data,digest) SELECT ?,?,?,json_extract(data,'$.id'),data,? FROM (SELECT group_concat(content,'') AS data FROM (SELECT content FROM "CloudSyncPart" WHERE sessionId=? AND position=? ORDER BY partIndex)) WHERE ${syncRowSqlPredicate(input.table)} AND EXISTS (SELECT 1 FROM "CloudSyncSession" WHERE id=? AND status='uploading') ON CONFLICT(sessionId,position) DO NOTHING`)
      .bind(input.id, input.position, input.table, input.rowDigest, input.id, input.position, input.id).run();
    const assembled = await db.prepare('SELECT digest FROM "CloudSyncRow" WHERE sessionId=? AND position=?').bind(input.id, input.position).first<{ digest: string }>();
    if (assembled?.digest !== input.rowDigest) throw new SyncConflict("大档案字段或归属校验失败");
    return { ok: true, status: "uploading" };
  }
  if (input.phase === "chunk") {
    const statements = [];
    for (const row of input.rows) {
      validateSyncRow(row);
      if (row.position >= session.rowCount) throw new SyncConflict("同步记录位置无效");
      const data = JSON.stringify(row.data);
      if (await syncDigest(`${row.table}\n${data}`) !== row.digest) throw new SyncConflict("同步记录校验失败");
      const previous = await db.prepare('SELECT digest,tableName,rowId FROM "CloudSyncRow" WHERE sessionId=? AND position=?').bind(input.id, row.position).first<{ digest: string; tableName: string; rowId: string }>();
      if (previous && (previous.digest !== row.digest || previous.tableName !== row.table || previous.rowId !== row.data.id)) throw new SyncConflict("不能修改已上传的同步记录");
      statements.push(db.prepare('INSERT INTO "CloudSyncRow" (sessionId,position,tableName,rowId,data,digest) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM "CloudSyncSession" WHERE id=? AND status=\'uploading\') ON CONFLICT(sessionId,position) DO NOTHING')
        .bind(input.id, row.position, row.table, row.data.id, data, row.digest, input.id));
    }
    await db.batch(statements);
    return { ok: true, status: "uploading", accepted: input.rows.length };
  }
  return lock(async () => {
    const latest = await db.prepare('SELECT status FROM "CloudSyncSession" WHERE id=?').bind(input.id).first<{ status: string }>();
    if (latest?.status === "applied") return { ok: true, status: "applied", rowCount: session.rowCount, digest: session.digest };
    const rows = await db.prepare('SELECT position,tableName,digest FROM "CloudSyncRow" WHERE sessionId=? ORDER BY position').bind(input.id).all<{ position: number; tableName: string; digest: string }>();
    if (rows.results.length !== session.rowCount || rows.results.some((row, index) => row.position !== index)) throw new SyncConflict("数据尚未传输完整，未修改线上数据");
    if (await syncDigest(rows.results.map(row => row.digest).join("\n")) !== session.digest) throw new SyncConflict("完整快照校验失败，未修改线上数据");
    if (await syncBaseline(db) !== session.baseline) throw new SyncConflict("传输期间线上资料已修改，请先备份线上变更再重新同步");
    await validateStagedReferences(db, input.id);
    const profiles = await db.prepare('SELECT COUNT(*) AS n FROM "CloudSyncRow" WHERE sessionId=? AND tableName=\'Profile\'').bind(input.id).first<{ n: number }>();
    if (profiles?.n !== 1) throw new SyncConflict("同步快照缺少唯一档案");
    const order = [...new Set(rows.results.map(row => row.tableName))];
    await db.batch(syncCommitStatements(db, input.id, order));
    // Keep the small receipt so a timed-out client can safely query or repeat commit.
    await db.prepare('DELETE FROM "CloudSyncRow" WHERE sessionId=?').bind(input.id).run();
    await db.prepare('DELETE FROM "CloudSyncPart" WHERE sessionId=?').bind(input.id).run();
    return { ok: true, status: "applied", rowCount: session.rowCount, digest: session.digest };
  });
}
