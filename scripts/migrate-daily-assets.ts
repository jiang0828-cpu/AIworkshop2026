import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL || "file:../data/ai-workbench.db";
if (!url.startsWith("file:")) throw new Error("Local SQLite only");
const file = resolve("prisma", url.slice(5));
if (!existsSync(file)) throw new Error("Initialize local database first");
const db = new DatabaseSync(file);
try {
  db.exec("PRAGMA busy_timeout=15000");
  const columns = db.prepare('PRAGMA table_info("DailyAgent")').all();
  if (columns.some((row) => row.name === "capabilities")) console.log("Daily Agent assets migration already applied.");
  else {
    db.prepare("VACUUM INTO ?").run(`${file}.before-daily-assets-${Date.now()}.db`);
    db.exec("BEGIN IMMEDIATE");
    try { db.exec(readFileSync(resolve("cloudflare/migrations/0016_daily_assets.sql"), "utf8")); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
    console.log("Local database backed up; Agent assets migration applied. No remote writes.");
  }
} finally { db.close(); }
