import { selfSections } from "./self-transfer";
import { sceneProfileGroups } from "./strategy/profile-scene-layout";

export type SelfExportRow = { section: string; scene: string; title: string; field: string; value: string; recordId?: string };
export type SelfBackupData = {
  profile?: Record<string, unknown>;
  experiences?: Array<Record<string, unknown>>;
  evidences?: Array<Record<string, unknown>>;
  valueRules?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  assumptions?: Array<Record<string, unknown>>;
  strategy?: { scenes?: Array<Record<string, unknown>>; records?: Array<Record<string, unknown>>; versions?: Array<Record<string, unknown>> };
};

const labels: Record<string, string> = {
  name: "姓名", ageRange: "年龄段", birthYear: "出生年份", genderIdentity: "性别认同", city: "所在城市", education: "学历", major: "专业",
  personalityTraits: "性格特征", industry: "行业", organization: "组织", employmentStatus: "就业状态", jobTitle: "职位", stage: "当前阶段",
  roles: "角色", responsibilities: "职责", professionalFocus: "专业重点", stageTransition: "阶段变化", currentPriorities: "当前优先事项",
  stageNeeds: "阶段需求", currentChallenges: "当前挑战", directionOneToThreeYears: "一至三年方向", successDefinition: "成功定义",
  familyResponsibilities: "家庭责任", healthEnergy: "健康与精力", incomeRange: "收入范围", financialPressure: "财务压力", behaviorPatterns: "行为模式", riskPreference: "风险偏好",
  expected: "期望状态", mainGoals: "主要目标", metric: "衡量标准", horizon: "时间范围", boundary: "底线", improvement: "待提升项与下一步",
  rating: "自评", importance: "重要性", importanceReason: "重要性依据", requirementStatus: "需求状态", layer: "能力层级", method: "实现渠道",
  description: "说明", learning: "学到什么", happenedAt: "发生时间", ability: "能力", evidence: "证据", confidence: "可信度", value: "价值规则", priority: "优先级", rule: "规则", conflict: "冲突处理",
  category: "类别", severity: "严重程度", statement: "假设", status: "状态", title: "标题", content: "内容", versionAt: "版本时间",
  evidenceId: "关联能力证据", gap: "能力差距", resourceNeeds: "资源需求", successCriteria: "验收标准", archived: "归档状态",
  element: "资源要素", capitalClass: "资源分类", availability: "可用状态", available: "可用存量", allocation: "计划投入",
  expectedReturn: "预期产出", actualReturn: "实际产出", actualInvestment: "实际投入", observation: "使用观察", adjustment: "复盘结论",
  nextStep: "下一步", nextCheckDate: "下次检查", lastEvaluation: "最近评估", actionId: "行动编号", reviewId: "复盘编号",
  reviewVersion: "复盘版本", evaluatedAt: "评估时间", role: "角色", currentState: "当前状态", support: "支持条件",
  focus: "当前重点", direction: "后续方向", baseline: "当前基础", limitations: "限制", habits: "习惯",
};

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${labels[key] || key}：${text(item)}`).filter(Boolean).join("\n");
};

const dateText = (value: unknown) => {
  const valueText = text(value);
  if (!valueText) return "";
  const date = new Date(valueText);
  return Number.isNaN(date.getTime()) ? valueText : date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
};

function add(rows: SelfExportRow[], section: string, scene: string, title: string, values: Record<string, unknown>, omit: string[] = [], recordId?: string) {
  for (const [key, value] of Object.entries(values)) {
    if (omit.includes(key)) continue;
    const result = key.endsWith("At") || key === "happenedAt" ? dateText(value) : text(value);
    if (result) rows.push({ section, scene, title, field: key === "name" && section !== "个人档案" ? "名称" : labels[key] || key, value: result, recordId });
  }
}

export function buildSelfExportRows(data: SelfBackupData): SelfExportRow[] {
  const rows: SelfExportRow[] = [];
  const strategy = data.strategy || {};
  const scenes = strategy.scenes || [];
  const sceneNames = new Map(scenes.map(scene => [String(scene.id), text(scene.name) || "其他"]));
  const tags = new Map<string, string[]>();
  const ledgers = new Map<string, Record<string, unknown>>();
  const evidenceNames = new Map((data.evidences || []).map(row => [text(row.id), text(row.ability)]));
  for (const record of strategy.records || []) {
    if (record.kind !== "tag") continue;
    try {
      const payload = JSON.parse(String(record.payload || "{}")) as Record<string, unknown>;
      const key = `${text(payload.subjectType)}:${text(payload.subjectId)}`;
      tags.set(key, (Array.isArray(payload.sceneIds) ? payload.sceneIds : []).map(id => sceneNames.get(String(id)) || "其他"));
      if (payload.ledger && typeof payload.ledger === "object") ledgers.set(key, payload.ledger as Record<string, unknown>);
    } catch { /* Ignore malformed legacy tags; JSON export remains available. */ }
  }
  const sceneFor = (type: string, id: unknown) => tags.get(`${type}:${text(id)}`)?.join("、") || "全局";
  if (data.profile) add(rows, "个人档案", "全局", "基础档案", Object.fromEntries(Object.entries(data.profile).filter(([key]) => Object.hasOwn(labels, key))), ["id", "createdAt", "updatedAt", "sensitiveAiFields"], "profile");
  for (const record of strategy.records || []) {
    const kind = text(record.kind);
    if (!["overallVision", "vision", "skill", "profileScene"].includes(kind)) continue;
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(record.payload || "{}")); } catch { payload = {}; }
    const section = kind === "overallVision" || kind === "vision" ? "我的愿景" : kind === "skill" ? "我的能力" : "个人档案";
    const scene = kind === "overallVision" ? "总愿景" : sceneNames.get(String(record.sceneId)) || "全局";
    const title = text(record.title) || section, recordId = text(record.id);
    const values = { ...payload };
    if (kind === "skill") {
      if (values.evidenceId) values.evidenceId = evidenceNames.get(String(values.evidenceId)) || "关联证据已删除";
      if (values.category) values.category = values.category === "requirement" ? "能力需求" : values.category === "assessment" ? "能力评估" : values.category;
    }
    add(rows, section, scene, title, values, ["sceneDetails"], recordId);
    if (payload.sceneDetails && typeof payload.sceneDetails === "object") {
      const definition = scenes.find(item => item.id === record.sceneId);
      const fields = sceneProfileGroups(Number(definition?.slot ?? 0)).flatMap(group => group.fields);
      for (const [key, value] of Object.entries(payload.sceneDetails)) if (text(value)) rows.push({ section, scene, title, field: fields.find(field => field.key === key)?.label || labels[key] || key, value: text(value), recordId });
    }
    if (record.archived) rows.push({ section, scene, title, field: "归档状态", value: "已归档", recordId });
  }
  const recordMap = new Map((strategy.records || []).map(record => [text(record.id), record]));
  for (const version of strategy.versions || []) {
    let snapshot: Record<string, unknown> = {};
    try { snapshot = JSON.parse(String(version.snapshot || "{}")); } catch { snapshot = {}; }
    let payload: Record<string, unknown> = {};
    try { payload = typeof snapshot.payload === "string" ? JSON.parse(snapshot.payload) : (snapshot.payload as Record<string, unknown> || {}); } catch { payload = {}; }
    const source = recordMap.get(text(version.recordId));
    const scene = sceneNames.get(String(source?.sceneId || snapshot.sceneId)) || "全局";
    const title = text(source?.title) || text(snapshot.title) || "历史记录";
    const at = dateText(version.createdAt) || "未知时间";
    if (snapshot.kind === "tag") {
      const type = text(payload.subjectType), id = text(payload.subjectId);
      const names: Record<string, string> = { experience: "经历", evidence: "能力证据", resource: "资源", constraint: "约束", assumption: "假设", valueRule: "价值规则" };
      const ledger = payload.ledger as Record<string, unknown> | undefined;
      const tagScenes = Array.isArray(payload.sceneIds) ? payload.sceneIds.map(id => sceneNames.get(String(id)) || "其他").join("、") : "全局";
      add(rows, "历史版本", scene, `${names[type] || "标签"} ${id}`, { versionAt: at, scenes: tagScenes, ...(ledger || {}) }, [], text(version.id));
    } else add(rows, "历史版本", scene, title, { versionAt: at, ...payload }, [], text(version.id));
  }
  const collections: Array<[keyof SelfBackupData, string, string, string[]]> = [
    ["experiences", "项目及经历", "经历", ["id", "profileId", "createdAt", "updatedAt"]],
    ["evidences", "我的能力", "能力证据", ["id", "profileId", "createdAt", "updatedAt"]],
    ["valueRules", "我的愿景", "价值规则", ["id", "profileId", "createdAt", "updatedAt"]],
    ["resources", "我的资源", "资源", ["id", "profileId", "createdAt", "updatedAt"]],
    ["constraints", "我的资源", "约束", ["id", "profileId", "createdAt", "updatedAt"]],
    ["assumptions", "我的资源", "假设", ["id", "profileId", "createdAt", "updatedAt"]],
  ];
  for (const [key, section, title, omit] of collections) for (const item of (data[key] as Array<Record<string, unknown>> | undefined) || []) {
    const subjectType = key === "experiences" ? "experience" : key === "evidences" ? "evidence" : key === "valueRules" ? "valueRule" : key === "resources" ? "resource" : key === "constraints" ? "constraint" : "assumption";
    const itemTitle = text(item.title) || text(item.name) || text(item.ability) || text(item.value) || text(item.statement) || title;
    const recordId = `${subjectType}:${text(item.id)}`;
    add(rows, section, sceneFor(subjectType, item.id), itemTitle, item, omit, recordId);
    const ledger = ledgers.get(`${subjectType}:${text(item.id)}`);
    if (ledger) add(rows, section, sceneFor(subjectType, item.id), itemTitle, ledger, [], recordId);
  }
  const sections = [...Object.values(selfSections), "历史版本"];
  return rows.sort((a, b) => sections.indexOf(a.section) - sections.indexOf(b.section));
}

export function selfExportFilename(now: Date, extension: "docx" | "xlsx", label = "完整") {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replaceAll("-", "");
  return `认识自己-${label}-${stamp}.${extension}`;
}
