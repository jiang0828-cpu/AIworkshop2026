import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const url = process.env.DATABASE_URL || "file:../data/ai-workbench.db";
if (!url.startsWith("file:")) throw new Error("This command only migrates local SQLite");
const database = path.resolve(root, "prisma", url.slice(5));
if (!fs.existsSync(database)) throw new Error("Initialize the database with npm run db:migrate first");
const sqlite = new DatabaseSync(database);
try {
  const columns = sqlite.prepare('PRAGMA table_info("Goal")').all();
  if (columns.some((column) => column.name === "sceneId")) {
    if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='WorkbenchScene'").get()) throw new Error("Inconsistent migration state; restore the backup before proceeding");
    console.log("Five-module migration already applied");
  } else {
    const backup = `${database}.before-five-modules-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.db`;
    sqlite.prepare("VACUUM INTO ?").run(backup);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(fs.readFileSync(path.join(root, "cloudflare/migrations/0004_five_modules.sql"), "utf8"));
      sqlite.exec("COMMIT"); console.log("SQLite backed up and incrementally migrated");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }
} finally { sqlite.close(); }
