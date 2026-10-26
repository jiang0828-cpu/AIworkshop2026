import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, PROFILE_ID, ensureProfile } from "@/lib/db";
import { atomic, initializeScenes, own, saveGoalBatch, saveRecord, saveRelation, saveScenes, saveProfileScenes, strategyView, validateScene } from "@/lib/strategy/service";
import { subjectType } from "@/lib/strategy/shared";
import { withDailyLock } from "@/lib/daily/service";
import { decompositionDraft, strategyAnalysis } from "@/lib/strategy/analysis";
import { validateEntityLinks } from "@/lib/strategy/entity";
import { linkSelfAction, saveSelfReview, applySelfUpdate } from "@/lib/strategy/self-loop";
import { evaluateResource, saveResource } from "@/lib/strategy/resource-operations";
import { goalProjectContext, generateGoalProjects, saveGoalProjects } from "@/lib/strategy/goal-project-plan";
import { moveAction } from "@/lib/strategy/move-action";

export async function GET() { await ensureProfile(); return NextResponse.json(await strategyView(await getDb())); }
export async function POST(request: Request) {
  try {
    const db = await getDb(); await ensureProfile(); await initializeScenes(db);
    const body = z.object({ action: z.enum(["scenes", "record", "relation", "remove-relation", "classify", "goal-batch", "analyze", "decompose", "goal-project-preview", "goal-project-generate", "goal-project-save", "self-link", "self-review", "self-apply", "resource-save", "resource-evaluate", "profile-scenes-save", "action-move"]), data: z.unknown() }).parse(await request.json());
    if (body.action === "analyze") return NextResponse.json(await strategyAnalysis(db, body.data));
    if (body.action === "decompose") return NextResponse.json(await decompositionDraft(db, body.data));
    if (body.action === "goal-project-preview") return NextResponse.json(await goalProjectContext(db, body.data));
    if (body.action === "goal-project-generate") return NextResponse.json(await generateGoalProjects(db, body.data));
    const result = await withDailyLock(db, async () => {
      switch (body.action) {
        case "action-move": return moveAction(db, body.data);
        case "goal-project-save": return saveGoalProjects(db, body.data);
        case "profile-scenes-save": return saveProfileScenes(db, body.data);
        case "resource-save": return saveResource(db, body.data);
        case "resource-evaluate": return evaluateResource(db, body.data);
        case "self-link": return linkSelfAction(db, body.data);
        case "self-review": return saveSelfReview(db, body.data);
        case "self-apply": return applySelfUpdate(db, body.data);
        case "scenes": await saveScenes(db, body.data); break;
        case "record": return saveRecord(db, body.data);
        case "relation": return saveRelation(db, body.data);
        case "remove-relation": {
          const { id } = z.object({ id: z.string().min(1) }).parse(body.data);
          await db.goalRelation.deleteMany({ where: { id, profileId: PROFILE_ID } }); break;
        }
        case "goal-batch": return saveGoalBatch(db, body.data);
        case "classify": {
          const rows = z.array(z.object({ type: subjectType, id: z.string().min(1), sceneId: z.string().nullable(), crossSceneConfirmed: z.boolean().default(false) })).min(1).max(100).parse(body.data);
          const statements: Array<{ sql: string; values: Array<string | number | null> }> = [];
          for (const row of rows) {
            const existing = await own(db, row.type, row.id); await validateScene(db, row.sceneId);
            await validateEntityLinks(db, row.type, { sceneId: row.sceneId, visionId: null }, existing, row.crossSceneConfirmed);
            if (["goal", "project", "decision"].includes(row.type)) {
              const table = { goal: "Goal", project: "Project", decision: "Decision" }[row.type as "goal"];
              statements.push({ sql: `UPDATE "${table}" SET "sceneId"=?,"visionId"=NULL,"updatedAt"=? WHERE "id"=? AND "profileId"=?`, values: [row.sceneId, Date.now(), row.id, PROFILE_ID] });
            } else throw new Error("档案标签请在记录详情中确认");
          }
          await atomic(db, statements); return { saved: rows.length };
        }
      }
      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "输入格式无效，请检查字段" : error instanceof Error ? error.message : "操作失败" }, { status: 400 }); }
}
