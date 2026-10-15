import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withDailyLock } from "@/lib/daily/service";
import { saveRequirement } from "@/lib/strategy/requirements-save";
import { z } from "zod";

export async function POST(request: Request) {
  try {
    const input = await request.json(), db = await getDb();
    return NextResponse.json(await withDailyLock(db, () => saveRequirement(db, input)));
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "需求字段无效或过长，请检查后重试" : error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
