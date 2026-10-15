import { NextResponse } from "next/server";
import { z } from "zod";
import { sceneCount } from "@/lib/scenes";
import { getDb, PROFILE_ID } from "@/lib/db";
import { dailyAIConfig } from "@/lib/daily/config";
import { callModel } from "@/lib/daily/provider";
import { withDailyLock } from "@/lib/daily/service";
import { confirmScenePlan, profileScenePlanContext, profileScenePlanId, scenePlanItemSchema, scenePlanPrompt, scenePlanResultSchema, validateScenePlan } from "@/lib/strategy/profile-scene-plan";

const requestSchema = z.object({ action: z.enum(["preview", "generate", "save"]), allowSensitive: z.boolean().default(false), requestId: z.string().uuid().optional(), items: z.array(scenePlanItemSchema).min(1).max(sceneCount).optional() }).strict();
export async function GET() {
  const db = await getDb();
  const stored = await db.goalBatch.findFirst({ where: { id: profileScenePlanId, profileId: PROFILE_ID } });
  const draft = stored ? JSON.parse(stored.payload) : null;
  return NextResponse.json({ draft: draft?.confirmed ? null : draft });
}
export async function DELETE(request: Request) {
  try {
    const { requestId } = z.object({ requestId: z.string().uuid() }).parse(await request.json());
    const db = await getDb();
    await withDailyLock(db, async () => {
      const row = await db.goalBatch.findFirst({ where: { id: profileScenePlanId, profileId: PROFILE_ID } });
      if (row && JSON.parse(row.payload).requestId === requestId) await db.goalBatch.deleteMany({ where: { id: profileScenePlanId, profileId: PROFILE_ID } });
      else if (row) throw new Error("草稿已变化，请刷新后重试");
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "放弃草稿失败，请刷新后重试" }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const db = await getDb();
    if (body.action === "save") {
      if (!body.requestId || !body.items) throw new Error("请选择并确认场景草稿");
      return NextResponse.json(await withDailyLock(db, () => confirmScenePlan(db, body.requestId!, body.items!)));
    }
    const source = await profileScenePlanContext(db, body.allowSensitive);
    if (body.action === "preview") return NextResponse.json({ context: JSON.parse(source.serialized), withheld: source.withheld });
    const stored = await db.goalBatch.findFirst({ where: { id: profileScenePlanId, profileId: PROFILE_ID } });
    if (stored && !JSON.parse(stored.payload).confirmed) throw new Error("已有待确认草稿，请先查看或放弃后再生成");
    const config = dailyAIConfig();
    const output = await callModel(config, source.serialized, scenePlanPrompt, "", 120, true);
    const parsed = scenePlanResultSchema.parse(JSON.parse(output.output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
    validateScenePlan(parsed.items, source.scenes, true);
    const draft = { ...parsed, requestId: crypto.randomUUID(), source: config.model || "deepseek-reasoner", createdAt: new Date().toISOString(), baselines: source.baselines };
    await withDailyLock(db, async () => {
      const latest = await db.goalBatch.findFirst({ where: { id: profileScenePlanId, profileId: PROFILE_ID } });
      if (latest && !JSON.parse(latest.payload).confirmed) throw new Error("已有新草稿生成，请刷新查看");
      await db.goalBatch.upsert({ where: { id: profileScenePlanId }, create: { id: profileScenePlanId, profileId: PROFILE_ID, payload: JSON.stringify(draft) }, update: { payload: JSON.stringify(draft) } });
    });
    return NextResponse.json(draft);
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? "AI 场景档案格式无效，请重试" : error instanceof Error ? error.message : "操作失败，请重试" }, { status: 400 });
  }
}
