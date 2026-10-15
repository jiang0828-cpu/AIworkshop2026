import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL || "file:../data/ai-workbench.db";
if (!url.startsWith("file:")) throw new Error("Local SQLite only");
const path = resolve("prisma", url.slice(5));
if (!existsSync(path)) throw new Error("Initialize local database first");
const db = new DatabaseSync(path);
try {
  db.exec("PRAGMA busy_timeout=15000");
  db.prepare("VACUUM INTO ?").run(`${path}.before-execution-plan-${Date.now()}.db`);
  db.exec(readFileSync("cloudflare/migrations/0011_execution_plan.sql", "utf8"));
  console.log("Local database backed up; execution plan migration applied. No remote writes.");
} finally { db.close(); }
