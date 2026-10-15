import { describe, expect, it } from "vitest";
import { parseCapabilityPlan, parseRequirementsPlan } from "./capability-plan";
import { skillSchema } from "./shared";
const plan = { summary: "先验证关键能力", capabilities: [{ title: "写作", visionId: "vision", reason: "来自创作愿景", requirements: "需要作品证据", channels: "写作练习与反馈", plan: "先练习再复盘", project: { name: "完成短文", description: "实践项目", metric: "完成并获取反馈" }, tasks: [{ title: "准备提纲", standard: "结构完整", executor: "混合", dependency: "明确主题" }] }] };
describe("愿景能力规划", () => {
  it("匹配仅接受提供的记录和正确类型，允许无需新增需求", () => {
    expect(parseRequirementsPlan(JSON.stringify({ summary: "足够", capabilities: [], resources: [], cleanup: [] }), ["vision"], []).resources).toEqual([]);
    const matched = { ...plan, capabilities: [{ ...plan.capabilities[0], match: { type: "skill", id: "existing" } }], resources: [], cleanup: [] };
    expect(() => parseRequirementsPlan(JSON.stringify(matched), ["vision"], [])).toThrow("未提供");
    expect(parseRequirementsPlan(JSON.stringify(matched), ["vision"], [{ type: "skill", id: "existing" }]).capabilities[0].match?.id).toBe("existing");
    matched.capabilities[0].match.type = "resource";
    expect(() => parseRequirementsPlan(JSON.stringify(matched), ["vision"], [{ type: "resource", id: "existing" }])).toThrow("类型");
  });
  it("旧能力默认为评估，需求保存重要性与推进状态", () => {
    expect(skillSchema.parse({})).toMatchObject({ layer: "待分类", method: "待选择", gap: "", rating: null });
    expect(skillSchema.parse({ layer: "高层专业能力", method: "实战", gap: "缺少成果", resourceNeeds: "每周两小时", successCriteria: "交付作品" })).toMatchObject({ gap: "缺少成果", successCriteria: "交付作品" });
    expect(skillSchema.parse({}).category).toBe("assessment");
    expect(skillSchema.parse({ category: "requirement", importance: "关键", importanceReason: "多项愿景的前置能力", requirementStatus: "进行中" })).toMatchObject({ category: "requirement", importance: "关键", requirementStatus: "进行中", rating: null });
    expect(() => skillSchema.parse({ importance: "未知" })).toThrow();
  });
  it("保留渠道、需求和任务编排", () => expect(parseCapabilityPlan(JSON.stringify(plan), ["vision"]).capabilities[0].tasks[0].executor).toBe("混合"));
  it("拒绝未选愿景", () => expect(() => parseCapabilityPlan(JSON.stringify(plan), ["other"])).toThrow("未选择"));
  it("拒绝非法执行方式和空能力", () => {
    expect(() => parseCapabilityPlan(JSON.stringify({ ...plan, capabilities: [] }), ["vision"])).toThrow();
    expect(() => parseCapabilityPlan(JSON.stringify(plan).replace('"混合"', '"自动执行"'), ["vision"])).toThrow();
  });
});
