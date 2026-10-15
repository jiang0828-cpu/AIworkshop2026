import { NextResponse } from "next/server";
import { getDb, PROFILE_ID } from "@/lib/db";
import { diffLines } from "@/lib/text-diff";
import { documentKeySchema } from "@/lib/schemas";
import { documentMeta, generateMarkdown } from "@/lib/markdown";

const include = { experiences: true, evidences: true, valueRules: true, resources: true, constraints: true, assumptions: true, goals: true, projects: { include: { milestones: true } }, actions: true, reviews: true, decisions: { include: { options: true } }, aiInstruction: true } as const;

export async function GET(request: Request) {
  const db = await getDb();
  const url = new URL(request.url);
  const key = documentKeySchema.parse(url.searchParams.get("key") || "profile");
  const fromId = url.searchParams.get("from");
  const profile = await db.profile.findUniqueOrThrow({ where: { id: PROFILE_ID }, include });
  const generated = generateMarkdown(key, profile);
  const previous = fromId ? await db.documentVersion.findFirst({ where: { id: fromId, profileId: PROFILE_ID, documentKey: key } }) : await db.documentVersion.findFirst({ where: { profileId: PROFILE_ID, documentKey: key }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ key, title: documentMeta[key].title, before: previous?.content || "", after: generated, source: previous?.source || "尚无历史版本", lines: diffLines(previous?.content || "", generated) });
}
