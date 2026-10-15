import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { columns, validateNews, newsRunSchema } from "../src/lib/radar/news-shared";
const db=new PrismaClient();
async function main(){
  if(process.argv.includes("--repair-cohort")){
    const id="news-2026-10-06-politics-09863738-53ac-458b-8e5d-1ada6a8f8f03";
    const row=await db.radarRecord.findUniqueOrThrow({where:{id}});
    const parent=await db.radarRecord.findUniqueOrThrow({where:{id:row.parentId!}});
    const p=JSON.parse(row.payload),original=JSON.parse(parent.payload);
    if(p.cutoff!==original.cutoff||p.column!==original.column)throw Error("Different source window");
    if(p.date!==original.date)await db.radarRecord.update({where:{id},data:{title:`${original.date} 最新时政`,payload:JSON.stringify({...p,date:original.date}),version:{increment:1}}});
  }
  const rows=await db.radarRecord.findMany({where:{profileId:"local-profile",kind:"newsRun"},orderBy:{createdAt:"asc"}});
  type Call={stage:string;credits?:number;promptTokens?:number;completionTokens?:number;durationMs?:number};
  const runs:Array<ReturnType<typeof newsRunSchema.parse>&{id:string;status:string;error:string;calls:Call[]}>=[];
  for(const row of rows){
    const p=newsRunSchema.parse(JSON.parse(row.payload)),batch=await db.researchBatch.findUniqueOrThrow({where:{id:row.id}});
    if(p.published)validateNews({items:p.items,gaps:p.gaps},p.sources,p.cutoff);
    runs.push({id:row.id,...p,status:batch.status,error:batch.error,calls:JSON.parse(batch.calls)});
  }
  const usage=(await db.radarRecord.findMany({where:{profileId:"local-profile",kind:"newsUsage"},orderBy:{title:"asc"}})).map(r=>JSON.parse(r.payload));
  const latest=columns.map(([id,label])=>({label,run:runs.findLast(r=>r.column===id&&r.published)}));
  const calls=runs.flatMap(r=>r.calls),models=calls.filter(c=>String(c.stage).includes("model")),search=calls.filter(c=>!String(c.stage).includes("model"));
  const metering={credits:search.reduce((n,c)=>n+(typeof c.credits==="number"?c.credits:0),0),unknownCredits:search.filter(c=>typeof c.credits!=="number").length,tokens:models.reduce((n,c)=>n+(c.promptTokens??0)+(c.completionTokens??0),0),unknownTokens:models.filter(c=>c.promptTokens==null||c.completionTokens==null).length,durationMs:calls.reduce((n,c)=>n+(c.durationMs??0),0)};
  const lines=["# 每日资讯真实联调报告",`核对时间：${new Date().toISOString()}`,"", "全部来源来自真实 Tavily 请求，模型调用来自当前服务端配置的 DeepSeek；使用原生工具模式。引用 ID 与支持摘录已逐条通过程序校验，未代表人工核实所有新闻事实。", "", "| 栏目 | 整理稿条数 | 24小时内 | 时间待核实 | 背景参考 | 来源候选数 |", "|---|---:|---:|---:|---:|---:|"];
  for(const {label,run:r} of latest)lines.push(`| ${label} | ${r?.items.length??0} | ${r?.items.filter((i:{timeliness:string})=>i.timeliness==="current").length??0} | ${r?.items.filter((i:{timeliness:string})=>i.timeliness==="unknown").length??0} | ${r?.items.filter((i:{timeliness:string})=>i.timeliness==="background").length??0} | ${r?.sources.length??0} |`);
  lines.push("","## 实际日期预算",...usage.map(u=>`- ${u.date}：检索 ${u.search}/80，正文提取 ${u.extract}/20，模型 ${u.model}/33。`),"","## 边界与异常","- 本轮开始于北京时间2026-10-05 23:55:41，跨午夜完成。资料仍归属于10月5日，截止时间未变；额度按实际请求日期计算。","- 时政、经济首轮因引用校验失败保留为失败历史；各用一次新模型调用重新整理原资料，没有再次检索。","- 科学技术与AGI曾遇本地数据库锁导致中断；明确重试，已有尝试保留计费记录。WAL及只读轮询修复后完成。","- 转载候选并不等于独立佐证。时间未知与背景参考不计入24小时资讯；不足处见各栏目缺口。","- 跨日联调占用10月6日额度，07:00采集受剩余额度约束，不会突破每日上限。","- 下面JSON保留每次调用的服务商实际credits/tokens、耗时和工具轨迹；中断或未返回用量显示未知，不估算。","","## 各栏目缺口",...latest.map(({label,run})=>`### ${label}\n${run?.gaps||"未返回缺口"}`));
  lines.push("","## 服务商返回用量",`已返回 credits：${metering.credits}；未知用量请求：${metering.unknownCredits}。`,`已返回 tokens：${metering.tokens}；未知用量模型请求：${metering.unknownTokens}。`,`已记录调用耗时合计：${Math.round(metering.durationMs/1000)}秒（非墙钟总耗时）。`);
  writeFileSync("data/daily-news-live-report.json",JSON.stringify({checkedAt:new Date().toISOString(),usage,metering,runs},null,2));
  writeFileSync("docs/daily-news-live-report.md",lines.join("\n"));
  console.log(JSON.stringify({completed:latest.filter(r=>r.run).length,items:latest.reduce((n,r)=>n+(r.run?.items.length||0),0),usage}));
}
main().finally(()=>db.$disconnect());
