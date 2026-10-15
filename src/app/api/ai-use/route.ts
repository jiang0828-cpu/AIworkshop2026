import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, PROFILE_ID } from "@/lib/db";
import { strategyView } from "@/lib/strategy/service";
import {
  aiUseOperationSchema,
  contextItemUpdateSchema,
  contextPackageRequestSchema,
  correctionPayloadSchema,
  feedbackSchema,
  identityCardDataSchema,
  identityLengthModeSchema,
  parseOptionalDate,
  taskInputSchema,
  taskStatusSchema,
} from "@/lib/schemas";
import {
  analyzeTaskFeedback,
  buildIdentityCardData,
  buildTaskPrompt,
  canTransitionTask,
  generateAITaskPrompt,
  generateContextPackage,
  generateGoalDecomposition,
  generateIdentityCard,
  isHighRisk,
  json,
  nextGoalHorizon,
  parseJson,
  renderContextPackage,
  renderIdentityCard,
  selectContext,
  selectRelevantContext,
  type ContextDraftItem,
} from "@/lib/ai-use";

type Audit = Record<string, unknown>;

const bundleInclude = {
  experiences: true, evidences: true, valueRules: true, resources: true, constraints: true, assumptions: true,
  goals: true, projects: { include: { milestones: true } }, actions: true, reviews: true, decisions: { include: { options: true } },
  aiInstruction: true, identityCard: true, correctionRecords: { orderBy: { updatedAt: "desc" as const } }, suggestions: { orderBy: { createdAt: "desc" as const } },
} as const;
const requestSchema = z.object({ action: aiUseOperationSchema }).passthrough();
const itemDraft = (item: Record<string, unknown>): ContextDraftItem => ({
  id: String(item.id), category: String(item.category), label: String(item.label), content: String(item.content), sourceType: String(item.sourceType), sourceId: String(item.sourceId || ""), sourceLabel: String(item.sourceLabel || ""), sourceDocumentKey: String(item.sourceDocumentKey || ""), sourceVersion: String(item.sourceVersion || ""), priority: Number(item.priority || 0), included: Boolean(item.included), excluded: Boolean(item.excluded), redacted: Boolean(item.redacted),
});

async function profileBundle() { const db = await getDb(); const profile = await db.profile.findUniqueOrThrow({ where: { id: PROFILE_ID }, include: bundleInclude }); return { ...profile, strategy: await strategyView(db) }; }
async function ensureCard() {
  const db = await getDb();
  return db.identityCard.upsert({ where: { profileId: PROFILE_ID }, update: {}, create: { profileId: PROFILE_ID } });
}
async function rebuildContextPackage(packageId: string) {
  const db = await getDb();
  const found = await db.contextPackage.findFirstOrThrow({ where: { id: packageId, profileId: PROFILE_ID }, include: { items: { orderBy: { priority: "desc" } } } });
  const rendered = renderContextPackage({ packageNumber: found.packageNumber, version: found.version + 1, domain: found.domain, customDomain: found.customDomain, role: found.aiRole, scope: found.scope, items: found.items.map((item) => itemDraft(item as unknown as Record<string, unknown>)) });
  return db.contextPackage.update({ where: { id: found.id }, data: { version: { increment: 1 }, markdown: rendered.markdown, plainText: rendered.plainText, charCount: rendered.charCount, tokenEstimate: rendered.tokenEstimate } });
}
async function createCardVersion(input: { data: z.infer<typeof identityCardDataSchema>; mode: z.infer<typeof identityLengthModeSchema>; source: string; status?: string }) {
  const db = await getDb();
  const card = await ensureCard();
  const next = card.currentVersion + 1;
  const markdown = renderIdentityCard(input.data, input.mode, next);
  const version = await db.identityCardVersion.create({ data: { profileId: PROFILE_ID, cardId: card.id, version: next, lengthMode: input.mode, structuredData: json(input.data), markdown, source: input.source, status: input.status || "草稿" } });
  await db.identityCard.update({ where: { id: card.id }, data: { currentVersion: next, lengthMode: input.mode, structuredData: json(input.data), markdown, source: input.source, status: input.status || "草稿" } });
  return version;
}

export async function GET() {
  const db = await getDb();
  const profile = await profileBundle();
  const [cardVersions, packages, tasks, feedbacks, corrections] = await Promise.all([
    db.identityCardVersion.findMany({ where: { profileId: PROFILE_ID }, orderBy: { createdAt: "desc" } }),
    db.contextPackage.findMany({ where: { profileId: PROFILE_ID }, include: { items: { orderBy: { priority: "desc" } }, references: true }, orderBy: { createdAt: "desc" } }),
    db.aITask.findMany({ where: { profileId: PROFILE_ID }, include: { contextPackage: true, feedbacks: { orderBy: { createdAt: "desc" } } }, orderBy: { updatedAt: "desc" } }),
    db.aITaskFeedback.findMany({ where: { task: { profileId: PROFILE_ID } }, include: { task: { select: { title: true } } }, orderBy: { createdAt: "desc" } }),
    db.correctionRecord.findMany({ where: { profileId: PROFILE_ID }, orderBy: { updatedAt: "desc" } }),
  ]);
  return NextResponse.json({ profile, cardVersions, packages, tasks, feedbacks, corrections, aiConfigured: Boolean(process.env.AI_API_KEY) });
}

export async function POST(request: Request) {
  try {
    const db = await getDb();
    const body = requestSchema.parse(await request.json());
    if (body.action === "identity-generate") {
      const mode = identityLengthModeSchema.parse(body.lengthMode || "标准");
      const exclusions = z.array(z.string()).default([]).parse(body.exclusions || []);
      const base = buildIdentityCardData(await profileBundle(), exclusions);
      const result = await generateIdentityCard(base);
      const version = await createCardVersion({ data: identityCardDataSchema.parse(result.data) as Parameters<typeof createCardVersion>[0]["data"], mode, source: result.source });
      return NextResponse.json({ version, error: result.error, configured: result.configured });
    }
    if (body.action === "goal-decompose") {
      const goalId = z.string().min(1).parse(body.goalId);
      const goal = (await db.goal.findFirst({ where: { id: goalId, profileId: PROFILE_ID } })) as unknown as Record<string, unknown> | null;
      if (!goal) return NextResponse.json({ error: "目标不存在或不属于当前档案" }, { status: 404 });
      const requestedHorizon = z.enum(["5年", "3年", "1年", "90天", "本周"]).parse(body.targetHorizon);
      const targetHorizon = nextGoalHorizon(String(goal.horizon || ""));
      if (!targetHorizon || requestedHorizon !== targetHorizon) return NextResponse.json({ error: `“${String(goal.horizon || "当前目标")}”只能分解到下一层目标，当前应生成“${targetHorizon || "无"}”。` }, { status: 400 });
      const result = await generateGoalDecomposition({ goal, targetHorizon });
      return NextResponse.json({ parent: goal, targetHorizon, goals: result.data.goals, error: result.error, configured: result.configured, source: result.source });
    }
    if (body.action === "identity-save") {
      const mode = identityLengthModeSchema.parse(body.lengthMode || "标准");
      const data = identityCardDataSchema.parse(body.data);
      return NextResponse.json({ version: await createCardVersion({ data, mode, source: "用户编辑" }) });
    }
    if (body.action === "identity-confirm") {
      const versionId = z.string().min(1).parse(body.versionId);
      const version = await db.identityCardVersion.findFirstOrThrow({ where: { id: versionId, profileId: PROFILE_ID } });
      await db.$transaction([
        db.identityCardVersion.update({ where: { id: version.id }, data: { status: "已确认" } }),
        db.identityCard.update({ where: { id: version.cardId }, data: { currentVersion: version.version, lengthMode: version.lengthMode, structuredData: version.structuredData, markdown: version.markdown, source: version.source, status: "已确认" } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "identity-restore") {
      const versionId = z.string().min(1).parse(body.versionId);
      const source = await db.identityCardVersion.findFirstOrThrow({ where: { id: versionId, profileId: PROFILE_ID } });
      return NextResponse.json({ version: await createCardVersion({ data: identityCardDataSchema.parse(parseJson(source.structuredData, {})), mode: identityLengthModeSchema.parse(source.lengthMode), source: "版本恢复" }) });
    }
    if (body.action === "context-preview") {
      const config = contextPackageRequestSchema.parse(body.config);
      const profile = await profileBundle(); const exclusions = (body.exclusions as string[] | undefined) || [];
      const items = selectContext(profile, { ...config, exclusions });
      const rendered = renderContextPackage({ packageNumber: 0, version: 1, domain: config.domain, customDomain: config.customDomain, role: config.aiRole, scope: config.scope, items });
      return NextResponse.json({ items, privacyPreview: rendered.markdown, charCount: rendered.charCount, tokenEstimate: rendered.tokenEstimate });
    }
    if (body.action === "context-generate") {
      const config = contextPackageRequestSchema.parse(body.config);
      const profile = await profileBundle();
      const exclusions = (body.exclusions as string[] | undefined) || [];
      const suggested = selectContext(profile, { ...config, exclusions });
      const aiSelection = await selectRelevantContext(suggested);
      const selected = aiSelection.configured ? suggested.filter((item) => aiSelection.data.selectedIds.includes(item.id)) : suggested;
      const items = selected.length ? selected : suggested;
      const max = await db.contextPackage.aggregate({ where: { profileId: PROFILE_ID }, _max: { packageNumber: true } });
      const packageNumber = (max._max.packageNumber || 0) + 1;
      const rendered = renderContextPackage({ packageNumber, version: 1, domain: config.domain, customDomain: config.customDomain, role: config.aiRole, scope: config.scope, items });
      const enhancement = await generateContextPackage(rendered.markdown);
      const created = await db.contextPackage.create({ data: { profileId: PROFILE_ID, packageNumber, domain: config.domain, customDomain: config.customDomain, goalId: config.goalId || null, projectId: config.projectId || null, aiRole: config.aiRole, scope: config.scope, options: json(config.options), privacyOptions: config.privacyOptions, snapshot: json({ note: enhancement.data.note, generatedAt: new Date().toISOString() }), markdown: rendered.markdown, plainText: rendered.plainText, charCount: rendered.charCount, tokenEstimate: rendered.tokenEstimate, items: { create: items.map((item) => ({ ...item, id: undefined })) }, references: { create: items.map((item) => ({ sourceType: item.sourceType, sourceId: item.sourceId, sourceLabel: item.sourceLabel, sourceDocumentKey: item.sourceDocumentKey, sourceVersion: item.sourceVersion, snapshot: item.content })) } }, include: { items: true, references: true } });
      return NextResponse.json({ package: created, error: aiSelection.error || enhancement.error, configured: aiSelection.configured || enhancement.configured });
    }
    if (body.action === "context-update-items") {
      const packageId = z.string().min(1).parse(body.packageId);
      const updates = z.array(contextItemUpdateSchema).min(1).max(100).parse(body.items);
      const existing = await db.contextPackage.findFirstOrThrow({ where: { id: packageId, profileId: PROFILE_ID }, include: { items: true } });
      await db.$transaction(updates.map((update) => db.contextPackageItem.updateMany({ where: { id: update.id, contextPackageId: existing.id }, data: { ...(update.included === undefined ? {} : { included: update.included }), ...(update.excluded === undefined ? {} : { excluded: update.excluded }), ...(update.redacted === undefined ? {} : { redacted: update.redacted }), ...(update.content === undefined ? {} : { content: update.content }) } })));
      const updated = await rebuildContextPackage(existing.id);
      return NextResponse.json({ package: updated });
    }
    if (body.action === "context-add-item") {
      const packageId = z.string().min(1).parse(body.packageId);
      const item = z.object({ category: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(10000) }).parse(body.item);
      const found = await db.contextPackage.findFirstOrThrow({ where: { id: packageId, profileId: PROFILE_ID } });
      const created = await db.contextPackageItem.create({ data: { contextPackageId: found.id, ...item, sourceType: "manual", sourceLabel: "用户手动补充", priority: 80 } });
      await db.contextSourceReference.create({ data: { contextPackageId: found.id, contextPackageItemId: created.id, sourceType: "manual", sourceLabel: "用户手动补充", sourceDocumentKey: "手动输入", snapshot: created.content } });
      await rebuildContextPackage(found.id);
      return NextResponse.json({ item: created });
    }
    if (body.action === "context-delete-item") {
      const packageId = z.string().min(1).parse(body.packageId); const id = z.string().min(1).parse(body.id);
      const found = await db.contextPackage.findFirstOrThrow({ where: { id: packageId, profileId: PROFILE_ID } });
      await db.contextPackageItem.deleteMany({ where: { id, contextPackageId: found.id } });
      await rebuildContextPackage(found.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "task-create") {
      const task = taskInputSchema.parse(body.task);
      const overrideConfirmed = z.boolean().default(false).parse(body.highRiskOverrideConfirmed);
      const context = task.contextPackageId ? await db.contextPackage.findFirst({ where: { id: task.contextPackageId, profileId: PROFILE_ID } }) : null;
      const highRisk = isHighRisk(context?.domain || task.taskType, task.riskLevel);
      if (highRisk && ["L3", "L4"].includes(task.permission) && (!overrideConfirmed || !task.permissionOverrideReason.trim())) return NextResponse.json({ error: "高风险任务提升到 L3/L4 需要二次确认并填写原因。" }, { status: 400 });
      const created = await db.aITask.create({ data: { profileId: PROFILE_ID, ...task, goalId: task.goalId || null, projectId: task.projectId || null, contextPackageId: task.contextPackageId || null, deadline: parseOptionalDate(task.deadline), auditLog: json([{ at: new Date().toISOString(), event: "创建任务", highRisk, overrideConfirmed }]) } });
      return NextResponse.json({ task: created, highRisk });
    }
    if (body.action === "task-update") {
      const id = z.string().min(1).parse(body.id); const task = taskInputSchema.parse(body.task);
      const found = await db.aITask.findFirstOrThrow({ where: { id, profileId: PROFILE_ID } });
      const updated = await db.aITask.update({ where: { id: found.id }, data: { ...task, goalId: task.goalId || null, projectId: task.projectId || null, contextPackageId: task.contextPackageId || null, deadline: parseOptionalDate(task.deadline) } });
      return NextResponse.json({ task: updated });
    }
    if (body.action === "task-transition") {
      const id = z.string().min(1).parse(body.id); const status = taskStatusSchema.parse(body.status);
      const found = await db.aITask.findFirstOrThrow({ where: { id, profileId: PROFILE_ID } });
      if (!canTransitionTask(found.status, status)) return NextResponse.json({ error: `不能从“${found.status}”直接变更为“${status}”。` }, { status: 400 });
      const log = parseJson<Array<Audit>>(found.auditLog, []); log.push({ at: new Date().toISOString(), event: `状态变更为${status}` });
      return NextResponse.json({ task: await db.aITask.update({ where: { id }, data: { status, auditLog: json(log) } }) });
    }
    if (body.action === "task-generate-prompt") {
      const id = z.string().min(1).parse(body.id);
      const task = await db.aITask.findFirstOrThrow({ where: { id, profileId: PROFILE_ID }, include: { contextPackage: true } });
      const profile = await profileBundle();
      const identity = profile.identityCard?.markdown || renderIdentityCard(buildIdentityCardData(profile), "精简");
      const prompt = buildTaskPrompt(task as unknown as Record<string, unknown>, profile.aiInstruction as unknown as Record<string, unknown>, identity, task.contextPackage?.markdown || "尚未关联上下文包。");
      const enhancement = await generateAITaskPrompt(prompt);
      const updated = await db.aITask.update({ where: { id }, data: { promptSnapshot: prompt, contextSnapshot: task.contextPackage?.markdown || "", privacyPreview: task.contextPackage?.markdown || "" } });
      return NextResponse.json({ task: updated, error: enhancement.error, configured: enhancement.configured });
    }
    if (body.action === "feedback-create") {
      const feedback = feedbackSchema.parse(body.feedback);
      const task = await db.aITask.findFirstOrThrow({ where: { id: feedback.taskId, profileId: PROFILE_ID } });
      const created = await db.aITaskFeedback.create({ data: { ...feedback, understandingScore: feedback.understandingScore || null, constraintScore: feedback.constraintScore || null, executableScore: feedback.executableScore || null } });
      const analysis = await analyzeTaskFeedback({ ...feedback });
      await db.$transaction(analysis.data.corrections.map((item) => db.aISuggestion.create({ data: { profileId: PROFILE_ID, type: "档案纠正", title: item.category, content: item.content, source: analysis.source, sentScope: "任务反馈", status: "待确认", targetType: "correction", targetId: item.target, payload: json(item), sourceTaskId: task.id, sourceFeedbackId: created.id } })));
      if (task.status === "待验收") await db.aITask.update({ where: { id: task.id }, data: { status: "完成" } });
      return NextResponse.json({ feedback: created, suggestions: analysis.data.corrections.length, error: analysis.error, configured: analysis.configured });
    }
    if (body.action === "suggestion-confirm") {
      const id = z.string().min(1).parse(body.id);
      const suggestion = await db.aISuggestion.findFirstOrThrow({ where: { id, profileId: PROFILE_ID, status: "待确认", targetType: "correction" } });
      const payload = correctionPayloadSchema.parse(parseJson(suggestion.payload, { category: "纠正", content: suggestion.content, target: suggestion.targetId, priority: 1 }));
      await db.$transaction([db.aISuggestion.update({ where: { id }, data: { status: "已确认" } }), db.correctionRecord.create({ data: { profileId: PROFILE_ID, feedbackId: suggestion.sourceFeedbackId, ...payload, source: "用户确认的 AI 反馈建议" } })]);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "suggestion-reject") {
      const id = z.string().min(1).parse(body.id);
      await db.aISuggestion.updateMany({ where: { id, profileId: PROFILE_ID, status: "待确认" }, data: { status: "已拒绝" } });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "correction-delete") {
      const id = z.string().min(1).parse(body.id);
      await db.correctionRecord.deleteMany({ where: { id, profileId: PROFILE_ID } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知 AI 使用中心操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 使用中心操作失败" }, { status: 400 });
  }
}
