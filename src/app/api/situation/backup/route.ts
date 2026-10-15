import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile, getDb, PROFILE_ID } from "@/lib/db";
import { radarBackupSchema, validateRadarGraph } from "@/lib/radar/backup";
import { researchBackupSchema } from "@/lib/research/backup";
import { writeTransaction } from "@/lib/database-writes";
import { withDailyLock } from "@/lib/daily/service";
import { pauseRestoredNews, retainNewsUsage } from "@/lib/radar/news";
const bundle = z.object({ format: z.literal("external-radar"), version: z.literal(1), records: z.array(radarBackupSchema), jobs: z.array(researchBackupSchema).default([]) });
export async function GET() {
  await ensureProfile(); const db = await getDb(), where = { profileId: PROFILE_ID };
  return new NextResponse(JSON.stringify({ format: "external-radar", version: 1, records: await db.radarRecord.findMany({ where }), jobs: await db.researchBatch.findMany({ where }) }), { headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=external-radar.json", "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  try {
    const data = bundle.parse(await request.json()); await ensureProfile(); const db = await getDb();
    const scenes = new Set((await db.workbenchScene.findMany({ where: { profileId: PROFILE_ID } })).map(r => r.id));
    validateRadarGraph(data.records, new Set(data.jobs.map(r => r.id)), scenes);
    for (const rows of [data.records, data.jobs]) {
      if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("备份含重复 ID");
      if (rows.some(r => r.profileId && r.profileId !== PROFILE_ID || r.sceneId && !scenes.has(r.sceneId))) throw new Error("备份归属或场景无效");
    }
    await withDailyLock(db, () => writeTransaction(db, async tx => {
      const prior=await tx.radarRecord.findMany({where:{profileId:PROFILE_ID,kind:"newsUsage"}});
      await tx.radarRecord.deleteMany({ where: { profileId: PROFILE_ID } }); await tx.researchBatch.deleteMany({ where: { profileId: PROFILE_ID } });
      for (const r of data.records) await tx.radarRecord.create({ data: { ...pauseRestoredNews(r), profileId: PROFILE_ID, ...(r.kind === "job" && r.status !== "review" ? { status: "failed" } : {}) } });
      for (const r of data.jobs) await tx.researchBatch.create({ data: { ...r, profileId: PROFILE_ID, slot: null, leaseToken: null, leaseUntil: null, leaseUntilSeconds: null, version: r.version + 1, ...(["queued", "collecting", "analyzing"].includes(r.status) ? { status: "failed", error: "备份恢复，等待人工确认后重试" } : {}) } });
      await retainNewsUsage(tx,prior);
    }), true);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof z.ZodError ? "备份格式或引用无效" : e instanceof Error ? e.message : "恢复失败" }, { status: 400 }); }
}
