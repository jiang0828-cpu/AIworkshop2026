import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile, getDb, PROFILE_ID } from "@/lib/db";
import { dailyAIConfig } from "@/lib/daily/config";
import { withDailyLock } from "@/lib/daily/service";
import { tavilyKey } from "@/lib/research/provider";
import { backgroundOptions, convertResearch, createResearch, previewResearch, researchView, updateResearch } from "@/lib/research/service";
import { POST as legacyPost } from "../strategy/route";

export async function GET(request: Request) {
  try {
    await ensureProfile(); const db = await getDb();
    const sceneId = new URL(request.url).searchParams.get("scene") || null;
    const [batches, context, control] = await Promise.all([db.researchBatch.findMany({ where: { profileId: PROFILE_ID }, orderBy: { createdAt: "desc" }, take: 100 }), backgroundOptions(db, sceneId), db.dailyControl.findUnique({ where: { profileId: PROFILE_ID } })]);
    return NextResponse.json({ batches: batches.map(researchView), options: context.options, searchConfigured: Boolean(tavilyKey()), aiConfigured: Boolean(dailyAIConfig().apiKey), heartbeat: control?.heartbeat || null }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "无法读取研判，请检查数据库迁移" }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 600000) throw new Error("资料过大，请分批补充");
    const raw = await request.text(); if (raw.length > 600000) throw new Error("资料过大，请分批补充");
    const body = z.object({ action: z.string(), data: z.unknown() }).parse(JSON.parse(raw));
    if (!["preview", "collect", "retry", "follow-up", "supplement", "save-conclusion", "verify", "convert"].includes(body.action)) return legacyPost(new Request(request.url, { method: "POST", headers: request.headers, body: raw }));
    await ensureProfile(); const db = await getDb();
    if (body.action === "preview") return NextResponse.json(await previewResearch(db, body.data));
    const result = await withDailyLock(db, async () => {
      if (body.action === "collect") return createResearch(db, body.data, { search: Boolean(tavilyKey()), ai: Boolean(dailyAIConfig().apiKey) });
      if (body.action === "convert") return convertResearch(db, body.data);
      return updateResearch(db, body.action, body.data);
    });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "请检查填写内容与来源" : error instanceof Error ? error.message : "研判操作失败" }, { status: 400 }); }
}
