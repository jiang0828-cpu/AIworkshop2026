import { afterEach, describe, expect, it, vi } from "vitest";
import { redact, runAI } from "./ai";
import { generateMarkdown, type Bundle } from "./markdown";
import { aiRequestSchema, profileSchema, situationAssessmentSchema, situationItemSchema } from "./schemas";
import type { StrategyView } from "./strategy/shared";

const bundle = { name: "林然", stage: "转换期", roles: "创作者", behaviorPatterns: "先记录再判断", riskPreference: "平衡", experiences: [], evidences: [], valueRules: [], resources: [], constraints: [], assumptions: [], goals: [], projects: [], actions: [], reviews: [], decisions: [], aiInstruction: null } as unknown as Bundle;

describe("Markdown generator", () => {
  it("retains independent daily work sources in review exports after deletion", () => {
    const profile = { ...bundle, reviews: [{ id: "r", periodStart: new Date("2026-10-05"), periodEnd: new Date("2026-10-11"), wins: "实际完成结果" }] } as unknown as Bundle;
    const strategy = { scenes: [], records: [], versions: [], relations: [], pins: [], sources: [{ targetType: "review", targetId: "r", sourceType: "dailyTask", sourceId: "deleted", sourceTitle: "独立每日工作" }] } as unknown as StrategyView;
    expect(generateMarkdown("actions", profile, strategy)).toContain("独立每日工作；收获 实际完成结果");
  });
  it("labels weekly, monthly and yearly reviews in exported documents", () => {
    const reviews = [{ periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31"), wins: "Year result" }, { periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"), wins: "Month result" }, { periodStart: new Date("2026-10-05"), periodEnd: new Date("2026-10-11"), wins: "Week result" }];
    const markdown = generateMarkdown("actions", { ...bundle, reviews } as unknown as Bundle);
    expect(markdown).toContain("周／月／年复盘历史");
    expect(markdown).toMatch(/年复盘.*Year result/);
    expect(markdown).toMatch(/月复盘.*Month result/);
    expect(markdown).toMatch(/周复盘.*Week result/);
  });
  it("creates all required empty-state documents", () => {
    expect(generateMarkdown("profile", bundle)).toContain("个人基础档案");
    expect(generateMarkdown("goals", bundle)).toContain("暂无记录");
    expect(generateMarkdown("instruction", bundle)).toContain("AI 协作说明书");
    expect(generateMarkdown("actions", bundle)).toContain("行动与复盘");
    expect(generateMarkdown("decisions", bundle)).toContain("重要决策记录");
  });

  it("renders extended profile sections with safe empty states", () => {
    const markdown = generateMarkdown("profile", { ...bundle, industry: "软件", jobTitle: "产品经理", stageNeeds: "建立稳定节奏", currentChallenges: "时间有限" } as Bundle);
    expect(markdown).toContain("个人概况");
    expect(markdown).toContain("当前身份与职业位置");
    expect(markdown).toContain("当前人生阶段与阶段诉求");
    expect(markdown).toContain("现实条件、行为模式与风险偏好");
    expect(markdown).toContain("产品经理");
  });
});

describe("基础档案校验", () => {
  it("accepts optional extended fields and normalizes sensitive-field consent", () => {
    const profile = profileSchema.parse({ name: "林然", ageRange: "30-34 岁", industry: "软件", sensitiveAiFields: JSON.stringify(["organization", "organization", "healthEnergy"]) });
    expect(profile.industry).toBe("软件");
    expect(profile.sensitiveAiFields).toBe(JSON.stringify(["organization", "healthEnergy"]));
  });

  it("rejects an invalid sensitive-field consent payload", () => {
    expect(() => profileSchema.parse({ sensitiveAiFields: '["unknown"]' })).toThrow();
  });

  it("accepts a structured situation assessment and supplies safe empty defaults", () => {
    const assessment = situationAssessmentSchema.parse({ todayStatus: "监管环境出现新的政策信号", trendRadar: "技术采用正在加速" });
    expect(assessment.todayStatus).toContain("政策信号");
    expect(assessment.trendRadar).toContain("加速");
    expect(assessment.keyEvents).toBe("");
    expect(assessment.personalActions).toBe("");
  });

  it("validates an independently editable situation item", () => {
    expect(situationItemSchema.parse({ category: "trends", title: "监管趋势", content: "变化：新规\n影响：需评估\n下一步：跟进" })).toMatchObject({ category: "trends", title: "监管趋势" });
    expect(() => situationItemSchema.parse({ category: "unknown", title: "无效" })).toThrow();
  });
});

describe("AI safety helpers", () => {
  const previousKey = process.env.AI_API_KEY;
  const previousBaseUrl = process.env.AI_BASE_URL;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previousBaseUrl;
    vi.unstubAllGlobals();
  });
  it("redacts sensitive keyed values", () => {
    expect(redact({ name: "林然", email: "person@example.com", nested: { mobile: "13800000000" }, title: "目标" }, "脱敏")).toEqual({ name: "[已脱敏]", email: "[已脱敏]", nested: { mobile: "[已脱敏]" }, title: "目标" });
  });

  it("respects an explicit no-redaction preference", () => {
    expect(redact({ name: "林然" }, "不脱敏")).toEqual({ name: "林然" });
  });

  it("omits sensitive profile fields unless the user explicitly authorizes them", () => {
    const profile = { organization: "示例公司", familyResponsibilities: "照护安排", healthEnergy: "精力有限", industry: "软件" };
    expect(redact(profile, "不脱敏")).toEqual({ industry: "软件" });
    expect(redact(profile, "不脱敏", ["organization"])).toEqual({ organization: "示例公司", industry: "软件" });
  });

  it("falls back to structured questions without an API key", async () => {
    const result = await runAI({ kind: "questions", context: {}, scope: ["阶段"] });
    expect(result.configured).toBe(false);
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.sentScope).toEqual(["阶段"]);
  });

  it("falls back without misreporting configuration when a configured service fails", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://unit.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const result = await runAI({ kind: "analysis", context: {}, scope: ["目标"] });
    expect(result.configured).toBe(true);
    expect(result.error).toContain("503");
    expect(result.source).toBe("规则模板");
  });

  it("falls back when an AI response is not valid structured data", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://unit.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })));
    const result = await runAI({ kind: "extraction", context: {}, scope: ["经历"] });
    expect(result.configured).toBe(true);
    expect(result.error).toContain("结构化校验");
  });

  it("accepts JSON wrapped in a Markdown code fence and normalizes a provider operation label", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://unit.test";
    const content = "```json\n{\"kind\":\"note\",\"items\":[{\"title\":\"问题\",\"content\":\"回答\",\"category\":null}]}\n```";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })));
    const result = await runAI({ kind: "questions", context: {}, scope: ["阶段"] });
    expect(result.source).toBe("deepseek-reasoner");
    expect(result.items).toEqual([{ title: "问题", content: "回答", category: undefined }]);
  });

  it("caps provider suggestions at five items", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://unit.test";
    const items = Array.from({ length: 6 }, (_, index) => ({ title: `问题${index}`, content: "内容", category: "事实" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "questions", items }) } }] }), { status: 200 })));
    const result = await runAI({ kind: "questions", context: {}, scope: ["阶段"] });
    expect(result.items).toHaveLength(5);
  });

  it("rejects malformed AI request parameters", () => {
    expect(() => aiRequestSchema.parse({ kind: "invalid", scope: [] })).toThrow();
  });
});
