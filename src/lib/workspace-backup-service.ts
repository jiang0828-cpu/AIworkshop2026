import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb, PROFILE_ID } from "@/lib/db";
import { profileSchema } from "@/lib/schemas";
import { dailyDataSchema, exportDaily, restoreDaily } from "@/lib/daily/backup";
import { initializeDaily, withDailyLock } from "@/lib/daily/service";
import { exportStrategy, orderedGoals, restoreStrategy, strategyBackupSchema, validateStrategyReferences } from "@/lib/strategy/backup";
import { writeTransaction, type SyncRow } from "@/lib/database-writes";
import { retainNewsUsage } from "@/lib/radar/news";
import { taskRecurrences } from "@/lib/task-schedule";
import { workspaceBackupFilename } from "@/lib/workspace-backup";

const include = {
  experiences: true, evidences: true, valueRules: true, resources: true, constraints: true, assumptions: true,
  goals: true, projects: { include: { milestones: true } }, actions: true, reviews: true,
  decisions: { include: { options: true } }, aiInstruction: true, suggestions: true, documentVersions: true,
  identityCard: { include: { versions: true } }, contextPackages: { include: { items: true, references: true } },
  aiTasks: { include: { feedbacks: true } }, correctionRecords: true, situationAssessment: true, situationItems: true,
} as const;

const record = z.object({ id: z.string().min(1).optional() }).passthrough();
const backupSchema = z.object({
  format: z.literal("ai-workbench-backup"),
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }).optional(),
  data: z.object({
    name: z.string().optional(), ageRange: z.string().optional(), birthYear: z.string().optional(), genderIdentity: z.string().optional(), city: z.string().optional(), education: z.string().optional(), major: z.string().optional(), personalityTraits: z.string().optional(),
    industry: z.string().optional(), organization: z.string().optional(), employmentStatus: z.string().optional(), jobTitle: z.string().optional(), stage: z.string().optional(), roles: z.string().optional(), responsibilities: z.string().optional(), professionalFocus: z.string().optional(),
    stageTransition: z.string().optional(), currentPriorities: z.string().optional(), stageNeeds: z.string().optional(), currentChallenges: z.string().optional(), directionOneToThreeYears: z.string().optional(), successDefinition: z.string().optional(),
    familyResponsibilities: z.string().optional(), healthEnergy: z.string().optional(), incomeRange: z.string().optional(), financialPressure: z.string().optional(), behaviorPatterns: z.string().optional(), riskPreference: z.string().optional(), sensitiveAiFields: z.string().optional(),
    experiences: z.array(record).default([]), evidences: z.array(record).default([]), valueRules: z.array(record).default([]), resources: z.array(record).default([]), constraints: z.array(record).default([]), assumptions: z.array(record).default([]),
    goals: z.array(record).default([]), projects: z.array(record.extend({ recordCode: z.string().regex(/^\d{8}A\d{2,}$/).nullish(), milestones: z.array(record).default([]) })).default([]), actions: z.array(record.extend({ recordCode: z.string().regex(/^\d{8}B\d{2,}$/).nullish(), recurrence: z.enum(taskRecurrences).default("none") })).default([]), reviews: z.array(record).default([]),
    decisions: z.array(record.extend({ options: z.array(record).default([]) })).default([]), aiInstruction: record.nullish(), suggestions: z.array(record).default([]), documentVersions: z.array(record).default([]),
    identityCard: record.extend({ versions: z.array(record).default([]) }).nullish(), contextPackages: z.array(record.extend({ items: z.array(record).default([]), references: z.array(record).default([]) })).default([]),
    aiTasks: z.array(record.extend({ feedbacks: z.array(record).default([]) })).default([]), correctionRecords: z.array(record).default([]), situationAssessment: record.nullish(), situationItems: z.array(record).default([]),
    dailyCollaboration: dailyDataSchema.optional(),
    strategy: strategyBackupSchema.optional(),
  }).passthrough(),
});

type BackupRecord = z.infer<typeof record>;
const toDate = (value: unknown) => value ? new Date(String(value)) : null;
const date = (row: BackupRecord, key: string) => toDate(row[key]);
const text = (row: BackupRecord, key: string, fallback = "") => typeof row[key] === "string" ? row[key] : fallback;
const number = (row: BackupRecord, key: string, fallback = 0) => typeof row[key] === "number" ? row[key] : fallback;
const boolean = (row: BackupRecord, key: string, fallback = false) => typeof row[key] === "boolean" ? row[key] : fallback;

export async function GET() {
  const db = await getDb();
  const data = await db.profile.findUniqueOrThrow({ where: { id: PROFILE_ID }, include });
  const exportedAt = new Date();
  return new NextResponse(JSON.stringify({ format: "ai-workbench-backup", version: 1, exportedAt: exportedAt.toISOString(), data: { ...data, strategy: await exportStrategy(db), dailyCollaboration: await exportDaily(db) } }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${workspaceBackupFilename(exportedAt)}"`, "Cache-Control": "no-store" } });
}

export async function POST(request: Request, capture?: (rows: SyncRow[]) => void) {
  try {
    const db = await getDb();
    const { data, exportedAt } = backupSchema.parse(await request.json());
    validateStrategyReferences(data);
    data.goals = orderedGoals(data.goals);
    data.projects = orderedGoals(data.projects, "项目");
    data.actions = orderedGoals(data.actions, "任务");
    await initializeDaily(db);
    const restore = async (tx: Prisma.TransactionClient) => {
      const newsUsage=await tx.radarRecord.findMany({where:{profileId:PROFILE_ID,kind:"newsUsage"}});
      await tx.executionPlan.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.radarRecord.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.researchBatch.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.goalBatch.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.selfActionReview.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.workbenchPin.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.recordSource.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.goalRelation.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.strategyVersion.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.strategyRecord.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.workbenchScene.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.dailyPlan.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.documentVersion.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.aISuggestion.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.aITaskFeedback.deleteMany({ where: { task: { profileId: PROFILE_ID } } });
      await tx.aITask.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.contextPackage.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.correctionRecord.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.situationItem.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.situationAssessment.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.identityCard.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.decision.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.review.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.action.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.project.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.goal.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.assumption.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.constraint.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.resource.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.valueRule.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.evidence.deleteMany({ where: { profileId: PROFILE_ID } });
      await tx.experience.deleteMany({ where: { profileId: PROFILE_ID } });

      await tx.profile.update({ where: { id: PROFILE_ID }, data: profileSchema.parse(data) });
      await tx.aIInstruction.upsert({ where: { profileId: PROFILE_ID }, update: data.aiInstruction ? { language: text(data.aiInstruction, "language", "中文"), answerLength: text(data.aiInstruction, "answerLength", "适中"), structure: text(data.aiInstruction, "structure", "先结论，后依据"), aiRole: text(data.aiInstruction, "aiRole", "提问者、分析者和记录助手"), delegate: text(data.aiInstruction, "delegate"), mustConfirm: text(data.aiInstruction, "mustConfirm", "重要目标、决策和对外行动"), privacyOptions: text(data.aiInstruction, "privacyOptions", "姓名和联系方式脱敏") } : {}, create: { profileId: PROFILE_ID } });

      for (const row of data.experiences) await tx.experience.create({ data: { id: row.id, profileId: PROFILE_ID, title: text(row, "title"), description: text(row, "description"), learning: text(row, "learning"), happenedAt: date(row, "happenedAt") } });
      for (const row of data.evidences) await tx.evidence.create({ data: { id: row.id, profileId: PROFILE_ID, ability: text(row, "ability"), evidence: text(row, "evidence"), confidence: number(row, "confidence", 3) } });
      for (const row of data.valueRules) await tx.valueRule.create({ data: { id: row.id, profileId: PROFILE_ID, value: text(row, "value"), priority: number(row, "priority", 3), rule: text(row, "rule"), conflict: text(row, "conflict") } });
      for (const row of data.resources) await tx.resource.create({ data: { id: row.id, profileId: PROFILE_ID, name: text(row, "name"), description: text(row, "description"), category: text(row, "category", "其他") } });
      for (const row of data.constraints) await tx.constraint.create({ data: { id: row.id, profileId: PROFILE_ID, name: text(row, "name"), description: text(row, "description"), severity: text(row, "severity", "中") } });
      for (const row of data.assumptions) await tx.assumption.create({ data: { id: row.id, profileId: PROFILE_ID, statement: text(row, "statement"), status: text(row, "status", "待验证"), evidence: text(row, "evidence") } });
      for (const row of data.goals) await tx.goal.create({ data: { id: row.id, profileId: PROFILE_ID, sceneId: text(row, "sceneId") || null, visionId: text(row, "visionId") || null, parentId: text(row, "parentId") || null, title: text(row, "title"), description: text(row, "description"), horizon: text(row, "horizon", "90天"), status: text(row, "status", "进行中"), metric: text(row, "metric"), deadline: date(row, "deadline") } });
      for (const row of data.projects) await tx.project.create({ data: { id: row.id, recordCode: row.recordCode || null, deadline: date(row, "deadline"), createdAt: date(row, "createdAt") || undefined, parentId: text(row, "parentId") || null, profileId: PROFILE_ID, sceneId: text(row, "sceneId") || null, visionId: text(row, "visionId") || null, goalId: text(row, "goalId") || null, name: text(row, "name"), description: text(row, "description"), status: text(row, "status", "进行中"), metric: text(row, "metric"), budget: text(row, "budget"), boundary: text(row, "boundary"), stopCondition: text(row, "stopCondition"), risk: text(row, "risk") } });
      for (const project of data.projects) for (const row of project.milestones) await tx.milestone.create({ data: { id: row.id, projectId: text(row, "projectId") || project.id || "", title: text(row, "title"), deadline: date(row, "deadline"), status: text(row, "status", "未开始"), metric: text(row, "metric") } });
      for (const row of data.actions) await tx.action.create({ data: { id: row.id, recordCode: row.recordCode || null, createdAt: date(row, "createdAt") || undefined, parentId: text(row, "parentId") || null, profileId: PROFILE_ID, sceneId: text(row, "sceneId") || null, goalId: text(row, "goalId") || null, projectId: text(row, "projectId") || null, title: text(row, "title"), purpose: text(row, "purpose"), dueDate: date(row, "dueDate"), recurrence: row.recurrence, estimatedHours: number(row, "estimatedHours", 1), standard: text(row, "standard"), status: text(row, "status", "待开始"), completedAt: date(row, "completedAt") } });
      for (const row of data.reviews) await tx.review.create({ data: { id: row.id, profileId: PROFILE_ID, periodStart: date(row, "periodStart") || new Date(), periodEnd: date(row, "periodEnd") || new Date(), wins: text(row, "wins"), goalIssue: text(row, "goalIssue"), strategyIssue: text(row, "strategyIssue"), executionIssue: text(row, "executionIssue"), externalIssue: text(row, "externalIssue"), adjustment: text(row, "adjustment") } });
      for (const row of data.decisions) await tx.decision.create({ data: { id: row.id, profileId: PROFILE_ID, sceneId: text(row, "sceneId") || null, visionId: text(row, "visionId") || null, goalId: text(row, "goalId") || null, signalId: text(row, "signalId") || null, title: text(row, "title"), context: text(row, "context"), criteria: text(row, "criteria"), facts: text(row, "facts"), assumptions: text(row, "assumptions"), gaps: text(row, "gaps"), selectedOption: text(row, "selectedOption"), rationale: text(row, "rationale"), risk: text(row, "risk"), reversible: boolean(row, "reversible", true), reviewDate: date(row, "reviewDate"), resultReview: text(row, "resultReview"), status: text(row, "status", "待决定") } });
      for (const decision of data.decisions) for (const row of decision.options) await tx.decisionOption.create({ data: { id: row.id, decisionId: text(row, "decisionId") || decision.id || "", name: text(row, "name"), benefit: text(row, "benefit"), cost: text(row, "cost"), risk: text(row, "risk"), score: number(row, "score") } });
      if (data.identityCard) {
        await tx.identityCard.create({ data: { id: data.identityCard.id, profileId: PROFILE_ID, currentVersion: number(data.identityCard, "currentVersion"), lengthMode: text(data.identityCard, "lengthMode", "标准"), structuredData: text(data.identityCard, "structuredData", "{}"), markdown: text(data.identityCard, "markdown"), status: text(data.identityCard, "status", "草稿"), source: text(data.identityCard, "source", "确定性模板") } });
        for (const row of data.identityCard.versions) await tx.identityCardVersion.create({ data: { id: row.id, profileId: PROFILE_ID, cardId: text(row, "cardId") || data.identityCard.id || "", version: number(row, "version"), lengthMode: text(row, "lengthMode", "标准"), structuredData: text(row, "structuredData", "{}"), markdown: text(row, "markdown"), source: text(row, "source", "确定性模板"), status: text(row, "status", "草稿") } });
      }
      for (const row of data.contextPackages) {
        await tx.contextPackage.create({ data: { id: row.id, profileId: PROFILE_ID, packageNumber: number(row, "packageNumber"), version: number(row, "version", 1), domain: text(row, "domain", "通用"), customDomain: text(row, "customDomain"), goalId: text(row, "goalId") || null, projectId: text(row, "projectId") || null, aiRole: text(row, "aiRole", "信息助手"), scope: text(row, "scope", "标准"), options: text(row, "options", "{}"), privacyOptions: text(row, "privacyOptions"), snapshot: text(row, "snapshot", "{}"), markdown: text(row, "markdown"), plainText: text(row, "plainText"), charCount: number(row, "charCount"), tokenEstimate: number(row, "tokenEstimate") } });
        for (const item of row.items) await tx.contextPackageItem.create({ data: { id: item.id, contextPackageId: text(item, "contextPackageId") || row.id || "", category: text(item, "category"), label: text(item, "label"), content: text(item, "content"), sourceType: text(item, "sourceType"), sourceId: text(item, "sourceId"), sourceLabel: text(item, "sourceLabel"), sourceDocumentKey: text(item, "sourceDocumentKey"), sourceVersion: text(item, "sourceVersion"), priority: number(item, "priority"), included: boolean(item, "included", true), excluded: boolean(item, "excluded"), redacted: boolean(item, "redacted") } });
        for (const reference of row.references) await tx.contextSourceReference.create({ data: { id: reference.id, contextPackageId: text(reference, "contextPackageId") || row.id || "", contextPackageItemId: text(reference, "contextPackageItemId") || null, sourceType: text(reference, "sourceType"), sourceId: text(reference, "sourceId"), sourceLabel: text(reference, "sourceLabel"), sourceDocumentKey: text(reference, "sourceDocumentKey"), sourceVersion: text(reference, "sourceVersion"), snapshot: text(reference, "snapshot") } });
      }
      for (const row of data.aiTasks) {
        await tx.aITask.create({ data: { id: row.id, profileId: PROFILE_ID, contextPackageId: text(row, "contextPackageId") || null, goalId: text(row, "goalId") || null, projectId: text(row, "projectId") || null, title: text(row, "title"), taskType: text(row, "taskType"), problem: text(row, "problem"), whyNow: text(row, "whyNow"), aiRole: text(row, "aiRole", "信息助手"), permission: text(row, "permission", "L1"), permissionOverrideReason: text(row, "permissionOverrideReason"), instructions: text(row, "instructions"), deliverables: text(row, "deliverables"), outputFormat: text(row, "outputFormat"), deadline: date(row, "deadline"), acceptanceCriteria: text(row, "acceptanceCriteria"), allowedOperations: text(row, "allowedOperations"), mustConfirmOperations: text(row, "mustConfirmOperations"), forbiddenOperations: text(row, "forbiddenOperations"), riskLevel: text(row, "riskLevel", "低"), requireUnderstandingCheck: boolean(row, "requireUnderstandingCheck"), status: text(row, "status", "草稿"), promptSnapshot: text(row, "promptSnapshot"), contextSnapshot: text(row, "contextSnapshot"), privacyPreview: text(row, "privacyPreview"), auditLog: text(row, "auditLog", "[]") } });
        for (const feedback of row.feedbacks) await tx.aITaskFeedback.create({ data: { id: feedback.id, taskId: text(feedback, "taskId") || row.id || "", understandingScore: typeof feedback.understandingScore === "number" ? feedback.understandingScore : null, constraintScore: typeof feedback.constraintScore === "number" ? feedback.constraintScore : null, executableScore: typeof feedback.executableScore === "number" ? feedback.executableScore : null, correctContent: text(feedback, "correctContent"), incorrectContent: text(feedback, "incorrectContent"), missingInformation: text(feedback, "missingInformation"), violatedConstraints: text(feedback, "violatedConstraints"), adopted: boolean(feedback, "adopted"), actualAction: text(feedback, "actualAction"), actualResult: text(feedback, "actualResult"), correctionRequest: text(feedback, "correctionRequest"), preferenceUpdate: text(feedback, "preferenceUpdate") } });
      }
      for (const row of data.correctionRecords) await tx.correctionRecord.create({ data: { id: row.id, profileId: PROFILE_ID, feedbackId: text(row, "feedbackId") || null, category: text(row, "category"), target: text(row, "target"), content: text(row, "content"), priority: number(row, "priority", 1), status: text(row, "status", "已确认"), source: text(row, "source", "用户确认") } });
      if (data.situationAssessment) await tx.situationAssessment.create({ data: { profileId: PROFILE_ID, todayStatus: text(data.situationAssessment, "todayStatus"), todaySignals: text(data.situationAssessment, "todaySignals"), todayJudgement: text(data.situationAssessment, "todayJudgement"), keyEvents: text(data.situationAssessment, "keyEvents"), keyEventAnalysis: text(data.situationAssessment, "keyEventAnalysis"), trendRadar: text(data.situationAssessment, "trendRadar"), trendStage: text(data.situationAssessment, "trendStage"), trendScenarios: text(data.situationAssessment, "trendScenarios"), enterpriseImpact: text(data.situationAssessment, "enterpriseImpact"), enterpriseActions: text(data.situationAssessment, "enterpriseActions"), personalImpact: text(data.situationAssessment, "personalImpact"), personalActions: text(data.situationAssessment, "personalActions"), sourceNotes: text(data.situationAssessment, "sourceNotes") } });
      for (const row of data.situationItems) await tx.situationItem.create({ data: { id: row.id, profileId: PROFILE_ID, category: text(row, "category", "today"), title: text(row, "title"), content: text(row, "content") } });
      for (const row of data.suggestions) await tx.aISuggestion.create({ data: { id: row.id, profileId: PROFILE_ID, type: text(row, "type"), title: text(row, "title"), content: text(row, "content"), source: text(row, "source", "规则模板"), status: text(row, "status", "待确认"), sentScope: text(row, "sentScope"), targetType: text(row, "targetType"), targetId: text(row, "targetId"), payload: text(row, "payload"), sourceTaskId: text(row, "sourceTaskId") || null, sourceFeedbackId: text(row, "sourceFeedbackId") || null } });
      for (const row of data.documentVersions) await tx.documentVersion.create({ data: { id: row.id, profileId: PROFILE_ID, documentKey: text(row, "documentKey"), title: text(row, "title"), content: text(row, "content"), source: text(row, "source", "结构化数据") } });
      await restoreStrategy(tx, data.strategy);
      await retainNewsUsage(tx,newsUsage);
      await restoreDaily(tx, data.dailyCollaboration || { plans: [], agents: [] }, exportedAt);
    };
    if (capture) await writeTransaction(db, restore, true, capture);
    else await withDailyLock(db, async () => {
      await writeTransaction(db, restore);
    }, true);
    return NextResponse.json({ ok: true, imported: { experiences: data.experiences.length, goals: data.goals.length, actions: data.actions.length, documents: data.documentVersions.length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? `导入失败：${error.message}` : "导入失败，请确认这是 AI 工作台导出的 JSON" }, { status: 400 });
  }
}
