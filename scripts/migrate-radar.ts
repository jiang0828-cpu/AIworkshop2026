import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { importLegacyRadar } from "../src/lib/radar/migration";
const url = process.env.DATABASE_URL || "file:../data/ai-workbench.db";
if (!url.startsWith("file:")) throw new Error("Local SQLite only");
const path = resolve("prisma", url.slice(5));
if (!existsSync(path)) throw new Error("Initialize local database first");
async function main() {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA busy_timeout=15000");
  try {
    sqlite.prepare("VACUUM INTO ?").run(`${path}.before-radar-${Date.now()}.db`);
    if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='RadarRecord'").get()) sqlite.exec(readFileSync("cloudflare/migrations/0010_external_radar.sql", "utf8"));
  } finally { sqlite.close(); }
  const db = new PrismaClient();
  try { const result = await importLegacyRadar(db); console.log(`Local backup created; radar records mapped: ${result.mapped}. No remote writes.`); }
  finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Migration failed"); process.exitCode = 1; });
