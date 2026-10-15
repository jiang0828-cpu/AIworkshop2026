import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL || "file:../data/ai-workbench.db";
if (!url.startsWith("file:")) throw new Error("Local SQLite only");
const path = resolve("prisma", url.slice(5));
if (!existsSync(path)) throw new Error("Initialize local database first");
const db = new DatabaseSync(path);
try {
  db.exec("PRAGMA busy_timeout=15000");
  const columns = db.prepare('PRAGMA table_info("DailyTask")').all();
  if (columns.some((row) => row.name === "orchestration")) console.log("Daily orchestration migration already applied.");
  else {
    db.prepare("VACUUM INTO ?").run(`${path}.before-daily-orchestration-${Date.now()}.db`);
    db.exec('ALTER TABLE "DailyTask" ADD COLUMN "orchestration" TEXT NOT NULL DEFAULT \'{}\'');
    console.log("Local database backed up; daily orchestration migration applied. No remote writes.");
  }
} finally { db.close(); }
