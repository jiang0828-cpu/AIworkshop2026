import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { configureNews, newsConfig, enqueueNews } from "../src/lib/radar/news";
import { withDailyLock, initializeDaily } from "../src/lib/daily/service";
const url=process.env.DATABASE_URL||"file:../data/ai-workbench.db";
async function main(){
  if(!url.startsWith("file:"))throw Error("Local SQLite only");
  if(!process.env.AI_API_KEY||!process.env.TAVILY_API_KEY)throw Error("Configure AI_API_KEY and TAVILY_API_KEY first");
  const path=resolve("prisma",url.slice(5));if(!existsSync(path))throw Error("Local database missing");
  const sql=new DatabaseSync(path);try{sql.exec("PRAGMA busy_timeout=15000");sql.prepare("VACUUM INTO ?").run(`${path}.before-daily-news-${Date.now()}.db`);sql.exec("PRAGMA journal_mode=WAL");}finally{sql.close();}
  const db=new PrismaClient();try{
    await initializeDaily(db);
    await withDailyLock(db,async()=>{const config=await newsConfig(db);await configureNews(db,{version:config.version,payload:{...config.payload,enabled:true,...(process.argv.includes("--ready-by-seven")?{time:"05:00"}:process.argv.includes("--at-seven")?{time:"07:00"}:{})}});if(process.argv.includes("--run-now"))console.log(await enqueueNews(db,{requestId:crypto.randomUUID()}));});
    console.log("Local backup created; daily news enabled. No remote operations.");
  }finally{await db.$disconnect();}
}
main().catch(()=>{console.error("Daily news initialization failed; check local database and configuration.");process.exitCode=1;});
