import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { shanghaiDate } from "../src/lib/daily/shared";

// This verification performs paid model calls and saves a draft only.
const db = new PrismaClient();
const base = process.env.EXECUTION_PREVIEW_URL || "http://localhost:3012";
const directory = resolve("output/execution-plan-verification");
mkdirSync(directory, { recursive: true });
const stamp = Date.now();
async function sources() {
  return { profile: await db.profile.findUniqueOrThrow({ where: { id: "local-profile" } }), goals: await db.goal.findMany({ orderBy: { id: "asc" } }), projects: await db.project.findMany({ orderBy: { id: "asc" } }), actions: await db.action.findMany({ orderBy: { id: "asc" } }) };
}
async function post(body: unknown) {
  const response = await fetch(`${base}/api/execution-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function main() { try {
  const sqlite = new DatabaseSync(resolve("prisma", (process.env.DATABASE_URL || "file:../data/ai-workbench.db").slice(5)));
  try { sqlite.exec("PRAGMA busy_timeout=15000"); sqlite.prepare("VACUUM INTO ?").run(resolve(directory, `before-${stamp}.db`)); } finally { sqlite.close(); }
  const before = await sources();
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const input = { capacity: { startDate: shanghaiDate(), weeklyHours: null, weekdays: [], budget: null, budgetNote: "真实时间与投入未确认，执行暂缓" }, allowSensitive: true, signalIds: [], instruction: "利用当前档案和全部愿景独立形成完整规划，优先匹配已有记录并保留状态。时间、日期和预算未知，不虚构为可用，任务暂缓；明确核实行动，待用户补充真实容量后安排。" };
  const preview = await post({ action: "preview", input });
  let plan = await post({ action: "create", id: `execution-verification-${stamp}`, input, fingerprint: preview.fingerprint });
  console.log(JSON.stringify({ phase: "preview", id: plan.id, sourceCount: preview.sources.filter((source: { blocked: boolean }) => !source.blocked).length, missingCount: preview.missing.length }));
  plan = await post({ action: "stage", id: plan.id, revision: plan.revision, stage: "generate" });
  console.log(JSON.stringify({ phase: "generate", id: plan.id, status: plan.status, goals: plan.draft?.goals.length || 0, projects: plan.draft?.projects.length || 0, tasks: plan.draft?.tasks.length || 0, error: plan.error }));
  if (plan.draft && plan.status !== "failed") plan = await post({ action: "stage", id: plan.id, revision: plan.revision, stage: "review" });
  const after = await sources();
  const receipt = { id: plan.id, status: plan.status, revision: plan.revision, goals: plan.draft?.goals.length || 0, projects: plan.draft?.projects.length || 0, tasks: plan.draft?.tasks.length || 0, issues: plan.issues?.length || 0, logs: plan.logs, existingRecordsUnchanged: digest(before) === digest(after), countsBefore: { goals: before.goals.length, projects: before.projects.length, actions: before.actions.length }, error: plan.error, confirmed: false, started: false };
  writeFileSync(resolve(directory, `receipt-${stamp}.json`), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  if (plan.status !== "ready") process.exitCode = 1;
} finally { await db.$disconnect(); } }
void main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
