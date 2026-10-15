import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, PROFILE_ID, isCloudflareD1Runtime } from "@/lib/db";
import { profileSchema } from "@/lib/schemas";
import { exportSelfStrategy, restoreStrategy, strategyBackupSchema } from "@/lib/strategy/backup";
import { writeTransaction } from "@/lib/database-writes";
import { withDailyLock } from "@/lib/daily/service";
import { inSelfSection, sectionCollections, type SelfSection } from "@/lib/self-transfer";

const recordSchema = z.object({ id: z.string().min(1).optional() }).passthrough();
const backupSchema = z.object({
  format: z.literal("ai-workbench-self-backup"),
  version: z.literal(1),
  section: z.enum(["profile", "values", "skills", "resources", "experiences"]).optional(),
  data: z.object({
    profile: z.record(z.unknown()).default({}),
    experiences: z.array(recordSchema).default([]),
    evidences: z.array(recordSchema).default([]),
    valueRules: z.array(recordSchema).default([]),
    resources: z.array(recordSchema).default([]),
    constraints: z.array(recordSchema).default([]),
    assumptions: z.array(recordSchema).default([]),
    strategy: strategyBackupSchema.optional(),
  }),
});

const selfInclude = {
  experiences: { orderBy: { createdAt: "asc" as const } },
  evidences: { orderBy: { createdAt: "asc" as const } },
  valueRules: { orderBy: { priority: "asc" as const } },
  resources: { orderBy: { createdAt: "asc" as const } },
  constraints: { orderBy: { createdAt: "asc" as const } },
  assumptions: { orderBy: { createdAt: "asc" as const } },
} as const;

type BackupRecord = z.infer<typeof recordSchema>;
const text = (row: BackupRecord, key: string, fallback = "") => typeof row[key] === "string" ? row[key] : fallback;
const number = (row: BackupRecord, key: string, fallback = 0) => typeof row[key] === "number" && Number.isFinite(row[key]) ? row[key] : fallback;
const date = (row: BackupRecord, key: string) => {
  if (typeof row[key] !== "string" && !(row[key] instanceof Date)) return null;
  const value = new Date(String(row[key]));
  return Number.isNaN(value.getTime()) ? null : value;
};
const id = (row: BackupRecord) => typeof row.id === "string" && row.id.trim() ? row.id : undefined;

function required(row: BackupRecord, key: string, message: string) {
  const value = text(row, key);
  if (!value.trim()) throw new Error(message);
  return value;
}

export async function GET(request: Request) {
  const db = await getDb();
  const profile = await db.profile.upsert({
    where: { id: PROFILE_ID },
    update: {},
    create: { id: PROFILE_ID, aiInstruction: { create: {} } },
    include: selfInclude,
  });
  const { experiences, evidences, valueRules, resources, constraints, assumptions, ...profileFields } = profile;
  const section = request ? new URL(request.url).searchParams.get("section") as SelfSection | null : null;
  if (section && !Object.hasOwn(sectionCollections, section)) return NextResponse.json({ error: "板块无效" }, { status: 400 });
  const strategy = await exportSelfStrategy(db);
  const data = { profile: profileSchema.parse(profileFields), experiences, evidences, valueRules, resources, constraints, assumptions, strategy };
  if (section) {
    if (section !== "profile") data.profile = profileSchema.parse({});
    for (const key of ["experiences", "evidences", "valueRules", "resources", "constraints", "assumptions"] as const) if (!sectionCollections[section].includes(key)) data[key] = [];
    strategy.records = strategy.records.filter((row) => inSelfSection(row, section));
    strategy.versions = strategy.versions.filter((row) => strategy.records.some((record) => record.id === row.recordId));
  }
  return new NextResponse(JSON.stringify({
    format: "ai-workbench-self-backup",
    version: 1,
    ...(section ? { section } : {}),
    exportedAt: new Date().toISOString(),
    data,
  }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=ai-workbench-self-${section || "backup"}.json`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  try {
    const db = await getDb();
    const { data, section } = backupSchema.parse(await request.json());

    await withDailyLock(db, () => writeTransaction(db, async (tx) => {
    if (section) {
      const reader = isCloudflareD1Runtime() ? db : tx;
      const existing = await reader.profile.findUniqueOrThrow({ where: { id: PROFILE_ID }, include: selfInclude });
      if (section !== "profile") data.profile = profileSchema.parse(existing);
      for (const key of ["experiences", "evidences", "valueRules", "resources", "constraints", "assumptions"] as const) if (!sectionCollections[section].includes(key)) data[key] = existing[key];
      const old = strategyBackupSchema.parse(await exportSelfStrategy(reader));
      const incoming = data.strategy;
      // Map imported stable scene slots onto local scene IDs; other sections keep their names and order.
      const map = new Map((incoming?.scenes || []).map((scene) => [scene.id, old.scenes.find((local) => local.slot === scene.slot)?.id]));
      const records = (incoming?.records || []).filter((row) => inSelfSection(row, section)).map((row) => {
        const payload = JSON.parse(row.payload);
        if (row.kind === "tag") payload.sceneIds = (payload.sceneIds || []).map((id: string) => map.get(id)).filter(Boolean);
        return { ...row, sceneId: row.sceneId ? map.get(row.sceneId) || null : null, payload: JSON.stringify(payload) };
      });
      data.strategy = { ...old, records: [...old.records.filter((row) => !inSelfSection(row, section)), ...records], versions: [...old.versions.filter((v) => old.records.some((r) => r.id === v.recordId && !inSelfSection(r, section))), ...(incoming?.versions || []).filter((v) => records.some((r) => r.id === v.recordId))] };
    }
    const profile = profileSchema.parse(data.profile);
    if (!section || sectionCollections[section].includes("assumptions")) await tx.assumption.deleteMany({ where: { profileId: PROFILE_ID } });
    if (!section || sectionCollections[section].includes("constraints")) await tx.constraint.deleteMany({ where: { profileId: PROFILE_ID } });
    if (!section || sectionCollections[section].includes("resources")) await tx.resource.deleteMany({ where: { profileId: PROFILE_ID } });
    if (!section || sectionCollections[section].includes("valueRules")) await tx.valueRule.deleteMany({ where: { profileId: PROFILE_ID } });
    if (!section || sectionCollections[section].includes("evidences")) await tx.evidence.deleteMany({ where: { profileId: PROFILE_ID } });
    if (!section || sectionCollections[section].includes("experiences")) await tx.experience.deleteMany({ where: { profileId: PROFILE_ID } });
    if (!section || section === "profile") await tx.profile.update({ where: { id: PROFILE_ID }, data: profile });
    if (!section || sectionCollections[section].includes("experiences")) for (const row of data.experiences) {
      await tx.experience.create({ data: { id: id(row), profileId: PROFILE_ID, title: required(row, "title", "重要经历标题不能为空"), description: text(row, "description"), learning: text(row, "learning"), happenedAt: date(row, "happenedAt") } });
    }
    if (!section || sectionCollections[section].includes("evidences")) for (const row of data.evidences) {
      await tx.evidence.create({ data: { id: id(row), profileId: PROFILE_ID, ability: required(row, "ability", "能力名称不能为空"), evidence: required(row, "evidence", "能力证据不能为空"), confidence: Math.min(5, Math.max(1, Math.round(number(row, "confidence", 3)))) } });
    }
    if (!section || sectionCollections[section].includes("valueRules")) for (const row of data.valueRules) {
      await tx.valueRule.create({ data: { id: id(row), profileId: PROFILE_ID, value: required(row, "value", "价值名称不能为空"), priority: Math.min(5, Math.max(1, Math.round(number(row, "priority", 3)))), rule: text(row, "rule"), conflict: text(row, "conflict") } });
    }
    if (!section || sectionCollections[section].includes("resources")) for (const row of data.resources) {
      await tx.resource.create({ data: { id: id(row), profileId: PROFILE_ID, name: required(row, "name", "资源名称不能为空"), description: text(row, "description"), category: text(row, "category", "其他") } });
    }
    if (!section || sectionCollections[section].includes("constraints")) for (const row of data.constraints) {
      await tx.constraint.create({ data: { id: id(row), profileId: PROFILE_ID, name: required(row, "name", "约束名称不能为空"), description: text(row, "description"), severity: text(row, "severity", "中") } });
    }
    if (!section || sectionCollections[section].includes("assumptions")) for (const row of data.assumptions) {
      await tx.assumption.create({ data: { id: id(row), profileId: PROFILE_ID, statement: required(row, "statement", "假设内容不能为空"), status: text(row, "status", "待验证"), evidence: text(row, "evidence") } });
    }
    await restoreStrategy(tx, data.strategy, true);
    }), true);
    return NextResponse.json({ ok: true, imported: { experiences: data.experiences.length, evidences: data.evidences.length, valueRules: data.valueRules.length, resources: data.resources.length, constraints: data.constraints.length, assumptions: data.assumptions.length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? `认识自己数据导入失败：${error.message}` : "认识自己数据导入失败，请确认文件格式" }, { status: 400 });
  }
}
