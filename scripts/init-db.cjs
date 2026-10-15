const path = require("node:path");
const cp = require("node:child_process");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const url = process.env.DATABASE_URL || "file:../data/ai-workbench.db";
if (!url.startsWith("file:")) throw new Error("Local migration requires a SQLite file URL");
const database = path.resolve(root, "prisma", url.slice(5));
if (fs.existsSync(database)) {
  const backup = `${database}.before-migration-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.db`;
  const sqlite = new DatabaseSync(database);
  try { sqlite.prepare("VACUUM INTO ?").run(backup); } finally { sqlite.close(); }
  console.log("SQLite backup created before schema migration");
}
cp.execFileSync(process.execPath, [prismaCli, "generate"], { cwd: root, stdio: "inherit" });
cp.execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], { cwd: root, stdio: "inherit" });
cp.execFileSync(process.execPath, [path.join(root, "scripts", "migrate-delivery-codes.mjs")], { cwd: root, stdio: "inherit" });
console.log("SQLite schema synchronized from prisma/schema.prisma");
cp.execFileSync(process.execPath, [path.join(root, "scripts", "migrate-system-scene.mjs")], { cwd: root, stdio: "inherit" });
