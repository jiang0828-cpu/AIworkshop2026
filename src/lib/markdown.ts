import type { Prisma } from "@prisma/client";
import type { DocumentKey } from "./schemas";
import { resolveScene } from "./scenes";
import { profileGroups } from "./strategy/profile-scenes";
import { sceneProfileGroups } from "./strategy/profile-scene-layout";
import type { StrategyView } from "./strategy/shared";
import { reviewPeriod, reviewPeriodLabels } from "./review-period";
import { readResourceLedger, resourceSummary } from "./strategy/resource-shared";
import { recordAncestors } from "./record-hierarchy";
import { reviewSources } from "./review-links";

type Bundle = Prisma.ProfileGetPayload<{ include: {
  experiences: true; evidences: true; valueRules: true; resources: true; constraints: true; assumptions: true;
  goals: true; projects: { include: { milestones: true } }; actions: true; reviews: true; decisions: { include: { options: true } }; aiInstruction: true;
} }>;

const list = (items: string[], empty = "暂无记录。请从结构化表单开始补充。") => items.length ? items.map((item) => `- ${item}`).join("\n") : `_${empty}_`;
const fmt = (value: string | number | Date | null | undefined) => value instanceof Date ? value.toLocaleDateString("zh-CN") : String(value || "未填写");

export const documentMeta: Record<DocumentKey, { title: string; filename: string }> = {
  profile: { title: "个人基础档案", filename: "01-个人基础档案.md" },
  goals: { title: "目标与项目", filename: "02-目标与项目.md" },
  instruction: { title: "AI 协作说明书", filename: "03-AI协作说明书.md" },
  actions: { title: "行动与复盘", filename: "04-行动与复盘.md" },
  decisions: { title: "重要决策记录", filename: "05-重要决策记录.md" },
};

function generateLegacyMarkdown(key: DocumentKey, p: Bundle, strategy?: StrategyView) {
  const header = (title: string) => `# ${title}\n\n> 由 AI 工作台根据结构化数据生成。更新时间：${new Date().toLocaleString("zh-CN")}\n`;
  if (key === "profile") return `${header("个人基础档案")}\n## 个人概况\n- 称呼：${fmt(p.name)}\n- 年龄段 / 出生年份：${fmt(p.ageRange)} / ${fmt(p.birthYear)}\n- 性别称谓：${fmt(p.genderIdentity)}\n- 常驻城市：${fmt(p.city)}\n- 最高学历 / 专业背景：${fmt(p.education)} / ${fmt(p.major)}\n- 性格特征：${fmt(p.personalityTraits)}\n\n## 当前身份与职业位置\n- 行业：${fmt(p.industry)}\n- 公司 / 组织：${fmt(p.organization)}\n- 职业状态：${fmt(p.employmentStatus)}\n- 岗位 / 职业身份：${fmt(p.jobTitle)}\n- 主要角色：${fmt(p.roles)}\n- 当前职责：${fmt(p.responsibilities)}\n- 专业方向：${fmt(p.professionalFocus)}\n\n## 当前人生阶段与阶段诉求\n- 当前阶段：${fmt(p.stage)}\n- 阶段变化背景：${fmt(p.stageTransition)}\n- 当前优先事项：${fmt(p.currentPriorities)}\n- 阶段诉求：${fmt(p.stageNeeds)}\n- 当前困难：${fmt(p.currentChallenges)}\n- 未来 1-3 年方向：${fmt(p.directionOneToThreeYears)}\n- 成功状态定义：${fmt(p.successDefinition)}\n\n## 核心价值与取舍规则\n${list(p.valueRules.map((v) => `${v.value}（优先级 ${v.priority}）：${v.rule || "尚未定义规则"}`))}\n\n## 经历和能力证据\n${list(p.experiences.map((e) => `${e.title}：${e.description || "未填写"}；学习：${e.learning || "未填写"}`))}\n\n### 能力证据\n${list(p.evidences.map((e) => `${e.ability}：${e.evidence}（信心 ${e.confidence}/5）`))}\n\n## 资源与约束\n### 资源\n${list(p.resources.map((r) => `${r.name}：${r.description || "未填写"}`))}\n### 约束\n${list(p.constraints.map((c) => `${c.name}：${c.description || "未填写"}（${c.severity}）`))}\n\n## 现实条件、行为模式与风险偏好\n- 家庭责任：${fmt(p.familyResponsibilities)}\n- 健康与精力状态：${fmt(p.healthEnergy)}\n- 收入范围：${fmt(p.incomeRange)}\n- 财务压力：${fmt(p.financialPressure)}\n- 行为模式：${fmt(p.behaviorPatterns)}\n- 风险偏好：${fmt(p.riskPreference)}\n\n## 待验证假设\n${list(p.assumptions.map((a) => `${a.statement}（状态：${a.status}）`))}`;
  if (key === "goals") return `${header("目标与项目")}\n## 长期方向\n${list(p.goals.filter((g) => g.horizon === "长期").map((g) => g.title))}\n\n## 年度及 90 天目标\n${list(p.goals.filter((g) => g.horizon !== "长期").map((g) => `${g.title}（${g.horizon}，${g.status}）：${g.description || "未填写"}；指标：${g.metric || "未定义"}`))}\n\n## 当前项目和里程碑\n${list(p.projects.map((project) => { const ms = project.milestones.map((m) => `${m.title}（${m.status}）`).join("、") || "暂无里程碑"; return `${project.name}：${project.description || "未填写"}；里程碑：${ms}；指标：${project.metric || "未定义"}；投入/边界：${project.budget || "未填写"}/${project.boundary || "未填写"}；停止条件：${project.stopCondition || "未填写"}`; }))}`;
  if (key === "instruction") { const i = p.aiInstruction; return `${header("AI 协作说明书")}\n## 沟通偏好\n- 语言：${fmt(i?.language)}\n- 长度：${fmt(i?.answerLength)}\n- 结构：${fmt(i?.structure)}\n\n## AI 角色\n${i?.aiRole || "尚未定义。"}\n\n## 允许委托和必须确认\n- 允许委托：${i?.delegate || "尚未定义。"}\n- 必须确认：${i?.mustConfirm || "重要决定和对外行动。"}\n\n## 隐私边界\n${i?.privacyOptions || "默认对姓名和联系方式脱敏。"}\n\n## 重大决策规则\nAI 只提供事实整理、选项比较和风险提示，最终决定由本人确认。`; }
  if (key === "actions") return `${header("行动与复盘")}\n## 项目任务\n${list(p.actions.map((a) => `${a.title}（${a.status}，截止 ${fmt(a.dueDate)}）：项目 ${p.projects.find(project => project.id === a.projectId)?.name || "尚未关联"}；目的 ${a.purpose || "未填写"}；投入 ${a.estimatedHours} 小时；完成标准：${a.standard || "未定义"}`))}\n\n## 周／月／年复盘历史\n${list(p.reviews.map((r) => `${reviewPeriodLabels[reviewPeriod(r)]} ${fmt(r.periodStart)} - ${fmt(r.periodEnd)}：${reviewSources(strategy?.sources || [], r.id).map(source => source.sourceTitle).join("、") || "历史复盘，尚未关联项目任务"}；收获 ${r.wins || "未填写"}；目标问题 ${r.goalIssue || "无"}；策略问题 ${r.strategyIssue || "无"}；执行问题 ${r.executionIssue || "无"}；外部条件 ${r.externalIssue || "无"}；调整：${r.adjustment || "未填写"}`))}\n\n## 行为模式和后续调整\n${p.behaviorPatterns || "_等待复盘积累后总结。_"}`;
  return `${header("重要决策记录")}\n${list(p.decisions.map((d) => `## ${d.title}\n背景：${d.context || "未填写"}\n\n### 选项\n${d.options.map((o) => `- ${o.name}：收益 ${o.benefit || "未填写"}；代价 ${o.cost || "未填写"}；风险 ${o.risk || "未填写"}；评分 ${o.score}`).join("\n") || "_暂无选项。_"}\n\n事实：${d.facts || "未填写"}\n关键假设：${d.assumptions || "未填写"}\n信息缺口：${d.gaps || "未填写"}\n最终选择：${d.selectedOption || "尚未决定"}\n理由：${d.rationale || "未填写"}\n复盘：${d.resultReview || "尚未复盘"}`))}`;
}

export type { Bundle };

export function generateMarkdown(key: DocumentKey, profile: Bundle, strategy?: StrategyView) {
  const paths = key === "goals" ? [...profile.goals.map(row => `- 目标：${[...recordAncestors(row, profile.goals), row].map(item => item.title).join(" → ")}`), ...profile.projects.map(row => `- 项目：${[...recordAncestors(row, profile.projects), row].map(item => item.name).join(" → ")}`)] : key === "actions" ? profile.actions.map(row => `- 任务：${[...recordAncestors(row, profile.actions), row].map(item => item.title).join(" → ")}`) : [];
  const deliveries = key === "goals" ? profile.projects.map(row => `- ${row.recordCode || row.id} · ${row.name} · 交付：${fmt(row.deadline)}`) : key === "actions" ? profile.actions.map(row => `- ${row.recordCode || row.id} · ${row.title} · 交付：${fmt(row.dueDate)}`) : [];
  const original = generateLegacyMarkdown(key, profile, strategy) + (paths.length ? `\n\n## 从属路径\n${paths.join("\n")}` : "") + (deliveries.length ? `\n\n## 编号与交付\n${deliveries.join("\n")}` : "");
  if (!strategy || key === "instruction") return original;
  const sceneName = (id: string | null) => strategy.scenes.find((scene) => scene.id === id)?.name || "其他";
  const records = strategy.records.filter((record) => !record.archived && (key === "profile" ? ["overallVision", "vision", "skill", "tag", "profileScene"].includes(record.kind) : ["overallVision", "vision", "signal"].includes(record.kind)));
  const content = records.map((record) => {
    if (record.kind === "profileScene") {
      const details = record.payload.sceneDetails as Record<string, string> | undefined;
      const slot = strategy.scenes.find(scene => scene.id === record.sceneId)?.slot;
      const legacy = profileGroups.map(group => `#### ${group.title}\n${group.fields.map(([field, label]) => `- ${label}：${record.payload[field] || "未填写"}`).join("\n")}`).join("\n\n");
      const adapted = details && slot !== undefined ? sceneProfileGroups(slot).map(group => `#### ${group.title}\n${group.fields.map(field => `- ${field.label}：${details[field.key] || "未填写"}`).join("\n")}`).join("\n\n") : "";
      const hasLegacy = profileGroups.some(group => group.fields.some(([field]) => Boolean(record.payload[field])));
      return `### 基础档案 · ${sceneName(record.sceneId)}\n${adapted || legacy}${adapted && hasLegacy ? `\n\n#### 原有场景资料\n${legacy}` : ""}`;
    }
    if (record.kind === "tag" && record.payload.subjectType === "resource") {
      const resource = profile.resources.find((row) => row.id === record.payload.subjectId);
      const ledger = readResourceLedger(record.payload.ledger, resource?.category);
      const scenes = (record.payload.sceneIds as string[]).map(sceneName).join("、") || "全局";
      return `### ${resource?.name || "资源已删除"} · ${scenes}\n${resourceSummary(ledger)}`;
    }
    return `### ${record.title}${record.kind === "overallVision" ? "" : ` · ${sceneName(record.sceneId)}`}\n${Object.entries(record.payload).filter(([field]) => !field.endsWith("Id") && !field.endsWith("Ids")).map(([field, value]) => `- ${field}：${String(value || "未填写")}`).join("\n")}`;
  }).join("\n\n");
  const association = [...profile.goals.map((goal) => `目标 ${goal.title}：${sceneName(goal.sceneId)}`), ...profile.projects.map((project) => `项目 ${project.name}：${sceneName(resolveScene(project, profile.goals, profile.projects, strategy.scenes).effectiveSceneId)}`), ...profile.actions.map((action) => `行动 ${action.title}：${sceneName(resolveScene(action, profile.goals, profile.projects, strategy.scenes).effectiveSceneId)}`)].join("\n- ");
  return `${original}\n\n## 场景与战略关联\n- ${association || "暂无目标或项目"}\n\n${content}`;
}
