import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, PROFILE_ID } from "@/lib/db";
import { callModel } from "@/lib/daily/provider";
import { dailyAIConfig } from "@/lib/daily/config";
import { withDailyLock } from "@/lib/daily/service";
import { saveVisionPlan, parseVisionModelOutput } from "@/lib/strategy/vision-plan";
import { POST as selfPreview } from "@/app/api/self-ai/route";
import { visionPlanPrompt } from "@/lib/strategy/vision-plan-prompt";

export async function POST(request: Request) {
  try {
    const body = z.object({ action: z.enum(["preview", "generate", "save"]), id: z.string().optional(), allowSensitive: z.boolean().default(false), instruction: z.string().max(10000).default(""), data: z.unknown().optional() }).parse(await request.json());
    const db = await getDb();
    if (body.action === "save") return NextResponse.json(await withDailyLock(db, () => saveVisionPlan(db, body.data)));
    const previewResponse = await selfPreview(new Request(request.url, { method: "POST", body: JSON.stringify({ type: "overallVision", id: body.id, mode: "organize", instruction: body.instruction, allowSensitive: body.allowSensitive, previewOnly: true }) }));
    const preview = await previewResponse.json();
    if (!previewResponse.ok) return NextResponse.json(preview, { status: previewResponse.status });
    if (body.action === "preview") return NextResponse.json(preview);
    if (preview.blocked) throw new Error("请先授权本次发送总愿景中的敏感资料并重新预览");
    const overall = await db.strategyRecord.findFirst({ where: { id: body.id, profileId: PROFILE_ID, kind: "overallVision" } });
    if (!overall || !JSON.parse(overall.payload).expected?.trim()) throw new Error("请先填写并保存总愿景");
    const existing = await db.strategyRecord.findMany({ where: { profileId: PROFILE_ID, kind: "vision", archived: false } });
    const config = dailyAIConfig();
    const output = await callModel(config, JSON.stringify({ task: "splitOverallVision", scenes: preview.context.scenes, source: JSON.parse(preview.context.content) }), visionPlanPrompt, "", 120, true);
    const result = parseVisionModelOutput(output.output, preview.context.scenes);
    return NextResponse.json({ source: config.model || "deepseek-reasoner", scenes: result.scenes.map((draft) => { const old = existing.find((row) => row.sceneId === draft.sceneId); return { ...draft, previousId: old?.id || null, previousUpdatedAt: old?.updatedAt.toISOString() || null, previous: old ? JSON.parse(old.payload) : null }; }) });
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "草稿格式无效，请检查输入或重试" : error instanceof Error ? error.message : "操作失败" }, { status: 400 }); }
}
