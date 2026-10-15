import { PrismaClient } from "@prisma/client";
import { schedulerTick } from "../src/lib/daily/scheduler";
import { researchTick } from "../src/lib/research/scheduler";
import { initializeDaily } from "../src/lib/daily/service";

const db = new PrismaClient();
let stopping = false;
const dailyOnly = process.argv.includes("--daily-only");
const manualNews = process.argv.includes("--manual-news");
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
async function main() {
  console.log("每日协同调度器已启动：并行上限 3，日报时间 Asia/Shanghai 22:00");
  if (!dailyOnly) console.log(manualNews ? "研判队列已启用；资讯仅处理手动入队作业" : "研判队列与已启用的定时资讯已启用");
  while (!stopping) {
    try {
      await initializeDaily(db);
      const config = { apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL, tavilyKey: process.env.TAVILY_API_KEY };
      if (dailyOnly) await schedulerTick(db, config);
      else await Promise.all([schedulerTick(db, config), researchTick(db, config, { automaticNews: !manualNews })]);
    } catch { console.error("调度失败，请检查数据库迁移与服务端配置；稍后重试。"); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await db.$disconnect();
}
void main();
