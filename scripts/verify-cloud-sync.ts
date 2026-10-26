import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prismaModels } from "../src/lib/prisma-models";
import { pauseRestoredNews } from "../src/lib/radar/news";
import { parsePayload } from "../src/lib/strategy/shared";

const tables = ["Profile", "Goal", "Project", "Action", "WorkbenchScene", "StrategyRecord", "StrategyVersion", "Experience", "Evidence", "Resource", "ValueRule", "Constraint", "Assumption"];
const source = new PrismaClient();
const remote = new DatabaseSync(":memory:");
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string") { try { return canonical(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function preservesOriginal(original: unknown, restored: unknown): boolean {
  if (original && restored && typeof original === "object" && typeof restored === "object") {
    if (Array.isArray(original) && (!Array.isArray(restored) || original.length !== restored.length)) return false;
    return Object.entries(original).every(([key, value]) => key in restored && preservesOriginal(value, (restored as Record<string, unknown>)[key]));
  }
  return original === restored;
}
function sameWithSchemaDefaults(table: string, row: Record<string, unknown>, field: string, restored: unknown) {
  if (!((table === "StrategyRecord" && field === "payload") || (table === "StrategyVersion" && field === "snapshot"))) return false;
  try {
    const original = JSON.parse(String(row[field])), current = JSON.parse(String(restored));
    const normalized = table === "StrategyRecord" ? parsePayload(String(row.kind) as Parameters<typeof parsePayload>[0], original)
      : { ...original, payload: parsePayload(original.kind, original.payload) };
    return preservesOriginal(original, current) && hash(normalized) === hash(current);
  } catch { return false; }
}
async function main() {
  if (!process.argv[2]) throw new Error("Pass the private remote D1 SQL export path");
  remote.exec("PRAGMA foreign_keys=OFF");
  remote.exec(readFileSync(process.argv[2], "utf8"));
  remote.exec("PRAGMA foreign_keys=ON");
  const results = [];
  for (const table of tables) {
    const model = prismaModels.find(model => model.name === table)!;
    const fields = model.fields.filter(field => field.kind !== "object" && !["createdAt", "updatedAt"].includes(field.name)).map(field => field.name);
    const sql = `SELECT ${fields.map(field => `"${field}"`).join(",")} FROM "${table}" WHERE "${table === "Profile" ? "id" : "profileId"}"=? ORDER BY id`;
    const local = await source.$queryRawUnsafe<Record<string, unknown>[]>(sql, "local-profile");
    const cloud = remote.prepare(sql).all("local-profile") as Record<string, unknown>[];
    let legacyDefaults = 0;
    const differences = local.flatMap(row => {
      const match = cloud.find(item => item.id === row.id);
      return !match ? ["missing-record"] : fields.filter(field => {
        if (hash(row[field]) === hash(match[field])) return false;
        if (sameWithSchemaDefaults(table, row, field, match[field])) { legacyDefaults++; return false; }
        return true;
      });
    });
    results.push({ table, local: local.length, cloud: cloud.length, matches: local.length === cloud.length && !differences.length, legacyDefaults, differingFields: [...new Set(differences)] });
  }
  const integrity = remote.prepare("PRAGMA integrity_check").get();
  const foreignKeys = remote.prepare("PRAGMA foreign_key_check").all().length;
  const archiveCount = remote.prepare("SELECT COUNT(*) n FROM RadarRecord").get();
  let archives: { checked: number; differingRows: number } | null = null;
  if (process.argv[3]) {
    const snapshot = new DatabaseSync(process.argv[3], { readOnly: true });
    const fields = prismaModels.find(model => model.name === "RadarRecord")!.fields.filter(field => field.kind !== "object" && !["createdAt", "updatedAt"].includes(field.name)).map(field => field.name);
    const lookup = remote.prepare("SELECT * FROM RadarRecord WHERE id=? AND profileId='local-profile'");
    archives = { checked: 0, differingRows: 0 };
    try {
      for (const record of snapshot.prepare("SELECT * FROM RadarRecord WHERE profileId='local-profile'").iterate()) {
        const row = pauseRestoredNews(record as unknown as { kind: string; payload: string; status: string } & Record<string, string | number | null>);
        if (row.kind === "job" && row.status !== "review") row.status = "failed";
        const found = lookup.get(row.id);
        archives.checked++;
        if (!found || fields.some(field => row.kind === "newsUsage" && field === "version" ? false : row.kind === "newsUsage" && field === "payload" ? hash(row[field]) !== hash(found[field]) : row[field] !== found[field])) archives.differingRows++;
      }
    } finally { snapshot.close(); }
  }
  const receipts = remote.prepare("SELECT status,rowCount FROM CloudSyncSession ORDER BY createdAt DESC LIMIT 1").all();
  const staging = remote.prepare("SELECT COUNT(*) n FROM CloudSyncRow").get();
  console.log(JSON.stringify({ results, integrity, foreignKeys, archiveCount, archives, receipts, staging }));
  if (results.some(row => !row.matches) || foreignKeys || archives?.differingRows) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; }).finally(async () => { remote.close(); await source.$disconnect(); });
