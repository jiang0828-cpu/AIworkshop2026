import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile, getDb } from "@/lib/db";
import { withDailyLock } from "@/lib/daily/service";
import { dailyAIConfig } from "@/lib/daily/config";
import { tavilyKey } from "@/lib/research/provider";
import { backgroundOptions, updateResearch } from "@/lib/research/service";
import { kinds } from "@/lib/radar/shared";
import { listRadar, radarDetail, saveRadar, confirmJudgement, confirmResponse, generateRadarReport, setRadarStatus, owner, view, owned, dueRadar } from "@/lib/radar/service";
import { radarJob } from "@/lib/radar/jobs";
import { publishResearch } from "@/lib/radar/migration";
import { newsView, configureNews, enqueueNews, newsInformation, revalidateNews, refinishNews } from "@/lib/radar/news";
type Context = { params: Promise<{ resource: string }> };
const fail = (e: unknown) => NextResponse.json({ error: e instanceof z.ZodError ? "请检查必填内容、字段长度和来源" : e instanceof Error ? e.message : "研判操作失败" }, { status: 400 });
export async function GET(request: Request, context: Context) {
  try {
    await ensureProfile(); const db = await getDb(), { resource } = await context.params, params = new URL(request.url).searchParams;
    if(resource==="news")return NextResponse.json({...await newsView(db,params),searchConfigured:Boolean(tavilyKey()),aiConfigured:Boolean(dailyAIConfig().apiKey)},{headers:{"Cache-Control":"no-store"}});
    if (resource === "due") return NextResponse.json(await dueRadar(db, params));
    if (resource === "references") {
      const targetType = z.enum(["goal", "review"]).parse(params.get("targetType")), targetId = params.get("targetId") || "";
      const { own } = await import("@/lib/strategy/service"); await own(db, targetType, targetId);
      const links = (await db.radarRecord.findMany({ where: { ...owner, kind: "reference" } })).filter(r => { const p = JSON.parse(r.payload); return p.targetType === targetType && p.targetId === targetId; });
      const ids = links.map(r => JSON.parse(r.payload).judgementVersionId);
      const versions = await db.radarRecord.findMany({ where: { ...owner, id: { in: ids } } });
      const verifications = await db.radarRecord.findMany({ where: { ...owner, kind: "verification", parentId: { in: ids } } });
      return NextResponse.json({ rows: versions.map(view), verifications: verifications.map(view) });
    }
    if (resource === "context") return NextResponse.json({ ...(await backgroundOptions(db, params.get("scene") || null)), searchConfigured: Boolean(tavilyKey()), aiConfigured: Boolean(dailyAIConfig().apiKey) });
    if (resource === "detail") {
      const id = params.get("id") || "";
      const direct = await db.radarRecord.findFirst({ where: { ...owner, id } });
      if (direct) return NextResponse.json(await radarDetail(db, id));
      const alias = await db.radarRecord.findFirst({ where: { ...owner, originKey: { in: [`legacy:research:${id}`, `legacy:signal:${id}`] } } });
      if (!alias) throw new Error("历史记录尚未迁移或来源已删除");
      return NextResponse.json(await radarDetail(db, alias.parentId || alias.id));
    }
    if (resource === "jobs") {
      const jobs = await db.radarRecord.findMany({ where: { ...owner, kind: "job" }, orderBy: { createdAt: "desc" }, take: 30 });
      const batches = await db.researchBatch.findMany({ where: { ...owner, id: { in: jobs.map((j) => JSON.parse(j.payload).batchId) } }, select: { id: true, status: true, error: true, version: true, calls: true, gaps: true } });
      const control = await db.dailyControl.findUnique({ where: { profileId: owner.profileId } });
      return NextResponse.json({ heartbeat: control?.heartbeat || null, rows: jobs.map((j) => ({ ...view(j), execution: batches.find((b) => b.id === JSON.parse(j.payload).batchId) })) });
    }
    params.set("kind", z.enum(kinds).parse(resource));
    return NextResponse.json(await listRadar(db, params), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request, context: Context) {
  try {
    const raw = await request.text(); if (raw.length > 600000) throw new Error("内容过大，请分批保存");
    const input = JSON.parse(raw), { resource } = await context.params;
    await ensureProfile(); const db = await getDb();
    if (resource === "preview") return NextResponse.json(await radarJob(db, input, true, { search: Boolean(tavilyKey()), ai: Boolean(dailyAIConfig().apiKey) }));
    const result = await withDailyLock(db, async () => {
      if(resource==="news-config")return configureNews(db,input);
      if(resource==="news-refresh"){if(!tavilyKey()||!dailyAIConfig().apiKey)throw Error("请先配置 Tavily 和模型，仍可手动记录资料");return enqueueNews(db,input);}
      if(resource==="news-information")return newsInformation(db,input);
      if(resource==="news-revalidate")return revalidateNews(db,input);
      if(resource==="news-refinish"){if(!dailyAIConfig().apiKey)throw Error("请先配置模型");return refinishNews(db,input);}
      if(resource==="news-retry"){
        const row=await owned(db,z.object({id:z.string()}).parse(input).id,"newsRun");
        const p=JSON.parse(row.payload);if(p.modelCount>=3)throw Error("本轮模型调用已达上限，请使用当天剩余额度创建新轮次");
        const batch=await db.researchBatch.findFirstOrThrow({where:{...owner,id:p.batchId}});
        return updateResearch(db,"retry",{id:batch.id,version:batch.version});
      }
      if(["newsConfig","newsRun","newsUsage"].includes(resource))throw Error("请通过每日栏目专用接口操作");
      if (resource === "jobs") return radarJob(db, input, false, { search: Boolean(tavilyKey()), ai: Boolean(dailyAIConfig().apiKey) });
      if (resource === "retry") { const job = await owned(db, z.object({ id: z.string() }).parse(input).id, "job"); const batchId = JSON.parse(job.payload).batchId; const batch = await db.researchBatch.findFirstOrThrow({ where: { ...owner, id: batchId } }); return updateResearch(db, "retry", { id: batchId, version: batch.version }); }
      if (resource === "publish") { const job = await owned(db, z.object({ id: z.string() }).parse(input).id, "job"); await publishResearch(db, JSON.parse(job.payload).batchId); return { id: job.id }; }
      if (resource === "confirm-judgement") return confirmJudgement(db, input);
      if (resource === "confirm-response") return confirmResponse(db, input);
      if (resource === "status") return setRadarStatus(db, input);
      if (resource === "report") return generateRadarReport(db, input);
      return saveRadar(db, z.enum(kinds).parse(resource), input);
    });
    return NextResponse.json(result);
  } catch (e) { return fail(e); }
}
