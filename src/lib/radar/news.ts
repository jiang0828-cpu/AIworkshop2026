import type { PrismaClient, RadarRecord } from "@prisma/client";
import { z } from "zod";
import { owner, record, view, owned, saveRadar } from "./service";
import { columns, columnId, defaultNewsConfig, newsConfigSchema, newsRunSchema, newsUsageSchema, limits, scheduledToday, publishableNews, canRetryNews, recoverableNewsError } from "./news-shared";
import { shanghaiDate } from "../daily/shared";
import { writeTransaction } from "../database-writes";
const configId=`${owner.profileId}-news-config`;
export async function newsConfig(db:PrismaClient) {
  const existing=await db.radarRecord.findFirst({where:{...owner,id:configId}});
  const paused={...defaultNewsConfig(),enabled:false};
  return existing ? view(existing) : {...record("newsConfig",configId,"每日栏目设置",paused),payload:paused};
}
export async function configureNews(db:PrismaClient,input:unknown) {
  const body=z.object({version:z.number().int(),payload:newsConfigSchema}).parse(input);
  const existing=await db.radarRecord.findFirst({where:{...owner,id:configId}});
  if(existing){const changed=await db.radarRecord.updateMany({where:{...owner,id:configId,version:body.version},data:{payload:JSON.stringify(body.payload),version:{increment:1}}});if(!changed.count)throw Error("设置已变化，请刷新，输入尚未保存");}
  else {if(body.version!==1)throw Error("设置版本无效，请刷新");await db.radarRecord.create({data:record("newsConfig",configId,"每日栏目设置",body.payload)});}
  return {ok:true};
}
export async function enqueueNews(db:PrismaClient,input:unknown,automatic=false,now=new Date()) {
  const body=z.object({requestId:z.string().uuid().optional(),column:columnId.optional()}).parse(input);
  if(!automatic&&!body.requestId)throw Error("缺少请求标识");
  const config=newsConfigSchema.parse((await newsConfig(db)).payload),date=shanghaiDate(now);
  if(automatic&&!await db.radarRecord.findFirst({where:{...owner,id:configId}}))return {count:0};
  if(automatic&&(!config.enabled||!scheduledToday(now,config.time)))return {count:0};
  const selected=config.columns.filter(c=>c.enabled&&(!body.column||c.id===body.column));
  if(!selected.length)return {count:0};
  if(!automatic&&await db.radarRecord.findFirst({where:{...owner,kind:"newsRun",id:{endsWith:body.requestId}}}))return {count:0};
  const usage=await db.radarRecord.findFirst({where:{...owner,id:`${owner.profileId}-news-usage-${date}`}});
  if(usage&&JSON.parse(usage.payload).model>=limits.model){if(automatic)return {count:0};throw Error("今日模型额度已用完，请明日更新");}
  const pending=await db.researchBatch.count({where:{...owner,status:{in:["queued","collecting","analyzing"]},id:{startsWith:"news-"}}});
  if(!automatic&&pending)throw Error("每日资讯仍在运行，请完成后更新");
  if(!automatic){
    const today=await db.radarRecord.findMany({where:{...owner,kind:"newsRun",title:{startsWith:date}},orderBy:{createdAt:"desc"}});
    const latest=new Map<string,typeof today[number]>();for(const row of today){const p=newsRunSchema.parse(JSON.parse(row.payload));if(!latest.has(p.column))latest.set(p.column,row);}
    if([...latest.values()].some(r=>{const p=newsRunSchema.parse(JSON.parse(r.payload));return !p.published&&config.columns.some(c=>c.id===p.column&&c.enabled);} ))throw Error("请先补齐今日未完成栏目的整理；剩余额度优先用于已有资料");
  }
  let count=0;
  for(const col of selected){
    const id=`news-${date}-${col.id}-${automatic?"scheduled":body.requestId}`;
    if(await db.radarRecord.findFirst({where:{...owner,id}}))continue;
    if(automatic&&await db.radarRecord.findFirst({where:{...owner,kind:"newsRun",title:`${date} ${columns.find(c=>c[0]===col.id)![1]}`}}))continue;
    await writeTransaction(db,async tx=>{
      await tx.researchBatch.create({data:{id,...owner,question:`每日栏目：${col.id}`,online:false,background:"[]",queries:"[]"}});
      await tx.radarRecord.create({data:record("newsRun",id,`${date} ${columns.find(c=>c[0]===col.id)![1]}`,{batchId:id,column:col.id,date,cutoff:now.toISOString(),prompt:col.prompt.replaceAll("{date}",date)},{status:"queued",originKey:`news:${id}`})});
    });count++;
  }
  return {count};
}
// Compare-and-swap makes the daily reservation atomic in both SQLite and D1.
export async function reserveNews(db:PrismaClient,type:keyof typeof limits,date:string,searchReserve=0) {
  const id=`${owner.profileId}-news-usage-${date}`;
  await db.radarRecord.upsert({where:{id},create:record("newsUsage",id,`${date} 调用预算`,{date,search:0,extract:0,model:0}),update:{}});
  for(let i=0;i<8;i++){
    const row=await owned(db,id,"newsUsage"),p=newsUsageSchema.parse(JSON.parse(row.payload));
    if(p[type]>=limits[type]-(type==="search"?searchReserve:0))throw Error("每日调用额度不足，已保留资料，请明日更新");
    const updated=await db.radarRecord.updateMany({where:{...owner,id,version:row.version},data:{payload:JSON.stringify({...p,[type]:p[type]+1}),version:{increment:1}}});
    if(updated.count)return;
  }throw Error("预算正在被其他任务更新，请稍后重试");
}
export async function retryTransientNews(db:PrismaClient,now=new Date()) {
  const date=shanghaiDate(now),config=newsConfigSchema.parse((await newsConfig(db)).payload);
  if(!config.enabled)return;
  const usage=await db.radarRecord.findFirst({where:{...owner,id:`${owner.profileId}-news-usage-${date}`}});
  if(usage&&newsUsageSchema.parse(JSON.parse(usage.payload)).model>=limits.model)return;
  // Finish each column's first attempt before spending the shared recovery allowance.
  if(await db.researchBatch.count({where:{...owner,id:{startsWith:"news-"},status:{in:["queued","collecting","analyzing"]}}}))return;
  const failed=await db.researchBatch.findMany({where:{...owner,status:"failed",slot:null,id:{startsWith:"news-"}}});
  for(const batch of failed){
    const row=await db.radarRecord.findFirst({where:{...owner,id:batch.id,kind:"newsRun"}});if(!row)continue;
    const p=newsRunSchema.parse(JSON.parse(row.payload));
    if(p.date!==date||!config.columns.some(c=>c.id===p.column&&c.enabled)||!canRetryNews(batch.error,p))continue;
    const latest=await db.radarRecord.findFirst({where:{...owner,kind:"newsRun",title:row.title},orderBy:{createdAt:"desc"}});
    if(latest?.id!==row.id)continue;
    if(!p.retryAt){
      p.retryAt=new Date(batch.updatedAt.getTime()+60000).toISOString();
      await db.radarRecord.updateMany({where:{...owner,id:row.id,version:row.version},data:{payload:JSON.stringify(p),version:{increment:1}}});
      continue;
    }
    if(Date.parse(p.retryAt)>now.getTime())continue;
    // Caller holds the daily write lock; publish the queue and retry metadata atomically.
    await writeTransaction(db,async tx=>{
      await tx.radarRecord.update({where:{id:row.id},data:{status:"queued",payload:JSON.stringify({...p,automaticRetries:p.automaticRetries+1,retryAt:null,gaps:"临时服务错误后自动续跑，已保存资料与调用计数保留。"}),version:row.version+1}});
      await tx.researchBatch.update({where:{id:batch.id},data:{status:"queued",error:"",version:batch.version+1,updatedAt:now}});
    });
  }
  if(await db.researchBatch.count({where:{...owner,id:{startsWith:"news-"},status:{in:["queued","collecting","analyzing"]}}}))return;
  for(const batch of failed){
    if(!recoverableNewsError(batch.error))continue;
    const row=await db.radarRecord.findFirst({where:{...owner,id:batch.id,kind:"newsRun"}});if(!row)continue;
    const p=newsRunSchema.parse(JSON.parse(row.payload));
    if(p.date!==date||p.published||p.stage!=="final"||(p.modelCount<3&&p.automaticRetries<1)||!p.sources.length||!config.columns.some(c=>c.id===p.column&&c.enabled))continue;
    const latest=await db.radarRecord.findFirst({where:{...owner,kind:"newsRun",title:row.title},orderBy:{createdAt:"desc"}});
    if(latest?.id!==row.id||now.getTime()-batch.updatedAt.getTime()<60000)continue;
    await refinishNews(db,{id:row.id,requestId:crypto.randomUUID()});
    return;
  }
}
export async function newsView(db:PrismaClient,params:URLSearchParams) {
  const date=z.string().date().parse(params.get("date")||shanghaiDate()),column=columnId.parse(params.get("column")||"politics");
  const rows=await db.radarRecord.findMany({where:{...owner,kind:"newsRun",title:{startsWith:date}},orderBy:{createdAt:"desc"}});
  const ids=rows.map(r=>r.id),batches=await db.researchBatch.findMany({where:{...owner,id:{in:ids}},select:{id:true,status:true,error:true,calls:true}});
  const summary=columns.map(([id,label])=>{const runs=rows.filter(r=>JSON.parse(r.payload).column===id);const latest=runs[0],complete=runs.find(r=>JSON.parse(r.payload).published);return {id,label,runId:latest?.id,status:batches.find(b=>b.id===latest?.id)?.status||"未运行",publishedId:complete?.id};});
  const candidates=rows.filter(r=>JSON.parse(r.payload).column===column),selected=params.get("run")?candidates.find(r=>r.id===params.get("run")):candidates.find(r=>JSON.parse(r.payload).published)||candidates[0];
  const budgetDate=shanghaiDate(),usage=await db.radarRecord.findFirst({where:{...owner,id:`${owner.profileId}-news-usage-${budgetDate}`}}),control=await db.dailyControl.findUnique({where:{profileId:owner.profileId}});
  const current=selected?view(selected):null;
  const previous=!current||!JSON.parse(selected!.payload).published?await db.radarRecord.findFirst({where:{...owner,kind:"newsRun",status:"review",title:{endsWith:` ${columns.find(c=>c[0]===column)![1]}`}},orderBy:{createdAt:"desc"}}):null;
  const previousDate=previous?JSON.parse(previous.payload).date:null;
  if(current){const p=newsRunSchema.parse(current.payload);current.payload={...p,sources:p.sources.map(s=>({...s,content:p.published?"":s.content.slice(0,600)})),previousDate};}
  const page=z.coerce.number().int().min(1).max(10000).parse(params.get("historyPage")||1),size=20;
  const execution=batches.find(b=>b.id===selected?.id)||null;
  const hasSavedOutput=Boolean(execution&&JSON.parse(execution.calls).some((c:{output?:string})=>c.output));
  if(execution)execution.calls=JSON.stringify(JSON.parse(execution.calls).map((c:Record<string,unknown>)=>{const {output:_output,...safe}=c;void _output;return safe;}));
  const latest=batches.find(b=>b.id===candidates[0]?.id);
  const completion={completed:summary.filter(c=>c.publishedId).length,total:summary.length,deadline:`${date}T07:00:00+08:00`};
  return {date,column,previousDate,config:await newsConfig(db),columns:summary,completion,run:current,execution:execution?{...execution,hasSavedOutput}:null,latestExecution:latest?{id:latest.id,status:latest.status,error:latest.error}:null,history:candidates.slice((page-1)*size,page*size).map(r=>({id:r.id,title:r.title,createdAt:r.createdAt,status:batches.find(b=>b.id===r.id)?.status})),historyPage:page,historyTotal:candidates.length,usage:usage?JSON.parse(usage.payload):{date:budgetDate,search:0,extract:0,model:0},limits,heartbeat:control?.heartbeat||null};
}
export async function newsInformation(db:PrismaClient,input:unknown) {
  const body=z.object({id:z.string(),indexes:z.array(z.number().int().min(0)).min(1).max(15)}).parse(input);
  const run=await owned(db,body.id,"newsRun"),p=newsRunSchema.parse(JSON.parse(run.payload));
  const ids=[...new Set(body.indexes.flatMap(i=>{if(!p.items[i])throw Error("资讯不存在");return p.items[i].citations.map(c=>c.sourceId);} ))];
  if(ids.length>15)throw Error("所选来源超过15条，请分批分析");
  const rows=[],mapping=new Map<string,string>();
  for(const id of ids){const s=p.sources.find(s=>s.id===id)!;
    const saved=await saveRadar(db,"information",{requestId:crypto.randomUUID(),title:s.title.slice(0,300),payload:{source:s,facts:"",notes:`来自每日资讯 ${p.date}；AI解读未经人工确认`,verification:"待核验"}});
    rows.push(view(await owned(db,saved.id,"information")));
    mapping.set(id,saved.id);
  }
  const selected=[...new Set(body.indexes)].map(i=>p.items[i]);
  const citations=selected.flatMap(i=>i.citations.map(c=>({...c,sourceId:mapping.get(c.sourceId)!})));
  return {rows,seed:{facts:selected.map(i=>i.facts).join("\n\n").slice(0,4000),relevance:selected.map(i=>i.impact).join("\n\n").slice(0,4000),uncertainty:selected.map(i=>i.uncertainty).join("\n").slice(0,3000),citations:citations.filter((c,i)=>citations.findIndex(x=>x.sourceId===c.sourceId)===i).slice(0,15)}};
}
export async function revalidateNews(db:PrismaClient,input:unknown){
  const {id}=z.object({id:z.string()}).parse(input),row=await owned(db,id,"newsRun");
  if(JSON.parse(row.payload).published)return {id};
  const batch=await db.researchBatch.findFirstOrThrow({where:{...owner,id,status:"failed",slot:null}});
  const output=JSON.parse(batch.calls).findLast((c:{output?:string})=>typeof c.output==="string")?.output;
  if(!output)throw Error("本轮没有已保存的模型输出，请使用剩余额度创建新轮次");
  const p=newsRunSchema.parse(JSON.parse(row.payload)),result=publishableNews(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g,"")),p.sources,p.cutoff);
  result.items=result.items.slice(0,p.column==="politics"?20:15);const fresh=result.items.filter(i=>i.timeliness==="current").length;
  result.gaps=(`从已保存输出重新核对，未再次调用模型。${fresh<10?`可核实时效的新资讯 ${fresh} 条，不足10条。`:""}${result.gaps}`).slice(0,8000);
  await writeTransaction(db,async tx=>{
    await tx.radarRecord.update({where:{id},data:{payload:JSON.stringify({...p,...result,published:true,stage:"done"}),status:"review",version:row.version+1}});
    await tx.researchBatch.update({where:{id},data:{status:"review",error:"",gaps:result.gaps,version:batch.version+1}});
  });return {id};
}
export async function refinishNews(db:PrismaClient,input:unknown){
  const body=z.object({id:z.string(),requestId:z.string().uuid()}).parse(input);
  const row=await owned(db,body.id,"newsRun"),p=newsRunSchema.parse(JSON.parse(row.payload));
  const date=p.date,id=`news-${date}-${p.column}-${body.requestId}`;
  if(await db.radarRecord.findFirst({where:{...owner,id}}))return {id,date};
  const previous=await db.researchBatch.findFirstOrThrow({where:{...owner,id:row.id,status:"failed"}});
  if(!p.sources.length)throw Error("没有可复用资料，请更新本栏");
  if(await db.researchBatch.count({where:{...owner,id:{startsWith:"news-"},status:{in:["queued","collecting","analyzing"]}}}))throw Error("请等待当前栏目运行结束");
  const usage=await db.radarRecord.findFirst({where:{...owner,id:`${owner.profileId}-news-usage-${shanghaiDate()}`}});
  if(usage&&JSON.parse(usage.payload).model>=limits.model)throw Error("今日模型额度已用完");
  await writeTransaction(db,async tx=>{
    await tx.researchBatch.create({data:{id,...owner,previousId:previous.id,question:previous.question,background:"[]",queries:"[]",online:false}});
    await tx.radarRecord.create({data:record("newsRun",id,`${date} ${columns.find(c=>c[0]===p.column)![1]}`,{...p,batchId:id,date,stage:"final",modelCount:0,searchCount:0,pending:[],items:[],published:false,automaticRetries:0,retryAt:null,gaps:"复用上一轮已收集资料，只重新解读；资料时间范围未更新。"},{status:"queued",parentId:row.id})});
  });return {id,date};
}
export function pauseRestoredNews<T extends {kind:string;payload:string;status:string}>(row:T):T {
  if(row.kind==="newsConfig")return {...row,payload:JSON.stringify({...newsConfigSchema.parse(JSON.parse(row.payload)),enabled:false})};
  return row.kind==="newsRun"&&!JSON.parse(row.payload).published?{...row,status:"failed"}:row;
}
// Restoring an earlier backup must not refund attempts already made today.
export async function retainNewsUsage(db:Pick<PrismaClient,"radarRecord">,prior:RadarRecord[]){
  const restored=await db.radarRecord.findMany({where:{...owner,kind:"newsUsage"}});
  for(const row of prior){
    const old=newsUsageSchema.parse(JSON.parse(row.payload)),current=restored.find(r=>r.id===row.id);
    if(!current){await db.radarRecord.create({data:row});continue;}
    const next=newsUsageSchema.parse(JSON.parse(current.payload));
    await db.radarRecord.update({where:{id:row.id},data:{payload:JSON.stringify({date:old.date,search:Math.max(old.search,next.search),extract:Math.max(old.extract,next.extract),model:Math.max(old.model,next.model)}),version:Math.max(row.version,current.version)+1}});
  }
}
