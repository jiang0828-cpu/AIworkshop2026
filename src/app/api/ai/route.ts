import { NextResponse } from "next/server";
import { getDb, PROFILE_ID } from "@/lib/db";
import { authorizedSensitiveProfileFields, redact, runAI } from "@/lib/ai";
import { aiRequestSchema } from "@/lib/schemas";

export async function GET() { return NextResponse.json({ configured: Boolean(process.env.AI_API_KEY), model: process.env.AI_MODEL || "deepseek-reasoner" }); }

export async function POST(request: Request) {
  try {
    const db = await getDb();
    const body = aiRequestSchema.parse(await request.json());
    const profile = await db.profile.findUnique({ where: { id: PROFILE_ID }, include: { experiences: true, evidences: true, valueRules: true, resources: true, constraints: true, assumptions: true, goals: true, projects: true, actions: true, reviews: true, decisions: true, aiInstruction: true } });
    const context = redact(profile, profile?.aiInstruction?.privacyOptions || "姓名和联系方式脱敏", authorizedSensitiveProfileFields(profile));
    const result = await runAI({ kind: body.kind, context, scope: body.scope });
    for (const item of result.items) await db.aISuggestion.create({ data: { profileId: PROFILE_ID, type: body.kind, title: item.title, content: item.content, source: result.source, sentScope: body.scope.join("、") } });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 请求无效" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const db = await getDb();
  const body = await request.json() as { id?: string; status?: string };
  if (!body.id || !["已确认", "已拒绝", "待确认"].includes(body.status || "")) return NextResponse.json({ error: "建议状态无效" }, { status: 400 });
  return NextResponse.json(await db.aISuggestion.update({ where: { id: body.id }, data: { status: body.status } }));
}
