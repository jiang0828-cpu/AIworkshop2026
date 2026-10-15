import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile, getDb, PROFILE_ID } from "@/lib/db";
import { initializeScenes } from "@/lib/strategy/service";
import { withDailyLock } from "@/lib/daily/service";
import { inputSchema, dateSchema } from "@/lib/execution-plan/shared";
import { planningContext } from "@/lib/execution-plan/context";
import { confirmPlan, createPlan, editPlan, ownPlan, planView, refreshPlan, releaseTask, runStage, selectTasks } from "@/lib/execution-plan/service";

const id = z.string().min(1).max(150);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input: inputSchema }),
  z.object({ action: z.literal("create"), id, input: inputSchema, fingerprint: z.string().min(1) }),
  z.object({ action: z.literal("stage"), id, revision: z.number().int().positive(), stage: z.enum(["generate", "review"]) }),
  z.object({ action: z.literal("save"), id, revision: z.number().int().positive(), draft: z.unknown(), capacity: z.unknown(), resolutions: z.unknown() }),
  z.object({ action: z.literal("refresh"), id, revision: z.number().int().positive() }),
  z.object({ action: z.literal("confirm"), id, revision: z.number().int().positive() }),
  z.object({ action: z.literal("release"), id, key: id, reason: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("select-tasks"), id, keys: z.array(id).min(1).max(50), date: dateSchema }),
]);
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const id = new URL(request.url).searchParams.get("id");
    if (id) return NextResponse.json(planView(await ownPlan(db, id)), { headers: { "Cache-Control": "no-store" } });
    const rows = await db.executionPlan.findMany({ where: { profileId: PROFILE_ID }, orderBy: { updatedAt: "desc" }, take: 30 });
    const signals = await db.radarRecord.findMany({ where: { profileId: PROFILE_ID, kind: "judgementVersion", status: "confirmed" }, select: { id: true, title: true, sceneId: true }, take: 30 });
    return NextResponse.json({ plans: rows.map(row => ({ id: row.id, revision: row.revision, status: row.status, updatedAt: row.updatedAt })), signals }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "无法读取规划，请检查迁移或记录归属" }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    const body = command.parse(await request.json()), db = await getDb();
    await ensureProfile(); await initializeScenes(db);
    if (body.action === "preview") return NextResponse.json(await planningContext(db, body.input));
    if (body.action === "stage") return NextResponse.json(await runStage(db, body.id, body.revision, body.stage));
    if (body.action === "confirm") return NextResponse.json(await confirmPlan(db, body.id, body.revision));
    return NextResponse.json(await withDailyLock(db, async () => {
      switch (body.action) {
        case "create": return createPlan(db, body);
        case "save": return editPlan(db, body);
        case "refresh": return refreshPlan(db, body.id, body.revision);
        case "release": return releaseTask(db, body.id, body.key, body.reason);
        case "select-tasks": return selectTasks(db, body.id, body.keys, body.date);
      }
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "规划字段不完整或格式无效，请检查输入" : error instanceof Error ? error.message : "规划操作失败" }, { status: 400 });
  }
}
