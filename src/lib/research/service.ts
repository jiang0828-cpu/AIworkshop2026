import { z } from "zod";
import type { PrismaClient, ResearchBatch } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { validateScene, type StrategyDB } from "../strategy/service";
import { writeTransaction } from "../database-writes";
import { conclusionSchema, dedupeSources, redact, sourceSchema, validateAnalysis, type Background, type ResearchView } from "./shared";
import { publicUrl } from "./provider";
import { canRespond, verificationSchema } from "./radar";

const where = { profileId: PROFILE_ID };
const selector = z.object({ type: z.enum(["profile", "overallVision", "vision", "skill", "resource", "constraint", "goal", "project"]), id: z.string().min(1).max(150) });
const previewSchema = z.object({ sceneId: z.string().nullable().default(null), question: z.string().trim().min(1).max(1000), selected: z.array(selector).max(20).default([]), allowSensitive: z.boolean().default(false), queries: z.array(z.string().trim().min(1).max(180)).max(3).default([]) });
const createSchema = previewSchema.extend({ requestId: z.string().uuid(), preview: z.string().max(250000), online: z.boolean().default(true), days: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]).default(30), previousId: z.string().nullable().default(null), manual: z.array(z.object({ title: z.string().trim().min(1).max(300), url: z.string().max(2000).default(""), content: z.string().max(16000).default(""), publishedAt: z.string().date().nullable().default(null) })).max(15).default([]) });
export async function researchBatch(db: StrategyDB, id: string) {
  const row = await db.researchBatch.findFirst({ where: { ...where, id } });
  if (!row) throw new Error("研判不存在或不属于当前档案");
  return row;
}
export function researchView(row: ResearchBatch): ResearchView {
  const { slot: _slot, leaseToken: _token, leaseUntil: _lease, leaseUntilSeconds: _seconds, profileId: _profile, ...data } = row;
  void _slot; void _token; void _lease; void _seconds; void _profile;
  return JSON.parse(JSON.stringify({ ...data, background: JSON.parse(row.background), queries: JSON.parse(row.queries), sources: JSON.parse(row.sources), conclusions: JSON.parse(row.conclusions), calls: JSON.parse(row.calls) }));
}
export async function backgroundOptions(db: StrategyDB, sceneId: string | null) {
  await validateScene(db, sceneId);
  const [profile, records, resources, constraints, scenes, goals, projects] = await Promise.all([db.profile.findUniqueOrThrow({ where: { id: PROFILE_ID } }), db.strategyRecord.findMany({ where: { ...where, archived: false } }), db.resource.findMany({ where }), db.constraint.findMany({ where }), db.workbenchScene.findMany({ where }), db.goal.findMany({ where }), db.project.findMany({ where })]);
  const identifiers = [profile.name, profile.organization];
  const sensitiveFields = JSON.parse(profile.sensitiveAiFields || "[]") as string[];
  const options: Background[] = [];
  const add = (type: string, id: string, title: string, content: string, sensitive: boolean) => { if (content.trim()) options.push({ type, id, title, content: redact(content, identifiers).slice(0, 12000), sensitive: sensitive || /收入|工资|薪资|家庭|孩子|疾病|病史|健康|财务|资产|组织|公司/.test(content) }); };
  add("profile", "stage", "当前阶段", profile.stage, sensitiveFields.includes("stage"));
  add("profile", "currentPriorities", "当前优先事项", profile.currentPriorities, sensitiveFields.includes("currentPriorities"));
  for (const row of records.filter((row) => ["overallVision", "vision", "skill"].includes(row.kind) && (!row.sceneId || row.sceneId === sceneId))) {
    const data = JSON.parse(row.payload);
    add(row.kind, row.id, row.title, Object.entries(data).filter(([key]) => !["evidenceId", "rating"].includes(key)).map(([key, value]) => `${key}: ${value}`).join("\n"), scenes.some((scene) => scene.id === row.sceneId && [1, 2, 3].includes(scene.slot)));
  }
  for (const [type, rows] of [["resource", resources], ["constraint", constraints]] as const) for (const row of rows) {
    const tag = records.find((tag) => tag.kind === "tag" && JSON.parse(tag.payload).subjectId === row.id && JSON.parse(tag.payload).subjectType === type);
    const ids: string[] = tag ? JSON.parse(tag.payload).sceneIds : [];
    if (!ids.length || ids.includes(sceneId || "")) add(type, row.id, row.name, `${row.name}\n${row.description}`, ids.some((id) => scenes.some((scene) => scene.id === id && [1, 2, 3].includes(scene.slot))));
  }
  for (const goal of goals.filter((row) => !row.sceneId || row.sceneId === sceneId)) {
    add("goal", goal.id, `目标：${goal.title}`, `${goal.title}\n${goal.description}\n指标：${goal.metric}\n状态：${goal.status}\n截止：${goal.deadline?.toISOString().slice(0, 10) || "未设置"}`, true);
  }
  for (const project of projects.filter((row) => { const inherited = row.sceneId || goals.find((g) => g.id === row.goalId)?.sceneId; return !inherited || inherited === sceneId; })) {
    add("project", project.id, `项目：${project.name}`, `${project.name}\n${project.description}\n指标：${project.metric}\n状态：${project.status}\n投入：${project.budget}\n边界：${project.boundary}\n风险：${project.risk}\n停止条件：${project.stopCondition}`, true);
  }
  return { options, identifiers };
}
export async function previewResearch(db: StrategyDB, input: unknown) {
  const body = previewSchema.parse(input), { options, identifiers } = await backgroundOptions(db, body.sceneId);
  const background = body.selected.map((selected) => {
    const row = options.find((row) => row.type === selected.type && row.id === selected.id);
    if (!row) throw new Error("背景记录已变化，请重新选择");
    return row.sensitive && !body.allowSensitive ? { ...row, title: "敏感记录（未授权）", content: "[敏感资料未授权，本次不发送]" } : row;
  });
  const queries = body.queries.map((query) => redact(query, identifiers));
  // The public queries are separately entered and explicitly previewed. Never
  // derive them from private background, or send the focus question to search.
  return { background, queries, question: redact(body.question, identifiers) };
}
export async function createResearch(db: StrategyDB, input: unknown, configured: { search: boolean; ai: boolean }) {
  const body = createSchema.parse(input);
  const id = `research-${body.requestId}`;
  const existing = await db.researchBatch.findUnique({ where: { id } });
  if (existing) { if (existing.profileId !== PROFILE_ID) throw new Error("记录归属无效"); return { id }; }
  const preview = await previewResearch(db, body);
  if (JSON.stringify(preview) !== body.preview) throw new Error("发送资料已变化，请重新预览并确认");
  if (body.online && (!configured.search || !preview.queries.length)) throw new Error("联网收集需要配置 TAVILY_API_KEY 并填写公开检索词");
  if (body.previousId) await researchBatch(db, body.previousId);
  const sources = body.manual.map((row, index) => sourceSchema.parse({ id: `M${index + 1}`, title: row.title, url: row.url ? publicUrl(row.url) : null, publisher: row.url ? new URL(row.url).hostname : "手动补充，待核验", publishedAt: row.publishedAt, collectedAt: new Date().toISOString(), content: row.content, quality: row.content ? "manual" : row.url ? "pending" : "failed", group: row.url ? new URL(row.url).hostname : "manual", original: false, note: row.content ? "用户提供，未自动核验" : "" }));
  if (!body.online && !sources.length) throw new Error("请补充网页链接或正文");
  await db.researchBatch.create({ data: { id, ...where, sceneId: body.sceneId, question: preview.question, background: JSON.stringify(preview.background), queries: JSON.stringify(preview.queries), days: body.days, online: body.online, previousId: body.previousId, sources: JSON.stringify(dedupeSources(sources)) } });
  return { id };
}
export async function updateResearch(db: PrismaClient, operation: string, input: unknown) {
  const { id, version } = z.object({ id: z.string(), version: z.number().int() }).parse(input);
  const batch = await researchBatch(db, id);
  if (operation === "verify") {
    const retry = z.object({ index: z.number().int().min(0).max(4), verification: verificationSchema.omit({ at: true }) }).parse(input);
    const current = z.array(conclusionSchema).parse(JSON.parse(batch.conclusions))[retry.index];
    if (current?.feedback?.some((row) => row.id === retry.verification.id)) return { id };
  }
  if (batch.version !== version) throw new Error("研判已更新，请刷新后重试");
  if (["queued", "collecting", "analyzing"].includes(batch.status)) throw new Error("请等待本轮研判结束");
  if (operation === "retry") {
    if (batch.status !== "failed") throw new Error("仅失败任务可重试；更新请创建新一轮");
    return db.researchBatch.update({ where: { id }, data: { status: "queued", error: "", leaseToken: null, leaseUntil: null, slot: null, version: { increment: 1 } } });
  }
  if (operation === "follow-up") {
    const body = z.object({ date: z.string().date().nullable() }).parse(input);
    return db.researchBatch.update({ where: { id }, data: { followUpDate: body.date } });
  }
  if (operation === "supplement") {
    const body = z.object({ sourceId: z.string(), content: z.string().trim().min(1).max(16000) }).parse(input);
    const sources = z.array(sourceSchema).parse(JSON.parse(batch.sources));
    const source = sources.find((row) => row.id === body.sourceId);
    if (!source || batch.status !== "failed") throw new Error("仅失败批次可补充正文；已完成批次请新建更新");
    source.content = body.content; source.quality = "manual"; source.note = "用户补充正文，未自动核验";
    return db.researchBatch.update({ where: { id }, data: { sources: JSON.stringify(sources) } });
  }
  if (operation === "verify") {
    const body = z.object({ index: z.number().int().min(0).max(4), verification: verificationSchema.omit({ at: true }) }).parse(input);
    const conclusions = z.array(conclusionSchema).parse(JSON.parse(batch.conclusions));
    const conclusion = conclusions[body.index];
    if (!conclusion || batch.status !== "review") throw new Error("请先完成研判再验证");
    if (conclusion.feedback?.some((row) => row.id === body.verification.id)) return { id };
    conclusion.feedback = [...(conclusion.feedback || []), { ...body.verification, at: new Date().toISOString() }];
    conclusionSchema.parse(conclusion);
    const saved = await db.researchBatch.updateMany({ where: { id, ...where, version }, data: { conclusions: JSON.stringify(conclusions), version: { increment: 1 } } });
    if (!saved.count) throw new Error("研判已更新，请刷新后重试");
    return { id };
  }
  const body = z.object({ index: z.number().int().min(0).max(4), conclusion: conclusionSchema }).parse(input);
  const conclusions = z.array(conclusionSchema).parse(JSON.parse(batch.conclusions));
  if (!conclusions[body.index]) throw new Error("结论不存在");
  const linked = await db.recordSource.findFirst({ where: { ...where, sourceType: "research", sourceId: `${id}:${body.index}` } });
  if (linked) throw new Error("已转化的结论保留快照，请在新一轮更新");
  conclusions[body.index] = { ...body.conclusion, feedback: conclusions[body.index].feedback };
  validateAnalysis({ conclusions, gaps: batch.gaps, changes: batch.changes }, JSON.parse(batch.sources), JSON.parse(batch.background));
  const saved = await db.researchBatch.updateMany({ where: { id, ...where, version }, data: { conclusions: JSON.stringify(conclusions), version: { increment: 1 } } });
  if (!saved.count) throw new Error("研判已更新，请刷新后重试");
  return { id };
}
export async function convertResearch(db: PrismaClient, input: unknown) {
  const body = z.object({ id: z.string(), index: z.number().int().min(0).max(4), type: z.enum(["decision", "action"]), version: z.number().int(), title: z.string().trim().min(1).max(300), content: z.string().max(10000), standard: z.string().max(5000).default(""), dueDate: z.string().date().nullable().default(null) }).parse(input);
  const batch = await researchBatch(db, body.id), sourceId = `${batch.id}:${body.index}`;
  const linkId = `${sourceId}:${body.type}`;
  const existing = await db.recordSource.findFirst({ where: { ...where, id: linkId } });
  if (existing) return { id: existing.targetId, type: existing.targetType };
  if (batch.status !== "review" || batch.version !== body.version) throw new Error("研判尚未完成或已更新，请重新打开草稿");
  const conclusion = z.array(conclusionSchema).parse(JSON.parse(batch.conclusions))[body.index];
  if (!conclusion) throw new Error("结论不存在");
  if (!canRespond(conclusion.radar) || ["资料不足", "存在分歧"].includes(conclusion.evidence)) throw new Error("请先补充置信度及依据；低置信度、分歧或噪声信息仅观察核实，不转为应变决策或行动");
  const targetId = crypto.randomUUID();
  await writeTransaction(db, async (tx) => {
    if (body.type === "decision") await tx.decision.create({ data: { id: targetId, ...where, sceneId: batch.sceneId, title: body.title, context: body.content, facts: conclusion.facts, assumptions: conclusion.relevance, gaps: conclusion.uncertainty } });
    else await tx.action.create({ data: { id: targetId, ...where, sceneId: batch.sceneId, title: body.title, purpose: body.content, standard: body.standard, dueDate: body.dueDate ? new Date(body.dueDate) : null } });
    await tx.recordSource.create({ data: { id: linkId, ...where, sourceType: "research", sourceId, sourceTitle: `${batch.question}：${conclusion.title}`, targetType: body.type, targetId } });
  });
  return { id: targetId, type: body.type };
}
