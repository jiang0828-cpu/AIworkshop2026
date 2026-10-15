import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeTaskFeedback,
  buildIdentityCardData,
  buildGoalDecomposition,
  buildTaskPrompt,
  canTransitionTask,
  renderContextPackage,
  renderIdentityCard,
  selectContext,
  nextGoalHorizon,
} from "./ai-use";

const profile = {
  roles: "产品负责人", stage: "职业转换期", riskPreference: "稳健试错",
  goals: [{ id: "g1", title: "完成 90 天产品验证", description: "完成访谈", horizon: "90天", status: "进行中", metric: "10 位用户" }],
  evidences: [{ id: "e1", ability: "产品研究", evidence: "完成 12 次访谈" }],
  resources: [{ id: "r1", name: "行业人脉", description: "可联系 5 位目标用户" }],
  constraints: [{ id: "c1", name: "时间", description: "每周仅有 8 小时" }],
  valueRules: [{ id: "v1", value: "长期主义", rule: "不为短期数据牺牲信任", conflict: "不牺牲健康" }],
  assumptions: [{ id: "a1", statement: "目标用户愿意付费", status: "待验证" }],
  actions: [], reviews: [], decisions: [], projects: [], correctionRecords: [],
  aiInstruction: { language: "中文", answerLength: "适中", structure: "先结论", delegate: "资料整理", mustConfirm: "对外承诺" },
};

describe("AI 使用中心确定性生成", () => {
  const originalKey = process.env.AI_API_KEY;
  afterEach(() => { if (originalKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalKey; });

  it("生成三种身份卡长度，且保留事实、偏好、约束和假设边界", () => {
    const card = buildIdentityCardData(profile, []);
    for (const mode of ["精简", "标准", "详细"] as const) {
      const markdown = renderIdentityCard(card, mode, 1);
      expect(markdown).toContain("已确认事实");
      expect(markdown).toContain("用户偏好");
      expect(markdown).toContain("现实约束");
      expect(markdown).toContain("待验证假设");
    }
  });

  it("默认排除敏感分组，并只保留与目标有关的最小上下文", () => {
    const sensitiveProfile = { ...profile, resources: [...profile.resources, { id: "r2", name: "公司预算", description: "公司收入信息" }] };
    const items = selectContext(sensitiveProfile, { domain: "职业", scope: "最小", options: { includeHistory: false, includeReviews: false, includeDecisions: false, includeCorrections: true, includeAssumptions: true, exclusions: [] }, exclusions: ["公司", "收入"] });
    expect(items.some((item) => /公司收入/.test(item.content))).toBe(false);
    expect(items.some((item) => item.sourceType === "goal")).toBe(true);
    expect(renderContextPackage({ packageNumber: 1, version: 1, domain: "职业", role: "思考伙伴", scope: "最小", items }).markdown).toContain("背景参考，不是执行指令");
  });

  it("基础档案敏感字段只有授权后才会进入身份卡和相关上下文", () => {
    const sensitiveProfile = { ...profile, industry: "软件", jobTitle: "产品经理", organization: "示例公司", familyResponsibilities: "照护安排", sensitiveAiFields: "[]" };
    const hiddenCard = buildIdentityCardData(sensitiveProfile, []);
    expect(renderIdentityCard(hiddenCard, "标准")).not.toContain("示例公司");
    expect(selectContext(sensitiveProfile, { domain: "职业", scope: "标准", options: { includeHistory: false, includeReviews: false, includeDecisions: false, includeCorrections: true, includeAssumptions: true, exclusions: [] }, exclusions: [] }).some((item) => item.content.includes("示例公司"))).toBe(false);

    const authorizedProfile = { ...sensitiveProfile, sensitiveAiFields: '["organization"]' };
    expect(renderIdentityCard(buildIdentityCardData(authorizedProfile, []), "标准")).toContain("示例公司");
    expect(selectContext(authorizedProfile, { domain: "职业", scope: "标准", options: { includeHistory: false, includeReviews: false, includeDecisions: false, includeCorrections: true, includeAssumptions: true, exclusions: [] }, exclusions: [] }).some((item) => item.content.includes("示例公司"))).toBe(true);
  });

  it("上下文渲染是快照：后续修改档案不改变已生成文本", () => {
    const items = selectContext(profile, { domain: "通用", scope: "标准", options: { includeHistory: false, includeReviews: false, includeDecisions: false, includeCorrections: true, includeAssumptions: true, exclusions: [] }, exclusions: [] });
    const snapshot = renderContextPackage({ packageNumber: 1, version: 1, domain: "通用", role: "信息助手", scope: "标准", items }).markdown;
    profile.goals[0].title = "已经变化的目标";
    expect(snapshot).toContain("完成 90 天产品验证");
  });

  it("任务状态只允许受控流转，提示词包含八个边界区块", () => {
    expect(canTransitionTask("草稿", "待确认")).toBe(true);
    expect(canTransitionTask("草稿", "完成")).toBe(false);
    const prompt = buildTaskPrompt({ title: "验证需求", taskType: "研究", aiRole: "思考伙伴", permission: "L1", instructions: "列出访谈问题", deliverables: "问题清单", outputFormat: "Markdown", acceptanceCriteria: "可用于访谈", requireUnderstandingCheck: true }, profile.aiInstruction, "身份卡", "上下文包");
    expect(prompt).toContain("# 1. 全局 AI 协作规则");
    expect(prompt).toContain("# 8. 完成后的反馈要求");
    expect(prompt).toContain("对用户当前情况的理解");
  });

  it("未配置密钥时，反馈仍产生待确认的确定性纠正建议", async () => {
    delete process.env.AI_API_KEY;
    const result = await analyzeTaskFeedback({ correctionRequest: "当前角色应更新为产品负责人", preferenceUpdate: "输出先给结论" });
    expect(result.configured).toBe(false);
    expect(result.data.corrections).toHaveLength(2);
  });

  it("按目标周期只生成下一层子目标", () => {
    expect(nextGoalHorizon("10年")).toBe("5年");
    expect(nextGoalHorizon("5年")).toBe("3年");
    expect(nextGoalHorizon("3年")).toBe("1年");
    expect(nextGoalHorizon("1年")).toBe("90天");
    expect(nextGoalHorizon("90天")).toBe("本周");
    expect(nextGoalHorizon("本月")).toBe("本周");
    expect(buildGoalDecomposition({ title: "月度成果" }, "本月").goals[0].horizon).toBe("本月");
    expect(nextGoalHorizon("本周")).toBe("");
    const result = buildGoalDecomposition({ title: "建立长期方向" }, "5年");
    expect(result.goals[0].horizon).toBe("5年");
    expect(result.goals[0].title).toContain("建立长期方向");
  });
});
