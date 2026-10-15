import { PrismaClient } from "@prisma/cloudflare-client/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { D1Database, ScheduledController } from "@cloudflare/workers-types";
import type { PrismaClient as LocalPrismaClient } from "@prisma/client";
import { schedulerTick } from "../src/lib/daily/scheduler";
import { researchTick } from "../src/lib/research/scheduler";
import { initializeDaily } from "../src/lib/daily/service";

interface DailyWorkerEnv {
  WORKBENCH_DB: D1Database;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  TAVILY_API_KEY?: string;
}
const worker = {
  async scheduled(_event: ScheduledController, env: DailyWorkerEnv) {
    const db = new PrismaClient({ adapter: new PrismaD1(env.WORKBENCH_DB) }) as unknown as LocalPrismaClient;
    try { await initializeDaily(db); const config = { apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL, model: env.AI_MODEL, tavilyKey: env.TAVILY_API_KEY }; await Promise.all([schedulerTick(db, config), researchTick(db, config)]); }
    finally { await db.$disconnect(); }
  },
};
export default worker;
