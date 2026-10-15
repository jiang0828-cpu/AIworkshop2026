import { NextResponse } from "next/server";
import { getDb, PROFILE_ID } from "@/lib/db";
import { documentKeySchema } from "@/lib/schemas";
import { documentMeta, generateMarkdown } from "@/lib/markdown";
import { strategyView } from "@/lib/strategy/service";

const include = { experiences: true, evidences: true, valueRules: true, resources: true, constraints: true, assumptions: true, goals: true, projects: { include: { milestones: true } }, actions: true, reviews: true, decisions: { include: { options: true } }, aiInstruction: true } as const;
async function bundle() { const db = await getDb(); return db.profile.findUniqueOrThrow({ where: { id: PROFILE_ID }, include }); }

export async function GET(request: Request) {
  const url = new URL(request.url); const key = documentKeySchema.parse(url.searchParams.get("key") || "profile");
  const profile = await bundle(); const content = generateMarkdown(key, profile, await strategyView(await getDb()));
  return new NextResponse(content, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `inline; filename="${encodeURIComponent(documentMeta[key].filename)}"` } });
}

export async function POST(request: Request) {
  const db = await getDb();
  const body = await request.json() as { key?: string; content?: string; source?: string };
  const key = documentKeySchema.parse(body.key || "profile");
  const profile = await bundle(); const content = body.content ?? generateMarkdown(key, profile, await strategyView(db));
  const version = await db.documentVersion.create({ data: { profileId: PROFILE_ID, documentKey: key, title: documentMeta[key].title, content, source: body.source || "结构化数据" } });
  return NextResponse.json(version, { status: 201 });
}

export async function PUT(request: Request) {
  const db = await getDb();
  const body = await request.json() as { id?: string; content?: string };
  if (!body.id || typeof body.content !== "string") return NextResponse.json({ error: "文档内容无效" }, { status: 400 });
  const old = await db.documentVersion.findUniqueOrThrow({ where: { id: body.id } });
  if (old.profileId !== PROFILE_ID) return NextResponse.json({ error: "版本不属于当前档案" }, { status: 403 });
  const version = await db.documentVersion.create({ data: { profileId: PROFILE_ID, documentKey: old.documentKey, title: old.title, content: body.content, source: "用户编辑" } });
  return NextResponse.json(version);
}

export async function PATCH(request: Request) {
  const db = await getDb();
  const body = await request.json() as { id?: string };
  if (!body.id) return NextResponse.json({ error: "缺少版本 ID" }, { status: 400 });
  const version = await db.documentVersion.findUniqueOrThrow({ where: { id: body.id } });
  if (version.profileId !== PROFILE_ID) return NextResponse.json({ error: "版本不属于当前档案" }, { status: 403 });
  const restored = await db.documentVersion.create({ data: { profileId: PROFILE_ID, documentKey: version.documentKey, title: version.title, content: version.content, source: "版本恢复" } });
  return NextResponse.json(restored);
}
