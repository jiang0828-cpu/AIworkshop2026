import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, PROFILE_ID } from "@/lib/db";
import { atomic, own } from "@/lib/strategy/service";
import { dateSchema } from "@/lib/daily/shared";
import { withDailyLock } from "@/lib/daily/service";

export async function POST(request: Request) {
  try {
    const body = z.object({ date: dateSchema, taskKeys: z.array(z.string().regex(/^(action|daily|ai):[^:]+$/)).max(3) }).parse(await request.json());
    if (new Set(body.taskKeys).size !== body.taskKeys.length) throw new Error("任务不可重复置顶");
    const db = await getDb();
    await withDailyLock(db, async () => {
      for (const key of body.taskKeys) {
        const [type, id] = key.split(":");
        if (type === "daily") {
          if (!(await db.dailyTask.findFirst({ where: { id, plan: { profileId: PROFILE_ID, date: body.date } } }))) throw new Error("今日任务无效");
        } else await own(db, type === "ai" ? "aITask" : "action", id);
      }
      await atomic(db, [{ sql: 'DELETE FROM "WorkbenchPin" WHERE "profileId"=? AND "date"=?', values: [PROFILE_ID, body.date] },
        ...body.taskKeys.map((taskKey, position) => ({ sql: 'INSERT INTO "WorkbenchPin" ("id","profileId","date","taskKey","position") VALUES (?,?,?,?,?)', values: [crypto.randomUUID(), PROFILE_ID, body.date, taskKey, position] }))]);
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "置顶失败" }, { status: 400 }); }
}
