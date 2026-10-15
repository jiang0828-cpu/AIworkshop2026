import { z } from "zod";

const text = z.string().trim().max(5000).default("");
export const sensitiveProfileAiFields = ["organization", "familyResponsibilities", "healthEnergy", "incomeRange", "financialPressure"] as const;
export type SensitiveProfileAiField = (typeof sensitiveProfileAiFields)[number];
export function parseSensitiveProfileAiFields(value: unknown): SensitiveProfileAiField[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return z.array(z.enum(sensitiveProfileAiFields)).parse(parsed);
  } catch {
    return [];
  }
}
const sensitiveAiFieldsSchema = z.string().default("[]").transform((value, context) => {
  try {
    const validated = z.array(z.enum(sensitiveProfileAiFields)).max(sensitiveProfileAiFields.length).parse(JSON.parse(value));
    return JSON.stringify([...new Set(validated)]);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "敏感字段授权格式无效" });
    return z.NEVER;
  }
});
export const profileSchema = z.object({
  name: text, ageRange: text, birthYear: text, genderIdentity: text, city: text, education: text, major: text, personalityTraits: text,
  industry: text, organization: text, employmentStatus: text, jobTitle: text, stage: text, roles: text,
  responsibilities: text, professionalFocus: text, stageTransition: text, currentPriorities: text, stageNeeds: text,
  currentChallenges: text, directionOneToThreeYears: text, successDefinition: text, familyResponsibilities: text,
  healthEnergy: text, incomeRange: text, financialPressure: text, behaviorPatterns: text, riskPreference: text,
  sensitiveAiFields: sensitiveAiFieldsSchema,
});
export const profilePatchSchema = profileSchema.partial();
export const instructionSchema = z.object({ language: text, answerLength: text, structure: text, aiRole: text, delegate: text, mustConfirm: text, privacyOptions: text });
export const situationAssessmentSchema = z.object({
  todayStatus: text, todaySignals: text, todayJudgement: text,
  keyEvents: text, keyEventAnalysis: text,
  trendRadar: text, trendStage: text, trendScenarios: text,
  enterpriseImpact: text, enterpriseActions: text,
  personalImpact: text, personalActions: text, sourceNotes: text,
});
export const situationItemSchema = z.object({
  category: z.enum(["today", "events", "trends", "enterprise", "personal"]),
  title: z.string().trim().min(1, "标题不能为空").max(200),
  content: text,
});
export const entityTypes = ["experience", "evidence", "valueRule", "resource", "constraint", "assumption", "goal", "project", "milestone", "action", "review", "decision", "decisionOption", "situationAssessment", "situationItem"] as const;
export const entityTypeSchema = z.enum(entityTypes);
export const entitySchema = z.object({
  type: entityTypeSchema,
  data: z.record(z.unknown()),
});
export const goalDecomposeSchema = z.object({
  goals: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).default(""),
    horizon: z.enum(["5年", "3年", "1年", "90天", "本月", "本周"]),
    metric: z.string().trim().max(1000).default(""),
  })).min(1).max(5),
});
export const updateSchema = z.object({ type: z.union([entityTypeSchema, z.literal("profile"), z.literal("instruction")]), id: z.string().optional(), data: z.record(z.unknown()) });
export const deleteSchema = z.object({ type: z.union([entityTypeSchema, z.literal("all")]), id: z.string().min(1).optional() }).superRefine((value, context) => {
  if (value.type !== "all" && !value.id) context.addIssue({ code: z.ZodIssueCode.custom, message: "缺少删除记录 ID", path: ["id"] });
});
export const suggestionSchema = z.object({ type: text, title: text, content: text, source: text, sentScope: text });
export const aiResponseSchema = z.object({ kind: z.enum(["questions", "analysis", "extraction", "suggestion"]), items: z.array(z.object({ title: text, content: text, category: text.nullish().transform((value) => value || undefined) })) });
export const aiRequestSchema = z.object({
  kind: z.enum(["questions", "analysis", "extraction", "suggestion"]).default("questions"),
  scope: z.array(z.string().trim().min(1).max(120)).min(1).max(20).default(["个人阶段", "目标", "行动", "约束"]),
});

export const identityLengthModes = ["精简", "标准", "详细"] as const;
export const identityLengthModeSchema = z.enum(identityLengthModes);
export const taskDomains = ["通用", "职业", "商业", "学习", "写作", "技术", "生活", "健康", "财务", "决策", "自定义"] as const;
export const taskDomainSchema = z.enum(taskDomains);
export const contextScopes = ["最小", "标准", "详细"] as const;
export const contextScopeSchema = z.enum(contextScopes);
export const aiRoles = ["信息助手", "思考伙伴", "反方辩手", "决策顾问", "执行助手", "复盘教练", "编程代理"] as const;
export const aiRoleSchema = z.enum(aiRoles);
export const permissionLevels = ["L1", "L2", "L3", "L4"] as const;
export const permissionLevelSchema = z.enum(permissionLevels);
export const taskStatuses = ["草稿", "待确认", "可执行", "执行中", "待验收", "完成", "归档"] as const;
export const taskStatusSchema = z.enum(taskStatuses);
const shortText = z.string().trim().max(20000).default("");
const textList = z.array(z.string().trim().min(1).max(2000)).max(30).default([]);

export const identityCardDataSchema = z.object({
  primaryIdentity: shortText,
  stage: shortText,
  directions: textList,
  mainGoal: shortText,
  abilities: textList,
  resources: textList,
  constraints: textList,
  values: textList,
  riskPreference: shortText,
  nonNegotiables: textList,
  communication: shortText,
  directHelp: textList,
  mustConfirm: textList,
  prohibited: textList,
  assumptions: textList,
  exclusions: z.array(z.enum(["收入", "公司", "家庭", "健康"])).default([]),
});
export type IdentityCardData = z.infer<typeof identityCardDataSchema>;

export const contextOptionsSchema = z.object({
  includeHistory: z.boolean().default(false),
  includeReviews: z.boolean().default(false),
  includeDecisions: z.boolean().default(false),
  includeCorrections: z.boolean().default(true),
  includeAssumptions: z.boolean().default(true),
  exclusions: z.array(z.string().max(200)).max(100).default([]),
});
export const contextPackageRequestSchema = z.object({
  domain: taskDomainSchema,
  customDomain: shortText,
  goalId: z.string().trim().max(100).optional().nullable(),
  projectId: z.string().trim().max(100).optional().nullable(),
  aiRole: aiRoleSchema,
  scope: contextScopeSchema,
  options: contextOptionsSchema.default({}),
  privacyOptions: shortText,
});
export const contextItemUpdateSchema = z.object({
  id: z.string().min(1),
  included: z.boolean().optional(),
  excluded: z.boolean().optional(),
  redacted: z.boolean().optional(),
  content: shortText.optional(),
});

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "任务名称不能为空").max(300),
  taskType: z.string().trim().min(1, "任务类型不能为空").max(100),
  problem: shortText,
  whyNow: shortText,
  goalId: z.string().trim().max(100).optional().nullable(),
  projectId: z.string().trim().max(100).optional().nullable(),
  contextPackageId: z.string().trim().max(100).optional().nullable(),
  aiRole: aiRoleSchema,
  permission: permissionLevelSchema,
  permissionOverrideReason: shortText,
  instructions: shortText,
  deliverables: shortText,
  outputFormat: shortText,
  deadline: z.string().trim().max(100).optional().nullable(),
  acceptanceCriteria: shortText,
  allowedOperations: shortText,
  mustConfirmOperations: shortText,
  forbiddenOperations: shortText,
  riskLevel: z.enum(["低", "中", "高"]),
  requireUnderstandingCheck: z.boolean().default(false),
  status: taskStatusSchema.default("草稿"),
});
export const feedbackSchema = z.object({
  taskId: z.string().min(1),
  understandingScore: z.number().int().min(1).max(5).nullable().optional(),
  constraintScore: z.number().int().min(1).max(5).nullable().optional(),
  executableScore: z.number().int().min(1).max(5).nullable().optional(),
  correctContent: shortText,
  incorrectContent: shortText,
  missingInformation: shortText,
  violatedConstraints: shortText,
  adopted: z.boolean().default(false),
  actualAction: shortText,
  actualResult: shortText,
  correctionRequest: shortText,
  preferenceUpdate: shortText,
});
export const correctionPayloadSchema = z.object({
  category: z.string().trim().min(1).max(100),
  target: shortText,
  content: z.string().trim().min(1).max(5000),
  priority: z.number().int().min(1).max(5).default(1),
});
export const aiUseOperationSchema = z.enum(["identity-generate", "identity-save", "identity-confirm", "identity-restore", "context-preview", "context-generate", "context-update-items", "context-add-item", "context-delete-item", "task-create", "task-update", "task-transition", "task-generate-prompt", "feedback-create", "suggestion-confirm", "suggestion-reject", "correction-delete", "goal-decompose"]);

export const documentKeys = ["profile", "goals", "instruction", "actions", "decisions"] as const;
export type DocumentKey = (typeof documentKeys)[number];
export const documentKeySchema = z.enum(documentKeys);

export function parseOptionalDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
