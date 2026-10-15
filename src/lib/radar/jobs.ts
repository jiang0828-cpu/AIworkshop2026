import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { previewResearch } from "../research/service";
import { record, owned, owner } from "./service";
import { writeTransaction } from "../database-writes";
import { sourceSchema, type Source } from "../research/shared";
import { assessmentInputSchema } from "./shared";

export async function radarJob(db: PrismaClient, input: unknown, previewOnly: boolean, configured: { search: boolean; ai: boolean }) {
  const body = z.object({ requestId: z.string().uuid(), mode: z.enum(["collect", "analyze"]), sceneId: z.string().nullable().default(null), topicId: z.string().nullable().default(null), question: z.string().trim().min(1).max(1000), informationIds: z.array(z.string()).max(15).default([]), recordIds:z.array(z.string().min(1).max(300)).max(15).default([]), queries: z.array(z.string()).max(3).default([]), selected: z.array(z.object({ type: z.string(), id: z.string() })).max(20).default([]), allowSensitive: z.boolean().default(false), days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]).default(30), preview: z.string().optional() }).parse(input);
  if (body.topicId) await owned(db, body.topicId, "topic");
  const sources: Source[] = [];
  for (const id of new Set(body.informationIds)) { const info = await owned(db, id, "information"); sources.push({ ...sourceSchema.parse(JSON.parse(info.payload).source), id }); }
  const assessments:z.infer<typeof assessmentInputSchema>[]=[];
  if(body.recordIds.length&&body.mode!=="analyze")throw new Error("综合资料选择仅用于AI研判");
  if(new Set([...body.informationIds,...body.recordIds]).size>15)throw new Error("每次最多选择15条记录");
  for(const id of new Set(body.recordIds)){
    const row=await owned(db,id);
    if(row.kind==="information"){
      if(!sources.some(s=>s.id===id))sources.push({...sourceSchema.parse(JSON.parse(row.payload).source),id});
      continue;
    }
    const snapshot=row.kind==="judgement"?await owned(db,JSON.parse(row.payload).currentVersionId,"judgementVersion"):row;
    if(!["analysis","judgementVersion"].includes(snapshot.kind))throw new Error("请选择信息卡、分析稿或研判卡");
    const payload=JSON.parse(snapshot.payload),c=payload.conclusion;
    if(!assessments.some(a=>a.id===snapshot.id))assessments.push(assessmentInputSchema.parse({id:snapshot.id,recordId:row.id,kind:snapshot.kind,version:snapshot.kind==="judgementVersion"?payload.number:snapshot.version,title:snapshot.title,facts:c.facts,relevance:c.relevance,nextStep:c.nextStep,uncertainty:c.uncertainty}));
    for(const raw of payload.sources){
      const source=sourceSchema.parse(raw);await owned(db,source.id,"information");
      const prior=sources.find(s=>s.id===source.id);
      if(prior&&JSON.stringify(prior)!==JSON.stringify(source))throw new Error("所选记录引用了同一来源的不同快照，请分别研判");
      if(!prior)sources.push(source);
    }
  }
  if(sources.length>15)throw new Error("合并后的原始来源超过15条，请减少所选记录或分批研判");
  if (body.mode === "analyze" && !sources.length) throw new Error("请先选择信息卡");
  if (body.mode === "analyze" && sources.some(s => !s.content.trim())) throw new Error("所选信息缺少正文，请先提取网页或粘贴资料后分析");
  const background = await previewResearch(db, { ...body, queries: body.mode === "collect" ? body.queries : [], selected: body.mode === "collect" ? [] : body.selected });
  const preview = { ...background, sources, assessments, mode: body.mode, topicId: body.topicId, days: body.days };
  if (previewOnly) return preview;
  const batchId = `research-${body.requestId}`, jobId = `radar-job-${body.requestId}`;
  const existing = await db.radarRecord.findFirst({ where: { ...owner, id: jobId } });
  if (existing) return { id: jobId, batchId };
  if (body.preview !== JSON.stringify(preview)) throw new Error("所选资料已变化，请重新预览");
  if (body.mode === "collect" && (!configured.search || !background.queries.length && !sources.some(s => s.url))) throw new Error("联网收集需要配置 Tavily，并填写公开检索词或选择网页信息卡");
  if (body.mode === "analyze" && !configured.ai) throw new Error("未配置模型，可以先手动分析");
  // Queue and metadata commit together, so the worker cannot claim a job without its mode.
  await writeTransaction(db, async (tx) => {
    await tx.researchBatch.create({ data: { id: batchId, ...owner, question: background.question, sceneId: body.sceneId, background: JSON.stringify(background.background), queries: JSON.stringify(background.queries), online: body.mode === "collect", days: body.days, sources: JSON.stringify(sources) } });
    await tx.radarRecord.create({ data: record("job", jobId, body.question, { batchId, mode: body.mode, informationIds: sources.map(s=>s.id), assessments }, { sceneId: body.sceneId, topicId: body.topicId, status: "queued", originKey: `job:${batchId}` }) });
  });
  return { id: jobId, batchId };
}
