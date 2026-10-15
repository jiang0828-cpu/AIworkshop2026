import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { orchestrate } from "../src/lib/daily/provider";
import { parsePlan } from "../src/lib/daily/provider";

const db = new PrismaClient();
const nativeFetch = globalThis.fetch;
let diagnostic: unknown = null;
globalThis.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.ok) {
    const body = await response.clone().json();
    const content = body.choices?.[0]?.message?.content;
    if (content) {
      try { parsePlan(content); diagnostic = { valid: true, usage: body.usage }; }
      catch (error) { diagnostic = { valid: false, error: error instanceof Error ? error.message : "Validation failed", output: content }; }
    }
  }
  return response;
};
async function main() { try {
  const agents = await db.dailyAgent.findMany({ where: { profileId: "local-profile" } });
  const scenes = await db.workbenchScene.findMany({ where: { profileId: "local-profile" } });
  const result = await orchestrate("今天整理一份30分钟产品需求访谈提纲，包含5个开放问题、记录模板和验收清单。产品方向未知，仅提供文本，不能联网或外发。", "2026-10-08", agents,
    { apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL }, scenes);
  mkdirSync("output/daily-orchestration", { recursive: true });
  writeFileSync("output/daily-orchestration/model-verification.json", JSON.stringify({ diagnostic, result, businessRecordsCreated: 0 }, null, 2));
  console.log(JSON.stringify({ source: result.source, tasks: result.tasks.length, warning: "warning" in result ? result.warning : null, businessRecordsCreated: 0 }));
} finally { globalThis.fetch = nativeFetch; await db.$disconnect(); } }
void main();
