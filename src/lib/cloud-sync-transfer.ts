import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { prismaModels } from "./prisma-models";
import { PROFILE_ID } from "./profile-id";
import type { SyncRow } from "./database-writes";

export const SYNC_PROTOCOL = 2;
const excluded = new Set(["DailyControl", "RecordNumberSequence"]);
export const syncModels = prismaModels.filter(model => !excluded.has(model.name));
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const scalarFields = (model: typeof syncModels[number]) => model.fields.filter(field => field.kind !== "object");
export async function syncDigest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function syncParts(table: string, data: string) {
  const parts = [];
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + 24000, data.length);
    if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
    const content = data.slice(start, end);
    parts.push({ index: parts.length, content, digest: await syncDigest(content) });
    start = end;
  }
  return { parts, digest: await syncDigest(`${table}\n${parts.map(part => part.digest).join("\n")}`) };
}

// Validate large rows inside D1 without loading their entire JSON into Worker memory.
export function syncRowSqlPredicate(table: string) {
  const model = syncModels.find(model => model.name === table);
  if (!model) throw new Error("同步表不在允许范围内");
  const fields = scalarFields(model);
  const checks = ["json_type(data)='object'", `(SELECT COUNT(*) FROM json_each(data))=${fields.length}`,
    `NOT EXISTS (SELECT 1 FROM json_each(data) WHERE key NOT IN (${fields.map(field => `'${field.name}'`).join(",")}))`];
  for (const field of fields) {
    const type = `json_type(data,'$.${field.name}')`, value = `json_extract(data,'$.${field.name}')`;
    const valid = field.type === "String" ? `${type}='text'` : field.type === "Boolean" ? `(${type}='integer' AND ${value} IN (0,1))` : ["Int", "DateTime"].includes(field.type) ? `${type}='integer'` : `${type} IN ('integer','real')`;
    checks.push(`${type} IS NOT NULL AND (${field.isRequired ? valid : `${type}='null' OR (${valid})`})`);
  }
  checks.push("length(json_extract(data,'$.id'))>0");
  if (table === "Profile" || fields.some(field => field.name === "profileId")) checks.push(`json_extract(data,'$.${table === "Profile" ? "id" : "profileId"}')='${PROFILE_ID}'`);
  return `CASE WHEN json_valid(data) THEN (${checks.map(check => `(${check})`).join(" AND ")}) ELSE 0 END`;
}
export function validateSyncRow(row: SyncRow) {
  const model = syncModels.find(model => model.name === row.table);
  if (!model) throw new Error("同步表不在允许范围内");
  const fields = scalarFields(model);
  if (Object.keys(row.data).length !== fields.length || fields.some(field => !(field.name in row.data))) throw new Error("同步记录字段不完整");
  for (const field of fields) {
    const value = row.data[field.name];
    if (value === null) { if (field.isRequired) throw new Error("同步必填字段为空"); continue; }
    if (field.type === "String" ? typeof value !== "string" : typeof value !== "number" || !Number.isFinite(value) || (["Int", "DateTime", "Boolean"].includes(field.type) && !Number.isInteger(value))) throw new Error("同步字段类型无效");
    if (field.type === "Boolean" && ![0, 1].includes(Number(value))) throw new Error("同步布尔字段无效");
  }
  if (model.name === "Profile" ? row.data.id !== PROFILE_ID : "profileId" in row.data && row.data.profileId !== PROFILE_ID) throw new Error("同步记录不属于当前档案");
  if (typeof row.data.id !== "string" || !row.data.id) throw new Error("同步记录缺少 ID");
  return row;
}

// Only local changes to user records block replacement; scheduler heartbeats and usage counters do not.
export async function syncBaseline(db: D1Database) {
  const tables = syncModels.filter(model => model.name !== "Profile" && !["ResearchBatch", "ExecutionPlan", "DailyRun", "DailyTimer"].includes(model.name));
  const statements = tables.map(model => {
    const field = model.fields.find(field => field.name === "updatedAt") ? '"updatedAt"' : model.fields.find(field => field.name === "createdAt") ? '"createdAt"' : "0";
    return `SELECT '${model.name}' AS name,COUNT(*) AS n,MAX(${field}) AS changed FROM ${quote(model.name)} WHERE ${ownership(model)}${model.name === "RadarRecord" ? " AND kind NOT IN ('newsRun','newsSource','newsUsage','newsConfig','job')" : ""}`;
  });
  statements.unshift('SELECT \'Profile\' AS name,COUNT(*) AS n,MAX("updatedAt") AS changed FROM "Profile" WHERE id=?');
  const results = await db.batch(statements.map(statement => db.prepare(statement).bind(PROFILE_ID)));
  const rows = results.flatMap(result => result.results);
  return syncDigest(JSON.stringify(rows));
}

function ownership(model: typeof syncModels[number]): string | null {
  if (model.name === "Profile") return '"id"=?';
  if (model.fields.some(field => field.name === "profileId")) return '"profileId"=?';
  for (const relation of model.fields.filter(field => field.kind === "object" && field.relationFromFields?.length)) {
    const parent = syncModels.find(item => item.name === relation.type);
    if (!parent || parent.name === model.name) continue;
    const scope = ownership(parent);
    if (scope) return `${quote(relation.relationFromFields![0])} IN (SELECT ${quote(relation.relationToFields![0])} FROM ${quote(parent.name)} WHERE ${scope})`;
  }
  return null;
}

export function syncCommitStatements(db: D1Database, sessionId: string, order: string[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  // Deleting parents uses the schema's cascades; every explicit delete is scoped to this Profile.
  for (const model of [...syncModels].reverse().filter(model => model.name !== "Profile")) {
    const scope = ownership(model);
    if (!scope) throw new Error(`同步表缺少归属路径：${model.name}`);
    statements.push(db.prepare(`DELETE FROM ${quote(model.name)} WHERE ${scope}${model.name === "RadarRecord" ? " AND kind!='newsUsage'" : ""}`).bind(PROFILE_ID));
  }
  for (const name of order) {
    const model = syncModels.find(model => model.name === name);
    if (!model) throw new Error("同步表无效");
    const fields = scalarFields(model).map(field => field.name);
    const merge = name === "Profile" ? ` ON CONFLICT(id) DO UPDATE SET ${fields.filter(field => field !== "id").map(field => `${quote(field)}=excluded.${quote(field)}`).join(",")}`
      : name === "RadarRecord" ? ` ON CONFLICT(id) DO UPDATE SET payload=json_object('date',json_extract(excluded.payload,'$.date'),'search',max(json_extract("RadarRecord".payload,'$.search'),json_extract(excluded.payload,'$.search')),'extract',max(json_extract("RadarRecord".payload,'$.extract'),json_extract(excluded.payload,'$.extract')),'model',max(json_extract("RadarRecord".payload,'$.model'),json_extract(excluded.payload,'$.model'))),version=max("RadarRecord".version,excluded.version)+1` : "";
    statements.push(db.prepare(`INSERT INTO ${quote(name)} (${fields.map(quote).join(",")}) SELECT ${fields.map(field => `json_extract(data,'$.${field}')`).join(",")} FROM "CloudSyncRow" WHERE sessionId=? AND tableName=? ORDER BY position${merge}`).bind(sessionId, name));
  }
  statements.push(db.prepare('UPDATE "CloudSyncSession" SET status=\'applied\' WHERE id=? AND profileId=?').bind(sessionId, PROFILE_ID));
  return statements;
}

export async function validateStagedReferences(db: D1Database, sessionId: string) {
  const checks: string[] = [];
  const parameters: string[] = [];
  for (const model of syncModels) for (const field of model.fields.filter(field => field.kind === "object" && field.relationFromFields?.length)) {
    if (!syncModels.some(model => model.name === field.type)) continue;
    const from = field.relationFromFields![0], to = field.relationToFields![0];
    checks.push(`SELECT c.rowId FROM "CloudSyncRow" c WHERE c.sessionId=? AND c.tableName='${model.name}' AND json_extract(c.data,'$.${from}') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CloudSyncRow" p WHERE p.sessionId=c.sessionId AND p.tableName='${field.type}' AND json_extract(p.data,'$.${to}')=json_extract(c.data,'$.${from}'))`);
    parameters.push(sessionId);
  }
  const results = await db.batch(checks.map((check, index) => db.prepare(`${check} LIMIT 1`).bind(parameters[index])));
  if (results.some(result => result.results.length)) throw new Error("同步关联缺失或不属于当前档案");
}
